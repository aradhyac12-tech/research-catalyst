// Deterministic DecisionPolicyEngine. Pure function: same inputs -> same output.
// Deliberately has NO access to payment data; its input type contains no payment fields.
import type { NormalizedAssessment, CheckKey, NormalizedFinding } from "./ai-schema";

export type Outcome = "ACCEPT" | "REJECT" | "REVIEW_REQUIRED" | "REVISION_REQUIRED";
type RuleOutcome = Exclude<Outcome, "ACCEPT">;

export interface PolicyRules {
  missing_rights: RuleOutcome;
  missing_ai_consent: RuleOutcome;
  prompt_injection: RuleOutcome;
  severe_integrity: RuleOutcome;
  ethics_missing: RuleOutcome;
  severe_methodology: RuleOutcome;
  severe_statistics: RuleOutcome;
  similarity_high: RuleOutcome;
  document_incomplete: RuleOutcome;
  patient_privacy_risk: RuleOutcome;
  trial_registration_missing: RuleOutcome;
  min_ai_confidence: number;
  max_warnings_for_accept: number;
}

export interface Policy {
  key: string;
  version: string;
  rules: PolicyRules;
}

export interface DeterministicSignals {
  security: { passed: boolean; reasons: string[] };
  rights: {
    present: boolean;
    is_author_or_authorised: boolean;
    has_upload_rights: boolean;
    third_party_unresolved: boolean;
    ai_consent: boolean;
    previously_published_publisher_version: boolean;
  };
  ethics: {
    human_participants_declared: boolean;
    animal_subjects_declared: boolean;
    clinical_trial_declared: boolean;
    approval_provided: boolean; // approval number/committee or documented exemption
    consent_provided: boolean;
    trial_registration_provided: boolean;
    animal_approval_provided: boolean;
  };
  injection: { detected: boolean; matches: string[] };
  similarity: { max_percentage: number; risk: "LOW" | "MEDIUM" | "HIGH" | "REVIEW_REQUIRED"; duplicate_file: boolean };
  citations: { checked: number; invalid: number; details: string[] };
  metadata: { has_title: boolean; has_abstract: boolean; has_authors: boolean; has_corresponding: boolean; has_keywords: boolean; text_chars: number };
}

export interface DecisionInput {
  policy: Policy;
  signals: DeterministicSignals;
  assessment: NormalizedAssessment | null; // null when AI unavailable
}

export interface DecisionReason {
  code: string;
  outcome: RuleOutcome;
  message: string;
}

export interface DecisionResult {
  outcome: Outcome;
  policy_key: string;
  policy_version: string;
  reasons: DecisionReason[];
  check_summary: Record<string, string>;
}

const RANK: Record<Outcome, number> = { ACCEPT: 0, REVISION_REQUIRED: 1, REVIEW_REQUIRED: 2, REJECT: 3 };

function finding(a: NormalizedAssessment | null, key: CheckKey): NormalizedFinding | undefined {
  return a?.findings.find((f) => f.key === key);
}
function isSevere(f?: NormalizedFinding) {
  return !!f && (f.severity === "severe" || f.severity === "critical" || f.status === "FAIL");
}

