# Phase 9 launch audit (baseline: research-catalyst-phase8-promo zip)

**Website status: BLOCKED.** The migration chain is reconciled in the repo and 0011 is applied live, but nothing below was run in a browser and no dependency install or build was possible. No deployed URL was tested.

Evidence labels: LIVE = queried read-only from the configured Supabase project this session. REPO = read from checked-in files. NOT RUN = could not be executed in this environment. No secret values appear here.

## 1. Migration reconciliation (Step 2)

LIVE has 15 applied migrations (timestamp-named). Each was compared with the repo by content (comments and whitespace ignored, MD5 on both sides).

| Live migration | Repo file | Result |
|---|---|---|
| paperly_core_schema | 0000 | identical |
| payment_methods_razorpay_and_storage | 0001 | **differed**: repo set the INR fee to 600 and did not create the private buckets. Repo fixed to match live (INR 1500, buckets `manuscripts`, `certificates`, `payment-qr`, all private) |
| paperly_0002_guards_and_transitions | 0002 | repo is a superset (adds the `machine_cannot_decide` check). Live already has that constraint (not validated), so no live gap. Left as is |
| 0003, 0004, 0005, references/notices, journal identity, privilege hardening | 0003–0008 | identical |
| issn_checksum_search_path | missing | **recovered** as `0008a_issn_checksum_search_path.sql` |
| paperly_0009_identifier_graph_rbac | missing | **recovered** as `0009a_identifier_graph_rbac.sql`. This is the dependency migration 0010 needs |
| paperly_0010_orcid_ror_credit | missing | **recovered** as `0009b_orcid_ror_credit.sql` |
| paperly_0011_security_hardening | missing | **recovered** as `0009c_security_hardening.sql` |
| paperly_0012_perf_fk_indexes_initplan | missing | **recovered** as `0009d_perf_fk_indexes_initplan.sql` |
| trust_integrity_ethics_workflow | 0010 | identical |
| (not applied) | 0011_version_control, 0012_promo_codes | repo only |

The five recovered files were read from `supabase_migrations.schema_migrations` and each one's normalized hash was checked against the live record: all five match. Journal order is now 0000 … 0008, 0008a, 0009, 0009a–d, 0010, 0011, 0012. The `a`–`d` suffixes were used instead of renumbering so existing file names and the already-applied 0010 text stay untouched. Nothing in the live database was modified.

NOT RUN: a fresh-database replay of the full chain (no PostgreSQL here; a Supabase branch costs money and needs your authorization). Until that runs, "a fresh database can be built from the repo" is unproven.

## 2. Live state (LIVE)
- RLS is enabled on every `public` table. All three storage buckets are private. No `storage.objects` policies exist, so browsers cannot read manuscripts directly; access goes through the server with signed URLs.
- Data: 0 papers, 0 profiles, 0 certificates, 3 role rows. The site has never been used with a real submission, so no end-to-end journey has ever run against this backend.
- `machine_cannot_decide` exists but is NOT VALID (legacy rows were skipped by design; there are none now, so it could be validated).

## 3. Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | BLOCKER | `npm ci`, typecheck, eslint, vitest and `vite build` have never been run in this environment (no network). Phase 6–8 code has only been parse-checked. | Open. Run the commands in `docs/RELEASE_CHECKLIST.md` |
| 2 | RESOLVED | 0011 applied live on 2026-10-09 with your approval (recorded as `version_control`). Verified: chain trigger present, `commit_new_version` is SECURITY DEFINER and executable only by service_role. 0012's promo tables, columns and RLS already existed live (applied outside the tracked history); 0012 was made idempotent and NOT re-run. | Done. SQL test for 0011 still NOT RUN |
| 3 | BLOCKER | No browser or integration run of any journey (sign-up, submit, review, publish, certificate). The live project has no papers. | Open |
| 4 | HIGH | Repo migration chain could not build a fresh database (0010 depends on identifier graph; 0001 had wrong fee and no buckets). | Fixed in repo, replay NOT RUN |
| 5 | HIGH | `.env` was not in `.gitignore` and was inside the zip. It holds only the project id, URL and publishable key (no service-role key found by name search in `.env` or `src`). | `.gitignore` fixed. Still keep `.env` out of future zips |
| 6 | MEDIUM | `package.json` had no `typecheck` script. | Added `tsc --noEmit` |
| 7 | MEDIUM | Generated Supabase types lack `version_kind`, `commit_new_version`, promo tables. New code uses the loose client. | Open: regenerate after 0011/0012 are applied |
| 8 | LOW | `machine_cannot_decide` not validated. | Open, optional |
| 9 | EXTERNAL | Razorpay keys and webhook secret, Anthropic key, email provider, Crossref/DOI account, `PUBLIC_SITE_URL`, Google OAuth client. None verified configured. | Needs you |

## 4. Honest states for unconfigured services (REPO read, not run)
- Payments: Razorpay is offered only when its keys are present. The KG QR method is hard-hidden. The simulated TEST method requires `PAYMENT_TEST_MODE=on`, a webhook secret, and `NODE_ENV` not `production`, so it cannot run in production. Existing fee policy unchanged.
- DOI: provider remains a skeleton; the state is NOT_CONFIGURED in code. No live deposit was attempted.
- Server functions: `node tests/server-functions-auth.test.mjs` passes (73 functions, 0 failures, including the new version and promo functions).

## 5. Command results
| Command | Result |
|---|---|
| `npm ci` | NOT RUN successfully: no network (attempt produced no `node_modules`) |
| typecheck / eslint / vitest / `vite build` / production server start | NOT RUN (blocked by `npm ci`) |
| `node tests/server-functions-auth.test.mjs` | PASS, 73 functions, 0 failures |
| SQL tests `supabase_tests/0010*`, `0011*` | NOT RUN (no disposable PostgreSQL) |
| Browser tests | NOT RUN |

## 6. Security checks done
- No service-role key reference in client code: the only file using it by name is `src/integrations/supabase/client.server.ts`.
- RLS on all public tables, private buckets: confirmed live.
- Not done: reviewing every privileged function's grants live, bundle inspection, rate limits, signed-URL expiry on every download path, deployment target check.

## 7. Applied to live (2026-10-09)
- `version_control` (0011). Live project had 0 papers, so the backfill touched no rows.
- Not applied: 0012 (already present live).
- Razorpay: you report test credentials exist and the account is under review. Set the three RAZORPAY variables to the TEST keys and register the webhook, then run one test-mode payment. Live keys only after approval; payment status never affects editorial decisions. Not verified by me.

## 8. Deployed-site crash (paperly-ashy.vercel.app, "This page didn't load")
- Cause (most likely, NOT confirmed against the live deployment): the header runs on every page and creates the browser Supabase client, which throws when `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` were not set in Vercel at BUILD time. The old error screen hid the message, so every page looked the same. The server-side clients likewise throw if `SUPABASE_SERVICE_ROLE_KEY` is missing at runtime.
- Fix in the repo: error system (`src/lib/errors.ts`, `error-response.ts`, `components/route-error.tsx`), `/api/public/health` (names of missing settings, database reachability), `/api/public/client-error` (log-only), reference IDs on every failure page, structured server logs. See `docs/DEPLOY_VERCEL.md`.
- Verified: 10 unit tests for the error module pass under the stand-in runner (not vitest); all touched files parse. NOT run: typecheck, build, a real deployment.
