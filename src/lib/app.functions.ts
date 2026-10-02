import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CombinedMeter } from "@/lib/domain/ai-meter";

type CitationCheck = { checked: number; invalid: number; details: string[] };
type SimilarityCheck = { max_percentage: number; risk: string; duplicate_file: boolean };

const origin = () => { try { return new URL(getRequest().url).origin; } catch { return process.env["PUBLIC_SITE_URL"] ?? ""; } };
const core = () => import("@/lib/server/core.server");
const pay = () => import("@/lib/server/payments.server");
const pipe = () => import("@/lib/server/pipeline.server");

// ---------- profile / roles ----------
export const getMe = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { db, getRoles, audit } = await core();
  const uid = context.userId;
  let { data: profile } = await db.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (!profile) {
    const email = (context.claims as { email?: string }).email ?? null;
    const ins = await db.from("profiles").insert({ id: uid, email, display_name: email?.split("@")[0] ?? "Researcher" }).select("*").single();
    profile = ins.data;
    const { count } = await db.from("user_roles").select("id", { count: "exact", head: true });
    const roles: Array<"researcher" | "super_admin"> = (count ?? 0) === 0 ? ["researcher", "super_admin"] : ["researcher"];
    await db.from("user_roles").insert(roles.map((role) => ({ user_id: uid, role })));
    await audit({ actor_id: uid, action: "user_registered", resource_type: "user", resource_id: uid, metadata: { roles } });
  }
  return { profile, roles: await getRoles(uid) };
});

