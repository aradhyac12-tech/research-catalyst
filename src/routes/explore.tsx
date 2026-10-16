import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { RouteError } from "@/components/route-error";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { explorePapers } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/search-field";
import { ArticleRow } from "@/components/article-row";
import { PageTitle, StatusBadge, fmtDate } from "@/lib/ui";
import { PUBLICATION_TYPE_LABEL, type PublicationType } from "@/lib/domain/scholarly";

type Search = { q?: string | undefined; type?: "REPOSITORY_RECORD" | "PREPRINT" | "JOURNAL_ARTICLE" | undefined; field?: string | undefined; year?: number | undefined; peerReviewed?: boolean | undefined; sort?: "newest" | "oldest" | undefined; page?: number | undefined };
const q = (s: Search) => queryOptions({ queryKey: ["explore", s], queryFn: () => explorePapers({ data: s }) });

export const Route = createFileRoute("/explore")({
  validateSearch: z.object({
    q: z.string().optional(), type: z.enum(["REPOSITORY_RECORD", "PREPRINT", "JOURNAL_ARTICLE"]).optional(), field: z.string().optional(),
    year: z.coerce.number().int().optional(), peerReviewed: z.boolean().optional(), sort: z.enum(["newest", "oldest"]).optional(), page: z.coerce.number().int().min(1).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(q(deps)),
  head: () => ({ meta: [
    { title: "Published research | Paperly" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "Search research published through Paperly." },
    { property: "og:title", content: "Published research | Paperly" }, { property: "og:description", content: "Search titles, abstracts and keywords." },
  ] }),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} compact />,
  component: Explore,
});

const TYPE_OPTIONS = [["", "All record types"], ["REPOSITORY_RECORD", "Repository records"], ["PREPRINT", "Preprints"], ["JOURNAL_ARTICLE", "Journal articles"]] as const;

function Explore() {
  const search = Route.useSearch();
  const nav = Route.useNavigate();
  const { data } = useSuspenseQuery(q(search));
  const set = (patch: Partial<Search>) => nav({ search: (prev: Search) => ({ ...prev, ...patch, page: patch.page ?? 1 }) });
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const sel = "h-10 rounded-lg border border-input bg-background px-3 text-sm";
  const busy = useRouterState({ select: (st) => st.status === "pending" });
  return (
    <div className="mx-auto max-w-4xl px-5 pt-12">
      <PageTitle title="Published research" subtitle="Published, corrected and retracted records. Corrections and retractions stay visible." />
      <SearchField id="q" defaultValue={search.q} onSearch={(v) => set({ q: v || undefined })} />
      <div className="mt-4 flex flex-wrap items-center gap-3" role="group" aria-label="Filters">
        <label className="sr-only" htmlFor="f-type">Record type</label>
        <select id="f-type" className={sel} value={search.type ?? ""} onChange={(e) => set({ type: (e.target.value || undefined) as Search["type"] })}>{TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="sr-only" htmlFor="f-field">Subject</label>
        <select id="f-field" className={sel} value={search.field ?? ""} onChange={(e) => set({ field: e.target.value || undefined })}><option value="">All subjects</option>{data.fields.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        <label className="sr-only" htmlFor="f-year">Year</label>
        <Input id="f-year" inputMode="numeric" placeholder="Year" className="h-10 w-24" defaultValue={search.year} onBlur={(e) => { const v = Number(e.target.value); set({ year: Number.isInteger(v) && v >= 1990 ? v : undefined }); }} />
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={!!search.peerReviewed} onChange={(e) => set({ peerReviewed: e.target.checked || undefined })} />Peer reviewed only</label>
        <label className="sr-only" htmlFor="f-sort">Sort</label>
        <select id="f-sort" className={sel} value={search.sort ?? "newest"} onChange={(e) => set({ sort: e.target.value as Search["sort"] })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
      </div>
      <p className="mt-6 border-b border-border pb-2 text-[15px] font-semibold" aria-live="polite">{data.total} {data.total === 1 ? "record" : "records"}{search.q ? ` for “${search.q}”` : ""}</p>
      {data.rows.length === 0 && <p className="py-8 text-muted-foreground">{search.q || search.type || search.field || search.year ? "No records match. Try fewer filters or different words." : "Nothing has been published yet."}</p>}
      <ol aria-busy={busy} className={`divide-y divide-border transition-opacity duration-300 ${busy ? "opacity-50" : "opacity-100"}`}>
        {data.rows.map((p) => (
          <ArticleRow key={p.public_id} paperlyId={p.paperly_id} title={p.title} abstract={p.abstract}>
            <span>{PUBLICATION_TYPE_LABEL[p.publication_type as PublicationType]}</span><span>{p.article_type}</span><span>Published {fmtDate(p.published_at)}</span><span className="tabular-nums">{p.paperly_id}</span>{p.peer_reviewed && <span className="font-medium text-foreground">Peer reviewed</span>}{p.status !== "PUBLISHED" && <StatusBadge status={p.status} />}
          </ArticleRow>
        ))}
      </ol>
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between border-t border-border pt-4 text-sm" aria-label="Pagination">
          <Button variant="outline" disabled={data.page <= 1} onClick={() => set({ page: data.page - 1 })}>Previous</Button>
          <span>Page {data.page} of {pages}</span>
          <Button variant="outline" disabled={data.page >= pages} onClick={() => set({ page: data.page + 1 })}>Next</Button>
        </nav>
      )}
    </div>
  );
}
