import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminDeleteBanner, adminListBanners, adminSaveBanner, adminSetBannerActive } from "@/lib/banners.functions";
import { adminListPromoCodes } from "@/lib/app.functions";
import { BANNER_PLACEMENTS, BANNER_THEMES, bannerProblems, earliestEnd, formatRupees, suggestBannerCopy, type BannerPlacement, type BannerTheme, type PublicBanner } from "@/lib/domain/banner";
import { BannerView } from "@/components/promo-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SWATCH: Record<BannerTheme, string> = { ink: "bg-[#14213d]", brand: "bg-primary", gold: "bg-[#f3dfa2]", forest: "bg-[#1b6e4f]", plum: "bg-[#4a2c73]" };
type PromoMode = "none" | "existing" | "new";
interface Form {
  id: string | null; title: string; message: string; theme: BannerTheme; placement: BannerPlacement;
  promoMode: PromoMode; promoId: string; code: string; rupees: string; max: string; promoExpires: string;
  ctaLabel: string; ctaUrl: string; showCountdown: boolean; showRemaining: boolean; dismissible: boolean; startsAt: string; endsAt: string;
}
const blank: Form = {
  id: null, title: "", message: "", theme: "ink", placement: "TOP_BAR", promoMode: "none", promoId: "", code: "", rupees: "", max: "", promoExpires: "",
  ctaLabel: "Submit research", ctaUrl: "/submit", showCountdown: true, showRemaining: true, dismissible: true, startsAt: "", endsAt: "",
};
const startIso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const endIso = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);
const toDateInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function Label({ id, children }: { id: string; children: React.ReactNode }) { return <label htmlFor={id} className="mb-1 block text-sm font-medium">{children}</label>; }

