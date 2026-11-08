# Phase 25 (2026-10-11)
- Site now states it is a peer-reviewed journal: footer tagline and notice, home subtitle/meta, about page, trust strip badge, meta description. Per-record wording is unchanged and stays honest: only journal articles with recorded completed review say "Peer reviewed"; preprints/repository records say they are not.
- Drizzle `_journal.json` now lists 0022-0028 (audit item B6).
- Production migrations: 0026 (atomic AI spend, one active run guard) and 0027 (refund claim) applied; 0028 article removal was already live. Verified: 3 functions, unique index, refund_claimed_at and deleted_at columns exist.
- NOT run: npm install/build/typecheck/tests (no registry access here).

## Delete research (admin)
- New admin tab "All research": searchable list of every live paper, each with a red "Delete research" button (reason of 10+ characters and the typed reference are required; audit-logged; author notified). Deleted papers are listed below with Restore.
- The same Delete button also appears inside an opened paper in the Review queue. It renders only for administrators; the server re-checks the role (`requireRole(ADMINS)`) on every call.
- Deletion is a recorded removal (migration 0028), not a SQL DELETE: the `papers_no_delete` trigger protects history, certificates and payment records. No new migration needed.
- Paid fees are NOT refunded by deleting; the dialog warns about it.
- Not run: typecheck/build/tests (registry blocked). `tests/server-functions-auth.test.mjs`: same 3 known failures as before (B8), none from the new `adminListArticles`.

## Erase from database (admin) + ORCID error text
- Two steps on purpose: "Delete research" hides a paper (restorable); on the Deleted list, "Erase from database" removes it for good. Needs a reason, the typed reference and a tick that payment/certificate records go too.
- Migration 0029 `admin_purge_paper` (applied to production): follows the foreign-key graph from the paper, lifts user triggers only on the affected tables inside the one transaction (Supabase does not allow session_replication_role), deletes leaf-first, re-enables triggers, writes an `article_erased` audit row holding a snapshot of the payments and certificates. Storage files (manuscripts, anonymized copies, certificate PDFs) are removed afterwards; a storage failure is logged and never leaves the database half-erased.
- Verified live in a transaction that was rolled back: one real paper plus 12 dependent tables purged, audit row present, 0 triggers left disabled; afterwards the real counts were unchanged (3 papers, 4 payments, 3 certificates).
- Consequence: an issued certificate for an erased paper stops verifying; payment rows are gone from the live tables (kept only inside the audit snapshot).
- ORCID: the token-exchange error now also shows ORCID's own error code. The fix itself is configuration, not code: credentials must be the live ones from orcid.org/developer-tools (not sandbox.orcid.org), copied again after any regeneration, set in Vercel, then redeployed; the redirect address registered at ORCID must be exactly https://<site>/orcid/callback.

## Papers stuck on "Publishing" (found 2026-10-11)
- Evidence: RP-2026-000014 and RP-2026-000015 sit in PUBLICATION_PENDING (paid, approved) with no doi_records row and no auto_publish_failed audit. Supabase API logs for the 4 s after the approval show only the status change, the author notification e-mail and the audit write; no publish step ran at all. The deployed build therefore does not contain `autoPublish` (this code does, in review.server.ts and payments.server.ts). Fix = deploy this version.
- Added: admin "Publish waiting papers now" banner on the review tab (server function `adminPublishWaiting`, staff only, audit-logged, returns the error per paper that fails). Use it once after deploying to clear the two stuck papers.
- Also needed on Vercel: CRON_SECRET set, so the daily sweep (/api/public/publish/process, 07:00 UTC) can run. Hobby plan functions are short-lived (about 10 s), so publishing inside the approval request can be cut off; the sweep and the button are the safety net.
- Checked in the database (rolled back): the PUBLICATION_PENDING -> PUBLISHED transition and the doi_records insert both succeed, so nothing in the schema blocks publishing.

## ORCID "Could not save the ORCID link" (2026-10-11)
- Cause: orcid_verifications.oauth_subject is NOT NULL (migration 0009b, check oauth_subject = orcid) but the save in completeOrcidLink did not set it, so every successful ORCID sign-in failed at the database. The ORCID credentials were fine (token exchange succeeded). Fix: the upsert now sets oauth_subject and last_verified_at, and logs the database error code if it ever fails again.

## Multiple authors, one certificate each (2026-10-11)
- Submit form, step "Authors": each card is now Full name + Email (optional) up front, with affiliation / ORCID iD / contributions folded under "More details (optional)". Button reads "Add another author". Duplicate emails across authors are rejected; the server also caps email length.
- Publishing: the uploader keeps their certificate (now named after their own author entry). Every other listed author with an email gets a PUBLICATION certificate with their name, issued by `issueAuthorCertificates` and e-mailed with the PDF to the address given. No Paperly account is needed; if an account exists with that email it also shows under Certificates. A failure for one author is logged and never blocks or undoes publication.
- Self-healing: the daily sweep (`/api/public/publish/process`) re-runs `retryAuthorCertificates` for papers published in the last 14 days. Existing certificates are reused and never e-mailed twice (outbox dedupe key per certificate).
- Migration 0030 (applied): certificates.recipient_user_id is nullable; new recipient_author_id (FK paper_authors) and recipient_email; check that a recipient exists; unique index per author row, paper, version and type. Old code keeps working.
- Not covered: authors who are added without an email get no certificate; papers published before this change do not get retroactive co-author certificates until the sweep runs (14-day window).
- Not run: typecheck/build/tests (registry blocked), and no end-to-end issuance (the database currently has no papers; the three test papers were erased by the admin).
