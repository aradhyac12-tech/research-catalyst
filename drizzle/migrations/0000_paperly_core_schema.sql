
create type public.app_role as enum ('researcher','editor','reviewer','admin','super_admin','payment_admin','ethics_reviewer','copyright_reviewer');
create type public.paper_status as enum ('DRAFT','SUBMITTED','PROCESSING','AI_SCREENING','REVIEW_REQUIRED','REVISION_REQUIRED','ACCEPTED','REJECTED','PAYMENT_PENDING','PAYMENT_COMPLETED','PUBLICATION_PENDING','PUBLISHED','CORRECTED','RETRACTED','ARCHIVED');
create type public.decision_outcome as enum ('ACCEPT','REJECT','REVIEW_REQUIRED','REVISION_REQUIRED');
create type public.payment_status as enum ('PENDING','PROCESSING','PAID','FAILED','REFUNDED','CANCELLED');
create type public.certificate_type as enum ('SUBMISSION','PUBLICATION','PEER_REVIEW','AUTHOR_RECORD');
create type public.certificate_status as enum ('VALID','REVOKED','SUPERSEDED','RETRACTED');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('editor','admin','super_admin'))
$$;
create policy "own roles or staff" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff(auth.uid()));

create sequence public.researcher_seq;
create table public.profiles (
  id uuid primary key,
  display_name text not null default '',
  email text,
  institution text,
  department text,
  country text,
  orcid text,
  orcid_verified boolean not null default false,
  bio text,
  photo_url text,
  researcher_id text not null unique default ('R-' || lpad(nextval('public.researcher_seq')::text, 6, '0')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_orcid_idx on public.profiles(orcid);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "read own profile or staff" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff(auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    new.orcid_verified := old.orcid_verified;
    new.researcher_id := old.researcher_id;
    new.email := old.email;
    if new.orcid is distinct from old.orcid then new.orcid_verified := false; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.paper_search_doc(_title text, _abstract text, _keywords text[])
returns tsvector language sql immutable as $$
  select to_tsvector('simple'::regconfig, coalesce(_title,'') || ' ' || coalesce(_abstract,'') || ' ' || coalesce(array_to_string(_keywords,' '),''))
$$;

create sequence public.paper_seq;
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('RP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.paper_seq')::text, 6, '0')),
  owner_id uuid not null,
  title text not null default '',
  abstract text not null default '',
  keywords text[] not null default '{}',
  article_type text not null default 'Original Research',
  field text not null default '',
  field_metadata jsonb not null default '{}',
  references_text text,
  status public.paper_status not null default 'DRAFT',
  current_version_id uuid,
  license text,
  doi text,
  published_at timestamptz,
  peer_reviewed boolean not null default false,
  restricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (public.paper_search_doc(title, abstract, keywords)) stored
);
create index papers_owner_idx on public.papers(owner_id);
create index papers_status_idx on public.papers(status);
create index papers_doi_idx on public.papers(doi);
create index papers_published_idx on public.papers(published_at);
create index papers_search_idx on public.papers using gin(search);
grant select on public.papers to authenticated;
grant all on public.papers to service_role;
alter table public.papers enable row level security;

create table public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  reviewer_id uuid not null,
  assigned_by uuid not null,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED','COMPLETED','DECLINED')),
  recommendation text,
  comments text,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (paper_id, reviewer_id)
);
grant select on public.review_assignments to authenticated;
grant all on public.review_assignments to service_role;
alter table public.review_assignments enable row level security;
create policy "reviewer own or staff" on public.review_assignments for select to authenticated
  using (reviewer_id = auth.uid() or public.is_staff(auth.uid()));

create or replace function public.can_access_paper(_paper_id uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.papers p where p.id = _paper_id and p.owner_id = _uid)
      or public.is_staff(_uid)
      or exists (select 1 from public.review_assignments r where r.paper_id = _paper_id and r.reviewer_id = _uid and r.status <> 'DECLINED')
$$;
create policy "paper access" on public.papers for select to authenticated
  using (public.can_access_paper(id, auth.uid()));

