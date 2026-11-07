import { createFileRoute } from "@tanstack/react-router";
import { CertificateDelivery } from "@/components/certificate-delivery";
import { PageTitle } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/certificates")({
  head: () => ({ meta: [{ title: "My certificates | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "My certificates | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Certificates,
});

function Certificates() {
  return (
    <div className="mx-auto max-w-4xl px-5 pt-10">
      <PageTitle title="My certificates" subtitle="Anyone can check a certificate against its public verification record." />
      <CertificateDelivery />
    </div>
  );
}
