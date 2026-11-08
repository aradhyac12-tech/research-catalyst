/** Prepares converted full-text HTML (from Word or PDF) for the reading view: anchors on headings, a contents list, and a reading time. Pure string work, so it runs on the server and in the browser. */
export interface ReaderToc { id: string; text: string; level: number }
export interface ReaderDoc { html: string; toc: ReaderToc[]; words: number; minutes: number }

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&emsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function prepareReader(html: string): ReaderDoc {
  const toc: ReaderToc[] = [];
  const out = html.replace(/<h([3-6])>([\s\S]*?)<\/h\1>/g, (_m, lvl: string, inner: string) => {
    const text = stripTags(inner);
    if (!text) return "";
    const id = `sec-${toc.length + 1}-${slug(text)}`;
    toc.push({ id, text, level: Number(lvl) });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  const words = stripTags(out).split(" ").filter(Boolean).length;
  return { html: out, toc, words, minutes: Math.max(1, Math.round(words / 220)) };
}
