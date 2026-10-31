import { extractText, getDocumentProxy } from "unpdf";
import { db, dbx, audit, notify, transition, getStatus, log, certificateSiteUrl } from "./core.server";
import { AIUnavailableError, MAX_MANUSCRIPT_CHARS, createDbBudgetStore, getAIProvider, PROMPT_VERSION, summarizeAiFailure } from "./ai-provider.server";
import { normalizeAssessment, type NormalizedAssessment } from "@/lib/domain/ai-schema";
import { evaluatePolicy, selectPolicyKey, type DeterministicSignals, type Policy, type PolicyRules } from "@/lib/domain/decision-engine";
import { CLINICAL_ARTICLE_TYPES } from "@/lib/domain/constants";
import { scanManuscript, extractDocxText, sha256Hex } from "@/lib/domain/file-security";
import { detectPromptInjection } from "@/lib/domain/injection";
import { sampleManuscript, summarizeVerification, verifyAssessment, type VerificationReport } from "@/lib/domain/ai-verification";
import { compareAgainstCorpus, extractDois } from "@/lib/domain/similarity";
import { renderCertificatePdf, describeRecord } from "@/lib/domain/certificate-pdf";
import { getDoiProvider } from "@/lib/domain/doi-provider";
import { isSandboxDoi, zenodoEnabledFor } from "@/lib/domain/zenodo";
const zenodoEnabled = () => zenodoEnabledFor(process.env);
import { measureAiAssistance, combineMeter } from "@/lib/domain/ai-meter";
import { RESEARCH_ETHICS_ENABLED } from "@/lib/domain/constants";

// ---------------- text extraction ----------------
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t, i) => `[page ${i + 1}]\n${t}`).join("\n\n");
}

async function checkDois(dois: string[]) {
  const MAX = 60; // keep screening inside the request budget; the rest is reported as unchecked
  const list = dois.slice(0, MAX);
  let invalid = 0; let unreachable = 0; const details: string[] = [];
  const queue = [...list];
  // Crossref can be slow: stop starting new lookups after 25 s so the AI step still has time inside the request, and report the rest as unchecked.
  const stopAt = Date.now() + 25_000;
  const worker = async () => {
    for (let doi = queue.shift(); doi; doi = queue.shift()) {
      if (Date.now() > stopAt) { unreachable++; details.push(`${doi}: not checked (time limit)`); continue; }
      try {
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
          headers: { "User-Agent": "Paperly/1.0 (mailto:integrity@paperly.example; citation-check)" }, signal: AbortSignal.timeout(6000),
        });
        if (res.status === 404) { invalid++; details.push(`${doi}: not found in Crossref`); }
        else if (!res.ok) { unreachable++; details.push(`${doi}: could not be checked (HTTP ${res.status})`); }
      } catch { unreachable++; details.push(`${doi}: could not be checked (network)`); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (dois.length > MAX) details.push(`${dois.length - MAX} further DOIs were not checked`);
  return { checked: list.length - unreachable, invalid, details };
}

async function loadActivePolicy(key: string): Promise<Policy> {
  const { data } = await db.from("decision_policies").select("policy_key, version, rules").eq("policy_key", key).eq("is_active", true)
    .order("created_at", { ascending: false }).limit(1).single();
  if (!data) throw new Error(`No active policy ${key}`);
  return { key: data.policy_key, version: data.version, rules: data.rules as unknown as PolicyRules };
}


// ---------------- screening ----------------
/** A run still RUNNING this long after it started was abandoned (the process was stopped or the platform timed the request out). */
const STALE_RUN_MS = 10 * 60_000;

/** Marks abandoned runs FAILED so the paper is never blocked forever by a run that nobody is working on. Returns how many were closed. */
export async function reapStaleScreeningRuns(paperId: string, olderThanMs = STALE_RUN_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data } = await db.from("ai_runs")
    .update({ status: "FAILED", error: "abandoned: no completion was recorded (process stopped or request timed out)", completed_at: new Date().toISOString() })
    .eq("paper_id", paperId).in("status", ["QUEUED", "RUNNING"]).lt("started_at", cutoff).select("id");
  const n = data?.length ?? 0;
  if (n > 0) { log("screening_stale_run_reaped", { paper_id: paperId, runs: n }); await audit({ actor_type: "SYSTEM", action: "ai_run_abandoned", resource_type: "paper", resource_id: paperId, metadata: { runs: n } }); }
  return n;
}

async function hasActiveRun(paperId: string): Promise<boolean> {
  const { data } = await db.from("ai_runs").select("id").eq("paper_id", paperId).in("status", ["QUEUED", "RUNNING"]).limit(1);
  return (data?.length ?? 0) > 0;
}

/** Entry point. Once the paper has entered PROCESSING, ANY unexpected failure routes it to a human editor instead of leaving it stuck:
 *  the submission, the manuscript and the payment are never touched, and a person screens it manually. */
export async function runScreening(paperId: string, actorId: string | null, origin: string) {
  const entered = { value: false };
  try {
    return await screenPaper(paperId, actorId, origin, entered);
  } catch (e) {
    // Before the paper entered PROCESSING nothing was started, so the caller sees the real error. Losing a race (illegal transition) is not a failure either.
    if (!entered.value || (e instanceof Error && /Illegal paper transition/.test(e.message))) throw e;
    return routeScreeningErrorToHuman(paperId, e);
  }
}

