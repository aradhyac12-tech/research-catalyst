-- Admin removal of an article. Submitted papers can never be hard-deleted (trigger papers_no_delete), so removal is recorded here:
-- the paper is hidden from public pages, author lists and queues, and keeps its history, certificates and payment records.
alter table public.papers add column if not exists deleted_at timestamptz;
alter table public.papers add column if not exists deleted_by uuid;
alter table public.papers add column if not exists deleted_reason text;
create index if not exists papers_not_deleted_status_idx on public.papers (status) where deleted_at is null;
