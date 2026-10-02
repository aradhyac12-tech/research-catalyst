// TypeScript mirror of public.paper_transition_allowed(). The database function is the
// authority (enforced by trigger); this copy exists for UI hints and tests. Keep in sync.
export type PaperStatus =
  | "DRAFT" | "SUBMITTED" | "PROCESSING" | "AI_SCREENING" | "REVIEW_REQUIRED" | "REVISION_REQUIRED"
  | "ACCEPTED" | "REJECTED" | "PAYMENT_PENDING" | "PAYMENT_COMPLETED" | "PUBLICATION_PENDING"
  | "PUBLISHED" | "CORRECTED" | "RETRACTED" | "ARCHIVED";

const NORMAL: Array<[PaperStatus, PaperStatus]> = [
  ["DRAFT", "SUBMITTED"],
  ["SUBMITTED", "PROCESSING"], ["SUBMITTED", "REJECTED"],
  ["PROCESSING", "AI_SCREENING"], ["PROCESSING", "REJECTED"], ["PROCESSING", "REVIEW_REQUIRED"],
  ["AI_SCREENING", "ACCEPTED"], ["AI_SCREENING", "REJECTED"], ["AI_SCREENING", "REVIEW_REQUIRED"],
  ["AI_SCREENING", "REVISION_REQUIRED"], ["AI_SCREENING", "PROCESSING"],
  ["REVIEW_REQUIRED", "ACCEPTED"], ["REVIEW_REQUIRED", "REJECTED"], ["REVIEW_REQUIRED", "REVISION_REQUIRED"],
  ["REVISION_REQUIRED", "SUBMITTED"],
  ["ACCEPTED", "PAYMENT_PENDING"], ["ACCEPTED", "PUBLICATION_PENDING"],
  ["PAYMENT_PENDING", "PAYMENT_COMPLETED"], ["PAYMENT_PENDING", "ACCEPTED"],
  ["PAYMENT_COMPLETED", "PUBLICATION_PENDING"],
  ["PUBLICATION_PENDING", "PUBLISHED"],
  ["PUBLISHED", "CORRECTED"], ["PUBLISHED", "RETRACTED"], ["PUBLISHED", "ARCHIVED"],
  ["CORRECTED", "CORRECTED"], ["CORRECTED", "RETRACTED"], ["CORRECTED", "ARCHIVED"],
  ["REJECTED", "ARCHIVED"],
];

const OVERRIDE: Array<[PaperStatus, PaperStatus]> = [
  ["REJECTED", "REVIEW_REQUIRED"], ["REJECTED", "ACCEPTED"], ["REJECTED", "REVISION_REQUIRED"],
  ["ACCEPTED", "REJECTED"], ["ACCEPTED", "REVIEW_REQUIRED"],
  ["REVISION_REQUIRED", "REJECTED"], ["REVISION_REQUIRED", "ACCEPTED"],
];

export function isTransitionAllowed(from: PaperStatus, to: PaperStatus, override = false): boolean {
  if (to === "PUBLISHED" && from !== "PUBLICATION_PENDING") return false;
  if (NORMAL.some(([a, b]) => a === from && b === to)) return true;
  if (override && OVERRIDE.some(([a, b]) => a === from && b === to)) return true;
  return false;
}
