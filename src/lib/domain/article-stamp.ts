import { PDFDocument, PDFName, PDFString, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import qrcode from "qrcode-generator";
import { fontBase64, loraRegularBase64, loraBoldBase64 } from "@/assets/certificate-resources";
import { PLATFORM_NAME } from "./constants";
import { logoPngBase64, LOGO_ASPECT } from "@/assets/logo-resources";
import { JOURNAL_SUBTITLE, journalIssueLine, orderTeacherFirst, numberAffiliations, looksLikeSection, KEYWORDS_INLINE_RE } from "./journal";
import type { DocxBlock } from "./docx-html";

/**
 * The author's download of a published record: a Paperly record sheet is put in front of the file and a one-line stamp runs up the left margin
 * of every page. The author's own pages are not changed in any other way (a PDF keeps its pages, text, images and links).
 *
 * Design follows common practice: arXiv stamps "identifier, version, date" in the left margin of each page; SSRN stamps a link back to the
 * record on each page; Crossref asks that a DOI is shown as a full https://doi.org/ link, never as "doi:" text.
 * Paperly's own identifiers are never presented as DOIs, and the sheet says only what the record truthfully is (review status comes from the record).
 */

/** Bump when the sheet layout changes, so cached downloads are regenerated. */
export const STAMP_LAYOUT_VERSION = 3;

export interface StampCertificate { id: string; type: string; recipient: string; status: string; url: string }
export interface StampData {
  paperlyId: string;
  legacyId: string | null;
  title: string;
  authors: Array<{ name: string; orcid: string | null; affiliation?: string | null }>;
  abstract?: string;
  keywords?: string[];
  doi: string | null;
  version: string;
  versionIdentifier: string | null;
  fileSha256: string;
  publishedAt: string | null;
  status: string;
  recordType: string;
  reviewStatement: string;
  license: string | null;
  articleUrl: string;
  citation: string | null;
  certificates: StampCertificate[];
  /** ISO time the sheet was made. Not part of the cache key. */
  generatedAt: string;
  sourceKind: "pdf" | "docx";
}

const A4: [number, number] = [595.28, 841.89];
const M = 42;
const INK = rgb(0.13, 0.13, 0.15), MUTED = rgb(0.4, 0.4, 0.44), RULE = rgb(0.75, 0.75, 0.78), ACCENT = rgb(0.35, 0.05, 0.07), RED = rgb(0.6, 0.1, 0.1);
const bytes = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));

const fmtDate = (iso: string | null) => {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "Not recorded";
};
const STATUS_LABEL: Record<string, string> = { PUBLISHED: "Published", CORRECTED: "Published, corrected", RETRACTED: "Retracted" };
const CERT_LABEL: Record<string, string> = { SUBMISSION: "Submission", PUBLICATION: "Publication", AUTHOR_RECORD: "Author record" };

interface Fonts { regular: PDFFont; bold: PDFFont; fallback: PDFFont; covered: { regular: Set<number>; bold: Set<number> } }
type W = "regular" | "bold";

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(bytes(loraRegularBase64), { subset: true });
  const bold = await doc.embedFont(bytes(loraBoldBase64), { subset: true });
  const fallback = await doc.embedFont(bytes(fontBase64), { subset: true });
  return { regular, bold, fallback, covered: { regular: new Set(regular.getCharacterSet()), bold: new Set(bold.getCharacterSet()) } };
}
const pick = (f: Fonts, text: string, w: W) => [...text].every((ch) => f.covered[w].has(ch.codePointAt(0)!) || /\s/.test(ch)) ? f[w] : f.fallback;
const width = (f: Fonts, t: string, size: number, w: W) => pick(f, t, w).widthOfTextAtSize(t, size);