export function evaluatePolicy(input: DecisionInput): DecisionResult {
  const { policy, signals: s, assessment: a } = input;
  const r = policy.rules;
  const reasons: DecisionReason[] = [];
  const add = (code: string, outcome: RuleOutcome, message: string) => reasons.push({ code, outcome, message });

  const summary: Record<string, string> = {};

  // 1. Security — hard reject; never reaches AI in practice.
  if (!s.security.passed) {
    add("SECURITY_FAILURE", "REJECT", `File failed security validation: ${s.security.reasons.join("; ")}`);
  }
  summary["security"] = s.security.passed ? "PASS" : "FAIL";

  // 2. Rights
  if (!s.rights.present || !s.rights.is_author_or_authorised || !s.rights.has_upload_rights) {
    add("RIGHTS_MISSING", r.missing_rights, "Required authorship/upload-rights declarations are missing or negative.");
  }
  if (s.rights.third_party_unresolved) {
    add("THIRD_PARTY_PERMISSION", "REVIEW_REQUIRED", "Third-party content declared without confirmed permission.");
  }
  if (s.rights.previously_published_publisher_version) {
    add("PUBLISHER_VERSION", "REVIEW_REQUIRED", "Previously published publisher version uploaded; rights need editorial verification.");
  }
  if (!s.rights.ai_consent) {
    add("NO_AI_CONSENT", r.missing_ai_consent, "Author did not consent to automated AI screening; routed to humans.");
  }
  summary["copyright"] = reasons.some((x) => ["RIGHTS_MISSING", "THIRD_PARTY_PERMISSION", "PUBLISHER_VERSION"].includes(x.code)) ? "REVIEW_REQUIRED" : "PASS";

  // 3. Metadata completeness
  const m = s.metadata;
  if (!m.has_title || !m.has_abstract || !m.has_authors || !m.has_corresponding || m.text_chars < 500) {
    add("DOCUMENT_INCOMPLETE", r.document_incomplete, "Required manuscript elements are missing (title, abstract, authors, corresponding author, or readable text).");
  }

  // 4. Prompt injection inside the manuscript
  if (s.injection.detected || a?.signals.embedded_instructions_detected) {
    add("PROMPT_INJECTION", r.prompt_injection, "Manuscript contains text that attempts to instruct automated reviewers.");
  }

  // 5. Similarity (never auto-reject on percentage alone)
  summary["similarity"] = s.similarity.risk;
  if (s.similarity.duplicate_file) add("DUPLICATE_FILE", "REVIEW_REQUIRED", "An identical file already exists on the platform.");
  if (s.similarity.risk === "HIGH" || s.similarity.risk === "REVIEW_REQUIRED") {
    add("SIMILARITY_HIGH", r.similarity_high, `High textual overlap (${s.similarity.max_percentage}%) with existing records; requires human judgement, not proof of plagiarism.`);
  }

  // 6. Citations (deterministic Crossref checks)
  if (s.citations.invalid > 0) {
    add("CITATION_INVALID", "REVIEW_REQUIRED", `${s.citations.invalid} of ${s.citations.checked} checked DOIs could not be resolved.`);
  }

  // 7. Ethics — declarations combined with detected signals
  const e = s.ethics;
  const humans = e.human_participants_declared || !!a?.signals.human_subjects;
  if (humans && (!e.approval_provided || !e.consent_provided)) {
    add("ETHICS_MISSING", r.ethics_missing, "Human-participant research without complete ethics approval/consent information.");
  }
  if (a?.signals.human_subjects && !e.human_participants_declared) {
    add("ETHICS_MISMATCH", "REVIEW_REQUIRED", "Manuscript appears to involve human participants but the declaration says it does not.");
  }
  if ((e.animal_subjects_declared || a?.signals.animal_subjects) && !e.animal_approval_provided) {
    add("ANIMAL_APPROVAL_MISSING", r.ethics_missing, "Animal research without institutional approval information.");
  }
  if ((e.clinical_trial_declared || a?.signals.clinical_trial) && !e.trial_registration_provided) {
    add("TRIAL_REGISTRATION_MISSING", r.trial_registration_missing, "Clinical trial without registry and registration number.");
  }
  if (a?.signals.patient_identifiable_info) {
    add("PATIENT_PRIVACY", r.patient_privacy_risk, "Possible patient-identifying information detected.");
  }

  // 8. AI findings
  if (!a) {
    add("AI_UNAVAILABLE", "REVIEW_REQUIRED", "Automated screening result unavailable; routed to human review.");
  } else {
    if (a.confidence < r.min_ai_confidence) {
      add("LOW_CONFIDENCE", "REVIEW_REQUIRED", `Screening confidence ${a.confidence.toFixed(2)} below policy threshold ${r.min_ai_confidence}.`);
    }
    const map: Array<[CheckKey, string, RuleOutcome]> = [
      ["methodology", "SEVERE_METHODOLOGY", r.severe_methodology],
      ["statistics", "SEVERE_STATISTICS", r.severe_statistics],
      ["data_consistency", "SEVERE_INTEGRITY", r.severe_integrity],
      ["figures", "SEVERE_INTEGRITY", r.severe_integrity],
    ];
    for (const [key, code, outcome] of map) {
      const f = finding(a, key);
      if (isSevere(f)) add(code, outcome, `${key}: ${f!.message}`);
      else if (f?.status === "REVIEW_REQUIRED") add(`${code}_UNCERTAIN`, "REVIEW_REQUIRED", `${key}: ${f.message}`);
    }
    const doc = finding(a, "document");
    if (isSevere(doc)) add("DOCUMENT_INCOMPLETE", r.document_incomplete, `document: ${doc!.message}`);
    // AI-generated-text likelihood is recorded but is never decisive (policy principle).
    const warnings = a.findings.filter((f) => f.status === "WARNING" && f.key !== "ai_content").length;
    if (warnings > r.max_warnings_for_accept) {
      add("TOO_MANY_WARNINGS", "REVIEW_REQUIRED", `${warnings} warnings exceed the policy limit of ${r.max_warnings_for_accept}.`);
    }
    for (const f of a.findings) summary[f.key] = summary[f.key] ?? f.status;
  }
  summary["ethics"] = reasons.some((x) => x.code.startsWith("ETHICS") || x.code.includes("TRIAL") || x.code.includes("ANIMAL") || x.code === "PATIENT_PRIVACY") ? "REVIEW_REQUIRED" : (summary["ethics"] ?? "PASS");

  // Combine: most severe rule outcome wins; ACCEPT only when no rule fired.
  let outcome: Outcome = "ACCEPT";
  for (const x of reasons) if (RANK[x.outcome] > RANK[outcome]) outcome = x.outcome;

  return { outcome, policy_key: policy.key, policy_version: policy.version, reasons, check_summary: summary };
}

export function selectPolicyKey(articleType: string, clinicalTypes: readonly string[], humansDeclared: boolean): string {
  return clinicalTypes.includes(articleType) || humansDeclared ? "MEDICAL_RESEARCH_POLICY" : "GENERAL_RESEARCH_POLICY";
}
