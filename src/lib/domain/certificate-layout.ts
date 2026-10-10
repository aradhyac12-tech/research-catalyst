import qrcode from "qrcode-generator";
import { CERTIFICATE_DISCLAIMER } from "./constants";

/**
 * One layout, two renderers. The PDF (pdf-lib) and the on-screen certificate (SVG) both draw the operations
 * returned by `layoutCertificate`, so what a person sees online is exactly what they download.
 * All coordinates are pixels of the 1536 x 1024 certificate template (`certificate-template.jpg`).
 */
export const CERT_W = 1536;
export const CERT_H = 1024;

export type CertificateType = "SUBMISSION" | "PUBLICATION" | "PEER_REVIEW" | "AUTHOR_RECORD";
export type Weight = "regular" | "bold";
/** Width in template pixels of `text` drawn at `size` pixels. */
export type Measure = (text: string, size: number, weight: Weight) => number;

export interface CertificateData {
  certificateId: string;
  type: CertificateType;
  recipientName: string;
  authorRole: string;
  paperTitle: string;
  articleId: string;
  doi: string | null;
  publicationDate: string | null;
  issuedAt: string;
  verificationUrl: string;
  /** Live facts about the record at the time the PDF is generated (not printed; kept for callers). */
  recordType?: string;
  reviewStatement?: string;
  publicationStatus?: string;
}

export type TextOp = { kind: "text"; text: string; x: number; y: number; size: number; weight: Weight; color: string; anchor: "start" | "middle" | "end" };
export type LineOp = { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: string };
export type QrOp = { kind: "qr"; x: number; y: number; size: number; modules: boolean[][]; ink: string; paper: string };
export type CertOp = TextOp | LineOp | QrOp;

export interface CertificateLayout { ops: CertOp[]; link: { x: number; y: number; w: number; h: number } }

export const CERTIFICATE_TITLES: Record<CertificateType, string> = {
  SUBMISSION: "Certificate of Submission",
  PUBLICATION: "Certificate of Publication",
  PEER_REVIEW: "Certificate of Peer Review",
  AUTHOR_RECORD: "Certificate of Author Record",
};

/** Sentences that surround the work title. They never claim more than the record does (see CERTIFICATE_DISCLAIMER). */
const COPY: Record<CertificateType, { intro: string; outro: string }> = {
  SUBMISSION: {
    intro: "has successfully submitted the research paper titled",
    outro: "to Paperly, the scholarly research repository, for the purpose of academic sharing and knowledge dissemination.",
  },
  PUBLICATION: {
    intro: "is recorded as an author of the research work published on Paperly, titled",
    outro: "published through Paperly, the scholarly research repository, on the publication date recorded below.",
  },
  PEER_REVIEW: {
    intro: "has completed a peer review assignment for the research work titled",
    outro: "through the Paperly review workflow, as recorded by the platform.",
  },
  AUTHOR_RECORD: {
    intro: "is recorded as an author of the research work titled",
    outro: "in the Paperly platform record, as recorded by the platform.",
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "08 Oct 2026". Always UTC, so a late-evening issue time never shifts to another day. */
export function formatCertificateDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid issue date");
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const INK = "#5a0d12";
export const GOLD = "#92601a";
const SLATE = "#2e3441";
const MUTED = "#5b5f68";
const CX = 769;

function wrap(measure: Measure, text: string, size: number, weight: Weight, maxW: number): string[] {
  const rows: string[] = []; let cur = "";
  const push = () => { if (cur.trim()) rows.push(cur.trim()); cur = ""; };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, size, weight) <= maxW) { cur = next; continue; }
    push();
    if (measure(word, size, weight) <= maxW) { cur = word; continue; }
    for (const ch of word) { // a single word wider than the line: break by character
      if (cur && measure(cur + ch, size, weight) > maxW) push();
      cur += ch;
    }
  }
  push();
  return rows;
}

function shrink(measure: Measure, text: string, size: number, min: number, weight: Weight, maxW: number): number {
  let s = size;
  while (s > min && measure(text, s, weight) > maxW) s -= 0.5;
  return s;
}

/** Largest size (from `size` down to `min`) at which `text` fits in at most `maxLines` lines; falls back to `min`, truncating with an ellipsis. */
function fitLines(measure: Measure, text: string, size: number, min: number, weight: Weight, maxW: number, maxLines: number) {
  for (let s = size; s >= min; s -= 0.5) {
    const rows = wrap(measure, text, s, weight, maxW);
    if (rows.length <= maxLines) return { size: s, rows };
  }
  const rows = wrap(measure, text, min, weight, maxW);
  const kept = rows.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (last && measure(`${last}…`, min, weight) > maxW) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return { size: min, rows: kept };
}

