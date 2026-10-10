import { PDFDocument, PDFName, PDFString, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fontBase64, loraRegularBase64, loraBoldBase64, backgroundBase64 } from "@/assets/certificate-resources";
import { PLATFORM_NAME } from "./constants";
import { CERTIFICATE_TITLES, CERT_H, CERT_W, layoutCertificate, type CertificateData, type Weight } from "./certificate-layout";

export type { CertificateData } from "./certificate-layout";

/** Landscape page with the same 3:2 proportion as the template. 1 template pixel = PAGE_W / CERT_W points. */
const PAGE_W = 900, PAGE_H = (900 * CERT_H) / CERT_W, K = PAGE_W / CERT_W;

const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const hex = (value: string) => rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);

/** The certificate PDF. Recorded details are immutable; the output is deterministic for the same input. */
export async function renderCertificatePdf(d: CertificateData): Promise<Uint8Array> {
  if (!d.recipientName.trim() || !d.certificateId.trim() || !d.articleId.trim()) throw new Error("Certificate identity is incomplete");
  const fixed = new Date(d.issuedAt);
  if (!Number.isFinite(fixed.getTime())) throw new Error("Invalid issue date");

  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  doc.setCreationDate(fixed); doc.setModificationDate(fixed);
  doc.setTitle(`${CERTIFICATE_TITLES[d.type]} ${d.certificateId}`); doc.setProducer(PLATFORM_NAME); doc.setCreator(PLATFORM_NAME);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawImage(await doc.embedJpg(bytes(backgroundBase64)), { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  // Lora for Latin and Cyrillic; DejaVu Serif only for a string that has a character Lora lacks (e.g. Greek).
  const fonts: Record<Weight, PDFFont> = { regular: await doc.embedFont(bytes(loraRegularBase64), { subset: true }), bold: await doc.embedFont(bytes(loraBoldBase64), { subset: true }) };
  const fallback = await doc.embedFont(bytes(fontBase64), { subset: true });
  const covered: Record<Weight, Set<number>> = { regular: new Set(fonts.regular.getCharacterSet()), bold: new Set(fonts.bold.getCharacterSet()) };
  const pick = (text: string, weight: Weight) => [...text].every(ch => covered[weight].has(ch.codePointAt(0)!) || /\s/.test(ch)) ? fonts[weight] : fallback;
  const measure = (text: string, size: number, weight: Weight) => pick(text, weight).widthOfTextAtSize(text, size);

  const { ops, link } = layoutCertificate(d, measure);
  const Y = (y: number) => PAGE_H - y * K;
  for (const op of ops) {
    if (op.kind === "text") {
      const x = op.anchor === "start" ? op.x : op.x - measure(op.text, op.size, op.weight) / (op.anchor === "middle" ? 2 : 1);
      page.drawText(op.text, { x: x * K, y: Y(op.y), size: op.size * K, font: pick(op.text, op.weight), color: hex(op.color) });
    } else if (op.kind === "line") {
      page.drawLine({ start: { x: op.x1 * K, y: Y(op.y1) }, end: { x: op.x2 * K, y: Y(op.y2) }, thickness: op.width * K, color: hex(op.color) });
    } else {
      const n = op.modules.length, cell = op.size / (n + 8);
      page.drawRectangle({ x: op.x * K, y: Y(op.y + op.size), width: op.size * K, height: op.size * K, color: hex(op.paper) });
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (op.modules[r]![c]) {
        page.drawRectangle({ x: (op.x + (c + 4) * cell) * K, y: Y(op.y + (r + 5) * cell), width: cell * K, height: cell * K, color: hex(op.ink) });
      }
    }
  }
  // The QR block and address are a clickable link to the same verification URL.
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [link.x * K, Y(link.y + link.h), (link.x + link.w) * K, Y(link.y)], Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(d.verificationUrl) },
  }))]));
  return doc.save({ useObjectStreams: false });
}

/** Truthful, plain statements about a record. "Peer reviewed" appears only for a journal article with completed reviews recorded. */
export function describeRecord(publicationType: string, peerReviewed: boolean, status: string) {
  const recordType = publicationType === "JOURNAL_ARTICLE" ? "Journal article" : publicationType === "PREPRINT" ? "Preprint" : "Repository record";
  const reviewStatement = publicationType === "JOURNAL_ARTICLE" && peerReviewed
    ? "Peer reviewed (completed reviews recorded)"
    : publicationType === "JOURNAL_ARTICLE" ? "Peer review not recorded"
    : "Not peer reviewed (automated screening and editorial check only)";
  const publicationStatus = ({ PUBLISHED: "Published", CORRECTED: "Published, corrected", RETRACTED: "Retracted" } as Record<string, string>)[status] ?? "Not published";
  return { recordType, reviewStatement, publicationStatus };
}
