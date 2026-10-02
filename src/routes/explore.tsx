import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { explorePapers } from "@/lib/app.functions";
import { Input } from "@/components/ui/input";
import { PageTitle, StatusBadge, fmtDate } from "@/lib/ui";

const q = (s?: string) => queryOptions({ queryKey: ["explore", s ?? ""], queryFn: () => explorePapers({ data: { q: s } }) });

export const Route = createFileRoute("/explore")({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(q(deps.q)),
  head: () => ({ meta: [
    { title: "Explore published research — Paperly" }, { name: "description", content: "Search research published through Paperly." },
    { property: "og:title", content: "Explore published research — Paperly" }, { property: "og:description", content: "Search titles, abstracts and keywords." },
  ] }),
  errorComponent: () => <div className="p-8">Could not load results.</div>,
  component: Explore,
});

function Explore() {
  const { q: s } = Route.useSearch();
  const nav = Route.useNavigate();
  const { data } = useSuspenseQuery(q(s));
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <PageTitle title="Explore" subtitle="Published, corrected and retracted records." />
      <form onSubmit={(e) => { e.preventDefault(); nav({ search: { q: String(new FormData(e.currentTarget).get("q") || "") || undefined } }); }}>
        <Input name="q" defaultValue={s} placeholder="Search title, abstract, keywords…" />
      </form>
      <ul className="mt-8 divide-y divide-border">
        {data.length === 0 && <li className="py-8 text-muted-foreground">No published records yet.</li>}
        {data.map((p) => (
          <li key={p.public_id} className="py-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>{p.public_id}</span>·<span>{p.article_type}</span>·<span>{fmtDate(p.published_at)}</span>{p.status !== "PUBLISHED" && <StatusBadge status={p.status} />}</div>
            <Link to="/paper/$publicId" params={{ publicId: p.public_id }} className="mt-1 block font-serif text-xl font-semibold hover:underline">{p.title}</Link>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.abstract}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
