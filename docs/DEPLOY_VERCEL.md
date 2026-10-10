# Deploying to Vercel (and finding out why a page fails)

## 1. Set these in Vercel > Project > Settings > Environment Variables (Production AND Preview)
Required, **build time** (Vite inlines them, so add them BEFORE building; after adding, redeploy with "Redeploy" and clear the build cache):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Required, **runtime** (server):
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (service role is server-only; never prefix it with `VITE_`)

Optional until you use them: `PUBLIC_SITE_URL` (set to `https://paperly-ashy.vercel.app` or your domain), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` (any one is enough for AI screening; they are tried in that order; optional `GEMINI_MODEL`, `GROQ_MODEL`, `ANTHROPIC_MODEL`), and the Gmail mail settings (`GMAIL_SENDER` + `GMAIL_APP_PASSWORD`; see docs/MAIL_SETUP.md). Do not set `PAYMENT_TEST_MODE` in production.

Supabase > Authentication > URL Configuration: add the Vercel URL as Site URL and as a Redirect URL (also needed for Google sign-in).

## 2. Check the deployment
Open `https://<your-site>/api/public/health`.
- `ok: true` means required settings are present and the database answers.
- `missingRequired` lists the NAMES of missing settings. Add them, redeploy.
- `database: "unreachable"` means the URL/keys are wrong or Supabase is down.

## 3. When a visitor sees an error
The page shows a reference like `ERR-7K3Q9ZD2`. Search Vercel > Logs for that reference: the log line holds the real cause (message, short stack, path). Browser-side crashes are reported to the same log as `client_error` with the same reference. Visitors never see raw messages.

## 4. Local checks
`npm ci && npm run typecheck && npm run lint && npm test && npm run build`
