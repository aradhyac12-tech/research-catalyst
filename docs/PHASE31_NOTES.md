# Phase 31: certificates for every author, one e-mail with all of them, admin hold

## What it does
- **Authors.** The submit form already lets the uploader add any number of authors (Add another author), each with a name and an email. Each author now gets their own PUBLICATION certificate with their name on it, whether or not they gave an email.
- **E-mail.** Each recipient (the uploader's account address and each author's address) gets ONE e-mail with ALL the authors' certificate PDFs attached. Two authors must not share an address (the form checks this). Sending is idempotent: the outbox key contains the set of attached certificates, so a repeat run sends nothing.
- **Pause (admin).** Admin > Research > "Author certificates" on each paper lists the authors. "Pause certificate" (reason required, internal, audit-logged) means that author gets no certificate and no e-mail, their certificate is left out of everyone else's e-mail, and an existing certificate stops verifying, downloading and appearing in their Certificates list. "Resume certificate" releases it; if the paper is published, the missing certificate is issued and the completed set is e-mailed. The author is not notified of a pause.

## Database (migration 0031, additive)
`author_certificate_holds` (no client grants), `certificates.on_hold`, `email_outbox.attachments` (jsonb), and the certificate select policy now hides on-hold rows from their recipient.

## Limits to know
- An e-mail that was already sent cannot be recalled. Pausing afterwards hides the certificate on the site and stops further e-mails, and the admin is told when earlier certificate e-mails exist for the paper.
- Resuming re-sends the completed set of certificates to every recipient (a new set means a new e-mail).
- A paused certificate verifies as "not found" on the public page.

# AI screening: trust and genuineness (prompt screening-prompt-1.1)
- **Quotations are verified.** Every quoted passage in an AI finding is looked up in the manuscript text and marked found / not found. A severe or FAIL finding whose quotes are not in the manuscript (or a statistics / data / figures claim with no quote) is downgraded to REVIEW_REQUIRED, moderate, with an "Unconfirmed" note, so it cannot drive a REJECT recommendation.
- **No contradiction with hard facts.** A PASS or NOT_APPLICABLE is raised to REVIEW_REQUIRED when Crossref could not resolve DOIs, similarity is HIGH or the file is a duplicate, human participants were declared without complete approval/consent, or almost no text was extracted. The AI-content check is capped at "minor". The injection flag follows the deterministic scan.
- **Long manuscripts are not silently cut.** Over the limit, the start (60%) and end (40%) are sent with a marker, the model is told the middle is missing, and confidence is capped at 0.85. Editors see "Manuscript read: PARTIAL (x of y characters)".
- **Confidence reflects evidence.** If fewer than half of 3+ quotations are found in the text, confidence is multiplied by 0.7, which can trip the policy's low-confidence rule.
- Editors see a "How far to trust this screening" note and a "found / not found in manuscript" tag on each quotation. Screening stays advisory: a human always decides.
- Not changed: the similarity check still compares title + abstract with up to 500 published records only. A full-text corpus comparison or an external similarity service would be the next step, and no real plagiarism checker is connected.

# Reviewer certificate and Google Scholar
- **Reviewer certificate.** Submitting a review now issues a PEER_REVIEW certificate to the reviewer (e-mailed as PDF, listed under Certificates). It is confidential by design: it shows an opaque reference (PR-XXXXXXXXXX) instead of the manuscript title and Paperly ID, has no DOI, and its verification page does not link to the paper. Reason: certificate IDs are sequential and publicly verifiable, so a title or paper ID would let anyone (including authors) learn who reviewed what. The daily sweep also issues missing ones for reviews completed in the last 30 days.
- **Google Scholar.** Article pages already carry the Highwire/Dublin Core tags Scholar reads. Added a "Search for this record on Google Scholar" link (exact-title search) on the article page, the public certificate verification page for publication certificates, and in the certificate e-mail. These are search links only: Google alone decides what it indexes, so nothing says a work is indexed. The certificate PDF template was not changed.

