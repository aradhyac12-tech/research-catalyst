// Structural validation for uploaded manuscripts. Uploaded files are never executed.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FileScanResult {
  passed: boolean;
  reasons: string[];
  warnings: string[];
  scanner: string;
}

const EXECUTABLE_SIGNATURES: Array<[string, number[]]> = [
  ["Windows executable (MZ)", [0x4d, 0x5a]],
  ["ELF executable", [0x7f, 0x45, 0x4c, 0x46]],
  ["Mach-O executable", [0xcf, 0xfa, 0xed, 0xfe]],
  ["ZIP/Office container", [0x50, 0x4b, 0x03, 0x04]],
  ["Shell script", [0x23, 0x21]],
];

/**
 * Heuristic scanner. This is NOT a substitute for an antivirus engine; a real
 * malware scanner (e.g. ClamAV service) should be plugged in via MalwareScanner.
 */
export function scanPdf(bytes: Uint8Array, declaredName: string, declaredMime: string): FileScanResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (bytes.byteLength === 0) reasons.push("Empty file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) reasons.push("File exceeds 25 MB limit");
  if (!/\.pdf$/i.test(declaredName)) reasons.push("File extension must be .pdf");
  if (declaredMime && declaredMime !== "application/pdf") reasons.push(`Unexpected MIME type ${declaredMime}`);

  for (const [label, sig] of EXECUTABLE_SIGNATURES) {
    if (sig.every((b, i) => bytes[i] === b)) reasons.push(`Executable or container content disguised as PDF (${label})`);
  }
  // PDF magic must appear within first 1024 bytes
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  if (!head.includes("%PDF-")) reasons.push("Missing PDF header");
  const tail = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, bytes.byteLength - 2048)));
  if (!tail.includes("%%EOF")) warnings.push("PDF end-of-file marker missing (possibly truncated)");

  // Active content inspection (sampled over whole file as latin1 text)
  const body = new TextDecoder("latin1").decode(bytes);
  const active: Array<[RegExp, string, boolean]> = [
    [/\/JavaScript\b|\/JS\s*[(<]/, "Embedded JavaScript", true],
    [/\/Launch\b/, "Launch action", true],
    [/\/EmbeddedFile/, "Embedded file attachment (allowed; flagged for editor review)", false],
    [/\/RichMedia\b/, "Rich media content", true],
    [/\/OpenAction\b/, "Automatic open action", false],
    [/\/AA\s*<</, "Additional actions", false],
    [/\/XFA\b/, "XFA form", false],
  ];
  for (const [re, label, blocking] of active) {
    if (re.test(body)) (blocking ? reasons : warnings).push(label);
  }
  if (!/\/Type\s*\/Page\b/.test(body) && !/\/ObjStm/.test(body)) warnings.push("No page objects found in uncompressed structure");
  return { passed: reasons.length === 0, reasons, warnings, scanner: "paperly-heuristic-pdf-1.0" };
}

// ---------------- manuscript kinds (PDF + Word .docx) ----------------
export type ManuscriptKind = "pdf" | "docx";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MANUSCRIPT_ACCEPT = "application/pdf,.pdf," + DOCX_MIME + ",.docx";
export const MANUSCRIPT_LABEL = "PDF or Word (.docx)";

export function manuscriptKind(name: string): ManuscriptKind | null {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.docx$/i.test(name)) return "docx";
  return null;
}
export const kindMime = (k: ManuscriptKind) => (k === "pdf" ? "application/pdf" : DOCX_MIME);
export const kindExt = (k: ManuscriptKind) => (k === "pdf" ? "pdf" : "docx");

/** Minimal ZIP central-directory reader (no dependencies; entries are only listed or inflated, never extracted to disk). */
export interface ZipEntry { name: string; method: number; compSize: number; size: number; offset: number }
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a valid ZIP container");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > bytes.byteLength || dv.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    out.push({ name: new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nl)), method, compSize, size, offset });
    p += 46 + nl + el + cl;
  }
  return out;
}

export async function readZipEntry(bytes: Uint8Array, e: ZipEntry, maxBytes = 30 * 1024 * 1024): Promise<Uint8Array> {
  if (e.size > maxBytes) throw new Error("ZIP entry too large");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const raw = bytes.slice(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error("Unsupported ZIP compression");
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("ZIP entry too large");
  return buf;
}

/** Structural scan of a .docx. Macros, embedded OLE/ActiveX objects and nested packages are blocked. */
export function scanDocx(bytes: Uint8Array, declaredName: string, declaredMime: string): FileScanResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (bytes.byteLength === 0) reasons.push("Empty file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) reasons.push("File exceeds 25 MB limit");
  if (!/\.docx$/i.test(declaredName)) reasons.push("File extension must be .docx");
  if (declaredMime && declaredMime !== DOCX_MIME && declaredMime !== "application/octet-stream") reasons.push(`Unexpected MIME type ${declaredMime}`);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    reasons.push("Not a Word (.docx) file. Legacy .doc files must be re-saved as .docx or PDF");
    return { passed: false, reasons, warnings, scanner: "paperly-heuristic-docx-1.0" };
  }
  try {
    const entries = listZip(bytes);
    const names = entries.map((e) => e.name.toLowerCase());
    if (!names.includes("word/document.xml")) reasons.push("Missing word/document.xml (not a Word document)");
    if (names.some((n) => n.endsWith("vbaproject.bin") || n.includes("vbadata"))) reasons.push("Embedded macros (VBA)");
    if (names.some((n) => n.startsWith("word/embeddings/") || n.includes("activex"))) reasons.push("Embedded object or ActiveX content");
    if (entries.some((e) => e.size > 0 && e.compSize > 0 && e.size / e.compSize > 200 && e.size > 5 * 1024 * 1024)) reasons.push("Suspicious compression ratio");
    if (entries.reduce((a, e) => a + e.size, 0) > 150 * 1024 * 1024) reasons.push("Uncompressed content too large");
    if (names.some((n) => n.startsWith("word/externallinks/") || n.includes("oleobject"))) warnings.push("Contains external links");
  } catch (e) {
    reasons.push(e instanceof Error ? e.message : "Unreadable Word container");
  }
  return { passed: reasons.length === 0, reasons, warnings, scanner: "paperly-heuristic-docx-1.0" };
}

/** Dispatches on the declared file name. Anything that is not .pdf or .docx is rejected. */
export function scanManuscript(bytes: Uint8Array, declaredName: string, declaredMime: string): FileScanResult {
  const k = manuscriptKind(declaredName);
  if (k === "docx") return scanDocx(bytes, declaredName, declaredMime);
  if (k === "pdf") return scanPdf(bytes, declaredName, declaredMime);
  return { passed: false, reasons: ["Only PDF or Word (.docx) files are accepted"], warnings: [], scanner: "paperly-heuristic-1.0" };
}

/** Plain text from a .docx (paragraph per line) for screening. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const e = listZip(bytes).find((x) => x.name === "word/document.xml");
  if (!e) throw new Error("word/document.xml missing");
  const xml = new TextDecoder().decode(await readZipEntry(bytes, e));
  const dec = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n").map(dec).join("\n");
}
