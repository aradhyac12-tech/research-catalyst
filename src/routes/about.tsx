import { createFileRoute, Link } from "@tanstack/react-router";
import { RouteError } from "@/components/route-error";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getJournalIdentity } from "@/lib/identity.functions";
import { PageTitle } from "@/lib/ui";
import { TrustStrip } from "@/components/trust-strip";
import { POLICIES } from "@/lib/domain/policies";

const q = queryOptions({ queryKey: ["journal-identity"], queryFn: () => getJournalIdentity() });

export const Route = createFileRoute("/about")({
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  head: () => ({ meta: [
    { title: "About | Paperly" }, { property: "og:title", content: "About | Paperly" }, { property: "og:description", content: "What Paperly is, how it is run and how to contact the editorial office." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "What Paperly is, how it is run and how to contact the editorial office." },
  ] }),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} compact />,
  component: About,
});

function About() {
  const { data: j } = useSuspenseQuery(q);
  const aims = POLICIES.find((p) => p.slug === "aims-and-scope")!;
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title={`About ${j.journal_title}`} subtitle="An open repository for screened research manuscripts." />
      <TrustStrip className="-mt-2 mb-8" />
      <section aria-labelledby="aims-h">
        <h2 id="aims-h" className="text-[1.25rem]">Aims and scope</h2>
        {j.aims_scope
          ? <p className="mt-3 whitespace-pre-line">{j.aims_scope}</p>
          : aims.body.map((t, i) => <p key={i} className="mt-3">{t}</p>)}
      </section>

      <section className="mt-12" aria-labelledby="id-h">
        <h2 id="id-h" className="text-[1.25rem]">Publication details</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">Title</dt><dd>{j.journal_title}</dd>
          <dt className="text-muted-foreground">Publisher</dt><dd>{j.publisher_name ?? "Not yet stated"}</dd>
          <dt className="text-muted-foreground">ISSN (print)</dt><dd>{j.issn ?? "None assigned"}</dd>
          <dt className="text-muted-foreground">ISSN (online)</dt><dd>{j.eissn ?? "None assigned"}</dd>
          <dt className="text-muted-foreground">Frequency</dt><dd>{j.publication_frequency}</dd>
          <dt className="text-muted-foreground">Indexing</dt><dd>Paperly is not currently indexed in PubMed, Scopus, Web of Science, DOAJ or any other abstracting or indexing service. This page will say so if that changes.</dd>
          <dt className="text-muted-foreground">Editorial office</dt>
          <dd>{j.editorial_office_email ? <a className="link" href={`mailto:${j.editorial_office_email}`}>{j.editorial_office_email}</a> : "Contact details have not been published yet."}{j.editorial_office_address && <span className="block whitespace-pre-line">{j.editorial_office_address}</span>}</dd>
        </dl>
      </section>

      <section className="mt-12" aria-labelledby="who-h">
        <h2 id="who-h" className="text-[1.25rem]">How it works</h2>
        <p className="mt-3">Manuscripts are screened automatically, read by a human editor and, for journal articles, peer reviewed. Each record states its type and review status. See the <Link to="/editorial-board" className="link">editorial board</Link>, the <Link to="/fees" className="link">fees page</Link> and the <Link to="/policies" className="link">policies</Link>.</p>
      </section>
    </div>
  );
}
