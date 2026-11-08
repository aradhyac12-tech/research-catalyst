# User referral links, discount amount, and compulsory name + age

## Apply first
`drizzle/migrations/0044_user_referrals_profile_details.sql` (NOT applied anywhere; review, then apply). Additive. It adds:
- `profiles.age`, `profiles.details_completed` (existing accounts that already have a real name are marked completed; everyone else sees the pop-up once)
- `referral_partners.user_id` (a link can belong to a registered user), `referral_links.discount_minor`
- `referral_partner_uploaders()` (server only). Test: `supabase_tests/0044_user_referrals_profile_details.sql`.

## Admin > Journal > Referrals
- **Registered users** list (search by name or e-mail, 15 per page). The e-mail address is collapsed until "Show email address" is opened.
- **Generate link / Manage link** opens a menu: discount amount box (₹, quick amounts), live split preview, the link with Copy, New link (discount carries over), Pause/Resume, and signed-up / uploaded / each-uploader counts with the list of uploaders.
- The discount is divided **only between students who uploaded** (one share per student, however many articles; deleted articles do not count). Students who only signed up get nothing. Whole paise: the remainder goes one paisa at a time to the earliest uploaders, so the parts always add up exactly. Rule lives in `splitDiscount` (src/lib/domain/referrals.ts).
- Older partners (not registered users) are still there under "Other referral partners".
- This records and displays the amount. It does not change checkout or pay anyone.

## Name and age
- Sign-up form asks for full name and age (both required). Google sign-ups, and accounts without a real name, get a pop-up on every signed-in page that cannot be closed until both are saved. Only the server can mark an account completed (`completeProfile`); browsers cannot.
- Age is 10 to 100.

## Tests
426 tests pass (new: discount split, rupee parsing, name/age checks, admin gate for the two new functions, user list and link behaviour). `node tests/referral-privacy.test.mjs`: 332 checks, 0 failures. Build passes. `tsc` still reports the existing errors in upload-progress.tsx and submit.tsx (not touched).
