import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readFileField } from "@/lib/staged-file";
import type { CombinedMeter } from "@/lib/domain/ai-meter";
import { orcidChecksumOk } from "@/lib/domain/orcid";
import { KEYWORDS_MAX_COUNT, KEYWORD_MAX_LENGTH } from "@/lib/domain/keywords";
import { DEIDENTIFICATION, INFORMED_CONSENT, PUBLICATION_CONSENT, WAIVER, COMMITTEE_APPROVAL, TRIAL_REG_STATUS } from "@/lib/domain/ethics-policy";
import { AI_USE_CODES, CREDIT_CODES, LEGACY_ID_RE, PAPERLY_ID_RE, looksLikeAiAuthor } from "@/lib/domain/scholarly";
import { formatTitle } from "@/lib/title-case";

type CitationCheck = { checked: number; invalid: number; details: string[] };
type SimilarityCheck = { max_percentage: number; risk: string; duplicate_file: boolean };

const origin = () => { try { return new URL(getRequest().url).origin; } catch { return process.env["PUBLIC_SITE_URL"] ?? ""; } };
const core = () => import("@/lib/server/core.server");
const pay = () => import("@/lib/server/payments.server");
const pipe = () => import("@/lib/server/pipeline.server");
const reconcileSeen = new Map<string, number>();
const referrals = () => import("@/lib/server/referrals.server");
/** The visitor's cookies, for the referral cookie only. Referral recording is best effort and must never affect registration or a submission. */
const cookieHeader = () => { try { return getRequest().headers.get("cookie"); } catch { return null; } };

// ---------- profile / roles ----------
export const getMe = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { db, getRoles, audit } = await core();
  const uid = context.userId;
  let { data: profile } = await db.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (!profile) {
    const email = (context.claims as { email?: string }).email ?? null;
    // The sign-up form (or Google) may have supplied a name and an age. Both are checked again here; anything missing or invalid
    // leaves the profile incomplete, and the person sees the details pop-up until they give both.
    const meta = (context.claims as { user_metadata?: Record<string, unknown> }).user_metadata ?? {};
    const { cleanPersonName, cleanAge } = await import("@/lib/domain/referrals");
    const typedName = cleanPersonName(meta["full_name"] ?? meta["name"], email); const typedAge = cleanAge(meta["age"]);
    const ins = await db.from("profiles").insert({ id: uid, email, display_name: typedName ?? email?.split("@")[0] ?? "Researcher", age: typedAge, details_completed: !!(typedName && typedAge) }).select("*").single();
    profile = ins.data;
    await db.from("user_roles").insert({ user_id: uid, role: "researcher" });
    // Signup NEVER grants elevated roles. The first administrator is created only through claimBootstrapAdmin (token-gated).
    const roles: Array<"researcher"> = ["researcher"];
    await audit({ actor_id: uid, action: "user_registered", resource_type: "user", resource_id: uid, metadata: { roles } });
    // Registered through a partner's link? Remembered privately (admin-only); recordRegistrationReferral never throws.
    try { await (await referrals()).recordRegistrationReferral(uid, cookieHeader()); } catch { /* never blocks sign-up */ }
  }
  const roles0 = await getRoles(uid);
  // A founder with dues pending loses the founder role everywhere the app looks at roles (menus, prefetches, pages) and carries a flag
  // instead, so the only founder screen they reach is the "clear your dues" one. Administrators are never held.
  const hold = await (await core()).founderHoldState(uid, roles0);
  // Dues for the "please pay" prompt. Best effort: a failure here never blocks the app (the hold above already fails closed).
  const dues = await (await pay()).myDues(uid).catch(() => ({ items: [], hold: null }));
  return { profile, roles: hold.onHold ? roles0.filter((r) => r !== "founder") : roles0, duesHold: hold.onHold, dues };
});

/** One-time, token-gated creation of the first super_admin. Refuses once any administrator exists. */
export const claimBootstrapAdmin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ token: z.string().min(1).max(256) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, audit } = await core();
    const { attemptBootstrap } = await import("@/lib/domain/bootstrap");
    const uid = context.userId;
    const callerEmail = (context.claims as { email?: string }).email ?? null;
    const res = await attemptBootstrap(data.token, {
      expectedToken: process.env["ADMIN_BOOTSTRAP_TOKEN"], allowedEmail: process.env["ADMIN_BOOTSTRAP_EMAIL"], callerEmail,
      claim: async () => { const { data: ok, error } = await db.rpc("claim_bootstrap_admin", { _uid: uid }); if (error) throw new Error("Bootstrap failed"); return ok === true; },
    });
    await audit({ actor_id: uid, action: res.ok ? "bootstrap_admin_claimed" : "bootstrap_admin_refused", resource_type: "user", resource_id: uid, metadata: res.ok ? {} : { reason: res.reason } });
    // Deliberately uniform message: do not reveal whether the token, e-mail or state was the cause.
    if (!res.ok) throw new Error("Bootstrap refused");
    return { ok: true };
  });

/** Name and age are compulsory. The pop-up calls this; only the server can mark an account as completed. */
export const completeProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ display_name: z.string().max(200), age: z.number().int().min(10).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, audit } = await core();
    const { cleanPersonName, cleanAge } = await import("@/lib/domain/referrals");
    const { data: prof } = await db.from("profiles").select("email").eq("id", context.userId).maybeSingle();
    const name = cleanPersonName(data.display_name, prof?.email ?? null); const age = cleanAge(data.age);
    if (!name) throw new Error("Enter your full name (at least 2 letters)");
    if (!age) throw new Error("Enter your age as a whole number between 10 and 100");
    const { error } = await db.from("profiles").update({ display_name: name, age, details_completed: true }).eq("id", context.userId);
    if (error) throw new Error("Could not save your details. Try again.");
    await audit({ actor_id: context.userId, action: "profile_details_completed", resource_type: "user", resource_id: context.userId, metadata: {} });
    return { ok: true };
  });

