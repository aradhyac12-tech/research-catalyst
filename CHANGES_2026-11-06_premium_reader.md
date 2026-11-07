# Premium article reader, article front block, home cards

## Full text is now organised reading text (PDFs too)
- New `lib/domain/pdf-structure.ts`: rebuilds lines from the PDF's positioned text, drops running heads/footers/page numbers, repairs hyphenated line ends, and groups lines into headings (by size, section names, "1.2 Numbered" titles), paragraphs, bullet/numbered lists, a keywords line and references. Output is escaped text in the same tag set as the Word converter. Unit tests in `pdf-structure.test.ts`.
- `getPublicFullText` (app.functions.ts) now returns `{ kind: "pdf", html, title }` for PDFs. `html` is null for scans (under 80 words), files over 30 MB, or any extraction failure; the page then shows the original pages exactly as before.
- Word files keep their existing converter and now use the same reader.

## Reader (components/full-text.tsx, lib/reader.ts, styles.css)
- "Read online / Full text" header with reading time, word and section counts.
- "In this article" contents list (anchors on every heading), Reading view / Original PDF tabs, text-size control (remembered per browser), Download PDF.
- Printed-journal typography: card sheet, serif body at 1.8 leading, gold-ruled section headings, drop cap, gold list markers, keyword callout, hanging-indent references, striped rounded tables, soft-shadow images. Dark mode follows the site theme. No horizontal scrolling at any width.
- Original PDF pages sit on a soft tray with page captions; loading shows a shimmer skeleton.

## Article page front (routes/article.$paperlyId.tsx)
- Header card: breadcrumb, journal name and issue line, type/article/field pills, large serif title, authors with ORCID, affiliations, and action row (Read full text, Download PDF, Cite, published date).
- Abstract in its own card with keyword chips; "Article information" sidebar is a card.

## Home and lists
- Article rows (home and Explore) are cards with a gold hover edge and three-line abstracts; hero gets a soft brand glow; larger section headings.

## Checked / not checked
- Checked: the structuring code on a generated multi-page PDF and unit-style cases (run with node); the reader CSS rendered in Chromium in light, dark and 390 px widths with no horizontal overflow.
- Not run: `bun install`, type-check, vitest, build (no package registry access here). Please run `bun run typecheck && bun run test` and look at an article and the home page on the phone after deploying.

## Download PDF typography (lib/domain/article-stamp.ts)
- Word manuscripts are rendered to PDF like a journal page: 1-inch margins, Lora 10.5 pt on a 16 pt line, justified paragraphs (only where word gaps stay natural), 14/12/10.5 pt heading hierarchy with a short accent rule, headings never stranded at the foot of a page, no single-line widows or orphans, bullets with hanging indents, references set at 9.5 pt with hanging indent, running head (short title and hairline) on every text page, roomier tables. Applies to the Paperly download and to the Zenodo deposit PDF.
- Front page abstract leading loosened (1.48); the page still scales down to stay on one sheet.
- STAMP_LAYOUT_VERSION 6 -> 7 so cached downloads are regenerated.
- Author PDFs are still inserted page-for-page unchanged (only the margin stamp and page numbers are added), so their own fonts and spacing are theirs.
- Checked: layout logic run against a mocked pdf-lib (page breaks, bottom margin, keep-with-next). Not run: real PDF render, vitest, typecheck. Open one downloaded Word-based article and one PDF-based one to confirm.
