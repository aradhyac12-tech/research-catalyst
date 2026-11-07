import { describe, expect, it } from "vitest";
import { displayTitle, formatTitle } from "./title-case";

describe("formatTitle", () => {
  it("capitalises a lowercase title", () => expect(formatTitle("effects of exercise on blood pressure in older adults")).toBe("Effects of Exercise on Blood Pressure in Older Adults"));
  it("softens an all-capitals title", () => expect(formatTitle("DIABETES MELLITUS")).toBe("Diabetes Mellitus"));
  it("keeps small words low and acronyms high", () => expect(formatTitle("THE ROLE OF MRI IN COVID-19 CARE")).toBe("The Role of MRI in COVID-19 Care"));
  it("capitalises sentence case", () => expect(formatTitle("A study of DNA repair")).toBe("A Study of DNA Repair"));
  it("keeps deliberate mixed case", () => expect(formatTitle("mRNA vaccines and pH control in iPSC culture")).toBe("mRNA Vaccines and pH Control in iPSC Culture"));
  it("capitalises after a colon", () => expect(formatTitle("cancer screening: a systematic review")).toBe("Cancer Screening: A Systematic Review"));
  it("handles hyphens", () => expect(formatTitle("long-term follow-up of type-2 diabetes")).toBe("Long-Term Follow-Up of Type-2 Diabetes"));
  it("always capitalises the last word", () => expect(formatTitle("what patients are waiting for")).toBe("What Patients Are Waiting For"));
  it("collapses extra spaces", () => expect(formatTitle("  heart   failure ")).toBe("Heart Failure"));
  it("leaves very short titles alone", () => expect(formatTitle("HIV")).toBe("HIV"));
  it("keeps quotes and brackets", () => expect(formatTitle("(pilot) trial of \"smart\" inhalers")).toBe("(Pilot) Trial of \"Smart\" Inhalers"));
});

describe("displayTitle", () => {
  it("matches formatTitle", () => expect(displayTitle("heart failure in the elderly")).toBe("Heart Failure in the Elderly"));
});
