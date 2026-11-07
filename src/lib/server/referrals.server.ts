// Referral links: everything that reads or writes referral data.
//
// PRIVACY CONTRACT (enforced here, and pinned by tests/referral-privacy.test.mjs):
//  * This is the ONLY module that touches the referral_* tables. Author-facing code never imports it for reads.
//  * Every admin* function starts with requireReferralAdmin(), so a caller cannot forget the permission check.
//  * The record* functions are called only from server code, with identities taken from the verified session (never from the browser).
//    They return booleans and never throw, so a referral problem can never break registration or a submission.
//  * Partner names exist only in the return values of admin* functions. Audit entries carry opaque ids, not names.
import { db, dbx, audit, log, requirePermission, certificateSiteUrl } from "./core.server";
import {
  generateReferralCode, readReferralCookie, referralUrl, resolvePaperAttribution, validateShares, MAX_DISCOUNT_MINOR,
  linkDiscountOnFee, bestLinkDiscount,
  type Touch,
} from "@/lib/domain/referrals";

export async function requireReferralAdmin(actorId: string) {
  return requirePermission(actorId, "REFERRAL_ADMIN");
}

const UNIQUE_VIOLATION = "23505";
type DbError = { code?: string; message: string } | null;
const fail = (e: DbError, fallback: string): never => { throw new Error(e?.message ? `${fallback}: ${e.message}` : fallback); };

// ---------------------------------------------------------------------------------------------------------------------------
// Recording (called by the server on behalf of the signed-in person; never by an administrator screen)
// ---------------------------------------------------------------------------------------------------------------------------

/** The partner behind a code, only while both the link and the partner are active. An unknown, revoked or paused code is simply "no referral". */
async function resolveLink(code: string | null): Promise<Touch | null> {
  if (!code) return null;
  const { data: link } = await dbx.from("referral_links").select("id, partner_id").eq("code", code).eq("active", true).maybeSingle();
  if (!link) return null;
  const { data: partner } = await dbx.from("referral_partners").select("id").eq("id", link.partner_id).eq("active", true).maybeSingle();
  return partner ? { partnerId: link.partner_id as string, linkId: link.id as string } : null;
}

/** A person's account was just created. If they arrived through a live referral link, remember which one. First touch wins; never throws. */
export async function recordRegistrationReferral(userId: string, cookieHeader: string | null): Promise<boolean> {
  try {
    const touch = await resolveLink(readReferralCookie(cookieHeader));
    if (!touch) return false;
    const { error } = await dbx.from("referral_user_attributions").insert({ user_id: userId, partner_id: touch.partnerId, link_id: touch.linkId });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return false; // already attributed: first touch stays
      throw new Error(error.message);
    }
    await audit({ actor_id: userId, action: "referral_registered", resource_type: "user", resource_id: userId, metadata: { partner_id: touch.partnerId, link_id: touch.linkId } });
    return true;
  } catch (e) {
    log("referral_registration_failed", { error: e instanceof Error ? e.message : "unknown" });
    return false;
  }
}

/**
 * A paper was just submitted (the submission has already been committed). Credit the partner behind the link used right now and/or
 * the one the author registered through. Never overwrites an existing record, so a replayed submission or an administrator's
 * decision is left alone. Never throws.
 */
