import { describe, expect, it } from "vitest";
import { combineMeter, measureAiAssistance } from "./ai-meter";

const human = Array.from({ length: 40 }, (_, i) =>
  [`We measured the thing on day ${i}, and it was odd.`,
   `Honestly the first batch failed because the furnace drifted by nearly twelve degrees overnight, which nobody had planned for and which cost us a week.`,
   `Samples were then re-run. Results differed.`,
   `Why? Possibly contamination, possibly the new supplier's powder, possibly just bad luck with the crucible we borrowed from the neighbouring lab in March.`].join(" ")).join("\n\n");

const formulaic = Array.from({ length: 40 }, () =>
  ["Moreover, it is important to note that this multifaceted approach plays a crucial role in the ever-evolving landscape of modern research.",
   "Furthermore, this comprehensive framework underscores the pivotal importance of leveraging robust methodologies to foster a nuanced understanding.",
   "In conclusion, these findings shed light on the intricate tapestry of factors that delve into the holistic paradigm shift in the field."].join(" ")).join("\n\n");

describe("measureAiAssistance", () => {
  it("refuses to estimate short text", () => {
    const r = measureAiAssistance("Too short to say anything about.");
    expect(r.band).toBe("INSUFFICIENT_TEXT");
    expect(r.low).toBe(0); expect(r.high).toBe(100);
  });
  it("scores stock-phrase prose higher than varied human prose", () => {
    expect(measureAiAssistance(formulaic).score).toBeGreaterThan(measureAiAssistance(human).score + 20);
  });
  it("always reports a range, never false precision", () => {
    const r = measureAiAssistance(human);
    expect(r.high - r.low).toBeGreaterThanOrEqual(36);
    expect(r.score).toBeGreaterThanOrEqual(8); expect(r.score).toBeLessThanOrEqual(92);
  });
  it("ignores the reference list", () => {
    const withRefs = human + "\n\nReferences\n" + Array.from({ length: 200 }, (_, i) => `[${i}] Author A. Title of a paper. Journal 12(3), 2020, 45-67. doi:10.1000/${i}`).join("\n");
    expect(Math.abs(measureAiAssistance(withRefs).score - measureAiAssistance(human).score)).toBeLessThan(6);
  });
});

describe("combineMeter", () => {
  const elevated = measureAiAssistance(formulaic);
  it("flags a discrepancy for the editor when AI use was declared absent", () => {
    const c = combineMeter(elevated, "high", undefined, true);
    expect(c.band).toBe("ELEVATED");
    expect(c.discrepancy).toBe(true);
    expect(c.advisory).toMatch(/not .*proof/i);
  });
  it("does not flag when AI use was disclosed", () => {
    expect(combineMeter(elevated, "high", "ChatGPT for language editing", false).discrepancy).toBe(false);
  });
  it("keeps the model's view from collapsing the range", () => {
    const c = combineMeter(measureAiAssistance(human), "low", undefined, true);
    expect(c.low).toBeLessThanOrEqual(c.score); expect(c.high).toBeGreaterThanOrEqual(c.score);
  });
});
