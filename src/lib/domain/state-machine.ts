// TypeScript mirror of public.paper_transition_allowed(). The database function is the
// authority (enforced by trigger); this copy exists for UI hints and tests. Keep in sync.
export type PaperStatus =
  | "DRAFT" | "SUBMITTED" | "PROCESSING" | "AI_SCREENING" | "REVIEW_REQUIRED" | "REVISION_REQUIRED"
  | "ACCEPTED" | "REJECTED" | "PAYMENT_PENDING" | "PAYMENT_COMPLETED" | "PUBLICATION_PENDING"
  | "PUBLISHED" | "CORRECTED" | "RETRACTED" | "ARCHIVED"
  | "REVIEWER_ASSIGNMENT" | "PEER_REVIEW" | "EDITORIAL_DECISION" | "WITHDRAWN";

const NORMAL: Array<[PaperStatus, PaperStatus]> = [
  ["DRAFT", "SUBMITTED"],
  ["SUBMITTED", "PROCESSING"], ["SUBMITTED", "WITHDRAWN"],
  ["PROCESSING", "AI_SCREENING"], ["PROCESSING", "REVIEW_REQUIRED"],
  // Automated screening can only route to a human editor; it never accepts, rejects or requests revision.
  ["AI_SCREENING", "REVIEW_REQUIRED"], ["AI_SCREENING", "PROCESSING"],
  // REVIEW_REQUIRED is the editorial-screening queue.
  ["REVIEW_REQUIRED", "ACCEPTED"], ["REVIEW_REQUIRED", "REJECTED"], ["REVIEW_REQUIRED", "REVISION_REQUIRED"],
  ["REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT"], ["REVIEW_REQUIRED", "WITHDRAWN"],
  ["REVIEWER_ASSIGNMENT", "PEER_REVIEW"], ["REVIEWER_ASSIGNMENT", "REVIEW_REQUIRED"], ["REVIEWER_ASSIGNMENT", "WITHDRAWN"],
  ["PEER_REVIEW", "EDITORIAL_DECISION"], ["PEER_REVIEW", "REVIEWER_ASSIGNMENT"], ["PEER_REVIEW", "WITHDRAWN"],
  ["EDITORIAL_DECISION", "ACCEPTED"], ["EDITORIAL_DECISION", "REJECTED"], ["EDITORIAL_DECISION", "REVISION_REQUIRED"],
  ["EDITORIAL_DECISION", "REVIEWER_ASSIGNMENT"], ["EDITORIAL_DECISION", "WITHDRAWN"],
  ["REVISION_REQUIRED", "SUBMITTED"], ["REVISION_REQUIRED", "WITHDRAWN"],
  ["ACCEPTED", "PAYMENT_PENDING"], ["ACCEPTED", "PUBLICATION_PENDING"],
  ["PAYMENT_PENDING", "PAYMENT_COMPLETED"], ["PAYMENT_PENDING", "ACCEPTED"],
  ["PAYMENT_COMPLETED", "PUBLICATION_PENDING"],
  ["PUBLICATION_PENDING", "PUBLISHED"],
  ["PUBLISHED", "CORRECTED"], ["PUBLISHED", "RETRACTED"], ["PUBLISHED", "ARCHIVED"],
  ["CORRECTED", "CORRECTED"], ["CORRECTED", "RETRACTED"], ["CORRECTED", "ARCHIVED"],
  ["REJECTED", "ARCHIVED"], ["WITHDRAWN", "ARCHIVED"],
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
