// Suggests an abstract, keywords and references for the submit form from the author's own file. Authenticated, consent-gated, rate-limited.
// The manuscript text goes to the same external AI providers as screening (Gemini, then Groq, then Anthropic when keys exist) and is never stored or logged here;
// when a provider fails, only its name, the step and the provider's own error reason are logged, so a dead model name or a quota problem shows up in the server logs.
import { canSuggestMetadata } from "@/lib/domain/permissions";
import { getRoles } from "./core.server";
import { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL } from "./ai-provider.server";
import { MAX_UPLOAD_BYTES, extractDocxText, scanManuscript } from "@/lib/domain/file-security";
import {
  HEAD_CHARS, MAX_CHUNKS, cleanAbstract, SUGGEST_SYSTEM, buildSuggestPrompt, chunkLines, cleanKeywords, formatReferences, numberedReferences, parseSuggestWire, splitReferenceSection, verifyReferences, type SuggestWire,
} from "@/lib/domain/metadata-suggest";

export interface SuggestResult {
  abstract: string;
  abstractFrom: "FILE" | "AI" | "NONE";
  keywords: string[];
  references: string;
  referenceCount: number;
  droppedReferences: number;
  keywordsFrom: "AI" | "NONE";
  referencesFrom: "AI" | "LISTING" | "NONE";
  notes: string[];
}

const log = (event: string, extra: Record<string, unknown> = {}) => console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...extra })); // provider status only: never manuscript text

const recent = new Map<string, number[]>();
/** Six runs per ten minutes per person: the model call costs money and the file is large. (Per server instance; a hard limit would need a database counter.) */
function allowed(uid: string) {
  const now = Date.now();
  const list = (recent.get(uid) ?? []).filter((t) => now - t < 600_000);
  if (list.length >= 6) return false;
  list.push(now); recent.set(uid, list);
  return true;
}

/** Output budgets. The front-matter request returns an abstract (up to 5000 characters) and keywords; a reference request copies back one chunk of the list (CHUNK_CHARS). Kept small because Groq's free tier counts the requested output against a 12,000 tokens-per-minute limit. */
const MAX_OUT_FRONT = 2000;
const MAX_OUT_REFS = 3500;
async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const payload = (await res.json().catch(() => null)) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok || !payload) {
    const detail = String(payload?.["error"]?.message ?? payload?.["error"] ?? "").replace(/\s+/g, " ").slice(0, 160); // the provider's own reason (wrong model, quota, rate limit); it never contains the key, which travels in a header
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return payload;
}

type Provider = { name: string; run: (prompt: string, timeoutMs: number, maxOut: number, system?: string) => Promise<string> };
function providers(): Provider[] {
  const list: Provider[] = [];
  const g = process.env["GEMINI_API_KEY"], q = process.env["GROQ_API_KEY"], a = process.env["ANTHROPIC_API_KEY"];
  if (g) list.push({ name: "gemini", run: async (prompt, t, maxOut, system = SUGGEST_SYSTEM) => {
    const call = (model: string, thinking: boolean) => post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": g }, {
      systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Gemini 3 models think by default and thinking tokens count against the output limit, which can cut the JSON off: ask for minimal thinking and leave headroom.
      generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: maxOut * 2, ...(thinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
    }, t);
    const primary = process.env["GEMINI_MODEL"] ?? GEMINI_DEFAULT_MODEL;
    let p: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { p = await call(primary, true); }
    catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("HTTP 400")) p = await call(primary, false); // this model does not accept the thinking setting
      else if (msg.startsWith("HTTP 404") && primary !== GEMINI_FALLBACK_MODEL) p = await call(GEMINI_FALLBACK_MODEL, false); // the model name has been retired
      else throw e;
    }
    return (p["candidates"]?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? "").join("");
  } });
  if (q) list.push({ name: "groq", run: async (prompt, t, maxOut, system = SUGGEST_SYSTEM) => {
    const model = process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile";
    const p = await post("https://api.groq.com/openai/v1/chat/completions", { Authorization: `Bearer ${q}` }, {
      model, temperature: 0, max_tokens: maxOut, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    }, t);
    return String(p["choices"]?.[0]?.message?.content ?? "");
  } });
  if (a) list.push({ name: "anthropic", run: async (prompt, t, maxOut, system = SUGGEST_SYSTEM) => {
    const model = process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5-5";
    const p = await post("https://api.anthropic.com/v1/messages", { "x-api-key": a, "anthropic-version": "2023-06-01" }, { model, max_tokens: maxOut, temperature: 0, system, messages: [{ role: "user", content: prompt }] }, t);
    return (p["content"] ?? []).map((x: { text?: string }) => x.text ?? "").join("");
  } });
  return list;
}

/** One prompt through the provider chain; the first answer that parses wins. Returns null when none could answer. */
async function ask(prompt: string, started: number, maxOut: number, what: string): Promise<SuggestWire | null> {
  for (const p of providers()) {
    if (Date.now() - started > 45_000) return null;
    try { return parseSuggestWire(await p.run(prompt, 25_000, maxOut)); }
    catch (e) { log("suggest_provider_failed", { provider: p.name, step: what, reason: (e instanceof Error ? e.message : "unknown").slice(0, 240) }); /* try the next provider */ }
  }
  return null;
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping results in order. Many parallel model calls trip per-minute limits and make every provider fail. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i); }));
  return out;
}