export const updateProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ display_name: z.string().trim().min(2).max(120), institution: z.string().max(200).optional(), country: z.string().max(80).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").update({ display_name: data.display_name, institution: data.institution ?? null, country: data.country ?? null }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- submission ----------
export const submissionSchema = z.object({
  title: z.string().trim().min(5).max(400).transform((t) => formatTitle(t)),
  abstract: z.string().trim().min(50).max(5000),
  keywords: z.array(z.string().trim().min(1).max(KEYWORD_MAX_LENGTH, `Each keyword must be ${KEYWORD_MAX_LENGTH} characters or fewer; separate keywords with commas.`)).min(1, "Add at least one keyword.").max(KEYWORDS_MAX_COUNT, `Use at most ${KEYWORDS_MAX_COUNT} keywords.`),
  article_type: z.string().min(2).max(80),
  field: z.string().min(2).max(120),
  license: z.enum(["CC-BY", "CC-BY-NC", "CC-BY-NC-ND", "ALL-RIGHTS-RESERVED"]),
  copyright_holder: z.string().trim().min(2).max(300),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).default("en"),
  references: z.string().max(60000).default(""),
  authors: z.array(z.object({
    full_name: z.string().trim().min(2).max(160).refine((n) => !looksLikeAiAuthor(n), "An AI system cannot be listed as an author. Describe AI use in the AI disclosure instead."),
    email: z.string().email().max(254).or(z.literal("")).optional(), affiliation: z.string().max(200).optional(),
    orcid: z.string().max(19).refine((o) => o === "" || orcidChecksumOk(o), "Not a valid ORCID iD (check digits do not match)").optional(),
    is_corresponding: z.boolean(), roles: z.array(z.enum(CREDIT_CODES)).max(14).default([]),
  })).min(1).max(30),
  funders: z.array(z.object({ funder_name: z.string().trim().min(2).max(300), grant_number: z.string().trim().max(100).optional() })).max(20).default([]),
  ai_disclosures: z.array(z.object({ category: z.enum(AI_USE_CODES), tool_name: z.string().trim().min(2).max(120), tool_version: z.string().trim().max(60).optional(), purpose: z.string().trim().min(3).max(500), extent: z.string().trim().min(3).max(500), human_verification: z.string().trim().min(10).max(1000) })).max(12).default([]),
  rights: z.object({ is_author: z.boolean(), coauthor_permission: z.boolean(), has_upload_rights: z.boolean(), previously_published: z.boolean(), previous_doi: z.string().max(200).optional(), previous_publication_reference: z.string().max(400).optional(), manuscript_version_type: z.enum(["PREPRINT", "ACCEPTED_MANUSCRIPT", "PUBLISHER_VERSION", "ORIGINAL_SUBMISSION"]), third_party_content: z.boolean(), third_party_permission: z.boolean().optional(), ai_processing_consent: z.literal(true) }),
  ethics: z.object({ human_participants: z.boolean(), animal_subjects: z.boolean(), clinical_trial: z.boolean(), ethics_approval: z.boolean(), ethics_committee: z.string().max(200).optional(), approval_number: z.string().max(100).optional(), ethics_exempt: z.boolean(), exemption_reason: z.string().max(500).optional(), informed_consent: z.boolean(), trial_registry: z.string().max(100).optional(), trial_registration_number: z.string().max(100).optional(), animal_protocol: z.string().max(200).optional(), conflict_of_interest: z.string().trim().max(2000).default(""), funding: z.string().trim().max(2000).default(""), data_availability: z.string().trim().max(2000).default(""), ai_tools_used: z.string().max(1000).optional(), ai_none_used: z.boolean().optional(), secondary_data_only: z.boolean().optional(),
    subject: z.object({ human_participants: z.boolean(), identifiable_info_present: z.boolean(), deidentification_status: z.enum(DEIDENTIFICATION), informed_consent_status: z.enum(INFORMED_CONSENT), publication_consent_status: z.enum(PUBLICATION_CONSENT), waiver_status: z.enum(WAIVER), committee_approval_status: z.enum(COMMITTEE_APPROVAL), approval_reference: z.string().max(200).optional(), privacy_sensitive_media: z.boolean() }).optional(),
    trial: z.object({ registration_status: z.enum(TRIAL_REG_STATUS), registry_name: z.string().max(100).optional(), registration_number: z.string().max(100).optional(), registration_url: z.string().max(500).optional(), registration_date: z.string().max(10).optional() }).optional() }),
});

/** Suggests an abstract, keywords and a reference list from the uploaded manuscript (founder/admin only; references are only ever copied from the file). */
export const suggestMetadata = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("Expected form data");
    const file = readFileField(d, "file");
    if (!file) throw new Error("Choose your manuscript file first");
    return { file, consent: d.get("ai_consent") === "true" };
  })
  .handler(async ({ data, context }) => {
    const { resolveFile } = await import("@/lib/server/staged-upload.server");
    return (await import("@/lib/server/suggest.server")).suggestFromFile(context.userId, await resolveFile(context.userId, data.file, true), data.consent);
  });

export const submitPaper = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("Expected form data");
    const file = readFileField(d, "file");
    if (!file) throw new Error("Attach your manuscript as a PDF");
    const anon = readFileField(d, "anonymized_file");
    const key = d.get("idempotency_key");
    return { meta: submissionSchema.parse(JSON.parse(String(d.get("meta")))), file, anonymized: anon ?? undefined, idempotencyKey: typeof key === "string" ? key : undefined };
  })
  // Phase 6: validation, rights/ethics policy, idempotency, one atomic database commit and storage compensation live in
  // server/submission.server.ts + domain/submission-saga.ts. This handler only authenticates and delegates.
  .handler(async ({ data, context }) => {
    await (await import("@/lib/server/maintenance.server")).assertSiteOpen(context.userId);
    const { db } = await core();
    const { submitPaperServer } = await import("@/lib/server/submission.server");
    const { resolveFile } = await import("@/lib/server/staged-upload.server");
    const file = await resolveFile(context.userId, data.file);
    const anonymized = data.anonymized ? await resolveFile(context.userId, data.anonymized) : undefined;
    const res = await submitPaperServer(context.userId, data.meta as never, file, anonymized, data.idempotencyKey);
    // The submission is committed. Credit the referral source (idempotent; a replay or an admin's split is left alone).
    try { await (await referrals()).recordSubmissionReferral(context.userId, res.id, cookieHeader()); } catch { /* never affects the submission */ }
    const { data: p } = await db.from("papers").select("public_id").eq("id", res.id).single();
    // Screening (PDF text, Crossref, AI) can take a minute, so it is started by a separate call.
    return { id: res.id, publicId: p?.public_id ?? "", replayed: res.replayed };
  });

/** Starts screening for a freshly submitted paper. Safe to call twice: only the first call finds it SUBMITTED. */
export const startScreening = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: p } = await db.from("papers").select("owner_id, status").eq("id", data.id).single();
    if (p?.owner_id !== context.userId) throw new Error("Not found");
    if (p.status !== "SUBMITTED") return { skipped: true as const, status: String(p.status) };
    if (!(await (await pay()).feeCleared(data.id))) return { skipped: true as const, status: "PAYMENT_REQUIRED" };
    const { runScreening } = await pipe();
    try { await runScreening(data.id, context.userId, origin()); return { skipped: false as const, status: "DONE" }; }
    catch (e) {
      // Losing the race to another start call shows up as an illegal transition; that is not an error for the author.
      if (e instanceof Error && /Illegal paper transition/.test(e.message)) return { skipped: true as const, status: "PROCESSING" };
      throw e;
    }
  });

export const retryScreening = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: p } = await db.from("papers").select("owner_id").eq("id", data.id).single();
    if (p?.owner_id !== context.userId) throw new Error("Not found");
    const { runScreening, reapStaleScreeningRuns } = await pipe();
    // A run that was abandoned (process stopped, request timed out) would otherwise block the retry forever.
    await reapStaleScreeningRuns(data.id);
    const { data: last } = await db.from("ai_runs").select("status").eq("paper_id", data.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last && last.status === "RUNNING") throw new Error("Screening is still running. Please wait a moment and check again.");
    if (last && last.status !== "FAILED") throw new Error("Screening can only be retried after a failed run");
    return runScreening(data.id, context.userId, origin());
  });

// ---------- my research ----------
export const listMyPapers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.from("papers").select("id, public_id, title, status, article_type, created_at, published_at").eq("owner_id", context.userId).is("deleted_at", null).order("created_at", { ascending: false });
  const rows = data ?? [];
  // Uploaded but not yet paid: the list shows "Awaiting payment" instead of "Submitted".
  const submitted = rows.filter((p) => p.status === "SUBMITTED").map((p) => p.id);
  if (!submitted.length) return rows.map((p) => ({ ...p, awaitingPayment: false }));
  const { db } = await core();
  const { data: paid } = await db.from("payments").select("paper_id").in("paper_id", submitted).eq("status", "PAID");
  const paidIds = new Set((paid ?? []).map((r) => r.paper_id));
  const waived = await (await import("@/lib/server/fee-waiver.server")).isFeeWaived(context.userId);
  return rows.map((p) => ({ ...p, awaitingPayment: p.status === "SUBMITTED" && !waived && !paidIds.has(p.id) }));
});

