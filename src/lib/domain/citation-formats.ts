// Citation export. Never states a journal, volume, ISSN or DOI that the record does not have.
export interface CitablePaper {
  title: string;
  authors: string[];
  year: number;
  publicId: string; // PLY-YYYY-XXXXXX
  doi?: string | null; // only a VERIFIED DOI
  url: string;
  version: string;
  publicationType?: "REPOSITORY_RECORD" | "PREPRINT" | "JOURNAL_ARTICLE";
  publishedDate?: string | null; // YYYY-MM-DD
  abstract?: string | null;
  keywords?: string[];
  language?: string;
}

const PUBLISHER = "Paperly";
const kindLabel = (p: CitablePaper) =>
  p.publicationType === "PREPRINT" ? "Preprint" : p.publicationType === "JOURNAL_ARTICLE" ? "Journal article" : "Repository record";

function splitName(n: string) {
  const t = n.trim();
  if (t.includes(",")) { // "Last, First Middle"
    const [last, rest = ""] = t.split(",", 2).map((x) => x.trim());
    const given = rest.split(/\s+/).filter(Boolean);
    return { last, given, initials: given.map((g) => g[0].toUpperCase()) };
  }
  const parts = t.split(/\s+/).filter(Boolean);
  const last = parts.pop() ?? "";
  return { last, given: parts, initials: parts.map((g) => g[0].toUpperCase()) };
}
const doiUrl = (d: string) => `https://doi.org/${d}`;
const link = (p: CitablePaper) => (p.doi ? doiUrl(p.doi) : p.url);

export function formatAPA(p: CitablePaper) {
  const names = p.authors.map((a) => { const s = splitName(a); return `${s.last}, ${s.initials.map((i) => i + ".").join(" ")}`.trim(); });
  let au = "";
  if (names.length === 1) au = names[0];
  else if (names.length === 2) au = `${names[0]}, & ${names[1]}`;
  else if (names.length > 2 && names.length <= 20) au = `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  else if (names.length > 20) au = `${names.slice(0, 19).join(", ")}, ... ${names[names.length - 1]}`;
  return `${au} (${p.year}). ${p.title} (Version ${p.version}) [${kindLabel(p)}]. ${PUBLISHER}. ${link(p)}`.trim();
}
export function formatVancouver(p: CitablePaper) {
  const names = p.authors.map((a) => { const s = splitName(a); return `${s.last} ${s.initials.join("")}`; });
  const au = names.length > 6 ? `${names.slice(0, 6).join(", ")}, et al` : names.join(", ");
  return `${au}. ${p.title} [${kindLabel(p).toLowerCase()}]. ${PUBLISHER}; ${p.year}. ${p.doi ? `doi:${p.doi}` : `Available from: ${p.url}`}`;
}
export function formatMLA(p: CitablePaper) {
  const first = p.authors[0] ? (() => { const s = splitName(p.authors[0]); return `${s.last}, ${s.given.join(" ")}`.replace(/,\s*$/, ""); })() : "";
  const au = p.authors.length > 2 ? `${first}, et al.` : p.authors.length === 2 ? `${first}, and ${p.authors[1]}` : first;
  return `${au}. "${p.title}." ${PUBLISHER}, ${p.year}, ${link(p)}.`;
}
const bibEsc = (s: string) => s.replace(/([\\{}%&$#_^~])/g, (m) => (m === "\\" ? "\\textbackslash{}" : m === "~" ? "\\textasciitilde{}" : m === "^" ? "\\textasciicircum{}" : "\\" + m));
export function formatBibTeX(p: CitablePaper) {
  const key = (splitName(p.authors[0] ?? "anon").last + p.year + p.publicId.slice(-6)).replace(/[^A-Za-z0-9]/g, "");
  const type = p.publicationType === "PREPRINT" ? "misc" : "misc"; // no journal exists, so @misc is the honest entry type
  const lines = [
    `  title = {${bibEsc(p.title)}}`,
    `  author = {${p.authors.map((a) => bibEsc(a)).join(" and ")}}`,
    `  year = {${p.year}}`,
    `  publisher = {${PUBLISHER}}`,
    `  howpublished = {${kindLabel(p)}}`,
    `  note = {${p.publicId}, version ${p.version}}`,
    ...(p.doi ? [`  doi = {${p.doi}}`] : []),
    `  url = {${p.url}}`,
  ];
  return `@${type}{${key},\n${lines.join(",\n")}\n}`;
}
export function formatRIS(p: CitablePaper) {
  const d = p.publishedDate ? p.publishedDate.replace(/-/g, "/") : `${p.year}`;
  return [
    "TY  - GEN", `TI  - ${p.title}`, ...p.authors.map((a) => `AU  - ${a}`), `PY  - ${p.year}`, `DA  - ${d}`, `PB  - ${PUBLISHER}`,
    `ID  - ${p.publicId}`, `M3  - ${kindLabel(p)}`, `ET  - ${p.version}`, ...(p.doi ? [`DO  - ${p.doi}`] : []),
    ...(p.keywords ?? []).map((k) => `KW  - ${k}`), ...(p.abstract ? [`AB  - ${p.abstract.replace(/\s+/g, " ")}`] : []),
    `UR  - ${p.url}`, "ER  - ",
  ].join("\n");
}
/** EndNote "Refer/BibIX" import format (tagged, one field per line). */
export function formatEndNote(p: CitablePaper) {
  return [
    "%0 Generic", `%T ${p.title}`, ...p.authors.map((a) => `%A ${a}`), `%D ${p.year}`, `%I ${PUBLISHER}`,
    `%M ${p.publicId}`, `%V ${p.version}`, `%9 ${kindLabel(p)}`, ...(p.doi ? [`%R ${p.doi}`] : []),
    ...(p.keywords ?? []).map((k) => `%K ${k}`), ...(p.abstract ? [`%X ${p.abstract.replace(/\s+/g, " ")}`] : []),
    `%U ${p.url}`,
  ].join("\n");
}
export const CITATION_FORMATS = [
  ["vancouver", "Vancouver", formatVancouver, "text/plain", "txt"],
  ["apa", "APA 7", formatAPA, "text/plain", "txt"],
  ["mla", "MLA 9", formatMLA, "text/plain", "txt"],
  ["bibtex", "BibTeX", formatBibTeX, "application/x-bibtex", "bib"],
  ["ris", "RIS", formatRIS, "application/x-research-info-systems", "ris"],
  ["endnote", "EndNote", formatEndNote, "application/x-endnote-refer", "enw"],
] as const;
