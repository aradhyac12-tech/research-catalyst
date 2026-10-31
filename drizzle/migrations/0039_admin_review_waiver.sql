-- Administrator override: a paper may be accepted without peer review when an administrator waives it (reason recorded).
-- The paper is never flagged peer_reviewed by this (guard_peer_reviewed still requires a completed review), so the record
-- stays honest: a journal article accepted this way shows "Peer review not recorded".
alter table public.papers
  add column if not exists review_waived boolean not null default false,
  add column if not exists review_waived_by uuid references auth.users(id),
  add column if not exists review_waived_reason text,
  add column if not exists review_waived_at timestamptz;

create or replace function public.guard_journal_acceptance() returns trigger language plpgsql as $$
begin
  if new.status::text = 'ACCEPTED' and old.status::text <> 'ACCEPTED' and new.publication_type = 'JOURNAL_ARTICLE'
     and not new.review_waived
     and not exists (select 1 from public.review_assignments r where r.paper_id = new.id and r.status = 'COMPLETED') then
    raise exception 'A journal article cannot be accepted before at least one peer review is completed';
  end if;
  return new;
end $$;
alter function public.guard_journal_acceptance() set search_path = public;
