import { createFileRoute } from "@tanstack/react-router";
import { myCertsQuery } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { certificateDownload } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { PageTitle, fmtDate } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/certificates")({
  head: () => ({ meta: [{ title: "Certificates — Paperly" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => { void context.queryClient.prefetchQuery(myCertsQuery()); },
  component: Certificates,
});

function Certificates() {
  const { data, isLoading } = useQuery(myCertsQuery());
  async function open(id: string) {
    try { const r = await certificateDownload({ data: { certificateId: id } }) as { url?: string }; if (r.url) window.open(r.url, "_blank", "noopener"); else toast.error("Certificate file is not ready yet."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not open certificate"); }
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageTitle title="Certificates" subtitle="Each certificate has a public verification record." />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Certificates are issued when you submit and again when your work is published.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card empty:hidden">
        {data?.map((c) => (
          <li key={c.certificate_id} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0"><div className="text-xs text-muted-foreground">{c.certificate_id}, {c.certificate_type.replace("_", " ").toLowerCase()}, {fmtDate(c.issued_at)}</div><div className="truncate font-serif text-lg font-semibold">{c.paper_title_at_issue}</div></div>
            <Button variant="outline" size="sm" onClick={() => open(c.certificate_id)}>Download PDF</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
