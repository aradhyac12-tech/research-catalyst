import { db, dbx, audit, requirePermission, log } from "./core.server";
import { ETHICS_POLICIES, PUBLICLY_SAFE_ETHICS_LABEL, type EthicsStatus } from "@/lib/domain/ethics-policy";
import { validateRights, type RightsInput } from "@/lib/domain/rights-policy";
import { buildEthicsPayload, rightsPayload, type SubmissionMeta } from "./submission.server";

const REVIEW_QUEUE: EthicsStatus[] = ["ETHICS_REVIEW_REQUIRED", "ETHICS_HUMAN_REVIEW_REQUIRED", "ETHICS_UNDER_REVIEW"];

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await dbx.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/** A reviewer who is the owner or an author of the paper never sees or acts on it. The database enforces the same rule. */
async function assertNotParty(paperId: string, uid: string) {
  const { data } = await dbx.rpc("ethics_actor_is_party", { _paper: paperId, _uid: uid });
  if (data === true) throw new Error("Conflict: you are the submitter or an author of this paper");
}

async function loadCase(caseId: string) {
  const { data, error } = await dbx.from("ethics_cases").select("*").eq("id", caseId).maybeSingle();
  if (error || !data) throw new Error("Not found");
  return data as { id: string; eth_id: string; paper_id: string; status: EthicsStatus; policy_version: string; research_category: string; assigned_reviewer_id: string | null; declaration_id: string; requires_trial_registration: boolean; requires_publication_consent: boolean; requires_committee_approval: boolean };
}

// ---------------- ethics reviewer ----------------
export async function listEthicsQueue(uid: string) {
  await requirePermission(uid, "ETHICS_REVIEW");
  const { data } = await dbx.from("ethics_cases").select("id, eth_id, paper_id, status, research_category, policy_version, assigned_reviewer_id, created_at").in("status", REVIEW_QUEUE).order("created_at");
  const rows = (data ?? []) as Array<{ id: string; eth_id: string; paper_id: string; status: EthicsStatus; research_category: string; policy_version: string; assigned_reviewer_id: string | null; created_at: string }>;
  const out = [];
  for (const c of rows) {
    if (c.assigned_reviewer_id && c.assigned_reviewer_id !== uid) continue; // someone else's case
    const { data: party } = await dbx.rpc("ethics_actor_is_party", { _paper: c.paper_id, _uid: uid });
    if (party === true) continue;
    const { data: p } = await db.from("papers").select("paperly_id, title, article_type").eq("id", c.paper_id).single();
    out.push({ ...c, paperly_id: p?.paperly_id ?? null, title: p?.title ?? "", article_type: p?.article_type ?? "", assigned_to_me: c.assigned_reviewer_id === uid });
  }
  return out;
}

export async function getEthicsCaseForReviewer(uid: string, caseId: string) {
  await requirePermission(uid, "ETHICS_REVIEW");
  const c = await loadCase(caseId);
  await assertNotParty(c.paper_id, uid);
  if (c.assigned_reviewer_id && c.assigned_reviewer_id !== uid) throw new Error("This case is assigned to another ethics reviewer");
  const [paper, decl, subj, trial, events, policyRow] = await Promise.all([
    db.from("papers").select("paperly_id, title, abstract, article_type, field").eq("id", c.paper_id).single(),
    dbx.from("ethics_declarations").select("revision, declaration_version, answers, conflict_of_interest, funding, data_availability, declared_at, amendment_reason").eq("paper_id", c.paper_id).order("revision", { ascending: false }),
    dbx.from("ethics_subject_declarations").select("*").eq("paper_id", c.paper_id).order("revision", { ascending: false }).limit(1).maybeSingle(),
    dbx.from("trial_registrations").select("*").eq("paper_id", c.paper_id).maybeSingle(),
    dbx.from("ethics_events").select("event_type, from_status, to_status, actor_type, reason, structured_reasons, created_at").eq("case_id", c.id).order("id"),
    dbx.from("ethics_policies").select("version, content_hash, rules").eq("version", c.policy_version).maybeSingle(),
  ]);
  // Author identities are not needed for an ethics decision and are not returned.
  return { case: c, paper: paper.data, declarations: decl.data ?? [], subject: subj.data, trial: trial.data, events: events.data ?? [], policy: policyRow.data };
}

const DECISIONS = ["ETHICS_UNDER_REVIEW", "ETHICS_REVISION_REQUIRED", "ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_HUMAN_REVIEW_REQUIRED"] as const;
export async function decideEthics(uid: string, caseId: string, to: (typeof DECISIONS)[number], reason: string, structured: Array<{ code: string; detail?: string | undefined }>) {
  await requirePermission(uid, "ETHICS_REVIEW");
  const c = await loadCase(caseId);
  await assertNotParty(c.paper_id, uid);
  const correlation = crypto.randomUUID();
  // The database function re-checks role, conflict, assignment, reasons and the clearing preconditions.
  await rpc("ethics_transition", { _case: caseId, _to: to, _actor: uid, _actor_type: "USER", _reason: reason, _structured: structured, _correlation: correlation });
  return { ok: true as const, eth_id: c.eth_id };
}

