import { orderTeacherFirst, numberAffiliations } from "@/lib/domain/journal";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteError } from "@/components/route-error";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getPublicPaper } from "@/lib/app.functions";
import { Facts, StatusBadge, fmtDate } from "@/lib/ui";
import { useState } from "react";
import { AI_USE_LABEL, CREDIT_LABEL, PUBLICATION_TYPE_LABEL, type PublicationType } from "@/lib/domain/scholarly";
import { CITATION_FORMATS, type CitablePaper } from "@/lib/domain/citation-formats";
import { buildJsonLd, buildMetaTags, googleScholarUrl, jsonLdScript, type MetaPaper } from "@/lib/domain/metadata";
import { DoiLink } from "@/components/doi-link";
import { StampedDownload } from "@/components/stamped-download";
import { FullText } from "@/components/full-text";
import { REFERENCE_STATUS_LABEL, type ReferenceStatus } from "@/lib/domain/references";

const q = (id: string) => queryOptions({ queryKey: ["paper", id], queryFn: () => getPublicPaper({ data: { publicId: id } }) });

export const Route = createFileRoute("/article/$paperlyId")({
  loader: async ({ context, params }) => {
    const p = await context.queryClient.ensureQueryData(q(params.paperlyId));
    if (!p) throw notFound();
    return p;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Not found" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] };
    const mp = toMeta(loaderData);
    return {
      meta: [
        { title: `${loaderData.title} | Paperly` }, { name: "description", content: loaderData.abstract.slice(0, 160) },
        { property: "og:title", content: loaderData.title }, { property: "og:description", content: loaderData.abstract.slice(0, 160) },
        { property: "og:type", content: "article" }, { property: "og:url", content: mp.url },
        ...buildMetaTags(mp),
      ],
      links: [{ rel: "canonical", href: mp.url }],
      scripts: [{ type: "application/ld+json", children: jsonLdScript(buildJsonLd(mp)) }],
    };
  },
  notFoundComponent: () => <div className="mx-auto max-w-3xl p-10">This record is not public.</div>,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} compact />,
  component: ArticlePage,
});

type PublicPaper = NonNullable<Awaited<ReturnType<typeof getPublicPaper>>>;
function toCitable(p: PublicPaper): CitablePaper {
  return {
    title: p.title, authors: p.authors.map((a) => a.full_name), year: Number((p.published_at ?? "").slice(0, 4)) || new Date().getFullYear(),
    publicId: p.paperly_id, doi: p.doi, url: `${p.origin}/article/${p.paperly_id}`, version: p.currentVersion,
    publicationType: p.publication_type as PublicationType, publishedDate: p.published_at?.slice(0, 10) ?? null,
    abstract: p.abstract, keywords: p.keywords, language: p.language,
  };
}
function toMeta(p: PublicPaper): MetaPaper {
  return { ...toCitable(p), status: p.status, license: p.license, field: p.field, pdfUrl: p.fullTextPdf ? `${p.origin}/article/${p.paperly_id}/pdf` : null,
    authorsDetailed: p.authors.map((a) => ({ name: a.full_name, orcid: a.orcidVerified ? a.orcid : null, affiliations: a.affiliations.map((x) => x.organization) })) };
}

function CitePanel({ p }: { p: PublicPaper }) {
  const c = toCitable(p);
  const [fmt, setFmt] = useState<(typeof CITATION_FORMATS)[number][0]>("vancouver");
  const [copied, setCopied] = useState(false);
  const f = CITATION_FORMATS.find((x) => x[0] === fmt)!;
  const text = f[2](c);
  const download = () => {
    const blob = new Blob([text + "\n"], { type: `${f[3]};charset=utf-8` });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${p.paperly_id}.${f[4]}`; a.click(); URL.revokeObjectURL(a.href);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };
  return (
    <section className="mt-9 sm:mt-12" aria-labelledby="cite-h">
      <h2 id="cite-h" className="text-[1.25rem]">Cite this record</h2>
      <div role="tablist" aria-label="Citation format" className="mt-3 flex flex-wrap gap-2">
        {CITATION_FORMATS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={fmt === k} onClick={() => setFmt(k)} className={`min-h-10 rounded-lg border px-3.5 text-sm font-medium transition-colors duration-200 ease-premium ${fmt === k ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-foreground/40 hover:bg-wash"}`}>{label}</button>
        ))}
      </div>
      <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-border bg-wash p-4 text-[14px] leading-relaxed" tabIndex={0}>{text}</pre>
      <div className="mt-3 flex gap-3">
        <button onClick={copy} className="min-h-10 rounded-lg border border-foreground/80 px-4 text-sm font-semibold transition-colors duration-200 ease-premium hover:bg-foreground hover:text-background active:translate-y-px">{copied ? "Copied" : "Copy"}</button>
        {["bibtex", "ris", "endnote"].includes(fmt) && <button onClick={download} className="min-h-10 rounded-lg border border-border px-4 text-sm transition-colors duration-200 ease-premium hover:bg-wash">Download .{f[4]}</button>}
      </div>
      <p className="mt-3 text-sm"><a className="link" href={googleScholarUrl(p.title)} target="_blank" rel="noopener noreferrer">Search for this record on Google Scholar</a> <span className="text-muted-foreground">(a search link. Google decides what Scholar lists and when, so Paperly cannot promise a listing.)</span></p>
      {!p.doi && <p className="mt-3 text-sm text-muted-foreground">This record has no DOI. The citation uses its permanent Paperly address.</p>}
    </section>
  );
}

