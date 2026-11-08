# Submitted papers not reaching the editorial queue (editor / admin / reviewer)

## Apply first
`drizzle/migrations/0050_route_stuck_submissions_to_editors.sql` (Supabase SQL editor or your usual migration run). It is idempotent and does two things:
1. Adds `papers_queue_idx` (status, created_at).
2. Repairs papers that are already stuck, through `transition_paper()` (audited): paid or fee-waived papers still in SUBMITTED, and papers stuck 30+ min in PROCESSING / AI_SCREENING with no live run, are routed to REVIEW_REQUIRED for manual screening (same route the app uses when AI screening cannot finish). Run it once; the editorial queue fills immediately. It prints a notice with the count.

## Cause
Screening started only from the author's browser (my-research page calling startScreening) after payment. If the author closed the page, or the webhook settled the payment, the paper stayed SUBMITTED (or stopped in PROCESSING). The queue listed REVIEW_REQUIRED and later states only, so editors, admins and (via assignment) reviewers never saw it. Reviewers only see papers once an editor assigns them, so the queue was the blocker. Founders have no editorial permission by design and are unchanged.

## Fix
- payments.server `finalizePayment`: on PAID with the paper SUBMITTED, runs screening on the server (errors logged, never fails the webhook).
- pipeline.server: `findUnscreened` (fee-cleared SUBMITTED papers, plus PROCESSING/AI_SCREENING stale 10+ min with no live run; 3 batched queries) and `screenWaiting`.
- publish/process cron now also runs `screenWaiting`. Note vercel.json runs it once a day (07:00 UTC); use the Admin button for immediate action.
- Admin overview: all SUBMITTED papers are listed in the Editorial queue (unpaid ones are tagged "Awaiting author's payment" and are not screened until the fee is paid), plus a banner "Start screening now" (`adminScreenWaiting`, staff only, audit-logged) for paid ones.

## Checks
`tsc --noEmit`: only 5 existing errors in upload-progress.tsx / submit.tsx (exactOptionalPropertyTypes, untouched here). `vitest run`: 466 passed. `tests/server-functions-auth.test.mjs`: passes. Not run: vite build, live database.

## Live finding (RP-2026-000027)
Checked in Supabase: submitted 2026-11-06 18:46 UTC, Razorpay order created 18:47, payment still PENDING with no provider transaction id. The author never completed checkout, so the paywall correctly kept it out of screening. Nothing was stuck; it was just invisible. It is now listed with an "Awaiting author's payment" tag. It enters screening automatically once paid.

## Paid at Razorpay but still PENDING here (RP-2026-000027)
Live check: `payment_events` is empty, i.e. Razorpay has NEVER delivered a webhook to this site. Earlier payments only worked because the author's browser confirmed them; this author left before that happened, so the paid order stayed PENDING and the paywall kept the paper out of screening.
Fix:
- `reconcileRazorpayPending` (payments.server): asks Razorpay for each open order's payments and settles a captured/authorized one through the same checked path as the webhook (amount and currency must match; idempotent; audit action `payment_reconciled`).
- Runs automatically: (1) when the author opens the paper (self-heal, throttled 20 s), (2) in the daily publish cron before screening, (3) Admin > Money > "Check Razorpay payments" (`adminReconcilePayments`, PAYMENT_MANAGE only, audit-logged).
- After settling, the paper is screened and reaches the editorial queue (finalizePayment starts screening).
Do this now: deploy, then open Admin > Money and press "Check Razorpay payments" (or have the author open the paper). Both open Razorpay orders (Oct 13 and Nov 6) are checked.
Also set up the webhook so this never depends on the browser: Razorpay Dashboard > Settings > Webhooks > URL `https://paperly-publications.com/api/public/payments/razorpay-webhook`, events payment.captured, payment.authorized, payment.failed, order.paid, and put the same secret in the `RAZORPAY_WEBHOOK_SECRET` env var on Vercel, then redeploy.

## Papers stuck in SUBMITTED had no action (RP-2026-000027)
Opening a SUBMITTED paper in the Editorial queue now shows a panel with:
- "Check payment and start screening" (any editor/admin, `adminStartScreeningNow` mode `check`): asks Razorpay about the paper's order, and if the fee is settled starts screening, so the paper becomes REVIEW_REQUIRED with the normal Approve / revision / reject buttons.
- Administrators only: "Send to editors without payment" (mode `bypass`, reason of 10+ characters, audit action `fee_bypassed_for_screening`). It only lets the paper into editorial screening. If it is then accepted without a paid fee it stays ACCEPTED (the existing unpaid-accept path) and is not published until the author pays.
`runScreening` takes an optional `{ bypassFee }`; nothing else bypasses the paywall.

## Founder sees only the payments an administrator shares (migration 0051)
Apply `drizzle/migrations/0051_founder_shared_payments.sql` (new table `founder_shared_payments`, server-only, no client policies).
- Admin > Money > Recent payments: each payment has a "Visible to founder" checkbox (administrators only; payment-only admins do not see it). Once shared, "Edit amount" sets the amount the founder sees; "Use real amount" clears it. The real payment is never modified.
- Founder view: a new "Payments shared with you" section with only shared payments: reference, date, status and the shown amount, plus totals by currency (PAID only). No real amount, provider ids or payer emails. Founders still have no money permission (0047 unchanged).
- The founder sees just the shown amount (no "adjusted" marker, per owner request). The founder page and nav are named "Payments" and, for founders, show only shared payments.
- Audit actions: `payments_shared_with_founder`, `payments_unshared_from_founder`, `founder_amount_set` (old and new shown amount).
- Server: adminShareWithFounder, adminSetFounderAmount (ADMINS), founderSharedPayments (founders and administrators).

## Founder dues hold (migration 0052)
Admin > Users: expand a founder, "Place dues hold" / "Lift dues hold" (administrators only; shows a "Dues pending" tag). While held, on the server: founder overview/users and the shared payments are refused, and the founder cannot grant editor/reviewer roles; the founder page shows "Founder access is paused while dues are pending. Please contact an administrator." Administrators (even if also founders) are never blocked. Table `founder_dues_holds`; audit actions `founder_dues_hold_set` / `founder_dues_hold_lifted`.

## Dues hold: whole founder blocked, clear screen
A founder on hold now sees a dedicated screen on the Payments page ("Access is on hold: please clear your dues first", with the admin's note, e.g. the amount due), instead of a generic error; no founder data is requested while held. The hold also blocks the founder-only AI abstract/keywords suggestion on upload, besides the overview, shared payments and role granting. Placing a hold asks the admin for an optional note. `getFounderHold` server function; administrators are never held.

## Founder page: Payments + Users (names only)
Founder page "Payments": Overview with the number of registered users and new users in the last 30 days; the "Payments" list (only what an administrator shared, shown amounts only); and "Users" with the total and names only (no email, roles or ids; unnamed accounts show as "Unnamed user"). New `getFounderUserNames`; blocked together with everything else while a dues hold is on.
