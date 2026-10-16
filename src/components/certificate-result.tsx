import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { certificateDownloadPublic, verifyCertificate } from "@/lib/app.functions";
import { saveCertificatePdf } from "@/lib/certificate-download";
import { CertificateView } from "@/components/certificate-view";
import { Button } from "@/components/ui/button";
import { Facts, fmtDate } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { CERTIFICATE_DISCLAIMER } from "@/lib/domain/constants";
import type { CertificateType } from "@/lib/domain/certificate-layout";
import { googleScholarUrl } from "@/lib/domain/metadata";

const TYPE_LABEL: Record<string, string> = { SUBMISSION: "Certificate of Submission", PUBLICATION: "Certificate of Publication", PEER_REVIEW: "Certificate of Peer Review (reviewer)", AUTHOR_RECORD: "Certificate of Author Record" };

export function CertificateResult({ id, token }: { id: string; token?: string | undefined }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["verify", id, token], queryFn: () => verifyCertificate({ data: { certificateId: id, token } }) });
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div role="status" aria-label="Checking certificate" className="mt-8 space-y-3"><Skeleton className="h-16 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  if (isError) return <p role="alert" className="mt-6 rounded-xl border border-destructive/25 bg-critical-soft px-4 py-3">The check could not be completed. Try again in a moment.</p>;
  if (data === null) return <p role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/25 bg-critical-soft px-4 py-3.5 font-semibold text-destructive animate-in fade-in-0 duration-300"><ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />No certificate with this ID exists. Check the ID printed on the document.</p>;
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
    <div className="mt-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 ${valid ? "border-positive/25 bg-positive-soft text-positive" : "border-destructive/25 bg-critical-soft text-destructive"}`}>
        {valid ? <BadgeCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0" /> : <ShieldAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0" />}
        <p className="text-lg font-semibold leading-snug">
          {data.tokenMatches === false ? "Certificate link could not be verified." : data.live?.publicationStatus === "Retracted" ? "The associated research has been retracted." : valid ? "This certificate exists and is valid." : `This certificate is ${data.status.toLowerCase()}.`}{data.status_reason ? ` ${data.status_reason}` : ""}
        </p>
      </div>
      {data.tokenMatches === false && <p role="alert" className="mt-1 text-sm text-destructive">The code in the link or QR does not match this certificate. Treat the document with caution.</p>}
      <div className="mt-6 overflow-hidden rounded-xl border border-border shadow-lift">
        <CertificateView data={{
          certificateId: data.certificate_id, type: data.certificate_type as CertificateType, recipientName: data.recipient_name_at_issue, authorRole: data.author_role, orcid: (data as { orcid_at_issue?: string | null }).orcid_at_issue ?? null,
          paperTitle: data.paper_title_at_issue, articleId: data.article_public_id, doi: data.doi_at_issue, publicationDate: data.publication_date, issuedAt: data.issued_at, verificationUrl,
          ...(data.live ? { recordType: data.live.recordType, reviewStatement: data.live.reviewStatement } : {}),
        }} />
      </div>
      {data.tokenMatches === true
        ? <div className="mt-4"><Button onClick={() => download(token!)} disabled={busy}><Download className="size-4" />{busy ? "Preparing PDF…" : "Download certificate (PDF)"}</Button></div>
        : <p className="mt-3 text-sm text-muted-foreground">To download the PDF, open this page by scanning the QR code on the certificate or from the certificate link you were given.</p>}
      <div className="mt-8"><Facts items={[
        ["Certificate ID", <span key="c" className="whitespace-nowrap tabular-nums">{data.certificate_id}</span>],
        ["Type", TYPE_LABEL[data.certificate_type] ?? data.certificate_type],
        ["Recipient", `${data.recipient_name_at_issue} (${data.author_role})`],
        ["Work", data.paper_title_at_issue],
        ["Paperly ID", <span key="p" className="tabular-nums">{data.live?.paperlyId ?? data.article_public_id}{data.live?.publiclyListed && /^PLY-/.test(data.live.paperlyId) && <> · <Link to="/article/$paperlyId" params={{ paperlyId: data.live.paperlyId }} className="link">View the record</Link></>}</span>],
        ...(data.live ? [["Record type", data.live.recordType], ["Current status", data.live.publicationStatus], ["Peer review", data.live.reviewStatement]] as Array<[string, React.ReactNode]> : []),
        ["DOI", data.doi_at_issue ?? "None registered at issue"],
        ...(data.publication_date ? [["Publication date", fmtDate(data.publication_date)]] as Array<[string, React.ReactNode]> : []),
        ["Issued", fmtDate(data.issued_at)],
        ...(data.document_hash ? [["Document fingerprint (SHA-256)", <span key="h" className="break-all font-mono text-xs">{data.document_hash}</span>]] as Array<[string, React.ReactNode]> : []),
      ]} /></div>
      {data.certificate_type === "PUBLICATION" && data.live?.publiclyListed && (
        <p className="mt-4 text-sm"><a className="link" href={googleScholarUrl(data.paper_title_at_issue)} target="_blank" rel="noopener noreferrer">Search for this work on Google Scholar</a> <span className="text-muted-foreground">(a search link. Appearing in Google Scholar is Google's decision and is not part of this certificate.)</span></p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{CERTIFICATE_DISCLAIMER}</p>
    </div>
  );
}
