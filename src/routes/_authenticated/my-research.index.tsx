import { createFileRoute, Link } from "@tanstack/react-router";
import { myPapersQuery } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PageTitle, StatusBadge, fmtDate } from "@/lib/ui";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/my-research/")({
  head: () => ({ meta: [{ title: "My research | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "My research | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => { void context.queryClient.prefetchQuery(myPapersQuery()); },
  component: MyResearch,
});

function MyResearch() {
  const { data, isLoading, error } = useQuery(myPapersQuery());
  return (
    <div className="mx-auto max-w-5xl px-5 pt-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle title="My research" subtitle="Each submission, its screening result and what happens next." />
        {data && data.length > 0 && <Button asChild><Link to="/submit">Submit research</Link></Button>}
      </div>
      {isLoading && (
        <div role="status" aria-label="Loading your submissions" className="divide-y divide-border border-y border-border">
          {[0, 1, 2].map((i) => <div key={i} className="space-y-2 py-4"><Skeleton className="h-5 w-3/5" /><Skeleton className="h-4 w-1/4" /></div>)}
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-critical-soft px-4 py-3">Your submissions could not be loaded. Refresh the page to try again.</p>}
      {data && data.length === 0 && (
        <div className="animate-in fade-in-0 rounded-xl border border-border bg-wash/60 px-6 py-10 duration-500">
          <p className="text-lg font-semibold">You have not submitted anything yet.</p>
          <p className="mt-2 max-w-[56ch] text-muted-foreground">Upload a PDF with your author details and declarations. Screening starts once the submission fee is paid.</p>
          <Button asChild className="mt-5"><Link to="/submit">Submit research</Link></Button>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="max-w-full">
          <table className="w-full table-fixed text-left text-[15px]">
            <caption className="sr-only">Your submissions</caption>
            <thead><tr className="border-b border-border text-[13px] text-muted-foreground"><th scope="col" className="py-2.5 pr-4 font-semibold">Title</th><th scope="col" className="py-2.5 pr-4 font-semibold">Type</th><th scope="col" className="py-2.5 pr-4 font-semibold">Submitted</th><th scope="col" className="py-2.5 font-semibold">Status</th></tr></thead>
            <tbody className="animate-in fade-in-0 duration-500">
              {data.map((p) => (
                <tr key={p.id} className="border-b border-border align-top transition-colors duration-150 hover:bg-wash/70">
                  <td className="py-3 pr-4"><Link to="/my-research/$id" params={{ id: p.id }} className="title-link font-serif text-[1.0625rem] font-semibold text-primary">{p.title}</Link><div className="text-sm tabular-nums text-muted-foreground">{p.public_id}</div></td>
                  <td className="py-3 pr-4">{p.article_type}</td>
                  <td className="py-3 pr-4">{fmtDate(p.created_at)}</td>
                  <td className="py-3"><StatusBadge status={p.awaitingPayment ? "PAYMENT_PENDING" : p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