async function routeScreeningErrorToHuman(paperId: string, cause: unknown) {
  const msg = summarizeAiFailure(cause);
  log("screening_error_routed_to_human", { paper_id: paperId, error: msg.slice(0, 300) });
  try {
    await db.from("ai_runs").update({ status: "FAILED", error: msg, completed_at: new Date().toISOString() }).eq("paper_id", paperId).in("status", ["QUEUED", "RUNNING"]);
    const status = await getStatus(paperId);
    if (status !== "PROCESSING" && status !== "AI_SCREENING") return { skipped: true as const, status: String(status) }; // someone else already moved it on
    await transition(paperId, "REVIEW_REQUIRED", null, "SYSTEM", "automated screening hit an unexpected error; routed to editor for manual screening");
    await audit({ actor_type: "SYSTEM", action: "screening_error_routed_to_human", resource_type: "paper", resource_id: paperId, metadata: { error: msg.slice(0, 300) } });
    const { data: p } = await db.from("papers").select("owner_id").eq("id", paperId).maybeSingle();
    if (p?.owner_id) await notify(p.owner_id, "screening_complete", "Your submission is with an editor", "Automated screening could not finish, so your submission goes straight to an editor for manual screening. Nothing was lost and this is not an editorial decision.", `/my-research/${paperId}`);
    return { skipped: false as const, status: "REVIEW_REQUIRED" as const, outcome: "REVIEW_REQUIRED" as const, aiUnavailable: true };
  } catch (e2) {
    // Even the safety net failed (database unreachable). The paper stays in PROCESSING and a retry is possible; surface the ORIGINAL problem.
    log("screening_safety_net_failed", { paper_id: paperId, error: e2 instanceof Error ? e2.message.slice(0, 200) : "unknown" });
    throw cause instanceof Error ? cause : new Error(msg);
  }
}

