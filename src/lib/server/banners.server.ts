// Site banners and offers. Public reads return only what a visitor may see; every write is an audited admin action.
import { promoUsage } from "./promo-usage.server";
import { dbx, audit } from "./core.server";
import { bannerProblems, bannerWindowOpen, earliestEnd, promoUsable, type PublicBanner, type BannerTheme, type BannerPlacement } from "@/lib/domain/banner";

const COLS = "id, title, message, theme, placement, promo_id, cta_label, cta_url, show_countdown, show_remaining, dismissible, active, starts_at, ends_at, created_at, updated_at";
interface Row {
  id: string; title: string; message: string; theme: BannerTheme; placement: BannerPlacement; promo_id: string | null; cta_label: string | null; cta_url: string | null;
  show_countdown: boolean; show_remaining: boolean; dismissible: boolean; active: boolean; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string;
}
interface PromoState { id: string; code: string; amount_off_minor: number; active: boolean; max_redemptions: number | null; expires_at: string | null; used: number }

async function promoStates(ids: string[]): Promise<Map<string, PromoState>> {
  const out = new Map<string, PromoState>();
  if (!ids.length) return out;
  const { data: promos } = await dbx.from("promo_codes").select("id, code, amount_off_minor, active, max_redemptions, expires_at").in("id", ids) as { data: Omit<PromoState, "used">[] | null };
  const usage = await promoUsage(ids);
  for (const p of promos ?? []) { const u = usage.get(p.id); out.set(p.id, { ...p, used: u ? u.used + u.held : 0 }); }
  return out;
}

/** Banners a visitor should see right now. A banner whose promo code is used up, expired or switched off is left out, so a "first 100" banner disappears by itself. */
export async function publicBanners(now = new Date()): Promise<PublicBanner[]> {
  const { data } = await dbx.from("site_banners").select(COLS).eq("active", true).order("created_at", { ascending: false }).limit(20) as { data: Row[] | null };
  const rows = (data ?? []).filter((r) => bannerWindowOpen(r, now));
  const states = await promoStates(rows.map((r) => r.promo_id).filter((x): x is string => !!x));
  const out: PublicBanner[] = [];
  for (const r of rows) {
    let promo: PublicBanner["promo"] = null, promoEnd: string | null = null;
    if (r.promo_id) {
      const p = states.get(r.promo_id);
      if (p) {
        const u = promoUsable(p, p.used, now);
        if (!u.usable) continue;
        promo = { code: p.code, amountOffMinor: p.amount_off_minor, remaining: u.remaining, total: p.max_redemptions };
        promoEnd = p.expires_at;
      }
    }
    out.push({
      id: r.id, version: r.updated_at, title: r.title, message: r.message, theme: r.theme, placement: r.placement,
      ctaLabel: r.cta_label, ctaUrl: r.cta_url, dismissible: r.dismissible, showCountdown: r.show_countdown, showRemaining: r.show_remaining,
      endsAt: earliestEnd(r.ends_at, promoEnd), promo,
    });
  }
  return out;
}

export async function adminListBanners() {
  const { data } = await dbx.from("site_banners").select(COLS).order("created_at", { ascending: false }) as { data: Row[] | null };
  const rows = data ?? [];
  const states = await promoStates(rows.map((r) => r.promo_id).filter((x): x is string => !!x));
  return rows.map((r) => {
    const p = r.promo_id ? states.get(r.promo_id) : undefined;
    return { ...r, promo: p ? { id: p.id, code: p.code, amountOffMinor: p.amount_off_minor, maxRedemptions: p.max_redemptions, used: p.used, active: p.active, expiresAt: p.expires_at } : null };
  });
}

export interface SaveBannerInput {
  id?: string | undefined; title: string; message: string; theme: string; placement: string; promoId?: string | null | undefined;
  newPromo?: { code: string; amountOffMinor: number; maxRedemptions?: number | null | undefined; expiresAt?: string | null | undefined } | null | undefined;
  ctaLabel?: string | null | undefined; ctaUrl?: string | null | undefined; showCountdown: boolean; showRemaining: boolean; dismissible: boolean; startsAt?: string | null | undefined; endsAt?: string | null | undefined;
}

export async function adminSaveBanner(actorId: string, i: SaveBannerInput) {
  const problems = bannerProblems(i);
  if (problems.length) throw new Error(problems.join(" "));
  let promoId = i.promoId ?? null;
  if (i.newPromo) {
    const { adminCreatePromo } = await import("./payments.server");
    promoId = (await adminCreatePromo(actorId, { code: i.newPromo.code, amountOffMinor: i.newPromo.amountOffMinor, maxRedemptions: i.newPromo.maxRedemptions ?? null, expiresAt: i.newPromo.expiresAt ?? null })).id;
  } else if (promoId) {
    const { data } = await dbx.from("promo_codes").select("id").eq("id", promoId).maybeSingle();
    if (!data) throw new Error("That promo code no longer exists");
  }
  const label = (i.ctaLabel ?? "").trim(), url = (i.ctaUrl ?? "").trim();
  const row = {
    title: i.title.trim(), message: i.message.trim(), theme: i.theme, placement: i.placement, promo_id: promoId,
    cta_label: label || null, cta_url: label && url ? url : null, show_countdown: i.showCountdown, show_remaining: i.showRemaining, dismissible: i.dismissible,
    starts_at: i.startsAt ?? null, ends_at: i.endsAt ?? null, updated_at: new Date().toISOString(),
  };
  if (i.id) {
    const upd = await dbx.from("site_banners").update(row).eq("id", i.id).select("id");
    if (upd.error || !upd.data?.length) throw new Error("Banner not found");
    await audit({ actor_id: actorId, action: "banner_updated", resource_type: "site_banner", resource_id: i.id, new_value: { title: row.title, placement: row.placement, promo_id: promoId } });
    return { id: i.id };
  }
  const ins = await dbx.from("site_banners").insert({ ...row, created_by: actorId }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  await audit({ actor_id: actorId, action: "banner_created", resource_type: "site_banner", resource_id: ins.data.id, new_value: { title: row.title, placement: row.placement, promo_id: promoId } });
  return { id: ins.data.id as string };
}

export async function adminSetBannerActive(actorId: string, id: string, active: boolean) {
  const upd = await dbx.from("site_banners").update({ active, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (upd.error || !upd.data?.length) throw new Error("Banner not found");
  await audit({ actor_id: actorId, action: active ? "banner_enabled" : "banner_disabled", resource_type: "site_banner", resource_id: id });
}

export async function adminDeleteBanner(actorId: string, id: string) {
  const del = await dbx.from("site_banners").delete().eq("id", id).select("id");
  if (del.error || !del.data?.length) throw new Error("Banner not found");
  await audit({ actor_id: actorId, action: "banner_deleted", resource_type: "site_banner", resource_id: id });
}
