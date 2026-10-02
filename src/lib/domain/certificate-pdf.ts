import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import qrcode from "qrcode-generator";
import { CERTIFICATE_DISCLAIMER, CERTIFICATE_TEXT, PLATFORM_NAME } from "./constants";

export interface CertificateData {
  certificateId: string;
  type: "SUBMISSION" | "PUBLICATION" | "PEER_REVIEW" | "AUTHOR_RECORD";
  recipientName: string;
  authorRole: string;
  paperTitle: string;
  articleId: string;
  doi: string | null;
  publicationDate: string | null;
  issuedAt: string;
  verificationUrl: string;
}

const TITLES: Record<string, string> = {
  SUBMISSION: "Certificate of Submission",
  PUBLICATION: "Certificate of Publication",
  PEER_REVIEW: "Certificate of Peer Review",
  AUTHOR_RECORD: "Certificate of Author Record",
};

function wrap(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > max && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
// WinAnsi-safe text for standard fonts.
const safe = (s: string) => s.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/** Deterministic A4 certificate: fixed metadata dates so the same record yields the same bytes. */
export async function renderCertificatePdf(d: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fixed = new Date(d.issuedAt);
  doc.setCreationDate(fixed); doc.setModificationDate(fixed);
  doc.setTitle(`${TITLES[d.type]} ${d.certificateId}`); doc.setProducer(PLATFORM_NAME); doc.setCreator(PLATFORM_NAME);
  const page = doc.addPage([595.28, 841.89]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.13, 0.2), muted = rgb(0.4, 0.42, 0.46), accent = rgb(0.13, 0.33, 0.28);
  const W = 595.28, M = 56;

  page.drawRectangle({ x: 28, y: 28, width: W - 56, height: 841.89 - 56, borderColor: accent, borderWidth: 1.2 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: 841.89 - 68, borderColor: accent, borderWidth: 0.4 });

  let y = 770;
  page.drawText(PLATFORM_NAME.toUpperCase(), { x: M, y, size: 12, font: sans, color: accent });
  page.drawText("Scholarly research repository", { x: M, y: y - 14, size: 9, font: sans, color: muted });
  y -= 70;
  const title = TITLES[d.type] ?? "Certificate";
  page.drawText(title, { x: (W - serifBold.widthOfTextAtSize(title, 28)) / 2, y, size: 28, font: serifBold, color: ink });
  y -= 50;
  const pre = "This is to record that";
  page.drawText(pre, { x: (W - serif.widthOfTextAtSize(pre, 12)) / 2, y, size: 12, font: serif, color: muted });
  y -= 36;
  const name = safe(d.recipientName);
  page.drawText(name, { x: (W - serifBold.widthOfTextAtSize(name, 24)) / 2, y, size: 24, font: serifBold, color: ink });
  y -= 14;
  page.drawLine({ start: { x: 150, y }, end: { x: W - 150, y }, thickness: 0.5, color: muted });
  y -= 24;
  const role = `Recorded role: ${safe(d.authorRole)}`;
  page.drawText(role, { x: (W - sans.widthOfTextAtSize(role, 10)) / 2, y, size: 10, font: sans, color: muted });
  y -= 36;
  for (const line of wrap(`"${safe(d.paperTitle)}"`, serifBold, 15, W - 2 * M - 40)) {
    page.drawText(line, { x: (W - serifBold.widthOfTextAtSize(line, 15)) / 2, y, size: 15, font: serifBold, color: ink });
    y -= 20;
  }
  y -= 14;
  for (const line of wrap(CERTIFICATE_TEXT[d.type] ?? "", serif, 11, W - 2 * M)) {
    page.drawText(line, { x: M, y, size: 11, font: serif, color: ink });
    y -= 15;
  }
  y -= 20;
  const rows: Array<[string, string]> = [
    ["Certificate ID", d.certificateId],
    ["Article ID", d.articleId],
    ["DOI", d.doi ?? "Not registered"],
    ["Publication date", d.publicationDate ? d.publicationDate.slice(0, 10) : "Not published"],
    ["Issue date", d.issuedAt.slice(0, 10)],
  ];
  for (const [k, v] of rows) {
    page.drawText(k, { x: M, y, size: 9.5, font: sans, color: muted });
    page.drawText(safe(v), { x: M + 110, y, size: 9.5, font: sans, color: ink });
    y -= 15;
  }

  // QR
  const qr = qrcode(0, "M"); qr.addData(d.verificationUrl); qr.make();
  const n = qr.getModuleCount(), size = 110, cell = size / n, qx = W - M - size, qy = 150;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) page.drawRectangle({ x: qx + c * cell, y: qy + (n - 1 - r) * cell, width: cell, height: cell, color: ink });
  }
  page.drawText("Scan to verify", { x: qx + 22, y: qy - 12, size: 8, font: sans, color: muted });

  page.drawText("Verify this certificate at:", { x: M, y: 220, size: 9, font: sans, color: muted });
  page.drawText(safe(d.verificationUrl), { x: M, y: 206, size: 9, font: sans, color: accent });
  page.drawText(`Issued by ${PLATFORM_NAME} (platform record, electronically generated).`, { x: M, y: 180, size: 9, font: sans, color: ink });
  page.drawText("The document fingerprint (SHA-256) is shown on the verification page.", { x: M, y: 166, size: 8, font: sans, color: muted });

  let dy = 110;
  for (const line of wrap(CERTIFICATE_DISCLAIMER, sans, 7.5, W - 2 * M)) {
    page.drawText(line, { x: M, y: dy, size: 7.5, font: sans, color: muted }); dy -= 10;
  }
  return doc.save({ useObjectStreams: false });
}
