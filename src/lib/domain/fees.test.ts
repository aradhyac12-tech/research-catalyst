import { describe, expect, it } from "vitest";
import { refundSplit, SUBMISSION_FEE_RETAINED_MINOR } from "./fees";

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
