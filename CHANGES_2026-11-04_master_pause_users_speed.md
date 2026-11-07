# Master pause, names in Users and roles, faster admin

## Apply first
`drizzle/migrations/0048_maintenance_mode.sql` (APPLIED to the research-catalyst Supabase project on 2026-11-04, together with 0047_payments_admin_only). Additive: `editorial_settings.maintenance_enabled` (default false) and `maintenance_message`. Until it is applied the site stays open and the pause switch reports an error telling you to apply it.

## Master pause (Admin page, top, administrators only)
- "Pause the website" (one confirm) closes the site for everyone except administrators; "Open the website" reopens it. Optional message box.
- Visitors see a maintenance page: Paperly logo, 🛠️, "We are under maintenance", "🙏 We apologise for the inconvenience", thank-you line. Only the sign-in page (/auth) stays reachable, with a small "Staff sign in" link, so administrators can get in.
- Administrators see everything as normal plus an amber bar "The site is paused...".
- Open pages notice within a minute (and when the tab is opened again). Server backstop: while paused, non-admins are refused on submit, upload ticket and start payment (`assertSiteOpen` in src/lib/server/maintenance.server.ts). Webhooks and payment callbacks are not blocked.
- Files: src/components/maintenance.tsx, master-pause.tsx, src/lib/maintenance.functions.ts, src/lib/server/maintenance.server.ts, src/routes/__root.tsx.

## Users and roles
- Name is shown first (bold), e-mail under it in small text. Someone with no saved name shows by e-mail alone. Search works on name or e-mail.
- A name saved in the details pop-up refreshes this list right away.
- Role buttons are optimistic: the change shows at once, "Saving..." on the clicked button, and is put back if the server refuses. Other screens refresh in the background.
- Server: setRole and listUsers do their independent reads together; the audit write no longer holds the answer back.

## Speed
- Page-change cross-fade removed (router `defaultViewTransition: false`), entrance animations cut to 60 ms, preload on hover starts at once and is kept 60 s.
- Admin queue: the report is fetched when the pointer/finger lands on a row, so opening it is instant. Role list cached 15 s.

## Checks
`node tests/server-functions-auth.test.mjs`: 126 server functions, 0 failures. Syntax check passed on every changed file. NOT run here (no packages or network): `vitest`, `vite build`, `tsc`. Run `bun run build` and `bun run test` before deploying.
