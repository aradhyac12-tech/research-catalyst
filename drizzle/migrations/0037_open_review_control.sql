-- 0037: Editor control over the open review list.
-- papers.open_claims decides how reviewers may take a paper from the "Waiting for reviewers" list:
--   OPEN     any reviewer may take a free place at once (the behaviour before this migration, so it stays the default)
--   APPROVAL a reviewer asks, and the handling editor (or an administrator) approves or declines the request
--   OFF      the paper is not listed; only reviewers the editor invites can review it
-- review_assignments gets a REQUESTED status for a request that is waiting for the editor. A request holds no place until approved.
alter table public.papers add column if not exists open_claims text not null default 'OPEN';
alter table public.papers drop constraint if exists papers_open_claims_check;
alter table public.papers add constraint papers_open_claims_check check (open_claims in ('OPEN','APPROVAL','OFF'));
alter table public.review_assignments drop constraint if exists review_assignments_status_check;
alter table public.review_assignments add constraint review_assignments_status_check
  check (status in ('INVITED','REQUESTED','ACCEPTED','DECLINED','COMPLETED','REPLACED','EXPIRED'));
