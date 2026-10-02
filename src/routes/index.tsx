import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paperly — Submit and publish research transparently" },
      { name: "description", content: "Submit research, get transparent automated screening under a versioned policy, editorial review, publication and verifiable certificates." },
      { property: "og:title", content: "Paperly — Submit and publish research transparently" },
      { property: "og:description", content: "Transparent screening, editorial oversight, publication and verifiable certificates." },
    ],
  }),
  component: Home,
});

const CHECKS: Array<[string, string, "ok" | "note"]> = [
  ["Document integrity", "Readable PDF, hash recorded", "ok"],
  ["Rights and permissions", "Declared and complete", "ok"],
  ["References", "41 of 42 DOIs resolve in Crossref", "note"],
  ["Research ethics", "Approval number provided", "ok"],
  ["Similarity", "No close match on the platform", "ok"],
];

const PIPELINE = [
  ["You submit", "Upload a PDF with authors, rights and ethics declarations, and say whether AI helped with the writing."],
  ["It is screened", "Security, similarity, references and ethics are checked. With your consent an AI model reads the text and reports findings."],
  ["A policy decides", "A fixed, versioned policy accepts, asks for revision, rejects, or sends the paper to an editor. The AI never decides."],
  ["You publish", "After acceptance you pay a flat fee for hosting. The work gets a public record and a verifiable certificate."],
] as const;

function Specimen() {
  return (
    <figure className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-[0_1px_2px_oklch(0.2_0.05_262/0.06),0_24px_48px_-24px_oklch(0.2_0.08_262/0.28)]" aria-label="Example screening record">
      <figcaption className="flex items-center justify-between border-b border-border px-5 py-3.5 text-[13px]">
        <span className="font-medium">RP-2026-000142</span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">Editorial review</span>
      </figcaption>
      <div className="px-5 pt-4">
        <p className="font-serif text-[19px] leading-snug">Thermal drift in sintered ceramic membranes under cyclic load</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Original research, materials science</p>
      </div>
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {CHECKS.map(([name, detail, tone]) => (
          <li key={name} className="flex items-start gap-3 px-5 py-2.5">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${tone === "ok" ? "bg-positive" : "bg-caution"}`} aria-label={tone === "ok" ? "Passed" : "Needs a look"} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{name}</div><div className="text-[13px] text-muted-foreground">{detail}</div></div>
          </li>
        ))}
      </ul>
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between"><span className="text-sm font-medium">AI-assistance estimate</span><span className="font-serif text-xl tabular-nums">18–54%</span></div>
        <div className="relative mt-2.5 h-1.5 rounded-full bg-muted" role="img" aria-label="Estimated range 18 to 54 percent">
          <div className="absolute inset-y-0 rounded-full bg-primary/30" style={{ left: "18%", width: "36%" }} />
          <div className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded bg-primary" style={{ left: "35%" }} />
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">Author declared language editing with an AI tool. Estimate and declaration are consistent.</p>
      </div>
      <div className="rounded-b-xl border-t border-border bg-muted/50 px-5 py-3 text-xs text-muted-foreground">Policy GENERAL_RESEARCH_POLICY v1.0. One reference needs an editor’s check.</div>
    </figure>
  );
}

function Home() {
  return (
    <div>
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-14 md:pt-20 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <h1 className="max-w-[16ch] font-serif text-[2.75rem] font-medium leading-[1.04] md:text-[4rem]">Publishing where every decision is on the record</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground">
            Paperly screens each submission against a published policy and shows you the result check by check. AI reports findings and never makes the call. Editors can review any outcome.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link to="/submit">Submit your research</Link></Button>
            <Button asChild size="lg" variant="outline"><Link to="/explore">Browse published work</Link></Button>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6 text-sm">
            <div><dt className="text-muted-foreground">Publication fee</dt><dd className="mt-1 font-serif text-xl tabular-nums">₹1,500</dd></div>
            <div><dt className="text-muted-foreground">Paid by</dt><dd className="mt-1 font-medium">UPI, cards, netbanking</dd></div>
            <div><dt className="text-muted-foreground">Charged</dt><dd className="mt-1 font-medium">Only after acceptance</dd></div>
          </dl>
        </div>
        <div className="flex justify-center lg:justify-end"><Specimen /></div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="font-serif text-3xl font-medium leading-tight md:text-4xl">What happens to your paper</h2>
            <p className="mt-4 max-w-sm text-muted-foreground">Four stages, each visible from your dashboard while it runs. Screening usually finishes within minutes.</p>
          </div>
          <ol className="relative space-y-9 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border">
            {PIPELINE.map(([title, body], i) => (
              <li key={title} className="relative pl-11">
                <span className="absolute left-0 top-0.5 grid size-6 place-items-center rounded-full border border-border bg-background text-xs font-medium tabular-nums">{i + 1}</span>
                <h3 className="font-serif text-xl font-medium">{title}</h3>
                <p className="mt-1.5 max-w-xl leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pt-20">
        <h2 className="max-w-xl font-serif text-3xl font-medium leading-tight md:text-4xl">Honest about what automation can and cannot tell you</h2>
        <div className="mt-10 grid gap-x-12 gap-y-9 md:grid-cols-3">
          <div><h3 className="font-semibold">AI use is disclosed, not policed</h3><p className="mt-2 leading-relaxed text-muted-foreground">You tell us how AI helped. We show editors an estimate as a range, next to your declaration. It is never used on its own to reject a paper, because detectors are known to misjudge non-native English writing.</p></div>
          <div><h3 className="font-semibold">References are checked</h3><p className="mt-2 leading-relaxed text-muted-foreground">Every DOI is looked up in Crossref. Invented or mistyped references are the most common AI-related error, and they surface before an editor reads the paper.</p></div>
          <div><h3 className="font-semibold">Screening is not peer review</h3><p className="mt-2 leading-relaxed text-muted-foreground">Accepted work is labelled as screened, not peer reviewed. We make no claim of indexing or accreditation unless our records prove it. <Link to="/verify" className="text-primary underline underline-offset-4">Verify any certificate</Link>.</p></div>
        </div>
      </section>
    </div>
  );
}