/** Greedy word wrap; a single word wider than the column (a hash, a long URL) is broken by character. */
function wrap(f: Fonts, text: string, size: number, w: W, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let piece = word;
      while (width(f, piece, size, w) > maxW) {
        let cut = piece.length;
        while (cut > 1 && width(f, piece.slice(0, cut), size, w) > maxW) cut--;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(piece.slice(0, cut)); piece = piece.slice(cut);
      }
      const next = cur ? `${cur} ${piece}` : piece;
      if (width(f, next, size, w) <= maxW) cur = next; else { if (cur) lines.push(cur); cur = piece; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [""];
}

function link(doc: PDFDocument, page: PDFPage, x: number, y: number, w: number, h: number, url: string) {
  const a = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } }));
  const prev = page.node.get(PDFName.of("Annots"));
  const list = prev ? (doc.context.lookup(prev) as unknown as { push: (r: unknown) => void } | undefined) : undefined;
  if (list && typeof list.push === "function") list.push(a); else page.node.set(PDFName.of("Annots"), doc.context.obj([a]));
}

/** Journal-style first page: wordmark, journal name, volume/issue line, title, numbered authors (teacher first), affiliations, then bold Abstract and Keywords sections. */
async function drawCover(doc: PDFDocument, f: Fonts, d: StampData) {
  const [PW, PH] = A4;
  const MX = 56, TW = PW - 2 * MX, BOT = 60;
  let page = doc.addPage(A4); let y = PH - 52;
  const text = (t: string, x: number, yy: number, size: number, w: W = "regular", color = INK) => page.drawText(t, { x, y: yy, size, font: pick(f, t, w), color });
  const center = (t: string, yy: number, size: number, w: W = "regular", color = INK) => text(t, (PW - width(f, t, size, w)) / 2, yy, size, w, color);
  const room = (h: number) => { if (y - h < BOT) { page = doc.addPage(A4); y = PH - 56; } };

  // The Paperly seal (it carries the journal name).
  const lw0 = 120, lh0 = lw0 / LOGO_ASPECT;
  page.drawImage(await doc.embedPng(bytes(logoPngBase64)), { x: (PW - lw0) / 2, y: y - lh0, width: lw0, height: lh0 });
  y -= lh0 + 14;
  const issue = journalIssueLine(d.publishedAt ?? d.generatedAt);
  const host = d.articleUrl.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  text(issue, MX, y - 10, 10, "bold"); text(host, PW - MX - width(f, host, 10, "bold"), y - 10, 10, "bold"); y -= 18;
  page.drawLine({ start: { x: MX, y }, end: { x: PW - MX, y }, thickness: 1, color: INK }); y -= 22;

  for (const ln of wrap(f, d.title.toUpperCase(), 15, "bold", TW).slice(0, 6)) { center(ln, y - 15, 15, "bold"); y -= 21; }
  y -= 10;

  // Authors: teacher first, each with their own number, in bold, centred.
  const ordered = orderTeacherFirst(d.authors, (a) => a.affiliation);
  type Seg = { name: string; num: string; w: number };
  const segs: Seg[] = ordered.map((a, i) => ({ name: a.name, num: String(i + 1), w: 0 }));
  const SZ = 11.5, SUP = 7.5;
  segs.forEach((g) => { g.w = width(f, g.name, SZ, "bold") + width(f, g.num, SUP, "bold") + width(f, ", ", SZ, "bold"); });
  const rows: Seg[][] = []; let row: Seg[] = []; let rw = 0;
  for (const g of segs) { if (row.length && rw + g.w > TW) { rows.push(row); row = []; rw = 0; } row.push(g); rw += g.w; }
  if (row.length) rows.push(row);
  rows.forEach((r) => {
    room(20);
    const total = r.reduce((a, g) => a + g.w, 0) - width(f, ", ", SZ, "bold");
    let x = (PW - total) / 2;
    r.forEach((g, i) => {
      text(g.name, x, y - SZ, SZ, "bold"); x += width(f, g.name, SZ, "bold");
      text(g.num, x, y - SZ + 4.5, SUP, "bold"); x += width(f, g.num, SUP, "bold");
      if (i < r.length - 1) { text(", ", x, y - SZ, SZ, "bold"); x += width(f, ", ", SZ, "bold"); }
    });
    y -= 19;
  });
  y -= 4;
  for (const g of numberAffiliations(ordered, (a) => a.affiliation)) {
    const label = g.numbers.join(",");
    const lw = width(f, label, 7, "regular") + 3;
    const lines = wrap(f, g.text, 10, "regular", TW - lw);
    room(14 * lines.length);
    text(label, MX, y - 6, 7, "regular"); lines.forEach((ln, i) => { text(ln, MX + lw, y - 10, 10, "regular"); y -= 14; void i; });
  }
  y -= 6; page.drawLine({ start: { x: MX, y }, end: { x: PW - MX, y }, thickness: 0.75, color: INK }); y -= 20;

  const section = (head: string) => { room(40); text(head, MX, y - 13, 13, "bold"); y -= 22; };
  const para = (t: string, size = 10.5) => { for (const ln of wrap(f, t, size, "regular", TW)) { room(size * 1.5); text(ln, MX, y - size, size, "regular"); y -= size * 1.5; } y -= 6; };
  if (d.abstract?.trim()) { section("Abstract"); para(d.abstract.trim()); }
  if (d.keywords && d.keywords.length) {
    room(30);
    const label = "Keywords:"; const lw = width(f, label, 10.5, "bold") + 5;
    text(label, MX, y - 10.5, 10.5, "bold");
    for (const ln of wrap(f, d.keywords.join(", "), 10.5, "regular", TW - lw)) { room(16); text(ln, MX + lw, y - 10.5, 10.5, "regular"); y -= 15.5; }
  }
}

