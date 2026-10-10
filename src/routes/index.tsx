import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { explorePapers } from "@/lib/app.functions";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/ui";

const recent = () => queryOptions({ queryKey: ["explore", ""], queryFn: async () => (await explorePapers({ data: {} })).rows });

export const Route = createFileRoute("/")({
  loader: ({ context }) => { void context.queryClient.prefetchQuery(recent()); },
  head: () => ({
    meta: [
      { title: "Paperly: open repository for screened research" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
      { name: "description", content: "Publish research with a visible screening record. Browse published articles, submit a manuscript, or verify a certificate." },
      { property: "og:title", content: "Paperly: open repository for screened research" },
      { property: "og:description", content: "Published research with a visible screening record, and verifiable certificates." },
    ],
  }),
  component: Home,
});

function Home() {
  const nav = Route.useNavigate();
  const { data, isLoading, isError } = useQuery(recent());
  return (
    <div className="mx-auto max-w-6xl px-5 pt-14">
      <div className="max-w-3xl">
        <h1 className="text-[2.25rem] leading-[1.1] sm:text-[2.75rem]">Research with a visible screening record.</h1>
        <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">Browse published articles, submit a manuscript, or verify a certificate.</p>
        <form role="search" className="mt-8 flex items-center gap-2 rounded-full border border-input bg-background p-1.5 pl-5 shadow-soft transition-shadow duration-200 ease-premium focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15" onSubmit={(e) => { e.preventDefault(); const q = String(new FormData(e.currentTarget).get("q") ?? "").trim(); void nav({ to: "/explore", search: q ? { q } : {} }); }}>
          <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <label htmlFor="home-search" className="sr-only">Search published research</label>
          <Input id="home-search" name="q" placeholder="Title, abstract or keyword" className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0" />
          <Button type="submit" size="lg" className="rounded-full">Search</Button>
        </form>
      </div>

      <div className="mt-16 grid gap-14 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-labelledby="recent-h">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border pb-3">
            <h2 id="recent-h" className="text-[1.5rem]">Recently published</h2>
            <Link to="/explore" className="link text-[15px]">All published research</Link>
          </div>
          {isLoading && <p className="py-8 text-muted-foreground">Loading…</p>}
          {isError && <p role="alert" className="mt-5 border-l-4 border-destructive bg-critical-soft px-4 py-3 text-[15px]">Recent articles could not be loaded. Refresh the page to try again, or <Link to="/explore" className="link">search all published research</Link>.</p>}
          {data && data.length === 0 && (
            <div className="border-b border-border py-10">
              <p className="text-lg font-semibold">Nothing has been published yet.</p>
              <p className="mt-2 max-w-[56ch] text-muted-foreground">Accepted manuscripts appear here as soon as the author completes payment and the record is made public. <Link to="/submit" className="link">Submit the first one</Link>.</p>
            </div>
          )}
          <ol className="divide-y divide-border">
            {data?.slice(0, 8).map((p) => (
              <li key={p.public_id} className="-mx-4 rounded-xl px-4 py-5 transition-colors duration-200 ease-premium hover:bg-wash/70">
                <Link to="/article/$paperlyId" params={{ paperlyId: p.paperly_id }} className="font-serif text-[1.25rem] font-semibold leading-snug text-primary underline decoration-1 underline-offset-[3px] hover:decoration-2">{p.title}</Link>
                <p className="mt-1.5 line-clamp-2 max-w-[70ch] text-[15px] leading-relaxed text-muted-foreground">{p.abstract}</p>
                <p className="mt-2 text-sm text-muted-foreground">{p.article_type}, published {fmtDate(p.published_at)}</p>
              </li>
            ))}
          </ol>
        </section>

        <aside aria-labelledby="authors-h" className="self-start rounded-2xl border border-border bg-wash/50 p-6 shadow-soft">
          <h2 id="authors-h" className="border-b border-border pb-3 text-[1.5rem]">For authors</h2>
          <p className="mt-4 leading-relaxed">Upload a PDF with your author details and declarations. Screening starts straight away and you can follow each check.</p>
          <Button asChild size="lg" className="mt-5 w-full"><Link to="/submit">Submit research</Link></Button>
          <dl className="mt-7 divide-y divide-border border-y border-border text-[15px]">
            <div className="grid grid-cols-[7rem_1fr] gap-3 py-2.5"><dt className="text-muted-foreground">Fee</dt><dd>₹1,500 at upload; ₹300 kept if rejected, the rest refunded</dd></div>
            <div className="grid grid-cols-[7rem_1fr] gap-3 py-2.5"><dt className="text-muted-foreground">Payment</dt><dd>UPI, cards and netbanking through Razorpay</dd></div>
            <div className="grid grid-cols-[7rem_1fr] gap-3 py-2.5"><dt className="text-muted-foreground">File</dt><dd>PDF, up to 25 MB</dd></div>
          </dl>

          <h2 className="mt-10 border-b border-border pb-3 text-[1.25rem]">How a submission is handled</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 leading-relaxed marker:font-semibold">
            <li>The file is checked and its text is read.</li>
            <li>References are looked up in Crossref and similarity is compared with work already on the platform.</li>
            <li>With your consent, an AI model reports findings. It does not decide.</li>
            <li>Automated screening only reports findings. A human editor makes every accept, revise or reject decision.</li>
          </ol>
          <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">You declare any AI assistance when you submit. Editors see an estimate of AI-assisted text only as a range, beside your declaration, and it is never grounds for rejection on its own.</p>
          <p className="mt-6 text-[15px]"><Link to="/verify" className="link">Verify a certificate</Link></p>
        </aside>
      </div>
    </div>
  );
}
