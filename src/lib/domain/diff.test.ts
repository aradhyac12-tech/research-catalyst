import { describe, expect, it } from "vitest";
import { afterText, beforeText, diffWords } from "./diff";

describe("diffWords", () => {
  it("marks a replaced word as one deletion and one insertion", () => {
    const ops = diffWords("The sample was small", "The sample was large");
    expect(ops.filter((o) => o.type === "del").map((o) => o.text)).toEqual(["small"]);
    expect(ops.filter((o) => o.type === "ins").map((o) => o.text)).toEqual(["large"]);
  });
  it("reconstructs both sides exactly", () => {
    const before = "We measured the effect of dose on growth.\nResults were mixed.";
    const after = "We measured the effect of dosage on plant growth.\nResults were clear.";
    const ops = diffWords(before, after);
    expect(beforeText(ops)).toBe(before);
    expect(afterText(ops)).toBe(after);
  });
  it("reports no changes for identical text", () => {
    expect(diffWords("same text", "same text").every((o) => o.type === "same")).toBe(true);
  });
});
