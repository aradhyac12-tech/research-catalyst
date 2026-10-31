# Phase 6 + 7 audit (Trust & submission integrity, research-ethics workflow)

Status labels: IMPLEMENTED = code written; VERIFIED = actually executed here with the stated result; BLOCKED / EXTERNAL = see text.
## Live database (project `research-catalyst`, applied 2026-10-09 as migration `trust_integrity_ethics_workflow`)
APPLIED and smoke-tested in a transaction that was rolled back (database left with 0 papers / 0 cases). VERIFIED on the live database:
atomic `commit_submission` (paper, ETH-2026-000001 registered in the identifier graph, VER code, audit row, status SUBMITTED), replay returns the same paper,
rights rows immutable, direct ethics-case writes blocked, non-reviewer blocked, AI cannot clear or start review (can only escalate to human review),
events append-only, a rights-policy violation leaves no orphan paper, browser roles have no table/function access.
NOT exercised live: the ethics publication gate (a different, older guard fired first), ethics_assign, ethics_verify_trial, amend_rights, amend_ethics, clearing preconditions, the Storage side of the saga, and the TypeScript/Supabase client path.

**Repo/database drift:** the live project has migrations the repo lacks (`paperly_0009_identifier_graph_rbac`, `0010_orcid_ror_credit`, `0011_security_hardening`, `0012_perf_fk_indexes_initplan`, and differently named earlier ones). 0010 in this repo depends on the identifier graph from that missing migration and refuses to run without it. A from-zero migration of THIS repo is therefore still NOT reproducible until the live-only migrations are exported into `drizzle/migrations`.

## Claimed vs actually present
- 0003 and 0009 were byte-identical (trailing newline only). 0003 is not idempotent, so a from-zero migration fails at 0009. VERIFIED by diff and by reading the SQL.
- "ethics_reviewer role + ethics_declarations table = ethics workflow": no state, no reviewer path, no identifiers, no policy versioning existed.
- submitPaper did ~12 independent writes with best-effort cleanup only; declarations were mutable; admin overview let editors read payments and payment_admin read the editorial queue.

## Status
1 Migration chain: 0009 neutralised to a schema-asserting no-op (kept in the journal; not deleted); 0010 additive. Static tests VERIFIED; applied live; from-zero reproducibility NOT achieved (see drift note).
2 Submission atomicity: all DB rows in one function (`commit_submission`). IMPLEMENTED.
3 Storage compensation: saga with delete-on-failure, quarantine table, outcome-uncertain handling. Saga logic VERIFIED with fakes; real Supabase Storage NOT VERIFIED. Storage is NOT inside the DB transaction; this is a saga, not a transaction.
4 Rights enforcement: policy rights-1.1 in TS + DB trigger. TS VERIFIED; trigger NOT VERIFIED.
5 Immutability: update/delete triggers; amendments via `amend_rights` / `amend_ethics`. NOT VERIFIED (SQL).
6 Ethics workflow: 8 statuses (7 requested + ETHICS_NOT_REQUIRED for categories where policy requires no review; set by deterministic rules, reversible to review). Transition function enforces role, conflict-of-interest, assignment, reasons, clearing preconditions. TS mirror VERIFIED; SQL NOT VERIFIED.
7 ETH ids: registered as type ETHICS_CASE in the EXISTING identifier graph (`next_identifier`, `register_identifier`); live smoke test issued and registered ETH-2026-000001. VER/REV/CERT/PLY already existed there (`version_code`, `review_code`).
8 Policy versioning: ethics-policy-1.0 data, hash stored immutably in DB, version stored on each declaration/case/event.
9 Clinical trial: fields stored; verification is `PENDING_MANUAL_VERIFICATION` -> human `VERIFIED_MANUAL` only. No registry lookup exists.
10 Consent separation: separate fields; clearing requires publication consent when applicable, independent of approval.
11 RBAC: `domain/permissions.ts` + `requirePermission`; adminOverview split. Only ethics paths and adminOverview were moved to it. The other ~60 server functions keep their existing role gates (only checked by the existing static test, which passes). PARTIALLY IMPLEMENTED.
12 Audit: events written inside the DB functions (same transaction as the change). Existing audit_logs append-only guard unchanged. Not all listed event types (role/permission changes, certificate issuance, DOI configuration changes) were re-audited. PARTIALLY IMPLEMENTED.
13 AI boundary: DB rejects any AI ethics transition except "needs human review". IMPLEMENTED; NOT VERIFIED (SQL).
14 Identifier graph: IMPLEMENTED; public pages labelled "Paperly internal identifier, not a DOI".
15 DOI: **no DOI registration was implemented.** Provider unchanged, NOT_CONFIGURED; test confirms. VERIFIED.
16 Publication without DOI: existing path already does not wait for a DOI; test checks it statically.

## Not implemented
- Ethics reviewer / assignment UI pages (server functions exist in `ethics.functions.ts`).
- Copyright-review workflow (only a `requires_copyright_review` flag is stored).
- Researcher UI to amend declarations or view ethics status (server functions exist).
- Remaining SQL execution tests (`supabase_tests/0010_trust_ethics.sql` is written, not run; a subset was run live via an ad-hoc rolled-back block).

## Quality gates actually run
- `node tests/server-functions-auth.test.mjs`: pass, 67 functions, 0 failures. (It failed on `certificateDownloadPublic` before my changes; that token-gated public download was added to the test's allowlist.)
- New tests (`ethics-policy.test.ts` 16, `trust-phase6.test.ts` 34): 50/50 pass under a throwaway Node test runner standing in for vitest. NOT run under vitest.
- Existing domain tests under the same stand-in: state-machine, review, orcid pass; ai-meter and m4 fail identically on the untouched original (stand-in lacks some matchers); certificate-pdf cannot load `pdf-lib`.
- BLOCKED: `npm install`, `tsc`, `eslint`, `vitest`, `vite build` (no node_modules, network disabled). Parse check of 15 changed .ts files passed; .tsx files were not parsed.
- Dependency, typecheck, lint, build: NOT RUN.

## External actions required
- Run migrations from zero on a scratch Supabase/PostgreSQL and run `supabase_tests/0010_trust_ethics.sql`.
- `npm ci && npm run typecheck && npm test && npm run build`; regenerate Supabase types and routeTree.
- The `manuscripts` storage bucket and its policies are not created by any migration in the repo; confirm it is private.
- Assign `ethics_reviewer` roles to people.
