// Versioned ethics policy. The policy is DATA (ETHICS_POLICY_1_0.rules): which questions apply to which kind of research.
// Evaluation is deterministic and contains no AI. Evaluation can only say "a human must review" or "no ethics review is
// required by policy"; it never clears or rejects a case. Clearing is a human act (database function ethics_transition).
export const ETHICS_POLICY_VERSION = "ethics-policy-1.0";
export const ETHICS_DECLARATION_VERSION_V2 = "ethics-1.1";

export const RESEARCH_CATEGORIES = [
  "RANDOMIZED_CLINICAL_TRIAL", "CLINICAL_INTERVENTION_STUDY", "OBSERVATIONAL_STUDY", "DIAGNOSTIC_STUDY", "QUALITATIVE_RESEARCH",
  "CASE_REPORT", "CASE_SERIES", "SYSTEMATIC_REVIEW", "META_ANALYSIS", "ANIMAL_RESEARCH", "LABORATORY_IN_VITRO",
  "HUMAN_SUBJECT_RESEARCH", "SECONDARY_PUBLIC_DATA", "NON_EMPIRICAL",
] as const;
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];

export type EthicsStatus =
  | "ETHICS_DECLARED" | "ETHICS_REVIEW_REQUIRED" | "ETHICS_UNDER_REVIEW" | "ETHICS_REVISION_REQUIRED"
  | "ETHICS_CLEARED" | "ETHICS_NOT_CLEARED" | "ETHICS_HUMAN_REVIEW_REQUIRED" | "ETHICS_NOT_REQUIRED";

export interface CategoryRule {
  humanSubjects: boolean; // human-participant questions apply
  committeeApproval: boolean; // approval or documented exemption expected
  informedConsent: boolean;
  publicationConsent: boolean; // patient/participant consent to publish is required whenever identifiable content is present; always for case types
  trialRegistration: boolean; // prospective registration is applicable
  animalProtocol: boolean;
  reviewRequired: boolean; // a human ethics reviewer must look at it
}
const NONE: CategoryRule = { humanSubjects: false, committeeApproval: false, informedConsent: false, publicationConsent: false, trialRegistration: false, animalProtocol: false, reviewRequired: false };
const HUMAN: CategoryRule = { ...NONE, humanSubjects: true, committeeApproval: true, informedConsent: true, reviewRequired: true };

export const ETHICS_POLICY_1_0 = {
  version: ETHICS_POLICY_VERSION,
  description: "Paperly ethics screening policy 1.0. Describes which declarations apply to which research category. Not legal advice.",
  rules: {
    RANDOMIZED_CLINICAL_TRIAL: { ...HUMAN, trialRegistration: true },
    CLINICAL_INTERVENTION_STUDY: { ...HUMAN, trialRegistration: true },
    OBSERVATIONAL_STUDY: HUMAN,
    DIAGNOSTIC_STUDY: HUMAN,
    QUALITATIVE_RESEARCH: HUMAN,
    HUMAN_SUBJECT_RESEARCH: HUMAN,
    CASE_REPORT: { ...NONE, humanSubjects: true, publicationConsent: true, reviewRequired: true },
    CASE_SERIES: { ...NONE, humanSubjects: true, publicationConsent: true, informedConsent: true, reviewRequired: true },
    SYSTEMATIC_REVIEW: NONE,
    META_ANALYSIS: NONE,
    ANIMAL_RESEARCH: { ...NONE, animalProtocol: true, reviewRequired: true },
    LABORATORY_IN_VITRO: NONE,
    SECONDARY_PUBLIC_DATA: NONE,
    NON_EMPIRICAL: NONE,
  } as Record<ResearchCategory, CategoryRule>,
} as const;

