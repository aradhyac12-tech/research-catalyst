import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { certificateDownloadPublic, verifyCertificate } from "@/lib/app.functions";
import { saveCertificatePdf } from "@/lib/certificate-download";
import { CertificateView } from "@/components/certificate-view";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/ui";
import { CERTIFICATE_DISCLAIMER } from "@/lib/domain/constants";
import type { CertificateType } from "@/lib/domain/certificate-layout";

const TYPE_LABEL: Record<string, string> = { SUBMISSION: "Certificate of Submission", PUBLICATION: "Certificate of Publication", PEER_REVIEW: "Certificate of Peer Review (reviewer)", AUTHOR_RECORD: "Certificate of Author Record" };

export function CertificateResult({ id, token }: { id: string; token?: string }) {
  const { data, isFetching, isError } = useQuery({ queryKey: ["verify", id, token], queryFn: () => verifyCertificate({ data: { certificateId: id, token } }) });
  const [busy, setBusy] = useState(false);
  if (isFetching) return <p className="mt-6 text-sm text-muted-foreground">Checking…</p>;
  if (isError) return <p role="alert" className="mt-6 border-l-4 border-destructive bg-critical-soft px-4 py-3">The check could not be completed. Try again in a moment.</p>;
  if (data === null) return <p role="alert" className="mt-6 border-l-4 border-destructive bg-critical-soft px-4 py-3 font-semibold">No certificate with this ID exists. Check the ID printed on the document.</p>;
  if (!data) return null;
  async function download(token: string) {
    setBusy(true);
    try {
      const r = await certificateDownloadPublic({ data: { certificateId: data!.certificate_id, token } });
      if (!r.url) throw new Error("Certificate file is not ready yet");
      await saveCertificatePdf(r.url, data!.certificate_id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not download certificate"); }
    finally { setBusy(false); }
  }
  // The QR on the certificate points back at this page, with the same verification code the visitor arrived with.
  const verificationUrl = `${typeof window === "undefined" ? "" : window.location.origin}/verify/certificate/${data.certificate_id}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  const valid = data.status === "VALID" && data.tokenMatches !== false && data.live?.publicationStatus !== "Retracted";
  return (
    <div className="mt-8 border-t-2 border-foreground pt-4">
      <p className={`text-lg font-semibold ${valid ? "text-positive" : "text-destructive"}`}>
        {data.tokenMatches === false ? "Certificate link could not be verified." : data.live?.publicationStatus === "Retracted" ? "The associated research has been retracted." : valid ? "This certificate exists and is valid." : `This certificate is ${data.status.toLowerCase()}.`}{data.status_reason ? ` ${data.status_reason}` : ""}
      </p>
      {data.tokenMatches === false && <p role="alert" className="mt-1 text-sm text-destructive">The code in the link or QR does not match this certificate. Treat the document with caution.</p>}
      <div className="mt-6 border border-border shadow-sm">
        <CertificateView data={{
          certificateId: data.certificate_id, type: data.certificate_type as CertificateType, recipientName: data.recipient_name_at_issue, authorRole: data.author_role, orcid: (data as { orcid_at_issue?: string | null }).orcid_at_issue ?? null,
          paperTitle: data.paper_title_at_issue, articleId: data.article_public_id, doi: data.doi_at_issue, publicationDate: data.publication_date, issuedAt: data.issued_at, verificationUrl,
        }} />
      </div>
      {data.tokenMatches === true
        ? <div className="mt-4"><Button onClick={() => download(token!)} disabled={busy}><Download className="size-4" />{busy ? "Preparing PDF…" : "Download certificate (PDF)"}</Button></div>
        : <p className="mt-3 text-sm text-muted-foreground">To download the PDF, open this page by scanning the QR code on the certificate or from the certificate link you were given.</p>}
      <dl className="mt-6 grid gap-3">
        <div><dt className="text-muted-foreground">Certificate ID</dt><dd className="tabular-nums">{data.certificate_id}</dd></div>
        <div><dt className="text-muted-foreground">Type</dt><dd>{TYPE_LABEL[data.certificate_type] ?? data.certificate_type}</dd></div>
        <div><dt className="text-muted-foreground">Recipient</dt><dd>{data.recipient_name_at_issue} ({data.author_role})</dd></div>
        <div><dt className="text-muted-foreground">Work</dt><dd>{data.paper_title_at_issue}</dd></div>
        <div><dt className="text-muted-foreground">Paperly ID</dt><dd className="tabular-nums">{data.live?.paperlyId ?? data.article_public_id}{data.live?.publiclyListed && /^PLY-/.test(data.live.paperlyId) && <> · <Link to="/article/$paperlyId" params={{ paperlyId: data.live.paperlyId }} className="link">View the record</Link></>}</dd></div>
        {data.live && <>
          <div><dt className="text-muted-foreground">Record type</dt><dd>{data.live.recordType}</dd></div>
          <div><dt className="text-muted-foreground">Current status</dt><dd>{data.live.publicationStatus}</dd></div>
          <div><dt className="text-muted-foreground">Peer review</dt><dd>{data.live.reviewStatement}</dd></div>
        </>}
        <div><dt className="text-muted-foreground">DOI</dt><dd>{data.doi_at_issue ?? "None registered at issue"}</dd></div>
        {data.publication_date && <div><dt className="text-muted-foreground">Publication date</dt><dd>{fmtDate(data.publication_date)}</dd></div>}
        <div><dt className="text-muted-foreground">Issued</dt><dd>{fmtDate(data.issued_at)}</dd></div>
        {data.document_hash && <div><dt className="text-muted-foreground">Document fingerprint (SHA-256)</dt><dd className="break-all font-mono text-xs">{data.document_hash}</dd></div>}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">{CERTIFICATE_DISCLAIMER}</p>
    </div>
  );
}
