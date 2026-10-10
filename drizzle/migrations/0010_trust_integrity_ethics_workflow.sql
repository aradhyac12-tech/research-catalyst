-- 0010: Phase 6 (trust & submission integrity) + Phase 7 (research-ethics workflow). Additive: nothing is dropped or rewritten.
-- No DOI work: doi_records / the DOI provider are untouched and stay NOT_CONFIGURED. Internal identifiers are never DOIs.
-- Written for a fresh database (0000..0009) and for an existing one (all new objects are created, existing rows are only extended).

-- =====================================================================================================================
-- A) ETH identifiers join the identifier graph that already exists (identifier_types / identifier_registry /
--    next_identifier(type) / register_identifier()). Nothing in that system is redefined here. VER and REV already exist
--    there (paper_versions.version_code, review_assignments.review_code), PLY and CERT too.
--    NOTE: that graph came from a migration that is not in this repository (live name: paperly_0009_identifier_graph_rbac).
--    Until it is exported into the repo, this migration refuses to run on a database that lacks it instead of guessing.
-- =====================================================================================================================
do $$
begin
  if to_regclass('public.identifier_types') is null or to_regclass('public.identifier_registry') is null
     or not exists (select 1 from pg_proc where proname = 'next_identifier' and pronamespace = 'public'::regnamespace)
     or not exists (select 1 from pg_proc where proname = 'register_identifier' and pronamespace = 'public'::regnamespace) then
    raise exception '0010 needs the identifier graph (identifier_types, identifier_registry, next_identifier, register_identifier). It exists in the live project but is missing from this repo; export it first.';
  end if;
end $$;
insert into public.identifier_types(identifier_type, prefix, resource_type, allocator, description)
values ('ETHICS_CASE', 'ETH', 'ethics_cases', 'COUNTER', 'Research-ethics case. Internal Paperly identifier, NOT a DOI.')
on conflict (identifier_type) do nothing;

create or replace function public.append_only_guard() returns trigger language plpgsql set search_path = public as $$
begin raise exception '% is append-only', tg_table_name; end $$;

-- =====================================================================================================================
-- B) Declarations are evidence: versioned, append-only. Amendments add a revision; nothing is ever updated or deleted.
-- =====================================================================================================================
alter table public.rights_declarations
  add column if not exists revision int not null default 1,
  add column if not exists supersedes_id uuid references public.rights_declarations(id),
  add column if not exists amended_by uuid,
  add column if not exists amendment_reason text,
  add column if not exists previous_publication_reference text,
  add column if not exists requires_copyright_review boolean not null default false;
alter table public.ethics_declarations
  add column if not exists revision int not null default 1,
  add column if not exists supersedes_id uuid references public.ethics_declarations(id),
  add column if not exists amended_by uuid,
  add column if not exists amendment_reason text,
  add column if not exists policy_version text;
-- Legacy rows all received revision = 1 from the column default; number any repeated declarations per paper in time order
-- BEFORE the unique index and the immutability triggers exist.
update public.rights_declarations d set revision = r.rn from (select id, row_number() over (partition by paper_id order by declared_at, id)::int as rn from public.rights_declarations) r where r.id = d.id and d.revision <> r.rn;
update public.ethics_declarations d set revision = r.rn from (select id, row_number() over (partition by paper_id order by declared_at, id)::int as rn from public.ethics_declarations) r where r.id = d.id and d.revision <> r.rn;
create unique index if not exists rights_declarations_paper_revision_key on public.rights_declarations(paper_id, revision);
create unique index if not exists ethics_declarations_paper_revision_key on public.ethics_declarations(paper_id, revision);

create or replace function public.declaration_immutable() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Declarations are append-only evidence. Submit an amendment (a new revision) instead of changing history.'; end $$;
drop trigger if exists rights_declarations_immutable on public.rights_declarations;
create trigger rights_declarations_immutable before update or delete on public.rights_declarations for each row execute function public.declaration_immutable();
drop trigger if exists ethics_declarations_immutable on public.ethics_declarations;
create trigger ethics_declarations_immutable before update or delete on public.ethics_declarations for each row execute function public.declaration_immutable();

-- Server-side rights policy rights-1.1 (mirrors src/lib/domain/rights-policy.ts). Defence in depth: even a bug or a direct
-- service-role insert cannot store a declaration that breaks the declared policy. Legacy rights-1.0 rows are left as they are.
create or replace function public.rights_validate() returns trigger language plpgsql set search_path = public as $$
begin
  if new.declaration_version = 'rights-1.0' then raise exception 'rights-1.0 is a retired declaration version; use the current version'; end if;
  if not new.is_author then raise exception 'Rights policy: the submitter must declare authorship'; end if;
  if not new.has_upload_rights then raise exception 'Rights policy: upload rights must be declared'; end if;
  if not new.ai_processing_consent then raise exception 'Rights policy: explicit AI-processing consent is required'; end if;
  if new.third_party_content and new.third_party_permission is not true then raise exception 'Rights policy: third-party content requires a permission declaration'; end if;
  if new.previously_published and coalesce(trim(new.previous_doi), '') = '' and coalesce(trim(new.previous_publication_reference), '') = '' then
    raise exception 'Rights policy: previously published work needs a DOI or a publication reference';
  end if;
  if new.manuscript_version_type = 'ORIGINAL_SUBMISSION' and new.previously_published then raise exception 'Rights policy: an original submission cannot be previously published'; end if;
  if new.manuscript_version_type = 'PUBLISHER_VERSION' and not new.previously_published then raise exception 'Rights policy: a publisher version is by definition previously published'; end if;
  if new.manuscript_version_type = 'ACCEPTED_MANUSCRIPT' and coalesce(trim(new.previous_doi), '') = '' and coalesce(trim(new.previous_publication_reference), '') = '' then
    raise exception 'Rights policy: an accepted manuscript needs the venue it was accepted by';
  end if;
  new.requires_copyright_review := new.manuscript_version_type = 'PUBLISHER_VERSION' or new.third_party_content or new.previously_published;
  return new;
