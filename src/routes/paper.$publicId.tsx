import { createFileRoute, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getPublicPaper } from "@/lib/app.functions";
import { StatusBadge, fmtDate } from "@/lib/ui";

const q = (id: string) => queryOptions({ queryKey: ["paper", id], queryFn: () => getPublicPaper({ data: { publicId: id } }) });

export const Route = createFileRoute("/paper/$publicId")({
  loader: async ({ context, params }) => {
    const p = await context.queryClient.ensureQueryData(q(params.publicId));
    if (!p) throw notFound();
    return p;
  },
  head: ({ loaderData }) => loaderData ? { meta: [
    { title: `${loaderData.title} — Paperly` }, { name: "description", content: loaderData.abstract.slice(0, 160) },
    { property: "og:title", content: loaderData.title }, { property: "og:description", content: loaderData.abstract.slice(0, 160) },
    { property: "og:type", content: "article" }, { name: "citation_title", content: loaderData.title },
    ...loaderData.authors.map((a) => ({ name: "citation_author", content: a.full_name })),
  ] } : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  notFoundComponent: () => <div className="mx-auto max-w-3xl p-10">This record is not public.</div>,
  errorComponent: () => <div className="mx-auto max-w-3xl p-10">Could not load this record.</div>,
  component: PaperPage,
});

function PaperPage() {
  const { publicId } = Route.useParams();
  const { data: p } = useSuspenseQuery(q(publicId));
  if (!p) return null;
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      {p.status === "RETRACTED" && <div className="mb-6 rounded-md border border-destructive p-3 text-sm text-destructive">This article has been retracted.</div>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{p.public_id}, {p.article_type}, {p.field} <StatusBadge status={p.status} /></div>
      <h1 className="mt-3 font-serif text-3xl md:text-4xl font-semibold leading-tight">{p.title}</h1>
      <p className="mt-4 text-sm">{p.authors.map((a) => a.full_name + (a.affiliation ? ` (${a.affiliation})` : "")).join("; ")}</p>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div><dt className="text-muted-foreground">Published</dt><dd>{fmtDate(p.published_at)}</dd></div>
        <div><dt className="text-muted-foreground">Licence</dt><dd>{p.license ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">DOI</dt><dd>{p.doi ? <a className="underline" href={`https://doi.org/${p.doi}`}>{p.doi}</a> : "Not registered"}</dd></div>
        <div><dt className="text-muted-foreground">Peer reviewed</dt><dd>{p.peer_reviewed ? "Yes" : "No (screened only)"}</dd></div>
      </dl>
      <h2 className="mt-10 font-serif text-xl font-semibold">Abstract</h2>
      <p className="mt-2 leading-relaxed whitespace-pre-line">{p.abstract}</p>
      <p className="mt-6 text-sm text-muted-foreground">Keywords: {p.keywords.join(", ")}</p>
      {p.corrections.length > 0 && (
        <section className="mt-10"><h2 className="font-serif text-xl font-semibold">Notices</h2>
          {p.corrections.map((c, i) => <p key={i} className="mt-2 text-sm"><strong>{c.kind}</strong> ({fmtDate(c.issued_at)}): {c.notice}</p>)}
        </section>
      )}
    </article>
  );
}
