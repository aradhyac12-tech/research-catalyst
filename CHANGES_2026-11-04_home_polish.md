# Home page polish (first thing visitors see)

- Header: the Paperly name now sits beside the seal (serif wordmark, with "International Journal of Medical Innovation" under it where there is room). On phones it shows where no other buttons share the header (home, submit, my research).
- Hero: the italic line became "Paperly International Journal" with a thin gold rule; headline sized for phones (2.1 rem up to 3.6 rem), tighter leading and spacing so lines no longer touch; calmer lede; more room above the search.
- Search: placeholder shortened to "Title or keyword" so it is no longer cut off; the field is a slightly lighter surface in dark mode so it reads as a field; mobile padding trimmed.
- Recently published: heading and link breathe (link drops under the heading on narrow screens); titles typed in ALL CAPS are shown in title case (display only; stored titles unchanged; acronyms like MRI, COVID, DNA stay capitals; mixed-case titles untouched); the underline appears on hover instead of always; tighter, steadier row rhythm.
- Motion: the opening sequence is shorter (560 ms, 180 ms total stagger), the hover marker sits closer to the row. One orchestrated moment, nothing else moves on its own.
- Files: src/routes/index.tsx, components/site-header.tsx, search-field.tsx, article-row.tsx, lib/title-case.ts (+ test), styles.css.
- Not run: build, vitest, a visual check in a browser (none available here). Please look at the home page on the phone after deploying and tell me what to adjust.

## Article titles: automatic capitals (follow-up)
- New `formatTitle()` in lib/title-case.ts: lowercase, ALL CAPS and sentence-case titles all become proper title case ("effects of exercise on blood pressure" -> "Effects of Exercise on Blood Pressure"). Small words stay low (not first, last or after a colon), the word after a colon is capitalised, hyphen parts are handled ("Long-Term Follow-Up"), extra spaces are collapsed. Acronyms and deliberate mixed case are kept (MRI, COVID-19, IL-6, mRNA, pH, iPSC).
- Stored on submit (server schema and the Title field on blur), and on admin/editorial title corrections, so new records are saved in title case.
- Older stored titles are shown in title case everywhere (home and explore lists, article page and its link preview/citation, my research, dashboard, admin, reviews, certificate page, certificate PDF and email, Zenodo and delete lists). Stored values of old records are not rewritten.
- Run here: the title-case unit tests (12 passed, in isolation). Not run: full type-check, build, browser check (no install of the project's dependencies here).

## Scroll animation
- New `components/scroll-reveal.tsx` (mounted once in `__root.tsx`): anything marked `data-reveal` eases up 22 px and fades in the first time it scrolls into view (720-820 ms, the site's settle curve). Items that arrive together follow 70 ms apart (max 5 steps). `data-reveal="fade"` and `"scale"` are the quieter variants.
- What is already on screen when a page opens just stays put (no flash); rows that load in later, such as the article list once its data arrives, do animate.
- Marked: article rows (home and Explore), the home "Recently published" heading, the "For authors" panel and its steps. Public reading pages (Explore, About, Fees, Editorial board, Policies, Verify, article pages) get their sections revealed automatically. Admin, submit and dashboards never animate on scroll.
- Home headline drifts up and softens as it scrolls out (pure CSS scroll timeline; browsers without it keep it still).
- Safe fallbacks: nothing is hidden before the script runs or without JavaScript; reduced-motion visitors see everything at once; printing shows everything.
- Checked here: syntax of the edited files only. Not run: build, type-check, a browser. Please scroll the home page, Explore and an article on the phone after deploying.
