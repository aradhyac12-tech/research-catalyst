/**
 * PDF text to a clean reading structure (headings, paragraphs, lists, references).
 * Pure functions with no DOM and no pdf.js import, so they can be unit-tested. The reader feeds in the raw text items
 * pdf.js returns for each page and gets back blocks that are rendered with React (never as HTML).
 */

export interface RawItem { str: string; x: number; y: number; size: number; width: number; eol?: boolean }
export interface RawPage { width: number; height: number; items: RawItem[] }

export type ReadBlock =
  | { t: "h"; level: 3 | 4; text: string; id: string }
  | { t: "p"; text: string; lead?: boolean }
  | { t: "li"; text: string; ordered: boolean }
  | { t: "ref"; text: string; n: number | null };

export interface ReadResult { blocks: ReadBlock[]; chars: number; headings: Array<{ id: string; text: string; level: 3 | 4 }> }

interface Line { page: number; y: number; x: number; size: number; text: string; right: number; top: boolean; bottom: boolean; h: number }

const norm = (s: string) => s.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, " ").trim();
const SENT_END = /[.!?:;)"'”’\]]$/;
const BULLET = /^([•▪●◦‣⁃−–—\-*])\s+(\S.*)$/;
const NUMBERED = /^(\(?\d{1,2}[.)])\s+(\S.*)$/;
const SECTION = /^(abstract|keywords?|introduction|background|literature review|materials and methods|methods?|methodology|objectives?|aims?|results?( and discussion)?|discussion|conclusions?|limitations?|summary|acknowledg(e)?ments?|funding|conflicts? of interest|references|bibliography)\s*[:.]?$/i;
const NUMBERED_HEAD = /^(\d{1,2}(\.\d{1,2}){0,2})\.?\s+[A-Z][^.!?]{2,90}$/;
const REF_HEAD = /^(references|bibliography|works cited)\s*[:.]?$/i;

function median(a: number[]) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; }

/** Join the text items of one visual line, adding a space where there is a real gap. */
function joinItems(items: RawItem[]): { text: string; right: number } {
  let out = ""; let prevRight = -Infinity; let prevSize = 0;
  for (const it of items) {
    if (!it.str) continue;
    const gap = it.x - prevRight;
    const needSpace = out && !out.endsWith(" ") && !it.str.startsWith(" ") && gap > Math.max(1, prevSize * 0.18);
    out += (needSpace ? " " : "") + it.str;
    prevRight = it.x + it.width; prevSize = it.size || prevSize;
  }
  return { text: out.replace(/\s+/g, " ").trim(), right: prevRight };
}

function toLines(pages: RawPage[]): Line[] {
  const lines: Line[] = [];
  pages.forEach((pg, pi) => {
    const items = pg.items.filter((i) => i.str.trim().length > 0 || i.str === " ");
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: RawItem[][] = [];
    for (const it of sorted) {
      const g = groups[groups.length - 1];
      const ref = g?.[0];
      if (g && ref && Math.abs(ref.y - it.y) <= Math.max(2, Math.min(ref.size, it.size) * 0.45)) g.push(it); else groups.push([it]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      const { text, right } = joinItems(g);
      if (!text) continue;
      const size = Math.max(...g.map((i) => i.size || 0));
      const y = g[0]!.y;
      lines.push({ page: pi, y, x: g[0]!.x, size, text, right, top: y > pg.height * 0.93, bottom: y < pg.height * 0.07, h: pg.height });
    }
  });
  return lines;
}

/** Drop running headers, footers and bare page numbers. */
function stripFurniture(lines: Line[], pageCount: number): Line[] {
  const seen = new Map<string, Set<number>>();
  for (const l of lines) if (l.top || l.bottom) { const k = norm(l.text); if (!k) continue; (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(l.page); }
  const repeated = new Set<string>();
  if (pageCount >= 3) for (const [k, s] of seen) if (s.size >= Math.max(2, Math.ceil(pageCount * 0.5))) repeated.add(k);
  return lines.filter((l) => {
    if (l.top || l.bottom) {
      if (repeated.has(norm(l.text))) return false;
      if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(l.text.trim())) return false;
    }
    return true;
  });
}

const slug = (s: string, used: Set<string>) => {
  const base = "s-" + (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "section");
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id); return id;
};

/** Words that make a "heading" a sentence fragment rather than a heading when the line is only slightly larger than the body. */
const looksLikeHeading = (t: string, big: boolean) => {
  const s = t.trim();
  if (!s || s.length > 120) return false;
  if (SECTION.test(s)) return true;
  if (NUMBERED_HEAD.test(s) && !/[,;]$/.test(s)) return true;
  if (big && !/[,;]$/.test(s)) return true;
  const letters = s.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && s === s.toUpperCase() && !/[.!?]$/.test(s) && s.length <= 70;
};

