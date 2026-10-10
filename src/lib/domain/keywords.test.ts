import { describe, expect, it } from "vitest";
import { parseKeywords } from "./keywords";

describe("parseKeywords", () => {
  it("splits, trims and drops empties", () => expect(parseKeywords(" soil , carbon,, climate ")).toEqual(["soil", "carbon", "climate"]));
  it("removes duplicates but keeps order", () => expect(parseKeywords("a, b, a")).toEqual(["a", "b"]));
  it("returns an empty list for blank input", () => expect(parseKeywords("  ,  ")).toEqual([]));
});
