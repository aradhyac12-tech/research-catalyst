import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { explorePapers } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/ui";
import { getPublicFees } from "@/lib/identity.functions";
import { SUBMISSION_FEE_RETAINED_MINOR } from "@/lib/domain/fees";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroBanners } from "@/components/promo-banner";
import { SearchField } from "@/components/search-field";
import { ArticleRow } from "@/components/article-row";

const recent = () => queryOptions({ queryKey: ["explore", ""], queryFn: async () => (await explorePapers({ data: {} })).rows });

export const Route = createFileRoute("/")({
  loader: ({ context }) => { void context.queryClient.prefetchQuery(recent()); },
  head: () => ({
    meta: [
      { title: "Paperly International Journal of Medical Innovation: open repository for screened research" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
      { name: "description", content: "Publish research with a visible screening record. A peer-reviewed journal. Browse published articles, submit a manuscript, or verify a certificate." },
      { property: "og:title", content: "Paperly International Journal of Medical Innovation: open repository for screened research" },
      { property: "og:description", content: "Published research with a visible screening record, and verifiable certificates." },
    ],
  }),
  component: Home,
});

/** Whole rupees without decimals (₹1,500), with decimals only when the amount has paise. */
const rupees = (minor: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);

function Home() {
  const nav = Route.useNavigate();
  const { data, isLoading, isError } = useQuery(recent());
  // The amount is set by an admin, so it is read from the same place as the Fees page rather than written in here.
  const fees = useQuery({ queryKey: ["public-fees"], queryFn: () => getPublicFees() });
  const inr = fees.data?.prices.find((p) => p.currency === "INR");
  const feeText = inr ? `${rupees(inr.amount_minor)} at upload; ${rupees(Math.min(SUBMISSION_FEE_RETAINED_MINOR, inr.amount_minor))} kept if rejected, the rest refunded` : fees.isLoading ? "…" : "Paid at upload. See the Fees page for the amount.";
  return (
    <div className="mx-auto max-w-6xl px-5 pb-8 pt-9 sm:pt-16">
      <HeroBanners className="mb-8 sm:mb-10" />
      <section aria-labelledby="home-h" className="hero-seq scroll-away relative max-w-3xl">
        <span aria-hidden="true" className="pointer-events-none absolute -left-24 -top-20 -z-10 h-72 w-[34rem] max-w-[120vw] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-primary)_9%,transparent),transparent)]" />
        <p className="flex items-center gap-3 text-[15px] font-medium text-primary"><span aria-hidden="true" className="h-px w-8 bg-gold" />Paperly International Journal</p>
        <h1 id="home-h" className="mt-4 text-[clamp(2.125rem,1.35rem+3.4vw,3.6rem)] leading-[1.08] tracking-[-0.022em]">Research with a visible screening record.</h1>
        <p className="max-w-[46ch] pt-5 text-[1.0625rem] leading-[1.7] text-muted-foreground sm:text-lg">A peer-reviewed journal. Browse published articles, submit a manuscript, or verify a certificate.</p>
        <div className="pt-8 sm:pt-10"><SearchField id="home-search" large onSearch={(q) => { void nav({ to: "/explore", search: q ? { q } : {} }); }} /></div>
      </section>

      <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-12 sm:mt-24 sm:gap-16 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-labelledby="recent-h" className="min-w-0">
          <div data-reveal="fade" className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-b border-border pb-4">
            <h2 id="recent-h" className="text-[1.625rem] sm:text-[1.875rem]">Recently published</h2>
            <Link to="/explore" className="link text-[15px]">All published research</Link>
          </div>
          {isLoading && (
            <div role="status" aria-label="Loading recent articles" className="divide-y divide-border">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-3 py-5">
                  <Skeleton className="h-6 w-4/5" /><Skeleton className="h-4 w-full max-w-[70ch]" /><Skeleton className="h-4 w-2/5" />
                </div>
              ))}
            </div>
          )}
          {isError && <p role="alert" className="mt-5 rounded-lg border border-destructive bg-critical-soft px-4 py-3 text-[15px]">Recent articles could not be loaded. Refresh the page to try again, or <Link to="/explore" className="link">search all published research</Link>.</p>}
          {data && data.length === 0 && (
            <div className="border-b border-border py-10">
              <p className="text-lg font-semibold">Nothing has been published yet.</p>
              <p className="mt-2 max-w-[56ch] text-muted-foreground">Manuscripts appear here once they have been screened, accepted by an editor and published. <Link to="/submit" className="link">Submit the first one</Link>.</p>
            </div>
          )}
          <ol className="animate-in fade-in-0 mt-6 space-y-4 duration-500">
            {data?.slice(0, 8).map((p) => (
              <ArticleRow key={p.public_id} paperlyId={p.paperly_id} title={p.title} abstract={p.abstract}>
                <span>{p.article_type}, published {fmtDate(p.published_at)}</span>
              </ArticleRow>
            ))}
          </ol>
        </section>

        <aside data-reveal="" aria-labelledby="authors-h" className="self-start rounded-2xl border border-border bg-wash/60 p-5 shadow-soft sm:p-7">
          <h2 id="authors-h" className="border-b border-border pb-3 text-[1.5rem]">For authors</h2>
          <p className="mt-4 leading-relaxed">Upload a PDF with your author details and declarations. Screening starts straight away and you can follow each check.</p>
          <Button asChild size="lg" className="mt-5 w-full"><Link to="/submit">Submit research</Link></Button>
          <dl className="mt-7 divide-y divide-border border-y border-border text-[15px]">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">Fee</dt><dd>{feeText}</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">Payment</dt><dd>UPI, cards and netbanking through Razorpay</dd></div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2.5"><dt className="text-muted-foreground">File</dt><dd>PDF, up to 50 MB</dd></div>
          </dl>

          <h2 className="mt-10 border-b border-border pb-3 text-[1.25rem]">How a submission is handled</h2>
          <ol className="mt-5 list-none">
            {["The file is checked and its text is read.", "References are looked up in Crossref and similarity is compared with work already on the platform.", "With your consent, an AI model reports findings. It does not decide.", "Automated screening only reports findings. A human editor makes every accept, revise or reject decision."].map((t, i, all) => (
              <li key={t} data-reveal="" className="relative pb-5 pl-10 leading-relaxed last:pb-0">
                <span aria-hidden="true" className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full border border-primary/25 bg-background font-serif text-[13px] font-semibold text-primary">{i + 1}</span>
                {i < all.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-3.5 top-8 w-px bg-border" />}
                {t}
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">You declare any AI assistance when you submit. Editors see an estimate of AI-assisted text only as a range, beside your declaration, and it is never grounds for rejection on its own.</p>
          <p className="mt-6 text-[15px]"><Link to="/verify" className="link">Verify a certificate</Link></p>
        </aside>
      </div>
    </div>
  );
}
