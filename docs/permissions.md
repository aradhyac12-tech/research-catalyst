# Who can do what

Administrators are on top. Source of truth: `src/lib/domain/permissions.ts` (`ROLE_PERMISSIONS`) and the server checks in `core.server.ts`.

| Capability | Researcher | Reviewer | Editor | Founder | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Submit and manage own papers | yes | yes | yes | yes | yes |
| Take or be invited to a peer review | | yes | | | |
| Screening queue, editorial decisions, invite reviewers | | | yes | | yes |
| Set the open reviewer list per paper | | | yes (own papers) | | yes |
| Users list and revenue / transactions (read only) | | | | yes | yes |
| Allow editor and reviewer roles | | | | yes | yes |
| Make or remove a founder | | | | | yes |
| Make or remove an administrator (max two, never yourself) | | | | | yes |
| Change the roles of an administrator or founder | | | | | yes |
| Pause or resume the paywall, fee waivers | | | | | yes |
| Payments console, certificates, publication, settings, audit log | | | | | yes |
| Auto abstract, keywords and references on submit | | | | yes | yes |
| Founder view page (people, money, transactions) | | | | yes | yes |
| E-mail a registered user, optionally drafted by AI (always read and sent by the admin) | | | | | yes |

Rules that cut across the table:
- Nobody changes their own roles.
- A founder can never touch an administrator's or another founder's roles (`canChangeRolesOf`).
- Editors cannot handle a paper they submitted or authored; reviewers cannot review one either.
- Everything a founder can do, an administrator can do too.
- Admin e-mails: the AI only drafts from the admin's notes and sees the first name only; sending needs the admin to press Send, is limited to 20 per hour, is logged in the audit log and shown under "Recently sent".
- Founders can never hold a permission an administrator lacks (covered by a test).