export function structurePdfText(pages: RawPage[], opts: { title?: string } = {}): ReadResult {
  let lines = stripFurniture(toLines(pages), pages.length);
  if (!lines.length) return { blocks: [], chars: 0, headings: [] };

  // Body size: the font size carrying the most characters.
  const weight = new Map<number, number>();
  for (const l of lines) { const k = Math.round(l.size * 2) / 2; weight.set(k, (weight.get(k) ?? 0) + l.text.length); }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const pageW = median(pages.map((p) => p.width)) || 600;
  const maxRight = (pg: number) => Math.max(...lines.filter((l) => l.page === pg).map((l) => l.right), 0);
  const rightByPage = pages.map((_, i) => maxRight(i));
  const leftMargin = median(lines.map((l) => l.x));

  // The title is already on the page above the reader: drop it from the first page.
  if (opts.title) {
    const t = norm(opts.title);
    let acc = "";
    const drop = new Set<Line>();
    for (const l of lines.filter((x) => x.page === 0 && x.size >= body * 1.25).slice(0, 6)) {
      acc = (acc + " " + norm(l.text)).trim();
      drop.add(l);
      if (acc === t) { lines = lines.filter((x) => !drop.has(x)); break; }
      if (!t.startsWith(acc)) break;
    }
  }

  const headSizes = [...new Set(lines.filter((l) => l.size >= body * 1.12).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const used = new Set<string>();
  const blocks: ReadBlock[] = [];
  const headings: ReadResult["headings"] = [];
  let para: string[] = [];
  let paraLast: Line | null = null;
  let inRefs = false;
  let refN = 0;
  let firstPara = true;

  const joinWrapped = (parts: string[]) => {
    let out = "";
    for (const p of parts) {
      if (!out) { out = p; continue; }
      if (/[a-zà-ÿ]-$/.test(out) && /^[a-zà-ÿ]/.test(p)) out = out.slice(0, -1) + p; // a word split at the line end
      else out += " " + p;
    }
    return out.replace(/\s+/g, " ").trim();
  };
  const flush = () => {
    if (!para.length) return;
    const text = joinWrapped(para);
    para = []; paraLast = null;
    if (!text) return;
    if (inRefs) {
      const m = /^\[?(\d{1,3})[\].)]\s+(.*)$/.exec(text);
      blocks.push({ t: "ref", text: m ? m[2]! : text, n: m ? Number(m[1]) : (++refN, null) });
      return;
    }
    blocks.push({ t: "p", text, lead: firstPara }); firstPara = false;
  };

  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    const sz = Math.round(l.size * 2) / 2;
    const big = l.size >= body * 1.12;
    if (looksLikeHeading(l.text, big) && (big || SECTION.test(l.text.trim()) || NUMBERED_HEAD.test(l.text.trim()) || (l.text === l.text.toUpperCase()))) {
      // Merge a heading wrapped over several lines of the same size.
      let text = l.text;
      let j = i + 1;
      while (big && j < lines.length && lines[j]!.page === l.page && Math.round(lines[j]!.size * 2) / 2 === sz && Math.abs(lines[j]!.y - lines[j - 1]!.y) < l.size * 1.7 && (text + " " + lines[j]!.text).length < 140) { text += " " + lines[j]!.text; j++; }
      flush();
      const level: 3 | 4 = big && headSizes.indexOf(sz) === 0 && headSizes.length > 1 ? 3 : big && headSizes.length === 1 ? 3 : 4;
      const clean = text.replace(/\s+/g, " ").trim().replace(/:$/, "");
      const id = slug(clean, used);
      blocks.push({ t: "h", level, text: clean, id });
      headings.push({ id, text: clean, level });
      inRefs = REF_HEAD.test(clean);
      firstPara = true;
      i = j; continue;
    }

    const prev = paraLast as Line | null;
    const bullet = BULLET.exec(l.text);
    const numbered = !inRefs ? NUMBERED.exec(l.text) : null;
    const refStart = inRefs && (/^\[?\d{1,3}[\].)]\s/.test(l.text) || (prev && l.x <= leftMargin + 1 && prev.right < rightByPage[prev.page]! - pageW * 0.08 && SENT_END.test(prev.text)));
    const gap = prev && prev.page === l.page ? prev.y - l.y : 0;
    const bigGap = !!prev && (prev.page !== l.page ? false : gap > Math.max(l.size, prev.size) * 1.65);
    const shortPrev = !!prev && prev.right < (rightByPage[prev.page] ?? pageW) - pageW * 0.12 && SENT_END.test(prev.text);
    const indented = !!prev && l.x > leftMargin + body * 0.9 && prev.page === l.page && !bullet;
    if (prev && (bigGap || shortPrev || bullet || numbered || refStart || (indented && SENT_END.test(prev.text)))) flush();

    if (bullet || numbered) {
      flush();
      const m = (bullet ?? numbered)!;
      // A list item may wrap onto further lines: collect them until the next break.
      const parts = [m[2]!];
      let j = i + 1;
      while (j < lines.length) {
        const n = lines[j]!;
        const nb = BULLET.test(n.text) || NUMBERED.test(n.text);
        const same = n.page === lines[j - 1]!.page && lines[j - 1]!.y - n.y <= Math.max(n.size, lines[j - 1]!.size) * 1.5;
        if (nb || !same || looksLikeHeading(n.text, n.size >= body * 1.12) || SENT_END.test(lines[j - 1]!.text) && lines[j - 1]!.right < (rightByPage[lines[j - 1]!.page] ?? pageW) - pageW * 0.12) break;
        parts.push(n.text); j++;
      }
      blocks.push({ t: "li", text: joinWrapped(parts), ordered: !!numbered && !bullet });
      i = j; continue;
    }
    para.push(l.text); paraLast = l; i++;
  }
  flush();
  const chars = blocks.reduce((n, b) => n + ("text" in b ? b.text.length : 0), 0);
  return { blocks, chars, headings };
}

/** Estimated reading time in whole minutes at an adult silent-reading pace. */
export const readingMinutes = (chars: number) => Math.max(1, Math.round(chars / 5 / 230));
