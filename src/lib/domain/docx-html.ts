import { looksLikeSection, KEYWORDS_INLINE_RE } from "./journal";
import { listZip, readZipEntry } from "./file-security";

/**
 * Word (.docx) to safe HTML for the public article page.
 * No DOM and no dependencies, so it runs in the server runtime. Output is built from escaped text and a fixed tag set only:
 * headings, paragraphs, lists, tables, bold/italic/underline/sub/superscript, http(s) links, and PNG/JPEG/GIF/WebP images as data URIs.
 * Macros, scripts and anything else in the file are never copied through.
 */

interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const ENT: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (_m, g: string) => {
    if (g.startsWith("#x")) return safeCp(parseInt(g.slice(2), 16));
    if (g.startsWith("#")) return safeCp(parseInt(g.slice(1), 10));
    return ENT[g] ?? "";
  });
const safeCp = (n: number) => { try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; } catch { return ""; } };

export function parseXml(xml: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s>/]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) { top.children.push({ name: "#text", attrs: {}, children: [], text: m[1] }); continue; }
    if (m[6] !== undefined) { top.children.push({ name: "#text", attrs: {}, children: [], text: decodeEntities(m[6]) }); continue; }
    const name = m[3];
    if (!name) continue;
    if (m[2] === "/") { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[4] ?? ""))) attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
    const node: XNode = { name, attrs, children: [], text: "" };
    top.children.push(node);
    if (m[5] !== "/") { stack.push(node); if (stack.length > 200) throw new Error("XML too deeply nested"); }
  }
  return root;
}

const kids = (n: XNode | undefined, name: string) => (n?.children ?? []).filter((c) => c.name === name);
const kid = (n: XNode | undefined, name: string) => (n?.children ?? []).find((c) => c.name === name);
const attr = (n: XNode | undefined, name: string) => n?.attrs[name];
function descendants(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) { if (c.name === name) out.push(c); descendants(c, name, out); }
  return out;
}
const textOf = (n: XNode): string => (n.name === "#text" ? n.text : n.children.map(textOf).join(""));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const flagOn = (n: XNode | undefined) => !!n && !["0", "false", "off", "none"].includes((attr(n, "w:val") ?? "").toLowerCase());

