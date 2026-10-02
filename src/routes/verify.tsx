import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { verifyCertificate } from "@/lib/app.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTitle, fmtDate } from "@/lib/ui";
import { CERTIFICATE_DISCLAIMER } from "@/lib/domain/constants";

export const Route = createFileRoute("/verify")({
  validateSearch: z.object({ id: z.string().optional(), t: z.string().optional() }),
  head: () => ({ meta: [
    { title: "Verify a certificate — Paperly" }, { name: "description", content: "Check whether a Paperly certificate is genuine and still valid." },
    { property: "og:title", content: "Verify a certificate — Paperly" }, { property: "og:description", content: "Look up any certificate by its ID." },
  ] }),
  component: Verify,
});

function Verify() {
  const { id, t } = Route.useSearch();
  const nav = Route.useNavigate();
  const [val, setVal] = useState(id ?? "");
  const { data, isFetching } = useQuery({ queryKey: ["verify", id, t], enabled: !!id, queryFn: () => verifyCertificate({ data: { certificateId: id!, token: t } }) });
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <PageTitle title="Verify a certificate" subtitle="Enter the certificate ID printed on the document, e.g. CERT-2026-000001." />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); nav({ search: { id: val.trim().toUpperCase() } }); }}>
        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="CERT-2026-000001" />
        <Button>Check</Button>
      </form>
      {isFetching && <p className="mt-6 text-sm text-muted-foreground">Checking…</p>}
      {id && !isFetching && data === null && <p className="mt-6 text-destructive">No certificate with this ID exists.</p>}
      {data && (
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <p className={`text-sm font-semibold ${data.status === "VALID" ? "text-primary" : "text-destructive"}`}>Status: {data.status}{data.status_reason ? ` — ${data.status_reason}` : ""}</p>
          {data.tokenMatches === false && <p className="mt-1 text-sm text-destructive">The QR code token does not match this certificate.</p>}
          <dl className="mt-4 grid gap-2 text-sm">
            <div><dt className="text-muted-foreground">Type</dt><dd>{data.certificate_type}</dd></div>
            <div><dt className="text-muted-foreground">Recipient</dt><dd>{data.recipient_name_at_issue} ({data.author_role})</dd></div>
            <div><dt className="text-muted-foreground">Work</dt><dd>{data.paper_title_at_issue}, {data.article_public_id}</dd></div>
            <div><dt className="text-muted-foreground">Issued</dt><dd>{fmtDate(data.issued_at)}</dd></div>
            {data.document_hash && <div><dt className="text-muted-foreground">Document fingerprint (SHA-256)</dt><dd className="break-all font-mono text-xs">{data.document_hash}</dd></div>}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">{CERTIFICATE_DISCLAIMER}</p>
        </div>
      )}
    </div>
  );
}
