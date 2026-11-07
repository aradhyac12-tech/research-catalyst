// Submission fee rules. The fee is paid at upload and screening starts only after it is paid.
// If the paper is rejected, a fixed processing amount is kept and the rest is refunded.
export const SUBMISSION_FEE_RETAINED_MINOR = 30000; // INR 300 kept on rejection

/** What is kept and what is refunded for a paid amount (after any promo discount). Never negative, never more than was paid. */
export function refundSplit(paidMinor: number, retainedMinor = SUBMISSION_FEE_RETAINED_MINOR) {
  const paid = Math.max(0, Math.trunc(paidMinor));
  const retained = Math.min(Math.max(0, retainedMinor), paid);
  return { retainedMinor: retained, refundMinor: paid - retained };
}

/** The most an admin can set as the publication fee, in minor units (1,000,000 in the currency). A guard against a typo such as an extra zero. */
export const FEE_MAX_MINOR = 100_000_000;

/** Plain-language problem with a proposed fee, or null. The fee is a whole number of minor units, at least 1.00 and at most FEE_MAX_MINOR. */
export function feeProblem(amountMinor: number): string | null {
  if (!Number.isInteger(amountMinor)) return "The fee must be a whole number of paise or cents.";
  if (amountMinor < 100) return "The fee must be at least 1.00.";
  if (amountMinor > FEE_MAX_MINOR) return "The fee is too large. Check the amount for an extra zero.";
  return null;
}
