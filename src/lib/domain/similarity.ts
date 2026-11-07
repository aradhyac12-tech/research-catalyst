// Internal similarity engine: word 5-gram shingles, containment score.
// High similarity is a signal for human review, never proof of plagiarism.
function shingles(text: string, n = 5): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

export interface SimilarityMatch { source_id: string; source_title: string; percentage: number }

export function compareAgainstCorpus(text: string, corpus: Array<{ id: string; title: string; text: string }>) {
  const a = shingles(text);
  const matches: SimilarityMatch[] = [];
  if (a.size === 0) return { max_percentage: 0, matches, risk: "LOW" as const };
  for (const doc of corpus) {
    const b = shingles(doc.text);
    if (b.size === 0) continue;
    let inter = 0;
    for (const s of a) if (b.has(s)) inter++;
    const pct = Math.round((inter / Math.min(a.size, b.size)) * 100);
    if (pct >= 10) matches.push({ source_id: doc.id, source_title: doc.title, percentage: pct });
  }
  matches.sort((x, y) => y.percentage - x.percentage);
  const max = matches[0]?.percentage ?? 0;
  const risk = max >= 50 ? "HIGH" : max >= 25 ? "MEDIUM" : "LOW";
  return { max_percentage: max, matches: matches.slice(0, 5), risk: risk as "LOW" | "MEDIUM" | "HIGH" };
}

export function extractDois(text: string, limit = 10): string[] {
  const re = /\b(10\.\d{4,9}\/[^\s"<>,;]+[^\s"<>,;.)\]])/g;
  const set = new Set<string>();
  for (const m of text.matchAll(re)) {
    if (m[1]) set.add(m[1].toLowerCase());
    if (set.size >= limit) break;
  }
  return [...set];
}
