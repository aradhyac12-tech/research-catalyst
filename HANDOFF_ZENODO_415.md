# Handoff: Zenodo HTTP 415 (RP-2026-000022)
Changed: src/lib/domain/zenodo-client.ts only.
- Body-less POSTs (actions/edit, actions/publish) now send Content-Type: application/json with body {}.
- File upload to the bucket now uses application/octet-stream (was application/pdf).
- ZENODO_UNEXPECTED_STATUS errors now say which call failed (method + path) and the first 160 chars of Zenodo's reply (token redacted).
Next: redeploy, then Admin > DOI (Zenodo) > Retry for RP-2026-000022 (same deposit is resumed, no duplicate).
If it still fails, the new message names the exact step; send me that text.
Not run: npm test (no node_modules in the upload).

## Word (.docx) manuscripts now deposit as PDF
- zenodo.ts: validation accepts pdf or docx (other types still rejected, code FILE_NOT_PDF).
- article-stamp.ts: new renderDocxAsPdf (text rendering, no cover/record sheet, deterministic).
- zenodo.server.ts loadFile: converts .docx to PDF before upload; returns sourceSha256 of the stored docx.
- zenodo-workflow.ts: checksum guard compares the stored file (sourceSha256 ?? sha256).
- The PDF is a text rendering (images/complex layout dropped). Upload a PDF version to deposit the author's own layout.