export const getMyPaper = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: paper } = await db.from("papers").select("*").eq("id", data.id).is("deleted_at", null).single();
    if (!paper || paper.owner_id !== context.userId) throw new Error("Not found");
    const { data: lastRun } = await db.from("ai_runs").select("id, status, deterministic_signals, completed_at").eq("paper_id", data.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    const { data: findings } = lastRun ? await db.from("ai_findings").select("check_key, status, severity, message").eq("ai_run_id", lastRun.id) : { data: [] };
    const sig = (lastRun?.deterministic_signals ?? {}) as Record<string, unknown>;
    const screening = lastRun ? { status: lastRun.status, aiMeter: (sig["ai_meter"] ?? null) as CombinedMeter | null, citations: (sig["citations"] ?? null) as CitationCheck | null, findings: findings ?? [] } : null;
    // Self-heal: a payment made at Razorpay whose webhook never arrived is settled here when the author (or an editor's link) opens the paper. Throttled per paper.
    if (["SUBMITTED", "ACCEPTED", "PAYMENT_PENDING"].includes(paper.status) && Date.now() - (reconcileSeen.get(data.id) ?? 0) > 20_000) {
      reconcileSeen.set(data.id, Date.now());
      try { await (await pay()).reconcileRazorpayPending(origin(), { paperId: data.id, limit: 3 }); } catch { /* the page still loads; the sweep and admin button retry */ }
    }
    const [decisions, payments, authors, doi] = await Promise.all([
      db.from("decisions").select("id, source, outcome, policy_key, policy_version, reasons, created_at, is_override").eq("paper_id", data.id).order("created_at", { ascending: false }),
      db.from("payments").select("order_id, amount_minor, currency, method, status, created_at, completed_at").eq("paper_id", data.id).order("created_at", { ascending: false }),
      db.from("paper_authors").select("full_name, affiliation, is_corresponding").eq("paper_id", data.id).order("position"),
      db.from("doi_records").select("status, doi, last_error").eq("paper_id", data.id).maybeSingle(),
    ]);
    const { availableMethods, priceFor } = await pay();
    const methods = await availableMethods();
    let price: { amountMinor: number; currency: string } | null = null;
    try { price = await priceFor("INR"); } catch { /* no price */ }
    const off = price ? await (await pay()).checkoutDiscount(context.userId, data.id).catch(() => null) : null;
    const { search: _search, ...paperOut } = paper;
    void _search;
    const feeWaived = await (await import("@/lib/server/fee-waiver.server")).isFeeWaived(context.userId);
    const feePaid = feeWaived || (payments.data ?? []).some((p) => p.status === "PAID" || p.status === "REFUNDED");
    return { paper: paperOut, screening, decisions: decisions.data ?? [], authors: authors.data ?? [], doi: doi.data, methods, price: price ? { ...price, discountMinor: off?.discountMinor ?? 0 } : price, feePaid };
  });

// ---------- payments ----------
export const startPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), method: z.enum(["RAZORPAY", "TEST"]), promoCode: z.string().trim().max(40).optional() }).parse(d))
  .handler(async ({ data, context }) => { await (await import("@/lib/server/maintenance.server")).assertSiteOpen(context.userId); return (await pay()).startPublicationPayment(context.userId, data.paperId, data.method, data.promoCode); });

export const getMyDues = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await pay()).myDues(context.userId));

export const startDuesPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ deferralId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await pay()).startDuesPayment(context.userId, data.deferralId));

export const previewPromoCode = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ code: z.string().trim().min(1).max(40), paperId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => (await pay()).previewPromo(context.userId, data.code, "INR", data.paperId ?? null));

export const getCheckoutDiscount = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await pay()).checkoutDiscount(context.userId, data.paperId));

export const adminListFailedRefunds = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requirePermission } = await core();
  await requirePermission(context.userId, "PAYMENT_MANAGE");
  return (await pay()).adminListFailedRefunds();
});

/** Asks Razorpay about every open Razorpay payment and records the ones that were paid but never reached us. Payment staff only. */
export const adminReconcilePayments = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requirePermission, audit } = await core();
  await requirePermission(context.userId, "PAYMENT_MANAGE");
  const r = await (await pay()).reconcileRazorpayPending(origin(), { limit: 30 });
  await audit({ actor_id: context.userId, action: "payments_reconcile_run", resource_type: "payment", metadata: { checked: r.checked, settled: r.settled } });
  return r;
});

/** A SUBMITTED paper that is not in the editor's hands yet. "check": ask Razorpay whether it was paid, then start screening if the fee is settled (any editor).
 *  "bypass": an administrator lets it into editorial screening without the fee (reason required, audit-logged). The fee is still collected: an accepted paper
 *  that has not paid stays ACCEPTED and cannot be published until the author pays. */
export const adminStartScreeningNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), mode: z.enum(["check", "bypass"]), reason: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, requireRole, STAFF, ADMINS, audit } = await core();
    await requireRole(context.userId, data.mode === "bypass" ? ADMINS : STAFF);
    const { data: p } = await db.from("papers").select("id, status, public_id").eq("id", data.paperId).is("deleted_at", null).maybeSingle();
    if (!p) throw new Error("Paper not found");
    if (p.status !== "SUBMITTED") return { started: false as const, status: String(p.status), message: "This paper is already past submission." };
    if (data.mode === "bypass") {
      if ((data.reason ?? "").length < 10) throw new Error("Give a reason of at least 10 characters");
      await audit({ actor_id: context.userId, action: "fee_bypassed_for_screening", resource_type: "paper", resource_id: p.id, metadata: { reason: data.reason } });
      await (await pipe()).runScreening(p.id, context.userId, origin(), { bypassFee: true });
      return { started: true as const, status: "REVIEW_REQUIRED", message: "Sent to editorial screening. The fee is still due before publication." };
    }
    const payments = await pay();
    await payments.reconcileRazorpayPending(origin(), { paperId: p.id, limit: 3 }).catch(() => null);
    if (!(await payments.feeCleared(p.id))) return { started: false as const, status: "SUBMITTED", message: "Razorpay shows no completed payment for this paper yet." };
    await (await pipe()).runScreening(p.id, context.userId, origin());
    return { started: true as const, status: "REVIEW_REQUIRED", message: "Payment found. Screening started." };
  });

/** Choose which payments the founder can see. Administrators only. Unsharing also drops the amount shown to the founder. */
export const adminShareWithFounder = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paymentIds: z.array(z.string().uuid()).min(1).max(100), shared: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, dbx, requireRole, ADMINS, audit } = await core();
    // The role check and the payment lookup do not depend on each other, so they run together; the write is one call, not read-then-insert.
    const [, { data: found }] = await Promise.all([requireRole(context.userId, ADMINS), db.from("payments").select("id").in("id", data.paymentIds).eq("is_test", false)]);
    const ids = (found ?? []).map((p) => p.id);
    if (!ids.length) throw new Error("No matching payments");
    if (data.shared) {
      const { error } = await dbx.from("founder_shared_payments").upsert(ids.map((payment_id) => ({ payment_id, shared_by: context.userId })), { onConflict: "payment_id", ignoreDuplicates: true });
      if (error) throw new Error("Could not share");
    } else {
      const { error } = await dbx.from("founder_shared_payments").delete().in("payment_id", ids);
      if (error) throw new Error("Could not stop sharing");
    }
    await audit({ actor_id: context.userId, action: data.shared ? "payments_shared_with_founder" : "payments_unshared_from_founder", resource_type: "payment", metadata: { count: ids.length, payment_ids: ids } });
    return { changed: ids.length };
  });

