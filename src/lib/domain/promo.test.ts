import { describe, expect, it } from "vitest";
import { applyPromo, normalizePromoCode, promoProblem, type PromoRow } from "./promo";

const base: PromoRow = { id: "1", code: "SAVE100", amount_off_minor: 10000, currency: "INR", active: true, max_redemptions: null, expires_at: null };
describe("promo", () => {
  it("normalizes", () => expect(normalizePromoCode("  save100 ")).toBe("SAVE100"));
  it("accepts a valid code", () => expect(promoProblem(base, 60000, "INR", 0, 0)).toBeNull());
  it("rejects inactive, expired, wrong currency, used up, reused", () => {
    expect(promoProblem({ ...base, active: false }, 60000, "INR", 0, 0)).toMatch(/not active/);
    expect(promoProblem({ ...base, expires_at: "2020-01-01T00:00:00Z" }, 60000, "INR", 0, 0)).toMatch(/expired/);
    expect(promoProblem(base, 50000, "KGS", 0, 0)).toMatch(/does not apply/);
    expect(promoProblem({ ...base, max_redemptions: 2 }, 60000, "INR", 2, 0)).toMatch(/fully used/);
    expect(promoProblem(base, 60000, "INR", 0, 1)).toMatch(/already used/);
  });
  it("never lets the total fall below the Razorpay minimum", () => {
    expect(promoProblem({ ...base, amount_off_minor: 60000 }, 60000, "INR", 0, 0)).toMatch(/cannot be applied/);
    expect(applyPromo(60000, 10000)).toEqual({ discountMinor: 10000, finalMinor: 50000 });
    expect(applyPromo(60000, 99999).finalMinor).toBe(100);
  });
});
