import { describe, expect, it } from "vitest";
import { isTransitionAllowed, type PaperStatus } from "./state-machine";

describe("screening boundary", () => {
  const screening: PaperStatus[] = ["SUBMITTED", "PROCESSING", "AI_SCREENING"];
  const finals: PaperStatus[] = ["ACCEPTED", "REJECTED", "REVISION_REQUIRED"];
  for (const from of screening) for (const to of finals) {
    it(`automated stage ${from} cannot move to ${to}`, () => {
      expect(isTransitionAllowed(from, to)).toBe(false);
      expect(isTransitionAllowed(from, to, true)).toBe(false);
    });
  }
  it("automated screening can route to an editor", () => {
    expect(isTransitionAllowed("AI_SCREENING", "REVIEW_REQUIRED")).toBe(true);
  });
  it("only editorial review can accept, reject or request revision", () => {
    for (const to of finals) expect(isTransitionAllowed("REVIEW_REQUIRED", to)).toBe(true);
  });
});

describe("publication gates", () => {
  const all: PaperStatus[] = ["DRAFT","SUBMITTED","PROCESSING","AI_SCREENING","REVIEW_REQUIRED","REVISION_REQUIRED","ACCEPTED","REJECTED","PAYMENT_PENDING","PAYMENT_COMPLETED","PUBLICATION_PENDING","PUBLISHED","CORRECTED","RETRACTED","ARCHIVED"];
  it("only PUBLICATION_PENDING can become PUBLISHED, even with override", () => {
    for (const from of all) if (from !== "PUBLICATION_PENDING") {
      expect(isTransitionAllowed(from, "PUBLISHED")).toBe(false);
      expect(isTransitionAllowed(from, "PUBLISHED", true)).toBe(false);
    }
  });
  it("rejected manuscripts cannot reach payment or publication", () => {
    for (const to of ["PAYMENT_PENDING", "PAYMENT_COMPLETED", "PUBLICATION_PENDING", "PUBLISHED"] as PaperStatus[]) {
      expect(isTransitionAllowed("REJECTED", to, true)).toBe(false);
    }
  });
  it("retraction keeps the record (no path to deletion states)", () => {
    expect(isTransitionAllowed("RETRACTED", "DRAFT")).toBe(false);
    expect(isTransitionAllowed("PUBLISHED", "RETRACTED")).toBe(true);
  });
});