export async function recordSubmissionReferral(userId: string, paperId: string, cookieHeader: string | null): Promise<boolean> {
  try {
    const { data: paper } = await db.from("papers").select("owner_id").eq("id", paperId).maybeSingle();
    if (!paper || paper.owner_id !== userId) return false; // only the owner's own submission, whatever the caller passed
    const submission = await resolveLink(readReferralCookie(cookieHeader));
    const { data: reg } = await dbx.from("referral_user_attributions").select("partner_id, link_id").eq("user_id", userId).maybeSingle();
    const registration: Touch | null = reg ? { partnerId: reg.partner_id as string, linkId: reg.link_id as string } : null;
    const resolved = resolvePaperAttribution(submission, registration);
    if (!resolved) return false;
    const { data, error } = await dbx.rpc("referral_set_paper_shares", {
      p_paper_id: paperId,
      p_shares: resolved.shares.map((s) => ({ partner_id: s.partnerId, link_id: s.linkId, share_percent: s.sharePercent })),
      p_source: resolved.source, p_overwrite: false, p_actor: userId,
    });
    if (error) throw new Error(error.message);
    if (data !== true) return false; // already recorded
    await audit({ actor_id: userId, action: "referral_paper_attributed", resource_type: "paper", resource_id: paperId, metadata: { source: resolved.source, shares: resolved.shares.map((s) => ({ partner_id: s.partnerId, share_percent: s.sharePercent })) } });
    return true;
  } catch (e) {
    log("referral_submission_failed", { error: e instanceof Error ? e.message : "unknown" });
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Administrator screens
// ---------------------------------------------------------------------------------------------------------------------------

export type PartnerRow = {
  id: string; displayName: string; contactEmail: string | null; notes: string | null; active: boolean; createdAt: string;
  link: { id: string; code: string; url: string } | null;
  registrations: number; articles: number; credited: number;
};

export async function adminListPartners(actorId: string, requestOrigin?: string): Promise<PartnerRow[]> {
  await requireReferralAdmin(actorId);
  const origin = certificateSiteUrl(requestOrigin);
  const [partners, links, stats] = await Promise.all([
    dbx.from("referral_partners").select("id, display_name, contact_email, notes, active, created_at, user_id").order("created_at", { ascending: false }),
    dbx.from("referral_links").select("id, partner_id, code").eq("active", true),
    dbx.rpc("referral_partner_stats"),
  ]);
  if (partners.error) fail(partners.error, "Could not load partners");
  const linkBy = new Map<string, { id: string; code: string }>((links.data ?? []).map((l: { id: string; partner_id: string; code: string }) => [l.partner_id, { id: l.id, code: l.code }]));
  const statBy = new Map<string, { registrations: number; articles: number; credited: number }>(
    ((stats.data ?? []) as Array<{ partner_id: string; registrations: number | string; articles: number | string; credited: number | string }>)
      .map((s) => [s.partner_id, { registrations: Number(s.registrations), articles: Number(s.articles), credited: Number(s.credited) }]),
  );
  return (partners.data ?? []).filter((p: { user_id?: string | null }) => !p.user_id).map((p: { id: string; display_name: string; contact_email: string | null; notes: string | null; active: boolean; created_at: string }) => {
    const l = linkBy.get(p.id);
    const st = statBy.get(p.id) ?? { registrations: 0, articles: 0, credited: 0 };
    return { id: p.id, displayName: p.display_name, contactEmail: p.contact_email, notes: p.notes, active: p.active, createdAt: p.created_at,
      link: l ? { id: l.id, code: l.code, url: referralUrl(origin, l.code) } : null, ...st };
  });
}

async function newLink(partnerId: string, actorId: string): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateReferralCode();
    const { data, error } = await dbx.from("referral_links").insert({ partner_id: partnerId, code, active: true, created_by: actorId }).select("id, code").single();
    if (!error && data) return { id: data.id as string, code: data.code as string };
    if (error?.code !== UNIQUE_VIOLATION) fail(error, "Could not create the link");
  }
  throw new Error("Could not create a unique link. Try again.");
}

export async function adminCreatePartner(actorId: string, v: { displayName: string; contactEmail?: string | null | undefined; notes?: string | null | undefined }, requestOrigin?: string) {
  await requireReferralAdmin(actorId);
  const { data, error } = await dbx.from("referral_partners")
    .insert({ display_name: v.displayName.trim(), contact_email: v.contactEmail?.trim() || null, notes: v.notes?.trim() || null, created_by: actorId })
    .select("id").single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error("A partner with that name already exists");
    fail(error, "Could not create the partner");
  }
  const partnerId = data.id as string;
  const link = await newLink(partnerId, actorId);
  await audit({ actor_id: actorId, action: "referral_partner_created", resource_type: "referral_partner", resource_id: partnerId, metadata: { link_id: link.id } });
  return { id: partnerId, url: referralUrl(certificateSiteUrl(requestOrigin), link.code) };
}