/** The record sheet: identifiers on the left, title and authors on the right. */
function drawSheet(doc: PDFDocument, page: PDFPage, f: Fonts, d: StampData) {
  const [PW, PH] = A4;
  const text = (t: string, x: number, y: number, size: number, w: W = "regular", color = INK) => page.drawText(t, { x, y, size, font: pick(f, t, w), color });
  let y = PH - M;

  // Masthead
  text(PLATFORM_NAME.toUpperCase(), M, y - 18, 22, "bold", ACCENT);
  text(JOURNAL_SUBTITLE, M + width(f, PLATFORM_NAME.toUpperCase(), 22, "bold") + 10, y - 17, 10, "bold", INK);
  const tag = "RECORD SHEET";
  text(tag, PW - M - width(f, tag, 8, "bold") , y - 8, 8, "bold", MUTED);
  y -= 30;
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 1.5, color: ACCENT });
  y -= 10;

  if (d.status === "RETRACTED") {
    page.drawRectangle({ x: M, y: y - 22, width: PW - 2 * M, height: 22, color: rgb(0.99, 0.92, 0.92) });
    text("THIS RECORD HAS BEEN RETRACTED. It remains public so readers can see what was withdrawn and why.", M + 8, y - 15, 8.5, "bold", RED);
    y -= 32;
  } else if (d.status === "CORRECTED") {
    text("This record has been corrected after publication. See the notices on its Paperly page.", M, y - 10, 8.5, "bold", MUTED);
    y -= 22;
  }
  y -= 8;
  const top = y;

  // Left column: identifiers
  const LX = M, LW = 176, RX = M + LW + 24, RW = PW - M - RX;
  let ly = top;
  const field = (label: string, value: string, o: { size?: number; url?: string; w?: W } = {}) => {
    const size = o.size ?? 9;
    text(label.toUpperCase(), LX, ly - 6, 6.5, "bold", MUTED);
    ly -= 12;
    const lines = wrap(f, value, size, o.w ?? "regular", LW);
    for (const ln of lines) {
      text(ln, LX, ly - size + 2, size, o.w ?? "regular", o.url ? ACCENT : INK);
      if (o.url) link(doc, page, LX, ly - size, Math.min(width(f, ln, size, o.w ?? "regular"), LW), size + 3, o.url);
      ly -= size + 3;
    }
    ly -= 7;
  };
  field("Paperly ID", d.paperlyId, { size: 12, w: "bold", url: d.articleUrl });
  if (d.legacyId) field("Previous ID", d.legacyId);
  field("DOI", d.doi ? `https://doi.org/${d.doi}` : "Not registered", d.doi ? { url: `https://doi.org/${d.doi}` } : {});
  field("Version", d.versionIdentifier ? `${d.version}  ·  ${d.versionIdentifier}` : d.version);
  field("Published", fmtDate(d.publishedAt));
  field("Status", STATUS_LABEL[d.status] ?? d.status);
  field("Record type", d.recordType);
  field("Review", d.reviewStatement);
  if (d.license) field("Licence", d.license);
  if (d.certificates.length === 0) field("Certificates", "None issued for this record");
  else { text("CERTIFICATES", LX, ly - 6, 6.5, "bold", MUTED); ly -= 14; }
  for (const c of d.certificates.slice(0, 10)) {
    const head = `${c.id}`;
    text(head, LX, ly - 9, 9, "bold", ACCENT);
    link(doc, page, LX, ly - 11, Math.min(width(f, head, 9, "bold"), LW), 12, c.url);
    ly -= 12;
    for (const ln of wrap(f, `${CERT_LABEL[c.type] ?? c.type}, ${c.recipient}${c.status !== "VALID" ? ` (${c.status.toLowerCase()})` : ""}`, 7.5, "regular", LW)) { text(ln, LX, ly - 7, 7.5, "regular", MUTED); ly -= 10; }
    ly -= 3;
  }
  if (d.certificates.length > 10) { text(`and ${d.certificates.length - 10} more, listed on the Paperly page`, LX, ly - 7, 7.5, "regular", MUTED); ly -= 12; }
  ly -= 4;
  field("File SHA-256 (original file)", d.fileSha256, { size: 7 });

  // Right column: title and authors
  let ry = top;
  const ts = d.title.length > 160 ? 14 : d.title.length > 90 ? 17 : 21;
  for (const ln of wrap(f, d.title, ts, "bold", RW).slice(0, 9)) { text(ln, RX, ry - ts + 3, ts, "bold"); ry -= ts * 1.22; }
  ry -= 10;
  // One author per line, so a name is never split across lines.
  for (const a of d.authors.slice(0, 24)) for (const ln of wrap(f, a.name, 12, "regular", RW).slice(0, 2)) { text(ln, RX, ry - 12 + 3, 12, "regular"); ry -= 16; }
  if (d.authors.length > 24) { text(`and ${d.authors.length - 24} more authors`, RX, ry - 9, 9, "regular", MUTED); ry -= 14; }
  const orc = d.authors.filter((a) => a.orcid);
  if (orc.length) {
    ry -= 6;
    for (const a of orc.slice(0, 12)) {
      const t = `${a.name}: https://orcid.org/${a.orcid}`;
      for (const ln of wrap(f, t, 7.5, "regular", RW)) { text(ln, RX, ry - 7, 7.5, "regular", MUTED); ry -= 10; }
      link(doc, page, RX, ry, RW, 10, `https://orcid.org/${a.orcid}`);
    }
    text("ORCID iDs shown here were verified through ORCID sign-in.", RX, ry - 8, 7, "regular", MUTED); ry -= 12;
  }
  if (d.citation) {
    ry -= 14;
    text("HOW TO CITE", RX, ry - 6, 6.5, "bold", MUTED); ry -= 14;
    for (const ln of wrap(f, d.citation, 9, "regular", RW).slice(0, 8)) { text(ln, RX, ry - 7, 9, "regular"); ry -= 12; }
  }

  // Footer: QR to the record and the plain statement of what was added.
  const bottom = Math.min(ly, ry) - 8;
  const fy = 150; void bottom;
  page.drawLine({ start: { x: M, y: fy }, end: { x: PW - M, y: fy }, thickness: 0.5, color: RULE });
  const qr = qrcode(0, "M"); qr.addData(d.articleUrl); qr.make();
  const n = qr.getModuleCount(), cell = 68 / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) page.drawRectangle({ x: M + c * cell, y: fy - 10 - 68 + (n - 1 - r) * cell, width: cell, height: cell, color: INK });
  link(doc, page, M, fy - 78, 68, 68, d.articleUrl);
  const note = [
    `Scan or open ${d.articleUrl.replace(/^https?:\/\//, "")} to see the record, its version history and any notices.`,
    d.sourceKind === "docx"
      ? "The manuscript was uploaded as a Word file. The pages after this sheet are a text rendering of it (images and complex layout are left out); the original Word file is kept unchanged on the Paperly page."
      : "The pages after this sheet are the author's PDF, unchanged except for the one-line stamp in the left margin.",
    "This sheet and the margin stamp were added by Paperly. They are not part of the manuscript. A certificate ID can be checked at the verification address behind it.",
    `Prepared ${fmtDate(d.generatedAt)}.`,
  ].join("\n");
  let ny = fy - 16;
  for (const ln of wrap(f, note, 8, "regular", PW - 2 * M - 84)) { text(ln, M + 84, ny, 8, "regular", MUTED); ny -= 11; }
  link(doc, page, M + 84, fy - 28, PW - 2 * M - 84, 12, d.articleUrl);
}

