import { db, dbx, audit, log, notify } from "./core.server";
import { runSubmissionSaga, canonicalJson, SubmissionError, type SagaPorts, type ClaimResult } from "@/lib/domain/submission-saga";
import { validateRights, type RightsInput } from "@/lib/domain/rights-policy";
import { evaluateEthics, ethicsPolicyHash, CURRENT_ETHICS_POLICY, type EthicsEvaluation, type SubjectDeclaration, type TrialDeclaration } from "@/lib/domain/ethics-policy";
import { RIGHTS_DECLARATION_VERSION, ETHICS_DECLARATION_VERSION, AI_DISCLOSURE_VERSION } from "@/lib/domain/constants";
import { scanManuscript, manuscriptKind, kindMime, sha256Hex, MAX_UPLOAD_BYTES } from "@/lib/domain/file-security";
import { parseReferences } from "@/lib/domain/references";

/** Loose shape of the already zod-validated submission metadata (see submissionSchema in app.functions.ts). */
export interface SubmissionMeta {
  title: string; abstract: string; keywords: string[]; article_type: string; field: string; license: string; copyright_holder: string; language: string; references: string;
  authors: Array<{ full_name: string; email?: string | undefined; affiliation?: string | undefined; orcid?: string | undefined; is_corresponding: boolean; roles: string[] }>;
  funders: Array<{ funder_name: string; grant_number?: string | undefined }>;
  ai_disclosures: Array<Record<string, unknown>>;
  rights: RightsInput;
  ethics: {
    human_participants: boolean; animal_subjects: boolean; clinical_trial: boolean; ethics_approval: boolean; ethics_committee?: string | undefined; approval_number?: string | undefined;
    ethics_exempt: boolean; exemption_reason?: string | undefined; informed_consent: boolean; trial_registry?: string | undefined; trial_registration_number?: string | undefined;
    animal_protocol?: string | undefined; conflict_of_interest: string; funding: string; data_availability: string; ai_tools_used?: string | undefined; ai_none_used?: boolean | undefined;
    secondary_data_only?: boolean | undefined; subject?: SubjectDeclaration | undefined; trial?: TrialDeclaration | undefined;
  };
}

/** Subject/trial declarations. When the client did not send the explicit blocks, they are derived from the legacy answers
 *  WITHOUT assuming anything favourable: anything not stated stays NOT_APPLICABLE, which the policy then rejects where it applies. */
export function resolveEthicsBlocks(e: SubmissionMeta["ethics"]): { subject: SubjectDeclaration; trial: TrialDeclaration } {
  const subject: SubjectDeclaration = e.subject ?? {
    human_participants: e.human_participants, identifiable_info_present: false, deidentification_status: "NOT_APPLICABLE",
    informed_consent_status: e.human_participants ? (e.informed_consent ? "OBTAINED" : "NOT_OBTAINED") : "NOT_APPLICABLE",
    publication_consent_status: "NOT_APPLICABLE", waiver_status: "NOT_APPLICABLE",
    committee_approval_status: e.ethics_approval ? "APPROVED" : e.ethics_exempt ? "EXEMPT_DOCUMENTED" : "NOT_APPLICABLE",
    approval_reference: e.approval_number, privacy_sensitive_media: false,
  };
  const trial: TrialDeclaration = e.trial ?? { registration_status: "NOT_APPLICABLE", registry_name: e.trial_registry, registration_number: e.trial_registration_number };
  return { subject, trial };
}

export function evaluateSubmissionEthics(articleType: string, e: SubmissionMeta["ethics"]): { evaluation: EthicsEvaluation; subject: SubjectDeclaration; trial: TrialDeclaration } {
  const { subject, trial } = resolveEthicsBlocks(e);
  const evaluation = evaluateEthics({ articleType, animal_subjects: e.animal_subjects, clinical_trial: e.clinical_trial, secondary_data_only: e.secondary_data_only === true, animal_protocol: e.animal_protocol, ethics_exempt_reason: e.exemption_reason, subject, trial });
  return { evaluation, subject, trial };
}