export async function suggestFromFile(userId: string, file: File, aiConsent: boolean): Promise<SuggestResult> {
  if (!canSuggestMetadata(await getRoles(userId))) throw new Error("Forbidden: automatic abstract, keywords and references are available to founder and administrator uploads only. Type your abstract and keywords and paste your references.");
  if (!aiConsent) throw new Error("Tick the AI consent box first. The manuscript text is sent to an external AI service to make these suggestions.");
  if (providers().length === 0) throw new Error("AI suggestions are not available right now. Type your keywords and paste your references instead.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 25 MB limit");
  if (!allowed(userId)) throw new Error("Please wait a few minutes before suggesting again.");
  const isDocx = /\.docx$/i.test(file.name);
  if (!isDocx && !/\.pdf$/i.test(file.name)) throw new Error("Attach your manuscript as a PDF or DOCX file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scan = scanManuscript(bytes, isDocx ? "manuscript.docx" : "manuscript.pdf", "");
  if (!scan.passed) throw new Error("This file did not pass the safety check, so it cannot be read.");
  const { extractPdfText } = await import("./pipeline.server");
  let text = "";
  try { text = isDocx ? await extractDocxText(bytes) : await extractPdfText(bytes); } catch { /* handled below */ }
  if (text.trim().length < 200) throw new Error("No readable text was found in this file (a scanned PDF has none). Type your keywords and paste your references instead.");

  const started = Date.now();
  const { body, references: section } = splitReferenceSection(text);
  const head = body.slice(0, HEAD_CHARS);
  const notes: string[] = [];

  // Abstract and keywords: their own request, so a long reference list can never crowd them out or make them fail with it.
  const front = await ask(buildSuggestPrompt({ head, referencePart: "", part: 1, parts: 1 }), started, MAX_OUT_FRONT, "abstract_keywords");
  const ab = front ? cleanAbstract(front.abstract, text) : { text: "", from: "NONE" as const };
  if (!front) notes.push("The AI service did not answer, so no abstract or keywords were suggested. Wait a minute and try again, or type them in.");
  else if (ab.from === "NONE") notes.push("An abstract could not be suggested. Type it in.");
  else if (ab.from === "AI") notes.push("Your file has no abstract, so the AI wrote one from the text. Read it carefully and edit it before you continue.");
  const keywords = front ? cleanKeywords(front.keywords) : [];
  const keywordsFrom: SuggestResult["keywordsFrom"] = keywords.length ? "AI" : "NONE";
  if (front && !keywords.length) notes.push("Keywords could not be suggested. Type them in.");

  // References are only ever copied from the file. A clearly numbered list is split straight from the text (exact, instant, and not subject to model limits);
  // any other list is read by the AI in short pieces, and each entry it returns must really be in the file.
  let refs: string[] = [], dropped = 0, referencesFrom: SuggestResult["referencesFrom"] = "NONE";
  if (!section) notes.push("No reference list was found in the file (no \"References\" heading). Paste your references if you have them.");
  else {
    const direct = numberedReferences(section);
    if (direct.length >= 3) {
      refs = direct; referencesFrom = "LISTING";
      notes.push("Your numbered reference list was copied straight from the file. Check the entries, especially where a page break falls inside one.");
    } else {
      const chunks = chunkLines(section);
      const answers = await mapLimit(chunks, 2, (c, i) => ask(buildSuggestPrompt({ referencePart: c, part: i + 1, parts: chunks.length }), started, MAX_OUT_REFS, `references_${i + 1}_of_${chunks.length}`));
      const got = answers.filter((a): a is SuggestWire => a !== null);
      if (got.length) {
        const v = verifyReferences(got.flatMap((a) => a.references), section);
        refs = v.kept; dropped = v.dropped; referencesFrom = refs.length ? "AI" : "NONE";
      }
      if (got.length < answers.length) notes.push(`The AI service did not answer for ${answers.length - got.length} of ${answers.length} parts of the reference list, so some references may be missing. Check the list or try again.`);
      else if (!refs.length) notes.push("The reference list could not be read automatically. Paste your references instead.");
      if (dropped > 0) notes.push(`${dropped} entr${dropped === 1 ? "y" : "ies"} returned by the AI did not match your reference list text and ${dropped === 1 ? "was" : "were"} left out. Check that none of your references is missing.`);
      if (chunks.length >= MAX_CHUNKS) notes.push("A very long reference list was read only in part. Check the end of the list.");
    }
  }
  return { abstract: ab.text, abstractFrom: ab.from, keywords, references: formatReferences(refs), referenceCount: refs.length, droppedReferences: dropped, keywordsFrom, referencesFrom, notes };
}

/** One free-form JSON request through the same provider chain (used by the admin e-mail drafter). Returns the raw answer, or null when no provider could answer. */
export async function askAiJson(system: string, prompt: string, maxOut: number): Promise<string | null> {
  const started = Date.now();
  for (const p of providers()) {
    if (Date.now() - started > 40_000) return null;
    try { return await p.run(prompt, 25_000, maxOut, system); }
    catch (e) { log("admin_email_provider_failed", { provider: p.name, reason: (e instanceof Error ? e.message : "unknown").slice(0, 240) }); }
  }
  return null;
}
export const aiAvailable = () => providers().length > 0;