/** One line up the left margin of a page, in the manner of arXiv. Pages that are rotated are left alone. */
function stampMargin(page: PDFPage, f: Fonts, d: StampData) {
  if (page.getRotation().angle % 360 !== 0) return;
  const t = `${PLATFORM_NAME}:${d.paperlyId}  v${d.version}  ${fmtDate(d.publishedAt)}  ${d.articleUrl.replace(/^https?:\/\//, "")}`;
  const { x, y } = page.getCropBox();
  page.drawText(t, { x: x + 20, y: y + 36, size: 7, font: pick(f, t, "regular"), color: rgb(0.45, 0.45, 0.5), rotate: degrees(90) });
}

/** Make the section structure of a Word manuscript visible: Abstract, Introduction and the other main headings become bold headings,
 *  and Keywords (a line, or a heading followed by one keyword per line) become one horizontal comma-separated line. level -1 marks that line. */
function normalizeBlocks(blocks: DocxBlock[]): DocxBlock[] {
  const out: DocxBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const inline = b.kind !== "h" ? KEYWORDS_INLINE_RE.exec(b.text.trim()) : null;
    if (inline) { out.push({ kind: "p", level: -1, text: inline[1]!.replace(/\s*[\n|]+\s*/g, ", ").replace(/[.,;\s]+$/, "") }); continue; }
    if (/^keywords?\s*[:.]?$/i.test(b.text.trim()) && b.kind !== "row") {
      const items: string[] = [];
      while (i + 1 < blocks.length && (blocks[i + 1]!.kind === "li" || blocks[i + 1]!.kind === "p") && blocks[i + 1]!.text.length <= 120 && !looksLikeSection(blocks[i + 1]!.text) && items.length < 40) { i++; items.push(blocks[i]!.text.replace(/^[\u2022\-–•\s]+/, "").replace(/[,;\s]+$/, "")); if (items.join(", ").length > 160 || /[.]$/.test(blocks[i]!.text.trim())) break; }
      if (items.length) { out.push({ kind: "p", level: -1, text: items.join(", ") }); continue; }
    }
    if (b.kind === "p" && looksLikeSection(b.text)) { out.push({ kind: "h", level: 3, text: b.text.trim().replace(/[:.]$/, "") }); continue; }
    out.push(b);
  }
  return out;
}