/** Set (or clear, with null) the amount the founder sees for a shared payment. The real payment is never changed. Administrators only. */
export const adminSetFounderAmount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paymentId: z.string().uuid(), amountMinor: z.number().int().min(0).max(100_000_000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { dbx, requireRole, ADMINS, audit } = await core();
    const [, { data: row }] = await Promise.all([requireRole(context.userId, ADMINS), dbx.from("founder_shared_payments").select("payment_id, shown_amount_minor").eq("payment_id", data.paymentId).maybeSingle()]);
    if (!row) throw new Error("Share this payment with the founder first");
    const { error } = await dbx.from("founder_shared_payments").update({ shown_amount_minor: data.amountMinor, amount_set_by: context.userId, amount_set_at: new Date().toISOString() }).eq("payment_id", data.paymentId);
    if (error) throw new Error("Could not save the amount");
    await audit({ actor_id: context.userId, action: "founder_amount_set", resource_type: "payment", resource_id: data.paymentId, old_value: { shown_amount_minor: row.shown_amount_minor }, new_value: { shown_amount_minor: data.amountMinor } });
    return { ok: true as const };
  });

export const adminRetryRefund = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    return (await pay()).adminRetryRefund(context.userId, data.paperId, origin());
  });

export const adminListPromoCodes = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requirePermission } = await core();
  await requirePermission(context.userId, "PAYMENT_MANAGE");
  return (await pay()).adminListPromos();
});

export const adminCreatePromoCode = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    code: z.string().trim().min(3).max(32),
    amountOffMinor: z.number().int().positive().max(100_000_000),
    maxRedemptions: z.number().int().positive().max(1_000_000).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    return (await pay()).adminCreatePromo(context.userId, data);
  });

export const adminSetPromoCodeActive = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    await (await pay()).adminSetPromoActive(context.userId, data.id, data.active);
    return { ok: true };
  });

/** The publication fee per currency, for the admin panel. */
export const adminGetPublicationFees = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requirePermission } = await core();
  await requirePermission(context.userId, "PAYMENT_MANAGE");
  return (await pay()).adminGetFees();
});

/** Changes the publication fee. Takes effect for payments started from now on and is written to the audit log. */
export const adminSetPublicationFee = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ currency: z.string().trim().regex(/^[A-Z]{3}$/), amountMinor: z.number().int().min(100).max(100_000_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requirePermission } = await core();
    await requirePermission(context.userId, "PAYMENT_MANAGE");
    return (await pay()).adminSetFee(context.userId, data.currency, data.amountMinor);
  });

export const confirmRazorpay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().min(5).max(60), paymentId: z.string().min(5).max(60), signature: z.string().min(10).max(200) }).parse(d))
  .handler(async ({ data, context }) => (await pay()).confirmRazorpayCheckout(context.userId, data, origin()));

export const getTestOrder = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().min(5).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: p } = await db.from("payments").select("order_id, amount_minor, currency, status, paper_id, user_id, method").eq("order_id", data.orderId).single();
    if (!p || p.user_id !== context.userId || p.method !== "TEST") throw new Error("Not found");
    return { orderId: p.order_id, amountMinor: p.amount_minor, currency: p.currency, status: p.status, paperId: p.paper_id };
  });

export const simulatePayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().min(5).max(60), outcome: z.enum(["payment.succeeded", "payment.failed"]) }).parse(d))
  .handler(async ({ data, context }) => (await pay()).simulateTestPayment(context.userId, data.orderId, data.outcome, origin()));

// ---------- admin test mode ----------
async function requireTestAdmin(userId: string) {
  const { requirePermission } = await core();
  await requirePermission(userId, "SYSTEM_ADMIN");
  const p = await pay();
  if (!p.adminTestToolsEnabled()) throw new Error("Test tools are switched off");
  return p;
}

export const adminTestOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const p = await requireTestAdmin(context.userId);
  return { papers: await p.adminTestCandidates() };
});

export const adminTestPaywall = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), promoCode: z.string().trim().max(40).optional() }).parse(d))
  .handler(async ({ data, context }) => (await requireTestAdmin(context.userId)).adminTestPaywall(data.paperId, data.promoCode));

export const adminTestPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), promoCode: z.string().trim().max(40).optional() }).parse(d))
  .handler(async ({ data, context }) => (await requireTestAdmin(context.userId)).adminRunTestPayment(context.userId, data.paperId, origin(), data.promoCode));

export const adminTestPublish = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), promoCode: z.string().trim().max(40).optional() }).parse(d))
  .handler(async ({ data, context }) => (await requireTestAdmin(context.userId)).adminRunTestPublish(context.userId, data.paperId, origin(), data.promoCode));

/** Add a payment the admin received outside the checkout (cash, bank or UPI transfer, paywall paid directly). Needs PAYMENT_MANAGE. */
export const adminRecordPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    payerEmail: z.string().trim().email().max(200), amount: z.number().positive().max(1_000_000), currency: z.enum(["INR", "USD", "KGS"]),
    reference: z.string().trim().max(80).optional(), note: z.string().trim().max(300).optional(),
    paperPublicId: z.string().trim().max(40).optional(), receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await (await core()).requirePermission(context.userId, "PAYMENT_MANAGE");
    return (await pay()).adminRecordManualPayment(context.userId, data);
  });

export const adminTestPayments = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await requireTestAdmin(context.userId)).adminListTestPayments());

export const adminTestCertificate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await requireTestAdmin(context.userId)).adminRunTestCertificate(context.userId, data.paperId, origin()));

// ---------- certificates ----------
export const listMyCertificates = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.from("certificates").select("certificate_id, paper_id, recipient_name_at_issue, certificate_type, author_role, orcid_at_issue, paper_title_at_issue, article_public_id, doi_at_issue, publication_date, status, issued_at, verification_token").eq("recipient_user_id", context.userId).eq("on_hold", false).order("issued_at", { ascending: false });
  if (error) throw new Error("Certificates could not be loaded");
  // Record facts printed on a publication certificate ("peer reviewed" only when completed reviews are recorded). Reviewer certificates get none.
  const facts = new Map<string, { recordType: string; reviewStatement: string }>();
  try {
    const ids = [...new Set((data ?? []).filter(c => c.certificate_type === "PUBLICATION").map(c => c.paper_id))];
    if (ids.length) {
      const { db } = await core();
      const { describeRecord } = await import("@/lib/domain/certificate-pdf");
      const { data: recs } = await db.from("papers").select("id, publication_type, peer_reviewed, status, review_waived").in("id", ids);
      for (const r of recs ?? []) { const f = describeRecord(r.publication_type, r.peer_reviewed, r.status, !!r.review_waived); facts.set(r.id, { recordType: f.recordType, reviewStatement: f.reviewStatement }); }
    }
  } catch { /* the certificate list still loads without the record facts */ }
  return (data ?? []).map(c => ({ ...c, ...(c.certificate_type === "PUBLICATION" ? facts.get(c.paper_id) : undefined), verificationUrl: `${(process.env["PUBLIC_SITE_URL"] || origin() || "https://paperlys.lovable.app").replace(/\/+$/, "")}/verify/certificate/${c.certificate_id}?t=${c.verification_token}` }));
});