create table public.paper_versions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  major int not null,
  minor int not null,
  version_number text generated always as (major::text || '.' || minor::text) stored,
  previous_version_id uuid references public.paper_versions(id),
  storage_path text not null,
  file_hash text not null,
  file_size bigint not null,
  mime_type text not null,
  change_reason text,
  author_name_at_submission text not null,
  uploaded_by uuid not null,
  scan_result jsonb not null default '{}',
  extracted_chars int,
  uploaded_at timestamptz not null default now(),
  unique (paper_id, major, minor)
);
create index paper_versions_hash_idx on public.paper_versions(file_hash);
grant select on public.paper_versions to authenticated;
grant all on public.paper_versions to service_role;
alter table public.paper_versions enable row level security;
create policy "version access" on public.paper_versions for select to authenticated
  using (public.can_access_paper(paper_id, auth.uid()));
alter table public.papers add constraint papers_current_version_fk foreign key (current_version_id) references public.paper_versions(id);

create or replace function public.versions_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Manuscript versions cannot be deleted'; end if;
  if new.file_hash <> old.file_hash or new.storage_path <> old.storage_path or new.major <> old.major or new.minor <> old.minor then
    raise exception 'Manuscript version files are immutable; create a new version';
  end if;
  return new;
end $$;
create trigger paper_versions_immutable before update or delete on public.paper_versions
  for each row execute function public.versions_immutable();

create table public.paper_authors (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  position int not null,
  full_name text not null,
  email text,
  affiliation text,
  orcid text,
  is_corresponding boolean not null default false,
  user_id uuid,
  unique (paper_id, position)
);
grant select on public.paper_authors to authenticated;
grant all on public.paper_authors to service_role;
alter table public.paper_authors enable row level security;
create policy "authors access" on public.paper_authors for select to authenticated
  using (public.can_access_paper(paper_id, auth.uid()));

create table public.rights_declarations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  user_id uuid not null,
  declaration_version text not null,
  is_author boolean not null,
  coauthor_permission boolean not null,
  has_upload_rights boolean not null,
  previously_published boolean not null,
  previous_doi text,
  manuscript_version_type text not null check (manuscript_version_type in ('PREPRINT','ACCEPTED_MANUSCRIPT','PUBLISHER_VERSION','ORIGINAL_SUBMISSION')),
  third_party_content boolean not null,
  third_party_permission boolean,
  selected_license text not null check (selected_license in ('CC-BY','CC-BY-NC','CC-BY-NC-ND','ALL-RIGHTS-RESERVED')),
  ai_processing_consent boolean not null,
  ai_disclosure_version text not null,
  declared_at timestamptz not null default now()
);
grant select on public.rights_declarations to authenticated;
grant all on public.rights_declarations to service_role;
alter table public.rights_declarations enable row level security;
create policy "rights access" on public.rights_declarations for select to authenticated
  using (public.can_access_paper(paper_id, auth.uid()));

create table public.ethics_declarations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  user_id uuid not null,
  declaration_version text not null,
  answers jsonb not null,
  conflict_of_interest text not null,
  funding text not null,
  data_availability text not null,
  declared_at timestamptz not null default now()
);
grant select on public.ethics_declarations to authenticated;
grant all on public.ethics_declarations to service_role;
alter table public.ethics_declarations enable row level security;
create policy "ethics access" on public.ethics_declarations for select to authenticated
  using (public.can_access_paper(paper_id, auth.uid()));

create table public.decision_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  version text not null,
  description text,
  rules jsonb not null,
  is_active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (policy_key, version)
);
grant select on public.decision_policies to authenticated;
grant all on public.decision_policies to service_role;
alter table public.decision_policies enable row level security;
create policy "staff read policies" on public.decision_policies for select to authenticated using (public.is_staff(auth.uid()));
create or replace function public.policies_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Policies cannot be deleted'; end if;
  if new.rules <> old.rules or new.version <> old.version or new.policy_key <> old.policy_key then
    raise exception 'Policy versions are immutable; publish a new version';
  end if;
  return new;
