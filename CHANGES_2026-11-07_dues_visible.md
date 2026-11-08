# Existing dues now show (admin Users + summary)

Cause: dues holds were only a small "Dues pending" tag on the person's own row, with the amount/note hidden, and the list is paged (25 per page), so a hold on someone not on page 1 was invisible. The holds read also ignored database errors, so an unreadable `founder_dues_holds` table looked like "no dues for anyone".

Fix:
- Admin > Users: new "Dues pending (N)" box at the top listing every founder with dues, across all pages, with the note (amount due) and date.
- Each row with dues shows "Dues: <note>"; "Edit dues note" button when a hold is on.
- `listUsers` now returns dueNote/dueSince and fails loudly (instead of silently showing no dues) if the table can't be read. New `listDuesHolds` / `listFounderDuesHolds` (admins only).
- No database change. If you see "Could not load dues", apply `drizzle/migrations/0052_founder_dues_holds.sql`.

## Founders with dues are now really blocked
- `founderHoldState` (core.server) is the single check and now FAILS CLOSED: if the hold can't be read the founder is treated as held (before, a read error meant "no hold, full access"). Used by `assertFounderNotOnHold` and `getFounderHold`.
- `getMe` removes the `founder` role from a held founder and returns `duesHold: true`, so menus and prefetches stop treating them as a founder. Their only founder screen is Payments, which shows "Access is on hold: please clear your dues first" with your note. Also shown if the hold check itself fails.
- Server blocks (unchanged, still enforced): founder overview, shared payments, users list, granting roles, AI suggest. Administrators are never held.
- Note: a held founder who ALSO holds editor/reviewer keeps those separate roles; the hold covers founder access only.

## Real dues = payment_deferrals (live table, was not in the code)
Live check (project research-catalyst): migrations 0050-0052 were already applied; `founder_dues_holds` is empty. The dues actually owed are in `public.payment_deferrals` (pay-later amounts), which no code in this repo read: luckyracer616 INR 600.00 DUE since 2026-10-27 (overdue), chavanaradhya022 PAID, riteshjaiswal1602 CANCELLED.
- Admin > Users: the "Dues pending" box and each row now include DUE deferrals for any user (amount, due date, "overdue").
- A founder (not admin) with a DUE deferral past its due date is blocked exactly like a manual hold; the screen shows "Overdue: INR 600.00, was due 2026-10-27". Before the due date the founder is not blocked (that is the grace period granted).
- `drizzle/migrations/0053_payment_deferrals_repo_sync.sql` records the table (idempotent, no live change).

## "Visible to founder" checkbox is instant
- Admin > Money: ticking / unticking, and saving or clearing the shown amount, now update the screen at once (optimistic, written straight into the cached admin overview) and confirm in the background; a refusal puts the old state back with an error toast. The box is no longer disabled while saving and the whole admin overview is no longer re-fetched after every click (that refetch was the main lag).
- Server (`adminShareWithFounder`, `adminSetFounderAmount`): role check and lookup run in parallel; sharing is one upsert instead of read-then-insert. Audit entries unchanged.

## Add payment (Admin > Money) + migration 0054
- Migration `0054_manual_payments.sql` (applied live): `payments.recorded_by` (admin profile) and `payments.recorded_note`.
- Admin > Money > "Add payment": payer e-mail (must be a registered user), amount, currency, optional date received, reference, paper ID, note. Needs PAYMENT_MANAGE.
- Auto-filled: order id `MAN-PPL-…`, payment code `PAY-YYYY-NNNNNN` (database sequence), status PAID, method/provider manual, idempotency key, product, original amount, the date, and `recorded_by` = the signed-in admin. Duplicate reference is refused (existing unique index).
- It is a ledger entry only: no paper transition, no e-mail. Counts in revenue totals and can be shared with the founder like any payment. Refunds are not automated for it. Audit action `admin_manual_payment_recorded`.
- Every row in Recent payments now shows payment code, method, payer e-mail and, for manual entries, "added by <admin e-mail>", reference and note.
