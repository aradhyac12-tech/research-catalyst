// Reference parsing and validation classification. A reference is never called "fake":
// the strongest negative claim is "DOI not found", which means the DOI was not resolved by the lookup service.
export const REFERENCE_STATUSES = ["NOT_CHECKED", "VERIFIED", "PARTIALLY_VERIFIED", "DOI_NOT_FOUND", "REQUIRES_REVIEW"] as const;
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];

export const REFERENCE_STATUS_LABEL: Record<ReferenceStatus, string> = {
  NOT_CHECKED: "Not checked",
  VERIFIED: "DOI resolves and title matches",
  PARTIALLY_VERIFIED: "DOI resolves; title only partly matches",
  DOI_NOT_FOUND: "DOI not found by the lookup service",
  REQUIRES_REVIEW: "Needs human review",
};

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
export function extractDoi(text: string): string | null {
  const m = DOI_RE.exec(text);
  if (!m) return null;
  return m[1].replace(/[.,;:)\]]+$/, "").toLowerCase();
}

/** Split a pasted reference list into entries: numbered lines ("1.", "[1]", "1)") or one per non-empty line / blank-line block. */
export function parseReferences(text: string): Array<{ raw: string; doi: string | null }> {
  const lines = text.replace(/\r/g, "").split("\n");
  const entries: string[] = [];
  const numbered = /^\s*(\[\d{1,3}\]|\d{1,3}[.)])\s+/;
  const anyNumbered = lines.some((l) => numbered.test(l));
  if (anyNumbered) {
    for (const l of lines) {
      if (numbered.test(l)) entries.push(l.replace(numbered, "").trim());
      else if (l.trim() && entries.length) entries[entries.length - 1] += " " + l.trim();
    }
  } else {
    let cur = "";
    for (const l of lines) {
      if (!l.trim()) { if (cur) entries.push(cur); cur = ""; } else cur = cur ? cur + " " + l.trim() : l.trim();
    }
    if (cur) entries.push(cur);
    // A single block with several lines and no blank lines is most likely one reference per line.
    if (entries.length === 1 && lines.filter((l) => l.trim()).length > 1) {
      return lines.map((l) => l.trim()).filter((l) => l.length >= 5).map((raw) => ({ raw, doi: extractDoi(raw) }));
    }
  }
  return entries.filter((e) => e.length >= 5).map((raw) => ({ raw, doi: extractDoi(raw) }));
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Token-overlap (Dice) similarity of two titles, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(norm(b).split(" ").filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return (2 * hit) / (ta.size + tb.size);
}

export type LookupOutcome =
  | { kind: "found"; title: string | null }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/** Pure classification. `rawText` is what the author wrote; the lookup result comes from the DOI agency. */
export function classifyReference(rawText: string, doi: string | null, lookup: LookupOutcome | null): { status: ReferenceStatus; note: string } {
  if (!doi) return { status: "REQUIRES_REVIEW", note: "No DOI in this reference, so it cannot be checked automatically." };
  if (!lookup || lookup.kind === "unavailable") return { status: "REQUIRES_REVIEW", note: "The lookup service could not be reached. Not a finding about the reference." };
  if (lookup.kind === "not_found") return { status: "DOI_NOT_FOUND", note: "The lookup service has no record of this DOI. It may be mistyped or registered elsewhere; an editor should check it." };
  if (!lookup.title) return { status: "PARTIALLY_VERIFIED", note: "The DOI resolves but the record has no title to compare." };
  const sim = titleSimilarity(rawText, lookup.title);
  if (sim >= 0.6) return { status: "VERIFIED", note: `DOI resolves; title overlap ${(sim * 100).toFixed(0)}%.` };
  if (sim >= 0.3) return { status: "PARTIALLY_VERIFIED", note: `DOI resolves; title overlap only ${(sim * 100).toFixed(0)}%. An editor should compare.` };
  return { status: "REQUIRES_REVIEW", note: `DOI resolves but the title differs from the text (overlap ${(sim * 100).toFixed(0)}%). An editor should compare.` };
}
