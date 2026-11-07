// Server-only: removes active content (JavaScript, launch actions, rich media) from an uploaded PDF so a
// legitimate manuscript is not bounced. Output is re-scanned by scanManuscript; if anything blocking survives
// the file is still rejected. Do not import from client code (pulls in pdf-lib).
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from "pdf-lib";
import { scanManuscript, manuscriptKind, type FileScanResult } from "./file-security";

const BAD_ACTIONS = new Set(["JavaScript", "Launch", "ImportData", "Rendition", "GoToE"]);
const DROP_KEYS = ["AA", "OpenAction", "JavaScript", "JS", "XFA", "RichMediaContent", "RichMediaSettings"];
const AUTO_FIXABLE = new Set(["Embedded JavaScript", "Launch action", "Rich media content"]);

export async function sanitizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const ctx = doc.context;
  const asDict = (o: PDFObject | undefined): PDFDict | undefined => {
    const v = o instanceof PDFRef ? ctx.lookup(o) : o;
    return v instanceof PDFStream ? v.dict : v instanceof PDFDict ? v : undefined;
  };
  const isBadAction = (o: PDFObject | undefined): boolean => {
    const s = asDict(o)?.get(PDFName.of("S"));
    return s instanceof PDFName && BAD_ACTIONS.has(s.decodeText());
  };
  const isRichMedia = (o: PDFObject | undefined): boolean => {
    const s = asDict(o)?.get(PDFName.of("Subtype"));
    return s instanceof PDFName && ["RichMedia", "Screen", "Movie", "Sound"].includes(s.decodeText());
  };

  const all = ctx.enumerateIndirectObjects();
  const badRefs: PDFRef[] = [];
  for (const [ref, obj] of all) if (isBadAction(obj)) badRefs.push(ref);

  const clean = (d: PDFDict, depth: number): void => {
    for (const k of DROP_KEYS) {
      const v = d.get(PDFName.of(k));
      if (v instanceof PDFRef && k !== "XFA") badRefs.push(v);
      if (v !== undefined) d.delete(PDFName.of(k));
    }
    for (const k of ["A", "Next"]) if (isBadAction(d.get(PDFName.of(k)))) d.delete(PDFName.of(k));
    const annots = d.get(PDFName.of("Annots"));
    const arr = annots instanceof PDFRef ? ctx.lookup(annots) : annots;
    if (arr instanceof PDFArray) {
      for (let i = arr.size() - 1; i >= 0; i--) if (isRichMedia(arr.get(i))) arr.remove(i);
    }
    if (depth < 8) for (const [, v] of d.entries()) if (v instanceof PDFDict) clean(v, depth + 1); // direct (inline) dictionaries
  };
  for (const [, obj] of all) {
    const d = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
    if (d) clean(d, 0);
  }
  for (const ref of badRefs) ctx.delete(ref);
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return out;
}

/** Scan; if the only blockers are active-content findings, strip them and re-scan the cleaned copy. */
export async function scanAndSanitizeManuscript(bytes: Uint8Array, name: string, mime: string): Promise<{ bytes: Uint8Array; scan: FileScanResult }> {
  const scan = scanManuscript(bytes, name, mime);
  if (scan.passed || manuscriptKind(name) !== "pdf" || !scan.reasons.every((r) => AUTO_FIXABLE.has(r))) return { bytes, scan };
  const found = scan.reasons.join(", ");
  try {
    const clean = await sanitizePdf(bytes);
    const rescan = scanManuscript(clean, name, mime);
    if (rescan.passed) {
      rescan.warnings.push(`Active content removed automatically (${found})`);
      return { bytes: clean, scan: rescan };
    }
    return { bytes, scan: { ...scan, reasons: [...scan.reasons, "automatic cleanup could not remove it; re-save via Print > Save as PDF"] } };
  } catch {
    return { bytes, scan: { ...scan, reasons: [...scan.reasons, "automatic cleanup failed (encrypted or damaged PDF?); re-save via Print > Save as PDF"] } };
  }
}
