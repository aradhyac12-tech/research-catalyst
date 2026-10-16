import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Check, Copy, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { bannersQuery } from "@/lib/queries";
import { dismissKey, formatRupees, timeLeft, type BannerTheme, type PublicBanner } from "@/lib/domain/banner";
import { cn } from "@/lib/utils";

// One look per theme. Flat colour, a ruled "ticket" for the code and no gradients, to match the rest of the site.
const THEME: Record<BannerTheme, { surface: string; sub: string; ticket: string; button: string; ghost: string; track: string; fill: string }> = {
  ink: { surface: "bg-[#14213d] text-white", sub: "text-white/80", ticket: "border-white/50 bg-white/10", button: "bg-white text-[#14213d] hover:bg-white/90", ghost: "hover:bg-white/15", track: "bg-white/20", fill: "bg-white" },
  brand: { surface: "bg-primary text-primary-foreground", sub: "text-primary-foreground/80", ticket: "border-primary-foreground/50 bg-primary-foreground/10", button: "bg-primary-foreground text-primary hover:bg-primary-foreground/90", ghost: "hover:bg-primary-foreground/15", track: "bg-primary-foreground/20", fill: "bg-primary-foreground" },
  gold: { surface: "bg-[#f3dfa2] text-[#33260a]", sub: "text-[#33260a]/80", ticket: "border-[#33260a]/50 bg-[#33260a]/5", button: "bg-[#33260a] text-[#f3dfa2] hover:bg-[#33260a]/90", ghost: "hover:bg-[#33260a]/10", track: "bg-[#33260a]/15", fill: "bg-[#33260a]" },
  forest: { surface: "bg-[#1b6e4f] text-white", sub: "text-white/85", ticket: "border-white/50 bg-white/10", button: "bg-white text-[#1b6e4f] hover:bg-white/90", ghost: "hover:bg-white/15", track: "bg-white/20", fill: "bg-white" },
  plum: { surface: "bg-[#4a2c73] text-white", sub: "text-white/80", ticket: "border-white/50 bg-white/10", button: "bg-white text-[#4a2c73] hover:bg-white/90", ghost: "hover:bg-white/15", track: "bg-white/20", fill: "bg-white" },
};

