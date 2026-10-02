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
    [/\/EmbeddedFile\b/, "Embedded file attachment", true],
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