export async function buildEthicsPayload(articleType: string, e: SubmissionMeta["ethics"]) {
  const { evaluation, subject, trial } = evaluateSubmissionEthics(articleType, e);
  if (evaluation.violations.length) throw new Error(`Ethics declaration incomplete: ${evaluation.violations.join(" ")}`);
  const { conflict_of_interest, funding, data_availability, subject: _s, trial: _t, ...answers } = e;
  void _s; void _t;
  return {
    ethics: { declaration_version: ETHICS_DECLARATION_VERSION, answers, conflict_of_interest, funding, data_availability },
    subject: { ...subject, human_participants: subject.human_participants },
    trial: { registration_required: evaluation.requiresTrialRegistration, registration_status: evaluation.requiresTrialRegistration || trial.registration_status !== "NOT_APPLICABLE" ? trial.registration_status : "NOT_APPLICABLE", registry_name: trial.registry_name, registration_number: trial.registration_number, registration_url: trial.registration_url, registration_date: trial.registration_date, verification_status: evaluation.trialVerificationStatus },
    case: { research_category: evaluation.category, requires_trial_registration: evaluation.requiresTrialRegistration, requires_publication_consent: evaluation.requiresPublicationConsent, requires_committee_approval: evaluation.requiresCommitteeApproval, initial_status: evaluation.initialStatus, reasons: evaluation.reasons },
    policy: { version: CURRENT_ETHICS_POLICY.version, hash: await ethicsPolicyHash(), rules: CURRENT_ETHICS_POLICY },
  };
}

export function rightsPayload(r: RightsInput) {
  return { ...r, declaration_version: RIGHTS_DECLARATION_VERSION, ai_disclosure_version: AI_DISCLOSURE_VERSION, previous_doi: r.previous_doi?.trim() || null, previous_publication_reference: r.previous_publication_reference?.trim() || null, third_party_permission: r.third_party_content ? r.third_party_permission === true : null };
}

// ---------- saga ports backed by Supabase ----------
const BUCKET = "manuscripts";
function supabasePorts(uid: string): SagaPorts {
  return {
    async claim(key, requestHash, correlationId): Promise<ClaimResult> {
      const { data, error } = await dbx.rpc("claim_submission_attempt", { _uid: uid, _key: key, _hash: requestHash, _correlation: correlationId });
      if (error) throw new SubmissionError(/IDEMPOTENCY_KEY_REUSED/.test(error.message) ? "This submission key was already used for a different manuscript. Reload the form and submit again." : "Could not start the submission. Please try again.", "REJECTED");
      const row = (Array.isArray(data) ? data[0] : data) as { o_attempt_id: string; o_paper_id: string; o_status: ClaimResult["status"]; o_owned: boolean };
      return { attemptId: row.o_attempt_id, paperId: row.o_paper_id, status: row.o_status, owned: row.o_owned };
    },
    async upload(f) { const r = await db.storage.from(BUCKET).upload(f.path, f.bytes, { contentType: kindMime(f.path.endsWith(".docx") ? "docx" : "pdf"), upsert: true }); return r.error ? { error: r.error.message } : {}; },
    async remove(paths) { const r = await db.storage.from(BUCKET).remove(paths); return r.error ? { error: r.error.message } : {}; },
    async commit(attemptId, payload) {
      const { data, error } = await dbx.rpc("commit_submission", { _attempt: attemptId, _p: payload });
      if (error) throw new Error(error.message);
      const d = data as { paper_id: string; replayed: boolean; eth_id?: string };
      return { paperId: d.paper_id, replayed: d.replayed, ethId: d.eth_id };
    },
    async attemptStatus(attemptId) {
      const { data, error } = await dbx.from("submission_attempts").select("status").eq("id", attemptId).maybeSingle();
      return error || !data ? "UNKNOWN" : (data.status as "STARTED" | "COMMITTED" | "FAILED");
    },
    async fail(attemptId, stage, message) { await dbx.rpc("fail_submission_attempt", { _attempt: attemptId, _stage: stage, _message: message }); },
    async quarantine(attemptId, path, reason) { await dbx.rpc("quarantine_storage_object", { _attempt: attemptId, _bucket: BUCKET, _path: path, _reason: reason }); },
    log,
  };
}

