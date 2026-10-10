/** Keywords are stored as a list; a tracked change holds them as one comma-separated line. */
export const KEYWORD_MAX_LENGTH = 60;
export const KEYWORDS_MAX_COUNT = 12;

/** Accepts commas, semicolons or line breaks between keywords. */
export const parseKeywords = (s: string): string[] => [...new Set(s.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean))];

/** Plain-language problem with a keyword entry, or null. Shared by the submit form (live) and kept in step with the server limits. */
export function keywordProblem(raw: string): string | null {
  const list = parseKeywords(raw);
  if (list.length === 0) return "Add at least one keyword.";
  if (list.length > KEYWORDS_MAX_COUNT) return `You have ${list.length} keywords; the limit is ${KEYWORDS_MAX_COUNT}.`;
  const i = list.findIndex((k) => k.length > KEYWORD_MAX_LENGTH);
  if (i >= 0) return `Keyword ${i + 1} is ${list[i]!.length} characters long (limit ${KEYWORD_MAX_LENGTH} each). Separate keywords with commas.`;
  return null;
}