end $$;
drop trigger if exists rights_declarations_validate on public.rights_declarations;
create trigger rights_declarations_validate before insert on public.rights_declarations for each row execute function public.rights_validate();

-- =====================================================================================================================
-- C) Ethics: versioned policy, case, append-only events, trial registration, subject privacy / consent
-- =====================================================================================================================
create table if not exists public.ethics_policies (
  version text primary key,
  content_hash text not null,
  rules jsonb not null,
  created_at timestamptz not null default now()
);
create or replace function public.ethics_policy_immutable() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Ethics policy versions are immutable; publish a new version'; end $$;
drop trigger if exists ethics_policies_immutable on public.ethics_policies;
create trigger ethics_policies_immutable before update or delete on public.ethics_policies for each row execute function public.ethics_policy_immutable();

create table if not exists public.ethics_cases (
  id uuid primary key default gen_random_uuid(),
  eth_id text not null unique default public.next_identifier('ETHICS_CASE') check (eth_id ~ '^ETH-[0-9]{4}-[0-9]{6}$'),
  paper_id uuid not null unique references public.papers(id) on delete restrict,
  declaration_id uuid not null references public.ethics_declarations(id),
  policy_version text not null references public.ethics_policies(version),
  research_category text not null,
  status text not null default 'ETHICS_DECLARED' check (status in ('ETHICS_DECLARED','ETHICS_REVIEW_REQUIRED','ETHICS_UNDER_REVIEW','ETHICS_REVISION_REQUIRED','ETHICS_CLEARED','ETHICS_NOT_CLEARED','ETHICS_HUMAN_REVIEW_REQUIRED','ETHICS_NOT_REQUIRED')),
  requires_trial_registration boolean not null default false,
  requires_publication_consent boolean not null default false,
  requires_committee_approval boolean not null default false,
  assigned_reviewer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists zz_register_ethics_case_code on public.ethics_cases;
create trigger zz_register_ethics_case_code after insert on public.ethics_cases for each row execute function public.register_identifier('ETHICS_CASE', 'eth_id');
-- Case rows change only through the security-definer functions below (they set paperly.via_ethics). eth_id never changes.
create or replace function public.ethics_cases_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Ethics cases cannot be deleted'; end if;
  if new.eth_id is distinct from old.eth_id or new.paper_id is distinct from old.paper_id or new.created_at is distinct from old.created_at then
    raise exception 'ETH identifier, paper and creation time are immutable';
  end if;
  if coalesce(current_setting('paperly.via_ethics', true), '') <> '1' then raise exception 'Ethics cases change only through the audited ethics workflow'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ethics_cases_guard_trg on public.ethics_cases;
create trigger ethics_cases_guard_trg before update or delete on public.ethics_cases for each row execute function public.ethics_cases_guard();

create table if not exists public.ethics_events (
  id bigserial primary key,
  case_id uuid not null references public.ethics_cases(id) on delete restrict,
  paper_id uuid not null,
  event_type text not null check (event_type in ('CASE_CREATED','TRANSITION','ASSIGNMENT','TRIAL_VERIFICATION','AMENDMENT')),
  from_status text,
  to_status text,
  actor_id uuid,
  actor_type text not null check (actor_type in ('USER','SYSTEM','AI')),
  policy_version text not null,
  reason text,
  structured_reasons jsonb not null default '[]',
  correlation_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists ethics_events_case_idx on public.ethics_events(case_id, id);
drop trigger if exists ethics_events_append_only on public.ethics_events;
create trigger ethics_events_append_only before update or delete on public.ethics_events for each row execute function public.append_only_guard();

create table if not exists public.trial_registrations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null unique references public.papers(id) on delete restrict,
  case_id uuid not null references public.ethics_cases(id),
  registration_required boolean not null,
  registration_status text not null default 'NOT_APPLICABLE' check (registration_status in ('NOT_APPLICABLE','NOT_REGISTERED','REGISTERED_PROSPECTIVELY','REGISTERED_RETROSPECTIVELY')),
  registry_name text,
  registration_number text,
  registration_url text check (registration_url is null or registration_url ~ '^https://'),
  registration_date date,
  -- Never 'VERIFIED' by software: no registry lookup is wired, so the only positive value is a human check.
  verification_status text not null default 'NOT_REQUIRED' check (verification_status in ('NOT_REQUIRED','PENDING_MANUAL_VERIFICATION','VERIFIED_MANUAL','VERIFICATION_FAILED')),
  verified_at timestamptz,
  verified_by uuid,
  updated_at timestamptz not null default now(),
  check (verification_status <> 'VERIFIED_MANUAL' or (verified_at is not null and verified_by is not null))
);
create or replace function public.trial_registrations_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Trial registration records cannot be deleted'; end if;
  if coalesce(current_setting('paperly.via_ethics', true), '') <> '1' then raise exception 'Trial registration changes only through the audited ethics workflow'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trial_registrations_guard_trg on public.trial_registrations;
create trigger trial_registrations_guard_trg before update or delete on public.trial_registrations for each row execute function public.trial_registrations_guard();

-- Patient / subject privacy and consent. Append-only revisions. Publication consent is a different fact from ethics approval.
create table if not exists public.ethics_subject_declarations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  revision int not null default 1,
  human_participants boolean not null,
  identifiable_info_present boolean not null,
  deidentification_status text not null check (deidentification_status in ('NOT_APPLICABLE','NOT_DEIDENTIFIED','PARTIALLY_DEIDENTIFIED','FULLY_DEIDENTIFIED')),
  informed_consent_status text not null check (informed_consent_status in ('NOT_APPLICABLE','OBTAINED','NOT_OBTAINED')),
  publication_consent_status text not null check (publication_consent_status in ('NOT_APPLICABLE','OBTAINED','WAIVED_DOCUMENTED','NOT_OBTAINED')),
  waiver_status text not null check (waiver_status in ('NOT_APPLICABLE','WAIVER_GRANTED','WAIVER_NOT_GRANTED')),
  committee_approval_status text not null check (committee_approval_status in ('NOT_APPLICABLE','APPROVED','EXEMPT_DOCUMENTED','PENDING','NOT_OBTAINED')),
  approval_reference text,
  privacy_sensitive_media boolean not null default false,
  declared_by uuid not null,
  created_at timestamptz not null default now(),
  unique (paper_id, revision)
);
drop trigger if exists ethics_subject_declarations_immutable on public.ethics_subject_declarations;
create trigger ethics_subject_declarations_immutable before update or delete on public.ethics_subject_declarations for each row execute function public.declaration_immutable();

