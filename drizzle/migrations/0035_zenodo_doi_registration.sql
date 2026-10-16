-- 0035: Zenodo DOI registration. Extends the existing doi_records table (one row per paper, already unique) and editorial_settings;
-- adds no new tables. No secret is ever stored: ZENODO_ACCESS_TOKEN / ZENODO_ENVIRONMENT live in server-side environment secrets only.
-- Existing doi_records.status stays the public lifecycle (a DOI is shown publicly only at VERIFIED); workflow_status is the Zenodo
-- operation state machine. Behaviour is unchanged for papers that never enter the Zenodo workflow.

alter table public.doi_records
  add column if not exists workflow_status text not null default 'not_started',
  add column if not exists zenodo_environment text,
  add column if not exists zenodo_deposit_id bigint,
  add column if not exists zenodo_record_id bigint,
  add column if not exists doi_url text,
  add column if not exists record_url text,
  add column if not exists idempotency_key uuid not null default gen_random_uuid(),
  add column if not exists file_sha256 text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists uploaded_at timestamptz,
  add column if not exists attempt_count int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;

alter table public.doi_records drop constraint if exists doi_records_workflow_status_check;
alter table public.doi_records add constraint doi_records_workflow_status_check
  check (workflow_status in ('not_started','pending','uploading','publishing','registered','failed'));
alter table public.doi_records drop constraint if exists doi_records_zenodo_env_check;
alter table public.doi_records add constraint doi_records_zenodo_env_check
  check (zenodo_environment is null or zenodo_environment in ('sandbox','production'));

-- "registered" is only possible with a confirmed DOI, its URL, the public record URL, the record id and an environment.
alter table public.doi_records drop constraint if exists doi_records_registered_complete;
alter table public.doi_records add constraint doi_records_registered_complete
  check (workflow_status <> 'registered' or (doi is not null and doi_url is not null and record_url is not null and zenodo_record_id is not null and zenodo_environment is not null));

-- One deposit per environment; the same Zenodo deposit can never be attached to two papers.
create unique index if not exists doi_records_zenodo_deposit_uniq on public.doi_records (zenodo_environment, zenodo_deposit_id) where zenodo_deposit_id is not null;
create index if not exists doi_records_workflow_idx on public.doi_records (workflow_status, next_retry_at);

-- A registered record's identity is immutable (corrections go through metadata updates / new versions, never re-creation).
create or replace function public.doi_records_zenodo_immutable() returns trigger language plpgsql as $$
begin
  if old.workflow_status = 'registered' then
    if new.doi is distinct from old.doi or new.doi_url is distinct from old.doi_url or new.record_url is distinct from old.record_url
       or new.zenodo_deposit_id is distinct from old.zenodo_deposit_id or new.zenodo_record_id is distinct from old.zenodo_record_id
       or new.zenodo_environment is distinct from old.zenodo_environment or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'A registered Zenodo record cannot be replaced or re-created';
    end if;
    if new.workflow_status <> 'registered' then raise exception 'A registered DOI cannot be moved back to another workflow state'; end if;
  end if;
  if new.zenodo_deposit_id is not null and old.zenodo_deposit_id is not null and new.zenodo_deposit_id <> old.zenodo_deposit_id then
    raise exception 'The Zenodo deposit of this paper is already recorded; reconcile it instead of creating another';
  end if;
  return new;
end $$;
drop trigger if exists doi_records_zenodo_immutable on public.doi_records;
create trigger doi_records_zenodo_immutable before update on public.doi_records for each row execute function public.doi_records_zenodo_immutable();

-- Admin configuration state (no token, ever). Production stays off until a sandbox registration has been verified.
alter table public.editorial_settings
  add column if not exists zenodo_production_enabled boolean not null default false,
  add column if not exists zenodo_sandbox_verified_at timestamptz,
  add column if not exists zenodo_last_test_at timestamptz,
  add column if not exists zenodo_last_test_env text,
  add column if not exists zenodo_last_test_ok boolean,
  add column if not exists zenodo_last_test_message text;

-- Explicit publication approval. Only an accepted record in production can be approved; approving twice is a no-op.
create or replace function public.zenodo_approve_publication(_paper_id uuid, _actor uuid, _env text) returns public.doi_records
language plpgsql security definer set search_path = public as $$
declare _rec public.doi_records; _status public.paper_status;
begin
  if _env not in ('sandbox','production') then raise exception 'ZENODO_ENVIRONMENT must be sandbox or production'; end if;
  select status into _status from public.papers where id = _paper_id and deleted_at is null for update;
  if _status is null then raise exception 'Paper not found'; end if;
  if _status <> 'PUBLICATION_PENDING' then raise exception 'Publication can only be approved for an accepted record in production'; end if;
  insert into public.doi_records(paper_id, provider, status, workflow_status, zenodo_environment, approved_by, approved_at)
    values (_paper_id, 'zenodo', 'PENDING', 'pending', _env, _actor, now())
    on conflict (paper_id) do nothing;
  update public.doi_records set approved_by = coalesce(approved_by, _actor), approved_at = coalesce(approved_at, now()),
      provider = 'zenodo', zenodo_environment = coalesce(zenodo_environment, _env),
      workflow_status = case when workflow_status = 'not_started' then 'pending' else workflow_status end, updated_at = now()
    where paper_id = _paper_id and workflow_status <> 'registered' returning * into _rec;
  if _rec.id is null then select * into _rec from public.doi_records where paper_id = _paper_id; end if;
  if _rec.zenodo_environment <> _env and _rec.zenodo_deposit_id is not null then
    raise exception 'This paper already has a deposit in the % environment; it cannot be moved to %', _rec.zenodo_environment, _env;
  end if;
  return _rec;
end $$;

-- Atomic claim: a single UPDATE decides the winner, so concurrent publish clicks, retries and sweeps never run the same workflow twice.
-- A lease that expires (crashed worker) can be taken over; the new worker reconciles with Zenodo before doing anything.
create or replace function public.zenodo_claim_registration(_paper_id uuid, _owner text, _lease_seconds int default 300, _force boolean default false) returns public.doi_records
language plpgsql security definer set search_path = public as $$
declare _rec public.doi_records;
begin
  update public.doi_records set lease_owner = _owner, lease_expires_at = now() + make_interval(secs => _lease_seconds),
      attempt_count = attempt_count + 1, updated_at = now()
    where paper_id = _paper_id and approved_at is not null and workflow_status <> 'registered'
      and (lease_expires_at is null or lease_expires_at < now())
      and (_force or next_retry_at is null or next_retry_at <= now())
    returning * into _rec;
  return _rec;  -- null row when someone else holds the lease, a retry is not due, or the paper is already registered
end $$;

revoke execute on function public.zenodo_approve_publication(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.zenodo_claim_registration(uuid, text, int, boolean) from public, anon, authenticated;
grant execute on function public.zenodo_approve_publication(uuid, uuid, text) to service_role;
grant execute on function public.zenodo_claim_registration(uuid, text, int, boolean) to service_role;