export const updateProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ display_name: z.string().trim().min(2).max(120), institution: z.string().max(200).optional(), country: z.string().max(80).optional(), orcid: z.string().regex(/^(\d{4}-){3}\d{3}[\dX]$/).or(z.literal("")).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("profiles").update({ display_name: data.display_name, institution: data.institution ?? null, country: data.country ?? null, orcid: data.orcid || null }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- submission ----------
const submissionSchema = z.object({
  title: z.string().trim().min(5).max(400),
  abstract: z.string().trim().min(50).max(5000),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  article_type: z.string().min(2).max(80),
  field: z.string().min(2).max(120),
  license: z.enum(["CC-BY", "CC-BY-NC", "CC-BY-NC-ND", "ALL-RIGHTS-RESERVED"]),
  authors: z.array(z.object({ full_name: z.string().trim().min(2).max(160), email: z.string().email().or(z.literal("")).optional(), affiliation: z.string().max(200).optional(), orcid: z.string().max(19).optional(), is_corresponding: z.boolean() })).min(1).max(30),
  rights: z.object({ is_author: z.boolean(), coauthor_permission: z.boolean(), has_upload_rights: z.boolean(), previously_published: z.boolean(), previous_doi: z.string().max(200).optional(), manuscript_version_type: z.enum(["PREPRINT", "ACCEPTED_MANUSCRIPT", "PUBLISHER_VERSION", "ORIGINAL_SUBMISSION"]), third_party_content: z.boolean(), third_party_permission: z.boolean().optional(), ai_processing_consent: z.literal(true) }),
  ethics: z.object({ human_participants: z.boolean(), animal_subjects: z.boolean(), clinical_trial: z.boolean(), ethics_approval: z.boolean(), ethics_committee: z.string().max(200).optional(), approval_number: z.string().max(100).optional(), ethics_exempt: z.boolean(), exemption_reason: z.string().max(500).optional(), informed_consent: z.boolean(), trial_registry: z.string().max(100).optional(), trial_registration_number: z.string().max(100).optional(), animal_protocol: z.string().max(200).optional(), conflict_of_interest: z.string().trim().min(2).max(2000), funding: z.string().trim().min(2).max(2000), data_availability: z.string().trim().min(2).max(2000), ai_tools_used: z.string().max(1000).optional(), ai_none_used: z.boolean().optional() }),
});

export const submitPaper = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("Expected form data");
    const file = d.get("file");
    if (!(file instanceof File)) throw new Error("Attach your manuscript as a PDF");
    return { meta: submissionSchema.parse(JSON.parse(String(d.get("meta")))), file };
  })
  .handler(async ({ data, context }) => {
    const { db, audit, transition } = await core();
    const { scanPdf, sha256Hex, MAX_UPLOAD_BYTES } = await import("@/lib/domain/file-security");
    const { RIGHTS_DECLARATION_VERSION, ETHICS_DECLARATION_VERSION, AI_DISCLOSURE_VERSION } = await import("@/lib/domain/constants");
    const uid = context.userId; const m = data.meta;
    if (data.file.size > MAX_UPLOAD_BYTES) throw new Error("File is larger than 25 MB");
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    const scan = scanPdf(bytes, data.file.name, data.file.type || "application/pdf");
    if (!scan.passed) throw new Error(`File rejected: ${scan.reasons.join("; ")}`);
    const hash = await sha256Hex(bytes);
    const [{ data: prof }, paperIns] = await Promise.all([
      db.from("profiles").select("display_name").eq("id", uid).single(),
      db.from("papers").insert({ owner_id: uid, title: m.title, abstract: m.abstract, keywords: m.keywords, article_type: m.article_type, field: m.field, license: m.license }).select("id, public_id").single(),
    ]);
    const paper = paperIns.data;
    if (paperIns.error || !paper) throw new Error(paperIns.error?.message ?? "Could not create paper");
    const path = `${uid}/${paper.id}/v1.0-${hash.slice(0, 12)}.pdf`;
    const { conflict_of_interest, funding, data_availability, ...answers } = m.ethics;
    // Independent writes run together; each one is checked so a partial submission can never go unnoticed.
    const [up, au, ri, et] = await Promise.all([
      db.storage.from("manuscripts").upload(path, bytes, { contentType: "application/pdf" }),
      db.from("paper_authors").insert(m.authors.map((a, i) => ({ paper_id: paper.id, position: i + 1, full_name: a.full_name, email: a.email || null, affiliation: a.affiliation || null, orcid: a.orcid || null, is_corresponding: a.is_corresponding, user_id: i === 0 ? uid : null }))),
      db.from("rights_declarations").insert({ paper_id: paper.id, user_id: uid, declaration_version: RIGHTS_DECLARATION_VERSION, ai_disclosure_version: AI_DISCLOSURE_VERSION, selected_license: m.license, ...m.rights, previous_doi: m.rights.previous_doi || null, third_party_permission: m.rights.third_party_permission ?? null }),
      db.from("ethics_declarations").insert({ paper_id: paper.id, user_id: uid, declaration_version: ETHICS_DECLARATION_VERSION, answers: answers as never, conflict_of_interest, funding, data_availability }),
    ]);
    if (up.error) throw new Error("Upload failed. Please try again.");
    if (au.error || ri.error || et.error) throw new Error("Could not save the submission details. Please try again.");
    const { data: ver, error: verErr } = await db.from("paper_versions").insert({ paper_id: paper.id, major: 1, minor: 0, storage_path: path, file_hash: hash, file_size: bytes.length, mime_type: "application/pdf", author_name_at_submission: prof?.display_name ?? "Unknown", uploaded_by: uid, scan_result: scan as never }).select("id").single();
    if (verErr || !ver) throw new Error("Could not record the manuscript version.");
    await db.from("papers").update({ current_version_id: ver.id }).eq("id", paper.id);
    await transition(paper.id, "SUBMITTED", uid, "USER", "author submitted");
    await audit({ actor_id: uid, action: "paper_submitted", resource_type: "paper", resource_id: paper.id, metadata: { file_hash: hash } });
    // Screening (PDF text, Crossref, AI) can take a minute, so it is started by a separate call. The author sees
    // their submission straight away instead of waiting on this request.
    return { id: paper.id, publicId: paper.public_id };
  });

/** Starts screening for a freshly submitted paper. Safe to call twice: only the first call finds it SUBMITTED. */
export const startScreening = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: p } = await db.from("papers").select("owner_id, status").eq("id", data.id).single();
    if (p?.owner_id !== context.userId) throw new Error("Not found");
    if (p.status !== "SUBMITTED") return { skipped: true as const, status: String(p.status) };
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
    const { runScreening } = await pipe();
    return runScreening(data.id, context.userId, origin());
  });

