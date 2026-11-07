# Phase 10 audit: security, UI and launch remediation

Date: 2026-10-10. **Verdict: NOT production-ready.** The real build, typecheck, lint and vitest could not be run, the live backend and deployed journey were not tested.

Labels: IMPLEMENTED AND VERIFIED (V) · IMPLEMENTED BUT NOT VERIFIED (NV) · BLOCKED (B) · EXTERNAL ACTION REQUIRED (E)

## Inputs and merge
Three zips were supplied. Base = `research-catalyst-phase10-test-mode` (phase9 + DOCX manuscripts, admin test mode; migration `0013_allow_docx_manuscripts`). The `research-catalyst-main` zip's unique work was then ported on top, and the Phase 10 work layered over both. The bootstrap migration is numbered **0014** to avoid colliding with `0013_allow_docx_manuscripts`.

Ported from the main zip (IMPLEMENTED BUT NOT VERIFIED; no typecheck/build possible):
- `ai-provider.server.ts`: multi-provider screening (Gemini, Groq, Anthropic) with fallback, `AIUnavailableError` and in-memory cost budgets. Adjustments: kept the base branch's improved prompt wording (non-native English is not evidence of AI use; embedded-instruction handling) and the `claude-sonnet-5-5` default model. Budgets are per server instance, not durable. New optional env vars are in `.env.example`.
- `admin.tsx`: the new layout. Its imports pointed at `identity.functions` for functions that live in `app.functions`/`review.functions`; corrected, and all named imports were checked to resolve to real exports (script, not the compiler). Test-mode, promo and admin panels are retained.
- `verify_.certificate.$certId.tsx`: loader-based certificate page (uses existing `queryClient` router context and `RouteError`).
- Deliberately not taken: the main zip's removal of `robots`/`og:description`/`twitter:card` meta and the missing `scripts/` folder.

## Environment limits
`registry.npmjs.org` returned 403 from this session's egress policy, so `node_modules` could not be installed. No network route to Supabase, the deployment host or a browser was used. PostgreSQL 16 was local and disposable (stubbed `auth`/`storage`/roles; not the real Supabase stack).

## P0 Secure administrator bootstrap
| Item | Status |
|---|---|
| `getMe`/signup no longer calls `claim_bootstrap_admin`; ordinary signup only ever gets `researcher` | NV (code reviewed; app not run) |
| New `claimBootstrapAdmin` server fn: authenticated, constant-time compare with `ADMIN_BOOTSTRAP_TOKEN` (>=32 chars), optional `ADMIN_BOOTSTRAP_EMAIL`, uniform refusal message, audited | NV |
| Migration 0014: DB function is service_role-only, advisory-locked, requires an existing profile, refuses if ANY `admin`/`super_admin` exists. Changes no role rows | V on disposable DB; E to apply to live |
| SQL tests `supabase_tests/0014_bootstrap.sql` (signup no elevation, first claim, repeat, second user, existing admin preserved, grants) | V (local Postgres 16) |
| Unit tests `bootstrap.test.ts` (token, email, repeat, 25-way concurrent race, existing admin) | NV (vitest could not run) |
| Real concurrent-transaction race test against the SQL function | NV (serialised by `pg_advisory_xact_lock`; only a simulated race was written) |
| Recovery: if the owner is already `super_admin` in production nothing changes. If none exists, set the env token, sign in as the owner, call `claimBootstrapAdmin`, then remove the token | E |

Caveat: the DB function now also refuses when an `admin` exists but no `super_admin`. Check live `user_roles` before applying 0014.

## P1 Build and run
| Command | Result |
|---|---|
| `npm ci` | B: 403 from registry (not run to completion) |
| `npm run typecheck`, `lint`, `test`, `build` | B: not run. No claim of passing |
| `node tests/server-functions-auth.test.mjs` | V: 78 server functions, 0 failures. Fixed a false positive for `adminTest*` and added a check that `requireTestAdmin` enforces `SYSTEM_ADMIN` |
| Route tree, Supabase types regeneration, server-only imports, production start | B |

## P2 UI defects
| Item | Status |
|---|---|
| 1 `Field` unique ids + `aria-describedby`/`aria-invalid` (`useId`; render-prop for the file input) | NV (not typechecked) |
| 2 try/catch/finally for email signup/login, Google OAuth, session restore | NV |
| 3 Final review step (authors, abstract, rights, licence, ethics, trial, funding, AI) with jump-back | Not done |
| 4 Explore URL-synced filters, year validation, reset | Not done |
| 5-7 Empty/loading/retry states, contrast, reduced motion, inert buttons, toast-before-confirm audit | Not done |

## P3 Workflows
All items B/E: they need installed deps, a running app and real test accounts on the configured backend. Nothing was mocked and nothing is claimed. Payment and DOI remain unconfigured per the existing Blocked list (E).

## P4 Database and security
| Item | Status |
|---|---|
| Replay migrations 0000-0014 from zero on disposable DB | V |
| SQL tests 0003, 0005-0011, 0014 | V (all pass). 0010 test had bugs (wrong error text, wrong identifier name `ETH`->`ETHICS_CASE`, `entity_type`->`resource_type`, invalid licence `CC-BY-4.0`, no seed rows so row guards never fired). Fixed with a seeded chain. 0010 had never been executed before |
| `scripts/replay-and-test.sh` (refuses names containing prod/live) | V |
| Live schema drift, advisors, RLS on live, storage policies, signed-URL expiry | E (not attempted) |
| Regenerate Supabase types / remove loose `dbx` access | B |
| Privileged-function audit | Partial: static gate test passes; no manual IDOR review done |
| `.env` excluded: `.gitignore` excludes `.env`/`.env.*` (keeps `.env.example`); archive contains no `.env` | V |
| Secrets absent from client bundle | B (no build) |
| Drizzle `meta/_journal.json` lacks entries for 0013 and 0014 | Open, fix before using drizzle-kit |

