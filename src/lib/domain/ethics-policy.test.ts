import { describe, expect, it } from "vitest";
import { evaluateEthics, deriveCategory, canActorTake, isEthicsTransitionAllowed, ethicsPolicyHash, type EthicsInput, type SubjectDeclaration, ETHICS_POLICIES, ETHICS_POLICY_VERSION, RESEARCH_CATEGORIES, ETHICS_POLICY_1_0, type EthicsStatus } from "./ethics-policy";

const subject: SubjectDeclaration = { human_participants: false, identifiable_info_present: false, deidentification_status: "NOT_APPLICABLE", informed_consent_status: "NOT_APPLICABLE", publication_consent_status: "NOT_APPLICABLE", waiver_status: "NOT_APPLICABLE", committee_approval_status: "NOT_APPLICABLE", privacy_sensitive_media: false };
const base = (o: Partial<EthicsInput> = {}, s: Partial<SubjectDeclaration> = {}): EthicsInput => ({ articleType: "Original Research", animal_subjects: false, clinical_trial: false, secondary_data_only: false, subject: { ...subject, ...s }, trial: { registration_status: "NOT_APPLICABLE" }, ...o });

describe("ethics policy applicability (J, Q, R)", () => {
  it("every category has a rule and the policy is registered by version", () => {
    for (const c of RESEARCH_CATEGORIES) expect(ETHICS_POLICY_1_0.rules[c]).toBeDefined();
    expect(ETHICS_POLICIES[ETHICS_POLICY_VERSION]).toBe(ETHICS_POLICY_1_0);
  });
  it("a systematic review is not forced through human-subject questions", () => {
    const e = evaluateEthics(base({ articleType: "Systematic Review" }));
    expect(e.violations).toEqual([]); expect(e.initialStatus).toBe("ETHICS_NOT_REQUIRED");
  });
  it("an RCT needs committee status, consent status and trial registration", () => {
    const e = evaluateEthics(base({ articleType: "Randomized Controlled Trial" }, { human_participants: true }));
    expect(e.requiresTrialRegistration).toBe(true); expect(e.violations.length).toBeGreaterThanOrEqual(3);
  });
  it("trial registration is recorded as pending MANUAL verification, never as verified", () => {
    const e = evaluateEthics(base({ articleType: "Randomized Controlled Trial", trial: { registration_status: "REGISTERED_PROSPECTIVELY", registry_name: "ClinicalTrials.gov", registration_number: "NCT00000000" } },
      { human_participants: true, committee_approval_status: "APPROVED", approval_reference: "IRB-1", informed_consent_status: "OBTAINED" }));
    expect(e.violations).toEqual([]); expect(e.trialVerificationStatus).toBe("PENDING_MANUAL_VERIFICATION"); expect(e.initialStatus).toBe("ETHICS_REVIEW_REQUIRED");
  });
  it("registered trial without registry name/number is refused; unregistered trial goes to a human", () => {
    const m = { articleType: "Clinical Study" };
    const s = { human_participants: true, committee_approval_status: "APPROVED" as const, approval_reference: "r", informed_consent_status: "OBTAINED" as const };
    expect(evaluateEthics(base({ ...m, trial: { registration_status: "REGISTERED_RETROSPECTIVELY" } }, s)).violations.length).toBe(2);
    expect(evaluateEthics(base({ ...m, trial: { registration_status: "NOT_REGISTERED" } }, s)).initialStatus).toBe("ETHICS_HUMAN_REVIEW_REQUIRED");
  });
  it("a case report must declare publication consent separately from approval", () => {
    expect(evaluateEthics(base({ articleType: "Case Report" }, { human_participants: true, committee_approval_status: "APPROVED" })).violations.join(" ")).toMatch(/PUBLISH/);
    const ok = evaluateEthics(base({ articleType: "Case Report" }, { human_participants: true, identifiable_info_present: true, deidentification_status: "PARTIALLY_DEIDENTIFIED", publication_consent_status: "OBTAINED" }));
    expect(ok.violations).toEqual([]); expect(ok.requiresPublicationConsent).toBe(true);
  });
  it("ethics approval does not stand in for publication consent", () => {
    const e = evaluateEthics(base({ articleType: "Case Report" }, { human_participants: true, committee_approval_status: "APPROVED", approval_reference: "IRB", publication_consent_status: "NOT_OBTAINED" }));
    expect(e.initialStatus).toBe("ETHICS_HUMAN_REVIEW_REQUIRED"); expect(e.reasons.some((r) => /publish/.test(r.detail))).toBe(true);
  });
  it("approval claimed without a reference number is refused", () => {
    expect(evaluateEthics(base({ articleType: "Observational Study" }, { human_participants: true, committee_approval_status: "APPROVED", informed_consent_status: "OBTAINED" })).violations.join(" ")).toMatch(/reference/);
  });
  it("animal research needs an approval/protocol reference", () => {
    expect(evaluateEthics(base({ articleType: "Animal Study" })).violations.length).toBe(1);
    expect(evaluateEthics(base({ articleType: "Animal Study", animal_protocol: "IACUC-9" })).violations).toEqual([]);
  });
  it("declarations can make the category stricter, never laxer", () => {
    expect(deriveCategory({ articleType: "Original Research", animal_subjects: false, clinical_trial: false, secondary_data_only: false, human_participants: true })).toBe("HUMAN_SUBJECT_RESEARCH");
    expect(deriveCategory({ articleType: "Experimental/Laboratory Study", animal_subjects: false, clinical_trial: false, secondary_data_only: false, human_participants: true })).toBe("HUMAN_SUBJECT_RESEARCH");
    expect(deriveCategory({ articleType: "Original Research", animal_subjects: false, clinical_trial: false, secondary_data_only: true, human_participants: false })).toBe("SECONDARY_PUBLIC_DATA");
  });
  it("the policy hash is stable", async () => expect(await ethicsPolicyHash()).toBe(await ethicsPolicyHash()));
});

