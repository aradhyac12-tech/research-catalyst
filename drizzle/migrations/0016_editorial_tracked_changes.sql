-- Editor's tracked changes to a manuscript's title, abstract and keywords. The paper itself is never overwritten here:
-- a change is a proposal that stores the text before and after, so editors, reviewers and the author can see exactly what differs.
create table if not exists public.editorial_edits (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  version_id uuid,
  field text not null check (field in ('title','abstract','keywords')),
  before_text text not null,
  after_text text not null check (length(after_text) between 1 and 20000),
  note text check (note is null or length(note) <= 1000),
  editor_id uuid not null,
  status text not null default 'PROPOSED' check (status in ('PROPOSED','WITHDRAWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists editorial_edits_one_open on public.editorial_edits (paper_id, field) where status = 'PROPOSED';
create index if not exists editorial_edits_paper on public.editorial_edits (paper_id);
alter table public.editorial_edits enable row level security;
revoke all on public.editorial_edits from anon, authenticated;
grant all on public.editorial_edits to service_role;
-- No RLS policies on purpose: every read and write goes through server functions that check the caller's role.
