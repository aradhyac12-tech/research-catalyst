# Link discount is now taken off the submission fee

## Apply first
`drizzle/migrations/0045_referral_discount_uses.sql` (NOT applied anywhere; review, then apply after 0043 and 0044). One new table, nothing existing is altered. Test: `supabase_tests/0045_referral_discount_uses.sql`.

## What changed
- The amount an admin sets on a link (Admin > Journal > Referrals > Generate / Manage link) is now **taken off the submission fee of each person who came through that link**. It is no longer divided between uploaders.
- A person counts as referred when they registered through the link, or submitted the paper through it.
- Once per person. A fee that is paid, awaiting verification, refunded, or still open for another paper blocks a second discount; a cancelled or failed fee does not.
- The fee never goes below Rs 1 (same floor as promo codes). Two links never add up: the best single one counts. A partner gets no discount from their own link. Paused partners give none.
- Stacks with promo codes: the link discount is taken first, the promo code applies to what is left. Promo accounting excludes the link part.
- Only INR fees are reduced (the amount is set in rupees).
- If the discount cannot be recorded, the order is cancelled instead of being left unmarked.
- An open order is reused only if its amount still matches; otherwise it is replaced.

## Admin only
- **Admin > Journal > Referrals > Discounts given on submission fees**: person, e-mail, whose link, paper, discount, fee paid, status, total given on paid fees.
- Stored in `referral_discount_uses` (RLS on, no client grants). The person sees only a lower fee on checkout ("Discount on your fee"); never the partner or the word referral.

## Tests
444 tests pass (new: fee rule, best-link rule, once-per-person, paused/self links, cancelled-payment release, admin list and gate). `node tests/referral-privacy.test.mjs`: 339 checks, 0 failures. Build passes. `tsc` still reports only the existing errors in upload-progress.tsx and submit.tsx. ESLint's one non-formatting error (`KG_QR: false && ...` in payments.server.ts) was already there.

## Follow-up fixes (v13)
- `drizzle/migrations/0046_referral_claim_discount.sql` (applied to research-catalyst): the discount is claimed through `referral_claim_discount`, which locks per person. Two checkouts at the same moment can no longer both get it; the loser's order is withdrawn and restarted at the full fee automatically. Test: `supabase_tests/0046_referral_claim_discount.sql`.
- The paper page now shows the real fee: reduced amount large, full fee struck through.
- Tests: 445 pass; privacy 339/0; build passes; tsc unchanged (only the old upload-progress/submit errors).

## Known limits
- Only INR fees are reduced (the amount is set in rupees).
- Admin test payments never use or record a link discount (by design, so tests cannot use up a person's discount).

## Animated discounted price (v14)
- New `src/components/discounted-price.tsx` + styles in `src/styles.css` (`.dp-*`). On the paper page, when a discount applies: the full fee is struck through by a line that draws across it and shrinks, a "−amount" chip pops in, and the new fee counts down to its final value (about 1.5 s, plays once). The checkout box shows the same chip.
- Reduced-motion users get the final state at once. Screen readers hear one sentence ("₹600.00, reduced from ₹800.00"). No layout shift: the new amount reserves its final width.
- Not checked in a real browser from this environment: look at it once on a paper with a discount.