/** What the platform may truthfully say about review. "Peer reviewed" appears only when completed reviews are recorded for the record. */
function reviewStatement(type: PublicationType, peerReviewed: boolean) {
  if (peerReviewed) return "Peer reviewed";
  if (type === "PREPRINT") return "Not peer reviewed";
  if (type === "JOURNAL_ARTICLE") return "Peer review not recorded";
  return "Not peer reviewed";
}

function ArticlePage() {
  const { paperlyId } = Route.useParams();
  const { data: p } = useSuspenseQuery(q(paperlyId));
  if (!p) return null;
  const type = p.publication_type as PublicationType;
  const affText = (a: (typeof p.authors)[number]) => a.affiliations.map((x) => x.organization).join(", ");
  const orderedAuthors = orderTeacherFirst(p.authors, affText);
  const affGroups = numberAffiliations(orderedAuthors, affText);
  const withRoles = p.authors.filter((a) => a.roles.length > 0);
  return (
    <article className="mx-auto w-full min-w-0 max-w-6xl px-5 pt-8 sm:pt-12">
      <div className="read-progress" aria-hidden="true" />
      {p.status === "RETRACTED" && <div role="alert" className="mb-8 rounded-lg border border-destructive bg-critical-soft px-4 py-3 font-semibold text-destructive">{p.corrections.some((c) => c.kind === "WITHDRAWAL") ? "This record has been withdrawn." : "This record has been retracted."} It stays public so that readers can see what was withdrawn and why. See the notices below.</div>}
      {p.status === "CORRECTED" && <div role="status" className="mb-8 rounded-lg border border-foreground bg-muted/40 px-4 py-3">This record has been corrected after publication. See the notices below.</div>}
      {p.corrections.some((c) => c.kind === "EXPRESSION_OF_CONCERN") && p.status !== "RETRACTED" && <div role="status" className="mb-8 rounded-lg border border-foreground bg-muted/40 px-4 py-3 font-semibold">An expression of concern has been issued for this record. See the notices below.</div>}
      <div className="flex flex-wrap items-center gap-2.5 text-sm">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-semibold text-accent-foreground">{PUBLICATION_TYPE_LABEL[type]}</span>
        <span className="text-muted-foreground">{p.article_type}, {p.field}</span>
      </div>
      <h1 className="mt-4 max-w-[40ch] text-[clamp(1.875rem,1.2rem+2.4vw,2.875rem)] leading-[1.12]">{p.title}</h1>
      <p className="mt-4 max-w-[70ch] text-lg">
        {orderedAuthors.map((a, i) => (
          <span key={i} className="font-bold">
            {i > 0 && ", "}{a.full_name}
            <sup className="ml-0.5 text-xs">{i + 1}</sup>
            {a.orcid && (a.orcidVerified
              ? <a className="link ml-1 text-sm" href={`https://orcid.org/${a.orcid}`} rel="noopener" title="ORCID iD verified through ORCID sign-in" aria-label={`ORCID ${a.orcid}, verified`}>ORCID</a>
              : <span className="ml-1 text-sm text-muted-foreground" title="Provided by the submitter; not verified" aria-label={`ORCID ${a.orcid}, not verified`}>ORCID (unverified)</span>)}
          </span>
        ))}
      </p>
      {affGroups.length > 0 && <ol className="mt-2 max-w-[70ch] list-none text-[15px] text-muted-foreground">{affGroups.map((g) => <li key={g.text}><sup className="mr-1 text-xs">{g.numbers.join(",")}</sup>{g.text}</li>)}</ol>}

      <div className="relative mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 border-t border-border pt-9 before:absolute before:-top-px before:left-0 before:h-0.5 before:w-16 before:bg-gold lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0">
          <h2 className="text-[1.25rem] font-bold">Abstract</h2>
          <p className="prose-article mt-3 whitespace-pre-line">{p.abstract}</p>
          {p.keywords.length > 0 && <p className="mt-5 text-[15px]"><span className="font-bold">Keywords: </span>{p.keywords.join(", ")}</p>}
          {p.fullTextPdf && <p className="mt-6"><a className="link font-semibold" href={`/article/${p.paperly_id}/pdf`}>Full text (PDF)</a></p>}
          <StampedDownload publicId={p.paperly_id} className="mt-5" />
          <FullText paperlyId={p.paperly_id} publicId={p.paperly_id} version={p.currentVersion} />
          <StampedDownload publicId={p.paperly_id} compact className="mt-8 border-t border-border pt-6" />

          {withRoles.length > 0 && (
            <section className="mt-9 sm:mt-12" aria-labelledby="contrib-h">
              <h2 id="contrib-h" className="text-[1.25rem]">Author contributions</h2>
              <ul className="mt-3 divide-y divide-border border-y border-border text-[15px]">
                {withRoles.map((a, i) => <li key={i} className="py-2.5"><span className="font-semibold">{a.full_name}:</span> {a.roles.map((r) => CREDIT_LABEL[r] ?? r).join("; ")}</li>)}
              </ul>
            </section>
          )}
          {p.funding.length > 0 && (
            <section className="mt-9 sm:mt-12" aria-labelledby="fund-h">
              <h2 id="fund-h" className="text-[1.25rem]">Funding</h2>
              <ul className="mt-3 list-disc pl-5 text-[15px]">{p.funding.map((f, i) => <li key={i}>{f.funder_name}{f.grant_number ? `, grant ${f.grant_number}` : ""}</li>)}</ul>
            </section>
          )}
          <section className="mt-9 sm:mt-12" aria-labelledby="ai-h">
            <h2 id="ai-h" className="text-[1.25rem]">AI disclosure</h2>
            {p.aiDisclosures.length === 0
              ? <p className="mt-3 text-[15px] text-muted-foreground">No structured AI disclosure is recorded for this record.</p>
              : <ul className="mt-3 divide-y divide-border border-y border-border text-[15px]">{p.aiDisclosures.map((d, i) => (
                  <li key={i} className="py-3"><span className="font-semibold">{d.tool_name}{d.tool_version ? ` ${d.tool_version}` : ""}</span>, {(AI_USE_LABEL[d.category] ?? d.category).toLowerCase()}. {d.purpose}. Extent: {d.extent}. <span className="text-muted-foreground">Author verification: {d.human_verification}</span></li>
                ))}</ul>}
          </section>

          <CitePanel p={p} />

          {p.references.length > 0 && (
            <section className="mt-9 sm:mt-12" aria-labelledby="refs-h">
              <h2 id="refs-h" className="text-[1.25rem]">References</h2>
              <p className="mt-2 text-sm text-muted-foreground">The status beside a reference describes an automated DOI lookup only. It is not an editorial or peer-review judgement.</p>
              <ol className="mt-3 divide-y divide-border border-y border-border text-[15px]">
                {p.references.map((r) => (
                  <li key={r.position} className="py-2.5">
                    <span className="mr-2 tabular-nums text-muted-foreground">{r.position}.</span>{r.text}
                    {r.doi && <> <a className="link" href={`https://doi.org/${r.doi}`} rel="noopener">doi.org/{r.doi}</a></>}
                    {r.status !== "NOT_CHECKED" && <span className="ml-2 border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{REFERENCE_STATUS_LABEL[r.status as ReferenceStatus] ?? r.status}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-9 sm:mt-12" aria-labelledby="ver-h">
            <h2 id="ver-h" className="text-[1.25rem]">Version history</h2>
            <ul className="mt-3 divide-y divide-border border-y border-border text-[15px]">
              {p.versions.map((v) => (
                <li key={v.version_number} className="py-2.5"><span className="font-semibold">Version {v.version_number}</span>{v.is_current ? " (current)" : ""}, {fmtDate(v.uploaded_at)}.{v.change_reason ? ` ${v.change_reason}` : ""} <span className="break-words text-xs text-muted-foreground">SHA-256 {v.file_hash.slice(0, 16)}{"\u2026"}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">Earlier versions are never deleted or overwritten. Cite the version you read.</p>
          </section>

          {p.corrections.length > 0 && (
            <section className="mt-9 sm:mt-12" aria-labelledby="notices-h">
              <h2 id="notices-h" className="text-[1.25rem]">Notices</h2>
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {p.corrections.map((c, i) => <li key={i} className="py-3 text-[15px]"><span className="font-semibold">{c.kind.replace(/_/g, " ").toLowerCase().replace(/^./, (m) => m.toUpperCase())}</span>, {fmtDate(c.issued_at)}. {c.notice}</li>)}
              </ul>
            </section>
          )}
        </div>
        <aside aria-label="Article information" className="self-start lg:sticky lg:top-24">
          <h2 className="text-[1.0625rem]">Article information</h2>
          <div className="mt-3"><Facts items={[
            ["Record type", PUBLICATION_TYPE_LABEL[type]],
            ["Review", reviewStatement(type, p.peer_reviewed)],
            ["Status", <StatusBadge key="s" status={p.status} />],
            ["Paperly ID", <span key="i" className="whitespace-nowrap tabular-nums">{p.paperly_id}</span>],
            ["Previous ID", <span key="o" className="whitespace-nowrap tabular-nums">{p.public_id}</span>],
            ["Published", fmtDate(p.published_at)],
            ["DOI", p.doi ? <DoiLink key="d" doi={p.doi} /> : "Not registered"],
            ["Licence", p.license ?? "\u2014"],
            ["Copyright", p.copyright_holder ?? "Not stated"],
            ["Language", p.language],
            ["Version", p.currentVersionIdentifier ? <span key="v" className="tabular-nums">{p.currentVersion} · {p.currentVersionIdentifier}</span> : p.currentVersion],
          ]} /></div>
        </aside>
      </div>
    </article>
  );
}