/** Policy registry: a version string always resolves to exactly one immutable rule set. */
export const ETHICS_POLICIES: Record<string, typeof ETHICS_POLICY_1_0> = { [ETHICS_POLICY_VERSION]: ETHICS_POLICY_1_0 };
export const CURRENT_ETHICS_POLICY = ETHICS_POLICY_1_0;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export async function ethicsPolicyHash(p: typeof ETHICS_POLICY_1_0 = CURRENT_ETHICS_POLICY): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(p)));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- declarations ----------
export const DEIDENTIFICATION = ["NOT_APPLICABLE", "NOT_DEIDENTIFIED", "PARTIALLY_DEIDENTIFIED", "FULLY_DEIDENTIFIED"] as const;
export const INFORMED_CONSENT = ["NOT_APPLICABLE", "OBTAINED", "NOT_OBTAINED"] as const;
export const PUBLICATION_CONSENT = ["NOT_APPLICABLE", "OBTAINED", "WAIVED_DOCUMENTED", "NOT_OBTAINED"] as const;
export const WAIVER = ["NOT_APPLICABLE", "WAIVER_GRANTED", "WAIVER_NOT_GRANTED"] as const;
export const COMMITTEE_APPROVAL = ["NOT_APPLICABLE", "APPROVED", "EXEMPT_DOCUMENTED", "PENDING", "NOT_OBTAINED"] as const;
export const TRIAL_REG_STATUS = ["NOT_APPLICABLE", "NOT_REGISTERED", "REGISTERED_PROSPECTIVELY", "REGISTERED_RETROSPECTIVELY"] as const;

export interface SubjectDeclaration {
  human_participants: boolean;
  identifiable_info_present: boolean;
  deidentification_status: (typeof DEIDENTIFICATION)[number];
  informed_consent_status: (typeof INFORMED_CONSENT)[number];
  publication_consent_status: (typeof PUBLICATION_CONSENT)[number];
  waiver_status: (typeof WAIVER)[number];
  committee_approval_status: (typeof COMMITTEE_APPROVAL)[number];
  approval_reference?: string | undefined;
  privacy_sensitive_media: boolean;
}
export interface TrialDeclaration {
  registration_status: (typeof TRIAL_REG_STATUS)[number];
  registry_name?: string | undefined;
  registration_number?: string | undefined;
  registration_url?: string | undefined;
  registration_date?: string | undefined; // YYYY-MM-DD
}
export interface EthicsInput {
  articleType: string;
  animal_subjects: boolean;
  clinical_trial: boolean;
  secondary_data_only: boolean;
  animal_protocol?: string | undefined;
  ethics_exempt_reason?: string | undefined;
  subject: SubjectDeclaration;
  trial: TrialDeclaration;
}

const TYPE_TO_CATEGORY: Record<string, ResearchCategory> = {
  "Randomized Controlled Trial": "RANDOMIZED_CLINICAL_TRIAL", "Clinical Study": "CLINICAL_INTERVENTION_STUDY", "Observational Study": "OBSERVATIONAL_STUDY",
  "Diagnostic Study": "DIAGNOSTIC_STUDY", "Qualitative Study": "QUALITATIVE_RESEARCH", "Case Report": "CASE_REPORT", "Case Series": "CASE_SERIES",
  "Systematic Review": "SYSTEMATIC_REVIEW", "Meta-analysis": "META_ANALYSIS", "Animal Study": "ANIMAL_RESEARCH", "Experimental/Laboratory Study": "LABORATORY_IN_VITRO",
};

