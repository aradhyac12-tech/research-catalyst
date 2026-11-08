import { z } from "zod";

export const CHECK_KEYS = [
  "document", "authorship", "copyright", "similarity", "citations", "methodology",
  "statistics", "ethics", "data_consistency", "figures", "ai_content",
] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export const CHECK_STATUSES = ["PASS", "WARNING", "REVIEW_REQUIRED", "FAIL", "NOT_APPLICABLE"] as const;
export const SEVERITIES = ["none", "minor", "moderate", "severe", "critical"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];

// Wire schema sent to the model: strict-compatible (all required, nullable, no bounds).
export const aiWireSchema = z.object({
  study_type: z.string(),
  is_medical_or_human_subjects: z.boolean(),
  confidence: z.number(),
  summary: z.string(),
  signals: z.object({
    human_subjects: z.boolean(),
    animal_subjects: z.boolean(),
    clinical_trial: z.boolean(),
    patient_identifiable_info: z.boolean(),
    ethics_approval_claimed_in_text: z.boolean(),
    consent_claimed_in_text: z.boolean(),
    trial_registration_in_text: z.boolean(),
    embedded_instructions_detected: z.boolean(),
    ai_generated_text_likelihood: z.string(),
  }),
  checks: z.array(
    z.object({
      key: z.string(),
      status: z.string(),
      severity: z.string(),
      message: z.string(),
      evidence: z.array(
        z.object({
          section: z.string().nullable(),
          page: z.number().nullable(),
          quote: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type AiWire = z.infer<typeof aiWireSchema>;

export interface NormalizedFinding {
  key: CheckKey;
  status: CheckStatus;
  severity: Severity;
  message: string;
  evidence: Array<{ section: string | null; page: number | null; quote: string | null }>;
}

export interface NormalizedAssessment {
  study_type: string;
  is_medical_or_human_subjects: boolean;
  confidence: number;
  summary: string;
  signals: AiWire["signals"];
  findings: NormalizedFinding[];
}

/** Post-hoc validation: clamp and coerce model output into the strict internal schema. */
export function normalizeAssessment(raw: AiWire): NormalizedAssessment {
  const findings: NormalizedFinding[] = [];
  const seen = new Set<string>();
  for (const c of raw.checks ?? []) {
    const key = (CHECK_KEYS as readonly string[]).includes(c.key) ? (c.key as CheckKey) : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const status = (CHECK_STATUSES as readonly string[]).includes(c.status) ? (c.status as CheckStatus) : "REVIEW_REQUIRED";
    const severity = (SEVERITIES as readonly string[]).includes(c.severity) ? (c.severity as Severity) : "moderate";
    findings.push({
      key,
      status,
      severity,
      message: String(c.message ?? "").slice(0, 1000),
      evidence: (c.evidence ?? []).slice(0, 5).map((e) => ({
        section: e.section ? String(e.section).slice(0, 120) : null,
        page: typeof e.page === "number" && Number.isFinite(e.page) ? Math.trunc(e.page) : null,
        quote: e.quote ? String(e.quote).slice(0, 300) : null,
      })),
    });
  }
  // Any check the model skipped is treated as unresolved rather than passed.
  for (const key of CHECK_KEYS) {
    if (!seen.has(key)) {
      findings.push({ key, status: "REVIEW_REQUIRED", severity: "moderate", message: "The automated screen did not return a result for this check.", evidence: [] });
    }
  }
  const conf = Number(raw.confidence);
  return {
    study_type: String(raw.study_type ?? "Unknown").slice(0, 120),
    is_medical_or_human_subjects: !!raw.is_medical_or_human_subjects,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    summary: String(raw.summary ?? "").slice(0, 2000),
    signals: raw.signals,
    findings,
  };
}
