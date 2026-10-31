import { PDFDocument, PDFName, PDFString, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import qrcode from "qrcode-generator";
import { fontBase64, loraRegularBase64, loraBoldBase64 } from "@/assets/certificate-resources";
import { PLATFORM_NAME } from "./constants";
import { logoPngBase64, LOGO_ASPECT } from "@/assets/logo-resources";
import { JOURNAL_SUBTITLE, journalIssueLine, orderTeacherFirst, numberAffiliations, looksLikeSection, KEYWORDS_INLINE_RE } from "./journal";
import type { DocxBlock } from "./docx-html";

/**
 * The author's download of a published record: one Paperly front page (journal cover and record details together) is put in front of the file and a one-line stamp runs up the left margin
 * of every page. The author's own pages are not changed in any other way (a PDF keeps its pages, text, images and links).
 *
 * Design follows common practice: arXiv stamps "identifier, version, date" in the left margin of each page; SSRN stamps a link back to the
 * record on each page; Crossref asks that a DOI is shown as a full https://doi.org/ link, never as "doi:" text.
 * Paperly's own identifiers are never presented as DOIs, and the sheet says only what the record truthfully is (review status comes from the record).
 */

/** Bump when the sheet layout changes, so cached downloads are regenerated. */
export const STAMP_LAYOUT_VERSION = 6;

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

/**
 * The single Paperly front page: masthead, journal title block (title, numbered authors, affiliations, abstract, keywords) and the record details
 * (identifiers, version, status, review, licence, certificates, checksum, ORCID iDs, how to cite, QR and the statement of what was added).
 * It carries everything the former cover and record sheet carried, on one page. The type scale is chosen so the whole page fits; only if a very
 * long abstract cannot fit even at the smallest readable size does the remainder continue on a second page, so nothing is ever cut.
 */
async function drawFront(doc: PDFDocument, f: Fonts, d: StampData) {
  const [PW, PH] = A4;
  const MX = 40, TW = PW - 2 * MX, BOT = 34, TOP = PH - 36;
  const logo = await doc.embedPng(bytes(logoPngBase64));
  const ordered = orderTeacherFirst(d.authors, (a) => a.affiliation);
  const affs = numberAffiliations(ordered, (a) => a.affiliation);
  const issue = journalIssueLine(d.publishedAt ?? d.generatedAt);
  const host = d.articleUrl.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  const COLS = 3, GAP = 14, CW = (TW - GAP * (COLS - 1)) / COLS;

  const pass = (k: number, dry: boolean): boolean => {
    let page: PDFPage | null = dry ? null : doc.addPage(A4);
    let y = TOP; let spilled = false;
    const S = (n: number) => n * k;
    const text = (t: string, x: number, yy: number, size: number, w: W = "regular", color = INK) => { if (page) page.drawText(t, { x, y: yy, size, font: pick(f, t, w), color }); };
    const center = (t: string, yy: number, size: number, w: W = "regular", color = INK) => text(t, (PW - width(f, t, size, w)) / 2, yy, size, w, color);
    const rule = (yy: number, thickness: number, color = INK) => { if (page) page.drawLine({ start: { x: MX, y: yy }, end: { x: PW - MX, y: yy }, thickness, color }); };
    const lnk = (x: number, yy: number, w: number, h: number, url: string) => { if (page) link(doc, page, x, yy, w, h, url); };
    const room = (h: number) => { if (y - h < BOT) { spilled = true; if (!dry) page = doc.addPage(A4); y = PH - 48; } };

    // Masthead: seal, journal name, issue line; address and tag on the right.
    const seal = 50, tx = MX + seal + 12;
    if (page) page.drawImage(logo, { x: MX, y: y - seal, width: seal, height: seal / LOGO_ASPECT });
    text(PLATFORM_NAME.toUpperCase(), tx, y - 19, 19, "bold", ACCENT);
    let sub = 8.5; while (sub > 5.5 && width(f, JOURNAL_SUBTITLE, sub, "bold") > TW - seal - 12 - 140) sub -= 0.25;
    text(JOURNAL_SUBTITLE, tx, y - 32, sub, "bold");
    text(issue, tx, y - 44, 8.5, "regular", MUTED);
    const tag = "RECORD SHEET";
    text(tag, PW - MX - width(f, tag, 7.5, "bold"), y - 10, 7.5, "bold", MUTED);
    text(host, PW - MX - width(f, host, 9, "bold"), y - 24, 9, "bold");
    y -= seal + 8; rule(y, 1.5, ACCENT); y -= 10;

    if (d.status === "RETRACTED") {
      if (page) page.drawRectangle({ x: MX, y: y - 18, width: TW, height: 18, color: rgb(0.99, 0.92, 0.92) });
      text("THIS RECORD HAS BEEN RETRACTED. It remains public so readers can see what was withdrawn and why.", MX + 6, y - 12.5, 8, "bold", RED);
      y -= 26;
    } else if (d.status === "CORRECTED") {
      text("This record has been corrected after publication. See the notices on its Paperly page.", MX, y - 9, 8, "bold", MUTED);
      y -= 18;
    }
    y -= 6;

    // Title (capitals, centred).
    const tsz = S(d.title.length > 160 ? 11.5 : d.title.length > 90 ? 13 : 15);
    for (const ln of wrap(f, d.title.toUpperCase(), tsz, "bold", TW).slice(0, 6)) { room(tsz * 1.3); center(ln, y - tsz, tsz, "bold"); y -= tsz * 1.3; }
    y -= S(7);

    // Authors: teacher first, each with a number, bold, centred.
    const SZ = S(11), SUP = S(7);
    type Seg = { name: string; num: string; w: number };
    const segs: Seg[] = ordered.map((a, i) => ({ name: a.name, num: String(i + 1), w: 0 }));
    segs.forEach((g) => { g.w = width(f, g.name, SZ, "bold") + width(f, g.num, SUP, "bold") + width(f, ", ", SZ, "bold"); });
    const rows: Seg[][] = []; let row: Seg[] = []; let rw = 0;
    for (const g of segs) { if (row.length && rw + g.w > TW) { rows.push(row); row = []; rw = 0; } row.push(g); rw += g.w; }
    if (row.length) rows.push(row);
    for (const r of rows) {
      room(SZ * 1.7);
      const total = r.reduce((a, g) => a + g.w, 0) - width(f, ", ", SZ, "bold");
      let x = (PW - total) / 2;
      r.forEach((g, i) => {
        text(g.name, x, y - SZ, SZ, "bold"); x += width(f, g.name, SZ, "bold");
        text(g.num, x, y - SZ + S(4), SUP, "bold"); x += width(f, g.num, SUP, "bold");
        if (i < r.length - 1) { text(", ", x, y - SZ, SZ, "bold"); x += width(f, ", ", SZ, "bold"); }
      });
      y -= SZ * 1.65;
    }
    y -= S(2);
    const AS = S(8.5);
    for (const g of affs) {
      const label = g.numbers.join(",");
      const lw = width(f, label, S(6.5), "regular") + 3;
      const lines = wrap(f, g.text, AS, "regular", TW - lw);
      room(AS * 1.35 * lines.length);
      text(label, MX, y - AS + S(3), S(6.5), "regular");
      for (const ln of lines) { text(ln, MX + lw, y - AS, AS, "regular"); y -= AS * 1.35; }
    }
    y -= S(4); rule(y, 0.75); y -= S(11);

    // Abstract and keywords.
    const BS = S(9.3);
    if (d.abstract?.trim()) {
      room(S(30)); text("Abstract", MX, y - S(11), S(11), "bold"); y -= S(18);
      for (const ln of wrap(f, d.abstract.trim(), BS, "regular", TW)) { room(BS * 1.4); text(ln, MX, y - BS, BS, "regular"); y -= BS * 1.4; }
      y -= S(5);
    }
    if (d.keywords && d.keywords.length) {
      const label = "Keywords:", lw = width(f, label, BS, "bold") + 5;
      const kl = wrap(f, d.keywords.join(", "), BS, "regular", TW - lw);
      room(BS * 1.4 * Math.min(kl.length, 2));
      text(label, MX, y - BS, BS, "bold");
      for (const ln of kl) { room(BS * 1.4); text(ln, MX + lw, y - BS, BS, "regular"); y -= BS * 1.4; }
    }
    y -= S(6); rule(y, 0.5, RULE); y -= S(8);

    // Record details in a three-column grid. Returns the height used.
    type Cell = { label: string; value: string; size?: number; url?: string; w?: W };
    const cellH = (c: Cell) => { const size = S(c.size ?? 8.5); return S(11) + wrap(f, c.value, size, c.w ?? "regular", CW).length * (size + S(2.5)) + S(5); };
    const drawCell = (c: Cell, x: number, top: number) => {
      const size = S(c.size ?? 8.5); let cy = top;
      text(c.label.toUpperCase(), x, cy - S(6), S(6.2), "bold", MUTED); cy -= S(11);
      for (const ln of wrap(f, c.value, size, c.w ?? "regular", CW)) {
        text(ln, x, cy - size + S(1.5), size, c.w ?? "regular", c.url ? ACCENT : INK);
        if (c.url) lnk(x, cy - size, Math.min(width(f, ln, size, c.w ?? "regular"), CW), size + 3, c.url);
        cy -= size + S(2.5);
      }
    };
    const grid = (cells: Cell[]) => {
      for (let i = 0; i < cells.length; i += COLS) {
        const rowCells = cells.slice(i, i + COLS);
        const h = Math.max(...rowCells.map(cellH));
        room(h);
        rowCells.forEach((c, j) => drawCell(c, MX + j * (CW + GAP), y));
        y -= h;
      }
    };
    const cells: Cell[] = [
      { label: "Paperly ID", value: d.paperlyId, size: 11, w: "bold", url: d.articleUrl },
      ...(d.legacyId ? [{ label: "Previous ID", value: d.legacyId }] : []),
      { label: "DOI", value: d.doi ? `https://doi.org/${d.doi}` : "Not registered", ...(d.doi ? { url: `https://doi.org/${d.doi}` } : {}) },
      { label: "Version", value: d.versionIdentifier ? `${d.version}  ·  ${d.versionIdentifier}` : d.version },
      { label: "Published", value: fmtDate(d.publishedAt) },
      { label: "Status", value: STATUS_LABEL[d.status] ?? d.status },
      { label: "Record type", value: d.recordType },
      { label: "Review", value: d.reviewStatement },
      ...(d.license ? [{ label: "Licence", value: d.license }] : []),
    ];
    grid(cells);

    // Certificates: one small cell each, three across.
    const certs = d.certificates.slice(0, 10);
    if (certs.length === 0) grid([{ label: "Certificates", value: "None issued for this record" }]);
    else {
      room(S(14)); text("CERTIFICATES", MX, y - S(6), S(6.2), "bold", MUTED); y -= S(11);
      const ch = (c: StampCertificate) => S(11) + wrap(f, `${CERT_LABEL[c.type] ?? c.type}, ${c.recipient}${c.status !== "VALID" ? ` (${c.status.toLowerCase()})` : ""}`, S(7), "regular", CW).length * S(9) + S(4);
      for (let i = 0; i < certs.length; i += COLS) {
        const rc = certs.slice(i, i + COLS), h = Math.max(...rc.map(ch));
        room(h);
        rc.forEach((c, j) => {
          const x = MX + j * (CW + GAP);
          text(c.id, x, y - S(8.5), S(8.5), "bold", ACCENT); lnk(x, y - S(10.5), Math.min(width(f, c.id, S(8.5), "bold"), CW), S(12), c.url);
          let cy = y - S(11);
          for (const ln of wrap(f, `${CERT_LABEL[c.type] ?? c.type}, ${c.recipient}${c.status !== "VALID" ? ` (${c.status.toLowerCase()})` : ""}`, S(7), "regular", CW)) { text(ln, x, cy - S(7), S(7), "regular", MUTED); cy -= S(9); }
        });
        y -= h;
      }
      if (d.certificates.length > 10) { room(S(10)); text(`and ${d.certificates.length - 10} more, listed on the Paperly page`, MX, y - S(7), S(7), "regular", MUTED); y -= S(11); }
    }
    // Checksum.
    y -= S(5);
    const shaSize = S(6.8);
    room(S(11) + shaSize + 4);
    text("FILE SHA-256 (ORIGINAL FILE)", MX, y - S(6), S(6.2), "bold", MUTED); y -= S(11);
    for (const ln of wrap(f, d.fileSha256, shaSize, "regular", TW)) { text(ln, MX, y - shaSize + 1.5, shaSize, "regular"); y -= shaSize + S(2.5); }
    y -= S(3);

    // ORCID iDs (only those verified through ORCID sign-in).
    const orc = d.authors.filter((a) => a.orcid);
    if (orc.length) {
      const os = S(7);
      for (const a of orc.slice(0, 12)) {
        const t = `${a.name}: https://orcid.org/${a.orcid}`;
        for (const ln of wrap(f, t, os, "regular", TW)) { room(os + 3); text(ln, MX, y - os, os, "regular", MUTED); lnk(MX, y - os - 1, Math.min(width(f, ln, os, "regular"), TW), os + 3, `https://orcid.org/${a.orcid}`); y -= os + S(2.5); }
      }
      room(os + 3); text("ORCID iDs shown here were verified through ORCID sign-in.", MX, y - os, os, "regular", MUTED); y -= os + S(5);
    }

    // How to cite.
    if (d.citation) {
      y -= S(3);
      const cs = S(8);
      room(S(11) + cs * 1.4); text("HOW TO CITE", MX, y - S(6), S(6.2), "bold", MUTED); y -= S(11);
      for (const ln of wrap(f, d.citation, cs, "regular", TW)) { room(cs * 1.4); text(ln, MX, y - cs, cs, "regular"); y -= cs * 1.35; }
      y -= S(5);
    }

    // QR to the record and the plain statement of what was added.
    const note = [
      `Scan or open ${d.articleUrl.replace(/^https?:\/\//, "")} to see the record, its version history and any notices.`,
      d.sourceKind === "docx"
        ? "The manuscript was uploaded as a Word file. The pages after this sheet are a text rendering of it (pictures are included; complex layout is simplified); the original Word file is kept unchanged on the Paperly page."
        : "The pages after this sheet are the author's PDF, unchanged except for the one-line stamp in the left margin.",
      "This sheet and the margin stamp were added by Paperly. They are not part of the manuscript. A certificate ID can be checked at the verification address behind it.",
      `Prepared ${fmtDate(d.generatedAt)}.`,
    ].join("\n");
    const ns = S(7.4), QS = 62;
    const noteLines = wrap(f, note, ns, "regular", TW - QS - 14);
    const bh = Math.max(QS, noteLines.length * (ns + 2.2)) + 4;
    room(bh); rule(y, 0.5, RULE); y -= 6;
    if (page) {
      const qr = qrcode(0, "M"); qr.addData(d.articleUrl); qr.make();
      const n = qr.getModuleCount(), cell = QS / n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) page.drawRectangle({ x: MX + c * cell, y: y - QS + (n - 1 - r) * cell, width: cell, height: cell, color: INK });
    }
    lnk(MX, y - QS, QS, QS, d.articleUrl);
    let ny = y;
    for (const ln of noteLines) { text(ln, MX + QS + 14, ny - ns, ns, "regular", MUTED); ny -= ns + 2.2; }
    lnk(MX + QS + 14, y - ns - 2, TW - QS - 14, ns + 4, d.articleUrl);
    y -= bh;
    return spilled;
  };

  for (const k of [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76]) if (!pass(k, true)) { pass(k, false); return; }
  pass(0.76, false);
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
    if (b.kind === "img") { out.push(b); continue; }
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
async function drawText(doc: PDFDocument, f: Fonts, d: StampData, blocks: DocxBlock[]) {
  const [PW, PH] = A4;
  const MX = 64, TOP = PH - 64, BOT = 64, TW = PW - 2 * MX;
  let page = doc.addPage(A4); let y = TOP;
  blocks = normalizeBlocks(blocks);
  // Consecutive table rows become one table block (rows separated by newline, cells by "  |  ").
  blocks = blocks.reduce<DocxBlock[]>((acc, b) => {
    const last = acc[acc.length - 1];
    if (b.kind === "row" && last && last.kind === "row") last.text += `\n${b.text}`; else acc.push(b.kind === "row" ? { ...b } : b);
    return acc;
  }, []);
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
    if (b.kind === "img") { // A picture from the Word file (PNG or JPEG), scaled to the text width; other formats are skipped.
      try {
        const m = /^data:image\/([a-z+]+);base64,(.+)$/.exec(b.src ?? "");
        if (m && (m[1] === "png" || m[1] === "jpeg" || m[1] === "jpg")) {
          const raw = bytes(m[2]!);
          const img = m[1] === "png" ? await doc.embedPng(raw) : await doc.embedJpg(raw);
          const sc = Math.min(1, TW / img.width, 340 / img.height);
          const w = img.width * sc, h = img.height * sc;
          if (!need(h + 10)) break;
          page.drawImage(img, { x: MX + (TW - w) / 2, y: y - h, width: w, height: h });
          y -= h + 10;
        }
      } catch { /* an unreadable picture is skipped; the text is unaffected */ }
      continue;
    }
    if (b.kind === "row") { // A real table: bordered cells, columns sized by content, first row as a header, rows kept whole across pages.
      const rowsT = b.text.split("\n").map((r) => r.split("  |  "));
      const n = Math.max(...rowsT.map((r) => r.length));
      const FS = n > 6 ? 7.5 : 9, PAD = 4, lead = FS * 1.3;
      const weights = Array.from({ length: n }, (_, c) => Math.max(6, Math.min(40, Math.max(...rowsT.map((r) => (r[c] ?? "").length)))));
      const wsum = weights.reduce((a, x) => a + x, 0);
      const colW = weights.map((x) => (TW * x) / wsum);
      let stop = false;
      rowsT.forEach((r, ri) => {
        if (stop) return;
        const head = ri === 0 && rowsT.length > 1, rw: W = head ? "bold" : "regular";
        const cellLines = Array.from({ length: n }, (_, c) => wrap(f, r[c] ?? "", FS, rw, colW[c]! - 2 * PAD));
        const h = Math.max(...cellLines.map((l) => l.length)) * lead + 2 * PAD;
        if (!need(h)) { stop = true; return; }
        let x = MX;
        cellLines.forEach((lines, c) => {
          page.drawRectangle({ x, y: y - h, width: colW[c]!, height: h, borderColor: rgb(0.6, 0.6, 0.64), borderWidth: 0.5, ...(head ? { color: rgb(0.93, 0.93, 0.95) } : {}) });
          lines.forEach((ln, i) => page.drawText(ln, { x: x + PAD, y: y - PAD - FS - i * lead + 1.5, size: FS, font: pick(f, ln, rw), color: INK }));
          x += colW[c]!;
        });
        y -= h;
      });
      y -= 10; if (stop) break; continue;
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

/** A Word manuscript as a plain text-rendering PDF, for deposit (Zenodo takes a PDF). No Paperly cover, record sheet or margin stamp is added,
 *  so the deposited file is just the manuscript text. Same input gives the same bytes (dates come from `d.generatedAt`). */
export async function renderDocxAsPdf(d: StampData, docxBlocks: DocxBlock[]): Promise<Uint8Array> {
  if (!docxBlocks.some((b) => b.text.trim())) throw new Error("The Word manuscript has no readable text to convert to PDF");
  const out = await PDFDocument.create();
  const f = await loadFonts(out);
  out.setTitle(d.title); out.setAuthor(d.authors.map((a) => a.name).join(", ")); out.setProducer(PLATFORM_NAME); out.setCreator(PLATFORM_NAME);
  const gen = new Date(d.generatedAt); if (Number.isFinite(gen.getTime())) { out.setCreationDate(gen); out.setModificationDate(gen); }
  await drawText(out, f, d, docxBlocks);
  const all = out.getPages();
  all.forEach((p, i) => {
    const t = `${i + 1} / ${all.length}`;
    const { x, y, width: cw } = p.getCropBox();
    p.drawText(t, { x: x + cw / 2 - f.regular.widthOfTextAtSize(t, 8.5) / 2, y: y + 30, size: 8.5, font: f.regular, color: rgb(0.25, 0.25, 0.28) });
  });
  return out.save({ useObjectStreams: false });
}

export async function renderStampedArticle(d: StampData, source: Uint8Array, docxBlocks?: DocxBlock[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const f = await loadFonts(out);
  out.setTitle(d.title); out.setAuthor(d.authors.map((a) => a.name).join(", ")); out.setSubject(`${PLATFORM_NAME} ${d.paperlyId} v${d.version}`);
  out.setKeywords([d.paperlyId, ...(d.doi ? [d.doi] : [])]); out.setProducer(PLATFORM_NAME); out.setCreator(PLATFORM_NAME);
  const gen = new Date(d.generatedAt); if (Number.isFinite(gen.getTime())) { out.setCreationDate(gen); out.setModificationDate(gen); }

  await drawFront(out, f, d); // one Paperly page (cover and record sheet combined)
  const front = out.getPageCount();

  if (d.sourceKind === "pdf") {
    let src: PDFDocument;
    try { src = await PDFDocument.load(source); } catch { throw new Error("The PDF could not be read to add the record sheet. It may be encrypted or damaged."); }
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
  } else {
    await drawText(out, f, d, docxBlocks ?? []);
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


/**
 * Affiliations written in the Word manuscript itself, e.g. "1. LECTURER, INTERNATIONAL MEDICAL FACULTY, ..." and "2,3,4, STUDENTS, ...", found in the
 * opening blocks before Abstract/Introduction. Returns author number (1-based) -> affiliation text. Used only to fill authors whose record has none.
 */
export function docxAffiliations(blocks: DocxBlock[], authorCount: number): Map<number, string> {
  const out = new Map<number, string>();
  const tidy = (t: string) => { const x = t.trim().replace(/[.\s]+$/, ""); return x === x.toUpperCase() ? x.toLowerCase().replace(/(^|[\s,(-])([a-z])/g, (_m, a: string, c: string) => a + c.toUpperCase()) : x; };
  for (const b of blocks.slice(0, 30)) {
    if (b.kind === "img") continue;
    const t = b.text.trim();
    if (/^(\d+\.?\s*)?(abstract|keywords?|introduction)\b/i.test(t)) break;
    const m = /^(\d+(?:\s*,\s*\d+)*)\s*[.,)]*\s*([A-Za-z].{8,})$/.exec(t);
    if (!m || !/,/.test(m[2]!) || looksLikeSection(t)) continue;
    for (const n of m[1]!.split(",").map((x) => Number(x.trim()))) if (n >= 1 && n <= authorCount && !out.has(n)) out.set(n, tidy(m[2]!));
  }
  return out;
}
