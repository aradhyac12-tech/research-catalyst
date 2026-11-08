/** Journal identity and journal-style helpers shared by the web pages, the certificates and the stamped article download. */
export const JOURNAL_SUBTITLE = "International Journal of Medical Innovation";
export const JOURNAL_NAME = `Paperly ${JOURNAL_SUBTITLE}`;
/** Volume 01 is the year the journal started; the issue is the month (monthly issues), as in "Volume:08/Issue:05/May-2026". */
export const JOURNAL_FIRST_YEAR = 2026;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Volume:01/Issue:10/October-2026" for a date (UTC). Falls back to today when the date is missing or invalid. */
export function journalIssueLine(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : new Date();
  const d = Number.isFinite(t.getTime()) ? t : new Date();
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return `Volume:${pad2(Math.max(1, y - JOURNAL_FIRST_YEAR + 1))}/Issue:${pad2(m + 1)}/${MONTHS[m]}-${y}`;
}

const TEACHER_RE = /\b(lecturer|professor|teacher|faculty member|supervisor|head of|dr\.?|assistant professor|associate professor)\b/i;
export const isTeacherAffiliation = (aff: string | null | undefined) => !!aff && TEACHER_RE.test(aff) && !/\bstudent/i.test(aff);

/** Teacher (lecturer, professor...) first, then students and the rest, each group keeping its original order. */
export function orderTeacherFirst<T>(authors: readonly T[], affiliationOf: (a: T) => string | null | undefined): T[] {
  return [...authors.filter((a) => isTeacherAffiliation(affiliationOf(a))), ...authors.filter((a) => !isTeacherAffiliation(affiliationOf(a)))];
}

/** Each author gets their own number (1, 2, 3...). Authors sharing the same affiliation text share one line: "2,3,4 Student, ...". */
export function numberAffiliations<T>(ordered: readonly T[], affiliationOf: (a: T) => string | null | undefined): Array<{ numbers: number[]; text: string }> {
  const groups = new Map<string, number[]>();
  ordered.forEach((a, i) => { const t = (affiliationOf(a) ?? "").trim(); if (t) groups.set(t, [...(groups.get(t) ?? []), i + 1]); });
  return [...groups.entries()].map(([text, numbers]) => ({ numbers, text }));
}

const SECTION_RE = /^(abstract|keywords?|introduction|background|literature review|materials and methods|methods?|methodology|objectives?|aims?|results?( and discussion)?|discussion|conclusions?|summary|acknowledg(e)?ments?|references|bibliography)\s*[:.]?\s*$/i;
export const looksLikeSection = (t: string) => { const s = t.trim(); return s.length > 0 && s.length <= 70 && (SECTION_RE.test(s) || (s === s.toUpperCase() && /[A-Z]{3}/.test(s) && !/[.!?]$/.test(s))); };
export const KEYWORDS_INLINE_RE = /^keywords?\s*[:\-–—]\s*(.+)$/i;
