import { extractText, getDocumentProxy } from "unpdf";
import { db, audit, notify, transition, getStatus, log, certificateSiteUrl } from "./core.server";
import { createDbBudgetStore, getAIProvider, PROMPT_VERSION } from "./ai-provider.server";
import { normalizeAssessment, type NormalizedAssessment } from "@/lib/domain/ai-schema";
import { evaluatePolicy, selectPolicyKey, type DeterministicSignals, type Policy, type PolicyRules } from "@/lib/domain/decision-engine";
import { CLINICAL_ARTICLE_TYPES } from "@/lib/domain/constants";
import { scanManuscript, extractDocxText, sha256Hex } from "@/lib/domain/file-security";
import { detectPromptInjection } from "@/lib/domain/injection";
import { compareAgainstCorpus, extractDois } from "@/lib/domain/similarity";
import { renderCertificatePdf, describeRecord } from "@/lib/domain/certificate-pdf";
import { getDoiProvider } from "@/lib/domain/doi-provider";
import { measureAiAssistance, combineMeter } from "@/lib/domain/ai-meter";

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
  const worker = async () => {
    for (let doi = queue.shift(); doi; doi = queue.shift()) {
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
export async function runScreening(paperId: string, actorId: string | null, origin: string) {
  let status = await getStatus(paperId);
  // Paywall: nothing is screened until the fee is paid. Papers already past SUBMITTED (retries, older papers) are unaffected.
  if (status === "SUBMITTED" && !(await (await import("./payments.server")).feeCleared(paperId))) return { skipped: true, status: "PAYMENT_REQUIRED" };
  if (status === "SUBMITTED" || status === "AI_SCREENING") {
    await transition(paperId, "PROCESSING", actorId, "SYSTEM", status === "AI_SCREENING" ? "screening retry" : "screening started");
    status = "PROCESSING";
  }
  if (status !== "PROCESSING") return { skipped: true, status };

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

  const provider = getAIProvider(createDbBudgetStore(db));
  const useAI = scan.passed && signals.rights.ai_consent && text.length > 0;
  const inputHash = await sha256Hex(JSON.stringify({ v: version.file_hash, prompt: PROMPT_VERSION, policy: `${policy.key}@${policy.version}` }));
  const { data: run, error: runErr } = await db.from("ai_runs").insert({
    paper_id: paperId, version_id: version.id, status: "RUNNING",
    provider: useAI ? provider.provider : "none", model_name: useAI ? provider.model : "none", model_version: useAI ? provider.model : null,
    policy_key: policy.key, policy_version: policy.version, prompt_version: PROMPT_VERSION,
    privacy_mode: useAI ? provider.privacyMode : "NO_EXTERNAL_PROCESSING", input_hash: inputHash,
    deterministic_signals: { ...signals, similarity_matches: sim.matches, scan_warnings: scan.warnings, ai_meter: stylometry ? combineMeter(stylometry, null, ans["ai_tools_used"] as string | undefined, ans["ai_none_used"] === true) : null } as never,
  }).select("id").single();
  if (runErr || !run) throw new Error(runErr?.message ?? "Could not create AI run");
  await audit({ actor_type: "SYSTEM", action: "ai_started", resource_type: "paper", resource_id: paperId, metadata: { ai_run_id: run.id, model: provider.model, policy: `${policy.key}@${policy.version}`, external: useAI } });

  let assessment: NormalizedAssessment | null = null;
  let aiFailed = false; // the AI step is advisory: if it cannot run, the paper still goes to a human editor instead of waiting forever
  const started = Date.now();
  if (useAI) {
    try {
      const out = await provider.analyzeDocument({
        title: paper.title, abstract: paper.abstract, keywords: paper.keywords, articleType: paper.article_type, field: paper.field,
        authors: (authors ?? []).map((a) => ({ name: a.full_name, affiliation: a.affiliation, orcid: a.orcid, corresponding: a.is_corresponding })),
        declarations: { rights: rights ? { ...rights, id: undefined, user_id: undefined } : null, ethics: ethics ? { answers: ethics.answers, coi: ethics.conflict_of_interest, funding: ethics.funding, data: ethics.data_availability } : null },
        manuscriptText: text,
      }, paperId);
      assessment = normalizeAssessment(out.result);
      // Record which provider actually answered (the run was opened with the generic multi-provider label).
      if (out.provider) await db.from("ai_runs").update({ provider: out.provider, model_name: out.model ?? provider.model, model_version: out.model ?? provider.model }).eq("id", run.id);
      if (stylometry) {
        const meter = combineMeter(stylometry, assessment.signals.ai_generated_text_likelihood, ans["ai_tools_used"] as string | undefined, ans["ai_none_used"] === true);
        await db.from("ai_runs").update({ deterministic_signals: { ...signals, similarity_matches: sim.matches, scan_warnings: scan.warnings, ai_meter: meter } as never }).eq("id", run.id);
      }
      await db.from("ai_runs").update({ structured_result: assessment as never, output_hash: await sha256Hex(out.raw), latency_ms: Date.now() - started }).eq("id", run.id);
      if (assessment.findings.length) {
        await db.from("ai_findings").insert(assessment.findings.map((f) => ({
          ai_run_id: run.id, paper_id: paperId, check_key: f.key, status: f.status, severity: f.severity, message: f.message, evidence: f.evidence as never,
        })));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("ai_provider_failure", { paper_id: paperId, ai_run_id: run.id, error: msg.slice(0, 300), latency_ms: Date.now() - started });
      await db.from("ai_runs").update({ status: "FAILED", error: msg.slice(0, 500), completed_at: new Date().toISOString(), latency_ms: Date.now() - started }).eq("id", run.id);
      await audit({ actor_type: "SYSTEM", action: "ai_failed", resource_type: "paper", resource_id: paperId, metadata: { ai_run_id: run.id } });
      aiFailed = true;
    }
  }

  // Automated screening is informational. The policy engine's result is stored as a RECOMMENDATION
  // for the editor; the paper is always routed to human editorial review. It is never an acceptance,
  // rejection or peer review.
  // Advisory only: the screen may route an ethics case to a HUMAN. The database refuses any AI transition other than
  // "needs human review", so this cannot clear, reject or start an ethics review.
  if (assessment?.findings.some((f) => f.key === "ethics" && f.status !== "PASS" && f.status !== "NOT_APPLICABLE")) {
    try {
      const { escalateEthicsFromScreening } = await import("./ethics.server");
      await escalateEthicsFromScreening(paperId, run.id);
    } catch (e) { log("ethics_ai_escalation_failed", { paper_id: paperId, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }); }
  }
  const decision = evaluatePolicy({ policy, signals, assessment });
  if (!aiFailed) await db.from("ai_runs").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", run.id);
  await db.from("decisions").insert({
    paper_id: paperId, version_id: version.id, ai_run_id: run.id, source: "MACHINE", outcome: "REVIEW_REQUIRED",
    policy_key: decision.policy_key, policy_version: decision.policy_version, reasons: decision.reasons as never,
    check_summary: { ...(decision.check_summary as Record<string, unknown>), automated_recommendation: decision.outcome, informational_only: true, ai_unavailable: aiFailed } as never,
  });
  await audit({ actor_type: "SYSTEM", action: "screening_completed", resource_type: "paper", resource_id: paperId, new_value: { classification: "INFORMATION_FLAG_FOR_HUMAN_REVIEW", automated_recommendation: decision.outcome }, metadata: { ai_run_id: run.id, model: useAI ? provider.model : null, policy_version: `${policy.key}@${policy.version}` } });
  await transition(paperId, "REVIEW_REQUIRED", null, "SYSTEM", aiFailed ? `automated AI screening unavailable (${policy.key}@${policy.version}); routed to editor for manual screening` : `automated screening complete (${policy.key}@${policy.version}); routed to editor`, false, { ai_run_id: run.id });
  await notify(paper.owner_id, "screening_complete", "Automated screening complete", aiFailed ? "Automated AI screening could not run, so your submission goes straight to an editor for manual screening. This is not an editorial decision." : "Automated screening is not peer review and is not an editorial decision. Your submission is waiting for an editor.", `/my-research/${paperId}`);
  void origin;
  return { skipped: false, status: "REVIEW_REQUIRED" as const, outcome: "REVIEW_REQUIRED" as const, aiUnavailable: aiFailed };
}

// ---------------- certificates ----------------
export async function issueCertificate(args: {
  paperId: string; versionId: string; recipientId: string; recipientName: string; type: "SUBMISSION" | "PUBLICATION" | "PEER_REVIEW" | "AUTHOR_RECORD"; role: string; origin: string; actorId?: string | null;
}) {
  if (args.type === "PEER_REVIEW") {
    const { data: ra } = await db.from("review_assignments").select("id").eq("paper_id", args.paperId).eq("reviewer_id", args.recipientId).eq("status", "COMPLETED").maybeSingle();
    if (!ra) throw new Error("Peer review certificate requires a completed review assignment");
  }
  if (!args.recipientName.trim()) throw new Error("A recorded recipient name is required");
  const { data: paper } = await db.from("papers").select("title, public_id, paperly_id, doi, published_at, status").eq("id", args.paperId).single();
  if (!paper) throw new Error("Paper not found");
  if (args.type === "PUBLICATION" && !["PUBLISHED", "CORRECTED"].includes(paper.status)) throw new Error("Paper is not published");

  let fresh = false;
  let { data: cert } = await db.from("certificates").select("*")
    .eq("paper_id", args.paperId).eq("version_id", args.versionId).eq("recipient_user_id", args.recipientId).eq("certificate_type", args.type).maybeSingle();
  if (!cert) {
    const ins = await db.from("certificates").insert({
      paper_id: args.paperId, version_id: args.versionId, recipient_user_id: args.recipientId, recipient_name_at_issue: args.recipientName,
      certificate_type: args.type, author_role: args.role, paper_title_at_issue: paper.title, article_public_id: paper.paperly_id ?? paper.public_id,
      doi_at_issue: paper.doi, publication_date: args.type === "SUBMISSION" ? null : paper.published_at,
    }).select("*").single();
    if (ins.error) {
      // Unique-constraint race: another request issued it; reuse.
      const again = await db.from("certificates").select("*").eq("paper_id", args.paperId).eq("version_id", args.versionId).eq("recipient_user_id", args.recipientId).eq("certificate_type", args.type).single();
      cert = again.data;
    } else {
      cert = ins.data;
      fresh = true;
      await db.from("certificate_events").insert({ certificate_id: cert.id, event: "ISSUED", actor_id: args.actorId ?? null });
      await audit({ actor_id: args.actorId ?? null, actor_type: args.actorId ? "USER" : "SYSTEM", action: "certificate_issued", resource_type: "certificate", resource_id: cert.certificate_id, new_value: { type: args.type, paper: paper.public_id } });
      await notify(args.recipientId, "certificate_issued", "Certificate issued", `${cert.certificate_id} (${args.type.toLowerCase()}) is available.`, "/certificates");
    }
  }
  if (!cert) throw new Error("Certificate issuance failed");
  const needsDocument = !cert.document_hash;
  if (needsDocument) await generateCertificateDocument(cert.id, args.origin);
  // E-mail the certificate (PDF attached) once the document exists. The outbox key makes a repeat call a no-op.
  if (fresh || needsDocument) await (await import("./mail.server")).queueCertificateEmail(cert.id);
  return cert.certificate_id;
}

/** Idempotent: re-renders deterministically with the same ID and data; hash is written once. */
export async function generateCertificateDocument(certUuid: string, origin: string) {
  const { data: c } = await db.from("certificates").select("*").eq("id", certUuid).single();
  if (!c) throw new Error("Certificate not found");
  const { data: rec } = await db.from("papers").select("publication_type, peer_reviewed, status").eq("id", c.paper_id).single();
  const facts = describeRecord(rec?.publication_type ?? "REPOSITORY_RECORD", !!rec?.peer_reviewed, rec?.status ?? "");
  const pdf = await renderCertificatePdf({
    ...facts,
    certificateId: c.certificate_id, type: c.certificate_type, recipientName: c.recipient_name_at_issue, authorRole: c.author_role,
    paperTitle: c.paper_title_at_issue, articleId: c.article_public_id, doi: c.doi_at_issue, publicationDate: c.publication_date,
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

  // DOI: register only via a configured agency; verify before marking complete. Never invent.
  const doiProvider = getDoiProvider();
  const meta = { title: paper.title, authors: authors.map((a) => ({ name: a.full_name, orcid: a.orcid })), publicationDate: new Date().toISOString().slice(0, 10), url: `${origin}/article/${paper.paperly_id}`, publicId: paper.paperly_id, license: paper.license, abstract: paper.abstract };
  const { data: existingDoi } = await db.from("doi_records").select("*").eq("paper_id", paperId).maybeSingle();
  let doiResult = existingDoi?.doi ? await doiProvider.verify(existingDoi.doi, meta) : await doiProvider.register(meta, paper.paperly_id);
  if (doiResult.status === "REGISTERED" && doiResult.doi) doiResult = await doiProvider.verify(doiResult.doi, meta);
  await db.from("doi_records").upsert({
    paper_id: paperId, provider: doiProvider.name, status: doiResult.status, doi: doiResult.status === "VERIFIED" ? doiResult.doi : existingDoi?.doi ?? null,
    metadata: meta as never, last_error: doiResult.error ?? null, updated_at: new Date().toISOString(),
    verified_at: doiResult.status === "VERIFIED" ? new Date().toISOString() : null,
  }, { onConflict: "paper_id" });

  if (doiResult.status === "VERIFIED" && doiResult.doi) await db.from("papers").update({ doi: doiResult.doi }).eq("id", paperId);
  await transition(paperId, "PUBLISHED", actorId, actorId ? "USER" : "SYSTEM", "publication");
  await audit({ actor_id: actorId, actor_type: actorId ? "USER" : "SYSTEM", action: "publication_created", resource_type: "paper", resource_id: paperId, metadata: { doi_status: doiResult.status } });

  if (!paper.current_version_id) throw new Error("Publication version is missing");
  const { data: v } = await db.from("paper_versions").select("author_name_at_submission").eq("id", paper.current_version_id).single();
  if (!v?.author_name_at_submission.trim()) throw new Error("Recorded author name is missing");
  await issueCertificate({ paperId, versionId: paper.current_version_id, recipientId: paper.owner_id, recipientName: v.author_name_at_submission, type: "PUBLICATION", role: "Author / uploader", origin, actorId });
  await notify(paper.owner_id, "published", "Your work is published", `${paper.public_id} is now publicly available.`, `/article/${paper.paperly_id}`);
}