/** Category comes from the article type; declarations can only make it STRICTER (never fall below what the type implies). */
export function deriveCategory(i: Pick<EthicsInput, "articleType" | "animal_subjects" | "clinical_trial" | "secondary_data_only"> & { human_participants: boolean }): ResearchCategory {
  const base = TYPE_TO_CATEGORY[i.articleType];
  if (base) {
    if (i.clinical_trial && (base === "OBSERVATIONAL_STUDY" || base === "HUMAN_SUBJECT_RESEARCH")) return "CLINICAL_INTERVENTION_STUDY";
    if (base === "LABORATORY_IN_VITRO" && i.human_participants) return "HUMAN_SUBJECT_RESEARCH";
    if (base === "LABORATORY_IN_VITRO" && i.animal_subjects) return "ANIMAL_RESEARCH";
    return base;
  }
  if (i.clinical_trial) return "CLINICAL_INTERVENTION_STUDY";
  if (i.human_participants) return "HUMAN_SUBJECT_RESEARCH";
  if (i.animal_subjects) return "ANIMAL_RESEARCH";
  if (i.secondary_data_only) return "SECONDARY_PUBLIC_DATA";
  return "NON_EMPIRICAL";
}

export interface EthicsEvaluation {
  category: ResearchCategory;
  rule: CategoryRule;
  policyVersion: string;
  /** Problems with the declaration itself. Non-empty means the submission is refused before anything is stored. */
  violations: string[];
  requiresTrialRegistration: boolean;
  requiresPublicationConsent: boolean;
  requiresCommitteeApproval: boolean;
  initialStatus: Extract<EthicsStatus, "ETHICS_REVIEW_REQUIRED" | "ETHICS_NOT_REQUIRED" | "ETHICS_HUMAN_REVIEW_REQUIRED">;
  /** Structured reasons for the initial status; stored on the first transition event. */
  reasons: Array<{ code: string; detail: string }>;
  trialVerificationStatus: "NOT_REQUIRED" | "PENDING_MANUAL_VERIFICATION";
}

const blank = (s: string | undefined) => !s || s.trim().length === 0;