end $$;
create trigger decision_policies_immutable before update or delete on public.decision_policies
  for each row execute function public.policies_immutable();

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  version_id uuid not null references public.paper_versions(id),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED')),
  provider text not null,
  model_name text not null,
  model_version text,
  policy_key text not null,
  policy_version text not null,
  prompt_version text not null,
  privacy_mode text not null,
  input_hash text,
  output_hash text,
  structured_result jsonb,
  deterministic_signals jsonb,
  error text,
  attempt int not null default 1,
  latency_ms int,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_runs_paper_idx on public.ai_runs(paper_id);
grant select on public.ai_runs to authenticated;
grant all on public.ai_runs to service_role;
alter table public.ai_runs enable row level security;
create policy "staff read ai runs" on public.ai_runs for select to authenticated using (public.is_staff(auth.uid()));

create table public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  ai_run_id uuid not null references public.ai_runs(id) on delete restrict,
  paper_id uuid not null references public.papers(id) on delete restrict,
  check_key text not null,
  status text not null check (status in ('PASS','WARNING','REVIEW_REQUIRED','FAIL','NOT_APPLICABLE')),
  severity text not null check (severity in ('none','minor','moderate','severe','critical')),
  message text not null,
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index ai_findings_run_idx on public.ai_findings(ai_run_id);
grant select on public.ai_findings to authenticated;
grant all on public.ai_findings to service_role;
alter table public.ai_findings enable row level security;
create policy "staff read findings" on public.ai_findings for select to authenticated using (public.is_staff(auth.uid()));

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  version_id uuid references public.paper_versions(id),
  ai_run_id uuid references public.ai_runs(id),
  source text not null check (source in ('MACHINE','HUMAN')),
  outcome public.decision_outcome not null,
  policy_key text,
  policy_version text,
  reasons jsonb not null default '[]',
  check_summary jsonb not null default '{}',
  actor_id uuid,
  is_override boolean not null default false,
  override_reason text,
  overrides_decision_id uuid references public.decisions(id),
  created_at timestamptz not null default now(),
  constraint override_needs_reason check (not is_override or (override_reason is not null and length(trim(override_reason)) >= 10)),
  constraint human_needs_actor check (source = 'MACHINE' or actor_id is not null),
  constraint machine_needs_policy check (source = 'HUMAN' or (policy_key is not null and policy_version is not null and ai_run_id is not null))
);
create index decisions_paper_idx on public.decisions(paper_id);
grant select on public.decisions to authenticated;
grant all on public.decisions to service_role;
alter table public.decisions enable row level security;
create policy "decision access" on public.decisions for select to authenticated
  using (public.can_access_paper(paper_id, auth.uid()));
create trigger decisions_append_only_placeholder before delete on public.decisions
  for each row execute function public.versions_immutable();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  amount_minor int not null check (amount_minor >= 0),
  currency text not null,
  refund_policy text not null,
  required_for_publication boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.products to authenticated;
grant all on public.products to service_role;
alter table public.products enable row level security;
create policy "read products" on public.products for select to authenticated using (true);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  user_id uuid not null,
  paper_id uuid references public.papers(id) on delete restrict,
  product_id uuid not null references public.products(id),
  amount_minor int not null,
  currency text not null,
  provider text not null,
  provider_transaction_id text,
  status public.payment_status not null default 'PENDING',
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  refunded_at timestamptz
);
create index payments_user_idx on public.payments(user_id);
create index payments_paper_idx on public.payments(paper_id);
grant select on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;
create policy "own payments or staff" on public.payments for select to authenticated
  using (user_id = auth.uid() or public.is_staff(auth.uid()) or public.has_role(auth.uid(),'payment_admin'));

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  processed boolean not null default false,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
grant select on public.payment_events to authenticated;
grant all on public.payment_events to service_role;
alter table public.payment_events enable row level security;
create policy "staff read payment events" on public.payment_events for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin') or public.has_role(auth.uid(),'payment_admin'));

