// AI-assistance indicator.
//
// This is a *triage estimate*, not a verdict. AI-text detection is unreliable on individual
// documents and is documented to over-flag non-native English and formulaic academic prose.
// The meter therefore (a) reports a range rather than a point, (b) widens the range for short
// text, (c) never feeds an automatic rejection, and (d) is compared with the author's own
// disclosure so editors can ask a question instead of making an accusation.

export type MeterBand = "INSUFFICIENT_TEXT" | "LOW" | "MODERATE" | "ELEVATED";

export interface MeterSignal {
  key: string;
  label: string;
  value: number;
  display: string;
  /** 0 = reads human-like on this signal, 1 = reads machine-like. */
  lean: number;
}

export interface MeterResult {
  score: number; // 0..100 point estimate
  low: number; // lower bound of range
  high: number; // upper bound of range
  band: MeterBand;
  words: number;
  signals: MeterSignal[];
  caveats: string[];
}

const FORMULAIC = [
  "delve", "tapestry", "multifaceted", "pivotal", "underscore", "underscores", "underscoring", "holistic",
  "ever-evolving", "in the realm of", "it is important to note", "it is worth noting", "plays a crucial role",
  "play a crucial role", "navigate the complexities", "a comprehensive", "paradigm shift", "in conclusion",
  "furthermore", "moreover", "shed light on", "intricate", "landscape of", "leverage", "seamless", "robust framework",
  "testament to", "fostering", "harness the power", "cutting-edge", "game-changer", "nuanced understanding",
];

const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));

/** Remove page markers, the reference list, and number-heavy lines (tables) before measuring prose. */
export function proseOnly(raw: string): string {
  let t = raw.replace(/\[page \d+\]/gi, " ");
  const refIdx = t.search(/\n\s*(references|bibliography|works cited)\s*\n/i);
  if (refIdx > t.length * 0.4) t = t.slice(0, refIdx);
  return t
    .split(/\n/)
    .filter((l) => {
      const s = l.trim();
      if (!s) return true;
      const digits = (s.match(/[\d.,%±()-]/g) ?? []).length;
      return digits / s.length < 0.35 && s.length > 20;
    })
    .join("\n");
}

function sentencesOf(t: string): string[] {
  return t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"(])/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 4);
}
const wordsOf = (t: string) => (t.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []);

function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function std(a: number[]) { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); }

/** Moving-average type/token ratio: robust to length, unlike plain TTR. */
function mattr(words: string[], window = 100): number {
  if (words.length < window) return new Set(words).size / Math.max(words.length, 1);
  let sum = 0, n = 0;
  for (let i = 0; i + window <= words.length; i += 25) { sum += new Set(words.slice(i, i + window)).size / window; n++; }
  return sum / n;
}

function repeatedTrigramRate(words: string[]): number {
  const seen = new Map<string, number>();
  for (let i = 0; i + 3 <= words.length; i++) { const k = words.slice(i, i + 3).join(" "); seen.set(k, (seen.get(k) ?? 0) + 1); }
  let rep = 0, total = 0;
  for (const c of seen.values()) { total += c; if (c > 1) rep += c - 1; }
  return total ? rep / total : 0;
}

