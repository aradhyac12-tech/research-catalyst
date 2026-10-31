import { describe, expect, it } from "vitest";
import { normalizeAssessment, CHECK_KEYS, type AiWire } from "./ai-schema";
import type { DeterministicSignals } from "./decision-engine";
import { sampleManuscript, summarizeVerification, verifyAssessment } from "./ai-verification";

const signals = (o: Partial<DeterministicSignals> = {}): DeterministicSignals => ({
  security: { passed: true, reasons: [] },
  rights: { present: true, is_author_or_authorised: true, has_upload_rights: true, third_party_unresolved: false, ai_consent: true, previously_published_publisher_version: false },
  ethics: { human_participants_declared: false, animal_subjects_declared: false, clinical_trial_declared: false, approval_provided: false, consent_provided: false, trial_registration_provided: false, animal_approval_provided: false },
  injection: { detected: false, matches: [] }, similarity: { max_percentage: 3, risk: "LOW", duplicate_file: false }, citations: { checked: 10, invalid: 0, details: [] },
  metadata: { has_title: true, has_abstract: true, has_authors: true, has_corresponding: true, has_keywords: true, text_chars: 20000 }, ...o,
});
const wire = (checks: Array<Partial<AiWire["checks"][number]> & { key: string }>, confidence = 0.9): AiWire => ({
  study_type: "Cohort", is_medical_or_human_subjects: false, confidence, summary: "s",
  signals: { human_subjects: false, animal_subjects: false, clinical_trial: false, patient_identifiable_info: false, ethics_approval_claimed_in_text: false, consent_claimed_in_text: false, trial_registration_in_text: false, embedded_instructions_detected: false, ai_generated_text_likelihood: "low" },
  checks: checks.map((c) => ({ status: "PASS", severity: "none", message: "", evidence: [], ...c })),
});
const full = { totalChars: 100, sentChars: 100, partial: false };
const TEXT = "We enrolled 120 participants. The mean age was 54 years.\nResults: n = 118 completed follow-up.";
const get = (a: ReturnType<typeof normalizeAssessment>, k: string) => a.findings.find((f) => f.key === k)!;

describe("verifyAssessment: quotations", () => {
  it("marks a real quotation (even across a line break and smart quotes) as verified", () => {
    const a = normalizeAssessment(wire([{ key: "data_consistency", status: "FAIL", severity: "severe", message: "n differs", evidence: [{ section: "Results", page: null, quote: "We enrolled 120 participants" }, { section: "Results", page: null, quote: "n = 118 completed follow-up" }] }]));
    const { assessment, report } = verifyAssessment(a, signals(), TEXT, full);
    expect(report.quotesVerified).toBe(2);
    expect(get(assessment, "data_consistency").status).toBe("FAIL"); // confirmed, so it stands
  });
  it("downgrades a severe finding whose quotation does not exist", () => {
    const a = normalizeAssessment(wire([{ key: "data_consistency", status: "FAIL", severity: "critical", message: "fabricated data", evidence: [{ section: "Results", page: null, quote: "all values were copied from another study" }] }]));
    const { assessment, report } = verifyAssessment(a, signals(), TEXT, full);
    const f = get(assessment, "data_consistency");
    expect(f.status).toBe("REVIEW_REQUIRED"); expect(f.severity).toBe("moderate"); expect(f.message).toContain("Unconfirmed");
    expect(report.downgraded).toContain("data_consistency");
  });
  it("does not trust a severe statistics claim with no quotation, but allows a missing-section methodology claim", () => {
    const a = normalizeAssessment(wire([{ key: "statistics", status: "FAIL", severity: "severe", message: "wrong p-values" }, { key: "methodology", status: "FAIL", severity: "severe", message: "no methods section" }]));
    const { assessment } = verifyAssessment(a, signals(), TEXT, full);
    expect(get(assessment, "statistics").status).toBe("REVIEW_REQUIRED");
    expect(get(assessment, "methodology").status).toBe("FAIL");
  });
  it("does not downgrade anything when no text was available to check against", () => {
    const a = normalizeAssessment(wire([{ key: "data_consistency", status: "FAIL", severity: "severe", message: "x", evidence: [{ section: null, page: null, quote: "anything at all here" }] }]));
    expect(get(verifyAssessment(a, signals(), "", full).assessment, "data_consistency").status).toBe("FAIL");
  });
});

describe("verifyAssessment: consistency with hard facts", () => {
  const passAll = () => normalizeAssessment(wire(CHECK_KEYS.map((key) => ({ key }))));
  it("a PASS cannot stand against unresolved DOIs, a duplicate file or no text (research ethics is switched off, so incomplete ethics no longer overrides it)", () => {
    const s = signals({ citations: { checked: 10, invalid: 3, details: [] }, similarity: { max_percentage: 70, risk: "HIGH", duplicate_file: false }, ethics: { ...signals().ethics, human_participants_declared: true }, metadata: { ...signals().metadata, text_chars: 100 } });
    const { assessment, report } = verifyAssessment(passAll(), s, TEXT, full);
    for (const k of ["citations", "similarity", "document"]) expect(get(assessment, k).status).toBe("REVIEW_REQUIRED");
    expect(get(assessment, "ethics").status).not.toBe("REVIEW_REQUIRED");
    expect(report.reconciled).toEqual(expect.arrayContaining(["citations", "similarity", "document"]));
  });
  it("leaves clean results alone", () => {
    const { assessment, report } = verifyAssessment(passAll(), signals(), TEXT, full);
    expect(assessment.findings.every((f) => f.status === "PASS")).toBe(true); expect(report.reconciled).toEqual([]);
  });
  it("caps the AI-content check and sets the injection flag from the deterministic scan", () => {
    const a = normalizeAssessment(wire([{ key: "ai_content", status: "FAIL", severity: "severe", message: "looks generated" }]));
    const { assessment } = verifyAssessment(a, signals({ injection: { detected: true, matches: ["x"] } }), TEXT, full);
    expect(get(assessment, "ai_content").severity).toBe("minor"); expect(get(assessment, "ai_content").status).toBe("WARNING");
    expect(assessment.signals.embedded_instructions_detected).toBe(true);
  });
});

describe("confidence and coverage", () => {
  it("caps confidence for a partly-read manuscript and lowers it when quotations do not check out", () => {
    const bad = (n: number) => ({ section: null, page: null, quote: `invented sentence number ${n} here` });
    const a = normalizeAssessment(wire([{ key: "methodology", status: "WARNING", severity: "minor", message: "m", evidence: [bad(1), bad(2), bad(3)] }], 0.95));
    const { assessment } = verifyAssessment(a, signals(), TEXT, { totalChars: 90000, sentChars: 40000, partial: true });
    expect(assessment.confidence).toBeLessThanOrEqual(0.6);
  });
  it("samples the start and the end of a long manuscript and reports it", () => {
    const text = "A".repeat(30000) + "MIDDLE" + "B".repeat(30000) + "REFERENCES_END";
    const r = sampleManuscript(text, 40000);
    expect(r.coverage.partial).toBe(true); expect(r.text.length).toBeLessThanOrEqual(40000); expect(r.text.endsWith("REFERENCES_END")).toBe(true); expect(r.text).toContain("omitted");
    expect(sampleManuscript("short", 40000).coverage.partial).toBe(false);
    expect(summarizeVerification({ quotesChecked: 4, quotesVerified: 3, downgraded: [], reconciled: [], coverage: r.coverage })["manuscript_coverage"]).toContain("PARTIAL");
  });
});