## P5 Deployment
B/E. Nothing deployed and no URL tested; deploy only after checks pass. Required: set server secrets (never `VITE_`-prefixed) and `PUBLIC_SITE_URL` on the host, verify `/api/public/health`, OAuth callbacks, email settings.

## Remaining actions before launch
1. In an environment with registry access run `npm ci`, `typecheck`, `lint`, `test`, `build`, and fix real failures (new TS code is unverified).
2. Review the main-zip diffs and decide what to port.
3. Check live `user_roles`, then apply 0013 and 0014 with approval; set bootstrap env only if no admin exists.
4. Finish UI items 3-7, then run the real journeys with test accounts.
5. Live RLS/storage/advisor checks, type regeneration, deployment and deployed-URL test.

## Certificate name (follow-up)
New submissions record the author name from the submission form (corresponding author, else first author) as the version's `author_name_at_submission`, which both the SUBMISSION and PUBLICATION certificates use. Previously it was the account display name. Existing papers keep their recorded name (the field is immutable by trigger). Status: IMPLEMENTED BUT NOT VERIFIED (not typechecked; not exercised against a backend).

## Vercel build error in admin.tsx (follow-up)
Vercel (`vite build`) failed with `Adjacent JSX elements must be wrapped in an enclosing tag (189:374)` in `src/routes/_authenticated/admin.tsx`. Cause: the main-branch version wrapped three `<option>` elements in a single `{ }` expression in the "Record type" select. Fixed by removing the wrapper. Brace/paren balance and a scan for other multi-element `{<...>}` wrappers found nothing else, but no JSX parser or compiler could be run here: IMPLEMENTED BUT NOT VERIFIED until `npm run build` passes.

## Admin layout (follow-up)
`admin.tsx` regrouped into four tabs (Review queue, Payments & promos, People & records, Test tools) with expandable sections, status counters in a responsive grid, `min-w-0`/`break-words` on text, and horizontal scroll inside sections for wide tables so nothing widens the page. Tabs are real `role=tablist` buttons with focus rings; the expand chevron respects reduced motion. IMPLEMENTED BUT NOT VERIFIED: not compiled and not viewed in a browser, so mobile/dark-mode appearance is unchecked.

### Certificate name verification
Traced: form authors -> `certAuthor` (corresponding author, else first) -> `version.author_name` -> `commit_submission` -> `paper_versions.author_name_at_submission` (immutable) -> `issueCertificate(recipientName)` -> `certificates.recipient_name_at_issue` -> PDF. VERIFIED by `supabase_tests/0015_author_name_on_version.sql` running the real `commit_submission` on a disposable DB: with profile name "ACCOUNT DISPLAY NAME" and a payload naming "Dr. Corresponding Person", the stored name was the payload's. NOT VERIFIED: the TypeScript selection of the corresponding author and the final PDF render (app not run).

## AI screening providers and fallback (ported from main zip)
Three providers, tried in order: Gemini -> Groq -> Anthropic (only those with an API key set), up to 3 attempts each with exponential backoff on rate-limit/5xx, then `AIUnavailableError`, which the pipeline records as a failed AI run and routes to human review (never auto-accepts). Per-paper and per-day cost caps (`AI_MAX_COST_PER_PAPER_USD`, `AI_MAX_DAILY_COST_USD`).
Defects found and fixed while porting: (1) the pipeline did not pass the paper id, so every paper shared one budget bucket and one exhausted paper would block all others; (2) a new provider instance per call meant the daily budget never accumulated; (3) with no keys set the constructor threw outside the pipeline's try/catch, which would crash screening. Now: paper id passed, one shared instance per process, and the "no provider" case returns an honest unavailable result.
Still open: budgets are in memory (reset on restart, not shared across serverless instances); the AI run record logs provider "multi" rather than which provider actually answered; Groq is labelled `PRIVATE_INFERENCE` but is an external service. `ai-provider.test.ts` was written but could not be run. IMPLEMENTED BUT NOT VERIFIED.

### AI provider open items closed
- Durable budgets: migration 0015 adds `ai_spend` (RLS on, service_role only; verified on disposable DB: browser roles have no access). `createDbBudgetStore` makes per-paper and per-day caps survive restarts and be shared across instances. If the ledger cannot be read the screen fails closed (routes to human review).
- The AI run now records the provider and model that actually answered (was "multi").
- Groq relabelled `EXTERNAL_WITH_CONSENT` (was `PRIVATE_INFERENCE`).
- Status: migration IMPLEMENTED AND VERIFIED (replays, grants checked). TypeScript and `ai-provider.test.ts` (7 cases) IMPLEMENTED BUT NOT VERIFIED (not compiled or run). Apply 0015 to live with approval. Residual: the cap check and spend write are not atomic, so concurrent screenings can overshoot a cap slightly.

## Live migrations applied (2026-10-10, project research-catalyst / odrskjcvrjzcscqgjber)
- 0013 `allow_docx_manuscripts`: was already live (bucket MIME list includes .docx).
- 0014 `secure_admin_bootstrap`: applied. Before and after, roles were identical (researcher 1, editor 1, admin 1, super_admin 1), so no administrator was changed. `claim_bootstrap_admin` is executable by service_role only (anon/authenticated: no).
- 0015 `ai_spend`: applied. RLS on; anon/authenticated have no access; service_role has access; 0 rows.
IMPLEMENTED AND VERIFIED against the live database (privilege and role checks above). Live RLS/advisor/drift review beyond this is still outstanding. Note: live migration versions are timestamped (e.g. 20261009202257) while the repo files are numbered; the drizzle journal still lacks 0013-0015.
