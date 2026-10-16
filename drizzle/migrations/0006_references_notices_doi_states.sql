-- 0006: M-4. Structured references with validation status, wider notice kinds, wider DOI states, explorer indexes.
-- Additive. No data is deleted.

create table public.paper_references (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  position int not null check (position >= 1),
  raw_text text not null check (length(trim(raw_text)) >= 5),
  doi text check (doi is null or doi ~* '^10\.[0-9]{4,9}/\S+$'),
  matched_title text,
  validation_status text not null default 'NOT_CHECKED'
    check (validation_status in ('NOT_CHECKED','VERIFIED','PARTIALLY_VERIFIED','DOI_NOT_FOUND','REQUIRES_REVIEW')),
  validation_note text,
  validated_at timestamptz,
  unique (paper_id, position)
);
create index paper_references_paper_idx on public.paper_references(paper_id);
grant select on public.paper_references to authenticated;
grant all on public.paper_references to service_role;
alter table public.paper_references enable row level security;
create policy "owner or staff read" on public.paper_references for select to authenticated using (public.can_access_paper(paper_id, auth.uid()));
-- Published reference lists are frozen unless a correction is in progress.
create trigger paper_references_guard_published before insert or update or delete on public.paper_references
  for each row execute function public.guard_published_children();

-- Notice kinds: add ERRATUM, ADDENDUM and WITHDRAWAL (post-publication withdrawal notice).
alter table public.corrections drop constraint if exists corrections_kind_check;
alter table public.corrections add constraint corrections_kind_check
  check (kind in ('CORRECTION','ERRATUM','ADDENDUM','EXPRESSION_OF_CONCERN','RETRACTION','WITHDRAWAL'));
alter table public.corrections add constraint corrections_reason_len check (length(trim(reason)) >= 10) not valid;
alter table public.corrections add constraint corrections_notice_len check (length(trim(notice)) >= 20) not valid;

-- DOI lifecycle states.
alter table public.doi_records drop constraint if exists doi_records_status_check;
alter table public.doi_records add constraint doi_records_status_check
  check (status in ('NOT_CONFIGURED','READY','PENDING','REGISTERING','SUBMITTED','REGISTERED','VERIFIED','FAILED','UPDATE_REQUIRED'));
-- A DOI value may only exist once the agency has confirmed it.
alter table public.doi_records add constraint doi_only_when_confirmed
  check (doi is null or status in ('REGISTERED','VERIFIED','UPDATE_REQUIRED')) not valid;

-- Explorer.
create index if not exists papers_field_idx on public.papers(field);
create index if not exists papers_type_idx on public.papers(publication_type);
