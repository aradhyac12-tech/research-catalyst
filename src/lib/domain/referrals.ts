// Referral links: pure rules, no I/O. Everything that touches the database lives in server/referrals.server.ts.
//
// Privacy rule that shapes this file: a referral code is OPAQUE. It is random, so it can never contain or be derived from a partner's
// name, initials, username or id, and nothing here ever puts partner identity into a URL, cookie or client-visible value.

/** No 0/1/I/L/O, so codes survive being read aloud or retyped. 31 symbols x 8 places is about 8.5e11 possibilities. */
export const REFERRAL_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_RE = /^[A-HJ-KM-NP-Z2-9]{8}$/;
export const REFERRAL_COOKIE = "pp_ref";
export const REFERRAL_COOKIE_DAYS = 30;
export const MAX_SHARE_PARTNERS = 10;

type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Uniformly random code. Rejection sampling (bytes at or above 248 are discarded) removes modulo bias. */
export function generateReferralCode(randomBytes: RandomBytes = cryptoBytes): string {
  const limit = 256 - (256 % REFERRAL_ALPHABET.length);
  let out = "";
  while (out.length < REFERRAL_CODE_LENGTH) {
    for (const b of randomBytes(REFERRAL_CODE_LENGTH * 2)) {
      if (b < limit && out.length < REFERRAL_CODE_LENGTH) out += REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length];
    }
  }
  return out;
}

/** Canonical form of something a visitor typed or a link carried, or null when it cannot be a code. Case does not matter. */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const c = input.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(c) ? c : null;
}

export function referralUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${code}`;
}

export function buildReferralCookie(code: string, secure: boolean): string {
  // HttpOnly: page scripts cannot read it. Lax: sent when the visitor follows a link from another site, not on cross-site posts.
  return `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function readReferralCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === REFERRAL_COOKIE) return normalizeReferralCode(part.slice(i + 1));
  }
  return null;
}

export type Touch = { partnerId: string; linkId: string | null };
export type Share = { partnerId: string; linkId: string | null; sharePercent: number };
export type AttributionSource = "SUBMISSION_LINK" | "REGISTRATION" | "JOINT_AUTO" | "ADMIN";
export type Resolved = { source: AttributionSource; shares: Share[] } | null;

/**
 * Who gets credit for a paper at the moment it is submitted.
 *  - only the link used for this submission  -> that partner, 100%
 *  - only the link the author registered through -> that partner, 100%
 *  - both, same partner -> that partner, 100% (no double counting)
 *  - both, different partners -> shared equally (50/50), marked JOINT_AUTO. This default is a business rule kept in this one place;
 *    an administrator can change any split afterwards.
 */
export function resolvePaperAttribution(submission: Touch | null, registration: Touch | null): Resolved {
  if (submission && registration && submission.partnerId !== registration.partnerId) {
    return { source: "JOINT_AUTO", shares: [
      { partnerId: submission.partnerId, linkId: submission.linkId, sharePercent: 50 },
      { partnerId: registration.partnerId, linkId: registration.linkId, sharePercent: 50 },
    ] };
  }
  if (submission) return { source: "SUBMISSION_LINK", shares: [{ partnerId: submission.partnerId, linkId: submission.linkId, sharePercent: 100 }] };
  if (registration) return { source: "REGISTRATION", shares: [{ partnerId: registration.partnerId, linkId: registration.linkId, sharePercent: 100 }] };
  return null;
}

