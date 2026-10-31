import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { sanitizePdf, scanAndSanitizeManuscript } from "./pdf-sanitize";
import { scanPdf } from "./file-security";

async function pdfWithJs(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText("Hello manuscript");
  const ctx = doc.context;
  const js = ctx.register(ctx.obj({ S: "JavaScript", JS: PDFString.of("app.alert('x')") }));
  doc.catalog.set(PDFName.of("OpenAction"), js);
  const jsAction = ctx.register(ctx.obj({ S: "JavaScript", JS: PDFString.of("this.print()") }));
  const names = ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of("a"), jsAction] }) });
  doc.catalog.set(PDFName.of("Names"), names);
  const annot = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: ctx.obj({ S: "JavaScript", JS: PDFString.of("x") }) }));
  page.node.set(PDFName.of("Annots"), ctx.obj([annot]));
  return doc.save({ useObjectStreams: false });
}

describe("sanitizePdf", () => {
  it("rejects the original but accepts the sanitized copy", async () => {
    const bad = await pdfWithJs();
    expect(scanPdf(bad, "a.pdf", "application/pdf").passed).toBe(false);
    const r = await scanAndSanitizeManuscript(bad, "a.pdf", "application/pdf");
    expect(r.scan.passed).toBe(true);
    expect(r.scan.warnings.join(" ")).toMatch(/Active content removed/);
    const reloaded = await PDFDocument.load(r.bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
  it("leaves clean PDFs untouched", async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const clean = await doc.save({ useObjectStreams: false });
    const r = await scanAndSanitizeManuscript(clean, "a.pdf", "application/pdf");
    expect(r.bytes).toBe(clean);
    expect(r.scan.passed).toBe(true);
  });
  it("still rejects non-fixable problems and garbage", async () => {
    const r = await scanAndSanitizeManuscript(new Uint8Array([1, 2, 3]), "a.pdf", "application/pdf");
    expect(r.scan.passed).toBe(false);
    await expect(sanitizePdf(new Uint8Array([1, 2, 3]))).rejects.toBeTruthy();
  });
});