async function screenPaper(paperId: string, actorId: string | null, origin: string, entered: { value: boolean }) {
  let status = await getStatus(paperId);
  // Paywall: nothing is screened until the fee is paid. Papers already past SUBMITTED (retries, older papers) are unaffected.
  if (status === "SUBMITTED" && !(await (await import("./payments.server")).feeCleared(paperId))) return { skipped: true, status: "PAYMENT_REQUIRED" };
  if (status === "SUBMITTED" || status === "AI_SCREENING" || status === "PROCESSING") {
    await reapStaleScreeningRuns(paperId);
    // A live run means another request is screening this paper right now: do not start a second one (it would spend AI budget twice).
    if (await hasActiveRun(paperId)) return { skipped: true, status };
  }
  if (status === "SUBMITTED" || status === "AI_SCREENING") {
    await transition(paperId, "PROCESSING", actorId, "SYSTEM", status === "AI_SCREENING" ? "screening retry" : "screening started");
    status = "PROCESSING";
  }
  if (status !== "PROCESSING") return { skipped: true, status };
  entered.value = true;

  const { data: paper } = await db.from("papers").select("*").eq("id", paperId).single();
  if (!paper?.current_version_id) throw new Error("Paper has no manuscript version");
  const [{ data: version }, { data: authors }, { data: rights }, { data: ethics }] = await Promise.all([
    db.from("paper_versions").select("*").eq("id", paper.current_version_id).single(),
    db.from("paper_authors").select("*").eq("paper_id", paperId).order("position"),
    db.from("rights_declarations").select("*").eq("paper_id", paperId).order("revision", { ascending: false }).limit(1).maybeSingle(),
    db.from("ethics_declarations").select("*").eq("paper_id", paperId).order("revision", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!version) throw new Error("Version missing");

  const file = await db.storage.from("manuscripts").download(version.storage_path);
  if (file.error || !file.data) throw new Error("Manuscript file unavailable");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const isDocx = /\.docx$/i.test(version.storage_path);
  const scan = scanManuscript(bytes, isDocx ? "manuscript.docx" : "manuscript.pdf", "");
  if (hash !== version.file_hash) { scan.passed = false; scan.reasons.push("Stored file hash mismatch"); }

  let text = "";
  if (scan.passed) {
    try { text = isDocx ? await extractDocxText(bytes) : await extractPdfText(bytes); } catch { scan.warnings.push("Text extraction failed"); }
  }
  const injection = detectPromptInjection(text + "\n" + paper.abstract + "\n" + paper.title);
  const stylometry = text ? measureAiAssistance(text) : null;

  // Similarity against published records + exact duplicate detection
  const { data: corpus } = await db.from("papers").select("id, title, abstract").in("status", ["PUBLISHED", "CORRECTED", "RETRACTED"]).neq("id", paperId).limit(500);
  const sim = compareAgainstCorpus(`${paper.title} ${paper.abstract}`, (corpus ?? []).map((c) => ({ id: c.id, title: c.title, text: `${c.title} ${c.abstract}` })));
  const { data: dup } = await db.from("paper_versions").select("id").eq("file_hash", version.file_hash).neq("paper_id", paperId).limit(1);
  const citations = await checkDois(extractDois(text));

  const ans = (ethics?.answers ?? {}) as Record<string, unknown>;
  const str = (k: string) => typeof ans[k] === "string" && (ans[k] as string).trim().length > 0;
  const signals: DeterministicSignals = {
    security: { passed: scan.passed, reasons: scan.reasons },
    rights: {
      present: !!rights,
      is_author_or_authorised: !!rights && (rights.is_author || rights.coauthor_permission),
      has_upload_rights: !!rights?.has_upload_rights,
      third_party_unresolved: !!rights?.third_party_content && !rights?.third_party_permission,
      ai_consent: !!rights?.ai_processing_consent,
      previously_published_publisher_version: !!rights?.previously_published && rights?.manuscript_version_type === "PUBLISHER_VERSION",
    },
    ethics: {
      human_participants_declared: ans["human_participants"] === true,
      animal_subjects_declared: ans["animal_subjects"] === true,
      clinical_trial_declared: ans["clinical_trial"] === true,
      approval_provided: ans["ethics_exempt"] === true ? str("exemption_reason") : (ans["ethics_approval"] === true && str("ethics_committee") && str("approval_number")),
      consent_provided: ans["informed_consent"] === true || ans["consent_waived"] === true,
      trial_registration_provided: str("trial_registry") && str("trial_registration_number"),
      animal_approval_provided: str("animal_protocol"),
    },
    injection,
    similarity: { max_percentage: sim.max_percentage, risk: sim.risk, duplicate_file: (dup?.length ?? 0) > 0 },
    citations,
    metadata: {
      has_title: paper.title.trim().length > 3, has_abstract: paper.abstract.trim().length > 50,
      has_authors: (authors?.length ?? 0) > 0, has_corresponding: !!authors?.some((a) => a.is_corresponding),
      has_keywords: paper.keywords.length > 0, text_chars: text.length,
    },
  };

  const policy = await loadActivePolicy(selectPolicyKey(paper.article_type, CLINICAL_ARTICLE_TYPES, signals.ethics.human_participants_declared));
  await transition(paperId, "AI_SCREENING", actorId, "SYSTEM", "deterministic checks complete");

  // The ledger lives in the database (migration 0026): reservations are atomic, so concurrent screenings share one budget.
  const provider = getAIProvider(createDbBudgetStore(dbx));
  const useAI = scan.passed && signals.rights.ai_consent && text.length > 0;
  const inputHash = await sha256Hex(JSON.stringify({ v: version.file_hash, prompt: PROMPT_VERSION, policy: `${policy.key}@${policy.version}` }));
  const { data: run, error: runErr } = await db.from("ai_runs").insert({
    paper_id: paperId, version_id: version.id, status: "RUNNING",
    provider: useAI ? provider.provider : "none", model_name: useAI ? provider.model : "none", model_version: useAI ? provider.model : null,
    policy_key: policy.key, policy_version: policy.version, prompt_version: PROMPT_VERSION,
    privacy_mode: useAI ? provider.privacyMode : "NO_EXTERNAL_PROCESSING", input_hash: inputHash,
    deterministic_signals: { ...signals, similarity_matches: sim.matches, scan_warnings: scan.warnings, ai_meter: stylometry ? combineMeter(stylometry, null, ans["ai_tools_used"] as string | undefined, ans["ai_none_used"] === true) : null } as never,
  }).select("id").single();
  // 23505 = the one-active-run index (migration 0026): another request already opened a run for this version.
  if (runErr?.code === "23505") return { skipped: true as const, status: "AI_SCREENING" as const };
  if (runErr || !run) throw new Error(runErr?.message ?? "Could not create AI run");
  await audit({ actor_type: "SYSTEM", action: "ai_started", resource_type: "paper", resource_id: paperId, metadata: { ai_run_id: run.id, model: provider.model, policy: `${policy.key}@${policy.version}`, external: useAI } });

  let assessment: NormalizedAssessment | null = null;
  let verification: VerificationReport | null = null;
  let aiFailed = false; // the AI step is advisory: if it cannot run, the paper still goes to a human editor instead of waiting forever
  const started = Date.now();
  if (useAI) {
    try {
      // Long manuscripts are sampled (start and end) rather than cut off, and the model is told what it did not see.
      const sample = sampleManuscript(text, MAX_MANUSCRIPT_CHARS - 2000);
      const out = await provider.analyzeDocument({
        title: paper.title, abstract: paper.abstract, keywords: paper.keywords, articleType: paper.article_type, field: paper.field,
        authors: (authors ?? []).map((a) => ({ name: a.full_name, affiliation: a.affiliation, orcid: a.orcid, corresponding: a.is_corresponding })),
        declarations: { rights: rights ? { ...rights, id: undefined, user_id: undefined } : null, ethics: ethics ? { answers: ethics.answers, coi: ethics.conflict_of_interest, funding: ethics.funding, data: ethics.data_availability } : null },
        manuscriptText: sample.text,
        ...(sample.coverage.partial ? { coverageNote: `PARTIAL. The manuscript is ${sample.coverage.totalChars} characters; only the first and last parts (${sample.coverage.sentChars} characters) are included, with a marker where the middle was omitted.` } : {}),
      }, paperId);
      // Check the model's answer against the manuscript and the hard facts before anyone relies on it.
      const checked = verifyAssessment(normalizeAssessment(out.result), signals, text, sample.coverage);
      assessment = checked.assessment; verification = checked.report;
      // Every persistence step is checked: a half-saved assessment must not be presented to the editor as a finished one.
      const must = (r: { error: { message: string } | null }, what: string) => { if (r.error) throw new Error(`Could not save AI ${what}: ${r.error.message}`); };
      // Record which provider actually answered (the run was opened with the generic multi-provider label).
      if (out.provider) must(await db.from("ai_runs").update({ provider: out.provider, model_name: out.model ?? provider.model, model_version: out.model ?? provider.model }).eq("id", run.id), "provider");
      if (stylometry) {
        const meter = combineMeter(stylometry, assessment.signals.ai_generated_text_likelihood, ans["ai_tools_used"] as string | undefined, ans["ai_none_used"] === true);
        must(await db.from("ai_runs").update({ deterministic_signals: { ...signals, similarity_matches: sim.matches, scan_warnings: scan.warnings, ai_meter: meter } as never }).eq("id", run.id), "meter");
      }
      must(await db.from("ai_runs").update({ structured_result: assessment as never, output_hash: await sha256Hex(out.raw), latency_ms: Date.now() - started }).eq("id", run.id), "result");
      if (assessment.findings.length) {
        must(await db.from("ai_findings").insert(assessment.findings.map((f) => ({
          ai_run_id: run.id, paper_id: paperId, check_key: f.key, status: f.status, severity: f.severity, message: f.message, evidence: f.evidence as never,
        }))), "findings");
      }
    } catch (e) {
      // Provider failure, budget/quota exhaustion, timeout, invalid output, or a persistence error: all end the same way, safely.
      // The assessment is discarded so the policy engine and the editor never see a half-finished one; a human screens the paper.
      assessment = null;
      const msg = summarizeAiFailure(e);
      log("ai_provider_failure", { paper_id: paperId, ai_run_id: run.id, reason: e instanceof AIUnavailableError ? e.reason : "ERROR", error: msg.slice(0, 300), latency_ms: Date.now() - started });
      await db.from("ai_runs").update({ status: "FAILED", error: msg, completed_at: new Date().toISOString(), latency_ms: Date.now() - started }).eq("id", run.id);
      await audit({ actor_type: "SYSTEM", action: "ai_failed", resource_type: "paper", resource_id: paperId, metadata: { ai_run_id: run.id, reason: e instanceof AIUnavailableError ? e.reason : "ERROR", budget_exhausted: e instanceof AIUnavailableError ? e.budgetExhausted : false } });
      aiFailed = true;
    }
  }

  // Automated screening is informational. The policy engine's result is stored as a RECOMMENDATION
  // for the editor; the paper is always routed to human editorial review. It is never an acceptance,
  // rejection or peer review.
  // Advisory only: the screen may route an ethics case to a HUMAN. The database refuses any AI transition other than
  // "needs human review", so this cannot clear, reject or start an ethics review.
  if (RESEARCH_ETHICS_ENABLED && assessment?.findings.some((f) => f.key === "ethics" && f.status !== "PASS" && f.status !== "NOT_APPLICABLE")) {
    try {
      const { escalateEthicsFromScreening } = await import("./ethics.server");
      await escalateEthicsFromScreening(paperId, run.id);
    } catch (e) { log("ethics_ai_escalation_failed", { paper_id: paperId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); }
  }
  const decision = evaluatePolicy({ policy, signals, assessment });
  if (!aiFailed) {
    const done = await db.from("ai_runs").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", run.id);
    if (done.error) log("ai_run_complete_update_failed", { paper_id: paperId, ai_run_id: run.id, error: done.error.message.slice(0, 200) });
  }
  const dec = await db.from("decisions").insert({
    paper_id: paperId, version_id: version.id, ai_run_id: run.id, source: "MACHINE", outcome: "REVIEW_REQUIRED",
    policy_key: decision.policy_key, policy_version: decision.policy_version, reasons: decision.reasons as never,
    check_summary: { ...(decision.check_summary as Record<string, unknown>), automated_recommendation: decision.outcome, informational_only: true, ai_unavailable: aiFailed, ...(verification ? summarizeVerification(verification) : {}) } as never,
  });
  // The recommendation is advisory. If it cannot be stored the paper STILL goes to a human (the safe outcome); the failure is logged and audited.
  if (dec.error) {
    log("screening_decision_insert_failed", { paper_id: paperId, ai_run_id: run.id, error: dec.error.message.slice(0, 200) });
    await audit({ actor_type: "SYSTEM", action: "screening_recommendation_not_saved", resource_type: "paper", resource_id: paperId, metadata: { ai_run_id: run.id } });
  }
  await audit({ actor_type: "SYSTEM", action: "screening_completed", resource_type: "paper", resource_id: paperId, new_value: { classification: "INFORMATION_FLAG_FOR_HUMAN_REVIEW", automated_recommendation: decision.outcome }, metadata: { ai_run_id: run.id, model: useAI ? provider.model : null, policy_version: `${policy.key}@${policy.version}` } });
  await transition(paperId, "REVIEW_REQUIRED", null, "SYSTEM", aiFailed ? `automated AI screening unavailable (${policy.key}@${policy.version}); routed to editor for manual screening` : `automated screening complete (${policy.key}@${policy.version}); routed to editor`, false, { ai_run_id: run.id });
  await notify(paper.owner_id, "screening_complete", "Automated screening complete", aiFailed ? "Automated AI screening could not run, so your submission goes straight to an editor for manual screening. This is not an editorial decision." : "Automated screening is not peer review and is not an editorial decision. Your submission is waiting for an editor.", `/my-research/${paperId}`);
  void origin;
  return { skipped: false, status: "REVIEW_REQUIRED" as const, outcome: "REVIEW_REQUIRED" as const, aiUnavailable: aiFailed };
}

// ---------------- certificates ----------------
export async function issueCertificate(args: {
  paperId: string; versionId: string; recipientId: string | null; recipientName: string; type: "SUBMISSION" | "PUBLICATION" | "PEER_REVIEW" | "AUTHOR_RECORD"; role: string; origin: string; actorId?: string | null;
  /** A listed author without (or besides) an account: the certificate is tied to this paper_authors row and e-mailed to recipientEmail. */
  recipientAuthorId?: string | null; recipientEmail?: string | null;
  /** True when the caller e-mails all of a paper's certificates together in one message (see queueCertificateBundleEmails), so no single e-mail is sent here. */
  holdMail?: boolean;
}) {
  if (!args.recipientId && !args.recipientAuthorId) throw new Error("A certificate needs a recipient");
  if (args.type === "PEER_REVIEW") {
    if (!args.recipientId) throw new Error("Peer review certificate requires a reviewer account");
    const { data: ra } = await db.from("review_assignments").select("id").eq("paper_id", args.paperId).eq("reviewer_id", args.recipientId).eq("status", "COMPLETED").maybeSingle();
    if (!ra) throw new Error("Peer review certificate requires a completed review assignment");
  }
  if (!args.recipientName.trim()) throw new Error("A recorded recipient name is required");
  const { data: paper } = await db.from("papers").select("title, public_id, paperly_id, doi, published_at, status, is_test").eq("id", args.paperId).single();
  if (!paper) throw new Error("Paper not found");
  if (args.type === "PUBLICATION" && !["PUBLISHED", "CORRECTED"].includes(paper.status)) throw new Error("Paper is not published");

  // A paper marked Test (admin "Test publish") gets certificates named Test, flagged is_test.
  const isTest = !!(paper as unknown as { is_test?: boolean }).is_test && args.type !== "PEER_REVIEW";
  if (isTest) args = { ...args, recipientName: "Test" };
  let fresh = false;
  const findCert = () => {
    const q = db.from("certificates").select("*").eq("paper_id", args.paperId).eq("version_id", args.versionId).eq("certificate_type", args.type).not("status", "in", "(REVOKED,SUPERSEDED)");
    return (args.recipientAuthorId ? q.eq("recipient_author_id", args.recipientAuthorId) : q.eq("recipient_user_id", args.recipientId as string)).maybeSingle();
  };
  let { data: cert } = await findCert();
  if (!cert) {
    const { data: ov } = args.recipientId ? await db.from("orcid_verifications").select("orcid").eq("user_id", args.recipientId).maybeSingle() : { data: null };
    // A reviewer's certificate never names the manuscript or links to it: a public, guessable certificate ID must not reveal who reviewed which paper.
    // It carries an opaque reference instead (derived from the paper and the reviewer, so it cannot be traced back without both).
    const confidential = args.type === "PEER_REVIEW";
    const reviewRef = confidential ? `PR-${(await sha256Hex(`${args.paperId}:${args.recipientId}:${args.versionId}`)).slice(0, 10).toUpperCase()}` : null;
    const ins = await db.from("certificates").insert({
      paper_id: args.paperId, version_id: args.versionId, recipient_user_id: args.recipientId, recipient_author_id: args.recipientAuthorId ?? null, recipient_email: args.recipientEmail ?? null, recipient_name_at_issue: args.recipientName, is_test: isTest,
      certificate_type: args.type, author_role: args.role, orcid_at_issue: ov?.orcid ?? null, paper_title_at_issue: confidential ? `Peer review ${reviewRef}` : paper.title, article_public_id: confidential ? (reviewRef as string) : paper.paperly_id ?? paper.public_id,
      doi_at_issue: confidential ? null : paper.doi, publication_date: args.type === "SUBMISSION" || confidential ? null : paper.published_at,
    }).select("*").single();
    if (ins.error) {
      // Unique-constraint race: another request issued it; reuse.
      const again = await findCert();
      cert = again.data;
    } else {
      cert = ins.data;
      fresh = true;
      await db.from("certificate_events").insert({ certificate_id: cert.id, event: "ISSUED", actor_id: args.actorId ?? null });
      await audit({ actor_id: args.actorId ?? null, actor_type: args.actorId ? "USER" : "SYSTEM", action: "certificate_issued", resource_type: "certificate", resource_id: cert.certificate_id, new_value: { type: args.type, paper: paper.public_id } });
      if (args.recipientId) await notify(args.recipientId, "certificate_issued", "Certificate issued", `${cert.certificate_id} (${args.type.toLowerCase()}) is available.`, "/certificates");
    }
  }
  if (!cert) throw new Error("Certificate issuance failed");
  const needsDocument = !cert.document_hash;
  if (needsDocument) await generateCertificateDocument(cert.id, args.origin);
  // E-mail the certificate (PDF attached) once the document exists. The outbox key makes a repeat call a no-op.
  if ((fresh || needsDocument) && !args.holdMail) await (await import("./mail.server")).queueCertificateEmail(cert.id);
  return cert.certificate_id;
}

/** Issues the reviewer's certificate for a completed review (idempotent). Never throws: it must not undo or block submitting a review. */
export async function issueReviewerCertificate(assignmentId: string, origin = "") {
  try {
    const { data: a } = await db.from("review_assignments").select("id, paper_id, reviewer_id, status").eq("id", assignmentId).maybeSingle();
    if (!a || a.status !== "COMPLETED") return null;
    const { data: paper } = await db.from("papers").select("current_version_id, deleted_at").eq("id", a.paper_id).maybeSingle();
    if (!paper?.current_version_id || paper.deleted_at) return null;
    const { data: prof } = await db.from("profiles").select("display_name").eq("id", a.reviewer_id).maybeSingle();
    const name = (prof?.display_name ?? "").trim();
    if (name.length < 2) return null;
    return await issueCertificate({ paperId: a.paper_id, versionId: paper.current_version_id, recipientId: a.reviewer_id, recipientName: name, type: "PEER_REVIEW", role: "Peer reviewer", origin, actorId: null });
  } catch (e) { log("reviewer_certificate_failed", { assignmentId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); return null; }
}

/** Daily sweep helper: completed reviews from the last 30 days that have no certificate yet (for example reviews finished before this feature existed, or a failed attempt). */
export async function retryReviewerCertificates(origin: string, limit = 20) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await db.from("review_assignments").select("id, paper_id, reviewer_id").eq("status", "COMPLETED").gte("completed_at", since).order("completed_at", { ascending: false }).limit(100);
  let issued = 0, checked = 0;
  for (const a of data ?? []) {
    if (checked >= limit) break;
    const { data: have } = await db.from("certificates").select("id").eq("paper_id", a.paper_id).eq("recipient_user_id", a.reviewer_id).eq("certificate_type", "PEER_REVIEW").limit(1);
    if ((have?.length ?? 0) > 0) continue;
    checked++;
    if (await issueReviewerCertificate(a.id, origin)) issued++;
  }
  return { checked, issued };
}

/** Idempotent: re-renders deterministically with the same ID and data; hash is written once. */
export async function generateCertificateDocument(certUuid: string, origin: string) {
  const { data: c } = await db.from("certificates").select("*").eq("id", certUuid).single();
  if (!c) throw new Error("Certificate not found");
  const { data: rec } = await db.from("papers").select("publication_type, peer_reviewed, status, review_waived").eq("id", c.paper_id).single();
  const facts = describeRecord(rec?.publication_type ?? "REPOSITORY_RECORD", !!rec?.peer_reviewed, rec?.status ?? "", !!rec?.review_waived);
  const pdf = await renderCertificatePdf({
    ...facts,
    certificateId: c.certificate_id, type: c.certificate_type, recipientName: c.recipient_name_at_issue, authorRole: c.author_role, orcid: c.orcid_at_issue ?? null,
    paperTitle: c.paper_title_at_issue, articleId: c.article_public_id, doi: c.doi_at_issue, doiSandbox: !!c.doi_at_issue && isSandboxDoi(c.doi_at_issue), publicationDate: c.publication_date,
    issuedAt: c.issued_at, verificationUrl: `${certificateSiteUrl(origin)}/verify/certificate/${c.certificate_id}?t=${c.verification_token}`,
  });
  const hash = await sha256Hex(pdf);
  if (c.document_hash && c.document_hash !== hash) {
    log("certificate_regeneration_mismatch", { certificate: c.certificate_id });
    return c.document_hash; // never overwrite the recorded fingerprint
  }
  const path = `${c.certificate_id}.pdf`;
  const up = await db.storage.from("certificates").upload(path, pdf, { contentType: "application/pdf", upsert: !c.document_hash });
  if (up.error && !/exists/i.test(up.error.message)) { log("certificate_generation_failure", { certificate: c.certificate_id, error: up.error.message }); throw new Error("Certificate storage failed"); }
  if (!c.document_hash) await db.from("certificates").update({ document_hash: hash, storage_path: path }).eq("id", c.id);
  return hash;
}

// ---------------- publication ----------------
/** Publishes straight after editorial approval (the fee is already settled). It never throws: if anything fails the paper stays in
 *  PUBLICATION_PENDING, the failure is recorded, and staff (or the daily sweep) can publish it from the queue. */
async function zenodoRegistered(paperId: string) {
  const { data } = await dbx.from("doi_records").select("workflow_status").eq("paper_id", paperId).maybeSingle();
  return data?.workflow_status === "registered";
}

export async function autoPublish(paperId: string, origin: string) {
  try {
    const { data: gone } = await db.from("papers").select("deleted_at").eq("id", paperId).maybeSingle();
    if (gone?.deleted_at) return { published: false as const, error: "removed" };
    // With Zenodo enabled, publication waits for the explicit editor approval and a confirmed DOI (see zenodo.server.ts); the sweep there finishes it.
    if (zenodoEnabled() && !(await zenodoRegistered(paperId))) return { published: false as const, error: "awaiting explicit publication approval and DOI registration" };
    await publishPaper(paperId, null, certificateSiteUrl(origin));
    return { published: true as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("auto_publish_failed", { paper_id: paperId, error: msg.slice(0, 300) });
    await audit({ actor_id: null, actor_type: "SYSTEM", action: "auto_publish_failed", resource_type: "paper", resource_id: paperId, metadata: { error: msg.slice(0, 300) } });
    return { published: false as const, error: msg };
  }
}

/** Safety net: publishes any paper that was approved but is still waiting in production. Returns counts only. */
export async function publishWaiting(origin: string, limit = 5) {
  const { data } = await db.from("papers").select("id").eq("status", "PUBLICATION_PENDING").is("deleted_at", null).order("updated_at", { ascending: true }).limit(limit);
  let published = 0, failed = 0;
  for (const p of data ?? []) { (await autoPublish(p.id, origin)).published ? published++ : failed++; }
  return { waiting: (data ?? []).length, published, failed };
}

export async function publishPaper(paperId: string, actorId: string | null, origin: string) {
  if ((await getStatus(paperId)) !== "PUBLICATION_PENDING") throw new Error("Paper is not ready for publication");
  const { data: paper } = await db.from("papers").select("*").eq("id", paperId).single();
  const { data: authorRows } = await db.from("paper_authors").select("full_name, orcid, user_id").eq("paper_id", paperId).order("position");
  const uids = (authorRows ?? []).map((a) => a.user_id).filter((u): u is string => !!u);
  const { data: ver } = uids.length ? await db.from("orcid_verifications").select("user_id, orcid").in("user_id", uids) : { data: [] as Array<{ user_id: string; orcid: string }> };
  const vmap = new Map((ver ?? []).map((v) => [v.user_id, v.orcid]));
  // Only ORCID iDs the author proved through ORCID sign-in are sent to the DOI agency.
  const authors = (authorRows ?? []).map((a) => ({ full_name: a.full_name, orcid: a.user_id && vmap.get(a.user_id) === a.orcid ? a.orcid : null }));
  if (!paper) throw new Error("Not found");

  // DOI. With Zenodo enabled the DOI was registered and verified BEFORE this point (approveAndRegister); it is only read here, never created.
  // Otherwise the existing provider path runs unchanged (NOT_CONFIGURED until an agency agreement exists). Never invent a DOI.
  let doiResult: { status: string; doi: string | null; error?: string };
  if (zenodoEnabled()) {
    const { data: zr } = await dbx.from("doi_records").select("doi, workflow_status").eq("paper_id", paperId).maybeSingle();
    if (zr?.workflow_status !== "registered" || !zr.doi) throw new Error("DOI registration is not complete; the paper stays in production until Zenodo confirms the DOI");
    await db.from("papers").update({ doi: zr.doi }).eq("id", paperId);
    doiResult = { status: "VERIFIED", doi: zr.doi };
  } else {
    const doiProvider = getDoiProvider();
    const meta = { title: paper.title, authors: authors.map((a) => ({ name: a.full_name, orcid: a.orcid })), publicationDate: new Date().toISOString().slice(0, 10), url: `${origin}/article/${paper.paperly_id}`, publicId: paper.paperly_id, license: paper.license, abstract: paper.abstract };
    const { data: existingDoi } = await db.from("doi_records").select("*").eq("paper_id", paperId).maybeSingle();
    let r = existingDoi?.doi ? await doiProvider.verify(existingDoi.doi, meta) : await doiProvider.register(meta, paper.paperly_id);
    if (r.status === "REGISTERED" && r.doi) r = await doiProvider.verify(r.doi, meta);
    await db.from("doi_records").upsert({
      paper_id: paperId, provider: doiProvider.name, status: r.status, doi: r.status === "VERIFIED" ? r.doi : existingDoi?.doi ?? null,
      metadata: meta as never, last_error: r.error ?? null, updated_at: new Date().toISOString(),
      verified_at: r.status === "VERIFIED" ? new Date().toISOString() : null,
    }, { onConflict: "paper_id" });
    if (r.status === "VERIFIED" && r.doi) await db.from("papers").update({ doi: r.doi }).eq("id", paperId);
    doiResult = r;
  }
  await transition(paperId, "PUBLISHED", actorId, actorId ? "USER" : "SYSTEM", "publication");
  await audit({ actor_id: actorId, actor_type: actorId ? "USER" : "SYSTEM", action: "publication_created", resource_type: "paper", resource_id: paperId, metadata: { doi_status: doiResult.status } });

  await issueOwnerPublicationCertificate(paperId, origin, actorId);
  await notify(paper.owner_id, "published", "Your work is published", `${paper.public_id} is now publicly available.`, `/article/${paper.paperly_id}`);
  // One certificate per other listed author (skipping any on hold), then one e-mail per recipient with all certificates. Never blocks or undoes the publication.
  try { await issueAuthorCertificates(paperId, origin); } catch (e) { log("author_certificates_failed", { paperId, error: e instanceof Error ? e.message : "unknown" }); }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Author rows an administrator has put on hold: they get no certificate and no certificate e-mail until the hold is lifted. */
export async function heldAuthorIds(paperId: string): Promise<Set<string>> {
  const { data } = await dbx.from("author_certificate_holds").select("author_id").eq("paper_id", paperId);
  return new Set(((data ?? []) as Array<{ author_id: string }>).map((r) => r.author_id));
}

/** The uploader's own PUBLICATION certificate. It carries the name of their own author entry (the one linked to their account), else the recorded submission name.
 *  Skipped while that author entry is on hold. */
export async function issueOwnerPublicationCertificate(paperId: string, origin: string, actorId: string | null) {
  const { data: paper } = await db.from("papers").select("owner_id, current_version_id").eq("id", paperId).single();
  if (!paper?.current_version_id) throw new Error("Publication version is missing");
  const { data: v } = await db.from("paper_versions").select("author_name_at_submission").eq("id", paper.current_version_id).single();
  if (!v?.author_name_at_submission.trim()) throw new Error("Recorded author name is missing");
  const { data: rows } = await db.from("paper_authors").select("id, full_name, user_id").eq("paper_id", paperId).order("position");
  const ownerRow = (rows ?? []).find((a) => a.user_id === paper.owner_id);
  if (ownerRow && (await heldAuthorIds(paperId)).has(ownerRow.id)) return null;
  const ownerName = ownerRow?.full_name?.trim() || v.author_name_at_submission;
  return issueCertificate({ paperId, versionId: paper.current_version_id, recipientId: paper.owner_id, recipientName: ownerName, type: "PUBLICATION", role: "Author / uploader", origin, actorId, holdMail: true });
}

/** Used when a hold is lifted: issues the uploader's certificate only if `userId` is the uploader. */
export async function issueOwnerPublicationCertificateIfOwner(paperId: string, userId: string, origin: string, actorId: string | null) {
  const { data: paper } = await db.from("papers").select("owner_id").eq("id", paperId).maybeSingle();
  if (!paper || paper.owner_id !== userId) return null;
  return issueOwnerPublicationCertificate(paperId, origin, actorId);
}

/** Issues a PUBLICATION certificate to every listed author other than the uploader (who is covered by issueOwnerPublicationCertificate), with or without an
 *  e-mail address, skipping authors on hold. Then e-mails every recipient ONE message carrying ALL the certificates. A listed author who has a Paperly account
 *  under their address also sees theirs under Certificates. Safe to run again: an existing certificate is reused and an identical e-mail is never sent twice. */
export async function issueAuthorCertificates(paperId: string, origin: string) {
  const out = { issued: 0, skipped: 0, failed: 0 };
  const { data: paper } = await db.from("papers").select("id, owner_id, status, current_version_id, deleted_at").eq("id", paperId).maybeSingle();
  if (!paper || paper.deleted_at || !paper.current_version_id || !["PUBLISHED", "CORRECTED"].includes(paper.status)) return out;
  const held = await heldAuthorIds(paperId);
  const { data: rows } = await db.from("paper_authors").select("id, full_name, email, user_id, position").eq("paper_id", paperId).order("position");
  const { data: ownerProf } = await db.from("profiles").select("email").eq("id", paper.owner_id).maybeSingle();
  const seen = new Set<string>([(ownerProf?.email ?? "").trim().toLowerCase()]);
  for (const a of rows ?? []) {
    if (a.user_id === paper.owner_id) continue; // the uploader's certificate is issued separately
    if (held.has(a.id) || a.full_name.trim().length < 2) { out.skipped++; continue; }
    const raw = (a.email ?? "").trim().toLowerCase();
    // An address is only used once per paper and only when it is a real address; the author's certificate is issued either way.
    const email = raw && EMAIL_RE.test(raw) && raw.length <= 254 && !seen.has(raw) ? raw : null;
    if (email) seen.add(email);
    try {
      const { data: acct } = email ? await db.from("profiles").select("id").eq("email", email).maybeSingle() : { data: null };
      const recipientId = acct?.id && acct.id !== paper.owner_id ? acct.id : null;
      await issueCertificate({ paperId, versionId: paper.current_version_id, recipientId, recipientAuthorId: a.id, recipientEmail: email, recipientName: a.full_name.trim(), type: "PUBLICATION", role: "Author", origin, actorId: null, holdMail: true });
      out.issued++;
    } catch (e) {
      out.failed++;
      log("author_certificate_failed", { paperId, authorId: a.id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    }
  }
  await (await import("./mail.server")).queueCertificateBundleEmails(paperId);
  return out;
}

/** Daily sweep helper: re-runs author certificates for recently published papers, so one that failed once (storage or mail hiccup) is completed later. */
export async function retryAuthorCertificates(origin: string, limit = 20) {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await db.from("papers").select("id").in("status", ["PUBLISHED", "CORRECTED"]).is("deleted_at", null).gte("published_at", since).order("published_at", { ascending: false }).limit(limit);
  let issued = 0, failed = 0;
  for (const p of data ?? []) { const r = await issueAuthorCertificates(p.id, origin); issued += r.issued; failed += r.failed; }
  return { papers: (data ?? []).length, issued, failed };
}

