import { describe, expect, it } from "vitest";
import { authorSeesReviewers, decisionColumns, decisionTarget, nextVersion, outcomeAllowed, reviewerSeesAuthors } from "./review";
import { isTransitionAllowed } from "./state-machine";

describe("review model visibility", () => {
  it("double-anonymous hides authors from reviewers and reviewers from authors", () => {
    expect(reviewerSeesAuthors("DOUBLE_ANONYMOUS")).toBe(false);
    expect(authorSeesReviewers("DOUBLE_ANONYMOUS")).toBe(false);
  });
  it("single-anonymous: reviewers see authors, authors do not see reviewers", () => {
    expect(reviewerSeesAuthors("SINGLE_ANONYMOUS")).toBe(true);
    expect(authorSeesReviewers("SINGLE_ANONYMOUS")).toBe(false);
  });
  it("open review reveals both", () => {
    expect(reviewerSeesAuthors("OPEN")).toBe(true);
    expect(authorSeesReviewers("OPEN")).toBe(true);
  });
});

describe("editorial decisions", () => {
  it("maps outcomes to states and revision types", () => {
    expect(decisionTarget("ACCEPT")).toBe("ACCEPTED");
    expect(decisionTarget("MINOR_REVISION")).toBe("REVISION_REQUIRED");
    expect(decisionColumns("MAJOR_REVISION")).toEqual({ outcome: "REVISION_REQUIRED", revision_type: "MAJOR" });
    expect(decisionColumns("MINOR_REVISION").revision_type).toBe("MINOR");
  });
  it("journal article cannot be accepted without a completed review", () => {
    expect(outcomeAllowed({ status: "EDITORIAL_DECISION", publicationType: "JOURNAL_ARTICLE", outcome: "ACCEPT", completedReviews: 0 })).not.toBeNull();
    expect(outcomeAllowed({ status: "EDITORIAL_DECISION", publicationType: "JOURNAL_ARTICLE", outcome: "ACCEPT", completedReviews: 1 })).toBeNull();
  });
  it("journal article cannot skip peer review except by desk rejection", () => {
    expect(outcomeAllowed({ status: "REVIEW_REQUIRED", publicationType: "JOURNAL_ARTICLE", outcome: "ACCEPT", completedReviews: 0 })).not.toBeNull();
    expect(outcomeAllowed({ status: "REVIEW_REQUIRED", publicationType: "JOURNAL_ARTICLE", outcome: "MINOR_REVISION", completedReviews: 0 })).not.toBeNull();
    expect(outcomeAllowed({ status: "REVIEW_REQUIRED", publicationType: "JOURNAL_ARTICLE", outcome: "REJECT", completedReviews: 0 })).toBeNull();
  });
  it("repository records can be accepted by an editor without peer review", () => {
    expect(outcomeAllowed({ status: "REVIEW_REQUIRED", publicationType: "REPOSITORY_RECORD", outcome: "ACCEPT", completedReviews: 0 })).toBeNull();
  });
  it("decisions are impossible outside editorial states", () => {
    for (const s of ["SUBMITTED", "AI_SCREENING", "PEER_REVIEW", "ACCEPTED", "PUBLISHED"]) {
      expect(outcomeAllowed({ status: s, publicationType: "REPOSITORY_RECORD", outcome: "ACCEPT", completedReviews: 1 })).not.toBeNull();
    }
  });
});

describe("versioning", () => {
  it("minor revision 1.0 -> 1.1, major 1.1 -> 2.0", () => {
    expect(nextVersion({ major: 1, minor: 0 }, "MINOR")).toEqual({ major: 1, minor: 1 });
    expect(nextVersion({ major: 1, minor: 1 }, "MAJOR")).toEqual({ major: 2, minor: 0 });
  });
});

describe("workflow state machine (peer review)", () => {
  it("no shortcut from submission or automated stages into peer review or acceptance", () => {
    for (const from of ["SUBMITTED", "PROCESSING", "AI_SCREENING"] as const) {
      expect(isTransitionAllowed(from, "PEER_REVIEW")).toBe(false);
      expect(isTransitionAllowed(from, "REVIEWER_ASSIGNMENT")).toBe(false);
      expect(isTransitionAllowed(from, "ACCEPTED")).toBe(false);
    }
  });
  it("peer review cannot jump straight to acceptance or publication", () => {
    expect(isTransitionAllowed("PEER_REVIEW", "ACCEPTED")).toBe(false);
    expect(isTransitionAllowed("PEER_REVIEW", "PUBLISHED")).toBe(false);
    expect(isTransitionAllowed("PEER_REVIEW", "EDITORIAL_DECISION")).toBe(true);
  });
  it("payment states cannot be reached before acceptance", () => {
    expect(isTransitionAllowed("EDITORIAL_DECISION", "PAYMENT_PENDING")).toBe(false);
    expect(isTransitionAllowed("REVIEW_REQUIRED", "PAYMENT_PENDING")).toBe(false);
  });
  it("authors can withdraw but a withdrawn paper cannot be published", () => {
    expect(isTransitionAllowed("PEER_REVIEW", "WITHDRAWN")).toBe(true);
    expect(isTransitionAllowed("WITHDRAWN", "PUBLISHED")).toBe(false);
    expect(isTransitionAllowed("WITHDRAWN", "ACCEPTED", true)).toBe(false);
  });
});