-- Ethics transition table (deterministic). Who may take each edge is enforced in ethics_transition().
create or replace function public.ethics_transition_allowed(_from text, _to text) returns boolean language sql immutable as $$
  select (_from, _to) in (
    ('ETHICS_DECLARED','ETHICS_REVIEW_REQUIRED'), ('ETHICS_DECLARED','ETHICS_NOT_REQUIRED'), ('ETHICS_DECLARED','ETHICS_HUMAN_REVIEW_REQUIRED'),
    ('ETHICS_NOT_REQUIRED','ETHICS_REVIEW_REQUIRED'), ('ETHICS_NOT_REQUIRED','ETHICS_HUMAN_REVIEW_REQUIRED'),
    ('ETHICS_REVIEW_REQUIRED','ETHICS_UNDER_REVIEW'), ('ETHICS_REVIEW_REQUIRED','ETHICS_HUMAN_REVIEW_REQUIRED'),
    ('ETHICS_HUMAN_REVIEW_REQUIRED','ETHICS_UNDER_REVIEW'),
    ('ETHICS_UNDER_REVIEW','ETHICS_REVISION_REQUIRED'), ('ETHICS_UNDER_REVIEW','ETHICS_CLEARED'), ('ETHICS_UNDER_REVIEW','ETHICS_NOT_CLEARED'), ('ETHICS_UNDER_REVIEW','ETHICS_HUMAN_REVIEW_REQUIRED'),
    ('ETHICS_UNDER_REVIEW','ETHICS_REVIEW_REQUIRED'),
    ('ETHICS_REVISION_REQUIRED','ETHICS_REVIEW_REQUIRED'), ('ETHICS_CLEARED','ETHICS_REVIEW_REQUIRED'), ('ETHICS_NOT_CLEARED','ETHICS_REVIEW_REQUIRED')
  )
$$;

create or replace function public.ethics_actor_is_party(_paper uuid, _uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.papers where id = _paper and owner_id = _uid)
      or exists (select 1 from public.paper_authors where paper_id = _paper and user_id = _uid)
$$;

create or replace function public.ethics_transition(_case uuid, _to text, _actor uuid, _actor_type text, _reason text, _structured jsonb default '[]', _correlation uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare c public.ethics_cases; tr public.trial_registrations; sd public.ethics_subject_declarations; _decision boolean; _assigned uuid;
begin
  select * into c from public.ethics_cases where id = _case for update;
  if not found then raise exception 'Ethics case not found'; end if;
  if not public.ethics_transition_allowed(c.status, _to) then raise exception 'Illegal ethics transition % -> %', c.status, _to; end if;
  if _actor_type not in ('USER','SYSTEM','AI') then raise exception 'Unknown actor type'; end if;
  _decision := _to in ('ETHICS_CLEARED','ETHICS_NOT_CLEARED','ETHICS_REVISION_REQUIRED');

  if _actor_type = 'AI' then
    -- AI is advisory only: it may route a case to a human, never decide, clear, reject or start a review.
    if _to <> 'ETHICS_HUMAN_REVIEW_REQUIRED' then raise exception 'AI cannot take ethics decisions; it may only escalate to human review'; end if;
  elsif _actor_type = 'SYSTEM' then
    if not ((c.status = 'ETHICS_DECLARED' and _to in ('ETHICS_REVIEW_REQUIRED','ETHICS_NOT_REQUIRED','ETHICS_HUMAN_REVIEW_REQUIRED'))
         or (c.status in ('ETHICS_REVISION_REQUIRED','ETHICS_CLEARED','ETHICS_NOT_CLEARED','ETHICS_UNDER_REVIEW','ETHICS_NOT_REQUIRED') and _to = 'ETHICS_REVIEW_REQUIRED')) then
      raise exception 'System actor may not take this ethics transition';
    end if;
  else
    if _actor is null or not public.has_role(_actor, 'ethics_reviewer') then raise exception 'Forbidden: ethics_reviewer role required'; end if;
    if public.ethics_actor_is_party(c.paper_id, _actor) then raise exception 'Conflict: an author or submitter cannot act on their own ethics case'; end if;
    if c.status in ('ETHICS_REVISION_REQUIRED','ETHICS_CLEARED','ETHICS_NOT_CLEARED') then raise exception 'Only the system re-opens a decided case (on amendment)'; end if;
    if _to = 'ETHICS_REVIEW_REQUIRED' then raise exception 'Reviewers cannot send a case back to the queue'; end if;
    if _to = 'ETHICS_UNDER_REVIEW' then
      if c.assigned_reviewer_id is not null and c.assigned_reviewer_id <> _actor then raise exception 'This case is assigned to another ethics reviewer'; end if;
      _assigned := _actor;
    elsif c.status = 'ETHICS_UNDER_REVIEW' and c.assigned_reviewer_id is distinct from _actor then
      raise exception 'Only the assigned ethics reviewer may act on a case under review';
    end if;
    if _decision and (_reason is null or length(trim(_reason)) < 10) then raise exception 'A decision needs a written reason of at least 10 characters'; end if;
    if _decision and (jsonb_typeof(_structured) <> 'array' or jsonb_array_length(_structured) = 0) then raise exception 'A decision needs at least one structured reason'; end if;
  end if;

  if _to = 'ETHICS_CLEARED' then
    select * into tr from public.trial_registrations where paper_id = c.paper_id;
    if c.requires_trial_registration and (tr.id is null or tr.verification_status <> 'VERIFIED_MANUAL') then
      raise exception 'Cannot clear: required trial registration has not been manually verified';
    end if;
    select * into sd from public.ethics_subject_declarations where paper_id = c.paper_id order by revision desc limit 1;
    if c.requires_publication_consent and (sd.id is null or sd.publication_consent_status not in ('OBTAINED','WAIVED_DOCUMENTED')) then
      raise exception 'Cannot clear: publication consent is not documented (ethics approval is not publication consent)';
    end if;
    if c.requires_committee_approval and (sd.id is null or sd.committee_approval_status not in ('APPROVED','EXEMPT_DOCUMENTED')) then
      raise exception 'Cannot clear: committee approval or documented exemption is missing';
    end if;
  end if;

  perform set_config('paperly.via_ethics', '1', true);
  update public.ethics_cases set status = _to, assigned_reviewer_id = coalesce(_assigned, assigned_reviewer_id) where id = _case;
  perform set_config('paperly.via_ethics', '0', true);
  insert into public.ethics_events(case_id, paper_id, event_type, from_status, to_status, actor_id, actor_type, policy_version, reason, structured_reasons, correlation_id)
  values (c.id, c.paper_id, 'TRANSITION', c.status, _to, _actor, _actor_type, c.policy_version, _reason, coalesce(_structured, '[]'::jsonb), _correlation);
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata)
  values (_actor, _actor_type, case _to when 'ETHICS_CLEARED' then 'ethics_cleared' when 'ETHICS_NOT_CLEARED' then 'ethics_not_cleared' when 'ETHICS_REVISION_REQUIRED' then 'ethics_revision_requested' else 'ethics_status_changed' end,
          'ethics_case', c.id::text, jsonb_build_object('status', c.status), jsonb_build_object('status', _to),
          jsonb_build_object('eth_id', c.eth_id, 'paper_id', c.paper_id, 'policy_version', c.policy_version, 'correlation_id', _correlation, 'reason_present', _reason is not null));
  return _to;