create table public.doi_records (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null unique references public.papers(id) on delete restrict,
  doi text unique,
  provider text not null,
  status text not null check (status in ('NOT_CONFIGURED','PENDING','SUBMITTED','REGISTERED','VERIFIED','FAILED')),
  metadata_version int not null default 1,
  metadata jsonb,
  registered_at timestamptz,
  verified_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
grant select on public.doi_records to authenticated;
grant all on public.doi_records to service_role;
alter table public.doi_records enable row level security;
create policy "doi access" on public.doi_records for select to authenticated using (public.can_access_paper(paper_id, auth.uid()));

create sequence public.certificate_seq;
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_id text not null unique default ('CERT-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.certificate_seq')::text, 6, '0')),
  paper_id uuid not null references public.papers(id) on delete restrict,
  version_id uuid not null references public.paper_versions(id),
  recipient_user_id uuid not null,
  recipient_name_at_issue text not null,
  certificate_type public.certificate_type not null,
  author_role text not null,
  paper_title_at_issue text not null,
  article_public_id text not null,
  doi_at_issue text,
  publication_date timestamptz,
  document_hash text,
  storage_path text,
  verification_token text not null default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  status public.certificate_status not null default 'VALID',
  status_reason text,
  issued_at timestamptz not null default now(),
  unique (paper_id, version_id, recipient_user_id, certificate_type)
);
create index certificates_recipient_idx on public.certificates(recipient_user_id);
grant select on public.certificates to authenticated;
grant all on public.certificates to service_role;
alter table public.certificates enable row level security;
create policy "own certs or staff" on public.certificates for select to authenticated
  using (recipient_user_id = auth.uid() or public.is_staff(auth.uid()));

create or replace function public.certificates_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Certificates cannot be deleted; revoke instead'; end if;
  if new.certificate_id <> old.certificate_id or new.recipient_name_at_issue <> old.recipient_name_at_issue
     or new.certificate_type <> old.certificate_type or new.paper_title_at_issue <> old.paper_title_at_issue
     or new.paper_id <> old.paper_id or new.issued_at <> old.issued_at or new.verification_token <> old.verification_token
     or new.doi_at_issue is distinct from old.doi_at_issue or new.version_id <> old.version_id then
    raise exception 'Certificate content is immutable after issuance';
  end if;
  if old.document_hash is not null and new.document_hash is distinct from old.document_hash then
    raise exception 'Certificate document hash is immutable';
  end if;
  if old.status = 'REVOKED' and new.status <> old.status then
    raise exception 'Revoked certificates cannot be reinstated';
  end if;
  return new;
end $$;
create trigger certificates_immutable_trg before update or delete on public.certificates
  for each row execute function public.certificates_immutable();

create table public.certificate_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.certificates(id),
  event text not null,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
grant select on public.certificate_events to authenticated;
grant all on public.certificate_events to service_role;
alter table public.certificate_events enable row level security;
create policy "staff read cert events" on public.certificate_events for select to authenticated using (public.is_staff(auth.uid()));

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  actor_type text not null default 'USER' check (actor_type in ('USER','SYSTEM','AI','PROVIDER')),
  action text not null,
  resource_type text not null,
  resource_id text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_resource_idx on public.audit_logs(resource_type, resource_id);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "admins read audit" on public.audit_logs for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin'));
create or replace function public.audit_append_only()
returns trigger language plpgsql as $$
begin raise exception 'This record is append-only'; end $$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.audit_append_only();
create trigger decisions_append_only before update on public.decisions
  for each row execute function public.audit_append_only();
create trigger ai_findings_append_only before update or delete on public.ai_findings
  for each row execute function public.audit_append_only();

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  kind text not null check (kind in ('CORRECTION','EXPRESSION_OF_CONCERN','RETRACTION')),
  notice text not null,
  reason text not null,
  new_version_id uuid references public.paper_versions(id),
  issued_by uuid not null,
  issued_at timestamptz not null default now()
);
grant select on public.corrections to authenticated;
grant all on public.corrections to service_role;
alter table public.corrections enable row level security;
create policy "corrections access" on public.corrections for select to authenticated using (public.can_access_paper(paper_id, auth.uid()));
create trigger corrections_append_only before update or delete on public.corrections
  for each row execute function public.audit_append_only();

