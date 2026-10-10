# Release checklist (run in order; stop at the first failure)

## A. Local, needs network
1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run build`, then start the built server and load `/`, `/explore`, `/verify`, `/robots.txt`, `/sitemap.xml`.
6. `node tests/server-functions-auth.test.mjs`

## B. Database (do NOT run on production first)
1. Create a Supabase branch or a scratch project. Replay `drizzle/migrations/*.sql` in journal order.
2. Run `supabase_tests/` files for 0010 and 0011. All must pass.
3. Only then, with approval, apply 0011 and 0012 to the live project and regenerate `src/integrations/supabase/types.ts`.

## C. Journeys (real accounts, no auth bypass)
Visitor browses → researcher signs up/in → profile → submit PDF → appears in own dashboard → a second account cannot open it by URL → duplicate submit makes one paper → editor processes → non-staff decision rejected → revision creates version 1.1, version 1.0 unchanged → publish → certificate issued, PDF downloads, QR resolves to `/verify` → correction and retraction keep history.

## D. Environment (names only; set in the host, never in git)
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_SITE_URL`; optional: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. Never set `PAYMENT_TEST_MODE` in production.

## Phase 10 status (2026-10-10), see docs/PHASE10_AUDIT.md
- [x] Migrations 0000-0014 replay on a disposable Postgres; SQL tests 0003, 0005-0011, 0014 pass (IMPLEMENTED AND VERIFIED, stubbed Supabase)
- [x] `node tests/server-functions-auth.test.mjs` passes (IMPLEMENTED AND VERIFIED)
- [ ] `npm ci` / typecheck / lint / test / build (BLOCKED: registry 403 in this session)
- [ ] Secure admin bootstrap, auth try/catch/finally and Field a11y (IMPLEMENTED BUT NOT VERIFIED)
- [ ] Submission review step, Explore URL state, a11y/contrast pass (not done)
- [x] 0013 (already live), 0014 and 0015 applied to live 2026-10-10; roles unchanged (IMPLEMENTED AND VERIFIED)
- [ ] Live RLS/storage/drift checks, journeys, deployment (EXTERNAL ACTION REQUIRED)
- Env additions (names only): `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_BOOTSTRAP_EMAIL`. Remove the token after use.

## Phase 20 status (2026-10-10), see docs/PHASE20_AUDIT.md
- [x] Migrations 0000-0027 replay and all SQL tests incl. 0026 pass on disposable Postgres (stubbed Supabase) (VERIFIED)
- [x] Atomic AI budget under 40/60/80 parallel sessions (VERIFIED, plain Postgres)
- [x] 24 ai-provider tests pass under a node:test shim, NOT real vitest (PARTIALLY VERIFIED)
- [ ] `npm ci` / typecheck / lint / vitest / build (NOT RUN: registry 403)
- [ ] 0026 and 0027 on Supabase branch, then production (NOT APPLIED; EXTERNAL ACTION REQUIRED; run the duplicate-run preflight first)
- [ ] `node tests/server-functions-auth.test.mjs`: 3 failures (adminSetRole x2, setRole), unresolved (BLOCKER B8)
- [ ] Screening sweeper cron, Vercel maxDuration >= 90 s, ADMIN_TEST_TOOLS off (EXTERNAL ACTION REQUIRED)
- Env additions (names only): `GEMINI_API_KEY`, `GROQ_API_KEY`, `AI_MAX_COST_PER_PAPER_USD`, `AI_MAX_DAILY_COST_USD`, `AI_PROVIDER_TIMEOUT_MS`, `AI_TOTAL_DEADLINE_MS`
