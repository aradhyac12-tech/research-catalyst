// Checks an AI screening assessment against what is actually known, before an editor sees it. Pure and tested (ai-verification.test.ts).
// The model can be wrong or can invent a quotation, so: (1) every quoted passage is looked up in the manuscript text and marked verified or not,
// (2) a severe claim whose quotes cannot be found is treated as unconfirmed, (3) the model's verdicts are reconciled with deterministic facts
// (Crossref DOI lookups, similarity, declarations, text length) so a "PASS" never contradicts a hard fact, and (4) confidence is lowered when the
// model saw only part of the manuscript or its evidence did not check out. Nothing here accepts or rejects anything; it only makes the advice honest.
import type { NormalizedAssessment, NormalizedFinding } from "./ai-schema";
import type { DeterministicSignals } from "./decision-engine";
import { RESEARCH_ETHICS_ENABLED } from "./constants";

/** Lower-case, unify quotes and dashes, drop everything but letters and digits, so line breaks, hyphenation and smart quotes cannot hide a real quotation. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\u00ad\u200b]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface Coverage { totalChars: number; sentChars: number; partial: boolean }

export interface VerificationReport {
  quotesChecked: number; quotesVerified: number;
  downgraded: string[]; reconciled: string[];
  coverage: Coverage;
}

const SEVERE = (f: NormalizedFinding) => f.severity === "severe" || f.severity === "critical" || f.status === "FAIL";
const PASSISH = (f: NormalizedFinding) => f.status === "PASS" || f.status === "NOT_APPLICABLE";
/** Checks whose problems are contradictions or numbers: a severe claim with no quotation at all is unconfirmed. Missing-section findings legitimately have none. */
const NEEDS_QUOTE = new Set(["data_consistency", "statistics", "figures"]);

export function verifyAssessment(input: NormalizedAssessment, signals: DeterministicSignals, manuscriptText: string, coverage: Coverage): { assessment: NormalizedAssessment; report: VerificationReport } {
  const a: NormalizedAssessment = JSON.parse(JSON.stringify(input));
  const hay = normalizeForMatch(manuscriptText);
  const report: VerificationReport = { quotesChecked: 0, quotesVerified: 0, downgraded: [], reconciled: [], coverage };
  const canCheck = hay.length > 0;

  for (const f of a.findings) {
    // (1) Look every quotation up in the text.
    for (const e of f.evidence) {
      const q = e.quote ? normalizeForMatch(e.quote) : "";
      if (!q) { (e as { verified?: boolean }).verified = false; continue; }
      const ok = canCheck && q.length >= 8 && hay.includes(q);
      (e as { verified?: boolean }).verified = ok;
      report.quotesChecked++; if (ok) report.quotesVerified++;
    }
    // (2) Unconfirmed severe claims do not drive the recommendation.
    if (canCheck && SEVERE(f)) {
      const quoted = f.evidence.filter((e) => e.quote);
      const noneVerified = quoted.length > 0 && quoted.every((e) => (e as { verified?: boolean }).verified === false);
      const missingNeeded = quoted.length === 0 && NEEDS_QUOTE.has(f.key);
      if (noneVerified || missingNeeded) {
        f.status = "REVIEW_REQUIRED"; f.severity = "moderate";
        f.message = `${f.message} [Unconfirmed: ${noneVerified ? "the quoted passage was not found in the manuscript text" : "no supporting quotation was given"}; an editor should check.]`.slice(0, 1000);
        report.downgraded.push(f.key);
      }
    }
    // The AI-content check is a weak signal by policy: never more than minor.
    if (f.key === "ai_content") {
      if (f.severity === "moderate" || f.severity === "severe" || f.severity === "critical") { f.severity = "minor"; report.reconciled.push("ai_content capped at minor"); }
      if (f.status === "FAIL") f.status = "WARNING";
    }
  }

  // (3) The model must not contradict a hard fact.
  const set = (key: NormalizedFinding["key"], status: NormalizedFinding["status"], note: string, why: string) => {
    const f = a.findings.find((x) => x.key === key); if (!f || !PASSISH(f)) return;
    f.status = status; if (f.severity === "none" || f.severity === "minor") f.severity = "moderate";
    f.message = `${f.message ? f.message + " " : ""}[${note}]`.slice(0, 1000); report.reconciled.push(why);
  };
  if (signals.citations.invalid > 0) set("citations", "REVIEW_REQUIRED", `Crossref could not resolve ${signals.citations.invalid} of ${signals.citations.checked} checked DOIs.`, "citations");
  if (signals.similarity.risk === "HIGH" || signals.similarity.duplicate_file) set("similarity", "REVIEW_REQUIRED", signals.similarity.duplicate_file ? "An identical file already exists on the platform." : `Textual overlap with an existing record is ${signals.similarity.max_percentage}%.`, "similarity");
  const e = signals.ethics;
  if (RESEARCH_ETHICS_ENABLED && e.human_participants_declared && (!e.approval_provided || !e.consent_provided)) set("ethics", "REVIEW_REQUIRED", "Human participants were declared but approval or consent information is incomplete.", "ethics");
  if (signals.metadata.text_chars < 500) set("document", "REVIEW_REQUIRED", "Very little readable text could be extracted.", "document");
  if (signals.injection.detected && !a.signals.embedded_instructions_detected) { a.signals.embedded_instructions_detected = true; report.reconciled.push("embedded instructions flag"); }

  // (4) Confidence reflects how much the model saw and how well its evidence checked out.
  let conf = a.confidence;
  if (coverage.partial) conf = Math.min(conf, 0.85);
  if (report.quotesChecked >= 3 && report.quotesVerified / report.quotesChecked < 0.5) { conf *= 0.7; report.reconciled.push("confidence lowered: most quotations could not be verified"); }
  a.confidence = Math.round(conf * 100) / 100;
  return { assessment: a, report };
}

/** Short strings for the stored decision summary, shown to editors. */
export function summarizeVerification(r: VerificationReport): Record<string, string> {
  const out: Record<string, string> = {};
  out["manuscript_coverage"] = r.coverage.partial ? `PARTIAL (${r.coverage.sentChars.toLocaleString("en-US")} of ${r.coverage.totalChars.toLocaleString("en-US")} characters were screened: the start and the end)` : "FULL";
  if (r.quotesChecked > 0) out["evidence_verified"] = `${r.quotesVerified} of ${r.quotesChecked} quoted passages found in the manuscript`;
  if (r.downgraded.length) out["unconfirmed_findings"] = r.downgraded.join(", ");
  if (r.reconciled.length) out["adjusted_for_consistency"] = [...new Set(r.reconciled)].join("; ");
  return out;
}

/** Sends the start and the end of a long manuscript (methods, results and references are usually late) instead of silently cutting the end off. */
export function sampleManuscript(text: string, max: number): { text: string; coverage: Coverage } {
  const total = text.length;
  if (total <= max) return { text, coverage: { totalChars: total, sentChars: total, partial: false } };
  const marker = "\n\n[... middle of the manuscript omitted to fit the screening limit ...]\n\n";
  const room = max - marker.length;
  const head = Math.floor(room * 0.6), tail = room - head;
  return { text: text.slice(0, head) + marker + text.slice(total - tail), coverage: { totalChars: total, sentChars: head + tail, partial: true } };
}