describe("ethics state machine (L, M, N, S)", () => {
  const all: EthicsStatus[] = ["ETHICS_DECLARED", "ETHICS_REVIEW_REQUIRED", "ETHICS_UNDER_REVIEW", "ETHICS_REVISION_REQUIRED", "ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_HUMAN_REVIEW_REQUIRED", "ETHICS_NOT_REQUIRED"];
  it("clearing is reachable only from UNDER_REVIEW", () => { for (const f of all) expect(isEthicsTransitionAllowed(f, "ETHICS_CLEARED")).toBe(f === "ETHICS_UNDER_REVIEW"); });
  it("S: AI can never clear, reject, request revision or start review", () => {
    for (const f of all) for (const t of all) if (t !== "ETHICS_HUMAN_REVIEW_REQUIRED") expect(canActorTake("AI", f, t)).toBe(false);
    expect(canActorTake("AI", "ETHICS_REVIEW_REQUIRED", "ETHICS_HUMAN_REVIEW_REQUIRED")).toBe(true);
  });
  it("M: the system can never clear or reject either", () => { for (const f of all) for (const t of ["ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_REVISION_REQUIRED", "ETHICS_UNDER_REVIEW"] as const) expect(canActorTake("SYSTEM", f, t)).toBe(false); });
  it("N: a reviewer decides from UNDER_REVIEW and cannot reopen a decided case", () => {
    for (const t of ["ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_REVISION_REQUIRED"] as const) expect(canActorTake("USER", "ETHICS_UNDER_REVIEW", t)).toBe(true);
    for (const f of ["ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_REVISION_REQUIRED"] as const) expect(canActorTake("USER", f, "ETHICS_REVIEW_REQUIRED")).toBe(false);
  });
  it("an amendment re-opens a decided case through the system, so a stale clearance cannot survive", () => {
    for (const f of ["ETHICS_CLEARED", "ETHICS_NOT_CLEARED", "ETHICS_REVISION_REQUIRED"] as const) expect(canActorTake("SYSTEM", f, "ETHICS_REVIEW_REQUIRED")).toBe(true);
  });
});
