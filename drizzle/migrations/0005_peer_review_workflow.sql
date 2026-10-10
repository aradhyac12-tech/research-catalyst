-- 0005: M-3 editorial + peer-review workflow. Extends existing tables; nothing is dropped except constraints replaced below.

create or replace function public.paper_transition_allowed(_from public.paper_status, _to public.paper_status, _override boolean)
returns boolean language sql immutable as $$
  select case
    when _to::text = 'PUBLISHED' and _from::text <> 'PUBLICATION_PENDING' then false
    when (_from::text, _to::text) in (
      ('DRAFT','SUBMITTED'),
      ('SUBMITTED','PROCESSING'),('SUBMITTED','WITHDRAWN'),
      ('PROCESSING','AI_SCREENING'),('PROCESSING','REVIEW_REQUIRED'),
      ('AI_SCREENING','REVIEW_REQUIRED'),('AI_SCREENING','PROCESSING'),
      -- REVIEW_REQUIRED is the editorial-screening queue
      ('REVIEW_REQUIRED','ACCEPTED'),('REVIEW_REQUIRED','REJECTED'),('REVIEW_REQUIRED','REVISION_REQUIRED'),
      ('REVIEW_REQUIRED','REVIEWER_ASSIGNMENT'),('REVIEW_REQUIRED','WITHDRAWN'),
      ('REVIEWER_ASSIGNMENT','PEER_REVIEW'),('REVIEWER_ASSIGNMENT','REVIEW_REQUIRED'),('REVIEWER_ASSIGNMENT','WITHDRAWN'),
      ('PEER_REVIEW','EDITORIAL_DECISION'),('PEER_REVIEW','REVIEWER_ASSIGNMENT'),('PEER_REVIEW','WITHDRAWN'),
      ('EDITORIAL_DECISION','ACCEPTED'),('EDITORIAL_DECISION','REJECTED'),('EDITORIAL_DECISION','REVISION_REQUIRED'),
      ('EDITORIAL_DECISION','REVIEWER_ASSIGNMENT'),('EDITORIAL_DECISION','WITHDRAWN'),
      ('REVISION_REQUIRED','SUBMITTED'),('REVISION_REQUIRED','WITHDRAWN'),
      ('ACCEPTED','PAYMENT_PENDING'),('ACCEPTED','PUBLICATION_PENDING'),
      ('PAYMENT_PENDING','PAYMENT_COMPLETED'),('PAYMENT_PENDING','ACCEPTED'),
      ('PAYMENT_COMPLETED','PUBLICATION_PENDING'),
      ('PUBLICATION_PENDING','PUBLISHED'),
      ('PUBLISHED','CORRECTED'),('PUBLISHED','RETRACTED'),('PUBLISHED','ARCHIVED'),
      ('CORRECTED','CORRECTED'),('CORRECTED','RETRACTED'),('CORRECTED','ARCHIVED'),
      ('REJECTED','ARCHIVED'),('WITHDRAWN','ARCHIVED')
    ) then true
    when _override and (_from::text, _to::text) in (
      ('REJECTED','REVIEW_REQUIRED'),('REJECTED','ACCEPTED'),('REJECTED','REVISION_REQUIRED'),
      ('ACCEPTED','REJECTED'),('ACCEPTED','REVIEW_REQUIRED'),
      ('REVISION_REQUIRED','REJECTED'),('REVISION_REQUIRED','ACCEPTED')
    ) then true
    else false
  end
$$;

