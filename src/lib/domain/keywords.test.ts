import { describe, expect, it } from "vitest";
import { KEYWORDS_MAX_COUNT, keywordProblem, parseKeywords } from "./keywords";

describe("parseKeywords", () => {
  it("splits, trims and drops empties", () => expect(parseKeywords(" soil , carbon,, climate ")).toEqual(["soil", "carbon", "climate"]));
  it("removes duplicates but keeps order", () => expect(parseKeywords("a, b, a")).toEqual(["a", "b"]));
  it("returns an empty list for blank input", () => expect(parseKeywords("  ,  ")).toEqual([]));
});

describe("keywordProblem", () => {
  it("accepts a normal list", () => expect(keywordProblem("soil, carbon; climate")).toBeNull());
  it("flags one long unseparated string", () => expect(keywordProblem("a".repeat(61))).toMatch(/Keyword 1 is 61 characters/));
  const many = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`).join(",");
  it("accepts exactly the limit", () => expect(keywordProblem(many(KEYWORDS_MAX_COUNT))).toBeNull());
  it("flags more than the limit", () => expect(keywordProblem(many(KEYWORDS_MAX_COUNT + 1))).toMatch(new RegExp(`${KEYWORDS_MAX_COUNT + 1} keywords`)));
  it("flags empty", () => expect(keywordProblem(" , ")).toMatch(/at least one/));
});