export async function adminUpdatePartner(actorId: string, partnerId: string, v: { displayName: string; contactEmail?: string | null | undefined; notes?: string | null | undefined }) {
  await requireReferralAdmin(actorId);
  const { error } = await dbx.from("referral_partners")
    .update({ display_name: v.displayName.trim(), contact_email: v.contactEmail?.trim() || null, notes: v.notes?.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", partnerId);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error("A partner with that name already exists");
    fail(error, "Could not save the partner");
  }
  await audit({ actor_id: actorId, action: "referral_partner_updated", resource_type: "referral_partner", resource_id: partnerId });
}

/** Pausing a partner stops new referrals through their link. Everything already recorded stays. */
export async function adminSetPartnerActive(actorId: string, partnerId: string, active: boolean) {
  await requireReferralAdmin(actorId);
  const { error } = await dbx.from("referral_partners").update({ active, updated_at: new Date().toISOString() }).eq("id", partnerId);
  if (error) fail(error, "Could not update the partner");
  await audit({ actor_id: actorId, action: active ? "referral_partner_resumed" : "referral_partner_paused", resource_type: "referral_partner", resource_id: partnerId });
}

/** Replaces the partner's link with a new random one. The old code stops working for new visitors; history keeps pointing at it. */
export async function adminRotateLink(actorId: string, partnerId: string, requestOrigin?: string) {
  await requireReferralAdmin(actorId);
  const { data: partner } = await dbx.from("referral_partners").select("id, active").eq("id", partnerId).maybeSingle();
  if (!partner) throw new Error("Partner not found");
  const prev = await dbx.from("referral_links").select("discount_minor").eq("partner_id", partnerId).eq("active", true).maybeSingle();
  const { error } = await dbx.from("referral_links").update({ active: false, revoked_at: new Date().toISOString() }).eq("partner_id", partnerId).eq("active", true);
  if (error) fail(error, "Could not retire the old link");
  const link = await newLink(partnerId, actorId);
  const carry = Number(prev.data?.discount_minor ?? 0); // the discount belongs to the person, so it moves to the new link
  if (carry > 0) { const c = await dbx.from("referral_links").update({ discount_minor: carry }).eq("id", link.id); if (c.error) fail(c.error, "The new link was created but its discount could not be carried over"); }
  await audit({ actor_id: actorId, action: "referral_link_rotated", resource_type: "referral_partner", resource_id: partnerId, metadata: { link_id: link.id } });
  return { url: referralUrl(certificateSiteUrl(requestOrigin), link.code) };
}

export type PaperReferral = {
  registeredVia: { partnerId: string; partnerName: string } | null;
  shares: Array<{ partnerId: string; partnerName: string; sharePercent: number; source: string; recordedAt: string }>;
  partners: Array<{ id: string; name: string; active: boolean }>;
};

async function partnerNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await dbx.from("referral_partners").select("id, display_name").in("id", ids);
  return new Map((data ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
}

/** The referral source of one article, shown only on the administrator's article view. */
export async function adminGetPaperReferral(actorId: string, paperId: string): Promise<PaperReferral> {
  await requireReferralAdmin(actorId);
  const [{ data: paper }, attr, all] = await Promise.all([
    db.from("papers").select("owner_id").eq("id", paperId).maybeSingle(),
    dbx.from("referral_paper_attributions").select("partner_id, share_percent, source, created_at").eq("paper_id", paperId).order("share_percent", { ascending: false }),
    dbx.from("referral_partners").select("id, display_name, active").order("display_name"),
  ]);
  if (!paper) throw new Error("Not found");
  const { data: reg } = await dbx.from("referral_user_attributions").select("partner_id").eq("user_id", paper.owner_id).maybeSingle();
  const rows = (attr.data ?? []) as Array<{ partner_id: string; share_percent: number | string; source: string; created_at: string }>;
  const names = await partnerNames([...rows.map((r) => r.partner_id), ...(reg ? [reg.partner_id as string] : [])]);
  return {
    registeredVia: reg ? { partnerId: reg.partner_id as string, partnerName: names.get(reg.partner_id as string) ?? "Unknown partner" } : null,
    shares: rows.map((r) => ({ partnerId: r.partner_id, partnerName: names.get(r.partner_id) ?? "Unknown partner", sharePercent: Number(r.share_percent), source: r.source, recordedAt: r.created_at })),
    partners: ((all.data ?? []) as Array<{ id: string; display_name: string; active: boolean }>).map((p) => ({ id: p.id, name: p.display_name, active: p.active })),
  };
}

/** Joint attribution set by an administrator. Replaces whatever was recorded; the whole set must add up to exactly 100%. */
export async function adminSetPaperShares(actorId: string, paperId: string, shares: Array<{ partnerId: string; sharePercent: number }>) {
  await requireReferralAdmin(actorId);
  const v = validateShares(shares);
  if (!v.ok) throw new Error(v.reason);
  const { data: before } = await dbx.from("referral_paper_attributions").select("partner_id, link_id, share_percent").eq("paper_id", paperId);
  const linkOf = new Map<string, string | null>(((before ?? []) as Array<{ partner_id: string; link_id: string | null }>).map((b) => [b.partner_id, b.link_id]));
  const { error } = await dbx.rpc("referral_set_paper_shares", {
    p_paper_id: paperId,
    p_shares: shares.map((s) => ({ partner_id: s.partnerId, link_id: linkOf.get(s.partnerId) ?? null, share_percent: s.sharePercent })),
    p_source: "ADMIN", p_overwrite: true, p_actor: actorId,
  });
  if (error) fail(error, "Could not save the split");
  await audit({ actor_id: actorId, action: "referral_paper_shares_set", resource_type: "paper", resource_id: paperId,
    old_value: (before ?? []).map((b: { partner_id: string; share_percent: number | string }) => ({ partner_id: b.partner_id, share_percent: Number(b.share_percent) })),
    new_value: shares.map((s) => ({ partner_id: s.partnerId, share_percent: s.sharePercent })) });
}

export async function adminClearPaperShares(actorId: string, paperId: string) {
  await requireReferralAdmin(actorId);
  const { data: before } = await dbx.from("referral_paper_attributions").select("partner_id, share_percent").eq("paper_id", paperId);
  const { error } = await dbx.from("referral_paper_attributions").delete().eq("paper_id", paperId);
  if (error) fail(error, "Could not remove the referral source");
  await audit({ actor_id: actorId, action: "referral_paper_shares_cleared", resource_type: "paper", resource_id: paperId,
    old_value: (before ?? []).map((b: { partner_id: string; share_percent: number | string }) => ({ partner_id: b.partner_id, share_percent: Number(b.share_percent) })) });
}

export type RecentAttribution = { paperId: string; paperlyId: string | null; publicId: string; title: string; shares: Array<{ partnerName: string; sharePercent: number }> };

/** Publisher-level view: the latest articles that carry a referral source, with each partner's share. */
export async function adminRecentAttributions(actorId: string): Promise<RecentAttribution[]> {
  await requireReferralAdmin(actorId);
  const { data: rows } = await dbx.from("referral_paper_attributions").select("paper_id, partner_id, share_percent, created_at").order("created_at", { ascending: false }).limit(60);
  const list = (rows ?? []) as Array<{ paper_id: string; partner_id: string; share_percent: number | string }>;
  const paperIds = [...new Set(list.map((r) => r.paper_id))].slice(0, 25);
  if (!paperIds.length) return [];
  const [{ data: papers }, names] = await Promise.all([
    db.from("papers").select("id, public_id, paperly_id, title").in("id", paperIds).is("deleted_at", null),
    partnerNames([...new Set(list.map((r) => r.partner_id))]),
  ]);
  const byPaper = new Map((papers ?? []).map((p) => [p.id, p]));
  return paperIds.flatMap((id) => {
    const p = byPaper.get(id);
    if (!p) return [];
    return [{ paperId: id, paperlyId: p.paperly_id ?? null, publicId: p.public_id, title: p.title,
      shares: list.filter((r) => r.paper_id === id).map((r) => ({ partnerName: names.get(r.partner_id) ?? "Unknown partner", sharePercent: Number(r.share_percent) })) }];
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Registered users: issue a link to a user and set its discount amount
// ---------------------------------------------------------------------------------------------------------------------------

export type UploaderRow = { userId: string; name: string; papers: number; shareMinor: number };
export type UserLink = {
  partnerId: string; partnerActive: boolean; linkId: string; code: string; url: string; discountMinor: number;
  signups: number; uploaders: UploaderRow[]; perUploaderMinor: number;
};
export type ReferralUserRow = {
  id: string; name: string | null; age: number | null; email: string; researcherId: string; joinedAt: string; detailsCompleted: boolean;
  referral: UserLink | null;
};
export type ReferralUsersPage = { rows: ReferralUserRow[]; total: number; page: number; pageSize: number };
export type UsersFilter = { q?: string | undefined; page: number };
export type UserReferralInput = { subjectId: string; discountMinor: number };
export type UserReferralResult = { url: string; discountMinor: number; created: boolean };

const USERS_PAGE = 15;
const isRealName = (n: string | null | undefined, email: string | null | undefined) => {
  const t = (n ?? "").trim().toLowerCase();
  return !!t && t !== "researcher" && t !== (email ?? "").split("@")[0]?.trim().toLowerCase();
};

/** Every registered person, newest first, with the link (if any) issued to them: its discount, who signed up and who uploaded through it. */
export async function adminListReferralUsers(actorId: string, f: UsersFilter, requestOrigin?: string): Promise<ReferralUsersPage> {
  await requireReferralAdmin(actorId);
  const origin = certificateSiteUrl(requestOrigin);
  const page = Math.max(1, Math.floor(f.page || 1));
  const q = (f.q ?? "").trim().slice(0, 80).replace(/[%,()*\\]/g, " ").trim();
  let query = dbx.from("profiles").select("id, email, display_name, age, researcher_id, created_at, details_completed", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * USERS_PAGE, page * USERS_PAGE - 1);
  if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) fail(error, "Could not load users");
  const users = (data ?? []) as Array<{ id: string; email: string | null; display_name: string | null; age: number | null; researcher_id: string; created_at: string; details_completed: boolean | null }>;
  const ids = users.map((u) => u.id);

  const partnersRes = ids.length ? await dbx.from("referral_partners").select("id, user_id, active").in("user_id", ids) : { data: [] as Array<{ id: string; user_id: string; active: boolean }> };
  const partners = (partnersRes.data ?? []) as Array<{ id: string; user_id: string; active: boolean }>;
  const pids = partners.map((p) => p.id);
  const [links, stats, ups] = pids.length ? await Promise.all([
    dbx.from("referral_links").select("id, partner_id, code, discount_minor").eq("active", true).in("partner_id", pids),
    dbx.rpc("referral_partner_stats"),
    dbx.rpc("referral_partner_uploaders"),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const linkBy = new Map<string, { id: string; code: string; discount: number }>(((links.data ?? []) as Array<{ id: string; partner_id: string; code: string; discount_minor: number | string | null }>).map((l) => [l.partner_id, { id: l.id, code: l.code, discount: Number(l.discount_minor ?? 0) }]));
  const signupsBy = new Map<string, number>(((stats.data ?? []) as Array<{ partner_id: string; registrations: number | string }>).map((s) => [s.partner_id, Number(s.registrations)]));
  const upRows = ((ups.data ?? []) as Array<{ partner_id: string; user_id: string; papers: number | string; first_upload: string }>).filter((r) => pids.includes(r.partner_id));
  const upIds = [...new Set(upRows.map((r) => r.user_id))];
  const nameRes = upIds.length ? await dbx.from("profiles").select("id, display_name, email").in("id", upIds) : { data: [] };
  const nameBy = new Map<string, string>(((nameRes.data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>).map((p) => [p.id, isRealName(p.display_name, p.email) ? (p.display_name as string) : (p.email ?? "Unnamed student")]));

  const rows: ReferralUserRow[] = users.map((u) => {
    const partner = partners.find((p) => p.user_id === u.id);
    const link = partner ? linkBy.get(partner.id) : undefined;
    let referral: UserLink | null = null;
    if (partner && link) {
      const mine = upRows.filter((r) => r.partner_id === partner.id).sort((a, b) => a.first_upload.localeCompare(b.first_upload));
      referral = {
        partnerId: partner.id, partnerActive: partner.active, linkId: link.id, code: link.code, url: referralUrl(origin, link.code), discountMinor: link.discount,
        signups: signupsBy.get(partner.id) ?? 0,
        uploaders: mine.map((r) => ({ userId: r.user_id, name: nameBy.get(r.user_id) ?? "Unnamed student", papers: Number(r.papers), shareMinor: link.discount })), // everyone referred gets the full amount off their own fee (once)
        perUploaderMinor: mine.length ? link.discount : 0,
      };
    }
    return { id: u.id, name: isRealName(u.display_name, u.email) ? (u.display_name as string) : null, age: u.age ?? null, email: u.email ?? "(no email)", researcherId: u.researcher_id, joinedAt: u.created_at, detailsCompleted: !!u.details_completed, referral };
  });
  return { rows, total: count ?? rows.length, page, pageSize: USERS_PAGE };
}

/** Issue (or update) the referral link of one registered user. The first call creates a private partner record and a random link; later calls only change the discount. */
export async function adminSetUserReferral(actorId: string, v: UserReferralInput, requestOrigin?: string): Promise<UserReferralResult> {
  await requireReferralAdmin(actorId);
  if (!Number.isInteger(v.discountMinor) || v.discountMinor < 0 || v.discountMinor > MAX_DISCOUNT_MINOR) throw new Error("Enter a discount between 0 and 10,00,000 rupees");
  const { data: prof } = await dbx.from("profiles").select("id, display_name, email, researcher_id").eq("id", v.subjectId).maybeSingle() as { data: { id: string; display_name: string | null; email: string | null; researcher_id: string } | null };
  if (!prof) throw new Error("User not found");
  const origin = certificateSiteUrl(requestOrigin);

  let partnerId: string | null = null;
  const existing = await dbx.from("referral_partners").select("id").eq("user_id", prof.id).maybeSingle();
  partnerId = (existing.data?.id as string | undefined) ?? null;
  if (!partnerId) {
    const label = `${isRealName(prof.display_name, prof.email) ? (prof.display_name as string).slice(0, 90) : "User"} · ${prof.researcher_id}`;
    const ins = await dbx.from("referral_partners").insert({ display_name: label, user_id: prof.id, created_by: actorId }).select("id").single();
    if (ins.error) {
      if (ins.error.code !== UNIQUE_VIOLATION) fail(ins.error, "Could not create the referral record");
      const again = await dbx.from("referral_partners").select("id").eq("user_id", prof.id).maybeSingle(); // a concurrent click made it first
      partnerId = (again.data?.id as string | undefined) ?? null;
      if (!partnerId) throw new Error("Could not create the referral record");
    } else partnerId = ins.data.id as string;
  }

  const live = await dbx.from("referral_links").select("id, code, discount_minor").eq("partner_id", partnerId).eq("active", true).maybeSingle();
  let linkId: string, code: string, created = false, before = 0;
  if (live.data) { linkId = live.data.id as string; code = live.data.code as string; before = Number(live.data.discount_minor ?? 0); }
  else {
    try { const l = await newLink(partnerId, actorId); linkId = l.id; code = l.code; created = true; }
    catch (e) {
      const raced = await dbx.from("referral_links").select("id, code, discount_minor").eq("partner_id", partnerId).eq("active", true).maybeSingle(); // one live link per partner: a concurrent click won
      if (!raced.data) throw e;
      linkId = raced.data.id as string; code = raced.data.code as string; before = Number(raced.data.discount_minor ?? 0);
    }
  }
  const upd = await dbx.from("referral_links").update({ discount_minor: v.discountMinor }).eq("id", linkId);
  if (upd.error) fail(upd.error, "Could not save the discount");
  await audit({ actor_id: actorId, action: created ? "referral_user_link_created" : "referral_user_discount_set", resource_type: "referral_partner", resource_id: partnerId,
    old_value: { discount_minor: before }, new_value: { discount_minor: v.discountMinor, link_id: linkId } });
  return { url: referralUrl(origin, code), discountMinor: v.discountMinor, created };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Link discount on the submission fee
//  * Called by the payment code on the server, for the signed-in person only. Nothing here is ever returned to a browser except through
//    adminListReferralDiscounts (administrators only). The person simply sees a lower fee; who referred them is never sent to them.
//  * A person is referred when they registered through a link, or submitted this paper through one. They get the discount of that
//    partner's current live link, once. Several links never add up: the best single one counts. A partner never gets a discount from their own link.
// ---------------------------------------------------------------------------------------------------------------------------
export type LinkDiscount = { partnerId: string; linkId: string | null; amountMinor: number };
const LIVE_PAYMENT = ["PAID", "PROCESSING", "REFUNDED", "PENDING"];

/** The discount this person gets on the fee of this paper, or null. Never throws: a problem here means "no discount", not a broken checkout. */
export async function referralDiscountFor(userId: string, paperId: string, feeMinor: number): Promise<LinkDiscount | null> {
  try {
    const touches = new Set<string>();
    const { data: reg } = await dbx.from("referral_user_attributions").select("partner_id").eq("user_id", userId).maybeSingle();
    if (reg?.partner_id) touches.add(reg.partner_id as string);
    const { data: papers } = await dbx.from("referral_paper_attributions").select("partner_id").eq("paper_id", paperId);
    for (const r of (papers ?? []) as Array<{ partner_id: string }>) touches.add(r.partner_id);
    if (!touches.size) return null;

    const candidates: LinkDiscount[] = [];
    for (const partnerId of touches) {
      const { data: partner } = await dbx.from("referral_partners").select("id, active, user_id").eq("id", partnerId).maybeSingle();
      if (!partner || partner.active !== true || partner.user_id === userId) continue;
      const { data: link } = await dbx.from("referral_links").select("id, discount_minor").eq("partner_id", partnerId).eq("active", true).maybeSingle();
      const amount = Number(link?.discount_minor ?? 0);
      if (link && amount > 0) candidates.push({ partnerId, linkId: link.id as string, amountMinor: amount });
    }
    const best = bestLinkDiscount(candidates);
    if (!best) return null;

    // Once per person: not when an earlier paper's fee already carries it (paid, awaiting verification, refunded, or still open).
    const { data: used } = await dbx.from("referral_discount_uses").select("payment_id").eq("user_id", userId);
    const ids = ((used ?? []) as Array<{ payment_id: string }>).map((u) => u.payment_id);
    if (ids.length) {
      const { data: pays } = await db.from("payments").select("id, paper_id, status").in("id", ids);
      const blocked = ((pays ?? []) as Array<{ paper_id: string | null; status: string }>).some((p) => (p.paper_id !== paperId && LIVE_PAYMENT.includes(p.status)) || (p.paper_id === paperId && ["PAID", "PROCESSING", "REFUNDED"].includes(p.status)));
      if (blocked) return null;
    }
    const applied = linkDiscountOnFee(feeMinor, best.amountMinor);
    return applied.discountMinor > 0 ? { ...best, amountMinor: applied.discountMinor } : null;
  } catch (e) {
    log("referral_discount_lookup_failed", { error: e instanceof Error ? e.message : "unknown" });
    return null;
  }
}

/** Marks a payment as carrying a link discount, for this person and this partner. Atomic per person (database lock), so two checkouts at the same moment cannot both get it.
 *  Returns false when the person already has the discount on another live fee; throws on a database failure. The caller cancels the order in both cases. */
export async function recordReferralDiscountUse(paymentId: string, userId: string, paperId: string, d: LinkDiscount): Promise<boolean> {
  const { data, error } = await dbx.rpc("referral_claim_discount", { p_payment_id: paymentId, p_user_id: userId, p_paper_id: paperId, p_partner_id: d.partnerId, p_link_id: d.linkId, p_amount: d.amountMinor });
  if (error) throw new Error(error.message);
  if (data !== true) return false;
  await audit({ actor_id: userId, action: "referral_discount_applied", resource_type: "payment", resource_id: paymentId, metadata: { partner_id: d.partnerId, link_id: d.linkId, amount_minor: d.amountMinor } });
  return true;
}

/** How much of a payment's discount came from a link (0 when none). Lets promo-code accounting exclude it. Never throws. */
export async function referralDiscountOnPayment(paymentId: string): Promise<number> {
  try {
    const { data } = await dbx.from("referral_discount_uses").select("amount_minor").eq("payment_id", paymentId).maybeSingle();
    return Number(data?.amount_minor ?? 0);
  } catch { return 0; }
}

export type DiscountUseRow = {
  paymentId: string; userId: string; name: string; email: string; partnerName: string; paperPublicId: string | null; paperTitle: string | null;
  discountMinor: number; originalMinor: number | null; paidMinor: number; status: string; currency: string; createdAt: string;
};
export type DiscountUsesPage = { rows: DiscountUseRow[]; total: number; totalGivenMinor: number; page: number; pageSize: number };

/** Every person who received a link discount: who they are (name and e-mail), whose link it came from, the paper, and the amounts. Administrators only. */
export async function adminListReferralDiscounts(actorId: string, page: number): Promise<DiscountUsesPage> {
  await requireReferralAdmin(actorId);
  const pageSize = 15;
  const from = (Math.max(1, page) - 1) * pageSize;
  const { data, count, error } = await dbx.from("referral_discount_uses").select("payment_id, user_id, paper_id, partner_id, amount_minor, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) fail(error, "Could not load the discounts");
  const uses = (data ?? []) as Array<{ payment_id: string; user_id: string; paper_id: string | null; partner_id: string; amount_minor: number; created_at: string }>;
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];
  const [profiles, partners, papers, pays] = await Promise.all([
    uses.length ? db.from("profiles").select("id, display_name, email").in("id", uniq(uses.map((u) => u.user_id))) : { data: [] },
    uses.length ? dbx.from("referral_partners").select("id, display_name").in("id", uniq(uses.map((u) => u.partner_id))) : { data: [] },
    uses.length ? db.from("papers").select("id, public_id, title").in("id", uniq(uses.map((u) => u.paper_id))) : { data: [] },
    uses.length ? db.from("payments").select("id, status, currency, amount_minor, original_amount_minor").in("id", uniq(uses.map((u) => u.payment_id))) : { data: [] },
  ]);
  const by = <T extends { id: string }>(r: { data: unknown }) => new Map(((r.data ?? []) as T[]).map((x) => [x.id, x]));
  const pr = by<{ id: string; display_name: string | null; email: string | null }>(profiles);
  const pt = by<{ id: string; display_name: string | null }>(partners);
  const pp = by<{ id: string; public_id: string; title: string }>(papers);
  const py = by<{ id: string; status: string; currency: string; amount_minor: number; original_amount_minor: number | null }>(pays);
  const sum = await dbx.from("referral_discount_uses").select("amount_minor, payment_id");
  const live = new Set(((await db.from("payments").select("id").in("status", ["PAID", "PROCESSING", "REFUNDED"]).in("id", ((sum.data ?? []) as Array<{ payment_id: string }>).map((x) => x.payment_id).slice(0, 1000))).data ?? []).map((x: { id: string }) => x.id));
  const totalGivenMinor = ((sum.data ?? []) as Array<{ amount_minor: number; payment_id: string }>).filter((x) => live.has(x.payment_id)).reduce((a, x) => a + Number(x.amount_minor), 0);
  const rows: DiscountUseRow[] = uses.map((u) => {
    const p = pr.get(u.user_id); const pay = py.get(u.payment_id); const paper = u.paper_id ? pp.get(u.paper_id) : undefined;
    return {
      paymentId: u.payment_id, userId: u.user_id, name: p?.display_name?.trim() || "—", email: p?.email ?? "—", partnerName: pt.get(u.partner_id)?.display_name ?? "—",
      paperPublicId: paper?.public_id ?? null, paperTitle: paper?.title ?? null, discountMinor: Number(u.amount_minor), originalMinor: pay?.original_amount_minor ?? null,
      paidMinor: Number(pay?.amount_minor ?? 0), status: pay?.status ?? "—", currency: pay?.currency ?? "INR", createdAt: u.created_at,
    };
  });
  return { rows, total: count ?? rows.length, totalGivenMinor, page: Math.max(1, page), pageSize };
}
