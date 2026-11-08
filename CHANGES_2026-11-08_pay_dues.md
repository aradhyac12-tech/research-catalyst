# Pay / clear dues

- New page `/dues`: lists each pay-later due (amount, due date, overdue) with a **Pay** button (Razorpay). On success the due is marked PAID automatically.
- Prompt: anyone with a due sees a "You have dues to pay" dialog (Pay now / Later) on signed-in pages; "Pay dues" also appears in the account menu (and in the native admin app menu). The founder "access on hold" screen has a **Pay dues now** button.
- Admin > Users > "Dues pending": each pay-later row has **Clear due (paid)** and **Cancel due**; manual holds have **Clear hold**.
- Server: `getMyDues`, `startDuesPayment` (app.functions), `adminResolveDeferral` (founder.functions); `myDues`/`startDuesPayment` in payments.server; `finalizePayment` settles the deferral when a `dues:` payment is PAID. `getMe` now returns `dues`.
- No migration. Payments for dues are normal `payments` rows (paper_id null, idempotency key `dues:<deferralId>:<order>`).
- Needs a deploy of the site (the Android app loads the live site). Not type-checked here (no node_modules): run `npm run build`/tsc first.