export function layoutCertificate(d: CertificateData, measure: Measure): CertificateLayout {
  if (!d.recipientName.trim() || !d.certificateId.trim() || !d.articleId.trim()) throw new Error("Certificate identity is incomplete");
  const issueDate = formatCertificateDate(d.issuedAt);
  const ops: CertOp[] = [];
  const text = (t: string, x: number, y: number, size: number, color: string, anchor: TextOp["anchor"] = "middle", weight: Weight = "regular") =>
    ops.push({ kind: "text", text: t, x, y, size, weight, color, anchor });

  // Title, letter-spaced capitals.
  const title = CERTIFICATE_TITLES[d.type].toUpperCase();
  const tracked = (size: number) => [...title].reduce((w, ch) => w + measure(ch, size, "bold"), 0) + (title.length - 1) * size * 0.06;
  let ts = 58; while (ts > 24 && tracked(ts) > 940) ts -= 0.5;
  let tx = 775 - tracked(ts) / 2;
  for (const ch of title) { text(ch, tx, 284, ts, INK, "start", "bold"); tx += measure(ch, ts, "bold") + ts * 0.06; }

  // Recipient, above the rule at y=478.
  const NAME_W = 740;
  const oneLine = shrink(measure, d.recipientName, 58, 36, "regular", NAME_W);
  if (measure(d.recipientName, oneLine, "regular") <= NAME_W) text(d.recipientName, CX, 450, oneLine, INK);
  else {
    const f = fitLines(measure, d.recipientName, 36, 22, "regular", NAME_W, 2);
    f.rows.forEach((row, i) => text(row, CX, 418 + i * (f.size + 2), f.size, INK));
  }
  text(`Recorded role: ${d.authorRole}`, CX, 503, 16, MUTED);

  // Sentence, work title, sentence.
  const copy = COPY[d.type];
  text(copy.intro, CX, 531, 21, SLATE);
  // Work title: one line if it fits at a readable size, otherwise two, otherwise three (truncated with an ellipsis as a last resort).
  let work = fitLines(measure, d.paperTitle, 30, 22, "bold", 800, 1);
  if (work.rows.length !== 1 || measure(work.rows[0]!, work.size, "bold") > 800 || work.rows[0]!.endsWith("…")) {
    work = fitLines(measure, d.paperTitle, 26, 17, "bold", 800, 2);
    if (work.rows.length > 2 || work.rows[work.rows.length - 1]!.endsWith("…")) work = fitLines(measure, d.paperTitle, 20, 14, "bold", 800, 3);
  }
  const lh = work.size * 1.25;
  const first = ({ 1: 574, 2: 566, 3: 558 } as Record<number, number>)[work.rows.length] ?? 558;
  work.rows.forEach((row, i) => text(row, CX, first + i * lh, work.size, INK, "middle", "bold"));
  const outro = wrap(measure, copy.outro, 21, "regular", 740);
  outro.forEach((row, i) => text(row, CX, 640 + i * 32, 21, SLATE));
  const detail = [d.doi ? `DOI: ${d.doi}` : "DOI: not registered at issue", d.publicationDate ? `Publication date (UTC): ${d.publicationDate.slice(0, 10)}` : d.type === "SUBMISSION" ? "Submission record; not proof of acceptance" : null].filter(Boolean).join("   ·   ");
  text(detail, CX, 700, shrink(measure, detail, 15, 9, "regular", 760), MUTED);

  // Identity row, aligned to the labels baked into the template.
  const cols: Array<[string, number, number]> = [[d.certificateId, 382, 236], [d.articleId, 730, 180], [issueDate, 1011, 200]];
  for (const [value, x, w] of cols) text(value, x, 760, shrink(measure, value, 23, 10, "regular", w), SLATE, "start");

  // Verification: QR plate, corner brackets, short address.
  const qr = qrcode(0, "M"); qr.addData(d.verificationUrl); qr.make();
  const n = qr.getModuleCount();
  const modules = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  const px = 1290, py = 732, plate = 124;
  ops.push({ kind: "qr", x: px, y: py, size: plate, modules, ink: "#22090b", paper: "#fffdf7" });
  const bx0 = px - 8, by0 = py - 8, bx1 = px + plate + 8, by1 = py + plate + 8, bl = 20;
  for (const [x, y, dx, dy] of [[bx0, by0, 1, 1], [bx1, by0, -1, 1], [bx0, by1, 1, -1], [bx1, by1, -1, -1]] as const) {
    ops.push({ kind: "line", x1: x, y1: y, x2: x + dx * bl, y2: y, width: 2.5, color: GOLD });
    ops.push({ kind: "line", x1: x, y1: y, x2: x, y2: y + dy * bl, width: 2.5, color: GOLD });
  }
  const url = new URL(d.verificationUrl);
  const short = `${url.host}${url.pathname}`;
  text(short, 1405, 914, shrink(measure, short, 10.5, 6, "regular", 330), MUTED, "end");

  // Disclaimer.
  wrap(measure, CERTIFICATE_DISCLAIMER, 10.5, "regular", 980).forEach((row, i) => text(row, CX, 952 + i * 14, 10.5, MUTED));

  return { ops, link: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
}
