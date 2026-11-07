export const PAPERLY_ID_RE = /^PLY-\d{4}-\d{6}$/;
export const LEGACY_ID_RE = /^RP-\d{4}-\d{6}$/;

export const PUBLICATION_TYPES = ["REPOSITORY_RECORD", "PREPRINT", "JOURNAL_ARTICLE"] as const;
export type PublicationType = (typeof PUBLICATION_TYPES)[number];
export const PUBLICATION_TYPE_LABEL: Record<PublicationType, string> = {
  REPOSITORY_RECORD: "Repository record",
  PREPRINT: "Preprint",
  JOURNAL_ARTICLE: "Journal article",
};

// CRediT (Contributor Roles Taxonomy), 14 roles.
export const CREDIT_ROLES = [
  ["CONCEPTUALIZATION", "Conceptualization"], ["DATA_CURATION", "Data curation"], ["FORMAL_ANALYSIS", "Formal analysis"],
  ["FUNDING_ACQUISITION", "Funding acquisition"], ["INVESTIGATION", "Investigation"], ["METHODOLOGY", "Methodology"],
  ["PROJECT_ADMINISTRATION", "Project administration"], ["RESOURCES", "Resources"], ["SOFTWARE", "Software"],
  ["SUPERVISION", "Supervision"], ["VALIDATION", "Validation"], ["VISUALIZATION", "Visualization"],
  ["WRITING_ORIGINAL_DRAFT", "Writing \u2013 original draft"], ["WRITING_REVIEW_EDITING", "Writing \u2013 review & editing"],
] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number][0];
export const CREDIT_CODES = CREDIT_ROLES.map((r) => r[0]) as unknown as [CreditRole, ...CreditRole[]];
export const CREDIT_LABEL: Record<string, string> = Object.fromEntries(CREDIT_ROLES);

export const AI_USE_CATEGORIES = [
  ["LITERATURE_SEARCH", "Literature search"], ["WRITING", "Writing"], ["LANGUAGE_EDITING", "Language editing"],
  ["DATA_ANALYSIS", "Data analysis"], ["CODING", "Coding"], ["IMAGE_GENERATION", "Image generation"],
  ["FIGURE_GENERATION", "Figure generation"], ["OTHER", "Other"],
] as const;
export type AiUseCategory = (typeof AI_USE_CATEGORIES)[number][0];
export const AI_USE_CODES = AI_USE_CATEGORIES.map((r) => r[0]) as unknown as [AiUseCategory, ...AiUseCategory[]];
export const AI_USE_LABEL: Record<string, string> = Object.fromEntries(AI_USE_CATEGORIES);

/** An AI system can never be an author. Case-insensitive match on common tool names used as an author name. */
const AI_AUTHOR_NAMES = /\b(chat\s?gpt|gpt-?\d|openai|claude|anthropic|gemini|bard|copilot|llama|mistral|perplexity|deepseek|grok)\b/i;
export const looksLikeAiAuthor = (name: string) => AI_AUTHOR_NAMES.test(name);
