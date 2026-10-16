-- Authors can accept or reject an editor's tracked change. Accepting applies the text to the paper; rejecting leaves the paper untouched.
-- Both outcomes are kept on the record (who decided and when) instead of deleting the proposal.
alter table public.editorial_edits drop constraint if exists editorial_edits_status_check;
alter table public.editorial_edits add constraint editorial_edits_status_check check (status in ('PROPOSED','WITHDRAWN','ACCEPTED','REJECTED'));
alter table public.editorial_edits add column if not exists decided_by uuid;
alter table public.editorial_edits add column if not exists decided_at timestamptz;
-- The partial unique index (one open proposal per field) only covers PROPOSED, so decided rows never block a new proposal.