end $$;

create or replace function public.ethics_assign(_case uuid, _reviewer uuid, _actor uuid, _correlation uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.ethics_cases;
begin
  if not (public.has_role(_actor, 'admin') or public.has_role(_actor, 'super_admin')) then raise exception 'Forbidden: only administrators assign ethics reviewers'; end if;
  select * into c from public.ethics_cases where id = _case for update;
  if not found then raise exception 'Ethics case not found'; end if;
  if c.status not in ('ETHICS_REVIEW_REQUIRED','ETHICS_HUMAN_REVIEW_REQUIRED','ETHICS_UNDER_REVIEW','ETHICS_NOT_REQUIRED') then raise exception 'A case in status % cannot be assigned', c.status; end if;
  if not public.has_role(_reviewer, 'ethics_reviewer') then raise exception 'The assignee does not hold the ethics_reviewer role'; end if;
  if public.ethics_actor_is_party(c.paper_id, _reviewer) then raise exception 'Conflict: assignee is the submitter or an author of this paper'; end if;
  perform set_config('paperly.via_ethics', '1', true);
  update public.ethics_cases set assigned_reviewer_id = _reviewer where id = _case;
  perform set_config('paperly.via_ethics', '0', true);
  insert into public.ethics_events(case_id, paper_id, event_type, actor_id, actor_type, policy_version, reason, structured_reasons, correlation_id)
  values (c.id, c.paper_id, 'ASSIGNMENT', _actor, 'USER', c.policy_version, 'reviewer assigned', jsonb_build_array(jsonb_build_object('assignee', _reviewer)), _correlation);
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, new_value, metadata)
  values (_actor, 'USER', 'ethics_review_assigned', 'ethics_case', c.id::text, jsonb_build_object('assigned_reviewer_id', _reviewer),
          jsonb_build_object('eth_id', c.eth_id, 'policy_version', c.policy_version, 'correlation_id', _correlation));
end $$;

-- Trial-registration verification is a human act. There is no registry lookup, so nothing is ever "verified by software".
create or replace function public.ethics_verify_trial(_paper uuid, _actor uuid, _result text, _reason text, _correlation uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.ethics_cases; tr public.trial_registrations;
begin
  if not public.has_role(_actor, 'ethics_reviewer') then raise exception 'Forbidden: ethics_reviewer role required'; end if;
  if public.ethics_actor_is_party(_paper, _actor) then raise exception 'Conflict: an author or submitter cannot verify their own trial registration'; end if;
  if _result not in ('VERIFIED_MANUAL','VERIFICATION_FAILED') then raise exception 'Invalid verification result'; end if;
  if _reason is null or length(trim(_reason)) < 10 then raise exception 'Record how the registration was checked (at least 10 characters)'; end if;
  select * into c from public.ethics_cases where paper_id = _paper;
  select * into tr from public.trial_registrations where paper_id = _paper for update;
  if c.id is null or tr.id is null or not tr.registration_required then raise exception 'No required trial registration on this paper'; end if;
  if _result = 'VERIFIED_MANUAL' and (coalesce(tr.registry_name, '') = '' or coalesce(tr.registration_number, '') = '') then raise exception 'Registry name and number are required before verification'; end if;
  perform set_config('paperly.via_ethics', '1', true);
  update public.trial_registrations set verification_status = _result, verified_at = now(), verified_by = _actor where id = tr.id;
  perform set_config('paperly.via_ethics', '0', true);
  insert into public.ethics_events(case_id, paper_id, event_type, actor_id, actor_type, policy_version, reason, structured_reasons, correlation_id)
  values (c.id, _paper, 'TRIAL_VERIFICATION', _actor, 'USER', c.policy_version, _reason, jsonb_build_array(jsonb_build_object('result', _result)), _correlation);
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata)
  values (_actor, 'USER', 'trial_registration_verification', 'ethics_case', c.id::text, jsonb_build_object('verification_status', tr.verification_status), jsonb_build_object('verification_status', _result),
          jsonb_build_object('eth_id', c.eth_id, 'policy_version', c.policy_version, 'correlation_id', _correlation));
