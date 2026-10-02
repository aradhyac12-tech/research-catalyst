export interface CitablePaper {
  title: string;
  authors: string[];
  year: number;
  publicId: string;
  doi?: string | null;
  url: string;
  version: string;
}

function splitName(n: string) {
  const parts = n.trim().split(/\s+/);
  const last = parts.pop() ?? "";
  return { last, initials: parts.map((p) => p[0]?.toUpperCase() + ".").join(" "), first: parts.join(" ") };
}

export function formatAPA(p: CitablePaper) {
  const names = p.authors.map((a) => { const s = splitName(a); return `${s.last}, ${s.initials}`.trim(); });
  const au = names.length > 1 ? names.slice(0, -1).join(", ") + ", & " + names[names.length - 1] : names[0] ?? "";
  return `${au} (${p.year}). ${p.title} (Version ${p.version}). Paperly. ${p.doi ? `https://doi.org/${p.doi}` : p.url}`;
}
export function formatVancouver(p: CitablePaper) {
  const names = p.authors.map((a) => { const s = splitName(a); return `${s.last} ${s.initials.replace(/[.\s]/g, "")}`; });
  return `${names.join(", ")}. ${p.title}. Paperly. ${p.year}. ${p.doi ? `doi:${p.doi}` : `Available from: ${p.url}`}`;
}
export function formatMLA(p: CitablePaper) {
  const first = p.authors[0] ? (() => { const s = splitName(p.authors[0]); return `${s.last}, ${s.first}`; })() : "";
  const au = p.authors.length > 2 ? `${first}, et al.` : p.authors.length === 2 ? `${first}, and ${p.authors[1]}` : first;
  return `${au}. "${p.title}." Paperly, ${p.year}, ${p.doi ? `https://doi.org/${p.doi}` : p.url}.`;
}
export function formatBibTeX(p: CitablePaper) {
  const key = (splitName(p.authors[0] ?? "anon").last + p.year).replace(/[^A-Za-z0-9]/g, "");
  return `@article{${key},\n  title = {${p.title}},\n  author = {${p.authors.join(" and ")}},\n  year = {${p.year}},\n  publisher = {Paperly},\n  note = {${p.publicId}, version ${p.version}},\n${p.doi ? `  doi = {${p.doi}},\n` : ""}  url = {${p.url}}\n}`;
}
export function formatRIS(p: CitablePaper) {
  return [
    "TY  - JOUR", `TI  - ${p.title}`, ...p.authors.map((a) => `AU  - ${a}`), `PY  - ${p.year}`, "PB  - Paperly",
    `ID  - ${p.publicId}`, p.doi ? `DO  - ${p.doi}` : null, `UR  - ${p.url}`, "ER  - ",
  ].filter(Boolean).join("\n");
}