export async function submitPaperServer(uid: string, m: SubmissionMeta, file: File, anonymized: File | undefined, clientKey: string | undefined, ports: SagaPorts = supabasePorts(uid)) {
  const correlationId = crypto.randomUUID();
  const rejected = async (reasons: string[]) => {
    // No scholarly state exists yet. The attempt is still evidence, so it is audited (codes only, never document content).
    await audit({ actor_id: uid, action: "submission_rejected", resource_type: "submission", metadata: { correlation_id: correlationId, reason_count: reasons.length, article_type: m.article_type } });
    throw new Error(reasons.join(" "));
  };
  // 1-4: validate EVERYTHING before any persistent scholarly state or storage object exists.
  const rightsViolations = validateRights(m.rights, { authorCount: m.authors.length });
  if (rightsViolations.length) return rejected(rightsViolations);
  const { evaluation } = evaluateSubmissionEthics(m.article_type, m.ethics);
  if (evaluation.violations.length) return rejected(evaluation.violations);

  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is larger than 25 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scan = scanManuscript(bytes, file.name, file.type);
  if (!scan.passed) return rejected([`File rejected: ${scan.reasons.join("; ")}`]);
  const hash = await sha256Hex(bytes);
  let anonBytes: Uint8Array | null = null; let anonHash: string | null = null;
  if (anonymized) {
    if (anonymized.size > MAX_UPLOAD_BYTES) throw new Error("The anonymized file is larger than 25 MB");
    anonBytes = new Uint8Array(await anonymized.arrayBuffer());
    const s = scanManuscript(anonBytes, anonymized.name, anonymized.type);
    if (!s.passed) return rejected([`Anonymized file rejected: ${s.reasons.join("; ")}`]);
    anonHash = await sha256Hex(anonBytes);
  }
  const ethicsParts = await buildEthicsPayload(m.article_type, m.ethics);
  const { data: prof } = await db.from("profiles").select("display_name").eq("id", uid).single();
  const refs = parseReferences(m.references).slice(0, 500);

  // Idempotency: the browser sends one key per form; if it is missing the key is derived from the content, so a double
  // click of the same manuscript is still one paper.
  const requestHash = await sha256Hex(await canonicalJson({ m, hash, anonHash }));
  const idempotencyKey = clientKey && clientKey.length >= 8 ? clientKey : `auto-${(await sha256Hex(`${uid}:${hash}:${m.title.trim().toLowerCase()}`)).slice(0, 40)}`;

  // The certificate carries the author name entered in the submission form (corresponding author, else the first listed author),
  // not the account display name. Falls back to the profile name only if no author name is present.
  const certAuthor = (m.authors.find((a) => a.is_corresponding) ?? m.authors[0])?.full_name?.trim();

  const result = await runSubmissionSaga(ports, {
    idempotencyKey, requestHash, correlationId,
    build: (paperId) => {
      const path = `${uid}/${paperId}/v1.0-${hash.slice(0, 12)}.${manuscriptKind(file.name) ?? "pdf"}`;
      const anonPath = anonBytes && anonHash ? `${uid}/${paperId}/v1.0-anon-${anonHash.slice(0, 12)}.${manuscriptKind(anonymized!.name) ?? "pdf"}` : null;
      const files = [{ path, bytes }, ...(anonPath && anonBytes ? [{ path: anonPath, bytes: anonBytes }] : [])];
      return {
        files,
        payload: {
          paper: { title: m.title, abstract: m.abstract, keywords: m.keywords, article_type: m.article_type, field: m.field, license: m.license, copyright_holder: m.copyright_holder, language: m.language, references_text: m.references.trim() },
          authors: m.authors, funders: m.funders, ai_disclosures: m.ai_disclosures,
          references: refs.map((r, i) => ({ pos: i + 1, raw_text: r.raw.slice(0, 2000), doi: r.doi })),
          version: { storage_path: path, file_hash: hash, file_size: bytes.length, author_name: certAuthor || prof?.display_name || "Unknown", scan_result: scan, anonymized_storage_path: anonPath, anonymized_file_hash: anonHash },
          rights: rightsPayload(m.rights), ...ethicsParts,
        },
      };
    },
  });
  if (!result.replayed) await notify(uid, "submission_received", "We received your research paper", `“${m.title}” was submitted successfully. We will keep you updated by email and in your account.`, `/my-research/${result.paperId}`).catch(() => undefined);
  return { id: result.paperId, replayed: result.replayed };
}