/** Text rendering of a Word manuscript, one block per paragraph. */
function drawText(doc: PDFDocument, f: Fonts, d: StampData, blocks: DocxBlock[]) {
  const [PW, PH] = A4;
  const MX = 64, TOP = PH - 64, BOT = 64, TW = PW - 2 * MX;
  let page = doc.addPage(A4); let y = TOP;
  blocks = normalizeBlocks(blocks);
  const need = (h: number) => { if (y - h < BOT) { if (doc.getPageCount() > 450) return false; page = doc.addPage(A4); y = TOP; } return true; };
  for (const b of blocks) {
    if (b.kind === "p" && b.level === -1) { // Keywords: bold label, then all keywords on one horizontal line
      const label = "Keywords:", lw = width(f, label, 10.5, "bold") + 5;
      const kl = wrap(f, b.text, 10.5, "regular", TW - lw);
      if (!need(16 * Math.min(kl.length, 2))) break;
      page.drawText(label, { x: MX, y: y - 10.5, size: 10.5, font: pick(f, label, "bold"), color: INK });
      for (const ln of kl) { if (!need(16)) break; page.drawText(ln, { x: MX + lw, y: y - 10.5, size: 10.5, font: pick(f, ln, "regular"), color: INK }); y -= 15.5; }
      y -= 7; continue;
    }
    const size = b.kind === "h" ? 13 : 10.5, w: W = b.kind === "h" ? "bold" : "regular", lead = size * 1.45;
    const indent = b.kind === "li" ? 14 + b.level * 14 : 0;
    const lines = wrap(f, (b.kind === "li" ? "• " : "") + b.text, size, w, TW - indent);
    if (b.kind === "h") y -= 8;
    if (!need(lead * Math.min(lines.length, 3))) break;
    for (const ln of lines) {
      if (!need(lead)) break;
      page.drawText(ln, { x: MX + indent, y: y - size, size, font: pick(f, ln, w), color: INK }); y -= lead;
    }
    y -= b.kind === "li" ? 2 : 7;
  }
  void d;
}