/** Signed, short-lived link to the stored PDF. Renders and stores the PDF first if it has not been generated yet. */
async function certificateFileUrl(certUuid: string, storagePath: string | null, certificateId: string) {
  const { db } = await core();
  let path = storagePath;
  if (!path) {
    await (await pipe()).generateCertificateDocument(certUuid, origin());
    path = (await db.from("certificates").select("storage_path").eq("id", certUuid).single()).data?.storage_path ?? null;
  }
  if (!path) throw new Error("Certificate file is not ready yet");
  const s = await db.storage.from("certificates").createSignedUrl(path, 300, { download: `${certificateId}.pdf` });
  if (s.error) throw new Error("Certificate download could not be prepared");
  return { url: s.data?.signedUrl ?? null };
}

export const certificateDownload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ certificateId: z.string().min(5).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: c } = await db.from("certificates").select("id, recipient_user_id, storage_path, on_hold").eq("certificate_id", data.certificateId).single();
    if (!c || c.recipient_user_id !== context.userId || c.on_hold) throw new Error("Not available");
    return certificateFileUrl(c.id, c.storage_path, data.certificateId);
  });

/** Download from the public verification page. Possession of the certificate's own verification code (the QR / link token) is the credential. */
export const certificateDownloadPublic = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ certificateId: z.string().min(5).max(40), token: z.string().min(16).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await core();
    const { data: c } = await db.from("certificates").select("id, storage_path, verification_token, on_hold").eq("certificate_id", data.certificateId).maybeSingle();
    const a = c?.verification_token ?? "", b = data.token;
    let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    if (!c || diff !== 0 || c.on_hold) throw new Error("Not available");
    return certificateFileUrl(c.id, c.storage_path, data.certificateId);
  });

// ---------- public ----------
export const explorePapers = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({
    q: z.string().max(200).optional(),
    type: z.enum(["REPOSITORY_RECORD", "PREPRINT", "JOURNAL_ARTICLE"]).optional(),
    field: z.string().max(120).optional(),
    year: z.number().int().min(1990).max(2200).optional(),
    peerReviewed: z.boolean().optional(),
    sort: z.enum(["newest", "oldest", "relevance"]).optional(),
    page: z.number().int().min(1).max(500).optional(),
  }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { db } = await core();
    const PAGE = 20; const page = data.page ?? 1;
    let q = db.from("papers").select("public_id, paperly_id, publication_type, title, abstract, keywords, article_type, field, published_at, status, doi, peer_reviewed", { count: "exact" })
      .in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).is("deleted_at", null);
    if (data.type) q = q.eq("publication_type", data.type);
    if (data.field?.trim()) q = q.eq("field", data.field.trim());
    if (data.peerReviewed) q = q.eq("peer_reviewed", true);
    if (data.year) q = q.gte("published_at", `${data.year}-01-01T00:00:00Z`).lt("published_at", `${data.year + 1}-01-01T00:00:00Z`);
    if (data.q?.trim()) q = q.textSearch("search", data.q.trim(), { type: "websearch", config: "simple" });
    q = q.order("published_at", { ascending: data.sort === "oldest" }).range((page - 1) * PAGE, page * PAGE - 1);
    const { data: rows, count } = await q;
    const { data: fields } = await db.from("papers").select("field").in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).is("deleted_at", null).limit(1000);
    return { rows: rows ?? [], total: count ?? 0, page, pageSize: PAGE, fields: Array.from(new Set((fields ?? []).map((f) => f.field).filter(Boolean))).sort() };
  });

export const getPublicPaper = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ publicId: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await core();
    // Both the Paperly identifier (PLY-) and the legacy repository identifier (RP-) resolve to the same record.
    const col = PAPERLY_ID_RE.test(data.publicId) ? "paperly_id" : LEGACY_ID_RE.test(data.publicId) ? "public_id" : null;
    if (!col) return null;
    const { data: p } = await db.from("papers").select("id, public_id, paperly_id, publication_type, title, abstract, keywords, article_type, field, license, copyright_holder, language, doi, published_at, status, peer_reviewed, current_version_id, updated_at").eq(col, data.publicId).in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).is("deleted_at", null).maybeSingle();
    if (!p) return null;
    const [{ data: authors }, { data: corrections }, { data: doiRec }, { data: roles }, { data: affs }, { data: funding }, { data: ai }, { data: versions }, { data: refs }] = await Promise.all([
      db.from("paper_authors").select("id, full_name, affiliation, orcid, user_id").eq("paper_id", p.id).order("position"),
      db.from("corrections").select("kind, notice, issued_at").eq("paper_id", p.id).order("issued_at"),
      db.from("doi_records").select("status, doi").eq("paper_id", p.id).maybeSingle(),
      db.from("paper_author_roles").select("author_id, role").eq("paper_id", p.id),
      db.from("paper_author_affiliations").select("author_id, position, organization, country").eq("paper_id", p.id).order("position"),
      db.from("paper_funding").select("funder_name, grant_number").eq("paper_id", p.id).order("created_at"),
      db.from("paper_ai_disclosures").select("category, tool_name, tool_version, purpose, extent, human_verification").eq("paper_id", p.id).order("created_at"),
      db.from("paper_versions").select("id, version_number, version_code, uploaded_at, change_reason, file_hash, mime_type").eq("paper_id", p.id).order("major").order("minor"),
      db.from("paper_references").select("position, raw_text, doi, validation_status").eq("paper_id", p.id).order("position"),
    ]);
    // An ORCID is shown as verified only when the author's own account proved ownership through ORCID sign-in.
    const uids = (authors ?? []).map((a) => a.user_id).filter((u): u is string => !!u);
    const { data: ver } = uids.length ? await db.from("orcid_verifications").select("user_id, orcid").in("user_id", uids) : { data: [] as Array<{ user_id: string; orcid: string }> };
    const verified = new Map((ver ?? []).map((v) => [v.user_id, v.orcid]));
    const { id: _id, ...rest } = p;
    void _id;
    const doiConfirmed = doiRec?.status === "VERIFIED" && !!doiRec.doi;
    return {
      ...rest, doi: doiConfirmed ? doiRec!.doi : null, corrections: corrections ?? [], doiStatus: doiRec?.status ?? "NOT_CONFIGURED",
      authors: (authors ?? []).map((a) => ({
        full_name: a.full_name, orcid: a.orcid || null, orcidVerified: !!a.orcid && !!a.user_id && verified.get(a.user_id) === a.orcid,
        affiliations: (affs ?? []).filter((x) => x.author_id === a.id).map((x) => ({ organization: x.organization, country: x.country })).concat(!(affs ?? []).some((x) => x.author_id === a.id) && a.affiliation ? [{ organization: a.affiliation, country: null }] : []),
        roles: (roles ?? []).filter((r) => r.author_id === a.id).map((r) => r.role),
      })),
      funding: funding ?? [], aiDisclosures: ai ?? [],
      // Every version stays listed; a version's hash lets a reader confirm which file a citation refers to.
      versions: (versions ?? []).map((v) => ({ version_number: v.version_number as string, version_identifier: v.version_code, uploaded_at: v.uploaded_at, change_reason: v.change_reason, file_hash: v.file_hash, is_current: v.id === p.current_version_id })),
      references: (refs ?? []).map((r) => ({ position: r.position, text: r.raw_text, doi: r.doi, status: r.validation_status })),
      origin: origin(),
      // True when the current version is a PDF, which Paperly serves publicly at /article/<id>/pdf (what Google Scholar reads).
      fullTextPdf: (versions ?? []).find((v) => v.id === p.current_version_id)?.mime_type === "application/pdf",
      currentVersion: (versions ?? []).find((v) => v.id === p.current_version_id)?.version_number ?? "1.0",
      currentVersionIdentifier: (versions ?? []).find((v) => v.id === p.current_version_id)?.version_code ?? null,
    };
  });

