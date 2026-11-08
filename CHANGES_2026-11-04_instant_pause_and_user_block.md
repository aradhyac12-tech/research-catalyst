# Instant pause (no flash, no refresh) + block one person

## Apply first
`drizzle/migrations/0049_user_access_blocks.sql` (new table `user_access_blocks`, server-only, RLS on, no public policies). Until applied, nobody is blocked and the block button reports an error telling you to apply it. 0048 (master pause) must already be applied.

## Why the pause was slow
The page was drawn first and the pause was looked up by the browser afterwards, so visitors saw the real page, then the maintenance page. Changes only reached open pages on a 60 s check.

## Fix
- Root loader (`src/routes/__root.tsx`) reads the pause on the server before the page is sent, so a paused site is drawn as the maintenance page from the first paint.
- Open pages re-check every 10 s and on tab focus, and react in about a second when an admin changes the pause or a block (Supabase Realtime broadcast, `src/lib/site-status.ts`). No refresh needed.
- Server cache cut from 5 s to 2 s.
- Admins: this device remembers "an admin signed in" (display only), so the page shows blank instead of the maintenance screen while it confirms who you are. First sign-in on a new device may flash the maintenance screen for a moment.

## Block one person
- Admin > Users and roles > click a person > optional message > "Block this person" / "Restore access". Blocked people see a "Your access is paused" page with Sign out; the server also refuses their submit, upload and payment actions. Admins cannot be blocked and you cannot block yourself. Audit-logged (`user_blocked`, `user_unblocked`).
- Files: maintenance.server.ts, maintenance.functions.ts (getMyAccess, adminSetUserBlock), founder.server.ts (blocked flag in list), role-manager.tsx, maintenance.tsx (BlockedScreen), master-pause.tsx.

## Checks
`node tests/server-functions-auth.test.mjs` passes. NOT run here (no packages): `tsc`, `vitest`, `vite build`. Run `bun run build` and `bun run test` before deploying. If Realtime broadcast is restricted in your Supabase project, everything still works through the 10 s check.