export async function renderStampedArticle(d: StampData, source: Uint8Array, docxBlocks?: DocxBlock[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const f = await loadFonts(out);
  out.setTitle(d.title); out.setAuthor(d.authors.map((a) => a.name).join(", ")); out.setSubject(`${PLATFORM_NAME} ${d.paperlyId} v${d.version}`);
  out.setKeywords([d.paperlyId, ...(d.doi ? [d.doi] : [])]); out.setProducer(PLATFORM_NAME); out.setCreator(PLATFORM_NAME);
  const gen = new Date(d.generatedAt); if (Number.isFinite(gen.getTime())) { out.setCreationDate(gen); out.setModificationDate(gen); }

  await drawCover(out, f, d);
  const sheet = out.addPage(A4);
  drawSheet(out, sheet, f, d);
  const front = out.getPageCount();

  if (d.sourceKind === "pdf") {
    let src: PDFDocument;
    try { src = await PDFDocument.load(source); } catch { throw new Error("The PDF could not be read to add the record sheet. It may be encrypted or damaged."); }
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
  } else {
    drawText(out, f, d, docxBlocks ?? []);
  }
  for (const p of out.getPages().slice(front)) stampMargin(p, f, d);
  // Page numbers, bottom right of every page.
  const all = out.getPages();
  all.forEach((p, i) => {
    if (p.getRotation().angle % 360 !== 0) return;
    const t = `Page ${i + 1} of ${all.length}`;
    const { x, y, width: cw } = p.getCropBox();
    p.drawText(t, { x: x + cw - 36 - f.regular.widthOfTextAtSize(t, 8.5), y: y + 18, size: 8.5, font: f.regular, color: rgb(0.25, 0.25, 0.28) });
  });
  return out.save({ useObjectStreams: false });
}

