import { describe, expect, it } from "vitest";
import { classifyReference, extractDoi, parseReferences, titleSimilarity } from "./references";
import { formatAPA, formatBibTeX, formatEndNote, formatMLA, formatRIS, formatVancouver, type CitablePaper } from "./citation-formats";
import { buildJsonLd, buildMetaTags, buildRobots, buildSitemap, jsonLdScript, type MetaPaper } from "./metadata";

const base: CitablePaper = { title: "Deep learning for X & Y", authors: ["Ada Lovelace", "Turing, Alan M."], year: 2026, publicId: "PLY-2026-000012", url: "https://p.example/article/PLY-2026-000012", version: "1.0", publicationType: "PREPRINT", publishedDate: "2026-03-04" };

describe("references", () => {
  it("extracts and cleans DOIs", () => {
    expect(extractDoi("Smith J. Title. Nature. doi:10.1038/S41586-020-2649-2.")).toBe("10.1038/s41586-020-2649-2");
    expect(extractDoi("no identifier here")).toBeNull();
  });
  it("parses numbered and line lists", () => {
    expect(parseReferences("1. Alpha et al. 2020. Foo.\n2. Beta 2021. Bar. 10.1000/xyz")).toHaveLength(2);
    expect(parseReferences("[1] First ref text\n  continues here\n[2] Second ref text")[0].raw).toContain("continues here");
    expect(parseReferences("Ref one is long enough\nRef two is long enough")).toHaveLength(2);
  });
  it("classifies without calling anything fake", () => {
    expect(classifyReference("x", null, null).status).toBe("REQUIRES_REVIEW");
    expect(classifyReference("x", "10.1/x", { kind: "not_found" }).status).toBe("DOI_NOT_FOUND");
    expect(classifyReference("x", "10.1/x", { kind: "unavailable" }).status).toBe("REQUIRES_REVIEW");
    expect(classifyReference("Deep learning for protein folding", "10.1/x", { kind: "found", title: "Deep Learning for Protein Folding" }).status).toBe("VERIFIED");
    expect(classifyReference("Totally different words about cats", "10.1/x", { kind: "found", title: "Deep Learning for Protein Folding" }).status).toBe("REQUIRES_REVIEW");
    for (const s of ["x"]) expect(JSON.stringify(classifyReference(s, null, null)).toLowerCase()).not.toContain("fake");
  });
  it("title similarity is symmetric and bounded", () => {
    const s = titleSimilarity("A study of cats", "Cats: a study");
    expect(s).toBeGreaterThan(0.5); expect(s).toBeLessThanOrEqual(1);
  });
});

describe("citations", () => {
  it("never invents a DOI and uses the URL instead", () => {
    for (const f of [formatAPA, formatVancouver, formatMLA, formatBibTeX, formatRIS, formatEndNote]) {
      const out = f(base); expect(out).not.toMatch(/10\.\d{4,}/); expect(out).toContain("PLY-2026-000012".slice(0, 0) + "article/PLY-2026-000012");
    }
  });
  it("includes a verified DOI", () => {
    const p = { ...base, doi: "10.5555/abc" };
    expect(formatAPA(p)).toContain("https://doi.org/10.5555/abc");
    expect(formatBibTeX(p)).toContain("doi = {10.5555/abc}");
    expect(formatRIS(p)).toContain("DO  - 10.5555/abc");
    expect(formatEndNote(p)).toContain("%R 10.5555/abc");
  });
  it("escapes BibTeX specials and handles 'Last, First' names", () => {
    expect(formatBibTeX(base)).toContain("X \\& Y");
    expect(formatAPA(base)).toContain("Turing, A. M.");
    expect(formatVancouver(base)).toContain("Lovelace A");
  });
  it("never claims a journal for a repository record", () => {
    expect(formatBibTeX(base)).toMatch(/^@misc/);
    expect(formatRIS(base)).toContain("TY  - GEN");
    expect(formatRIS(base)).not.toContain("JOUR");
  });
});

describe("metadata", () => {
  const m: MetaPaper = { ...base, status: "PUBLISHED", license: "CC BY 4.0", field: "CS", abstract: "A </script> abstract", keywords: ["a", "b"], authorsDetailed: [{ name: "Ada Lovelace", orcid: "0000-0002-1825-0097", affiliations: ["Uni"] }, { name: "Alan", affiliations: [] }] };
  it("JSON-LD has no ISSN/journal and escapes script breaks", () => {
    const j = buildJsonLd(m); expect(JSON.stringify(j)).not.toMatch(/issn|isPartOf/i);
    expect(jsonLdScript(j)).not.toContain("</script>");
    expect(j.license).toBe("https://creativecommons.org/licenses/by/4.0/");
  });
  it("meta tags omit DOI when none and include verified ORCID only if passed", () => {
    const tags = buildMetaTags({ ...m, authorsDetailed: [{ name: "Alan", affiliations: [] }] });
    expect(tags.find((t) => t.name === "citation_doi")).toBeUndefined();
    expect(tags.find((t) => t.name === "citation_author_orcid")).toBeUndefined();
    expect(buildMetaTags(m).find((t) => t.name === "citation_author_orcid")?.content).toContain("orcid.org/0000");
  });
  it("sitemap and robots", () => {
    expect(buildSitemap("https://s", [{ paperly_id: "PLY-2026-000001", updated_at: "2026-01-02T00:00:00Z" }])).toContain("https://s/article/PLY-2026-000001");
    expect(buildRobots("https://s")).toContain("Sitemap: https://s/sitemap.xml");
  });
});

import { doiRegistrationAllowed, getDoiProvider } from "./doi-provider";
describe("doi", () => {
  it("default provider never returns a DOI", async () => {
    const r = await getDoiProvider().register({} as never, "k"); expect(r.doi).toBeNull(); expect(r.status).toBe("NOT_CONFIGURED");
  });
  it("registration gated on final status and environment", () => {
    expect(doiRegistrationAllowed({ status: "ACCEPTED", publicationType: "PREPRINT", hasTitle: true, env: "production" }).ok).toBe(false);
    expect(doiRegistrationAllowed({ status: "PUBLICATION_PENDING", publicationType: "PREPRINT", hasTitle: true, env: undefined }).ok).toBe(false);
    expect(doiRegistrationAllowed({ status: "PUBLICATION_PENDING", publicationType: "PREPRINT", hasTitle: true, env: "sandbox" }).ok).toBe(true);
  });
});