/** Ticks once a second, but only after the page has loaded in the browser, so server and browser agree on first paint. */
function useNow(enabled: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

export function CopyCode({ code, theme, large }: { code: string; theme: BannerTheme; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  const t = THEME[theme];
  async function copy() {
    try { await navigator.clipboard.writeText(code); }
    catch {
      try {
        const el = document.createElement("textarea");
        el.value = code; el.setAttribute("readonly", ""); el.style.position = "fixed"; el.style.opacity = "0";
        document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
      } catch { toast.error("Could not copy. Select the code and copy it by hand."); return; }
    }
    setCopied(true); toast.success(`Code ${code} copied`);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className={cn("inline-flex items-stretch border border-dashed", t.ticket, large ? "text-lg" : "text-sm")}>
      <span className={cn("select-all font-mono font-semibold tracking-[0.14em]", large ? "px-4 py-2.5" : "px-3 py-1.5")}>{code}</span>
      <button type="button" onClick={copy} aria-label={copied ? `Code ${code} copied` : `Copy code ${code}`}
        className={cn("inline-flex items-center gap-1.5 border-l border-dashed px-3 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", t.ticket, t.ghost, large && "px-4")}>
        {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

function Cta({ banner, className }: { banner: PublicBanner; className: string }) {
  const router = useRouter();
  if (!banner.ctaLabel || !banner.ctaUrl) return null;
  const internal = banner.ctaUrl.startsWith("/");
  return (
    <a href={banner.ctaUrl} className={className} {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      onClick={(e) => { if (internal && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); router.navigate({ to: banner.ctaUrl as never }); } }}>
      {banner.ctaLabel}
    </a>
  );
}

function Countdown({ endsAt, theme, className }: { endsAt: string; theme: BannerTheme; className?: string }) {
  const now = useNow(true);
  if (now === null) return null;
  const left = timeLeft(endsAt, now);
  if (left.ended) return null;
  return <span className={cn("inline-flex items-center gap-1.5 font-medium tabular-nums", THEME[theme].sub, left.urgent && "font-semibold", className)}><Timer aria-hidden className="size-4" />{left.text}</span>;
}

function Remaining({ promo, theme }: { promo: NonNullable<PublicBanner["promo"]>; theme: BannerTheme }) {
  if (promo.remaining === null || !promo.total) return null;
  const t = THEME[theme];
  const pct = Math.max(4, Math.min(100, Math.round((promo.remaining / promo.total) * 100)));
  return (
    <div className="w-full max-w-xs">
      <div className={cn("mb-1 text-sm font-medium", t.sub)}>{promo.remaining.toLocaleString("en-IN")} of {promo.total.toLocaleString("en-IN")} left</div>
      <div className={cn("h-1.5 w-full", t.track)} role="progressbar" aria-label="Spots left" aria-valuemin={0} aria-valuemax={promo.total} aria-valuenow={promo.remaining}><div className={cn("h-full", t.fill)} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** The banner itself. Used on the site and, with the same code, in the admin preview. */
export function BannerView({ banner, variant, onDismiss }: { banner: PublicBanner; variant: "bar" | "hero"; onDismiss?: (() => void) | undefined }) {
  const t = THEME[banner.theme] ?? THEME.ink;
  const dismiss = banner.dismissible && onDismiss ? (
    <button type="button" onClick={onDismiss} aria-label="Dismiss this banner" className={cn("inline-flex size-9 shrink-0 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", t.ghost)}><X aria-hidden className="size-5" /></button>
  ) : null;
  if (variant === "bar") {
    return (
      <div className={t.surface}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-5">
          <p className="min-w-0 text-center text-[15px] leading-snug sm:text-left"><strong className="font-semibold">{banner.title}</strong>{banner.message && <span className={cn("ml-2", t.sub)}>{banner.message}</span>}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {banner.promo && <CopyCode code={banner.promo.code} theme={banner.theme} />}
            {banner.showCountdown && banner.endsAt && <Countdown endsAt={banner.endsAt} theme={banner.theme} className="text-sm" />}
            {banner.showRemaining && banner.promo && banner.promo.remaining !== null && <span className={cn("text-sm font-medium", t.sub)}>{banner.promo.remaining.toLocaleString("en-IN")} left</span>}
            <Cta banner={banner} className={cn("inline-flex h-8 items-center px-3.5 text-sm font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", t.button)} />
          </div>
          {dismiss}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("relative", t.surface)}>
      <div className="flex flex-col gap-6 px-6 py-7 sm:px-9 sm:py-9 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 max-w-[58ch]">
          {banner.promo && <p className={cn("mb-2 text-sm font-semibold uppercase tracking-[0.12em]", t.sub)}>{formatRupees(banner.promo.amountOffMinor)} off</p>}
          <h2 className="font-serif text-[1.75rem] font-semibold leading-tight sm:text-[2.1rem]">{banner.title}</h2>
          {banner.message && <p className={cn("mt-3 text-[17px] leading-relaxed", t.sub)}>{banner.message}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            {banner.showCountdown && banner.endsAt && <Countdown endsAt={banner.endsAt} theme={banner.theme} />}
            <Cta banner={banner} className={cn("inline-flex h-11 items-center px-5 text-base font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", t.button)} />
          </div>
        </div>
        {banner.promo && (
          <div className="flex shrink-0 flex-col items-start gap-4 md:items-end">
            <p className={cn("text-sm font-medium", t.sub)}>Your code</p>
            <CopyCode code={banner.promo.code} theme={banner.theme} large />
            {banner.showRemaining && <Remaining promo={banner.promo} theme={banner.theme} />}
          </div>
        )}
      </div>
      {dismiss && <div className="absolute right-2 top-2">{dismiss}</div>}
    </div>
  );
}

const STORE = "paperly:dismissed-banners";
function useDismissed() {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(STORE) ?? "[]"); if (Array.isArray(v)) setKeys(v.filter((x): x is string => typeof x === "string")); } catch { /* storage unavailable */ } }, []);
  const dismiss = (b: { id: string; version: string }) => {
    setKeys((cur) => { const next = [...cur, dismissKey(b)].slice(-30); try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  };
  return { keys, dismiss };
}

/** The slim strip above the header, on every page. Shows one banner at a time. */
export function SiteBannerBar() {
  const { data } = useQuery(bannersQuery());
  const { keys, dismiss } = useDismissed();
  const banner = (data ?? []).find((b) => b.placement === "TOP_BAR" && !keys.includes(dismissKey(b)));
  if (!banner) return null;
  return <section aria-label="Announcement"><BannerView banner={banner} variant="bar" onDismiss={() => dismiss(banner)} /></section>;
}

/** Larger offer cards for the home and fees pages. */
export function HeroBanners({ className }: { className?: string }) {
  const { data } = useQuery(bannersQuery());
  const { keys, dismiss } = useDismissed();
  const list = (data ?? []).filter((b) => b.placement === "HERO" && !keys.includes(dismissKey(b))).slice(0, 2);
  if (!list.length) return null;
  return <div className={cn("space-y-4", className)}>{list.map((b) => <section key={b.id} aria-label="Offer"><BannerView banner={b} variant="hero" onDismiss={() => dismiss(b)} /></section>)}</div>;
}