# Phase 34: review status and Google Scholar printed on the certificate
- **Publication certificates** now print two extra lines under the DOI line: the record type with its review status (from `describeRecord`, so "Peer reviewed" appears only for a journal article with completed reviews recorded; preprints and repository records say they are not peer reviewed), and a "Search this work on Google Scholar" line. The Scholar line is a clickable exact-title search link (second link annotation in the PDF, a clickable area in the on-screen certificate). It is a search link only; nothing says the work is indexed.
- **Not added** to submission, author-record or reviewer certificates. The reviewer certificate stays confidential (it never names the manuscript, so it cannot carry a title search).
- Same layout drives the PDF and the on-screen view. Issued PDFs and their hashes are unchanged; only newly generated documents carry the new lines. Older publication certificates will show the lines in the on-screen preview but not in their already-issued PDF.
- No database change.

## Phase 34 update: every record is peer reviewed; proper Google Scholar setup
- **Policy now enforced.** `outcomeAllowed` requires a completed review before ACCEPT for every record type (preprints and repository records included); before review only a desk rejection is possible. "Start peer review" is available for every record. `peer_reviewed` is set when an accepted record has completed reviews (the DB trigger already required that). Policy pages, the site banner and the dashboard line were reworded to match.
- **Certificates.** Publication certificates print the recorded review status (so "Peer reviewed" appears only when completed reviews are recorded, never as a blanket claim). Submission certificates print "Submitted to the Paperly peer review process; outcome not yet decided". The reviewer certificate is itself the peer-review certificate and stays confidential.
- **Google Scholar.** Scholar needs a full-text PDF on the same host. New public route `/article/<PLY-id>/pdf` serves the current version of a public record when it is a PDF (404 otherwise, never under /api/ because robots.txt blocks that). Article pages now carry `citation_pdf_url` and a visible "Full text (PDF)" link. Existing Highwire/Dublin Core tags, JSON-LD, sitemap and robots are unchanged.
- **Limits.** Records already published before this rule keep "Peer review not recorded" / "Not peer reviewed" until reviews are recorded. A DOCX manuscript has no PDF, so it gets no `citation_pdf_url` (Scholar cannot read DOCX); a PDF rendition would be needed. Scholar still decides if and when to index: submit the site's sitemap in Search Console and allow a few weeks. No migration.

## Phase 35: keywords and references suggested from the submitted file
- **Submit form, step 1.** A "Fill keywords and references from your file" box: the author ticks the AI consent (the same consent as screening, shared state) and presses "Suggest keywords and references". Nothing runs before consent and nothing is overwritten without asking. Both fields stay editable, and a note says they are suggestions.
- **Server.** `suggestMetadata` -> `server/suggest.server.ts`. It scans the file (same safety check as submission), extracts the text, finds the reference list by its heading, and asks the configured providers in order (Gemini, Groq, Anthropic when keyed) for 5-8 keywords and the reference entries, in up to five parallel chunks. Rate limit: six runs per ten minutes per person (per server instance). The text is not stored or logged.
- **No invented references.** The model is told to copy entries exactly, and every returned entry is checked against the reference-list text (ignoring spacing, case, accents, punctuation, page markers). Anything not found is dropped and reported ("N entries ... left out"). If the AI is down or returns nothing usable, a clearly numbered list is read directly from the file; an unnumbered list is not guessed at and the author is asked to paste it.
- **Keywords** are cleaned to the form's limits (max 12, each at most 60 characters, unique).
- **Limits.** Scanned PDFs have no text and give an error. Lists over about 35,000 characters are read only in part (a note says so). These calls are not recorded in the screening AI budget ledger; the per-person limit and the input size cap bound the spend. No database change.

## Keyword limit raised
- Keywords: at most 20 per submission (was 12), each still at most 60 characters. One constant (`KEYWORDS_MAX_COUNT` in `domain/keywords.ts`) drives the form check, the form hint, the server check and the AI suggestion cap. No database constraint limits the count, so no migration. To change it again, edit that one number.

## Automatic keywords and references: founder and admin uploads only
- The "Suggest keywords and references" box on the submit form is shown only to accounts with the founder, admin or super_admin role. Everyone else sees the plain Keywords and References fields and types or pastes them.
- Enforced on the server, not just hidden: `suggestFromFile` checks the caller's roles first and returns "Forbidden" otherwise, before reading the file or calling any AI provider. The role list is `METADATA_SUGGEST_ROLES` in `domain/permissions.ts` (the founder role keeps its existing three permissions; no permission was added).
- To widen it later (for example to editors or all researchers), change that one list.
