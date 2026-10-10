import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle } from "@/lib/ui";
import { POLICIES } from "@/lib/domain/policies";

export const Route = createFileRoute("/policies/")({
  head: () => ({ meta: [{ title: "Policies | Paperly" }, { property: "og:title", content: "Policies | Paperly" }, { property: "og:description", content: "Editorial, ethics, review, licensing, privacy and fee policies." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "Editorial, ethics, review, licensing, privacy and fee policies." }] }),
  component: () => (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="Policies" subtitle="Each policy describes what Paperly does today, including what it does not yet do." />
      <ul className="divide-y divide-border border-y border-border">
        <li className="py-4"><Link to="/fees" className="link font-semibold">Fees and publication charges</Link><p className="text-[15px] text-muted-foreground">What is charged, when, and what is free.</p></li>
        {POLICIES.map((p) => (
          <li key={p.slug} className="py-4"><Link to="/policies/$slug" params={{ slug: p.slug }} className="link font-semibold">{p.title}</Link><p className="text-[15px] text-muted-foreground">{p.summary}</p></li>
        ))}
      </ul>
    </div>
  ),
});
