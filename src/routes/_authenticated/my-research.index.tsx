import { createFileRoute, Link } from "@tanstack/react-router";
import { myPapersQuery } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTitle, StatusBadge, fmtDate } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/my-research/")({
  head: () => ({ meta: [{ title: "My research — Paperly" }, { name: "robots", content: "noindex" }] }),
  loader: ({ context }) => { void context.queryClient.prefetchQuery(myPapersQuery()); },
  component: MyResearch,
});

function MyResearch() {
  const { data, isLoading, error } = useQuery(myPapersQuery());
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-end justify-between gap-4">
        <PageTitle title="My research" subtitle="Every submission, its screening outcome and its next step." />
        <Button asChild className="mb-8 shrink-0"><Link to="/submit">New submission</Link></Button>
      </div>
      {isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>}
      {error && <p role="alert" className="text-sm text-destructive">We could not load your submissions. Please refresh.</p>}
      {data && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="font-serif text-xl">No submissions yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Upload a PDF with its author list and declarations. Screening starts automatically and you can follow every check.</p>
          <Button asChild className="mt-5"><Link to="/submit">Submit your first paper</Link></Button>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {data.map((p) => (
            <li key={p.id}>
              <Link to="/my-research/$id" params={{ id: p.id }} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="tabular-nums">{p.public_id}</span><span aria-hidden="true" className="h-3 w-px bg-border" /><span>{p.article_type}</span><span aria-hidden="true" className="h-3 w-px bg-border" /><span>{fmtDate(p.created_at)}</span></div>
                  <div className="mt-1 truncate font-serif text-lg font-semibold">{p.title}</div>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
