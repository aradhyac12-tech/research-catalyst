// Site banners and offers. Pure helpers so every rule is testable: what a banner may contain, when it is visible, the generated copy and the countdown.
export const BANNER_THEMES = [
  { id: "ink", label: "Ink" },
  { id: "brand", label: "Paperly blue" },
  { id: "gold", label: "Gold" },
  { id: "forest", label: "Forest" },
  { id: "plum", label: "Plum" },
] as const;
export type BannerTheme = (typeof BANNER_THEMES)[number]["id"];
export const BANNER_PLACEMENTS = [
  { id: "TOP_BAR", label: "Top bar", note: "A slim strip above the header on every page." },
  { id: "HERO", label: "Home and fees card", note: "A larger card on the home page and the fees page." },
] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number]["id"];

export interface PublicBanner {
  id: string; version: string; title: string; message: string; theme: BannerTheme; placement: BannerPlacement;
  ctaLabel: string | null; ctaUrl: string | null; dismissible: boolean; showCountdown: boolean; showRemaining: boolean;
  /** When the offer ends (the earlier of the banner's end and the promo code's expiry), or null. */
  endsAt: string | null;
  promo: { code: string; amountOffMinor: number; remaining: number | null; total: number | null } | null;
}

/** Internal path ("/submit") or https link. "//host" and "javascript:" are refused. */
export const isSafeCtaUrl = (u: string) => /^\/(?!\/)\S*$/.test(u) || /^https:\/\/[^\s]+$/.test(u);

export interface BannerFields {
  title: string; message: string; theme: string; placement: string; ctaLabel?: string | null | undefined; ctaUrl?: string | null | undefined;
  startsAt?: string | null | undefined; endsAt?: string | null | undefined;
}
export function bannerProblems(b: BannerFields): string[] {
  const v: string[] = [];
  const title = b.title.trim(), message = b.message.trim(), label = (b.ctaLabel ?? "").trim(), url = (b.ctaUrl ?? "").trim();
  if (title.length < 3 || title.length > 90) v.push("The headline needs 3 to 90 characters.");
  if (message.length > 240) v.push("The message can be at most 240 characters.");
  if (!BANNER_THEMES.some((t) => t.id === b.theme)) v.push("Choose one of the colour themes.");
  if (!BANNER_PLACEMENTS.some((p) => p.id === b.placement)) v.push("Choose where the banner appears.");
  if (label || url) {
    if (!label || label.length > 30) v.push("The button text needs 1 to 30 characters.");
    if (!url || !isSafeCtaUrl(url)) v.push("The button link must start with / or https://.");
  }
  if (b.startsAt && b.endsAt && new Date(b.endsAt) <= new Date(b.startsAt)) v.push("The end date must be after the start date.");
  return v;
}

export const formatRupees = (minor: number) => {
  const r = minor / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Plain, factual starter copy from the offer's numbers. The admin edits it freely. */
export function suggestBannerCopy(o: { amountOffMinor: number; maxRedemptions: number | null; code: string; expiresAt: string | null }): { title: string; message: string } {
  const title = `${formatRupees(o.amountOffMinor)} off your publication fee`;
  const who = o.maxRedemptions ? `First ${o.maxRedemptions.toLocaleString("en-IN")} authors only. ` : "";
  const until = o.expiresAt ? ` Ends ${new Date(o.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : "";
  return { title, message: `${who}Use code ${o.code || "YOURCODE"} at checkout.${until}` };
}

export function bannerWindowOpen(b: { starts_at: string | null; ends_at: string | null }, now = new Date()): boolean {
  if (b.starts_at && new Date(b.starts_at) > now) return false;
  if (b.ends_at && new Date(b.ends_at) <= now) return false;
  return true;
}

/** Whether a promo code can still be claimed, and how many claims remain (null = unlimited). */
export function promoUsable(p: { active: boolean; expires_at: string | null; max_redemptions: number | null }, redeemed: number, now = new Date()): { usable: boolean; remaining: number | null } {
  const remaining = p.max_redemptions === null ? null : Math.max(0, p.max_redemptions - redeemed);
  const usable = p.active && !(p.expires_at && new Date(p.expires_at) <= now) && (remaining === null || remaining > 0);
  return { usable, remaining };
}

/** The earlier of two optional end times, as an ISO string. */
export function earliestEnd(a: string | null, b: string | null): string | null {
  if (a && b) return new Date(a) <= new Date(b) ? a : b;
  return a ?? b;
}

export function timeLeft(endsAt: string, nowMs: number): { text: string; urgent: boolean; ended: boolean } {
  const ms = new Date(endsAt).getTime() - nowMs;
  if (ms <= 0) return { text: "Ended", urgent: false, ended: true };
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  if (d >= 2) return { text: `${d} days left`, urgent: false, ended: false };
  if (d === 1) return { text: `1 day ${h}h left`, urgent: false, ended: false };
  if (h >= 1) return { text: `${h}h ${two(m)}m left`, urgent: h < 6, ended: false };
  return { text: `${m}m ${two(sec)}s left`, urgent: true, ended: false };
}

/** A banner comes back for people who dismissed it once an admin edits it, because the version changes. */
export const dismissKey = (b: { id: string; version: string }) => `${b.id}:${b.version}`;
