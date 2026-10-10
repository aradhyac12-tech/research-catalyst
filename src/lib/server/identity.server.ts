import { db, audit, requireRole, ADMINS } from "./core.server";

export async function publicIdentity() {
  const { data } = await db.from("journal_identity").select("*").eq("id", true).single();
  const d = data;
  const confirmed = !!d?.issn_confirmed_at;
  return {
    journal_title: d?.journal_title ?? "Paperly",
    publisher_name: d?.publisher_name ?? null,
    aims_scope: d?.aims_scope ?? null,
    publication_frequency: d?.publication_frequency ?? "Continuous publication",
    editorial_office_email: d?.editorial_office_email ?? null,
    editorial_office_address: d?.editorial_office_address ?? null,
    // An ISSN is public only when an administrator has confirmed it was officially assigned.
    issn: confirmed ? d?.issn ?? null : null,
    eissn: confirmed ? d?.eissn ?? null : null,
  };
}

export async function adminIdentity(uid: string) {
  await requireRole(uid, ADMINS);
  const { data } = await db.from("journal_identity").select("*").eq("id", true).single();
  return data;
}

export async function saveIdentity(uid: string, v: { journal_title: string; publisher_name?: string; aims_scope?: string; publication_frequency: string; editorial_office_email?: string; editorial_office_address?: string; issn?: string; eissn?: string; issn_officially_assigned?: boolean }) {
  await requireRole(uid, ADMINS);
  const hasIssn = !!(v.issn || v.eissn);
  if (hasIssn && !v.issn_officially_assigned) throw new Error("Tick the confirmation that this ISSN was officially assigned to the journal. Paperly never stores an unconfirmed ISSN.");
  const { data: before } = await db.from("journal_identity").select("issn, eissn, issn_confirmed_at").eq("id", true).single();
  const unchanged = before?.issn === (v.issn || null) && before?.eissn === (v.eissn || null);
  const patch = {
    journal_title: v.journal_title.trim(), publisher_name: v.publisher_name?.trim() || null, aims_scope: v.aims_scope?.trim() || null,
    publication_frequency: v.publication_frequency.trim(), editorial_office_email: v.editorial_office_email?.trim() || null,
    editorial_office_address: v.editorial_office_address?.trim() || null, issn: v.issn?.trim() || null, eissn: v.eissn?.trim() || null,
    issn_confirmed_at: hasIssn ? (unchanged && before?.issn_confirmed_at ? before.issn_confirmed_at : new Date().toISOString()) : null,
    issn_confirmed_by: hasIssn ? uid : null, updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("journal_identity").update(patch).eq("id", true);
  if (error) throw new Error(/check constraint/i.test(error.message) ? "That ISSN or email is not valid (ISSN check digit or format)" : error.message);
  await audit({ actor_id: uid, action: "journal_identity_updated", resource_type: "journal", resource_id: "identity", old_value: { issn: before?.issn ?? null, eissn: before?.eissn ?? null }, new_value: { issn: patch.issn, eissn: patch.eissn } });
}

// ---------------- editorial board ----------------
export async function publicBoard() {
  const { data } = await db.from("editorial_board_members").select("id, full_name, affiliation, country, credentials, orcid, role, biography")
    .eq("confirmed", true).order("display_order").order("full_name");
  return data ?? [];
}
export async function adminBoard(uid: string) {
  await requireRole(uid, ADMINS);
  const { data } = await db.from("editorial_board_members").select("*").order("display_order").order("full_name");
  return data ?? [];
}
export async function saveBoardMember(uid: string, m: { id?: string; full_name: string; affiliation: string; country?: string; credentials?: string; orcid?: string; role: "EDITOR_IN_CHIEF" | "ASSOCIATE_EDITOR" | "EDITORIAL_BOARD_MEMBER" | "ADVISORY_BOARD_MEMBER"; biography?: string; display_order?: number }) {
  await requireRole(uid, ADMINS);
  const row = { full_name: m.full_name.trim(), affiliation: m.affiliation.trim(), country: m.country?.trim() || null, credentials: m.credentials?.trim() || null, orcid: m.orcid?.trim() || null, role: m.role, biography: m.biography?.trim() || null, display_order: m.display_order ?? 100 };
  if (m.id) {
    const { error } = await db.from("editorial_board_members").update(row).eq("id", m.id);
    if (error) throw new Error(/orcid/i.test(error.message) ? "That ORCID iD is not valid (check digits)" : error.message);
    await audit({ actor_id: uid, action: "board_member_updated", resource_type: "board_member", resource_id: m.id });
    return { id: m.id };
  }
  // New entries are always unconfirmed: a person appears publicly only after explicit confirmation.
  const { data, error } = await db.from("editorial_board_members").insert({ ...row, created_by: uid, confirmed: false }).select("id").single();
  if (error || !data) throw new Error(/orcid/i.test(error?.message ?? "") ? "That ORCID iD is not valid (check digits)" : error?.message ?? "Could not save");
  await audit({ actor_id: uid, action: "board_member_added", resource_type: "board_member", resource_id: data.id });
  return { id: data.id };
}
export async function setBoardConfirmed(uid: string, id: string, confirmed: boolean) {
  await requireRole(uid, ADMINS);
  const { error } = await db.from("editorial_board_members").update(confirmed ? { confirmed: true, confirmed_by: uid, confirmed_at: new Date().toISOString() } : { confirmed: false, confirmed_by: null, confirmed_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
  await audit({ actor_id: uid, action: confirmed ? "board_member_confirmed" : "board_member_unconfirmed", resource_type: "board_member", resource_id: id });
}
export async function deleteBoardMember(uid: string, id: string) {
  await requireRole(uid, ADMINS);
  const { error } = await db.from("editorial_board_members").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await audit({ actor_id: uid, action: "board_member_removed", resource_type: "board_member", resource_id: id });
}

// ---------------- audit viewer (administrators only) ----------------
export async function auditPage(uid: string, f: { action?: string; resource?: string; page: number }) {
  await requireRole(uid, ADMINS);
  const PAGE = 50;
  let q = db.from("audit_logs").select("id, created_at, actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata", { count: "exact" }).order("id", { ascending: false }).range((f.page - 1) * PAGE, f.page * PAGE - 1);
  if (f.action?.trim()) q = q.ilike("action", `%${f.action.trim().replace(/[%_]/g, "")}%`);
  if (f.resource?.trim()) {
    let rid = f.resource.trim();
    // A Paperly ID (PLY-...) is resolved to the internal paper id that audit rows use.
    if (/^PLY-\d{4}-\d{6}$/.test(rid)) { const { data: p } = await db.from("papers").select("id").eq("paperly_id", rid).maybeSingle(); rid = p?.id ?? rid; }
    q = q.eq("resource_id", rid);
  }
  const { data, count } = await q;
  return { rows: data ?? [], total: count ?? 0, page: f.page, pageSize: PAGE };
}

// ---------------- public fees ----------------
export async function publicFees() {
  const { data: product } = await db.from("products").select("id, name, description, refund_policy, required_for_publication").eq("code", "PUBLICATION_PROCESSING").single();
  const { data: prices } = product ? await db.from("product_prices").select("currency, amount_minor").eq("product_id", product.id).eq("active", true) : { data: [] };
  const { availableMethods } = await import("./payments.server");
  const m = await availableMethods();
  // Only currencies that a configured payment method can actually charge are shown as payable.
  const payable = new Set<string>([...(m.RAZORPAY ? ["INR"] : [])]);
  return { product, prices: (prices ?? []).map((p) => ({ ...p, payable: payable.has(p.currency) })), paymentsOpen: payable.size > 0 };
}
