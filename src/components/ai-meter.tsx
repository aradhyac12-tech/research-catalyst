import { cn } from "@/lib/utils";

export interface AiMeterData {
  score: number; low: number; high: number;
  band: "INSUFFICIENT_TEXT" | "LOW" | "MODERATE" | "ELEVATED";
  words: number;
  signals: Array<{ key: string; label: string; display: string; lean: number }>;
  caveats: string[];
  llm_score?: number | null;
  declared_use?: "NONE" | "DECLARED" | "UNKNOWN";
  discrepancy?: boolean;
  advisory?: string;
}

const BAND_LABEL: Record<AiMeterData["band"], string> = {
  INSUFFICIENT_TEXT: "Not enough text", LOW: "Low", MODERATE: "Moderate", ELEVATED: "Elevated",
};
const DECLARED: Record<NonNullable<AiMeterData["declared_use"]>, string> = {
  NONE: "No AI assistance declared", DECLARED: "AI assistance declared", UNKNOWN: "No declaration on file",
};

/** Estimated share of the manuscript prose that reads as AI-assisted. Shown as a range, never a verdict. */
export function AiMeter({ meter, className }: { meter: AiMeterData; className?: string }) {
  const usable = meter.band !== "INSUFFICIENT_TEXT";
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)} aria-labelledby="ai-meter-title">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h3 id="ai-meter-title" className="font-serif text-lg font-semibold">AI-assistance estimate</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">How much of the prose reads as machine-assisted. A guide for editors, not evidence.</p>
        </div>
        <div className="text-right">
          <div className="font-serif text-3xl font-semibold tabular-nums leading-none">{usable ? `${meter.low}–${meter.high}%` : "—"}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">{BAND_LABEL[meter.band]}</div>
        </div>
      </header>

      {usable && (
        <div className="px-5 pt-5">
          <div className="relative h-2 rounded-full bg-muted" role="img" aria-label={`Estimated range ${meter.low} to ${meter.high} percent, point estimate ${meter.score} percent`}>
            <div className="absolute inset-y-0 rounded-full bg-primary/25" style={{ left: `${meter.low}%`, width: `${Math.max(2, meter.high - meter.low)}%` }} />
            <div className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-primary" style={{ left: `${meter.score}%` }} />
          </div>
          <div className="relative mt-1.5 h-4 text-[11px] text-muted-foreground">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: "40%" }}>40</span>
            <span className="absolute -translate-x-1/2" style={{ left: "65%" }}>65</span>
            <span className="absolute right-0">100%</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Point estimate {meter.score}%. The range is wider for shorter manuscripts ({meter.words.toLocaleString()} words analysed).</p>
        </div>
      )}

      <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-muted-foreground">Author declaration</dt>
          <dd className="mt-1 text-sm font-medium">{meter.declared_use ? DECLARED[meter.declared_use] : "—"}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Consistency</dt>
          <dd className={cn("mt-1 text-sm font-medium", meter.discrepancy && "text-destructive")}>{meter.discrepancy ? "Needs a conversation" : "No conflict found"}</dd>
        </div>
      </dl>
      {meter.advisory && <p className="border-t border-border px-5 py-3 text-sm">{meter.advisory}</p>}

      {usable && meter.signals.length > 0 && (
        <details className="border-t border-border px-5 py-3 text-sm">
          <summary className="cursor-pointer select-none font-medium">What this is based on</summary>
          <ul className="mt-3 space-y-2.5">
            {meter.signals.map((s) => (
              <li key={s.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4">
                <span>{s.label}</span>
                <span className="tabular-nums text-muted-foreground">{s.display}</span>
                <div className="col-span-2 mt-1 h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-primary/60" style={{ width: `${Math.round(s.lean * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <footer className="border-t border-border bg-muted/40 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
        {meter.caveats.join(" ")}
      </footer>
    </section>
  );
}
