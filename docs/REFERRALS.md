# Referral links (acquisition partners)

Each acquisition partner gets one private link, e.g. `https://paperly-publications.com/r/K7XM92QF`, to share with teachers and authors.
When someone registers or submits an article through it, the referral source is recorded privately and shown **only to administrators**.

## Privacy model

| Rule | How it is enforced |
|---|---|
| The link reveals nothing about the partner | The code is 8 random characters (no 0/1/I/L/O). It is never derived from a name, initials, username or id. |
| The link cannot be used to discover codes | `/r/CODE` never looks the code up. Every well-formed code gets the same redirect; the code is validated later, on the server. |
| Only administrators see partner identity | New permission `REFERRAL_ADMIN`, held by `admin` and `super_admin` only (not editors, founders or payment admins). Every `admin*` function in `src/lib/server/referrals.server.ts` checks it first. |
| Authors see only their own submission | Referral data lives in separate tables. No referral column was added to `papers`/`profiles` (author queries return whole rows). Author payloads are unchanged. |
| Clients cannot read the data directly | All four tables have RLS on and no grants to `anon`/`authenticated`; the two SQL functions are `service_role` only. |
| Names never leak sideways | Audit entries and logs carry opaque ids only. `/r/` is `noindex`, `no-store`, `no-referrer`, and disallowed in `robots.txt`. |

## How attribution is recorded

1. Visitor opens `/r/CODE`: an HttpOnly, SameSite=Lax cookie (`pp_ref`, 30 days) is set and they are sent to `/auth?join=1` (no code in the address bar).
2. **Registration:** when `getMe` creates the profile, `recordRegistrationReferral` stores which partner/link the person came through. First touch wins.
3. **Submission:** after the submission has committed, `recordSubmissionReferral` credits the partner:
   - only the link used now, or only the partner the author registered through: that partner, 100%;
   - both, same partner: that partner, 100% (no double counting);
   - both, different partners: **50/50** (`JOINT_AUTO`). This default lives in `resolvePaperAttribution` (`src/lib/domain/referrals.ts`).
4. Recording is best effort. It never throws and never blocks sign-up or a submission. A replay, or an administrator's split, is never overwritten.

Administrators can set any joint split (1 to 10 partners, shares must add up to exactly 100.00) from the article view. The database enforces the total.

## Where administrators see it

- **Journal > Referrals:** partners, private links (copy / replace / pause), totals (registered, articles, fractional credit), latest attributed articles.
- **Article review** and **All research** (every article, including published ones): the "Referral source" panel with each partner's percentage.

## Applying the migration (not applied by the session that wrote it)

`drizzle/migrations/0043_referral_links.sql` is additive and idempotent: new tables and two functions, nothing existing is altered or deleted.
Apply to a scratch/staging database first, then production through your normal process. It expects `public.profiles` and `public.papers` (with `deleted_at`).

It was verified on a scratch Postgres 16 by applying the whole journal (0000 to 0042) and then 0043 with no errors, running the existing `supabase_tests/` before and after (identical results), and running the new `supabase_tests/0043_referral_links.sql`. It was never applied to a real or production database. After applying it, run the new SQL test the same way as the other files in `supabase_tests/` (for example `psql -v ON_ERROR_STOP=1 -f supabase_tests/0043_referral_links.sql`); it cleans up after itself.

## Known limits

- If someone opens the email-confirmation link on a different device or browser, the cookie is not there and registration is not attributed.
- Pausing a partner stops new referrals through their link; people already registered through them keep the attribution.
- Replacing a link stops the old code from counting new referrals; history still points at the old link.

## Tests

- `npx vitest run` covers the domain rules, the `/r/CODE` route, and the server module (gate on every admin function, first touch, joint split, replay safety).
- `supabase_tests/0043_referral_links.sql` checks the database itself: no client access to the tables or functions, RLS, opaque code format, one live link per partner, shares totalling exactly 100, replay safety, cascades, and the existing `admin_purge_paper` flow.
- `node tests/referral-privacy.test.mjs` is a static guard for the privacy rules above. `node tests/server-functions-auth.test.mjs` also checks the new functions.