// ---------- my research ----------
export const listMyPapers = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.from("papers").select("id, public_id, title, status, article_type, created_at, published_at").eq("owner_id", context.userId).order("created_at", { ascending: false });
  return data ?? [];
});

export const getMyPaper = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: paper } = await db.from("papers").select("*").eq("id", data.id).single();
    if (!paper || paper.owner_id !== context.userId) throw new Error("Not found");
    const { data: lastRun } = await db.from("ai_runs").select("id, status, deterministic_signals, completed_at").eq("paper_id", data.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    const { data: findings } = lastRun ? await db.from("ai_findings").select("check_key, status, severity, message").eq("ai_run_id", lastRun.id) : { data: [] };
    const sig = (lastRun?.deterministic_signals ?? {}) as Record<string, unknown>;
    const screening = lastRun ? { status: lastRun.status, aiMeter: (sig["ai_meter"] ?? null) as CombinedMeter | null, citations: (sig["citations"] ?? null) as CitationCheck | null, findings: findings ?? [] } : null;
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
    const { search: _search, ...paperOut } = paper;
    void _search;
    return { paper: paperOut, screening, decisions: decisions.data ?? [], payments: payments.data ?? [], authors: authors.data ?? [], doi: doi.data, methods, price };
  });

// ---------- payments ----------
export const startPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), method: z.enum(["RAZORPAY", "TEST"]) }).parse(d))
  .handler(async ({ data, context }) => (await pay()).startPublicationPayment(context.userId, data.paperId, data.method));

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

// ---------- certificates ----------
export const listMyCertificates = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.from("certificates").select("certificate_id, certificate_type, paper_title_at_issue, article_public_id, status, issued_at, verification_token").eq("recipient_user_id", context.userId).order("issued_at", { ascending: false });
  return data ?? [];
});

export const certificateDownload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ certificateId: z.string().min(5).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await core();
    const { data: c } = await db.from("certificates").select("recipient_user_id, storage_path").eq("certificate_id", data.certificateId).single();
    if (!c || c.recipient_user_id !== context.userId || !c.storage_path) throw new Error("Not available");
    const s = await db.storage.from("certificates").createSignedUrl(c.storage_path, 300);
    return { url: s.data?.signedUrl ?? null };
  });

// ---------- public ----------
export const explorePapers = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ q: z.string().max(200).optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { db } = await core();
    let q = db.from("papers").select("public_id, title, abstract, keywords, article_type, field, published_at, status, doi").in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).eq("restricted", false).order("published_at", { ascending: false }).limit(50);
    if (data.q?.trim()) q = q.textSearch("search", data.q.trim(), { type: "websearch", config: "simple" });
    const { data: rows } = await q;
    return rows ?? [];
  });

export const getPublicPaper = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ publicId: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await core();
    const { data: p } = await db.from("papers").select("id, public_id, title, abstract, keywords, article_type, field, license, doi, published_at, status, peer_reviewed").eq("public_id", data.publicId).in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).maybeSingle();
    if (!p) return null;
    const [{ data: authors }, { data: corrections }, { data: doiRec }] = await Promise.all([
      db.from("paper_authors").select("full_name, affiliation, orcid").eq("paper_id", p.id).order("position"),
      db.from("corrections").select("kind, notice, issued_at").eq("paper_id", p.id).order("issued_at"),
      db.from("doi_records").select("status, doi").eq("paper_id", p.id).maybeSingle(),
    ]);
    const { id: _id, ...rest } = p;
    void _id;
    return { ...rest, authors: authors ?? [], corrections: corrections ?? [], doiStatus: doiRec?.status ?? "NOT_CONFIGURED" };
  });

