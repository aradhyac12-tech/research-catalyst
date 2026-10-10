// Submission fee rules. The fee is paid at upload and screening starts only after it is paid.
// If the paper is rejected, a fixed processing amount is kept and the rest is refunded.
export const SUBMISSION_FEE_RETAINED_MINOR = 30000; // INR 300 kept on rejection

/** What is kept and what is refunded for a paid amount (after any promo discount). Never negative, never more than was paid. */
export function refundSplit(paidMinor: number, retainedMinor = SUBMISSION_FEE_RETAINED_MINOR) {
  const paid = Math.max(0, Math.trunc(paidMinor));
  const retained = Math.min(Math.max(0, retainedMinor), paid);
  return { retainedMinor: retained, refundMinor: paid - retained };
}
