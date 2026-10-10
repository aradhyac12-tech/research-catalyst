import { createFileRoute, Link } from "@tanstack/react-router";
import { myPapersQuery } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PageTitle, StatusBadge, fmtDate } from "@/lib/ui";

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
      {isLoading && <p className="text-muted-foreground">Loading your submissions…</p>}
      {error && <p role="alert" className="border-l-4 border-destructive bg-critical-soft px-4 py-3">Your submissions could not be loaded. Refresh the page to try again.</p>}
      {data && data.length === 0 && (
        <div className="rounded-2xl border border-border bg-wash/50 px-6 py-10">
          <p className="text-lg font-semibold">You have not submitted anything yet.</p>
          <p className="mt-2 max-w-[56ch] text-muted-foreground">Upload a PDF with your author details and declarations. Screening starts straight away.</p>
          <Button asChild className="mt-5"><Link to="/submit">Submit research</Link></Button>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-[15px]">
            <caption className="sr-only">Your submissions</caption>
            <thead><tr className="border-b border-border"><th scope="col" className="py-2 pr-4 font-semibold">Title</th><th scope="col" className="py-2 pr-4 font-semibold">Type</th><th scope="col" className="py-2 pr-4 font-semibold">Submitted</th><th scope="col" className="py-2 font-semibold">Status</th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4"><Link to="/my-research/$id" params={{ id: p.id }} className="link font-serif text-[1.0625rem] font-semibold">{p.title}</Link><div className="text-sm tabular-nums text-muted-foreground">{p.public_id}</div></td>
                  <td className="py-3 pr-4">{p.article_type}</td>
                  <td className="whitespace-nowrap py-3 pr-4">{fmtDate(p.created_at)}</td>
                  <td className="py-3"><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