export function evaluateEthics(i: EthicsInput, policy: typeof ETHICS_POLICY_1_0 = CURRENT_ETHICS_POLICY): EthicsEvaluation {
  const s = i.subject;
  const category = deriveCategory({ ...i, human_participants: s.human_participants });
  const rule = policy.rules[category];
  const v: string[] = [];
  const reasons: Array<{ code: string; detail: string }> = [];
  const flags: string[] = []; // ambiguous or concerning signals that need a person, not a checkbox

  const humanApplies = rule.humanSubjects || s.human_participants;
  const trialApplies = rule.trialRegistration || i.clinical_trial;
  const consentApplies = rule.publicationConsent || s.identifiable_info_present || s.privacy_sensitive_media;
  const committeeApplies = rule.committeeApproval || (s.human_participants && category !== "CASE_REPORT");

  // --- human participants / approval / consent: each is its own declaration, none implies another ---
  if (humanApplies && !s.human_participants && rule.humanSubjects) v.push("This type of work involves people: confirm that human participants or patients are involved, or choose a different article type.");
  if (committeeApplies) {
    if (s.committee_approval_status === "NOT_APPLICABLE") v.push("State the ethics committee / IRB approval status (approved, documented exemption, pending, or not obtained).");
    if (s.committee_approval_status === "APPROVED" && blank(s.approval_reference)) v.push("Approved by an ethics committee: enter the approval or reference number.");
    if (s.committee_approval_status === "EXEMPT_DOCUMENTED" && blank(s.approval_reference) && blank(i.ethics_exempt_reason)) v.push("Documented exemption: state who granted it and why, or give the reference.");
    if (s.committee_approval_status === "PENDING" || s.committee_approval_status === "NOT_OBTAINED") flags.push("committee approval is not in place");
  }
  if (humanApplies && rule.informedConsent) {
    if (s.informed_consent_status === "NOT_APPLICABLE") v.push("State whether informed consent to take part in the research was obtained.");
    if (s.informed_consent_status === "NOT_OBTAINED" && s.waiver_status !== "WAIVER_GRANTED") flags.push("informed consent not obtained and no waiver recorded");
  }
  if (s.waiver_status === "WAIVER_GRANTED" && s.committee_approval_status !== "APPROVED" && s.committee_approval_status !== "EXEMPT_DOCUMENTED") v.push("A consent waiver is granted by an ethics body: record the committee approval or documented exemption that granted it.");
  if (consentApplies) {
    if (s.publication_consent_status === "NOT_APPLICABLE") v.push("State whether consent to PUBLISH identifiable information, images or data was obtained. This is separate from ethics approval and from consent to take part.");
    if (s.publication_consent_status === "NOT_OBTAINED") flags.push("consent to publish identifiable information was not obtained");
  }
  if (s.identifiable_info_present && s.deidentification_status === "NOT_APPLICABLE") v.push("Identifiable information is present: state its de-identification status.");
  if (s.identifiable_info_present && s.deidentification_status === "NOT_DEIDENTIFIED" && s.publication_consent_status !== "OBTAINED" && s.publication_consent_status !== "WAIVED_DOCUMENTED") flags.push("identifiable, non-de-identified content without documented publication consent");
  if (s.privacy_sensitive_media && s.publication_consent_status === "NOT_APPLICABLE") v.push("Privacy-sensitive images, video or data are present: declare publication consent.");

  // --- animals ---
  if (rule.animalProtocol || i.animal_subjects) {
    if (blank(i.animal_protocol)) v.push("Animal research: enter the institutional approval or protocol reference.");
  }

  // --- clinical trial registration (declared by the author; never verified by software) ---
  const t = i.trial;
  if (trialApplies) {
    if (t.registration_status === "NOT_APPLICABLE") v.push("Clinical-trial registration applies: state whether the trial was registered (prospectively, retrospectively, or not registered).");
    if (t.registration_status.startsWith("REGISTERED")) {
      if (blank(t.registry_name)) v.push("Enter the name of the trial registry.");
      if (blank(t.registration_number)) v.push("Enter the trial registration number.");
      if (t.registration_date && !/^\d{4}-\d{2}-\d{2}$/.test(t.registration_date)) v.push("The registration date must be a valid date.");
    }
    if (t.registration_status === "NOT_REGISTERED") flags.push("clinical trial is not registered");
  }
  if (t.registration_url && !/^https:\/\//i.test(t.registration_url)) v.push("The registration URL must start with https://");

  if (v.length) {
    return { category, rule, policyVersion: policy.version, violations: v, requiresTrialRegistration: trialApplies, requiresPublicationConsent: consentApplies, requiresCommitteeApproval: committeeApplies, initialStatus: "ETHICS_REVIEW_REQUIRED", reasons, trialVerificationStatus: trialApplies ? "PENDING_MANUAL_VERIFICATION" : "NOT_REQUIRED" };
  }

  const mustReview = rule.reviewRequired || humanApplies || consentApplies || trialApplies || i.animal_subjects;
  let initialStatus: EthicsEvaluation["initialStatus"];
  if (flags.length) {
    initialStatus = "ETHICS_HUMAN_REVIEW_REQUIRED";
    for (const f of flags) reasons.push({ code: "RISK_SIGNAL", detail: f });
  } else if (mustReview) {
    initialStatus = "ETHICS_REVIEW_REQUIRED";
    reasons.push({ code: "POLICY_REQUIRES_REVIEW", detail: `category ${category} under ${policy.version}` });
  } else {
    initialStatus = "ETHICS_NOT_REQUIRED";
    reasons.push({ code: "POLICY_NO_REVIEW_REQUIRED", detail: `category ${category} under ${policy.version}; no human, animal, trial or identifiable-data declarations` });
  }
  return { category, rule, policyVersion: policy.version, violations: [], requiresTrialRegistration: trialApplies, requiresPublicationConsent: consentApplies, requiresCommitteeApproval: committeeApplies, initialStatus, reasons, trialVerificationStatus: trialApplies ? "PENDING_MANUAL_VERIFICATION" : "NOT_REQUIRED" };
}

// ---------- state machine (TypeScript mirror of public.ethics_transition_allowed + actor rules) ----------
const EDGES: Array<[EthicsStatus, EthicsStatus]> = [
  ["ETHICS_DECLARED", "ETHICS_REVIEW_REQUIRED"], ["ETHICS_DECLARED", "ETHICS_NOT_REQUIRED"], ["ETHICS_DECLARED", "ETHICS_HUMAN_REVIEW_REQUIRED"],
  ["ETHICS_NOT_REQUIRED", "ETHICS_REVIEW_REQUIRED"], ["ETHICS_NOT_REQUIRED", "ETHICS_HUMAN_REVIEW_REQUIRED"],
  ["ETHICS_REVIEW_REQUIRED", "ETHICS_UNDER_REVIEW"], ["ETHICS_REVIEW_REQUIRED", "ETHICS_HUMAN_REVIEW_REQUIRED"],
  ["ETHICS_HUMAN_REVIEW_REQUIRED", "ETHICS_UNDER_REVIEW"],
  ["ETHICS_UNDER_REVIEW", "ETHICS_REVISION_REQUIRED"], ["ETHICS_UNDER_REVIEW", "ETHICS_CLEARED"], ["ETHICS_UNDER_REVIEW", "ETHICS_NOT_CLEARED"],
  ["ETHICS_UNDER_REVIEW", "ETHICS_HUMAN_REVIEW_REQUIRED"], ["ETHICS_UNDER_REVIEW", "ETHICS_REVIEW_REQUIRED"],
  ["ETHICS_REVISION_REQUIRED", "ETHICS_REVIEW_REQUIRED"], ["ETHICS_CLEARED", "ETHICS_REVIEW_REQUIRED"], ["ETHICS_NOT_CLEARED", "ETHICS_REVIEW_REQUIRED"],
];
export const ETHICS_DECISION_STATUSES: readonly EthicsStatus[] = ["ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_REVISION_REQUIRED"];
export function isEthicsTransitionAllowed(from: EthicsStatus, to: EthicsStatus): boolean {
  return EDGES.some(([a, b]) => a === from && b === to);
}
export type EthicsActorType = "USER" | "SYSTEM" | "AI";
/** Who may take an edge. AI may only route to a human; a user must hold ETHICS_REVIEW (checked separately); SYSTEM re-opens on amendment. */
export function canActorTake(actorType: EthicsActorType, from: EthicsStatus, to: EthicsStatus): boolean {
  if (!isEthicsTransitionAllowed(from, to)) return false;
  if (actorType === "AI") return to === "ETHICS_HUMAN_REVIEW_REQUIRED";
  if (actorType === "SYSTEM") {
    return (from === "ETHICS_DECLARED" && ["ETHICS_REVIEW_REQUIRED", "ETHICS_NOT_REQUIRED", "ETHICS_HUMAN_REVIEW_REQUIRED"].includes(to))
      || (["ETHICS_REVISION_REQUIRED", "ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_UNDER_REVIEW", "ETHICS_NOT_REQUIRED"].includes(from) && to === "ETHICS_REVIEW_REQUIRED");
  }
  // USER (ethics reviewer): never re-opens a decided case, never returns a case to the queue
  if (["ETHICS_REVISION_REQUIRED", "ETHICS_CLEARED", "ETHICS_NOT_CLEARED"].includes(from)) return false;
  return to !== "ETHICS_REVIEW_REQUIRED";
}
export const PUBLICLY_SAFE_ETHICS_LABEL: Record<EthicsStatus, string | null> = {
  ETHICS_DECLARED: null, ETHICS_REVIEW_REQUIRED: null, ETHICS_UNDER_REVIEW: null, ETHICS_REVISION_REQUIRED: null, ETHICS_NOT_CLEARED: null, ETHICS_HUMAN_REVIEW_REQUIRED: null,
  ETHICS_CLEARED: "Ethics review completed", ETHICS_NOT_REQUIRED: "No ethics review required by policy",
};
