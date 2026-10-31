import { describe, expect, it } from "vitest";
import { KEYWORDS_MAX_COUNT } from "./keywords";
import { canSuggestMetadata } from "./permissions";
import { buildSuggestPrompt, chunkLines, cleanAbstract, cleanKeywords, formatReferences, numberedReferences, parseSuggestWire, splitReferenceSection, verifyReferences } from "./metadata-suggest";

const refs = ["Smith J, Rao P. Soil carbon dynamics under warming. Nature Climate Change. 2021;11:100-105. doi:10.1038/s41558-021-00001-1", "Chen L. Microbial respiration and drought stress. Global Change Biology. 2019;25:2000-2012."];
const paper = `Soil carbon under warming\n${"Body sentence about carbon and soil. ".repeat(60)}\n[page 4]\nReferences\n1. ${refs[0]}\n2. ${refs[1]}\nAppendix A\nExtra table`;

describe("splitReferenceSection", () => {
  it("finds the reference list and stops at an appendix", () => {
    const s = splitReferenceSection(paper);
    expect(s.references).toContain("Soil carbon dynamics");
    expect(s.references).toContain("Microbial respiration");
    expect(s.references).not.toContain("Extra table");
    expect(s.body).toContain("Body sentence");
  });
  it("returns null when there is no reference heading, and ignores an early contents entry", () => {
    expect(splitReferenceSection("Intro text.\n".repeat(40)).references).toBeNull();
    expect(splitReferenceSection(`References\n${"x. ".repeat(10)}\n${"Long body text here. ".repeat(100)}`).references).toBeNull();
  });
});

describe("verifyReferences", () => {
  const section = `1. ${refs[0]!}\n[page 5]\n2. ${refs[1]!}`;
  it("keeps entries that are in the list, even re-spaced, renumbered or split by a page marker", () => {
    const v = verifyReferences([`[1] ${refs[0]!.replace(/ /g, "  ")}`, refs[1]!], section);
    expect(v.kept).toHaveLength(2);
    expect(v.dropped).toBe(0);
  });
  it("drops an invented or altered reference and counts it", () => {
    const v = verifyReferences([refs[0]!, "Invented A, Made B. A study that does not exist. Journal of Nothing. 2020;1:1-9.", refs[1]!.replace("2012", "2099")], section);
    expect(v.kept).toEqual([refs[0]!]);
    expect(v.dropped).toBe(2);
  });
  it("removes duplicates", () => expect(verifyReferences([refs[0]!, refs[0]!], section).kept).toHaveLength(1));
});

describe("numberedReferences", () => {
  it("reads a numbered list without any AI", () => expect(numberedReferences(`1. ${refs[0]!}\n2. ${refs[1]!}\n3. Third reference entry long enough.`)).toHaveLength(3));
  it("does not guess at an unnumbered list", () => expect(numberedReferences(`${refs[0]!}\n${refs[1]!}`)).toEqual([]));
});

describe("cleanKeywords and wire parsing", () => {
  it("meets the form limits: trimmed, unique, short, within the keyword limit", () => {
    const out = cleanKeywords([" Soil carbon. ", "soil carbon", "x".repeat(61), "a, b", ...Array.from({ length: KEYWORDS_MAX_COUNT + 8 }, (_, i) => `topic ${i}`)]);
    expect(out[0]).toBe("Soil carbon");
    expect(out).toHaveLength(KEYWORDS_MAX_COUNT);
    expect(out.every((k) => k.length <= 60 && !k.includes(","))).toBe(true);
  });
  it("accepts fenced JSON and ignores non-strings; rejects text without JSON", () => {
    expect(parseSuggestWire('```json\n{"keywords":["a",1],"references":["r"]}\n```')).toEqual({ abstract: "", keywords: ["a"], references: ["r"] });
    expect(() => parseSuggestWire("sorry, no")).toThrow();
  });
  it("numbers references one per line and chunks on line boundaries", () => {
    expect(formatReferences(["A", "B"])).toBe("1. A\n2. B");
    expect(chunkLines("a\nb\nc", 3, 5)).toEqual(["a\nb", "c"]);
  });
});

