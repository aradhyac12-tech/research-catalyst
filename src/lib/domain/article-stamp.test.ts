import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderStampedArticle, type StampData } from "./article-stamp";

const data = (over: Partial<StampData> = {}): StampData => ({
  paperlyId: "PLY-2026-000123", legacyId: "RP-2026-004512", title: "A study of things", authors: [{ name: "Ada Lovelace", orcid: null }, { name: "Alan Turing", orcid: "0000-0002-1825-0097" }],
  doi: null, version: "1.0", versionIdentifier: "PLY-2026-000123-V1.0", fileSha256: "a".repeat(64), publishedAt: "2026-10-05T10:00:00Z", status: "PUBLISHED",
  recordType: "Repository record", reviewStatement: "Not peer reviewed (automated screening and editorial check only)", license: "CC BY 4.0",
  articleUrl: "https://example.org/article/PLY-2026-000123", citation: "Lovelace A. A study of things. 2026.",
  certificates: [{ id: "PLY-CERT-2026-AAAAAA", type: "PUBLICATION", recipient: "Ada Lovelace", status: "VALID", url: "https://example.org/verify/certificate/PLY-CERT-2026-AAAAAA" }],
  generatedAt: "2026-10-11T00:00:00Z", sourceKind: "pdf", ...over,
});

async function sourcePdf(pages: number) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText(`page ${i + 1}`, { x: 60, y: 760, size: 14, font: f });
  return new Uint8Array(await d.save());
}

describe("renderStampedArticle", () => {
  it("puts a journal cover page and one record sheet in front of an unchanged PDF", async () => {
    const out = await PDFDocument.load(await renderStampedArticle(data(), await sourcePdf(3)));
    expect(out.getPageCount()).toBe(2 + 3); // cover + record sheet + the 3 original pages
    expect(out.getTitle()).toBe("A study of things");
  });
  it("renders a Word manuscript as text pages after the sheet", async () => {
    const blocks = Array.from({ length: 120 }, (_, i) => ({ kind: "p" as const, level: 0, text: `Paragraph ${i} ` + "word ".repeat(60) }));
    const out = await PDFDocument.load(await renderStampedArticle(data({ sourceKind: "docx" }), new Uint8Array(), blocks));
    expect(out.getPageCount()).toBeGreaterThan(3);
  });
  it("is deterministic for the same input", async () => {
    const src = await sourcePdf(1);
    const a = await renderStampedArticle(data(), src), b = await renderStampedArticle(data(), src);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it("refuses a file that is not a readable PDF", async () => {
    await expect(renderStampedArticle(data(), new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not be read/);
  });
});