end $$;

-- No ethics case may be bypassed on the way to publication. Papers with no case (pre-existing records) are unaffected.
create or replace function public.guard_ethics_before_publication() returns trigger language plpgsql security definer set search_path = public as $$
declare _s text;
begin
  if new.status = 'PUBLICATION_PENDING' and old.status is distinct from new.status then
    select status into _s from public.ethics_cases where paper_id = new.id;
    if _s is not null and _s not in ('ETHICS_CLEARED','ETHICS_NOT_REQUIRED') then raise exception 'Publication blocked: ethics status is %', _s; end if;
  end if;
  return new;
end $$;
drop trigger if exists papers_guard_ethics_publication on public.papers;
create trigger papers_guard_ethics_publication before update of status on public.papers for each row execute function public.guard_ethics_before_publication();

-- =====================================================================================================================
-- D) Submission saga support: idempotency, atomic commit, failure record, storage quarantine
-- =====================================================================================================================
create table if not exists public.submission_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash text not null,
  paper_id uuid not null default gen_random_uuid(),
  status text not null default 'STARTED' check (status in ('STARTED','COMMITTED','FAILED')),
  failure_stage text,
  failure_message text,
  correlation_id uuid,
  tries int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create table if not exists public.storage_quarantine (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.submission_attempts(id),
  bucket text not null,
  path text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (bucket, path)
);

create or replace function public.claim_submission_attempt(_uid uuid, _key text, _hash text, _correlation uuid)
returns table(o_attempt_id uuid, o_paper_id uuid, o_status text, o_owned boolean) language plpgsql security definer set search_path = public as $$
declare a public.submission_attempts; _fresh uuid;
begin
  insert into public.submission_attempts(user_id, idempotency_key, request_hash, correlation_id) values (_uid, _key, _hash, _correlation)
  on conflict (user_id, idempotency_key) do nothing returning id into _fresh;
  select * into a from public.submission_attempts s where s.user_id = _uid and s.idempotency_key = _key for update;
  if _fresh is not null then return query select a.id, a.paper_id, a.status, true; return; end if;
  if a.request_hash <> _hash and a.status <> 'FAILED' then raise exception 'IDEMPOTENCY_KEY_REUSED: this key was used for a different submission'; end if;
  if a.status = 'COMMITTED' then return query select a.id, a.paper_id, a.status, false; return; end if;
  if a.status = 'FAILED' or (a.status = 'STARTED' and a.updated_at < now() - interval '15 minutes') then
    update public.submission_attempts set status = 'STARTED', request_hash = _hash, tries = tries + 1, updated_at = now(), correlation_id = _correlation, failure_stage = null, failure_message = null where id = a.id;
    return query select a.id, a.paper_id, 'STARTED'::text, true; return;
  end if;
  -- a concurrent request with the same key is still running: this caller does not own the attempt
  return query select a.id, a.paper_id, a.status, false;
end $$;

create or replace function public.fail_submission_attempt(_attempt uuid, _stage text, _message text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.submission_attempts;
begin
  update public.submission_attempts set status = 'FAILED', failure_stage = left(_stage, 60), failure_message = left(_message, 300), updated_at = now()
   where id = _attempt and status = 'STARTED' returning * into a;
  if a.id is not null then
    insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, metadata)
    values (a.user_id, 'SYSTEM', 'submission_failed', 'submission_attempt', a.id::text, jsonb_build_object('stage', left(_stage, 60), 'correlation_id', a.correlation_id, 'paper_id', a.paper_id));
  end if;
end $$;

