// Deterministic detector for instructions aimed at automated reviewers.
// Runs independently of the model, so an injection cannot hide itself from this check.
const PATTERNS: RegExp[] = [
  /ignore (all|any|the)? ?(previous|prior|above) (instructions|prompts?)/i,
  /(disregard|forget) (your|all|the) (instructions|rules|system prompt)/i,
  /\b(you are|act as) (now )?(an? )?(ai|assistant|reviewer|language model)\b/i,
  /\b(accept|approve|publish) this (paper|manuscript|submission|article)\b/i,
  /\brate this (paper|manuscript) (highly|positively|as excellent)\b/i,
  /\b(give|assign) (it|this) (a )?(positive|favou?rable|high) (review|score|rating)\b/i,
  /\bsystem prompt\b/i,
  /\bdo not (flag|report|mention)\b/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
  /\bFOR LLM REVIEWERS\b/i,
];

export function detectPromptInjection(text: string): { detected: boolean; matches: string[] } {
  const matches: string[] = [];
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m) matches.push(m[0].slice(0, 120));
  }
  // Zero-width / invisible characters used to hide text
  if (/[\u200B-\u200F\u2060-\u2064\uFEFF]{3,}/.test(text)) matches.push("hidden zero-width characters");
  return { detected: matches.length > 0, matches };
}

/** Neutralize delimiter spoofing before embedding untrusted text into a prompt. */
export function sanitizeForPrompt(text: string, maxChars: number): string {
  return text
    .replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, "")
    .replace(/<\/?\s*manuscript[^>]*>/gi, "[removed-tag]")
    .slice(0, maxChars);
}
