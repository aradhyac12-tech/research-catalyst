// Rights declaration policy, enforced on the server (and re-checked by a database trigger, see migration 0010).
// This implements the application's declared policy "rights-1.1"; it does not interpret copyright law.
export const RIGHTS_POLICY_VERSION = "rights-1.1";
export const MANUSCRIPT_VERSION_TYPES = ["PREPRINT", "ACCEPTED_MANUSCRIPT", "PUBLISHER_VERSION", "ORIGINAL_SUBMISSION"] as const;
export type ManuscriptVersionType = (typeof MANUSCRIPT_VERSION_TYPES)[number];

export interface RightsInput {
  is_author: boolean;
  coauthor_permission: boolean;
  has_upload_rights: boolean;
  previously_published: boolean;
  previous_doi?: string | undefined;
  previous_publication_reference?: string | undefined;
  manuscript_version_type: ManuscriptVersionType;
  third_party_content: boolean;
  third_party_permission?: boolean | undefined;
  ai_processing_consent: boolean;
}

const blank = (s: string | undefined) => !s || s.trim().length === 0;

/** Returns every violated rule (empty = acceptable). Messages are shown to the author, so they say what to fix. */
export function validateRights(r: RightsInput, ctx: { authorCount: number }): string[] {
  const v: string[] = [];
  if (!r.is_author) v.push("You must declare that you are an author of this work.");
  if (!r.has_upload_rights) v.push("You must declare that you have the right to upload this manuscript.");
  if (ctx.authorCount > 1 && !r.coauthor_permission) v.push("With several authors, you must declare that all co-authors agreed to this submission.");
  if (r.ai_processing_consent !== true) v.push("Explicit consent to AI-assisted screening is required.");
  if (r.third_party_content && r.third_party_permission !== true) v.push("Third-party content requires a declaration that permission was obtained.");
  if (r.previously_published && blank(r.previous_doi) && blank(r.previous_publication_reference)) v.push("Previously published work needs the previous DOI or a publication reference.");
  if (r.manuscript_version_type === "ORIGINAL_SUBMISSION" && r.previously_published) v.push("An original submission cannot also be previously published; choose the matching manuscript version type.");
  if (r.manuscript_version_type === "PUBLISHER_VERSION" && !r.previously_published) v.push("A publisher version has been published before; declare it as previously published.");
  if (r.manuscript_version_type === "ACCEPTED_MANUSCRIPT" && blank(r.previous_doi) && blank(r.previous_publication_reference)) v.push("An accepted manuscript needs the venue that accepted it (publication reference).");
  return v;
}

/** Mirrors the database trigger. Such records are routed to copyright review; they are never treated as plain original submissions. */
export function requiresCopyrightReview(r: Pick<RightsInput, "manuscript_version_type" | "third_party_content" | "previously_published">): boolean {
  return r.manuscript_version_type === "PUBLISHER_VERSION" || r.third_party_content || r.previously_published;
}