create table public.copyright_complaints (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  complainant_name text not null,
  complainant_email text not null,
  relationship text not null,
  description text not null,
  evidence_url text,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED','EVIDENCE_REVIEW','AUTHOR_NOTIFIED','RESTRICTED','UPHELD_REMOVED','DISMISSED_RESTORED','APPEALED','CLOSED')),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.copyright_complaints to authenticated;
grant all on public.copyright_complaints to service_role;
alter table public.copyright_complaints enable row level security;
create policy "staff read complaints" on public.copyright_complaints for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(),'copyright_reviewer'));

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  title text not null,
  body text not null,
  link text,
  email_status text not null default 'NOT_CONFIGURED',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.paper_transition_allowed(_from public.paper_status, _to public.paper_status, _override boolean)
returns boolean language sql immutable as $$
  select case
    when _to = 'PUBLISHED' and _from <> 'PUBLICATION_PENDING' then false
    when (_from::text, _to::text) in (
      ('DRAFT','SUBMITTED'),
      ('SUBMITTED','PROCESSING'),('SUBMITTED','REJECTED'),
      ('PROCESSING','AI_SCREENING'),('PROCESSING','REJECTED'),('PROCESSING','REVIEW_REQUIRED'),
      ('AI_SCREENING','ACCEPTED'),('AI_SCREENING','REJECTED'),('AI_SCREENING','REVIEW_REQUIRED'),('AI_SCREENING','REVISION_REQUIRED'),('AI_SCREENING','PROCESSING'),
      ('REVIEW_REQUIRED','ACCEPTED'),('REVIEW_REQUIRED','REJECTED'),('REVIEW_REQUIRED','REVISION_REQUIRED'),
      ('REVISION_REQUIRED','SUBMITTED'),
      ('ACCEPTED','PAYMENT_PENDING'),('ACCEPTED','PUBLICATION_PENDING'),
      ('PAYMENT_PENDING','PAYMENT_COMPLETED'),('PAYMENT_PENDING','ACCEPTED'),
      ('PAYMENT_COMPLETED','PUBLICATION_PENDING'),
      ('PUBLICATION_PENDING','PUBLISHED'),
      ('PUBLISHED','CORRECTED'),('PUBLISHED','RETRACTED'),('PUBLISHED','ARCHIVED'),
      ('CORRECTED','CORRECTED'),('CORRECTED','RETRACTED'),('CORRECTED','ARCHIVED'),
      ('REJECTED','ARCHIVED')
    ) then true
    when _override and (_from::text, _to::text) in (
      ('REJECTED','REVIEW_REQUIRED'),('REJECTED','ACCEPTED'),('REJECTED','REVISION_REQUIRED'),
      ('ACCEPTED','REJECTED'),('ACCEPTED','REVIEW_REQUIRED'),
      ('REVISION_REQUIRED','REJECTED'),('REVISION_REQUIRED','ACCEPTED')
    ) then true
    else false
  end
$$;

create or replace function public.guard_paper_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if coalesce(current_setting('paperly.via_transition', true),'') <> '1' then
      raise exception 'Paper status can only change through transition_paper()';
    end if;
  end if;
  if old.status in ('PUBLISHED','CORRECTED','RETRACTED') and (new.title <> old.title or new.abstract <> old.abstract or new.current_version_id is distinct from old.current_version_id) then
    if coalesce(current_setting('paperly.via_correction', true),'') <> '1' then
      raise exception 'Published records cannot be edited silently; issue a correction';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger papers_guard before update on public.papers
  for each row execute function public.guard_paper_status();
create or replace function public.no_delete_papers()
returns trigger language plpgsql as $$
begin
  if old.status <> 'DRAFT' then raise exception 'Submitted papers cannot be deleted'; end if;
  return old;
end $$;
create trigger papers_no_delete before delete on public.papers
  for each row execute function public.no_delete_papers();

