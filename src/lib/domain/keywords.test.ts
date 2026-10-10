import { describe, expect, it } from "vitest";
import { keywordProblem, parseKeywords } from "./keywords";

describe("parseKeywords", () => {
  it("splits, trims and drops empties", () => expect(parseKeywords(" soil , carbon,, climate ")).toEqual(["soil", "carbon", "climate"]));
  it("removes duplicates but keeps order", () => expect(parseKeywords("a, b, a")).toEqual(["a", "b"]));
  it("returns an empty list for blank input", () => expect(parseKeywords("  ,  ")).toEqual([]));
});

describe("keywordProblem", () => {
  it("accepts a normal list", () => expect(keywordProblem("soil, carbon; climate")).toBeNull());
  it("flags one long unseparated string", () => expect(keywordProblem("a".repeat(61))).toMatch(/Keyword 1 is 61 characters/));
  it("flags more than 12", () => expect(keywordProblem(Array.from({ length: 13 }, (_, i) => `k${i}`).join(","))).toMatch(/13 keywords/));
  it("flags empty", () => expect(keywordProblem(" , ")).toMatch(/at least one/));
});
