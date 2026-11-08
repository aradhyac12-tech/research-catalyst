import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, hasPermission, rolesGranting, type RoleName } from "./permissions";
import {
  REFERRAL_ALPHABET, REFERRAL_CODE_RE, buildReferralCookie, generateReferralCode, normalizeReferralCode,
  readReferralCookie, referralUrl, resolvePaperAttribution, validateShares,
} from "./referrals";

describe("referral codes are opaque", () => {
  it("are 8 unambiguous characters", () => {
    for (let i = 0; i < 500; i++) expect(generateReferralCode()).toMatch(REFERRAL_CODE_RE);
    expect(REFERRAL_ALPHABET).not.toMatch(/[01ILO]/);
    expect(REFERRAL_ALPHABET.length).toBe(31);
  });
  it("do not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generateReferralCode()));
    expect(seen.size).toBe(5000);
  });
  it("use every symbol roughly evenly (no modulo bias)", () => {
    const counts = new Map<string, number>();
    // Sanity check only (about 7 standard deviations of slack, so it cannot flake). Bias itself is pinned by the deterministic test below.
    const N = 20000;
    for (let i = 0; i < N; i++) for (const ch of generateReferralCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (N * 8) / 31;
    expect(counts.size).toBe(31);
    for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.1);
  });
  it("discard biased bytes instead of wrapping them", () => {
    // 255 and 248 are above the unbiased limit (248); they must be skipped, so only the 0 bytes yield 'symbol 0'.
    let call = 0;
    const code = generateReferralCode(() => (call++ === 0 ? new Uint8Array(16).fill(255) : new Uint8Array(16).fill(0)));
    expect(code).toBe(REFERRAL_ALPHABET[0]!.repeat(8));
  });
  it("normalizes case and rejects anything that is not a code", () => {
    expect(normalizeReferralCode(" k7xm92qf ")).toBe("K7XM92QF");
    for (const bad of ["", "K7XM92Q", "K7XM92QFF", "K7XM92QO", "K7XM-2QF", null, undefined, 42, "../../etc"]) expect(normalizeReferralCode(bad)).toBeNull();
  });
  it("builds a link that contains only the code", () => {
    expect(referralUrl("https://paperly-publications.com/", "K7XM92QF")).toBe("https://paperly-publications.com/r/K7XM92QF");
  });
});

describe("referral cookie", () => {
  it("is HttpOnly and SameSite=Lax, and Secure when asked", () => {
    const c = buildReferralCookie("K7XM92QF", true);
    expect(c).toContain("HttpOnly"); expect(c).toContain("SameSite=Lax"); expect(c).toContain("Secure"); expect(c).toContain("Max-Age=2592000");
    expect(buildReferralCookie("K7XM92QF", false)).not.toContain("Secure");
  });
  it("is read back, ignoring other cookies and malformed values", () => {
    expect(readReferralCookie("a=1; pp_ref=K7XM92QF; b=2")).toBe("K7XM92QF");
    expect(readReferralCookie("pp_ref=nope")).toBeNull();
    expect(readReferralCookie("other=K7XM92QF")).toBeNull();
    expect(readReferralCookie(null)).toBeNull();
  });
});

describe("attribution resolution", () => {
  const A = { partnerId: "A", linkId: "la" }, B = { partnerId: "B", linkId: "lb" };
  it("credits nobody without a referral", () => expect(resolvePaperAttribution(null, null)).toBeNull());
  it("credits the submission link", () => expect(resolvePaperAttribution(A, null)).toEqual({ source: "SUBMISSION_LINK", shares: [{ ...A, sharePercent: 100 }] }));
  it("credits the registration partner", () => expect(resolvePaperAttribution(null, B)).toEqual({ source: "REGISTRATION", shares: [{ ...B, sharePercent: 100 }] }));
  it("does not double count one partner", () => {
    const r = resolvePaperAttribution(A, { partnerId: "A", linkId: "old" });
    expect(r?.shares).toEqual([{ ...A, sharePercent: 100 }]);
  });
  it("shares equally between two different partners, and always adds to 100", () => {
    const r = resolvePaperAttribution(A, B)!;
    expect(r.source).toBe("JOINT_AUTO");
    expect(r.shares.map((s) => s.sharePercent)).toEqual([50, 50]);
    expect(validateShares(r.shares)).toEqual({ ok: true });
  });
});

describe("share validation", () => {
  it("accepts splits that add to exactly 100", () => {
    expect(validateShares([{ partnerId: "a", sharePercent: 100 }]).ok).toBe(true);
    expect(validateShares([{ partnerId: "a", sharePercent: 33.33 }, { partnerId: "b", sharePercent: 33.33 }, { partnerId: "c", sharePercent: 33.34 }]).ok).toBe(true);
    expect(validateShares([{ partnerId: "a", sharePercent: 0.1 }, { partnerId: "b", sharePercent: 99.9 }]).ok).toBe(true); // float-safe
  });
  it("rejects bad totals, duplicates, non-positive, too many decimals and empty", () => {
    const r = (s: Array<{ partnerId: string; sharePercent: number }>) => validateShares(s);
    expect(r([{ partnerId: "a", sharePercent: 60 }, { partnerId: "b", sharePercent: 30 }])).toEqual({ ok: false, reason: "Shares must add up to 100% (currently 90%)" });
    expect(r([{ partnerId: "a", sharePercent: 50 }, { partnerId: "b", sharePercent: 60 }]).ok).toBe(false);
    expect(r([{ partnerId: "a", sharePercent: 50 }, { partnerId: "a", sharePercent: 50 }]).ok).toBe(false);
    expect(r([{ partnerId: "a", sharePercent: 0 }, { partnerId: "b", sharePercent: 100 }]).ok).toBe(false);
    expect(r([{ partnerId: "a", sharePercent: -5 }, { partnerId: "b", sharePercent: 105 }]).ok).toBe(false);
    expect(r([{ partnerId: "a", sharePercent: 33.333 }, { partnerId: "b", sharePercent: 66.667 }]).ok).toBe(false);
    expect(r([{ partnerId: "a", sharePercent: Number.NaN }]).ok).toBe(false);
    expect(r([]).ok).toBe(false);
    expect(r(Array.from({ length: 11 }, (_, i) => ({ partnerId: String(i), sharePercent: 100 / 11 }))).ok).toBe(false);
  });
});

describe("who may see referral identities", () => {
  it("only administrators hold REFERRAL_ADMIN", () => {
    expect(rolesGranting("REFERRAL_ADMIN").sort()).toEqual(["admin", "super_admin"]);
  });
  it("no other role, and no combination of non-admin roles, can see it", () => {
    const others = (Object.keys(ROLE_PERMISSIONS) as RoleName[]).filter((r) => r !== "admin" && r !== "super_admin");
    expect(others.length).toBeGreaterThan(5);
    expect(hasPermission(others, "REFERRAL_ADMIN")).toBe(false);
    for (const r of ["researcher", "editor", "founder", "payment_admin", "reviewer"]) expect(hasPermission([r], "REFERRAL_ADMIN")).toBe(false);
    expect(hasPermission(["admin"], "REFERRAL_ADMIN")).toBe(true);
    expect(hasPermission([], "REFERRAL_ADMIN")).toBe(false);
  });
});
