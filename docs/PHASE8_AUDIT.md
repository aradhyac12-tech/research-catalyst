# Phase 8 audit — version control

Scope: README "PHASE 8 — VERSION CONTROL" (every manuscript versioned, no overwrite of a published manuscript, previous/current version tracking, correction record, retraction handling).
Status labels: IMPLEMENTED = code written; VERIFIED = actually executed here with the stated result; NOT VERIFIED = written, not executed.

## What already existed (read, not rebuilt)
- `paper_versions` with major/minor, generated `version_number`, `previous_version_id`, `change_reason`, `uploaded_at`; file/number immutability trigger; no delete.
- `papers.current_version_id`; `corrections` (append-only, has `new_version_id` but it was always NULL); `apply_published_correction`; `issueNotice` (notice-only corrections, retraction, withdrawal, certificate marking).
- Author revision upload (`resubmitRevision`) and its UI; public article page already lists every version with hash and shows a RETRACTED banner while keeping the record public.

## Gaps found and what changed
| Gap | Change | State |
|---|---|---|
| Revision upload did 4 separate writes (version, response, paper pointer, status) with no storage cleanup. A failure left an orphan file or a paper pointing at a half-recorded revision. | `commit_new_version()` does all DB writes in ONE transaction. `versions.server.ts` uploads first, commits, and on failure removes only objects no committed version references. `resubmitRevision` now delegates to it. | IMPLEMENTED. SQL and Storage NOT VERIFIED |
| Nothing enforced a single version line (previous link could be wrong or null, numbers could jump, empty reason, identical file). | `guard_version_chain` before-insert trigger; `versions_immutable` now also freezes previous_version_id, change_reason, kind, uploader, time, size, mime. `anonymized_*` stay updatable on purpose. | IMPLEMENTED. NOT VERIFIED (SQL) |
| A published correction could change title/abstract but never the manuscript file; `new_version_id` was always NULL. | Admin can attach a corrected PDF: new version (kind CORRECTION) + public notice + pointer + CORRECTED status in one transaction. Earlier version, hash and issued certificates are untouched. Surfaced in the existing "Corrections and retractions" panel (file field on CORRECTION; no extra button). | IMPLEMENTED. NOT VERIFIED (SQL, Storage) |
| Author could not see a version history. | "Version history" section on the submission page (shown once there are 2+ versions): number, kind, date, what changed, predecessor, hash prefix, size. No file locations returned. | IMPLEMENTED |
| `version_kind` did not exist. | Column + backfill (1.0 = INITIAL, others REVISION, those referenced by a correction = CORRECTION) + one-INITIAL-per-paper unique index. | IMPLEMENTED. NOT VERIFIED (SQL) |
| Retraction | Already compliant (record stays public, RETRACTED banner, notices listed, certificates marked). New: the DB refuses any new version on RETRACTED/ARCHIVED/WITHDRAWN/REJECTED records. | Existing behaviour confirmed by reading code only |

Behaviour change to know about: a revision's "what changed" text must now be at least 10 characters (was 5 in the form validation, 10 in the DB rule).

## Quality gates actually run
- `src/lib/domain/versioning.test.ts`: 20/20 pass under a throwaway Node runner standing in for vitest (numbering, who/when, chain integrity, storage names, public labels, static checks of the migration and wiring). NOT run under vitest.
- `node tests/server-functions-auth.test.mjs`: pass, 69 functions, 0 failures (new file `versions.functions.ts` added to the checked list; `issueCorrectedVersion` added to the delegated role-gate list).
- Parse check (TypeScript syntax only) of all 7 changed/new .ts/.tsx files: OK.
- NOT RUN: `npm ci`, `tsc` type check, `eslint`, `vitest`, `vite build` (no node_modules, no network). Types for `paper_versions.version_kind` and the new RPC are not in the generated Supabase types; the new code reaches them through the existing `dbx` loose client.
- NOT RUN: `supabase_tests/0011_version_control.sql` (written; no PostgreSQL available here). It covers the chain rules, atomic revision, immutability and role lockout. It does NOT cover the CORRECTION path (needs a real admin user).
- Migration 0011 was NOT applied to any database.

## Still open
- Run 0011 on a scratch Postgres after 0000..0010, then the SQL test; then apply to the live project. The repo/live drift from the Phase 6+7 audit still stands (live-only migrations are not in `drizzle/migrations`).
- `npm ci && npm run typecheck && npm test && npm run build`; regenerate Supabase types.
- Author-side changes to title/abstract with a revision are supported by the SQL function but not exposed in the form.
- No side-by-side file diff between versions (hashes and descriptions only).
- Re-declaration of rights/ethics on a revision is not forced; existing `amend_rights` / `amend_ethics` remain the path.