/** Shares of one paper: 1 to 10 distinct partners, each above zero with at most two decimals, adding up to exactly 100. Integer cents avoid float drift. */
export function validateShares(shares: ReadonlyArray<{ partnerId: string; sharePercent: number }>): { ok: true } | { ok: false; reason: string } {
  if (shares.length < 1) return { ok: false, reason: "Add at least one partner" };
  if (shares.length > MAX_SHARE_PARTNERS) return { ok: false, reason: `At most ${MAX_SHARE_PARTNERS} partners can share an article` };
  if (new Set(shares.map((s) => s.partnerId)).size !== shares.length) return { ok: false, reason: "A partner can appear only once" };
  let cents = 0;
  for (const s of shares) {
    if (!Number.isFinite(s.sharePercent) || s.sharePercent <= 0 || s.sharePercent > 100) return { ok: false, reason: "Each share must be above 0 and at most 100" };
    const c = Math.round(s.sharePercent * 100);
    if (Math.abs(c - s.sharePercent * 100) > 1e-6) return { ok: false, reason: "Use at most two decimal places" };
    cents += c;
  }
  return cents === 10000 ? { ok: true } : { ok: false, reason: `Shares must add up to 100% (currently ${Number((cents / 100).toFixed(2))}%)` };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Discount amount of a link, and how it is divided
// ---------------------------------------------------------------------------------------------------------------------------
export const MAX_DISCOUNT_MINOR = 100_000_000; // Rs 10,00,000. Same ceiling as the database check.

/** Rupees typed by an administrator ("250", "250.5", "1,200.00") to paise, or null when it is not a valid amount. At most two decimals. */
export function parseRupees(input: string): number | null {
  const t = input.replace(/[,\s]/g, "").replace(/^₹/, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  const minor = Math.round(Number(t) * 100);
  return Number.isFinite(minor) && minor >= 0 && minor <= MAX_DISCOUNT_MINOR ? minor : null;
}

/**
 * Divide a link's discount between the students who uploaded through it. Students who only signed up get nothing, so `uploaders` is
 * the number of students with at least one article. Whole paise only: the remainder goes one paise at a time to the earliest uploaders,
 * so the parts always add up to exactly the total. Zero uploaders -> no parts (nothing is owed yet).
 */
export function splitDiscount(totalMinor: number, uploaders: number): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0 || !Number.isInteger(uploaders) || uploaders < 1) return [];
  const base = Math.floor(totalMinor / uploaders);
  const extra = totalMinor - base * uploaders;
  return Array.from({ length: uploaders }, (_, i) => base + (i < extra ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------------
// The discount taken off the submission fee of a person who came through a link
// ---------------------------------------------------------------------------------------------------------------------------
/** Razorpay refuses orders below 1.00, so a discount can never take the fee under this. Same floor as promo codes (domain/promo.ts). */
export const MIN_PAYABLE_MINOR = 100;

/**
 * What a link takes off ONE submission fee. The full amount the administrator set, but never more than leaves MIN_PAYABLE_MINOR payable.
 * Each referred person gets it once (the server enforces that); it is not divided between people any more.
 */
export function linkDiscountOnFee(feeMinor: number, linkDiscountMinor: number): { discountMinor: number; finalMinor: number } {
  const fee = Number.isFinite(feeMinor) ? Math.max(0, Math.trunc(feeMinor)) : 0;
  const want = Number.isFinite(linkDiscountMinor) ? Math.max(0, Math.trunc(linkDiscountMinor)) : 0;
  const d = Math.min(want, Math.max(0, fee - MIN_PAYABLE_MINOR));
  return { discountMinor: d, finalMinor: fee - d };
}

/** Several links can claim one person (the one they registered through and the one used at submission). They get the best single discount, never a sum. */
export function bestLinkDiscount<T extends { amountMinor: number }>(candidates: ReadonlyArray<T>): T | null {
  let best: T | null = null;
  for (const c of candidates) if (c.amountMinor > 0 && (!best || c.amountMinor > best.amountMinor)) best = c;
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Name and age
// ---------------------------------------------------------------------------------------------------------------------------
export const MIN_AGE = 10;
export const MAX_AGE = 100;

/** The name the account holder typed, or null when it cannot be a real name (too short, no letter, or just an e-mail prefix). */
export function cleanPersonName(input: unknown, email?: string | null): string | null {
  if (typeof input !== "string") return null;
  const n = input.replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 120 || !/\p{L}/u.test(n)) return null;
  const prefix = (email ?? "").split("@")[0]?.trim().toLowerCase();
  if (n.toLowerCase() === "researcher" || (prefix && n.toLowerCase() === prefix)) return null;
  return n;
}

/** Whole years between MIN_AGE and MAX_AGE, from a number or digits typed in a box; otherwise null. */
export function cleanAge(input: unknown): number | null {
  const v = typeof input === "string" ? (/^\s*\d{1,3}\s*$/.test(input) ? Number(input) : NaN) : input;
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_AGE && v <= MAX_AGE ? v : null;
}
