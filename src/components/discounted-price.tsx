import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/ui";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts from `from` to `to` minor units over `ms`, after `delay`. Starts at `to` straight away when motion is reduced. */
function useCountDown(from: number, to: number, delay: number, ms: number, enabled: boolean): number {
  const [v, setV] = useState(enabled ? from : to);
  const raf = useRef(0);
  useEffect(() => {
    if (!enabled) { setV(to); return; }
    setV(from);
    let start = 0;
    const timer = window.setTimeout(() => {
      const tick = (now: number) => {
        if (!start) start = now;
        const t = Math.min(1, (now - start) / ms);
        setV(Math.round(from + (to - from) * easeOutCubic(t)));
        if (t < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }, delay);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(raf.current); };
  }, [from, to, delay, ms, enabled]);
  return v;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The fee with a discount taken off: the full amount is struck through by a line that draws across it, a "−amount" chip pops in,
 * and the new amount counts down to its final value. Plays once when it appears. With reduced motion, only the final state shows.
 * Screen readers get one plain sentence; the animated numbers are hidden from them.
 */
export function DiscountedPrice({ fullMinor, finalMinor, currency, className = "" }: { fullMinor: number; finalMinor: number; currency: string; className?: string }) {
  const off = fullMinor - finalMinor;
  const [still] = useState(reducedMotion);
  const animate = off > 0 && !still;
  const shown = useCountDown(fullMinor, finalMinor, 700, 900, animate);
  if (off <= 0) return <span className={className}>{money(finalMinor, currency)}</span>;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 ${className}`}>
      <span className="sr-only">{`${money(finalMinor, currency)}, reduced from ${money(fullMinor, currency)}`}</span>
      <span aria-hidden="true" className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`dp-old relative inline-block text-muted-foreground tabular-nums ${animate ? "dp-old-anim" : "dp-old-still"}`}>
          {money(fullMinor, currency)}
          <span className={`dp-strike ${animate ? "dp-strike-anim" : "dp-strike-still"}`} />
        </span>
        <span className={`dp-chip tabular-nums ${animate ? "dp-chip-anim" : ""}`}>−{money(off, currency)}</span>
        <span className={`dp-new font-semibold tabular-nums text-foreground ${animate ? "dp-new-anim" : ""}`} style={{ minWidth: `${money(finalMinor, currency).length}ch` }}>{money(shown, currency)}</span>
      </span>
    </span>
  );
}