export function measureAiAssistance(raw: string): MeterResult {
  const text = proseOnly(raw);
  const words = wordsOf(text);
  const caveats = [
    "Estimate only. Statistical detectors misjudge formal, edited and non-native English writing and cannot prove authorship.",
    "Never used on its own to accept or reject a manuscript.",
  ];
  if (words.length < 400) {
    return { score: 0, low: 0, high: 100, band: "INSUFFICIENT_TEXT", words: words.length, signals: [], caveats: [...caveats, "Too little prose to estimate reliably (need roughly 400+ words)."] };
  }

  const sents = sentencesOf(text);
  const lens = sents.map((s) => s.split(" ").length);
  const burst = mean(lens) ? std(lens) / mean(lens) : 0; // coefficient of variation
  const div = mattr(words);
  const lower = text.toLowerCase();
  const hits = FORMULAIC.reduce((n, p) => n + (lower.split(p).length - 1), 0);
  const formulaicPer1k = (hits / words.length) * 1000;
  const rep = repeatedTrigramRate(words);
  const paras = text.split(/\n{2,}/).map((p) => p.split(/\s+/).filter(Boolean).length).filter((n) => n > 20);
  const paraCv = paras.length > 3 ? std(paras) / mean(paras) : 0.5;

  const signals: MeterSignal[] = [
    { key: "burstiness", label: "Sentence-length variation", value: burst, display: burst.toFixed(2), lean: clamp((0.62 - burst) / 0.3) },
    { key: "diversity", label: "Vocabulary diversity", value: div, display: div.toFixed(2), lean: clamp((0.74 - div) / 0.16) },
    { key: "formulaic", label: "Stock-phrase density", value: formulaicPer1k, display: `${formulaicPer1k.toFixed(1)} / 1k words`, lean: clamp(formulaicPer1k / 8) },
    { key: "repetition", label: "Repeated phrasing", value: rep, display: `${(rep * 100).toFixed(1)}%`, lean: clamp((rep - 0.02) / 0.1) },
    { key: "paragraphs", label: "Paragraph-length uniformity", value: paraCv, display: paraCv.toFixed(2), lean: clamp((0.5 - paraCv) / 0.3) },
  ];
  const weights = { burstiness: 0.3, diversity: 0.15, formulaic: 0.3, repetition: 0.1, paragraphs: 0.15 } as const;
  const raw01 = signals.reduce((s, x) => s + x.lean * weights[x.key as keyof typeof weights], 0);
  // Compress toward the middle: a heuristic should not claim near-certainty at either end.
  const score = Math.round(clamp(0.08 + raw01 * 0.84) * 100);
  const halfWidth = Math.round(clamp(18 + (3000 - Math.min(words.length, 3000)) / 3000 * 17, 18, 35));
  const low = Math.max(0, score - halfWidth), high = Math.min(100, score + halfWidth);
  const band: MeterBand = score >= 65 ? "ELEVATED" : score >= 40 ? "MODERATE" : "LOW";
  return { score, low, high, band, words: words.length, signals, caveats };
}

const LLM_LIKELIHOOD: Record<string, number> = { low: 15, unlikely: 15, medium: 50, moderate: 50, possible: 50, high: 80, likely: 80 };

export interface CombinedMeter extends MeterResult {
  llm_score: number | null;
  declared_use: "NONE" | "DECLARED" | "UNKNOWN";
  discrepancy: boolean;
  advisory: string;
}

/** Blend the stylometric estimate with the model's coarse view and the author's own disclosure. */
export function combineMeter(m: MeterResult, llmLikelihood: string | null | undefined, declaredTools: string | null | undefined, declaredNone: boolean | undefined): CombinedMeter {
  const llm = llmLikelihood ? LLM_LIKELIHOOD[llmLikelihood.trim().toLowerCase()] ?? null : null;
  let { score, low, high } = m;
  if (m.band !== "INSUFFICIENT_TEXT" && llm !== null) {
    score = Math.round(m.score * 0.65 + llm * 0.35);
    low = Math.min(low, score); high = Math.max(high, score);
  }
  const band: MeterBand = m.band === "INSUFFICIENT_TEXT" ? m.band : score >= 65 ? "ELEVATED" : score >= 40 ? "MODERATE" : "LOW";
  const declared_use = declaredTools && declaredTools.trim().length > 2 ? "DECLARED" : declaredNone ? "NONE" : "UNKNOWN";
  const discrepancy = band === "ELEVATED" && declared_use === "NONE";
  const advisory = discrepancy
    ? "The estimate is elevated while the author declared no AI assistance. Ask the author about their writing process; do not treat this as proof."
    : band === "ELEVATED"
      ? "Elevated estimate. Check that the author's disclosure matches how the text was prepared."
      : band === "INSUFFICIENT_TEXT"
        ? "Not enough prose to estimate."
        : "No action needed on this signal.";
  return { ...m, score, low, high, band, llm_score: llm, declared_use, discrepancy, advisory };
}