create or replace function public.transition_paper(_paper_id uuid, _to public.paper_status, _actor uuid, _actor_type text, _reason text, _override boolean default false, _metadata jsonb default '{}')
returns public.paper_status language plpgsql security definer set search_path = public as $$
declare _from public.paper_status;
begin
  select status into _from from public.papers where id = _paper_id for update;
  if _from is null then raise exception 'Paper not found'; end if;
  if not public.paper_transition_allowed(_from, _to, _override) then
    raise exception 'Illegal paper transition % -> %', _from, _to;
  end if;
  if _override and (_reason is null or length(trim(_reason)) < 10) then
    raise exception 'Override requires a reason of at least 10 characters';
  end if;
  perform set_config('paperly.via_transition','1', true);
  update public.papers set status = _to,
    published_at = case when _to = 'PUBLISHED' then now() else published_at end
  where id = _paper_id;
  perform set_config('paperly.via_transition','0', true);
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, old_value, new_value, metadata)
  values (_actor, _actor_type, case when _override then 'status_override' else 'status_changed' end, 'paper', _paper_id::text,
          jsonb_build_object('status', _from), jsonb_build_object('status', _to),
          coalesce(_metadata,'{}'::jsonb) || jsonb_build_object('reason', _reason, 'override', _override));
  return _to;
end $$;
revoke all on function public.transition_paper(uuid, public.paper_status, uuid, text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.transition_paper(uuid, public.paper_status, uuid, text, text, boolean, jsonb) to service_role;

create or replace function public.apply_published_correction(_paper_id uuid, _new_version_id uuid, _title text, _abstract text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('paperly.via_correction','1', true);
  update public.papers set current_version_id = coalesce(_new_version_id, current_version_id),
    title = coalesce(_title, title), abstract = coalesce(_abstract, abstract) where id = _paper_id;
  perform set_config('paperly.via_correction','0', true);
end $$;
revoke all on function public.apply_published_correction(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_published_correction(uuid, uuid, text, text) to service_role;

insert into public.decision_policies(policy_key, version, description, is_active, rules) values
('GENERAL_RESEARCH_POLICY','1.0','Default screening policy for non-clinical research.', true,
 '{"missing_rights":"REJECT","missing_ai_consent":"REVIEW_REQUIRED","prompt_injection":"REVIEW_REQUIRED","severe_integrity":"REVIEW_REQUIRED","ethics_missing":"REVISION_REQUIRED","severe_methodology":"REVIEW_REQUIRED","severe_statistics":"REVIEW_REQUIRED","similarity_high":"REVIEW_REQUIRED","min_ai_confidence":0.6,"max_warnings_for_accept":3,"document_incomplete":"REVISION_REQUIRED","patient_privacy_risk":"REVIEW_REQUIRED","trial_registration_missing":"REVIEW_REQUIRED"}'::jsonb),
('MEDICAL_RESEARCH_POLICY','1.0','Stricter policy for clinical and human-subject research.', true,
 '{"missing_rights":"REJECT","missing_ai_consent":"REVIEW_REQUIRED","prompt_injection":"REVIEW_REQUIRED","severe_integrity":"REVIEW_REQUIRED","ethics_missing":"REVIEW_REQUIRED","severe_methodology":"REVIEW_REQUIRED","severe_statistics":"REVIEW_REQUIRED","similarity_high":"REVIEW_REQUIRED","min_ai_confidence":0.75,"max_warnings_for_accept":1,"document_incomplete":"REVISION_REQUIRED","patient_privacy_risk":"REVIEW_REQUIRED","trial_registration_missing":"REVISION_REQUIRED"}'::jsonb);

insert into public.products(code, name, description, amount_minor, currency, refund_policy, required_for_publication) values
('PUBLICATION_PROCESSING','Publication Processing','Hosting, metadata preparation and a permanent article page for an accepted work. Offered only after acceptance.', 5000, 'USD','Full refund if publication does not occur for platform reasons.', true),
('DOI_METADATA','DOI / Metadata Service','DOI registration through a registration agency, available once the platform has an active agreement.', 2000, 'USD','Full refund if a DOI cannot be registered.', false),
('FORMATTING','Professional Formatting','Layout of the manuscript to the platform template.', 3000, 'USD','Refundable before work begins.', false),
('SIMILARITY_REPORT','Similarity Report','Detailed similarity report for authors.', 1000, 'USD','Refundable if the report cannot be produced.', false),
('EDITORIAL_REVIEW','Editorial Review','Language and structure review by an editor. Does not affect acceptance.', 4000, 'USD','Refundable before work begins.', false),
('PEER_REVIEW','Peer Review','Coordination of independent peer review. Does not guarantee a positive outcome.', 6000, 'USD','Refundable before reviewers are assigned.', false);
