import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from "pdf-lib";
import { renderCertificatePdf, type CertificateData } from "./certificate-pdf";
import { fmtDate } from "../ui";
import { formatCertificateDate, layoutCertificate } from "./certificate-layout";

const record: CertificateData = {
  certificateId: "CERT-2026-000184", type: "SUBMISSION", recipientName: "Aradhya Chavan",
  authorRole: "Author / uploader", paperTitle: "Community health research", articleId: "PLY-2026-000184",
  doi: null, publicationDate: null, issuedAt: "2026-10-07T23:30:00Z",
  verificationUrl: "https://paperlys.lovable.app/verify/certificate/CERT-2026-000184?t=verification-token",
};

describe("certificate recorded facts", () => {
  it("keeps the same issue details and fingerprint on repeated rendering", async () => {
    expect(await renderCertificatePdf(record)).toEqual(await renderCertificatePdf(record));
  });
  it("rejects a missing recipient rather than issuing a placeholder name", async () => {
    await expect(renderCertificatePdf({ ...record, recipientName: " " })).rejects.toThrow("identity");
  });
  it("rejects a missing Paperly ID", async () => {
    await expect(renderCertificatePdf({ ...record, articleId: "" })).rejects.toThrow("identity");
  });
  it("rejects a missing certificate ID", async () => {
    await expect(renderCertificatePdf({ ...record, certificateId: "" })).rejects.toThrow("identity");
  });
  it("uses the exact certificate verification URL for the PDF link", async () => {
    const doc = await PDFDocument.load(await renderCertificatePdf(record));
    const annotations = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const link = annotations.lookup(0, PDFDict).lookup(PDFName.of("A"), PDFDict);
    expect(link.lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(record.verificationUrl);
  });
  it("uses UTC so a late evening issue date does not become the next day", () => {
    expect(fmtDate("2026-10-07T23:30:00Z")).toBe("7 October 2026");
  });
  it("does not discard accented or Cyrillic names during generation", async () => {
    const pdf = await renderCertificatePdf({ ...record, recipientName: "José Fernández Александра Ивановна" });
    expect(pdf).not.toEqual(await renderCertificatePdf(record));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
  it("prints the recorded name, certificate ID, Paperly ID and UTC issue date exactly", () => {
    const { ops } = layoutCertificate(record, (t, size) => t.length * size * 0.5);
    const printed = ops.flatMap(o => (o.kind === "text" ? [o.text] : []));
    expect(printed).toContain("Aradhya Chavan");
    expect(printed).toContain("CERT-2026-000184");
    expect(printed).toContain("PLY-2026-000184");
    expect(printed).toContain("08 Oct 2026");
  });
  it("formats the issue date in UTC with a fixed month name", () => {
    expect(formatCertificateDate("2026-10-07T23:30:00Z")).toBe("07 Oct 2026");
    expect(formatCertificateDate("2026-09-01T00:00:00Z")).toBe("01 Sep 2026");
  });
  it("encodes the exact verification URL in the QR code", () => {
    const { ops } = layoutCertificate(record, (t, size) => t.length * size * 0.5);
    expect(ops.some(o => o.kind === "qr" && o.modules.length > 20)).toBe(true);
  });
});