describe("cleanAbstract", () => {
  const ms = "Title\nAbstract\nSoil carbon\nloses stability under warming, and microbial respiration rises with drought stress across sites.\nIntroduction\nMore text.";
  it("marks an abstract found in the file as FILE and strips the heading and line breaks", () => {
    const r = cleanAbstract("Abstract: Soil carbon\nloses stability under warming, and microbial respiration rises with drought stress across sites.", ms);
    expect(r.from).toBe("FILE");
    expect(r.text.startsWith("Soil carbon loses")).toBe(true);
  });
  it("marks a written abstract as AI, drops one that is too short, and caps the length", () => {
    expect(cleanAbstract("This paper examines how warming changes soil carbon storage and what that means for climate models.", ms).from).toBe("AI");
    expect(cleanAbstract("Too short.", ms)).toEqual({ text: "", from: "NONE" });
    expect(cleanAbstract("x ".repeat(4000), ms).text.length).toBeLessThanOrEqual(5000);
  });
});

describe("who may use automatic abstract, keywords and references", () => {
  it("founder, admin and super_admin only", () => {
    for (const r of ["founder", "admin", "super_admin"]) expect(canSuggestMetadata([r])).toBe(true);
    expect(canSuggestMetadata(["researcher", "editor"])).toBe(false);
    expect(canSuggestMetadata(["researcher", "founder"])).toBe(true);
  });
  it("nobody else: researcher, editor, reviewer, payment, ethics, copyright, or no role", () => {
    for (const r of ["researcher", "editor", "reviewer", "payment_admin", "ethics_reviewer", "copyright_reviewer"]) expect(canSuggestMetadata([r])).toBe(false);
    expect(canSuggestMetadata([])).toBe(false);
  });
});

describe("buildSuggestPrompt", () => {
  it("front matter alone asks for abstract and keywords and sends no reference block", () => {
    const p = buildSuggestPrompt({ head: "Title\nAbstract text", referencePart: "", part: 1, parts: 1 });
    expect(p).toContain("<manuscript_start>");
    expect(p).toContain("references must be []");
    expect(p).not.toContain("<reference_list");
  });
  it("a reference piece alone carries no manuscript head", () => {
    const p = buildSuggestPrompt({ referencePart: "1. A", part: 2, parts: 3 });
    expect(p).not.toContain("<manuscript_start>");
    expect(p).toContain('<reference_list part="2 of 3">');
  });
});

describe("references read from a PDF", () => {
  const e1 = "Smith J, Rao P. Soil carbon dynamics under warming and drought across temperate forest sites. Nature Climate Change. 2021;11:100-105.";
  it("still matches when the model repaired a word the PDF broke across two lines", () => {
    const section = `${e1.replace("temperate", "tem-\nperate")}\n`;
    expect(verifyReferences([e1], section).kept).toEqual([e1]);
  });
  it("still matches when a running header or page number falls inside the entry", () => {
    const section = `${e1.slice(0, 70)}\n42\nJournal of Soil Science\n${e1.slice(70)}`;
    const v = verifyReferences([e1], section);
    expect(v.kept).toEqual([e1]);
    expect(v.dropped).toBe(0);
  });
  it("still drops an entry whose middle was changed or invented", () => {
    const section = `${e1.slice(0, 70)}\n42\n${e1.slice(70)}`;
    expect(verifyReferences([e1.replace("temperate forest", "tropical ocean")], section).kept).toEqual([]);
    expect(verifyReferences(["Invented A, Made B. A long title that is not anywhere in the list at all. Journal of Nothing. 2020;1:1-9."], section).kept).toEqual([]);
  });
  it("numbered lists are read without AI even with page numbers and broken words", () => {
    const list = `1. ${e1.replace("temperate", "tem-\nperate")}\n17\n2. ${refs[1]!}\n3. Third reference entry long enough here.`;
    const out = numberedReferences(list);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("temperate forest");
    expect(out[0]).not.toContain("17");
  });
});
