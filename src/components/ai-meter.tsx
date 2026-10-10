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

const BAND: Record<AiMeterData["band"], string> = { INSUFFICIENT_TEXT: "Not enough text to estimate", LOW: "Low", MODERATE: "Moderate", ELEVATED: "Elevated" };
const DECLARED = { NONE: "No AI assistance declared", DECLARED: "AI assistance declared", UNKNOWN: "No declaration on file" } as const;

/** Estimated share of the prose that reads as AI-assisted. A range for editors to weigh, never a verdict. */
export function AiMeter({ meter, className, audience = "editor" }: { meter: AiMeterData; className?: string; audience?: "editor" | "author" }) {
  const usable = meter.band !== "INSUFFICIENT_TEXT";
  const author = audience === "author";
  return (
    <section className={cn("border-t-2 border-foreground pt-3", className)} aria-labelledby="ai-meter-title">
      <h3 id="ai-meter-title" className="text-[1.25rem]">AI-assisted text estimate</h3>
      <p className="mt-1 max-w-[62ch] text-[15px] text-muted-foreground">An estimate of how much of the prose reads as machine-assisted. Detectors are unreliable on individual documents and misjudge formal and non-native English, {author ? "so it is never used to accept or reject a manuscript." : "so use this to start a conversation, not to decide."}</p>

      {usable ? (
        <div className="mt-5">
          <p className="text-[2rem] font-semibold leading-none tabular-nums">{meter.low} to {meter.high}%</p>
          <p className="mt-1 text-[15px]">{BAND[meter.band]}. Best single estimate {meter.score}%, from {meter.words.toLocaleString()} words of prose.</p>
          <div className="mt-4 max-w-xl" role="img" aria-label={`Estimated range ${meter.low} to ${meter.high} percent`}>
            <div className="relative h-3 bg-wash">
              <div className="absolute inset-y-0 bg-primary/35" style={{ left: `${meter.low}%`, width: `${Math.max(1.5, meter.high - meter.low)}%` }} />
              <div className="absolute -inset-y-1 w-[3px] bg-primary" style={{ left: `calc(${meter.score}% - 1.5px)` }} />
              {[40, 65].map((t) => <div key={t} className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${t}%` }} />)}
            </div>
            <div className="relative mt-1 h-5 text-xs text-muted-foreground">
              <span className="absolute left-0">0%</span>
              <span className="absolute -translate-x-1/2" style={{ left: "40%" }}>40</span>
              <span className="absolute -translate-x-1/2" style={{ left: "65%" }}>65</span>
              <span className="absolute right-0">100%</span>
            </div>
          </div>
        </div>
      ) : <p className="mt-4 font-semibold">{BAND.INSUFFICIENT_TEXT}.</p>}

      <dl className="mt-5 max-w-xl divide-y divide-border border-y border-border text-[15px]">
        <div className="grid grid-cols-[10rem_1fr] gap-3 py-2"><dt className="text-muted-foreground">{author ? "Your declaration" : "Author declaration"}</dt><dd>{meter.declared_use ? DECLARED[meter.declared_use] : "None"}</dd></div>
        <div className="grid grid-cols-[10rem_1fr] gap-3 py-2"><dt className="text-muted-foreground">Consistency</dt><dd className={cn(meter.discrepancy && "font-semibold text-destructive")}>{meter.discrepancy ? (author ? "The estimate is higher than expected for your declaration" : "Estimate and declaration differ. Ask the author.") : (author ? "Consistent with your declaration" : "No conflict found")}</dd></div>
      </dl>
      {author
        ? meter.discrepancy && <p className="mt-3 max-w-[62ch] text-[15px]">If AI tools helped you write or edit this work, update your declaration by contacting the editors. An editor may ask about how the text was prepared. Estimates like this are often wrong for carefully edited or non-native English writing, and nothing has been decided on this basis.</p>
        : meter.advisory && <p className="mt-3 max-w-[62ch] text-[15px]">{meter.advisory}</p>}

      {usable && meter.signals.length > 0 && (
        <details className="mt-4 max-w-xl text-[15px]">
          <summary className="link cursor-pointer font-medium">What the estimate is based on</summary>
          <table className="mt-3 w-full text-left"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-1.5 pr-3 font-medium">Signal</th><th className="py-1.5 pr-3 font-medium">Measured</th><th className="py-1.5 font-medium">Reads as</th></tr></thead>
            <tbody>{meter.signals.map((s) => <tr key={s.key} className="border-b border-border"><td className="py-1.5 pr-3">{s.label}</td><td className="py-1.5 pr-3 tabular-nums">{s.display}</td><td className="py-1.5">{s.lean > 0.66 ? "More machine-like" : s.lean > 0.33 ? "Mixed" : "More human-like"}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}
