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
- [ ] Razorpay only (UPI + Visa/cards), publication fee 1500 INR; Kyrgyz QR hidden
- [ ] Answer: own external database project (not possible from here) and DOI (needs Crossref/DataCite membership)
- [ ] Server functions (profile, submission, admin, public, payments) + webhook route
- [ ] Screens: auth, submit wizard, my research, certificates, profile, explore, /paper/$id, /verify/$id, test pay page, admin dashboard, reviewer page
- [ ] Legal pages (marked for legal review)
- [ ] Vitest suite (policy, state machine, webhook, certificate, injection)
- [ ] Deliverables docs (architecture, env vars, limitations)

## Blocked
- Razorpay keys (RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET from user)
- Crossref DOI registration (needs membership + prefix)
- Email sending (needs email domain)
- Malware engine (needs external scanning service)
