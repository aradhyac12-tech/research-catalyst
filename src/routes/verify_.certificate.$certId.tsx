import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { verifyCertificate, getPublicPaper } from "@/lib/app.functions";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Component, type ReactNode } from "react";
import { PageTitle } from "@/lib/ui";
import { CertificateResult } from "@/components/certificate-result";
import { RouteError } from "@/components/route-error";

const certQuery = (id: string, token?: string) =>
  queryOptions({
    queryKey: ["certificate", id, token],
    queryFn: () => verifyCertificate({ data: { certificateId: id, token } }),
  });

const paperQuery = (publicId: string) =>
  queryOptions({
    queryKey: ["paper", publicId],
    queryFn: () => getPublicPaper({ data: { publicId } }),
  });

export const Route = createFileRoute("/verify_/certificate/$certId")({
  validateSearch: z.object({ t: z.string().optional() }),
  head: ({ params }) => ({
    meta: [
      { title: `Certificate ${params.certId} | Paperly` },
      { name: "description", content: "Paperly research records, submissions and verification." },
      { property: "og:type", content: "website" },
    ],
  }),
  // A loader is not given the URL's search values; they must be declared here and are then read from `deps`.
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ context, params, deps }) => {
    const cert = await context.queryClient.ensureQueryData(
      certQuery(params.certId.toUpperCase(), deps.t)
    );
    
    if (!cert) {
      throw notFound();
    }

    return cert;
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-4xl px-5 pt-10">
      <div role="alert" className="border-l-4 border-destructive bg-critical-soft px-4 py-3">
        No certificate with this ID exists. Check the ID printed on the document.
      </div>
    </div>
  ),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
  component: CertificateWithArticle,
});

/** One part of the page failing must never take the whole page down: the other part still shows. */
class Safe extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children; }
}

function CertificateWithArticle() {
  const { certId } = Route.useParams();
  const { t } = Route.useSearch();
  const cert = Route.useLoaderData();
  const listed = !!cert.live?.publiclyListed && !!cert.live.paperlyId;

  return (
    <div className="mx-auto max-w-6xl px-5 pt-10">
      {/* The published work first, then the certificate below it. */}
      {listed ? (
        <Safe><ArticleSection paperlyId={cert.live!.paperlyId} /></Safe>
      ) : (
        <div className="rounded border border-border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">The work this certificate refers to is not published, so there is no public article to show. The certificate is below.</p>
        </div>
      )}

      <div className="mt-16 border-t-2 border-foreground pt-10">
        <PageTitle title="Certificate Verification" subtitle="This certificate verifies a documented platform event." />
        <Safe fallback={<p role="alert" className="mt-6 border-l-4 border-destructive bg-critical-soft px-4 py-3">The certificate could not be displayed. Reload the page to try again.</p>}>
          <CertificateResult id={certId.toUpperCase()} token={t} />
        </Safe>
      </div>
    </div>
  );
}

function ArticleSection({ paperlyId }: { paperlyId: string }) {
  // Optional extra: if the article cannot be loaded, the certificate below still shows.
  const { data: paper, isLoading, isError } = useQuery({ ...paperQuery(paperlyId), retry: false });

  if (isLoading) return <div className="animate-pulse text-sm text-muted-foreground">Loading article…</div>;
  if (isError) return null;
  if (!paper) {
    return (
      <div className="rounded border border-border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">
          The article for this certificate is not publicly available right now. The certificate is below.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title="Associated Article"
        subtitle={`${paper.publication_type === "JOURNAL_ARTICLE" ? "Journal Article" : paper.publication_type === "PREPRINT" ? "Preprint" : "Repository Record"} · ${paper.field}`}
      />

      {/* Quick article summary */}
      <article className="mt-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold leading-tight">{paper.title}</h1>

          {/* Authors */}
          <p className="mt-4 text-lg text-muted-foreground">
            {paper.authors.map((a) => a.full_name).join(", ")}
          </p>
        </div>

        {/* Abstract */}
        <div>
          <h2 className="text-xl font-semibold">Abstract</h2>
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed">
            {paper.abstract}
          </p>
        </div>

        {/* Key metadata */}
        <div className="rounded border border-border bg-muted/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="text-sm font-semibold text-muted-foreground">Status</span>
              <p className="mt-1 capitalize">{paper.status.replace(/_/g, " ").toLowerCase()}</p>
            </div>
            {paper.published_at && (
              <div>
                <span className="text-sm font-semibold text-muted-foreground">Published</span>
                <p className="mt-1">{new Date(paper.published_at).toLocaleDateString()}</p>
              </div>
            )}
            {paper.doi && (
              <div>
                <span className="text-sm font-semibold text-muted-foreground">DOI</span>
                <p className="mt-1">
                  <a href={`https://doi.org/${paper.doi}`} className="link break-all">
                    {paper.doi}
                  </a>
                </p>
              </div>
            )}
            <div>
              <span className="text-sm font-semibold text-muted-foreground">Paperly ID</span>
              <p className="mt-1 font-mono text-sm">{paper.paperly_id}</p>
            </div>
          </div>
        </div>

        {/* Link to full article */}
        <div className="flex gap-3">
          <a
            href={`/article/${paper.paperly_id}`}
            className="inline-flex items-center gap-2 rounded border border-foreground bg-foreground px-6 py-3 font-semibold text-background hover:bg-foreground/90"
          >
            View Full Article
          </a>
        </div>
      </article>
    </div>
  );
}
