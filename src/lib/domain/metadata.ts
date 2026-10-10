import type { CitablePaper } from "./citation-formats";

export interface MetaPaper extends CitablePaper {
  status: string;
  license: string | null;
  field: string;
  authorsDetailed: Array<{ name: string; orcid?: string | null; affiliations: string[] }>;
}
const XML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => XML_ESC[c]);
const LICENSE_URLS: Record<string, string> = {
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC BY-NC 4.0": "https://creativecommons.org/licenses/by-nc/4.0/",
  "CC BY-NC-ND 4.0": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
};
export const licenseUrl = (l: string | null) => (l ? LICENSE_URLS[l] ?? null : null);

/** schema.org JSON-LD. Uses ScholarlyArticle for all record types; never adds isPartOf/ISSN (no journal exists). */
export function buildJsonLd(p: MetaPaper) {
  return {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    "@id": p.url,
    url: p.url,
    name: p.title,
    headline: p.title,
    identifier: [p.publicId, ...(p.doi ? [`https://doi.org/${p.doi}`] : [])],
    ...(p.doi ? { sameAs: `https://doi.org/${p.doi}` } : {}),
    abstract: p.abstract ?? undefined,
    inLanguage: p.language ?? "en",
    keywords: p.keywords?.length ? p.keywords.join(", ") : undefined,
    datePublished: p.publishedDate ?? undefined,
    version: p.version,
    genre: p.publicationType === "PREPRINT" ? "Preprint" : p.publicationType === "JOURNAL_ARTICLE" ? "Journal article" : "Repository record",
    publisher: { "@type": "Organization", name: "Paperly" },
    license: licenseUrl(p.license) ?? undefined,
    isAccessibleForFree: true,
    author: p.authorsDetailed.map((a) => ({
      "@type": "Person", name: a.name,
      ...(a.orcid ? { sameAs: `https://orcid.org/${a.orcid}` } : {}),
      ...(a.affiliations.length ? { affiliation: a.affiliations.map((o) => ({ "@type": "Organization", name: o })) } : {}),
    })),
  };
}
/** Safe to embed in <script type="application/ld+json">. */
export const jsonLdScript = (obj: unknown) => JSON.stringify(obj).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** Highwire Press + Dublin Core + OpenGraph meta tags. ORCID only passed through when verified (caller's responsibility). */
export function buildMetaTags(p: MetaPaper): Array<Record<string, string>> {
  const t: Array<Record<string, string>> = [];
  const add = (name: string, content: string | null | undefined) => { if (content) t.push({ name, content }); };
  add("citation_title", p.title);
  for (const a of p.authorsDetailed) {
    add("citation_author", a.name);
    for (const o of a.affiliations) add("citation_author_institution", o);
    if (a.orcid) add("citation_author_orcid", `https://orcid.org/${a.orcid}`);
  }
  add("citation_publication_date", p.publishedDate?.replace(/-/g, "/"));
  add("citation_online_date", p.publishedDate?.replace(/-/g, "/"));
  add("citation_publisher", "Paperly");
  add("citation_abstract_html_url", p.url);
  add("citation_doi", p.doi);
  add("citation_language", p.language ?? "en");
  for (const k of p.keywords ?? []) add("citation_keywords", k);
  add("DC.title", p.title);
  for (const a of p.authorsDetailed) add("DC.creator", a.name);
  add("DC.date", p.publishedDate);
  add("DC.identifier", p.doi ? `doi:${p.doi}` : p.publicId);
  add("DC.publisher", "Paperly");
  add("DC.language", p.language ?? "en");
  add("DC.rights", licenseUrl(p.license) ?? p.license);
  add("DC.type", p.publicationType === "PREPRINT" ? "Preprint" : "Text");
  add("DC.description", p.abstract?.slice(0, 500));
  return t;
}

export function buildSitemap(origin: string, rows: Array<{ paperly_id: string; updated_at: string }>) {
  const urls = [`${origin}/`, `${origin}/explore`].map((u) => `<url><loc>${esc(u)}</loc></url>`);
  for (const r of rows) urls.push(`<url><loc>${esc(`${origin}/article/${r.paperly_id}`)}</loc><lastmod>${esc(r.updated_at.slice(0, 10))}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
export function buildRobots(origin: string) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /reviews\nDisallow: /my-research\nDisallow: /submit\nDisallow: /profile\n\nSitemap: ${origin}/sitemap.xml\n`;
}
