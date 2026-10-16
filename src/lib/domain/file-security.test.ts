import { describe, it, expect } from "vitest";
import { scanPdf } from "./file-security";

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = (extra = "") => enc(`%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n${extra}\n%%EOF`);

describe("scanPdf embedded files", () => {
  it("passes a clean PDF", () => {
    expect(scanPdf(pdf(), "a.pdf", "application/pdf").passed).toBe(true);
  });
  it("allows an embedded file attachment but warns", () => {
    const r = scanPdf(pdf("2 0 obj\n<< /Type /EmbeddedFile /Length 3 >>\nendobj"), "a.pdf", "application/pdf");
    expect(r.passed).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/Embedded file attachment/);
  });
});

import { scanManuscript, scanDocx, DOCX_MIME } from "./file-security";
// Build a tiny stored (uncompressed) ZIP in memory.
function zip(files: Record<string, string>): Uint8Array {
  const parts: number[][] = []; const central: number[][] = []; let off = 0;
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  for (const [name, body] of Object.entries(files)) {
    const nb = [...enc(name)], bb = [...enc(body)];
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(bb.length), ...u32(bb.length), ...u16(nb.length), ...u16(0), ...nb, ...bb];
    central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(bb.length), ...u32(bb.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nb]);
    parts.push(local); off += local.length;
  }
  const cd = central.flat();
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cd.length), ...u32(off), ...u16(0)];
  return new Uint8Array([...parts.flat(), ...cd, ...end]);
}
describe("scanDocx", () => {
  it("accepts a plain docx", () => {
    expect(scanDocx(zip({ "word/document.xml": "<w:p/>" }), "a.docx", DOCX_MIME).passed).toBe(true);
  });
  it("blocks macros", () => {
    const r = scanDocx(zip({ "word/document.xml": "x", "word/vbaProject.bin": "x" }), "a.docx", DOCX_MIME);
    expect(r.passed).toBe(false);
  });
  it("rejects other extensions and non-zip content", () => {
    expect(scanManuscript(enc("hello"), "a.docx", DOCX_MIME).passed).toBe(false);
    expect(scanManuscript(enc("x"), "a.txt", "").passed).toBe(false);
  });
});