export async function verifyTrialRegistration(uid: string, paperId: string, result: "VERIFIED_MANUAL" | "VERIFICATION_FAILED", reason: string) {
  await requirePermission(uid, "ETHICS_REVIEW");
  await assertNotParty(paperId, uid);
  await rpc("ethics_verify_trial", { _paper: paperId, _actor: uid, _result: result, _reason: reason, _correlation: crypto.randomUUID() });
  return { ok: true as const };
}

// ---------------- administration (assignment is not a decision) ----------------
export async function assignEthicsReviewer(uid: string, caseId: string, reviewerId: string) {
  await requirePermission(uid, "ETHICS_ASSIGN");
  await rpc("ethics_assign", { _case: caseId, _reviewer: reviewerId, _actor: uid, _correlation: crypto.randomUUID() });
  return { ok: true as const };
}
export async function listEthicsAssignmentQueue(uid: string) {
  await requirePermission(uid, "ETHICS_ASSIGN");
  // Status and routing only: assigners do not receive declaration contents or reviewer notes.
  const { data } = await dbx.from("ethics_cases").select("id, eth_id, paper_id, status, research_category, assigned_reviewer_id, created_at").in("status", REVIEW_QUEUE).order("created_at");
  const { data: reviewers } = await db.from("user_roles").select("user_id").eq("role", "ethics_reviewer");
  return { cases: data ?? [], reviewers: (reviewers ?? []).map((r) => r.user_id) };
}

// ---------------- the researcher's own view ----------------
export async function getMyEthics(uid: string, paperId: string) {
  const { data: p } = await db.from("papers").select("owner_id").eq("id", paperId).single();
  if (!p || p.owner_id !== uid) throw new Error("Not found");
  const { data: c } = await dbx.from("ethics_cases").select("id, eth_id, status, research_category, policy_version, requires_trial_registration, requires_publication_consent").eq("paper_id", paperId).maybeSingle();
  if (!c) return null;
  // The author sees what they must act on (the structured reasons of a revision request or a non-clearance), not who reviewed or any internal notes.
  const { data: ev } = await dbx.from("ethics_events").select("to_status, reason, structured_reasons, created_at").eq("case_id", c.id).in("to_status", ["ETHICS_REVISION_REQUIRED", "ETHICS_NOT_CLEARED"]).order("id", { ascending: false }).limit(1).maybeSingle();
  const { data: tr } = await dbx.from("trial_registrations").select("registration_required, registration_status, registry_name, registration_number, verification_status").eq("paper_id", paperId).maybeSingle();
  const resubmit = c.status === "ETHICS_REVISION_REQUIRED" || c.status === "ETHICS_NOT_CLEARED";
  return { ...c, trial: tr, feedback: resubmit ? ev : null, publicLabel: PUBLICLY_SAFE_ETHICS_LABEL[c.status as EthicsStatus] };
}

/** Researchers can NEVER move ethics status: they can only append an amended declaration, which re-opens review. */
export async function amendEthicsDeclaration(uid: string, paperId: string, ethics: SubmissionMeta["ethics"], articleType: string, reason: string) {
  const payload = await buildEthicsPayload(articleType, ethics);
  const rev = await rpc("amend_ethics", { _paper: paperId, _actor: uid, _p: payload, _reason: reason, _correlation: crypto.randomUUID() });
  return { revision: rev as number };
}
export async function amendRightsDeclaration(uid: string, paperId: string, rights: RightsInput, reason: string) {
  const { count } = await db.from("paper_authors").select("id", { count: "exact", head: true }).eq("paper_id", paperId);
  const violations = validateRights(rights, { authorCount: count ?? 1 });
  if (violations.length) throw new Error(violations.join(" "));
  const rev = await rpc("amend_rights", { _paper: paperId, _actor: uid, _r: rightsPayload(rights), _reason: reason, _correlation: crypto.randomUUID() });
  return { revision: rev as number };
}

// ---------------- AI boundary ----------------
export async function escalateEthicsFromScreening(paperId: string, aiRunId: string) {
  const { data: c } = await dbx.from("ethics_cases").select("id, status").eq("paper_id", paperId).maybeSingle();
  if (!c || !["ETHICS_NOT_REQUIRED", "ETHICS_REVIEW_REQUIRED"].includes(c.status)) return;
  try {
    // actor_type 'AI' is accepted by the database for exactly one target: ETHICS_HUMAN_REVIEW_REQUIRED.
    await rpc("ethics_transition", { _case: c.id, _to: "ETHICS_HUMAN_REVIEW_REQUIRED", _actor: null, _actor_type: "AI", _reason: "automated screening raised an ethics concern; a human must review", _structured: [{ code: "AI_ADVISORY_FLAG", detail: `ai_run ${aiRunId}` }], _correlation: crypto.randomUUID() });
  } catch (e) { log("ethics_escalation_skipped", { paper_id: paperId, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" }); }
}

export async function ethicsAuditPage(uid: string, paperId: string) {
  await requirePermission(uid, "AUDIT_READ");
  const { data } = await dbx.from("ethics_events").select("event_type, from_status, to_status, actor_type, policy_version, created_at").eq("paper_id", paperId).order("id");
  await audit({ actor_id: uid, action: "ethics_audit_read", resource_type: "paper", resource_id: paperId });
  return data ?? [];
}
export { ETHICS_POLICIES };