const IMG_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const MAX_IMG = 4 * 1024 * 1024;
const MAX_IMG_TOTAL = 16 * 1024 * 1024;
export const MAX_HTML_CHARS = 6_000_000;

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Plain-text blocks in reading order, for places that cannot show HTML (the downloadable PDF rendering of a Word file). */
export type DocxBlock = { kind: "h" | "p" | "li" | "row"; level: number; text: string };
export interface DocxHtml { html: string; truncated: boolean; blocks: DocxBlock[] }
const plain = (h: string) => h.replace(/<br>/g, " ").replace(/&emsp;/g, " ").replace(/<img[^>]*>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export async function docxToHtml(bytes: Uint8Array): Promise<DocxHtml> {
  const entries = listZip(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const readText = async (name: string) => { const e = byName.get(name); return e ? new TextDecoder().decode(await readZipEntry(bytes, e)) : null; };

  const docXml = await readText("word/document.xml");
  if (!docXml) throw new Error("word/document.xml missing");
  const doc = parseXml(docXml);
  const body = kid(kid(doc, "w:document"), "w:body");
  if (!body) throw new Error("Empty Word document");

  // relationships: id -> { target, external }
  const rels = new Map<string, { target: string; external: boolean }>();
  const relsXml = await readText("word/_rels/document.xml.rels");
  if (relsXml) for (const r of descendants(parseXml(relsXml), "Relationship")) {
    const id = attr(r, "Id"), target = attr(r, "Target");
    if (id && target) rels.set(id, { target, external: attr(r, "TargetMode") === "External" });
  }

  // numbering: numId -> level -> ordered?
  const numFmt = new Map<string, Map<number, boolean>>();
  const numXml = await readText("word/numbering.xml");
  if (numXml) {
    const nr = parseXml(numXml);
    const abs = new Map<string, Map<number, boolean>>();
    for (const an of descendants(nr, "w:abstractNum")) {
      const lv = new Map<number, boolean>();
      for (const l of kids(an, "w:lvl")) lv.set(Number(attr(l, "w:ilvl") ?? 0), (attr(kid(l, "w:numFmt"), "w:val") ?? "decimal") !== "bullet");
      abs.set(attr(an, "w:abstractNumId") ?? "", lv);
    }
    for (const n of descendants(nr, "w:num")) {
      const a = abs.get(attr(kid(n, "w:abstractNumId"), "w:val") ?? "");
      if (a && attr(n, "w:numId")) numFmt.set(attr(n, "w:numId")!, a);
    }
  }

  let imgTotal = 0;
  const imageSrc = async (rid: string): Promise<string | null> => {
    const r = rels.get(rid);
    if (!r || r.external) return null;
    const path = r.target.startsWith("/") ? r.target.slice(1) : `word/${r.target}`.replace(/\/\.\//g, "/");
    const e = byName.get(path);
    const mime = IMG_MIME[(path.split(".").pop() ?? "").toLowerCase()];
    if (!e || !mime || e.size > MAX_IMG || imgTotal + e.size > MAX_IMG_TOTAL) return null;
    imgTotal += e.size;
    return `data:${mime};base64,${b64(await readZipEntry(bytes, e, MAX_IMG))}`;
  };

  async function runHtml(r: XNode): Promise<string> {
    const rPr = kid(r, "w:rPr");
    let out = "";
    for (const c of r.children) {
      if (c.name === "w:t") out += esc(textOf(c));
      else if (c.name === "w:tab") out += "&emsp;";
      else if (c.name === "w:br" || c.name === "w:cr") out += attr(c, "w:type") === "page" ? "" : "<br>";
      else if (c.name === "w:noBreakHyphen") out += "-";
      else if (c.name === "w:drawing" || c.name === "w:pict") {
        const blip = descendants(c, "a:blip")[0] ?? descendants(c, "v:imagedata")[0];
        const rid = attr(blip, "r:embed") ?? attr(blip, "r:id");
        const src = rid ? await imageSrc(rid) : null;
        const alt = attr(descendants(c, "wp:docPr")[0], "descr") ?? "";
        if (src) out += `<img src="${src}" alt="${esc(alt)}" loading="lazy">`;
      }
    }
    if (!out) return "";
    if (flagOn(kid(rPr, "w:b"))) out = `<strong>${out}</strong>`;
    if (flagOn(kid(rPr, "w:i"))) out = `<em>${out}</em>`;
    if (flagOn(kid(rPr, "w:u"))) out = `<u>${out}</u>`;
    if (flagOn(kid(rPr, "w:strike"))) out = `<s>${out}</s>`;
    const va = attr(kid(rPr, "w:vertAlign"), "w:val");
    if (va === "superscript") out = `<sup>${out}</sup>`;
    else if (va === "subscript") out = `<sub>${out}</sub>`;
    return out;
  }

  async function inline(n: XNode): Promise<string> {
    let out = "";
    for (const c of n.children) {
      if (c.name === "w:r") out += await runHtml(c);
      else if (c.name === "w:hyperlink") {
        const inner = await inline(c);
        const rid = attr(c, "r:id");
        const t = rid ? rels.get(rid) : undefined;
        out += t?.external && /^https?:\/\//i.test(t.target) ? `<a href="${esc(t.target)}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>` : inner;
      } else if (c.name === "m:oMath" || c.name === "m:oMathPara") {
        out += `<span class="math">${esc(descendants(c, "m:t").map(textOf).join(" "))}</span>`;
      } else if (["w:ins", "w:smartTag", "w:sdt", "w:sdtContent", "w:fldSimple"].includes(c.name)) out += await inline(c);
      // w:del, w:pPr, bookmarks, comments, field instructions are skipped on purpose
    }
    return out;
  }

  let out = "";
  const blocks: DocxBlock[] = [];
  let inTable = 0;
  const lists: Array<{ tag: "ul" | "ol"; liOpen: boolean }> = [];
  const closeLists = (to = 0) => {
    while (lists.length > to) { const l = lists.pop()!; out += `${l.liOpen ? "</li>" : ""}</${l.tag}>`; }
  };

  async function block(n: XNode): Promise<void> {
    if (out.length > MAX_HTML_CHARS) return;
    if (n.name === "w:sdt") { for (const c of kid(n, "w:sdtContent")?.children ?? []) await block(c); return; }
    if (n.name === "w:tbl") {
      closeLists();
      out += `<div class="ft-table"><table><tbody>`;
      inTable++;
      for (const tr of kids(n, "w:tr")) {
        const head = !!kid(kid(tr, "w:trPr"), "w:tblHeader");
        const cells: string[] = [];
        out += "<tr>";
        for (const tc of kids(tr, "w:tc")) {
          const span = Number(attr(kid(kid(tc, "w:tcPr"), "w:gridSpan"), "w:val") ?? 1);
          const tag = head ? "th" : "td";
          out += `<${tag}${span > 1 && span < 50 ? ` colspan="${span}"` : ""}>`;
          const saved = out; out = "";
          for (const c of tc.children) await block(c);
          closeLists();
          const cell = out; out = saved + cell;
          cells.push(plain(cell));
          out += `</${tag}>`;
        }
        out += "</tr>";
        if (cells.some(Boolean)) blocks.push({ kind: "row", level: 0, text: cells.join("  |  ") });
      }
      inTable--;
      out += "</tbody></table></div>";
      return;
    }
    if (n.name !== "w:p") return;
    const pPr = kid(n, "w:pPr");
    const style = attr(kid(pPr, "w:pStyle"), "w:val") ?? "";
    const inner = await inline(n);
    const numPr = kid(pPr, "w:numPr");
    const numId = attr(kid(numPr, "w:numId"), "w:val");
    if (numPr && numId && numId !== "0" && inner.trim()) {
      const lvl = Math.min(Number(attr(kid(numPr, "w:ilvl"), "w:val") ?? 0) || 0, 5);
      const ordered = numFmt.get(numId)?.get(lvl) ?? false;
      const tag = ordered ? "ol" : "ul";
      closeLists(lvl + 1);
      const cur = lists[lvl];
      if (cur && cur.tag !== tag) closeLists(lvl);
      while (lists.length < lvl + 1) { out += `<${tag}>`; lists.push({ tag, liOpen: false }); }
      const l = lists[lvl]!;
      if (l.liOpen) out += "</li>";
      out += `<li>${inner}`; l.liOpen = true;
      if (!inTable) blocks.push({ kind: "li", level: lvl, text: plain(inner) });
      return;
    }
    closeLists();
    if (!inner.trim() && !inner.includes("<img")) return;
    const h = /^heading\s*([1-6])$/i.exec(style);
    if (h) { const lvl = Math.min(Number(h[1]) + 2, 6); out += `<h${lvl}>${inner}</h${lvl}>`; if (!inTable) blocks.push({ kind: "h", level: lvl, text: plain(inner) }); return; }
    if (/^title$/i.test(style)) { out += `<p class="ft-title"><strong>${inner}</strong></p>`; if (!inTable) blocks.push({ kind: "h", level: 3, text: plain(inner) }); return; }
    const ptxt = plain(inner);
    if (!inTable && ptxt && looksLikeSection(ptxt)) { out += `<h4>${inner}</h4>`; blocks.push({ kind: "h", level: 4, text: ptxt }); return; }
    const kw = !inTable ? KEYWORDS_INLINE_RE.exec(ptxt) : null;
    if (kw) { const list = kw[1]!.replace(/\s*[\n|]+\s*/g, ", "); out += `<p class="ft-kw"><strong>Keywords:</strong> ${list.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`; blocks.push({ kind: "p", level: 0, text: `Keywords: ${list}` }); return; }
    const jc = attr(kid(pPr, "w:jc"), "w:val");
    out += `<p${jc === "center" ? ' class="ft-center"' : ""}>${inner}</p>`;
    if (!inTable && plain(inner)) blocks.push({ kind: "p", level: 0, text: plain(inner) });
  }

  for (const c of body.children) await block(c);
  closeLists();
  const truncated = out.length > MAX_HTML_CHARS;
  return { html: out, truncated, blocks };
}