create or replace function public.quarantine_storage_object(_attempt uuid, _bucket text, _path text, _reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.storage_quarantine(attempt_id, bucket, path, reason) values (_attempt, _bucket, _path, left(_reason, 300)) on conflict (bucket, path) do nothing
$$;

create or replace function public.ensure_ethics_policy(_version text, _hash text, _rules jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare p public.ethics_policies;
begin
  insert into public.ethics_policies(version, content_hash, rules) values (_version, _hash, _rules) on conflict (version) do nothing;
  select * into p from public.ethics_policies where version = _version;
  if p.content_hash <> _hash then raise exception 'Ethics policy % already exists with different content; publish a new version', _version; end if;
end $$;

create or replace function public.sha256_text(_t text) returns text language sql immutable as $$ select encode(sha256(convert_to(coalesce(_t, ''), 'UTF8')), 'hex') $$;

-- All database state of one submission in ONE transaction (a plpgsql function body is atomic). The storage objects are
-- uploaded by the caller BEFORE this runs and removed by the caller if this raises: see submission.server.ts.
create or replace function public.commit_submission(_attempt uuid, _p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.submission_attempts; _paper uuid; _uid uuid; _ver uuid; _rights uuid; _eth uuid; _case uuid; _au record; _aid uuid; _corr uuid; _init text;
begin
  select * into a from public.submission_attempts where id = _attempt for update;
  if not found then raise exception 'Unknown submission attempt'; end if;
  if a.status = 'COMMITTED' then return jsonb_build_object('paper_id', a.paper_id, 'replayed', true); end if;
  _paper := a.paper_id; _uid := a.user_id; _corr := a.correlation_id;
  if _p#>>'{rights,declaration_version}' is null or _p#>>'{ethics,declaration_version}' is null then raise exception 'Declaration versions are required'; end if;

  insert into public.papers(id, owner_id, title, abstract, keywords, article_type, field, license, copyright_holder, language, references_text)
  values (_paper, _uid, _p#>>'{paper,title}', _p#>>'{paper,abstract}', array(select jsonb_array_elements_text(_p#>'{paper,keywords}')), _p#>>'{paper,article_type}', _p#>>'{paper,field}',
          _p#>>'{paper,license}', _p#>>'{paper,copyright_holder}', _p#>>'{paper,language}', nullif(_p#>>'{paper,references_text}', ''));

  for _au in select e.value as v, e.ordinality::int as pos from jsonb_array_elements(_p->'authors') with ordinality as e(value, ordinality) loop
    insert into public.paper_authors(paper_id, position, full_name, email, affiliation, orcid, is_corresponding, user_id)
    values (_paper, _au.pos, _au.v->>'full_name', nullif(_au.v->>'email', ''), nullif(_au.v->>'affiliation', ''), nullif(_au.v->>'orcid', ''), coalesce((_au.v->>'is_corresponding')::boolean, false), case when _au.pos = 1 then _uid else null end)
    returning id into _aid;
    insert into public.paper_author_roles(paper_id, author_id, role) select _paper, _aid, r from jsonb_array_elements_text(coalesce(_au.v->'roles', '[]'::jsonb)) r;
    if nullif(trim(coalesce(_au.v->>'affiliation', '')), '') is not null then
      insert into public.paper_author_affiliations(paper_id, author_id, position, organization) values (_paper, _aid, 1, trim(_au.v->>'affiliation'));
    end if;
  end loop;
  insert into public.paper_funding(paper_id, funder_name, grant_number) select _paper, f.funder_name, nullif(f.grant_number, '') from jsonb_to_recordset(coalesce(_p->'funders', '[]'::jsonb)) as f(funder_name text, grant_number text);
  insert into public.paper_ai_disclosures(paper_id, category, tool_name, tool_version, purpose, extent, human_verification)
    select _paper, d.category, d.tool_name, nullif(d.tool_version, ''), d.purpose, d.extent, d.human_verification
    from jsonb_to_recordset(coalesce(_p->'ai_disclosures', '[]'::jsonb)) as d(category text, tool_name text, tool_version text, purpose text, extent text, human_verification text);
  insert into public.paper_references(paper_id, position, raw_text, doi)
    select _paper, r.pos, r.raw_text, nullif(r.doi, '') from jsonb_to_recordset(coalesce(_p->'references', '[]'::jsonb)) as r(pos int, raw_text text, doi text);

  insert into public.paper_versions(paper_id, major, minor, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by, scan_result, anonymized_storage_path, anonymized_file_hash)
  values (_paper, 1, 0, _p#>>'{version,storage_path}', _p#>>'{version,file_hash}', (_p#>>'{version,file_size}')::bigint, 'application/pdf', _p#>>'{version,author_name}', _uid, _p#>'{version,scan_result}',
          nullif(_p#>>'{version,anonymized_storage_path}', ''), nullif(_p#>>'{version,anonymized_file_hash}', ''))
  returning id into _ver;
  update public.papers set current_version_id = _ver where id = _paper;

  insert into public.rights_declarations(paper_id, user_id, declaration_version, ai_disclosure_version, selected_license, is_author, coauthor_permission, has_upload_rights, previously_published, previous_doi,
                                         previous_publication_reference, manuscript_version_type, third_party_content, third_party_permission, ai_processing_consent, revision)
  values (_paper, _uid, _p#>>'{rights,declaration_version}', _p#>>'{rights,ai_disclosure_version}', _p#>>'{paper,license}', (_p#>>'{rights,is_author}')::boolean, (_p#>>'{rights,coauthor_permission}')::boolean,
          (_p#>>'{rights,has_upload_rights}')::boolean, (_p#>>'{rights,previously_published}')::boolean, nullif(_p#>>'{rights,previous_doi}', ''), nullif(_p#>>'{rights,previous_publication_reference}', ''),
          _p#>>'{rights,manuscript_version_type}', (_p#>>'{rights,third_party_content}')::boolean, (_p#>>'{rights,third_party_permission}')::boolean, (_p#>>'{rights,ai_processing_consent}')::boolean, 1)
  returning id into _rights;

  perform public.ensure_ethics_policy(_p#>>'{policy,version}', _p#>>'{policy,hash}', _p#>'{policy,rules}');
  insert into public.ethics_declarations(paper_id, user_id, declaration_version, answers, conflict_of_interest, funding, data_availability, revision, policy_version)
  values (_paper, _uid, _p#>>'{ethics,declaration_version}', _p#>'{ethics,answers}', _p#>>'{ethics,conflict_of_interest}', _p#>>'{ethics,funding}', _p#>>'{ethics,data_availability}', 1, _p#>>'{policy,version}')
  returning id into _eth;
  insert into public.ethics_subject_declarations(paper_id, revision, human_participants, identifiable_info_present, deidentification_status, informed_consent_status, publication_consent_status, waiver_status,
                                                 committee_approval_status, approval_reference, privacy_sensitive_media, declared_by)
  values (_paper, 1, (_p#>>'{subject,human_participants}')::boolean, (_p#>>'{subject,identifiable_info_present}')::boolean, _p#>>'{subject,deidentification_status}', _p#>>'{subject,informed_consent_status}',
          _p#>>'{subject,publication_consent_status}', _p#>>'{subject,waiver_status}', _p#>>'{subject,committee_approval_status}', nullif(_p#>>'{subject,approval_reference}', ''),
          (_p#>>'{subject,privacy_sensitive_media}')::boolean, _uid);

  insert into public.ethics_cases(paper_id, declaration_id, policy_version, research_category, requires_trial_registration, requires_publication_consent, requires_committee_approval)
  values (_paper, _eth, _p#>>'{policy,version}', _p#>>'{case,research_category}', (_p#>>'{case,requires_trial_registration}')::boolean, (_p#>>'{case,requires_publication_consent}')::boolean, (_p#>>'{case,requires_committee_approval}')::boolean)
  returning id into _case;
  insert into public.ethics_events(case_id, paper_id, event_type, to_status, actor_id, actor_type, policy_version, reason, correlation_id)
  values (_case, _paper, 'CASE_CREATED', 'ETHICS_DECLARED', _uid, 'USER', _p#>>'{policy,version}', 'ethics declaration submitted', _corr);
  insert into public.trial_registrations(paper_id, case_id, registration_required, registration_status, registry_name, registration_number, registration_url, registration_date, verification_status)
  values (_paper, _case, (_p#>>'{trial,registration_required}')::boolean, _p#>>'{trial,registration_status}', nullif(_p#>>'{trial,registry_name}', ''), nullif(_p#>>'{trial,registration_number}', ''),
          nullif(_p#>>'{trial,registration_url}', ''), nullif(_p#>>'{trial,registration_date}', '')::date, _p#>>'{trial,verification_status}');
  _init := _p#>>'{case,initial_status}';
  perform public.ethics_transition(_case, _init, null, 'SYSTEM', 'deterministic policy evaluation at submission', coalesce(_p#>'{case,reasons}', '[]'::jsonb), _corr);

  perform public.transition_paper(_paper, 'SUBMITTED', _uid, 'USER', 'author submitted', false, jsonb_build_object('correlation_id', _corr));
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, metadata) values
    (_uid, 'USER', 'paper_submitted', 'paper', _paper::text, jsonb_build_object('file_hash', _p#>>'{version,file_hash}', 'correlation_id', _corr, 'attempt_id', _attempt)),
    (_uid, 'USER', 'rights_declared', 'rights_declaration', _rights::text, jsonb_build_object('paper_id', _paper, 'declaration_version', _p#>>'{rights,declaration_version}', 'revision', 1, 'content_hash', public.sha256_text((_p->'rights')::text), 'correlation_id', _corr)),
    (_uid, 'USER', 'ethics_declared', 'ethics_declaration', _eth::text, jsonb_build_object('paper_id', _paper, 'declaration_version', _p#>>'{ethics,declaration_version}', 'policy_version', _p#>>'{policy,version}', 'revision', 1, 'eth_id', (select eth_id from public.ethics_cases where id = _case), 'content_hash', public.sha256_text((_p->'ethics')::text), 'correlation_id', _corr));
  update public.submission_attempts set status = 'COMMITTED', updated_at = now() where id = _attempt;
  return jsonb_build_object('paper_id', _paper, 'replayed', false, 'eth_id', (select eth_id from public.ethics_cases where id = _case));
end $$;

-- =====================================================================================================================
-- E) Controlled amendments (the only way a declaration "changes": a new revision, with reason, actor, hashes, audit)
-- =====================================================================================================================
create or replace function public.amend_rights(_paper uuid, _actor uuid, _r jsonb, _reason text, _correlation uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare p public.papers; prior public.rights_declarations; _new uuid;
begin
  select * into p from public.papers where id = _paper for update;
  if not found or p.owner_id <> _actor then raise exception 'Not found'; end if;
  if p.status in ('PUBLISHED','CORRECTED','RETRACTED','ARCHIVED','WITHDRAWN') then raise exception 'Published or closed records change only through the correction workflow'; end if;
  if _reason is null or length(trim(_reason)) < 10 then raise exception 'An amendment needs a reason of at least 10 characters'; end if;
  select * into prior from public.rights_declarations where paper_id = _paper order by revision desc limit 1 for update;
  insert into public.rights_declarations(paper_id, user_id, declaration_version, ai_disclosure_version, selected_license, is_author, coauthor_permission, has_upload_rights, previously_published, previous_doi,
                                         previous_publication_reference, manuscript_version_type, third_party_content, third_party_permission, ai_processing_consent, revision, supersedes_id, amended_by, amendment_reason)
  values (_paper, _actor, _r->>'declaration_version', _r->>'ai_disclosure_version', _r->>'selected_license', (_r->>'is_author')::boolean, (_r->>'coauthor_permission')::boolean, (_r->>'has_upload_rights')::boolean,
          (_r->>'previously_published')::boolean, nullif(_r->>'previous_doi', ''), nullif(_r->>'previous_publication_reference', ''), _r->>'manuscript_version_type', (_r->>'third_party_content')::boolean,
          (_r->>'third_party_permission')::boolean, (_r->>'ai_processing_consent')::boolean, prior.revision + 1, prior.id, _actor, trim(_reason))
  returning id into _new;
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata)
  values (_actor, 'USER', 'rights_amended', 'rights_declaration', _new::text,
          jsonb_build_object('revision', prior.revision, 'content_hash', public.sha256_text(to_jsonb(prior)::text)),
          jsonb_build_object('revision', prior.revision + 1, 'content_hash', public.sha256_text(_r::text)),
          jsonb_build_object('paper_id', _paper, 'declaration_version', _r->>'declaration_version', 'supersedes', prior.id, 'correlation_id', _correlation));
  return prior.revision + 1;
end $$;

create or replace function public.amend_ethics(_paper uuid, _actor uuid, _p jsonb, _reason text, _correlation uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare p public.papers; prior public.ethics_declarations; prior_sd public.ethics_subject_declarations; c public.ethics_cases; _new uuid; _target text;
begin
  select * into p from public.papers where id = _paper for update;
  if not found or p.owner_id <> _actor then raise exception 'Not found'; end if;
  if p.status in ('PUBLISHED','CORRECTED','RETRACTED','ARCHIVED','WITHDRAWN') then raise exception 'Published or closed records change only through the correction workflow'; end if;
  if _reason is null or length(trim(_reason)) < 10 then raise exception 'An amendment needs a reason of at least 10 characters'; end if;
  select * into prior from public.ethics_declarations where paper_id = _paper order by revision desc limit 1 for update;
  select * into prior_sd from public.ethics_subject_declarations where paper_id = _paper order by revision desc limit 1;
  select * into c from public.ethics_cases where paper_id = _paper for update;
  if c.id is null then raise exception 'This paper has no ethics case'; end if;
  perform public.ensure_ethics_policy(_p#>>'{policy,version}', _p#>>'{policy,hash}', _p#>'{policy,rules}');
  insert into public.ethics_declarations(paper_id, user_id, declaration_version, answers, conflict_of_interest, funding, data_availability, revision, supersedes_id, amended_by, amendment_reason, policy_version)
  values (_paper, _actor, _p#>>'{ethics,declaration_version}', _p#>'{ethics,answers}', _p#>>'{ethics,conflict_of_interest}', _p#>>'{ethics,funding}', _p#>>'{ethics,data_availability}',
          prior.revision + 1, prior.id, _actor, trim(_reason), _p#>>'{policy,version}') returning id into _new;
  insert into public.ethics_subject_declarations(paper_id, revision, human_participants, identifiable_info_present, deidentification_status, informed_consent_status, publication_consent_status, waiver_status,
                                                 committee_approval_status, approval_reference, privacy_sensitive_media, declared_by)
  values (_paper, coalesce(prior_sd.revision, 0) + 1, (_p#>>'{subject,human_participants}')::boolean, (_p#>>'{subject,identifiable_info_present}')::boolean, _p#>>'{subject,deidentification_status}',
          _p#>>'{subject,informed_consent_status}', _p#>>'{subject,publication_consent_status}', _p#>>'{subject,waiver_status}', _p#>>'{subject,committee_approval_status}',
          nullif(_p#>>'{subject,approval_reference}', ''), (_p#>>'{subject,privacy_sensitive_media}')::boolean, _actor);

  perform set_config('paperly.via_ethics', '1', true);
  update public.ethics_cases set declaration_id = _new, policy_version = _p#>>'{policy,version}', research_category = _p#>>'{case,research_category}',
         requires_trial_registration = (_p#>>'{case,requires_trial_registration}')::boolean, requires_publication_consent = (_p#>>'{case,requires_publication_consent}')::boolean,
         requires_committee_approval = (_p#>>'{case,requires_committee_approval}')::boolean where id = c.id;
  -- Any change to the trial registration invalidates the earlier human check: it goes back to pending.
  update public.trial_registrations set registration_required = (_p#>>'{trial,registration_required}')::boolean, registration_status = _p#>>'{trial,registration_status}',
         registry_name = nullif(_p#>>'{trial,registry_name}', ''), registration_number = nullif(_p#>>'{trial,registration_number}', ''), registration_url = nullif(_p#>>'{trial,registration_url}', ''),
         registration_date = nullif(_p#>>'{trial,registration_date}', '')::date, verification_status = _p#>>'{trial,verification_status}', verified_at = null, verified_by = null where paper_id = _paper;
  perform set_config('paperly.via_ethics', '0', true);

  _target := _p#>>'{case,initial_status}';
  if c.status in ('ETHICS_CLEARED','ETHICS_NOT_CLEARED','ETHICS_REVISION_REQUIRED','ETHICS_UNDER_REVIEW') then
    perform public.ethics_transition(c.id, 'ETHICS_REVIEW_REQUIRED', null, 'SYSTEM', 'declaration amended; earlier decision no longer covers the current declaration', '[]', _correlation);
  elsif c.status = 'ETHICS_NOT_REQUIRED' and _target <> 'ETHICS_NOT_REQUIRED' then
    perform public.ethics_transition(c.id, 'ETHICS_REVIEW_REQUIRED', null, 'SYSTEM', 'declaration amended; ethics review now applies', '[]', _correlation);
  end if;
  insert into public.ethics_events(case_id, paper_id, event_type, actor_id, actor_type, policy_version, reason, structured_reasons, correlation_id)
  values (c.id, _paper, 'AMENDMENT', _actor, 'USER', _p#>>'{policy,version}', trim(_reason), jsonb_build_array(jsonb_build_object('revision', prior.revision + 1)), _correlation);
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata)
  values (_actor, 'USER', 'ethics_amended', 'ethics_declaration', _new::text,
          jsonb_build_object('revision', prior.revision, 'content_hash', public.sha256_text(to_jsonb(prior)::text)),
          jsonb_build_object('revision', prior.revision + 1, 'content_hash', public.sha256_text((_p->'ethics')::text)),
          jsonb_build_object('paper_id', _paper, 'eth_id', c.eth_id, 'policy_version', _p#>>'{policy,version}', 'correlation_id', _correlation));
  if prior_sd.id is not null and prior_sd.publication_consent_status is distinct from (_p#>>'{subject,publication_consent_status}') then
    insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata)
    values (_actor, 'USER', 'publication_consent_changed', 'ethics_case', c.id::text, jsonb_build_object('publication_consent_status', prior_sd.publication_consent_status),
            jsonb_build_object('publication_consent_status', _p#>>'{subject,publication_consent_status}'), jsonb_build_object('eth_id', c.eth_id, 'correlation_id', _correlation));
  end if;
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, metadata)
  values (_actor, 'USER', 'clinical_trial_metadata_changed', 'ethics_case', c.id::text, jsonb_build_object('eth_id', c.eth_id, 'registration_required', _p#>>'{trial,registration_required}', 'correlation_id', _correlation));
  return prior.revision + 1;
end $$;

-- =====================================================================================================================
-- F) Privileges: new tables are reachable only through the server (service role). Browser roles get nothing directly.
-- =====================================================================================================================
do $$
declare t text;
begin
  foreach t in array array['ethics_policies','ethics_cases','ethics_events','trial_registrations','ethics_subject_declarations','submission_attempts','storage_quarantine'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.ethics_events_id_seq from anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'ethics_transition(uuid,text,uuid,text,text,jsonb,uuid)', 'ethics_assign(uuid,uuid,uuid,uuid)', 'ethics_verify_trial(uuid,uuid,text,text,uuid)',
    'claim_submission_attempt(uuid,text,text,uuid)', 'fail_submission_attempt(uuid,text,text)', 'quarantine_storage_object(uuid,text,text,text)',
    'ensure_ethics_policy(text,text,jsonb)', 'commit_submission(uuid,jsonb)', 'amend_rights(uuid,uuid,jsonb,text,uuid)', 'amend_ethics(uuid,uuid,jsonb,text,uuid)',
    'ethics_actor_is_party(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
