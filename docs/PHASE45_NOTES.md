# Phase 45 - Test publish and second admin

- New admin Test mode button **Test publish** (drizzle/migrations/0034). Same flow as Skip payment, plus:
  - paper gets `is_test = true` and a `[Test] ` title prefix
  - certificates for that paper are issued in the name `Test` with `is_test = true` (reviewer certificates unchanged)
  - payment row stores `promo_code_text`, `original_amount_minor`, `discount_minor`, and `amount_minor` = amount received; `is_test = true`
  - a promo code is applied to the amount but NOT used up (same as the existing test payment)
  - founder revenue summary excludes `is_test` payments
  - "Test payments" ledger table shown under the buttons
- Second admin: an admin/super admin can allow the **Admin** role from Users and roles. Max two accounts hold admin/super_admin (server check + DB trigger `enforce_max_two_admins`). You cannot change your own admin role.
- Not run here: no node_modules in the upload, so tsc/vitest were not executed. Run `npm i && npm run build && npx vitest run`, then apply migration 0034.

# Phase 46 - Journal look and journal name
- Name everywhere: "Paperly International Journal of Medical Innovation" (src/lib/domain/journal.ts). Header wordmark larger with "International Journal of Medical Innovation" after it, footer, page titles, certificate masthead and wording.
- Stamped article download (layout version 2): new journal first page (big PAPERLY, journal name, "Volume:01/Issue:10/October-2026" line, centred bold title, bold authors numbered with superscripts, teacher first, affiliation lines, bold Abstract, bold Keywords on one horizontal line), then the record sheet, then the manuscript. "Page n of N" bottom right on every page.
- Volume = year - 2026 + 1, Issue = month (change JOURNAL_FIRST_YEAR in journal.ts if volumes should start another year).
- Word manuscripts: Abstract, Introduction, Methods, Results, Discussion, Conclusion, References and ALL-CAPS short lines are bold headings; Keywords become one horizontal line (also in the on-page full text).
- Teacher detection: affiliation text containing lecturer / professor / teacher / supervisor / Dr. (and not "student"). Needs the affiliation filled in for each author.
- Limits: a PDF upload keeps the author's own pages (only the margin stamp and page number are added), so their headings cannot be restyled. Not compiled or run here (no node_modules): npm i && npm run build && npx vitest run.

# Phase 47 - Official logo
- Logo files: public/paperly-logo.png (website) and src/assets/logo-resources.ts (embedded in PDFs). Transparent background.
- Website: header (h-12) and footer (h-20) use the logo.
- Article download: logo at the top of the journal first page (layout version 3, so cached downloads are rebuilt).
- Certificates: the old baked-in wordmark was removed from src/assets/certificate-template.jpg and the logo is drawn in the masthead (LOGO_BOX in certificate-layout.ts); the "INTERNATIONAL JOURNAL" descriptor text lines were removed because the logo carries them. Certificates already issued keep their stored PDF until regenerated.
- Not done: favicon.ico and social-share image still the old ones.
