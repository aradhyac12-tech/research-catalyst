# Automatic DOI registration after "Publish"

## Cause
Clicking Publish ran the whole Zenodo registration inside one short web request. When the host stopped that request part-way, the paper stayed locked for 5 minutes (lease) and only the once-a-day cron (07:00 UTC) would try again. Manual Retry worked because it forces past the lock and resumes the same Zenodo deposit.

## Fix
- Publish now returns "still finishing" instead of an error when the run stopped on something temporary. The browser then keeps calling `zenodoContinue` every 3 to 6 seconds (up to about 4 minutes); each call resumes the same deposit (never a second one) until the DOI is registered and the article is published, with a progress toast. A permanent failure stops and shows its code.
- Same automatic continuation on the DOI dashboard buttons (Approve publication and register, Retry).
- The lock now frees itself after 75 s (was 300 s) so the continuation can take over quickly.
- Files: src/lib/zenodo-auto.ts (new), zenodo.functions.ts (zenodoContinue), zenodo.server.ts (continueRegistration), app.functions.ts (adminPublish), admin.tsx, zenodo-admin.tsx.
- The browser must stay open for the automatic loop; if it is closed, the daily cron still finishes it. For a fully hands-off server-side loop, set a Vercel Pro cron (every 5 minutes) on /api/public/publish/process.

## Not run
vitest, build, tsc (no packages here). Syntax check and node tests/server-functions-auth.test.mjs pass (127 functions, 0 failures).
