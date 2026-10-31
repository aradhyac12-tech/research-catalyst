# Phase 20 audit (screening fallback, atomic AI budgets, payments) — 2026-10-10

Base: Phase 24 zip (ORCID/certificate), with the Phase 20 fixes ported on top.
Labels: **V** = executed and passed here · **NV** = implemented, NOT verified · **NR** = NOT RUN · **B** = blocked · **E** = external/manual action.

## 1. Evidence actually obtained
| Check | Result |
|---|---|
| `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (real vitest), `npm run build` | **NR / B** — npm registry returns 403 from this sandbox. Not circumvented. |
| Partial `tsc --strict` on `ai-provider.server.ts` + `razorpay.ts` only | **V** after fixing one real type error (providers array). Only environmental TS2591 (`process` types) remained. Other edited files (`pipeline.server.ts`, `payments.server.ts`, `app.functions.ts`) were **not** typechecked. |
| `src/lib/server/ai-provider.test.ts` (24 tests) | **V under a node:test shim for `vitest`**, not under real vitest. |
| Migrations 0000–0027 replay on disposable Postgres 16 with Supabase stubs | **V** (stubs, not real Supabase). |
| `supabase_tests/` incl. new `0026_ai_spend_atomic.sql` | **V** (same disposable DB). |
| `scripts/concurrency-ai-spend.sh` (40/60/80 parallel sessions) | **V**: caps held. Old read-then-insert pattern overspent 4.00 against a 0.50 cap. |
| `node tests/server-functions-auth.test.mjs` | **3 failures remain** (was 4; see §4). Not caused by Phase 20 changes (same failures on the Phase 20 base). |
| Live app, live RLS/storage, payments against Razorpay, deployment | **NR** |
| Production migrations | **Not applied.** Supabase MCP not used to apply anything. |

## 2. Fixed (confirmed defects)
1. **Budget race.** Old code read spend then inserted; concurrent requests overspent. Now `ai_spend_reserve` takes an advisory lock, checks per-paper and daily caps, inserts a `reserved` row; `ai_spend_settle` / `ai_spend_release` close it. Unknown outcome (timeout) settles at the estimate; definitive unbilled error releases. (0026)
2. **Fallback reliability.** Error taxonomy (auth, quota, rate-limit, timeout, 5xx, invalid output, content). Per-call `AbortSignal` timeout, bounded retries with backoff only for retryable classes, total fallback deadline, no retry on invalid output within a provider, secrets redacted from errors. Gemini → Groq → Anthropic; a provider without a key is skipped.
3. **Safe human routing.** All exhaustion paths throw `AIUnavailableError(reason)`; `runScreening` routes any unexpected error after PROCESSING to `REVIEW_REQUIRED` with the reason, never leaving a paper stuck. Persistence writes are checked (`must()`), and failures are logged. Submission, files and consent are untouched by AI failure.
4. **Stuck/duplicate runs.** `reapStaleScreeningRuns`; unique partial index `ai_runs_one_active_uidx` (one active run per version; migration preflight aborts if duplicates exist); `retryScreening` reaps stale runs and handles RUNNING.
5. **DOI check** capped at 25 s so it cannot consume the function budget.
6. **Razorpay.** 15 s timeout; `RazorpayError.transient`; webhook returns 500 for transient failures (Razorpay retries) and 200 for permanent ones (no retry storm); refunds are claimed in DB (`refund_claimed_at`, 0027) and checked against provider `amount_refunded` before calling, since Razorpay does not dedupe on `receipt`.
7. `tests/server-functions-auth.test.mjs`: added `getTrustStatus` to the public list (returns booleans, ISSN and EISSN only; verified by reading).

## 3. Audited, no change needed (by code reading only, NV against a live system)
Manuscript consent gating before any external AI call (every provider is `EXTERNAL_WITH_CONSENT`), service-role-only RPC grants on new functions, revision creates a new version without mutating the old one, certificate PDFs immutable, role assignment gated server-side by `canAssignRole`.

## 4. Remaining blockers / documented but NOT fixed
- **B1** No real vitest/lint/build/typecheck run. Run section A of the checklist before merging.
- **B2** Screening is triggered from the browser only; if the tab closes after submit, the paper waits. Needs a sweeper (Vercel cron calling a protected route) — not built.
- **B3** Function max duration must exceed `AI_TOTAL_DEADLINE_MS` (default 55 s) plus DOI check; set Vercel `maxDuration` ≥ 90 s for the screening route or lower the env deadline.
- **B4** Duplicate open/PAID payments per paper are possible; no unique index. Promo-code redemption has a count race.
- **B5** `ADMIN_TEST_TOOLS` defaults on; set it explicitly off in production.
- **B6** Drizzle `_journal.json` ends at 0021; 0022-0027 are not listed; Supabase CLI replay uses file order. Verify before using `drizzle-kit`.
- **B7** After `REVIEW_REQUIRED`, retry cannot re-run AI; a human must decide or an admin resets the version.
- **B8** `server-functions-auth.test.mjs` still reports `adminSetRole` (client-supplied identity/role heuristic) and `setRole` (no role gate). Read: `adminSetRole` passes `context.userId`; the gate is inside `setRole` via `canAssignRole`. Likely static-check false positives, but the test is red until it is fixed or the allowlist is justified. Not changed.
- **B9** Real concurrency was tested against plain Postgres; confirm on Supabase (pooler, `service_role`) after applying to a branch.

## 5. Exact manual actions (in order)
1. On a machine with network: `npm ci && npm run typecheck && npm run lint && npm test && npm run build`. Fix anything red; report to me.
2. Create a Supabase **branch/scratch project**. Replay `drizzle/migrations/*.sql` in order; run every file in `supabase_tests/`; run `scripts/concurrency-ai-spend.sh <scratch-db-url>` (refuses names containing prod/live).
3. Before 0026 on production: `select count(*) from ai_runs where status in ('QUEUED','RUNNING') group by version_id having count(*)>1;` must return no rows (else the migration aborts by design). Take a backup.
4. With your approval, apply 0026 then 0027 to production; regenerate `src/integrations/supabase/types.ts`.
5. Vercel env (names only; values stay in Vercel): `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` (any subset; missing = skipped), optional `GEMINI_MODEL`, `GROQ_MODEL`, `ANTHROPIC_MODEL`, `AI_MAX_COST_PER_PAPER_USD` (0.5), `AI_MAX_DAILY_COST_USD` (100), `AI_PROVIDER_TIMEOUT_MS` (25000), `AI_TOTAL_DEADLINE_MS` (55000). Set `ADMIN_TEST_TOOLS` off. Never set `PAYMENT_TEST_MODE`.
6. Set Vercel function `maxDuration` ≥ 90 s for screening.
7. Run checklist section C with real accounts; additionally: exhaust each provider key in turn (use an invalid key) and confirm the paper lands in `REVIEW_REQUIRED` with progress intact; replay a Razorpay webhook twice and a refund twice; confirm one refund only.
