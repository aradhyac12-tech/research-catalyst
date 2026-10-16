# M-4 notes
- Migration 0006 adds paper_references, wider notice kinds (ERRATUM, ADDENDUM, WITHDRAWAL), wider DOI states, doi_only_when_confirmed (NOT VALID), explorer indexes.
- Reference checks look up DOIs at Crossref (optional env CROSSREF_MAILTO). Results are labelled lookups, never "fake".
- DOI registration agencies remain stubs: no DOI is ever produced without a verified agency response.
- Notices are append-only and public; retraction/withdrawal marks certificates RETRACTED.
- robots.txt and sitemap.xml are now server routes (public/robots.txt removed).
- Not yet done: ISSN/journal identity pages, /editorial-board, public policy pages, APC page, certificate wording review, role dashboards, audit-log viewer, security tests (M-5).

# M-5 notes
- Migrations 0007 (journal identity, editorial board) and 0008 (privilege hardening). Run in order after 0006.
- Public pages: /about, /policies, /policies/:slug, /fees, /editorial-board, /verify/certificate/:id. /dashboard is role-based.
- Tests: supabase_tests/0005..0009 (run against a scratch DB), tests/server-functions-auth.test.mjs (node).

## Author accept/reject of tracked changes (migration 0019)
- The author of a paper can accept or reject each proposed tracked change (title, abstract, keywords) on /manuscript/$paperId while the paper is in editorial handling or review.
- Accept applies the text to the paper (keywords are split on commas); reject leaves the paper unchanged. Both keep the row (status ACCEPTED/REJECTED, decided_by, decided_at), write an audit entry and notify the editor.
- Server: `authorDecideEdit` in manuscript.server.ts. Client: `decideTrackedChange` in manuscript.functions.ts. No new route, so routeTree.gen.ts is unchanged.

## Optional reasons on decisions (migration 0020)
- Editor and reviewer decisions (approve / disapprove / revisions) no longer require written text. A box asks "What changes are needed, or why you disapprove" and is optional; anything written is shown to the author.
- Migration 0020 relaxes `review_completed_has_content` so a completed review needs no comments.
- The author is notified when the editor first makes a tracked change to a field, and on the editor's decision (approval reads "Your research paper has been approved and submitted.", with a count of tracked changes).

## Papers no longer get stuck when AI screening cannot run
- If the AI provider is missing or fails (for example `ANTHROPIC_API_KEY` is not set), the paper used to stay in AI_SCREENING and no editor decision was possible ("The paper is not awaiting an editorial decision").
- Screening is advisory, so a failed AI step now keeps the failed run on record, uses the deterministic checks only, and routes the paper to REVIEW_REQUIRED for a human editor. The author is told AI screening could not run.
- The manuscript page shows Approve / Disapprove only when the paper is in REVIEW_REQUIRED or EDITORIAL_DECISION, and otherwise says which stage it is in.
