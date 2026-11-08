# Gmail mail system

Authors get an e-mail for every important event on their paper: submission received, status changes, editor's tracked changes,
approval / disapproval / requested changes, certificates (PDF attached), publication, notices and payment updates.
Reviewers get invitations and deadline changes. Everything is also kept in the in-app notifications.

**Where it goes:** the e-mail address of the account that uploaded the paper. If the submission form gave a different e-mail for the
corresponding author, that address is copied (Cc) on mail about that paper.

**How it works:** `notify()` writes the in-app notification, then `mail.server.ts` queues a row in `public.email_outbox` and sends it through
Gmail (SMTP with an App Password, or the Gmail API). A failed send is retried (1, 5, 30, 120, 720 minutes, then marked DEAD). `notifications.email_status` shows
NOT_CONFIGURED / QUEUED / SENT / FAILED / NO_ADDRESS. Mail problems never block a decision, upload or payment.

## Setup A (recommended, no domain needed): Gmail App Password
This is the simplest route and needs no Google Cloud project, no verified domain and no token that expires.
1. Use a dedicated Gmail account for the journal (a personal Gmail sends roughly 500 messages a day; Google Workspace about 2,000).
2. In that Google account turn on **2-Step Verification** (Security settings).
3. Go to https://myaccount.google.com/apppasswords, create an app password named "Paperly" and copy the 16 characters (spaces do not matter).
4. In **Vercel** > Settings > Environment Variables (Production and Preview) add:
   - `GMAIL_SENDER` = the Gmail address (for example `journal@gmail.com`)
   - `GMAIL_APP_PASSWORD` = the 16-character app password
   - `PUBLIC_SITE_URL` = your site URL (links in e-mails use it)
   - optional: `MAIL_FROM_NAME` (default "Paperly"), `MAIL_REPLY_TO`
   - optional retry cron: `CRON_SECRET` (Vercel sends it automatically to the `vercel.json` cron) or `MAIL_CRON_SECRET`
5. Redeploy, then open `/api/public/health`: `optional.gmail_mail` should be `true`.

The settings must be in Vercel (the server that runs the app), not in Supabase: Supabase secrets are only visible to Supabase Edge Functions.
If the App Password option is not shown, the account has no 2-Step Verification, or it is a managed school/work account whose admin disabled app passwords.
Revoke the app password in Google at any time to cut off sending.

## Setup B (optional): OAuth with the Gmail API
Only if you already have a verified Google app. Unverified apps in "Testing" mode get refresh tokens that expire after 7 days, and publishing needs a domain and privacy page.
Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (scope `https://www.googleapis.com/auth/gmail.send`) and `GMAIL_SENDER`.
If `GMAIL_APP_PASSWORD` is also set, it wins.

Never commit these values. Rotate or revoke them in Google if they leak.

## Retries
Each send also retries a few overdue messages. `vercel.json` calls `/api/public/mail/process` once a day (the Hobby plan limit); on a Pro plan
change the schedule to `*/10 * * * *`. Any scheduler can call it with `Authorization: Bearer <MAIL_CRON_SECRET>`.

## Notes
- Certificates are attached as PDFs read from the private `certificates` bucket at send time.
- Mail is sent only for the kinds listed in `shouldEmail()` (`src/lib/domain/email-templates.ts`). Staff-only notices stay in-app.
- Gmail may rewrite the From address to the authenticated account; send from that account or a verified alias.
