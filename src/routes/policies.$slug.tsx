import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageTitle } from "@/lib/ui";
import { policyBySlug } from "@/lib/domain/policies";

export const Route = createFileRoute("/policies/$slug")({
  loader: ({ params }) => { const p = policyBySlug(params.slug); if (!p) throw notFound(); return p; },
  head: ({ loaderData }) => loaderData
    ? { meta: [{ title: `${loaderData.title} | Paperly` }, { property: "og:title", content: `${loaderData.title} | Paperly` }, { property: "og:description", content: loaderData.summary }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: loaderData.summary }] }
    : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  notFoundComponent: () => <div className="mx-auto max-w-3xl px-5 py-10">No such policy. <Link to="/policies" className="link">See all policies</Link>.</div>,
  component: PolicyPage,
});

function PolicyPage() {
  const p = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <p className="text-sm"><Link to="/policies" className="link">All policies</Link></p>
      <PageTitle title={p.title} subtitle={p.summary} />
      <div className="space-y-4">{p.body.map((t, i) => <p key={i} className="prose-article">{t}</p>)}</div>
    </div>
  );
}
