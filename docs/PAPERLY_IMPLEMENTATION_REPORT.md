# Paperly upgrade: implementation report

Status: **not declared production ready.** The database layer is verified against a real Postgres. The application layer (type-check, vitest run, production build, browser testing) could not be run in the build sandbox, so it has only had syntax checks and logic tests. See section 7.

## 1. Existing architecture discovered
TanStack Start (React 19, Vite) app hosted on Lovable, Supabase (Postgres, Auth, Storage) with a service-role client in server functions, Drizzle-style SQL migrations, Razorpay payments, an AI screening pipeline through the Lovable AI Gateway, certificate PDFs with QR codes. A database-enforced paper state machine already existed. Full audit: `PAPERLY_AUDIT.md`.

## 2. Files and components changed (by milestone)
- M-1 safety fixes: AI screening can no longer accept or reject; reviewer blanket manuscript access removed; peer_reviewed guarded; race-free first-admin bootstrap.
- M-2 identity: immutable `PLY-YYYY-XXXXXX` IDs, publication types, verified ORCID (OAuth + checksum), CRediT roles, affiliations, funding, structured AI disclosure, frozen published children.
- M-3 workflow: handling editor, reviewer invitation / COI / review submission, three review models (default double-anonymous), revisions as new versions, withdrawal, admin settings (`review.server.ts`, `review.functions.ts`, admin / reviews / my-research pages).
- M-4 scholarly record: references with lookup status, version history, citation export (Vancouver, APA, MLA, BibTeX, RIS, EndNote), JSON-LD / Highwire / Dublin Core metadata, sitemap and robots routes, notices (erratum, correction, addendum, expression of concern, withdrawal, retraction), explorer filters and paging, DOI provider states.
- M-5 transparency and operations: journal identity, editorial board, 24 public policies plus About and Fees pages, certificate verification at `/verify/certificate/:id` and truthful certificate wording, role dashboard, audit-log viewer, privilege hardening, critical tests.

## 3. Database migrations created
`0002` screening boundary and access hardening · `0003` identity, ORCID, contributors · `0004` review states (enum values) · `0005` peer-review workflow · `0006` references, notice kinds, DOI states · `0007` journal identity and board · `0008` privilege hardening.
Live project `research-catalyst`: 0002–0005 are applied (confirmed by schema check). **0006, 0007 and 0008 still need to be run in the SQL Editor, in order.**

## 4. New features implemented
Everything in section 2, including: DOIProvider states with no fake DOIs; permanent landing page `/article/PLY-…` (old `RP-…` addresses still resolve); public policies describing actual behaviour; fee page with amount, timing, coverage, taxes, refunds, waivers and rejection cost; admin-confirmed editorial board; ISSN stored only with a valid check digit and an administrator's confirmation.

## 5. Existing features preserved
Submission flow, AI screening (now advisory), payment via Razorpay (still only after acceptance), certificates (QR, hashes, verification), explorer, auth, admin queue. Old certificate QR links (`/verify/CERT-…`) now redirect to the new verification route. The previous QR URL pointed at a route that did not exist; that is fixed for newly issued certificates.

## 6. Security findings
Checked against the live project (advisors plus catalogue queries) and the code.
- All 3 storage buckets are private with no browser policies: manuscripts are reachable only through server-issued signed URLs. Good.
- RLS is on for every table. Privileged functions (`transition_paper`, `claim_bootstrap_admin`, `apply_published_correction`) are not callable by browser roles. Good.
- Webhook signature verification and amount matching exist for Razorpay; the test payment method is disabled in production. Good.
- **Found and fixed in 0008:** browser roles held INSERT / UPDATE / DELETE privileges on every table (only RLS stood between them and writes); anonymous visitors could call the role-lookup helpers `has_role`, `is_staff`, `can_access_paper`; 15 functions had a mutable search_path. All 57 server functions require sign-in unless on an explicit public list; admin and editor functions are gated server-side (static test).
- **Remaining, needs you:** leaked-password protection is disabled in Supabase Auth (Dashboard → Authentication → Policies / Passwords: turn on). Signed-in users can still call the role helpers with any user id (needed by RLS); low risk, noted.
- Not verified: ORCID flow against the live ORCID service, Razorpay live keys, storage signed-URL expiry in production, behaviour under load.

## 7. Tests executed and results
| Suite | Result |
|---|---|
| Postgres 16, all 9 migrations on a fresh database | all applied cleanly |
| SQL rule tests (workflow, references / notices, identity / board, privileges, critical) | 71 checks, 0 failures |
| Domain logic tests (state machine, review rules, ORCID, AI meter, references, citations, metadata, DOI gate) | 53 tests, 0 failures, run with a small Node shim |
| Static server-function authorization check | 57 functions, 0 failures |
| TypeScript syntax check of all changed files | no syntax errors |

The brief's 12 critical tests: 1 (author cannot accept own paper), 2, 5, 6, 7, 8, 9, 10, 12 are proven in SQL under the real browser roles; 3 and 4 (reviewer visibility, cross-reviewer edit) are covered by the review-rule logic tests and the frozen-review trigger; 11 by the static authorization check.

**Not run:** `tsc` full type-check, the real vitest runner, the production build, and any browser or mobile testing. The package registry returned 403 in the sandbox. `types.ts` was edited by hand. Run `npm run build` and the test suite in Lovable or locally before release.

## 8. DOI provider integration status
Abstraction in place with states NOT_CONFIGURED, READY, REGISTERING, REGISTERED, VERIFIED, FAILED, UPDATE_REQUIRED. Crossref and DataCite are stubs that never return a DOI. A database constraint prevents a DOI value without agency confirmation. Records display a DOI only at VERIFIED. **No DOIs are registered.**

## 9. ISSN status
No ISSN. The journal-identity panel accepts one only when its check digit is valid and an administrator confirms it was officially assigned. Public pages say "None assigned".

## 10. Peer-review status
Implemented and database-enforced, but **off by default** (journal mode disabled). Repository records and preprints are labelled "not peer reviewed". "Peer reviewed" appears only for a journal article with a completed review. AI screening is labelled automated and cannot decide.

## 11. Indexing status
Paperly is not indexed anywhere. The About page says so. No page claims Scopus, PubMed, Web of Science, DOAJ or accreditation.

## 12. Remaining external actions
1. Run migrations 0006, 0007, 0008 in the Supabase SQL Editor (in order).
2. Run `npm run build` and the vitest suite; fix anything the sandbox could not catch; regenerate `routeTree.gen.ts` (done automatically by dev / build).
3. Enable leaked-password protection in Supabase Auth.
4. Test ORCID sign-in end to end (sandbox first, `ORCID_ENV=sandbox`).
5. Publish editorial office contact details, publisher name and aims in Admin → Journal identity.
6. Recruit and confirm real board members; none are shown until you confirm them.
7. Apply for a DOI prefix (Crossref or DataCite membership) before enabling any provider; implement deposit against their sandbox.
8. Apply for an ISSN through your national ISSN centre if operating as a journal.
9. Have counsel review the privacy policy and terms of use.
10. Decide on external preservation (for example CLOCKSS or Portico) and indexing applications; state them publicly only once real.
11. Review the existing auto-accepted legacy papers by hand.
