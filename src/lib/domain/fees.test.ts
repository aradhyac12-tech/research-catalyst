import { describe, expect, it } from "vitest";
import { feeProblem, FEE_MAX_MINOR, refundSplit, SUBMISSION_FEE_RETAINED_MINOR } from "./fees";

describe("refundSplit", () => {
  it("keeps 300 and refunds 1200 on the full 1500 fee", () => {
    expect(SUBMISSION_FEE_RETAINED_MINOR).toBe(30000);
    expect(refundSplit(150000)).toEqual({ retainedMinor: 30000, refundMinor: 120000 });
  });
  it("after a promo discount, keeps 300 and refunds the rest of what was paid", () => {
    expect(refundSplit(100000)).toEqual({ retainedMinor: 30000, refundMinor: 70000 });
  });
  it("never refunds more than was paid or a negative amount", () => {
    expect(refundSplit(30000)).toEqual({ retainedMinor: 30000, refundMinor: 0 });
    expect(refundSplit(10000)).toEqual({ retainedMinor: 10000, refundMinor: 0 });
    expect(refundSplit(0)).toEqual({ retainedMinor: 0, refundMinor: 0 });
    expect(refundSplit(-5)).toEqual({ retainedMinor: 0, refundMinor: 0 });
  });
});

describe("feeProblem", () => {
  it("accepts a normal fee, including the smallest and largest allowed", () => {
    expect(feeProblem(150000)).toBeNull();
    expect(feeProblem(100)).toBeNull();
    expect(feeProblem(FEE_MAX_MINOR)).toBeNull();
  });
  it("rejects zero, negative, fractional, too small and too large amounts", () => {
    for (const bad of [0, -100, 99, 1500.5, Number.NaN, FEE_MAX_MINOR + 1]) expect(feeProblem(bad)).not.toBeNull();
  });
});
