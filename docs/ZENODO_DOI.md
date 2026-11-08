# Zenodo DOI registration (Phase 48)

Workflow: AI screening -> faculty review -> editor acceptance -> (payment where applicable) -> **explicit publication approval** -> Zenodo deposit, upload, publish -> DOI confirmed -> article published with that DOI -> certificates issued with that DOI.

## Where it lives (existing architecture reused)
| Concern | File |
|---|---|
| Pure rules: config, validation, metadata, DOI confirmation, retry policy, authorisation | `src/lib/domain/zenodo.ts` |
| REST client (injectable fetch, token redaction) | `src/lib/domain/zenodo-client.ts` |
| Orchestration (lease, reconcile, upload, publish, verify) | `src/lib/domain/zenodo-workflow.ts` |
| Database store, secrets, role checks, sweep | `src/lib/server/zenodo.server.ts` |
| Server functions | `src/lib/zenodo.functions.ts` (+ `adminPublish` in `app.functions.ts`) |
| Migration | `drizzle/migrations/0035_zenodo_doi_registration.sql` (extends `doi_records` and `editorial_settings`; no new tables) |
| Admin UI | `src/components/zenodo-admin.tsx` (Admin > "DOI (Zenodo)") |
| Article page / certificate | `src/components/doi-link.tsx`, `certificate-layout.ts` |

The backend is TanStack Start server functions on Vercel (the project has no Supabase Edge Functions), so the Zenodo service is a `.server.ts` module. Secrets are read from `process.env` there only.

## Secrets (server-side environment variables)
- `ZENODO_ENVIRONMENT` = `sandbox` or `production`. **Unset = the feature is off and publication behaves exactly as before.**
- `ZENODO_ACCESS_TOKEN_SANDBOX`, `ZENODO_ACCESS_TOKEN_PRODUCTION` (preferred, separate tokens), or `ZENODO_ACCESS_TOKEN` for the selected environment.
- Token scopes: `deposit:write`, `deposit:actions`. Sandbox base URL `https://sandbox.zenodo.org/api`, production `https://zenodo.org/api`.
- Production additionally needs the admin switch ("Enable production" in the Zenodo admin screen, with a confirmation, recorded in the audit log). A sandbox test is recommended but not required.

## Connect Zenodo (OAuth), instead of a personal token
- Register an application at Zenodo (Settings -> Applications) with redirect URI exactly `https://<site>/zenodo/callback`. Set `ZENODO_CLIENT_ID` and `ZENODO_CLIENT_SECRET` on the server (and optionally `PUBLIC_SITE_URL` so the redirect never depends on the request host).
- An administrator presses **Connect Zenodo** in the DOI screen, approves `deposit:write deposit:actions` on Zenodo, and is returned to `/zenodo/callback`. The state is signed and bound to that administrator (10 minutes).
- The access and refresh tokens are saved **encrypted** (AES-256-GCM, key derived from `ZENODO_CLIENT_SECRET`) in `zenodo_oauth_connection` (one row, server-only: RLS on, no client privileges). The access token is refreshed automatically five minutes before it expires.
- A token set in the environment (`ZENODO_ACCESS_TOKEN*`) always takes precedence over the OAuth connection. Changing `ZENODO_CLIENT_SECRET` makes the stored tokens unreadable: press **Reconnect Zenodo**.
- **Disconnect** deletes the stored tokens; to revoke the grant on Zenodo's side, remove the application under Zenodo Settings -> Applications -> Authorized.

## Behaviour
- Approval: with Zenodo enabled, an editor's/administrator's **Publish** click on a paper in production is the explicit approval (conflict-of-interest rule kept). `autoPublish` and the daily sweep never publish such a paper without a registered DOI.
- One workflow per paper: `doi_records.paper_id` is unique; `zenodo_claim_registration()` claims a lease in one atomic UPDATE; a unique index prevents one deposit attaching to two papers.
- Never a blind second deposit: the deposit id is saved immediately after creation; an uncertain create is reconciled by searching Zenodo for the idempotency marker (stored in the deposit notes) before anything is created; an uncertain publish is verified by reading the record.
- Retries: 429 honours Retry-After, 5xx/timeouts back off exponentially (max 5 attempts), then "automatic retries finished"; validation/auth errors are not retried; administrators can retry (same deposit is resumed).
- DOI accepted only when Zenodo returns a published record (`submitted` and `state=done`), a DOI with the environment's prefix (10.5281 / 10.5072) and an https record URL on the environment's host. Registered rows are immutable (trigger); corrections use *Update metadata on Zenodo* (edit + update + publish of the same record).
- Sandbox DOIs (10.5072) do not resolve at doi.org; the article page and certificate label them as test DOIs.
- If registration fails: the paper stays in production (accurate editorial status), no DOI is shown, the dashboard shows the code, message and next action.
- Only a PDF whose SHA-256 matches `paper_versions.file_hash` is uploaded. DOCX-only manuscripts fail validation (`FILE_NOT_PDF`); `ALL-RIGHTS-RESERVED` fails validation (`LICENSE_NOT_OPEN`) because a Zenodo deposit is open access.
- Authorisation (server-side): editors approve and read; retries, metadata updates, connection tests and configuration are admin/super_admin only.
- Audit (append-only `audit_logs`): `publication_approved`, `doi_registration_started`, `doi_deposit_created`, `doi_deposit_reconciled`, `doi_registered`, `doi_registration_failed`, `doi_post_registration_failed`, `doi_retry_requested`, `doi_metadata_updated`, `zenodo_connection_tested`, `zenodo_production_enabled/disabled`.
- Certificates already issued are immutable. DOI registration runs before certificates are issued, so new publication certificates carry the DOI automatically (`doi_at_issue`), with a clickable `https://doi.org/<DOI>` link and a DOI QR; the certificate ID stays separate.

## Deploying
1. Apply `0035_zenodo_doi_registration.sql` (additive).
2. Set `ZENODO_ENVIRONMENT=sandbox` and the sandbox token in Vercel; redeploy.
3. Admin > DOI (Zenodo) > Test connection.
4. Publish an accepted test article; confirm the DOI on the article page and certificate.
5. Only then set `ZENODO_ENVIRONMENT=production` + production token and press Enable production.
