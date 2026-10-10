// Pure rules for peer review: visibility by review model, decision mapping, version numbering. DB constraints in
// migration 0005 back the important ones; the server calls these before it writes.
export type ReviewModel = "SINGLE_ANONYMOUS" | "DOUBLE_ANONYMOUS" | "OPEN";
export type EditorialOutcome = "ACCEPT" | "MINOR_REVISION" | "MAJOR_REVISION" | "REJECT";

export const REVIEW_MODEL_LABEL: Record<ReviewModel, string> = {
  SINGLE_ANONYMOUS: "Single-anonymous (reviewers are anonymous to authors)",
  DOUBLE_ANONYMOUS: "Double-anonymous (authors and reviewers are anonymous to each other)",
  OPEN: "Open (identities are known to both sides)",
};

/** Reviewers see author identity only when the model is not double-anonymous. */
export const reviewerSeesAuthors = (m: ReviewModel) => m !== "DOUBLE_ANONYMOUS";
/** Authors see reviewer identity only under open review. */
export const authorSeesReviewers = (m: ReviewModel) => m === "OPEN";

export function decisionTarget(o: EditorialOutcome): "ACCEPTED" | "REVISION_REQUIRED" | "REJECTED" {
  return o === "ACCEPT" ? "ACCEPTED" : o === "REJECT" ? "REJECTED" : "REVISION_REQUIRED";
}
export function decisionColumns(o: EditorialOutcome): { outcome: "ACCEPT" | "REJECT" | "REVISION_REQUIRED"; revision_type: "MINOR" | "MAJOR" | null } {
  if (o === "ACCEPT") return { outcome: "ACCEPT", revision_type: null };
  if (o === "REJECT") return { outcome: "REJECT", revision_type: null };
  return { outcome: "REVISION_REQUIRED", revision_type: o === "MINOR_REVISION" ? "MINOR" : "MAJOR" };
}

/** Minor revision: 1.0 -> 1.1. Major revision: 1.1 -> 2.0. */
export function nextVersion(cur: { major: number; minor: number }, kind: "MINOR" | "MAJOR" | null): { major: number; minor: number } {
  return kind === "MAJOR" ? { major: cur.major + 1, minor: 0 } : { major: cur.major, minor: cur.minor + 1 };
}

/** Returns a reason string when the outcome is not allowed, otherwise null. */
export function outcomeAllowed(args: { status: string; publicationType: string; outcome: EditorialOutcome; completedReviews: number }): string | null {
  const { status, publicationType, outcome, completedReviews } = args;
  if (!["REVIEW_REQUIRED", "EDITORIAL_DECISION"].includes(status)) return "The paper is not awaiting an editorial decision";
  if (publicationType === "JOURNAL_ARTICLE") {
    if (status === "REVIEW_REQUIRED" && outcome !== "REJECT") return "Journal articles must go through peer review; only a desk rejection is possible before review";
    if (outcome === "ACCEPT" && completedReviews < 1) return "A journal article cannot be accepted before a peer review is completed";
  }
  return null;
}

/** States in which an author must not see review content yet. */
export const AUTHOR_REVIEW_HIDDEN_STATUSES = ["SUBMITTED", "PROCESSING", "AI_SCREENING", "REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"];
