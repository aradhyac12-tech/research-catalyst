import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { CertificateResult } from "@/components/certificate-result";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/lib/ui";

export const Route = createFileRoute("/verify")({
  validateSearch: z.object({ id: z.string().optional(), t: z.string().optional() }),
  head: () => ({ meta: [
    { title: "Verify a certificate | Paperly" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "Check whether a Paperly certificate is genuine and still valid." },
    { property: "og:title", content: "Verify a certificate | Paperly" }, { property: "og:description", content: "Look up any certificate by its ID." },
  ] }),
  component: Verify,
});

function Verify() {
  const { id, t } = Route.useSearch();
  const nav = Route.useNavigate();
  const [val, setVal] = useState(id ?? "");
  return (
    <div className="mx-auto max-w-2xl px-5 pt-10">
      <PageTitle title="Verify a certificate" subtitle="Enter the certificate ID printed on the document, e.g. CERT-2026-000001." />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = val.trim().toUpperCase(); if (v) nav({ to: "/verify/certificate/$certId", params: { certId: v } }); }}>
        <label htmlFor="cert" className="sr-only">Certificate ID</label>
        <Input id="cert" value={val} onChange={(e) => setVal(e.target.value)} placeholder="CERT-2026-000001" className="flex-1" />
        <Button>Check certificate</Button>
      </form>
      {id && <CertificateResult id={id} token={t} />}
    </div>
  );
}