export const verifyCertificate = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ certificateId: z.string().min(5).max(40), token: z.string().max(80).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await core();
    const { data: c } = await db.from("certificates").select("certificate_id, certificate_type, recipient_name_at_issue, author_role, paper_title_at_issue, article_public_id, doi_at_issue, publication_date, issued_at, status, status_reason, document_hash, verification_token").eq("certificate_id", data.certificateId).maybeSingle();
    if (!c) return null;
    const { verification_token, ...rest } = c;
    return { ...rest, tokenMatches: data.token ? data.token === verification_token : null };
  });

// ---------- admin ----------
export const adminOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { db, requireRole, STAFF } = await core();
  await requireRole(context.userId, [...STAFF, "payment_admin"]);
  const [queue, payments, counts] = await Promise.all([
    db.from("papers").select("id, public_id, title, status, article_type, created_at").in("status", ["REVIEW_REQUIRED", "AI_SCREENING", "PROCESSING"]).order("created_at"),
    db.from("payments").select("order_id, amount_minor, currency, method, status, created_at, provider_transaction_id").order("created_at", { ascending: false }).limit(30),
    db.from("papers").select("status"),
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of counts.data ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const { availableMethods } = await pay();
  return { queue: queue.data ?? [], payments: payments.data ?? [], byStatus, methods: await availableMethods() };
});

export const adminDecide = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paperId: z.string().uuid(), outcome: z.enum(["ACCEPT", "REJECT", "REVISION_REQUIRED"]), reason: z.string().trim().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, requireRole, STAFF, transition, notify, audit } = await core();
    await requireRole(context.userId, STAFF);
    const { data: p } = await db.from("papers").select("status, owner_id, current_version_id").eq("id", data.paperId).single();
    if (!p || p.status !== "REVIEW_REQUIRED") throw new Error("Paper is not awaiting editorial review");
    await db.from("decisions").insert({ paper_id: data.paperId, version_id: p.current_version_id, source: "HUMAN", outcome: data.outcome, reasons: [{ code: "EDITOR", message: data.reason }] as never, check_summary: {} as never, actor_id: context.userId });
    const to = ({ ACCEPT: "ACCEPTED", REJECT: "REJECTED", REVISION_REQUIRED: "REVISION_REQUIRED" } as const)[data.outcome];
    await transition(data.paperId, to, context.userId, "USER", data.reason);
    await audit({ actor_id: context.userId, action: "editor_decision", resource_type: "paper", resource_id: data.paperId, new_value: { outcome: data.outcome } });
    await notify(p.owner_id, `decision_${to.toLowerCase()}`, "Editorial decision", data.reason, `/my-research/${data.paperId}`);
    return { ok: true };
  });

export const adminPaperReport = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, requireRole, STAFF } = await core();
    await requireRole(context.userId, STAFF);
    const [{ data: p }, { data: authors }, { data: run }] = await Promise.all([
      db.from("papers").select("id, public_id, title, abstract, article_type, field, status").eq("id", data.id).single(),
      db.from("paper_authors").select("full_name, affiliation, is_corresponding").eq("paper_id", data.id).order("position"),
      db.from("ai_runs").select("id, status, provider, model_name, policy_key, policy_version, deterministic_signals, structured_result").eq("paper_id", data.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!p) throw new Error("Not found");
    const { data: findings } = run ? await db.from("ai_findings").select("check_key, status, severity, message, evidence").eq("ai_run_id", run.id) : { data: [] };
    const sig = (run?.deterministic_signals ?? {}) as Record<string, unknown>;
    return {
      paper: p, authors: authors ?? [],
      run: run ? { status: run.status, provider: run.provider, model: run.model_name, policy: `${run.policy_key}@${run.policy_version}` } : null,
      aiMeter: (sig["ai_meter"] ?? null) as CombinedMeter | null, citations: (sig["citations"] ?? null) as CitationCheck | null, similarity: (sig["similarity"] ?? null) as SimilarityCheck | null,
      findings: (findings ?? []).map((f) => ({ check_key: f.check_key, status: f.status, severity: f.severity, message: f.message, evidence: (Array.isArray(f.evidence) ? f.evidence : []) as Array<{ section: string | null; quote: string | null }> })),
    };
  });
