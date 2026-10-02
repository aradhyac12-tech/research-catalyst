export const PLATFORM_NAME = "Paperly";

export const RIGHTS_DECLARATION_VERSION = "rights-1.0";
export const ETHICS_DECLARATION_VERSION = "ethics-1.0";
export const AI_DISCLOSURE_VERSION = "ai-disclosure-1.0";
export const PROMPT_VERSION = "screening-prompt-1.0";

export const AI_DISCLOSURE_TEXT =
  "To screen your submission, Paperly sends the extracted text of your manuscript (up to about 40,000 characters), " +
  "together with your title, abstract and declarations, to a third-party AI model through the Lovable AI Gateway. " +
  "The model produces structured findings only; it cannot accept, reject or publish your work. A fixed, versioned policy " +
  "makes the automated decision, and editors can review or override it. Payment status is never shared with the model. " +
  "Provider data-retention terms apply; see the AI Policy page. You may withdraw before submitting.";

export const PAYMENT_DISCLAIMER =
  "Payment covers the selected service and does not guarantee acceptance or publication.";

export const ARTICLE_TYPES = [
  "Original Research",
  "Review",
  "Systematic Review",
  "Meta-analysis",
  "Case Report",
  "Case Series",
  "Clinical Study",
  "Randomized Controlled Trial",
  "Observational Study",
  "Diagnostic Study",
  "Qualitative Study",
  "Experimental/Laboratory Study",
  "Animal Study",
  "Technical Report",
  "Conference Paper",
  "Preprint",
  "Thesis/Dissertation",
  "Other",
] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const CLINICAL_ARTICLE_TYPES: readonly string[] = [
  "Case Report",
  "Case Series",
  "Clinical Study",
  "Randomized Controlled Trial",
  "Observational Study",
  "Diagnostic Study",
  "Systematic Review",
  "Meta-analysis",
];

/** Study-specific screening profiles. Items are completeness prompts, not compliance claims. */
export const SCREENING_PROFILES: Record<string, string[]> = {
  "Randomized Controlled Trial": [
    "randomization method", "allocation concealment", "comparator", "sample size justification",
    "primary/secondary outcomes", "statistical analysis plan", "adverse events", "CONSORT-related items (completeness only)",
  ],
  "Systematic Review": [
    "research question", "databases searched", "search strategy", "eligibility criteria", "screening process",
    "risk of bias assessment", "synthesis method", "PRISMA-related items (completeness only)",
  ],
  "Meta-analysis": [
    "effect measure", "heterogeneity assessment", "fixed/random model justification", "confidence intervals", "publication bias assessment",
  ],
  "Case Report": ["patient anonymization", "consent for publication", "clinical timeline", "diagnosis", "intervention", "outcome"],
  "Case Series": ["patient anonymization", "consent", "case selection", "outcomes"],
  "Observational Study": [
    "population", "exposure", "outcome", "confounders", "statistical methodology", "STROBE-related items (completeness only)",
  ],
  "Clinical Study": ["population", "intervention", "outcomes", "ethics approval", "consent", "statistics"],
  "Diagnostic Study": ["reference standard", "index test", "sensitivity/specificity with CIs", "patient flow"],
  "Qualitative Study": ["sampling", "data collection", "analysis approach", "reflexivity", "saturation"],
  "Animal Study": ["institutional approval", "species/strain", "randomization/blinding", "sample size", "welfare"],
  default: ["research question", "methods adequate for claims", "results support conclusions", "limitations"],
};

export const LICENSES = [
  { code: "CC-BY", label: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  { code: "CC-BY-NC", label: "CC BY-NC 4.0", url: "https://creativecommons.org/licenses/by-nc/4.0/" },
  { code: "CC-BY-NC-ND", label: "CC BY-NC-ND 4.0", url: "https://creativecommons.org/licenses/by-nc-nd/4.0/" },
  { code: "ALL-RIGHTS-RESERVED", label: "All rights reserved (platform hosting licence)", url: null },
] as const;

export const PUBLIC_STATUSES = ["PUBLISHED", "CORRECTED", "RETRACTED"] as const;

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PROCESSING: "Processing",
  AI_SCREENING: "Automated screening",
  REVIEW_REQUIRED: "Editorial review",
  REVISION_REQUIRED: "Revision requested",
  ACCEPTED: "Accepted",
  REJECTED: "Not accepted",
  PAYMENT_PENDING: "Awaiting payment",
  PAYMENT_COMPLETED: "Payment received",
  PUBLICATION_PENDING: "Publishing",
  PUBLISHED: "Published",
  CORRECTED: "Published (corrected)",
  RETRACTED: "Retracted",
  ARCHIVED: "Archived",
};

export const CERTIFICATE_TEXT: Record<string, string> = {
  PUBLICATION:
    "This certificate confirms that the named individual is recorded by the platform as an author/uploader of the identified research work and that the work was published through the platform on the stated date.",
  SUBMISSION:
    "This certificate confirms that the named individual submitted the identified research work to the platform on the stated date. It does not indicate acceptance or publication.",
  PEER_REVIEW:
    "This certificate confirms that the named individual completed a peer review assignment for the identified work through the platform's configured review workflow.",
  AUTHOR_RECORD:
    "This certificate confirms that the named individual is recorded by the platform as an author of the identified research work.",
};

export const CERTIFICATE_DISCLAIMER =
  "This certificate records a platform publication event and does not by itself constitute governmental, institutional, accreditation, or independent scientific certification of the research.";