export function BannerAdmin() {
  const qc = useQueryClient();
  const { data: banners, error } = useQuery({ queryKey: ["admin-banners"], queryFn: () => adminListBanners(), retry: false });
  const { data: promos } = useQuery({ queryKey: ["admin-promos"], queryFn: () => adminListPromoCodes(), retry: false });
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-banners"] }); qc.invalidateQueries({ queryKey: ["admin-promos"] }); qc.invalidateQueries({ queryKey: ["banners"] }); };

  const picked = promos?.find((p) => p.id === f.promoId);
  const offerNumbers = useMemo(() => {
    if (f.promoMode === "new") {
      const off = Math.round(parseFloat(f.rupees) * 100);
      return { code: f.code.trim().toUpperCase(), amountOffMinor: Number.isFinite(off) && off > 0 ? off : 0, total: f.max ? parseInt(f.max, 10) || null : null, used: 0, expires: endIso(f.promoExpires) };
    }
    if (f.promoMode === "existing" && picked) return { code: picked.code as string, amountOffMinor: picked.amount_off_minor as number, total: (picked.max_redemptions ?? null) as number | null, used: (picked.redeemed ?? 0) as number, expires: (picked.expires_at ?? null) as string | null };
    return null;
  }, [f.promoMode, f.code, f.rupees, f.max, f.promoExpires, picked]);

  const preview: PublicBanner = {
    id: "preview", version: "preview", title: f.title.trim() || "Your headline appears here", message: f.message.trim(), theme: f.theme, placement: f.placement,
    ctaLabel: f.ctaLabel.trim() || null, ctaUrl: f.ctaLabel.trim() ? f.ctaUrl.trim() || null : null, dismissible: f.dismissible, showCountdown: f.showCountdown, showRemaining: f.showRemaining,
    endsAt: earliestEnd(endIso(f.endsAt), offerNumbers?.expires ?? null),
    promo: offerNumbers && offerNumbers.code ? { code: offerNumbers.code, amountOffMinor: offerNumbers.amountOffMinor, total: offerNumbers.total, remaining: offerNumbers.total === null ? null : Math.max(0, offerNumbers.total - offerNumbers.used) } : null,
  };

  function generate() {
    if (!offerNumbers || !offerNumbers.code || !offerNumbers.amountOffMinor) { toast.error("Choose or create a promo code first, so the text can use its amount and limit."); return; }
    const s = suggestBannerCopy({ amountOffMinor: offerNumbers.amountOffMinor, maxRedemptions: offerNumbers.total, code: offerNumbers.code, expiresAt: offerNumbers.expires });
    setF((cur) => ({ ...cur, title: s.title, message: s.message }));
  }

  async function save() {
    const problems = bannerProblems({ title: f.title, message: f.message, theme: f.theme, placement: f.placement, ctaLabel: f.ctaLabel, ctaUrl: f.ctaUrl, startsAt: startIso(f.startsAt), endsAt: endIso(f.endsAt) });
    if (f.promoMode === "existing" && !f.promoId) problems.push("Choose which promo code this banner shows.");
    if (f.promoMode === "new" && (f.code.trim().length < 3 || !offerNumbers?.amountOffMinor)) problems.push("A new code needs its text and the amount off in rupees.");
    if (problems.length) { toast.error(problems[0]); return; }
    setBusy(true);
    try {
      await adminSaveBanner({ data: {
        ...(f.id ? { id: f.id } : {}), title: f.title.trim(), message: f.message.trim(), theme: f.theme, placement: f.placement,
        promoId: f.promoMode === "existing" ? f.promoId : null,
        newPromo: f.promoMode === "new" ? { code: f.code.trim().toUpperCase(), amountOffMinor: offerNumbers!.amountOffMinor, maxRedemptions: offerNumbers!.total, expiresAt: endIso(f.promoExpires) } : null,
        ctaLabel: f.ctaLabel.trim() || null, ctaUrl: f.ctaLabel.trim() ? f.ctaUrl.trim() : null,
        showCountdown: f.showCountdown, showRemaining: f.showRemaining, dismissible: f.dismissible, startsAt: startIso(f.startsAt), endsAt: endIso(f.endsAt),
      } });
      toast.success(f.id ? "Banner updated" : "Banner is live"); setF(blank); refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save the banner"); refresh(); }
    finally { setBusy(false); }
  }
  async function toggle(id: string, active: boolean) { try { await adminSetBannerActive({ data: { id, active } }); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the banner"); } }
  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete the banner "${title}"? The promo code it shows is not deleted.`)) return;
    try { await adminDeleteBanner({ data: { id } }); if (f.id === id) setF(blank); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete the banner"); }
  }
  type Row = NonNullable<typeof banners>[number];
  function edit(b: Row) {
    setF({
      id: b.id, title: b.title, message: b.message, theme: b.theme, placement: b.placement, promoMode: b.promo ? "existing" : "none", promoId: b.promo?.id ?? "", code: "", rupees: "", max: "", promoExpires: "",
      ctaLabel: b.cta_label ?? "", ctaUrl: b.cta_url ?? "", showCountdown: b.show_countdown, showRemaining: b.show_remaining, dismissible: b.dismissible, startsAt: toDateInput(b.starts_at), endsAt: toDateInput(b.ends_at),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function status(b: Row): { label: string; tone: string } {
    const now = new Date();
    if (!b.active) return { label: "Paused", tone: "bg-muted text-muted-foreground" };
    if (b.starts_at && new Date(b.starts_at) > now) return { label: "Scheduled", tone: "bg-caution-soft text-caution" };
    if (b.ends_at && new Date(b.ends_at) <= now) return { label: "Ended", tone: "bg-muted text-muted-foreground" };
    if (b.promo && (!b.promo.active || (b.promo.expiresAt && new Date(b.promo.expiresAt) <= now) || (b.promo.maxRedemptions !== null && b.promo.used >= b.promo.maxRedemptions))) return { label: "Offer over", tone: "bg-muted text-muted-foreground" };
    return { label: "Live", tone: "bg-positive-soft text-positive" };
  }
  if (error) return <p className="text-sm text-muted-foreground">You do not have access to banners.</p>;

  const field = "min-w-0";
  return (
    <div className="min-w-0 space-y-8">
      <p className="max-w-[70ch] text-[15px] text-muted-foreground">Make an announcement or an offer. Attach a promo code and visitors get a one-click copy button. When a code runs out or expires, its banner disappears by itself.</p>

      <div className="space-y-2" aria-live="polite">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live preview</h3>
        <div className="overflow-hidden rounded border border-border"><BannerView banner={preview} variant={f.placement === "HERO" ? "hero" : "bar"} /></div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-[1.05rem] font-semibold">1. The offer</h3>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Promo code for this banner">
            {([["none", "No code"], ["existing", "Existing code"], ["new", "New code"]] as const).map(([m, l]) => (
              <button key={m} type="button" role="radio" aria-checked={f.promoMode === m} onClick={() => set("promoMode", m)}
                className={cn("min-h-10 border px-4 text-sm font-semibold", f.promoMode === m ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-wash")}>{l}</button>
            ))}
          </div>
          {f.promoMode === "existing" && (
            <div className={field}><Label id="bn-promo">Promo code</Label>
              <select id="bn-promo" className="flex h-11 w-full rounded-lg border border-input bg-background px-3 text-base" value={f.promoId} onChange={(e) => set("promoId", e.target.value)}>
                <option value="">Choose a code…</option>
                {(promos ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {formatRupees(p.amount_off_minor)} off{p.max_redemptions ? ` · ${p.redeemed}/${p.max_redemptions} used` : ""}{p.active ? "" : " · off"}</option>)}
              </select>
            </div>
          )}
          {f.promoMode === "new" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={field}><Label id="bn-code">Code</Label><Input id="bn-code" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} maxLength={32} placeholder="LAUNCH100" /></div>
              <div className={field}><Label id="bn-off">Amount off (₹)</Label><Input id="bn-off" inputMode="decimal" value={f.rupees} onChange={(e) => set("rupees", e.target.value)} placeholder="100" /></div>
              <div className={field}><Label id="bn-max">First how many people?</Label><Input id="bn-max" inputMode="numeric" value={f.max} onChange={(e) => set("max", e.target.value.replace(/\D/g, ""))} placeholder="100 (blank = no limit)" /></div>
              <div className={field}><Label id="bn-pexp">Code expires (optional)</Label><Input id="bn-pexp" type="date" value={f.promoExpires} onChange={(e) => set("promoExpires", e.target.value)} /></div>
              <p className="text-sm text-muted-foreground sm:col-span-2">The code is created when you save. Each person can use it once, and it takes this amount off the publication fee at checkout.</p>
            </div>
          )}

          <h3 className="pt-2 text-[1.05rem] font-semibold">2. The words</h3>
          <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Write your own, or start from the offer.</span><Button type="button" variant="outline" size="sm" onClick={generate}>Generate text</Button></div>
          <div className={field}><Label id="bn-title">Headline</Label><Input id="bn-title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={90} /></div>
          <div className={field}><Label id="bn-msg">Message</Label><Textarea id="bn-msg" rows={2} value={f.message} onChange={(e) => set("message", e.target.value)} maxLength={240} /><p className="mt-1 text-xs text-muted-foreground">{f.message.length} / 240</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}><Label id="bn-cta">Button text (optional)</Label><Input id="bn-cta" value={f.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} maxLength={30} /></div>
            <div className={field}><Label id="bn-url">Button link</Label><Input id="bn-url" value={f.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="/submit or https://…" /></div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-[1.05rem] font-semibold">3. The look</h3>
          <fieldset><legend className="mb-1 text-sm font-medium">Colour</legend>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Banner colour">
              {BANNER_THEMES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={f.theme === t.id} onClick={() => set("theme", t.id)} className={cn("flex items-center gap-2 border px-3 py-2 text-sm font-medium", f.theme === t.id ? "border-primary ring-2 ring-primary" : "border-input hover:bg-wash")}>
                  <span aria-hidden className={cn("size-5 border border-black/20", SWATCH[t.id])} />{t.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset><legend className="mb-1 text-sm font-medium">Where it appears</legend>
            <div className="space-y-2" role="radiogroup" aria-label="Where the banner appears">
              {BANNER_PLACEMENTS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={f.placement === p.id} onClick={() => set("placement", p.id)} className={cn("block w-full border px-3 py-2 text-left", f.placement === p.id ? "border-primary bg-accent" : "border-input hover:bg-wash")}>
                  <span className="block text-sm font-semibold">{p.label}</span><span className="block text-sm text-muted-foreground">{p.note}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <h3 className="pt-2 text-[1.05rem] font-semibold">4. Extras and schedule</h3>
          <div className="space-y-2 text-[15px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.showCountdown} onChange={(e) => set("showCountdown", e.target.checked)} /> Show a countdown when there is an end date</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.showRemaining} onChange={(e) => set("showRemaining", e.target.checked)} /> Show how many spots are left (codes with a limit)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.dismissible} onChange={(e) => set("dismissible", e.target.checked)} /> Visitors can close it</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={field}><Label id="bn-start">Starts (optional)</Label><Input id="bn-start" type="date" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
            <div className={field}><Label id="bn-end">Ends (optional)</Label><Input id="bn-end" type="date" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={save} disabled={busy || f.title.trim().length < 3}>{busy ? "Saving…" : f.id ? "Save changes" : "Publish banner"}</Button>
            {f.id && <Button variant="outline" onClick={() => setF(blank)} disabled={busy}>Cancel editing</Button>}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[1.05rem] font-semibold">All banners</h3>
        {!banners?.length ? <p className="text-sm text-muted-foreground">No banners yet.</p> : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-2 pr-3 font-medium">Banner</th><th className="pr-3 font-medium">Where</th><th className="pr-3 font-medium">Code</th><th className="pr-3 font-medium">Status</th><th className="font-medium"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {banners.map((b) => { const s = status(b); return (
                  <tr key={b.id} className="border-b border-border align-top">
                    <td className="max-w-[18rem] py-2.5 pr-3"><span className="font-semibold">{b.title}</span>{b.message && <span className="block truncate text-muted-foreground">{b.message}</span>}</td>
                    <td className="pr-3">{b.placement === "HERO" ? "Home and fees" : "Top bar"}</td>
                    <td className="pr-3 font-mono">{b.promo ? <>{b.promo.code}<span className="block font-sans text-muted-foreground">{b.promo.maxRedemptions ? `${b.promo.used} of ${b.promo.maxRedemptions} used` : `${b.promo.used} used`}</span></> : "—"}</td>
                    <td className="pr-3"><span className={cn("inline-block px-2 py-0.5 text-xs font-semibold", s.tone)}>{s.label}</span></td>
                    <td className="whitespace-nowrap py-2">
                      <Button variant="outline" size="sm" onClick={() => edit(b)}>Edit</Button>{" "}
                      <Button variant="outline" size="sm" onClick={() => toggle(b.id, !b.active)}>{b.active ? "Pause" : "Resume"}</Button>{" "}
                      <Button variant="outline" size="sm" onClick={() => remove(b.id, b.title)}>Delete</Button>
                    </td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