/**
 * Full text of a public record for the article page. Same visibility rules as the article itself and its /pdf route:
 * current version only, never a restricted or deleted record. Word files are converted to safe HTML here; PDFs are shown by the page from /article/<id>/pdf.
 */
export const getPublicFullText = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ publicId: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data }): Promise<{ kind: "pdf"; html: string | null; title: string | null } | { kind: "html"; html: string; truncated: boolean } | { kind: "none" }> => {
    const { db } = await core();
    const col = PAPERLY_ID_RE.test(data.publicId) ? "paperly_id" : LEGACY_ID_RE.test(data.publicId) ? "public_id" : null;
    if (!col) return { kind: "none" };
    const { data: p } = await db.from("papers").select("current_version_id, title").eq(col, data.publicId).in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).is("deleted_at", null).maybeSingle();
    if (!p?.current_version_id) return { kind: "none" };
    const { data: v } = await db.from("paper_versions").select("storage_path, mime_type").eq("id", p.current_version_id).maybeSingle();
    if (!v?.storage_path) return { kind: "none" };
    if (v.mime_type === "application/pdf") {
      // The PDF's own text, organised into headings and paragraphs for the reading view. If it cannot be read (a scanned file, a very large
      // one, a damaged one) the page still shows the original PDF pages, so this never blocks the article.
      try {
        const file = await db.storage.from("manuscripts").download(v.storage_path);
        if (file.error || !file.data || file.data.size > 30 * 1024 * 1024) return { kind: "pdf", html: null, title: p.title };
        const { getDocumentProxy } = await import("unpdf");
        const { structurePdf, toPdfItems } = await import("@/lib/domain/pdf-structure");
        const pdf = await getDocumentProxy(new Uint8Array(await file.data.arrayBuffer()));
        const pages: Array<import("@/lib/domain/pdf-structure").PdfPageText> = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 400); i++) {
          const pg = await pdf.getPage(i);
          const vp = pg.getViewport({ scale: 1 });
          pages.push({ width: vp.width, height: vp.height, items: toPdfItems(await pg.getTextContent()) });
        }
        const r = structurePdf(pages, { title: p.title });
        // Almost no text means a scan: the reading view would be empty or misleading, so only the page images are offered.
        return { kind: "pdf", html: r.words >= 80 ? r.html : null, title: p.title };
      } catch (e) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), event: "public_pdf_text_failed", public_id: data.publicId, message: e instanceof Error ? e.message : String(e) }));
        return { kind: "pdf", html: null, title: p.title };
      }
    }
    const { DOCX_MIME } = await import("@/lib/domain/file-security");
    if (v.mime_type !== DOCX_MIME) return { kind: "none" };
    try {
      const file = await db.storage.from("manuscripts").download(v.storage_path);
      if (file.error || !file.data) return { kind: "none" };
      const { docxToHtml } = await import("@/lib/domain/docx-html");
      const r = await docxToHtml(new Uint8Array(await file.data.arrayBuffer()));
      return r.html.trim() ? { kind: "html", html: r.html, truncated: r.truncated } : { kind: "none" };
    } catch (e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), event: "public_fulltext_failed", public_id: data.publicId, message: e instanceof Error ? e.message : String(e) }));
      return { kind: "none" };
    }
  });

/** Whether the signed-in user may download the Paperly-stamped copy of a public record (its uploader, a listed author with an account, or staff). */
export const getStampedAccess = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ publicId: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data, context }) => (await import("@/lib/server/article-download.server")).stampedAccess(context.userId, data.publicId));

/** Open to everyone. A short-lived link to the full article with the Paperly front page in front and the ID stamp on every page. */
export const downloadStampedArticle = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ publicId: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data }) => (await import("@/lib/server/article-download.server")).stampedArticleUrl(null, data.publicId, origin()));

export const verifyCertificate = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ certificateId: z.string().min(5).max(40), token: z.string().max(80).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await core();
    const { data: c, error: certErr } = await db.from("certificates").select("certificate_id, paper_id, certificate_type, recipient_name_at_issue, author_role, orcid_at_issue, paper_title_at_issue, article_public_id, doi_at_issue, publication_date, issued_at, status, status_reason, document_hash, verification_token, on_hold").eq("certificate_id", data.certificateId).maybeSingle();
    if (certErr) console.error(JSON.stringify({ ts: new Date().toISOString(), event: "verify_certificate_query_failed", certificate_id: data.certificateId, message: certErr.message }));
    if (!c || c.on_hold) return null; // a certificate on hold does not verify until an administrator releases it
    const { verification_token, paper_id, on_hold: _onHold, ...rest } = c;
    // Live facts about the record, so a certificate can never be read as saying more than the record does today.
    // If this lookup fails the certificate itself is still returned (without the live facts), and the cause is logged.
    let live: (ReturnType<Awaited<typeof import("@/lib/domain/certificate-pdf")>["describeRecord"]> & { paperlyId: string; publiclyListed: boolean }) | null = null;
    // A reviewer's certificate must not lead to the manuscript it was issued for.
    if (rest.certificate_type !== "PEER_REVIEW") try {
      const { data: rec } = await db.from("papers").select("paperly_id, publication_type, peer_reviewed, status, review_waived, deleted_at").eq("id", paper_id).maybeSingle();
      const { describeRecord } = await import("@/lib/domain/certificate-pdf");
      live = rec ? { paperlyId: rec.paperly_id, ...describeRecord(rec.publication_type, rec.peer_reviewed, rec.status, !!rec.review_waived), publiclyListed: ["PUBLISHED", "CORRECTED", "RETRACTED"].includes(rec.status) && !rec.deleted_at } : null;
    } catch (e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), event: "verify_certificate_live_failed", certificate_id: data.certificateId, message: e instanceof Error ? e.message : String(e) }));
    }
    return { ...rest, live, tokenMatches: data.token ? data.token === verification_token : null };
  });