-- Editorial configuration (single row, server-side only).
create table public.editorial_settings (
  id boolean primary key default true check (id),
  journal_mode_enabled boolean not null default false,
  default_review_model text not null default 'DOUBLE_ANONYMOUS' check (default_review_model in ('SINGLE_ANONYMOUS','DOUBLE_ANONYMOUS','OPEN')),
  reviews_required int not null default 2 check (reviews_required between 1 and 5),
  review_days int not null default 21 check (review_days between 3 and 90),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.editorial_settings default values on conflict do nothing;
grant all on public.editorial_settings to service_role;
alter table public.editorial_settings enable row level security;

alter table public.papers
  add column if not exists handling_editor_id uuid,
  add column if not exists review_model text check (review_model in ('SINGLE_ANONYMOUS','DOUBLE_ANONYMOUS','OPEN')),
  add column if not exists review_round int not null default 1 check (review_round >= 1);
alter table public.papers add constraint papers_editor_not_owner check (handling_editor_id is null or handling_editor_id <> owner_id);

-- A journal article can only be accepted after a peer review has actually been completed.
create or replace function public.guard_journal_acceptance() returns trigger language plpgsql as $$
begin
  if new.status::text = 'ACCEPTED' and old.status::text <> 'ACCEPTED' and new.publication_type = 'JOURNAL_ARTICLE'
     and not exists (select 1 from public.review_assignments r where r.paper_id = new.id and r.status = 'COMPLETED') then
    raise exception 'A journal article cannot be accepted before at least one peer review is completed';
  end if;
  return new;
end $$;
drop trigger if exists papers_guard_journal_acceptance on public.papers;
create trigger papers_guard_journal_acceptance before update of status on public.papers for each row execute function public.guard_journal_acceptance();

-- Reviews: extend review_assignments.
alter table public.review_assignments drop constraint if exists review_assignments_status_check;
update public.review_assignments set status = 'INVITED' where status = 'ASSIGNED';
alter table public.review_assignments add constraint review_assignments_status_check
  check (status in ('INVITED','ACCEPTED','DECLINED','COMPLETED','REPLACED','EXPIRED'));
alter table public.review_assignments alter column status set default 'INVITED';
alter table public.review_assignments drop constraint if exists review_assignments_paper_id_reviewer_id_key;
alter table public.review_assignments
  add column if not exists round int not null default 1,
  add column if not exists version_id uuid references public.paper_versions(id),
  add column if not exists responded_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists coi_status text check (coi_status in ('NONE','POTENTIAL','CONFLICT')),
  add column if not exists coi_statement text,
  add column if not exists comments_to_author text,
  add column if not exists confidential_to_editor text,
  add column if not exists editor_notes text;
alter table public.review_assignments drop constraint if exists review_assignments_recommendation_check;
alter table public.review_assignments add constraint review_assignments_recommendation_check
  check (recommendation is null or recommendation in ('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT'));
alter table public.review_assignments add constraint review_assignments_unique_round unique (paper_id, reviewer_id, round);
alter table public.review_assignments add constraint review_completed_has_content
  check (status <> 'COMPLETED' or (recommendation is not null and comments_to_author is not null and length(trim(comments_to_author)) >= 50 and completed_at is not null and coi_status is not null));
alter table public.review_assignments add constraint review_potential_coi_explained
  check (coi_status is distinct from 'POTENTIAL' or (coi_statement is not null and length(trim(coi_statement)) >= 5));

-- Nobody reads review rows directly: reviewers and authors go through authorised server functions only.
drop policy if exists "reviewer own or staff" on public.review_assignments;
revoke select on public.review_assignments from authenticated;

create or replace function public.review_frozen() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'COMPLETED' then raise exception 'Completed reviews cannot be deleted'; end if;
    return old;
  end if;
  if old.status = 'COMPLETED' and (
       new.status is distinct from old.status or new.reviewer_id is distinct from old.reviewer_id or new.paper_id is distinct from old.paper_id
    or new.recommendation is distinct from old.recommendation or new.comments_to_author is distinct from old.comments_to_author
    or new.confidential_to_editor is distinct from old.confidential_to_editor or new.completed_at is distinct from old.completed_at
    or new.coi_status is distinct from old.coi_status) then
    raise exception 'Completed reviews are immutable';
  end if;
  return new;
end $$;
drop trigger if exists review_assignments_frozen on public.review_assignments;
create trigger review_assignments_frozen before update or delete on public.review_assignments for each row execute function public.review_frozen();

create or replace function public.review_no_self() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.papers p where p.id = new.paper_id and p.owner_id = new.reviewer_id)
     or exists (select 1 from public.paper_authors a where a.paper_id = new.paper_id and a.user_id = new.reviewer_id) then
    raise exception 'A reviewer cannot review a paper they submitted or authored';
  end if;
  return new;
end $$;
drop trigger if exists review_assignments_no_self on public.review_assignments;
create trigger review_assignments_no_self before insert on public.review_assignments for each row execute function public.review_no_self();

-- Versions, anonymised file, revision responses, revision type.
alter table public.paper_versions
  add column if not exists anonymized_storage_path text,
  add column if not exists anonymized_file_hash text;

create or replace function public.append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;

create table public.revision_responses (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  version_id uuid not null references public.paper_versions(id),
  round int not null,
  response_text text not null check (length(trim(response_text)) >= 20),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index revision_responses_paper_idx on public.revision_responses(paper_id);
create trigger revision_responses_append_only before update or delete on public.revision_responses for each row execute function public.append_only();
grant select on public.revision_responses to authenticated;
grant all on public.revision_responses to service_role;
alter table public.revision_responses enable row level security;
create policy "owner or staff read" on public.revision_responses for select to authenticated using (public.can_access_paper(paper_id, auth.uid()));

alter table public.decisions add column if not exists revision_type text check (revision_type in ('MINOR','MAJOR'));

-- Human editorial decisions must be attributable and reasoned (already required: actor). Machine rows stay REVIEW_REQUIRED (0002).
