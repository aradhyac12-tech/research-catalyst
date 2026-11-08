// Promo codes: fixed amount off the publication fee. Pure helpers so the rules are testable.
export const RAZORPAY_MIN_MINOR = 100; // Razorpay rejects orders below 1.00 in the currency

export function normalizePromoCode(raw: string) {
  return raw.trim().toUpperCase();
}
export const PROMO_CODE_RE = /^[A-Z0-9_-]{3,32}$/;

export interface PromoRow {
  id: string; code: string; amount_off_minor: number; currency: string; active: boolean;
  max_redemptions: number | null; expires_at: string | null;
}

/** Returns an error message, or null when the code can be used for this price/currency right now. */
export function promoProblem(p: PromoRow, priceMinor: number, currency: string, redeemed: number, redeemedByUser: number, now = new Date()): string | null {
  if (!p.active) return "This promo code is not active";
  if (p.currency !== currency) return "This promo code does not apply to this payment";
  if (p.expires_at && new Date(p.expires_at) <= now) return "This promo code has expired";
  if (p.max_redemptions !== null && redeemed >= p.max_redemptions) return "This promo code has been fully used";
  if (redeemedByUser > 0) return "You have already used this promo code";
  if (priceMinor - p.amount_off_minor < RAZORPAY_MIN_MINOR) return "This promo code cannot be applied to this price";
  return null;
}

export function applyPromo(priceMinor: number, amountOffMinor: number) {
  const discount = Math.min(amountOffMinor, Math.max(0, priceMinor - RAZORPAY_MIN_MINOR));
  return { discountMinor: discount, finalMinor: priceMinor - discount };
}