// ---------- admin ----------
export const adminOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { db, dbx, getRoles, ADMINS: ADMINS_ } = await core();
  const { hasPermission, permissionsFor } = await import("@/lib/domain/permissions");
  const roles = await getRoles(context.userId);
  const editorial = hasPermission(roles, "EDITORIAL_REVIEW");
  const payments = hasPermission(roles, "PAYMENT_MANAGE");
  // Separation of duties: the editorial queue needs EDITORIAL_REVIEW, payment data needs PAYMENT_MANAGE. Holding either alone is enough
  // to open this page, and neither one reveals the other's data (an editor does not see payments; a payment admin does not see the queue).
  if (!editorial && !payments) throw new Error("Forbidden: insufficient permission");
  const [queue, pay_, counts, methods, unscreened] = await Promise.all([
    editorial ? db.from("papers").select("id, public_id, title, status, article_type, created_at").in("status", ["SUBMITTED", "REVIEW_REQUIRED", "AI_SCREENING", "PROCESSING", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION", "PUBLICATION_PENDING"]).is("deleted_at", null).order("created_at") : Promise.resolve({ data: [] }),
    payments ? dbx.from("payments").select("id, order_id, payment_code, user_id, amount_minor, currency, method, status, created_at, completed_at, provider_transaction_id, payer_reference, recorded_by, recorded_note").order("created_at", { ascending: false }).limit(30) as Promise<{ data: Array<{ id: string; order_id: string; payment_code: string; user_id: string; amount_minor: number; currency: string; method: string; status: string; created_at: string; completed_at: string | null; provider_transaction_id: string | null; payer_reference: string | null; recorded_by: string | null; recorded_note: string | null }> | null }> : Promise.resolve({ data: [] }),
    editorial ? db.from("papers").select("status").is("deleted_at", null) : Promise.resolve({ data: [] }),
    // Fetched alongside the rest instead of after it, so the page waits for the slowest one rather than the sum of all.
    payments ? pay().then((m) => m.availableMethods()) : Promise.resolve([]),
    // Paid (or fee-free) papers still sitting in SUBMITTED: screening never started, so they are not in the queue yet.
    editorial ? pipe().then((m) => m.findUnscreened(50)).catch(() => []) : Promise.resolve([]),
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of (counts.data ?? []) as Array<{ status: string }>) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  // Every SUBMITTED paper is listed so staff can see it. Those whose fee is not settled are flagged: they wait for the author's payment, not for an editor.
  const waitingIds = new Set(unscreened.map((u) => u.id));
  const visible = (queue.data ?? []).map((p) => ({ ...p, awaitingPayment: p.status === "SUBMITTED" && !waitingIds.has(p.id) }));
  // Which of these payments the founder can see, and the amount shown to them (administrators only; payment-only admins never see this).
  const shareRows = roles.some((r) => ADMINS_.includes(r)) && (pay_.data ?? []).length ? ((await dbx.from("founder_shared_payments").select("payment_id, shown_amount_minor").in("payment_id", (pay_.data ?? []).map((p) => p.id))).data ?? []) as Array<{ payment_id: string; shown_amount_minor: number | null }> : [];
  const shareMap = new Map(shareRows.map((r) => [r.payment_id, r.shown_amount_minor]));
  // Payer and (for manual entries) the administrator who recorded it, resolved in one lookup.
  const who = Array.from(new Set((pay_.data ?? []).flatMap((p) => [p.user_id, p.recorded_by].filter((x): x is string => !!x))));
  const { data: whoRows } = who.length ? await db.from("profiles").select("id, email").in("id", who) : { data: [] as Array<{ id: string; email: string | null }> };
  const emailOf = new Map((whoRows ?? []).map((w) => [w.id, w.email]));
  const paymentsOut = (pay_.data ?? []).map(({ id, user_id, recorded_by, ...p }) => ({ ...p, id, payerEmail: emailOf.get(user_id) ?? null, recordedByEmail: recorded_by ? emailOf.get(recorded_by) ?? "(unknown admin)" : null, sharedWithFounder: shareMap.has(id), shownAmountMinor: shareMap.get(id) ?? null }));
  return { queue: visible, unscreened: unscreened.length, payments: paymentsOut, canShareWithFounder: roles.some((r) => ADMINS_.includes(r)), canRecordPayment: payments, byStatus, methods, permissions: Array.from(permissionsFor(roles)) as string[] };
});

/** Kept for the existing editorial screen. It delegates to the single decision path (review.server recordDecision), so
 *  the journal-acceptance rule, conflict-of-interest check and audit trail apply identically everywhere. */
export const adminDecide = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), outcome: z.enum(["ACCEPT", "REJECT", "REVISION_REQUIRED", "MINOR_REVISION", "MAJOR_REVISION"]), reason: z.string().trim().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { recordDecision } = await import("@/lib/server/review.server");
    const outcome = data.outcome === "REVISION_REQUIRED" ? "MAJOR_REVISION" : data.outcome;
    await recordDecision(data.paperId, context.userId, outcome, data.reason, origin());
    return { ok: true };
  });

/** Publishes every approved paper that is still waiting in production (same job the daily sweep runs). Staff only. Returns counts and the first error per failed paper. */
export const adminPublishWaiting = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, requireRole, STAFF, audit } = await core();
    await requireRole(context.userId, STAFF);
    const { data: waiting } = await db.from("papers").select("id, public_id").eq("status", "PUBLICATION_PENDING").is("deleted_at", null).order("updated_at", { ascending: true }).limit(10);
    const { autoPublish } = await pipe();
    const results: Array<{ public_id: string; published: boolean; error?: string | undefined }> = [];
    for (const w of waiting ?? []) { const r = await autoPublish(w.id, origin()); results.push({ public_id: w.public_id, published: r.published, error: r.published ? undefined : String(r.error ?? "").slice(0, 200) }); }
    await audit({ actor_id: context.userId, action: "publish_waiting_run", resource_type: "paper", metadata: { results } });
    return { waiting: results.length, published: results.filter((r) => r.published).length, results };
  });

/** Starts screening for paid papers that never entered the pipeline, so they reach the editorial queue. Staff only. */
export const adminScreenWaiting = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, STAFF, audit } = await core();
    await requireRole(context.userId, STAFF);
    const { screenWaiting } = await pipe();
    const r = await screenWaiting(origin(), 3);
    await audit({ actor_id: context.userId, action: "screen_waiting_run", resource_type: "paper", metadata: { results: r.results } });
    return r;
  });

export const adminPublish = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, requireRole, STAFF } = await core();
    await requireRole(context.userId, STAFF);
    const { data: p } = await db.from("papers").select("status, owner_id, deleted_at").eq("id", data.paperId).single();
    if (!p || p.status !== "PUBLICATION_PENDING" || p.deleted_at) throw new Error("Paper is not in production");
    if (p.owner_id === context.userId) throw new Error("Conflict of interest: you cannot publish your own manuscript");
    // Zenodo enabled: this click is the explicit publication approval. It registers the DOI first; the paper is published (with that DOI on the
    // article page and certificates) only once Zenodo has confirmed it. A failure leaves the paper in production with the error shown to administrators.
    const zen = await import("@/lib/server/zenodo.server");
    if (zen.zenodoEnabled()) {
      const r = await zen.approveAndRegister(data.paperId, context.userId, origin());
      if (r.outcome === "registered") return { ok: true, pending: false };
      // Still running or stopped on something temporary: the browser keeps going by itself (zenodoContinue), so this is not an error.
      if (r.outcome === "skipped" || (r.outcome === "failed" && r.retryable)) return { ok: true, pending: true };
      throw new Error(r.outcome === "failed" ? `DOI registration did not complete (${r.code}). ${r.message}` : r.message);
    }
    const { publishPaper } = await pipe();
    await publishPaper(data.paperId, context.userId, origin());
    return { ok: true, pending: false };
  });

