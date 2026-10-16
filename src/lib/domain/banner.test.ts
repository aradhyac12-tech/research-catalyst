import { describe, expect, it } from "vitest";
import { bannerProblems, bannerWindowOpen, dismissKey, earliestEnd, formatRupees, isSafeCtaUrl, promoUsable, suggestBannerCopy, timeLeft } from "./banner";

const ok = { title: "₹100 off your fee", message: "First 100 authors.", theme: "ink", placement: "TOP_BAR", ctaLabel: "Submit research", ctaUrl: "/submit" };

describe("bannerProblems", () => {
  it("accepts a complete banner", () => expect(bannerProblems(ok)).toEqual([]));
  it("rejects a short headline, long message, unknown theme or placement", () => {
    expect(bannerProblems({ ...ok, title: "ab" })).toHaveLength(1);
    expect(bannerProblems({ ...ok, message: "x".repeat(241) })).toHaveLength(1);
    expect(bannerProblems({ ...ok, theme: "neon" })).toHaveLength(1);
    expect(bannerProblems({ ...ok, placement: "POPUP" })).toHaveLength(1);
  });
  it("needs button text and a safe link together, or neither", () => {
    expect(bannerProblems({ ...ok, ctaLabel: "", ctaUrl: "" })).toEqual([]);
    expect(bannerProblems({ ...ok, ctaLabel: "Go", ctaUrl: "" })).toHaveLength(1);
    expect(bannerProblems({ ...ok, ctaLabel: "", ctaUrl: "/submit" })).toHaveLength(1);
    expect(bannerProblems({ ...ok, ctaUrl: "javascript:alert(1)" })).toHaveLength(1);
  });
  it("needs the end after the start", () => expect(bannerProblems({ ...ok, startsAt: "2026-10-12T00:00:00Z", endsAt: "2026-10-11T00:00:00Z" })).toHaveLength(1));
});

describe("isSafeCtaUrl", () => {
  it("allows internal paths and https only", () => {
    for (const u of ["/", "/submit", "/fees?x=1", "https://paperly.example/a"]) expect(isSafeCtaUrl(u)).toBe(true);
    for (const u of ["//evil.com", "http://x.com", "javascript:alert(1)", "data:text/html,x", "submit", "/a b"]) expect(isSafeCtaUrl(u)).toBe(false);
  });
});

describe("generated copy", () => {
  it("writes a plain first-N offer", () => {
    const c = suggestBannerCopy({ amountOffMinor: 10000, maxRedemptions: 100, code: "LAUNCH100", expiresAt: null });
    expect(c.title).toBe("₹100 off your publication fee");
    expect(c.message).toBe("First 100 authors only. Use code LAUNCH100 at checkout.");
  });
  it("has no limit sentence without a limit, and adds an end date when there is one", () => {
    const c = suggestBannerCopy({ amountOffMinor: 5050, maxRedemptions: null, code: "SAVE", expiresAt: "2026-12-31T18:29:59Z" });
    expect(c.title).toBe("₹50.50 off your publication fee");
    expect(c.message.startsWith("Use code SAVE at checkout.")).toBe(true);
    expect(c.message).toMatch(/Ends \d{1,2} \w+ 2026\./);
  });
  it("formats rupees", () => { expect(formatRupees(10000)).toBe("₹100"); expect(formatRupees(150000)).toBe("₹1,500"); });
});

describe("visibility", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("respects the schedule window", () => {
    expect(bannerWindowOpen({ starts_at: null, ends_at: null }, now)).toBe(true);
    expect(bannerWindowOpen({ starts_at: "2026-10-12T00:00:00Z", ends_at: null }, now)).toBe(false);
    expect(bannerWindowOpen({ starts_at: null, ends_at: "2026-10-11T11:00:00Z" }, now)).toBe(false);
  });
  it("hides a code that is used up, expired or switched off, and counts what is left", () => {
    expect(promoUsable({ active: true, expires_at: null, max_redemptions: 100 }, 37, now)).toEqual({ usable: true, remaining: 63 });
    expect(promoUsable({ active: true, expires_at: null, max_redemptions: 100 }, 100, now)).toEqual({ usable: false, remaining: 0 });
    expect(promoUsable({ active: true, expires_at: "2026-10-11T00:00:00Z", max_redemptions: null }, 0, now).usable).toBe(false);
    expect(promoUsable({ active: false, expires_at: null, max_redemptions: null }, 0, now).usable).toBe(false);
    expect(promoUsable({ active: true, expires_at: null, max_redemptions: null }, 999, now)).toEqual({ usable: true, remaining: null });
  });
  it("takes the earlier end", () => {
    expect(earliestEnd("2026-10-20T00:00:00Z", "2026-10-15T00:00:00Z")).toBe("2026-10-15T00:00:00Z");
    expect(earliestEnd(null, "2026-10-15T00:00:00Z")).toBe("2026-10-15T00:00:00Z");
    expect(earliestEnd(null, null)).toBeNull();
  });
  it("a new version brings a dismissed banner back", () => expect(dismissKey({ id: "a", version: "1" })).not.toBe(dismissKey({ id: "a", version: "2" })));
});

describe("timeLeft", () => {
  const end = "2026-10-20T00:00:00Z", t = (iso: string) => new Date(iso).getTime();
  it("counts days, then hours, then minutes", () => {
    expect(timeLeft(end, t("2026-10-15T00:00:00Z")).text).toBe("5 days left");
    expect(timeLeft(end, t("2026-10-18T20:00:00Z")).text).toBe("1 day 4h left");
    expect(timeLeft(end, t("2026-10-19T14:30:00Z")).text).toBe("9h 30m left");
    expect(timeLeft(end, t("2026-10-19T23:59:15Z"))).toEqual({ text: "0m 45s left", urgent: true, ended: false });
  });
  it("reports ended", () => expect(timeLeft(end, t("2026-10-20T00:00:01Z")).ended).toBe(true));
});
