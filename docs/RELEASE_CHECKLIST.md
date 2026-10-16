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
- [x] `node tests/server-functions-auth.test.mjs`: 0 failures over 102 functions (B8 RESOLVED in phase 51: the test was stale, `setRole` is gated by `canAssignRole`, `getPublicFullText` is intentionally public)
- [ ] Screening sweeper cron, Vercel maxDuration >= 90 s, ADMIN_TEST_TOOLS off (EXTERNAL ACTION REQUIRED)
- Env additions (names only): `GEMINI_API_KEY`, `GROQ_API_KEY`, `AI_MAX_COST_PER_PAPER_USD`, `AI_MAX_DAILY_COST_USD`, `AI_PROVIDER_TIMEOUT_MS`, `AI_TOTAL_DEADLINE_MS`

## Phase 51 status (2026-10-12), Zenodo OAuth follow-up
- [x] Migrations 0000-0036 all applied to the `research-catalyst` Supabase project (verified with list_migrations). `zenodo_oauth_connection`: RLS on, no anon/authenticated privilege, service_role only, 0 rows until an admin presses Connect Zenodo.
- [x] `src/integrations/supabase/types.ts` regenerated from the live database (it predated 0035/0036, site_banners and others).
- [x] vitest: 30 files / 328 tests pass. `node tests/server-functions-auth.test.mjs` passes and now also checks `zenodo.functions.ts`. `tests/**` is excluded from vitest (those files are plain-node scripts).
- [x] `vite build` passes.
- [x] Fixed: `scanPdf` embedded-file check contained a literal backspace character instead of `\b`, so the "Embedded file attachment" warning never fired.
- [x] Fixed stale expectations: article stamp is cover + record sheet + original pages; certificate issue date for 2026-10-07T23:30Z is 07 Oct 2026 (UTC).
- [x] Zenodo files (`zenodo*.ts`, `zenodo-admin.tsx`, `zenodo.server.ts`, tests) typecheck clean under the strict tsconfig.
- [x] `tsc --noEmit` reports 0 errors (phase 52). Fixed a real bug on the way: the admin reviewer picker read `r.name`, but the query returns `display_name`, so reviewer names rendered blank.
- [ ] `package-lock.json` is out of sync (missing pdfjs-dist, @napi-rs/canvas): run `npm install` and commit the lockfile.
- [ ] EXTERNAL: set ZENODO_CLIENT_ID, ZENODO_CLIENT_SECRET, PUBLIC_SITE_URL; register `https://<site>/zenodo/callback` in the Zenodo app; press Connect Zenodo (sandbox first), then Test connection.