export const adminPaperReport = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, requireRole, STAFF } = await core();
    await requireRole(context.userId, STAFF);
    const [{ data: p }, { data: authors }, { data: run }] = await Promise.all([
      db.from("papers").select("id, public_id, paperly_id, title, abstract, article_type, field, status, review_waived").eq("id", data.id).single(),
      db.from("paper_authors").select("full_name, affiliation, is_corresponding").eq("paper_id", data.id).order("position"),
      db.from("ai_runs").select("id, status, provider, model_name, policy_key, policy_version, deterministic_signals, structured_result").eq("paper_id", data.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!p) throw new Error("Not found");
    const { data: findings } = run ? await db.from("ai_findings").select("check_key, status, severity, message, evidence").eq("ai_run_id", run.id) : { data: [] };
    const sig = (run?.deterministic_signals ?? {}) as Record<string, unknown>;
    // How far the automated result could be trusted: how much of the manuscript was read, whether the quotations were found, what was adjusted.
    const { data: dec } = run ? await db.from("decisions").select("check_summary").eq("ai_run_id", run.id).eq("source", "MACHINE").order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const cs = ((dec?.check_summary ?? {}) as Record<string, unknown>);
    const pick = (k: string) => (typeof cs[k] === "string" ? (cs[k] as string) : null);
    const verification = { coverage: pick("manuscript_coverage"), evidence: pick("evidence_verified"), unconfirmed: pick("unconfirmed_findings"), adjusted: pick("adjusted_for_consistency") };
    return {
      paper: p, authors: authors ?? [],
      run: run ? { status: run.status, provider: run.provider, model: run.model_name, policy: `${run.policy_key}@${run.policy_version}` } : null,
      aiMeter: (sig["ai_meter"] ?? null) as CombinedMeter | null, citations: (sig["citations"] ?? null) as CitationCheck | null, similarity: (sig["similarity"] ?? null) as SimilarityCheck | null,
      findings: (findings ?? []).map((f) => ({ check_key: f.check_key, status: f.status, severity: f.severity, message: f.message, evidence: (Array.isArray(f.evidence) ? f.evidence : []) as Array<{ section: string | null; quote: string | null; verified?: boolean }> })),
      verification,
    };
  });

// ---------- ORCID (verified only via ORCID OAuth; never typed in) ----------
// Always the live ORCID registry. There is deliberately no sandbox switch: ORCID_ENV is ignored.
const orcidBase = () => "https://orcid.org";
const orcidConfig = () => {
  // Values pasted into a dashboard often carry a trailing space or newline; ORCID would then reject them.
  // Strip stray spaces, line breaks and wrapping quotes that sometimes come along when a value is pasted into a dashboard.
  const clean = (v?: string) => v?.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  const id = clean(process.env["ORCID_CLIENT_ID"]), secret = clean(process.env["ORCID_CLIENT_SECRET"]), state = clean(process.env["ORCID_STATE_SECRET"]);
  return id && secret && state ? { id, secret, state } : null;
};
/** The one redirect address used for both the sign-in link and the token exchange. ORCID requires them to match what is registered, character for character. */
const orcidRedirect = () => `${(process.env["PUBLIC_SITE_URL"]?.trim() || origin()).replace(/\/+$/, "")}/orcid/callback`;

export const getMyOrcid = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { db } = await core();
  const { data } = await db.from("orcid_verifications").select("orcid, verified_at").eq("user_id", context.userId).maybeSingle();
  return { configured: !!orcidConfig(), sandbox: false, verified: data ?? null };
});

export const orcidConnectUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const cfg = orcidConfig();
  if (!cfg) throw new Error("ORCID sign-in is not configured on this site yet");
  const { signState } = await import("@/lib/domain/orcid");
  const state = await signState({ uid: context.userId, exp: Date.now() + 10 * 60_000, n: crypto.randomUUID() }, cfg.state);
  const redirect = orcidRedirect();
  const u = new URL(`${orcidBase()}/oauth/authorize`);
  u.search = new URLSearchParams({ client_id: cfg.id, response_type: "code", scope: "/authenticate", redirect_uri: redirect, state }).toString();
  return { url: u.toString() };
});

/** Called from the signed-in callback page. The state must have been issued to THIS user, so a link started by someone
 *  else cannot attach a victim's ORCID iD to the starter's account. */
export const completeOrcidLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ code: z.string().min(6).max(200), state: z.string().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const cfg = orcidConfig();
    if (!cfg) throw new Error("ORCID sign-in is not configured on this site yet");
    const { verifyState, orcidChecksumOk: ok } = await import("@/lib/domain/orcid");
    const st = await verifyState(data.state, cfg.state);
    if (!st || st.uid !== context.userId) throw new Error("This ORCID sign-in link is invalid, expired, or was started from a different account");
    const res = await fetch(`${orcidBase()}/oauth/token`, {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, grant_type: "authorization_code", code: data.code, redirect_uri: orcidRedirect() }),
    });
    if (!res.ok) {
      // ORCID says why in its response. Log that (never the secret) and tell the person something they can act on.
      const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
      const redirect = orcidRedirect();
      console.error(JSON.stringify({ ts: new Date().toISOString(), event: "orcid_token_exchange_failed", status: res.status, error: body.error ?? null, error_description: (body.error_description ?? "").slice(0, 300), redirect_uri: redirect, client_id: cfg.id,
        // Shape of the secret this deployment holds, so it can be compared with the one shown in ORCID developer tools. The secret itself is never logged.
        secret_length: cfg.secret.length, secret_uuid_shape: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cfg.secret), secret_last4: cfg.secret.slice(-4),
        raw_secret_had_extra_chars: (process.env["ORCID_CLIENT_SECRET"] ?? "") !== cfg.secret }));
      const why = `${body.error ?? ""} ${body.error_description ?? ""}`.toLowerCase();
      if (why.includes("redirect")) throw new Error(`ORCID did not accept the redirect address. The site administrator must register exactly this address in ORCID developer tools: ${redirect}`);
      if (why.includes("invalid_client") || why.includes("client") || res.status === 401) throw new Error(`ORCID rejected this site's client ID or secret${body.error ? ` (ORCID answered: ${body.error.slice(0, 40)})` : ""}. The site administrator must check ORCID_CLIENT_ID and ORCID_CLIENT_SECRET (they must be the credentials from orcid.org developer tools, not the sandbox), then redeploy so the new values are used.`);
      if (why.includes("invalid_grant") || why.includes("code")) throw new Error("That ORCID sign-in link was already used or has expired. Start again from your profile.");
      throw new Error("ORCID did not accept the sign-in. Please try again.");
    }
    const tok = (await res.json()) as { orcid?: string; name?: string };
    if (!tok.orcid || !ok(tok.orcid)) throw new Error("ORCID returned an invalid iD");
    const { db, audit } = await core();
    const { data: taken } = await db.from("orcid_verifications").select("user_id").eq("orcid", tok.orcid).maybeSingle();
    if (taken && taken.user_id !== context.userId) throw new Error("This ORCID iD is already linked to another Paperly account");
    const now = new Date().toISOString();
    // oauth_subject is NOT NULL and must equal the iD (constraint orcid_subject_matches); ORCID's "sub" for this flow is the iD itself.
    const { error } = await db.from("orcid_verifications").upsert({ user_id: context.userId, orcid: tok.orcid, oauth_subject: tok.orcid, name_at_verification: tok.name ?? null, verified_at: now, last_verified_at: now }, { onConflict: "user_id" });
    if (error) { console.error(JSON.stringify({ event: "orcid_link_save_failed", code: error.code ?? null, message: error.message.slice(0, 200) })); throw new Error("Could not save the ORCID link"); }
    await db.from("profiles").update({ orcid: tok.orcid }).eq("id", context.userId);
    await audit({ actor_id: context.userId, action: "orcid_verified", resource_type: "user", resource_id: context.userId, metadata: { orcid: tok.orcid } });
    return { orcid: tok.orcid };
  });
