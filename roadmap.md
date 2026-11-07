# Paperly roadmap

## Done
- [x] Database schema: roles, papers, versions, declarations, AI runs/findings, decisions, payments, DOI, certificates, audit, corrections, complaints, notifications
- [x] DB-enforced state machine, immutability triggers, append-only audit
- [x] Decision policy engine (deterministic), seeded GENERAL/MEDICAL policies v1.0
- [x] File security scanner, prompt-injection detector, internal similarity, Crossref DOI checks
- [x] AI provider abstraction (Lovable AI, consent-gated)
- [x] Screening pipeline, publication, certificate issuance + PDF/QR/hash
- [x] Payment provider abstraction + test provider with HMAC-verified, idempotent webhooks
- [x] DOI provider abstraction (not configured; never invents DOIs)

## Next
- [ ] Phase 9 launch: migration chain reconciled in repo (docs/PHASE9_LAUNCH_AUDIT.md). BLOCKED on install/build/tests, applying 0011+0012, and real journey tests
- [x] Phase 8 version control: atomic revision/correction commit, version-chain guard, corrected-version publishing, author version history (see docs/PHASE8_AUDIT.md; SQL/typecheck/build not yet run)
- [x] Certificate design matching the reference, accurate recorded details, final download and QR verification (7 tests; PDF visual inspection and QR decode passed)
- [ ] Razorpay only (UPI + Visa/cards), publication fee 1500 INR; Kyrgyz QR hidden
- [ ] Answer: own external database project (not possible from here) and DOI (needs Crossref/DataCite membership)
- [ ] Server functions (profile, submission, admin, public, payments) + webhook route
- [ ] Screens: auth, submit wizard, my research, certificates, profile, explore, /paper/$id, /verify/$id, test pay page, admin dashboard, reviewer page
- [ ] Legal pages (marked for legal review)
- [ ] Vitest suite (policy, state machine, webhook, certificate, injection)
- [ ] Deliverables docs (architecture, env vars, limitations)

## Blocked
- Signed-in certificate download check: connected backend has no auth users available for testing
- Razorpay keys (RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET from user)
- Crossref DOI registration (needs membership + prefix)
- Email sending (needs email domain)
- Malware engine (needs external scanning service)

## Phase 10 (2026-10-10)
- IMPLEMENTED AND VERIFIED: migration replay and SQL tests on disposable Postgres; static server-function auth test
- IMPLEMENTED BUT NOT VERIFIED: token-gated one-time admin bootstrap (0014), auth error handling, Field accessibility
- BLOCKED: npm install/build/test (registry 403), deployment, backend journeys
- EXTERNAL ACTION REQUIRED: live migrations 0013/0014, bootstrap env, live security checks
- Next: run real build, port selected parts of `docs/unmerged-from-main-zip/`, finish review step and Explore URL state
