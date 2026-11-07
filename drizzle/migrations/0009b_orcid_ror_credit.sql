alter table public.orcid_verifications add column if not exists last_verified_at timestamptz;
alter table public.orcid_verifications add column if not exists oauth_subject text;
update public.orcid_verifications set last_verified_at = coalesce(last_verified_at, verified_at), oauth_subject = coalesce(oauth_subject, orcid);
alter table public.orcid_verifications alter column last_verified_at set default now();
alter table public.orcid_verifications alter column last_verified_at set not null;
alter table public.orcid_verifications alter column oauth_subject set not null;
alter table public.orcid_verifications drop constraint if exists orcid_subject_matches;
alter table public.orcid_verifications add constraint orcid_subject_matches check (oauth_subject = orcid);

create or replace function public.orcid_status(_user_id uuid, _orcid text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when coalesce(_orcid, '') = '' then 'UNVERIFIED'
    when _user_id is not null and exists (select 1 from public.orcid_verifications v where v.user_id = _user_id and v.orcid = _orcid) then 'OAUTH_VERIFIED'
    when public.orcid_checksum_ok(_orcid) then 'SELF_ASSERTED'
    else 'UNVERIFIED'
  end
$$;
revoke execute on function public.orcid_status(uuid, text) from public, anon;
grant execute on function public.orcid_status(uuid, text) to authenticated, service_role;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  ror_id text not null unique check (ror_id ~ '^https://ror\.org/[0-9a-z]{9}$'),
  name text not null check (length(trim(name)) >= 2),
  country text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  org_types text[] not null default '{}',
  source text not null default 'ROR_API' check (source = 'ROR_API'),
  fetched_at timestamptz not null default now()
);
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;
grant all on public.organizations to service_role;
drop policy if exists "organizations readable" on public.organizations;
create policy "organizations readable" on public.organizations for select to authenticated using (true);

alter table public.paper_author_affiliations add column if not exists department text;
alter table public.paper_author_affiliations add column if not exists original_text text;
alter table public.paper_author_affiliations add column if not exists organization_id uuid references public.organizations(id);
alter table public.paper_author_affiliations add column if not exists ror_verified boolean not null default false;
update public.paper_author_affiliations set original_text = organization where original_text is null;
create index if not exists paper_author_affiliations_org_idx on public.paper_author_affiliations(organization_id);

create or replace function public.guard_affiliation() returns trigger language plpgsql set search_path = public as $$
declare o public.organizations%rowtype;
begin
  if tg_op = 'INSERT' and new.original_text is null then new.original_text := new.organization; end if;
  if tg_op = 'UPDATE' and new.original_text is distinct from old.original_text then raise exception 'original affiliation text is kept for audit and cannot change'; end if;
  if new.ror_verified then
    if new.organization_id is null then raise exception 'ror_verified requires a stored ROR organization'; end if;
    select * into o from public.organizations where id = new.organization_id;
    if new.ror_id is distinct from o.ror_id then raise exception 'ror_id must equal the ROR organization record'; end if;
  elsif new.organization_id is not null and new.ror_id is null then
    select ror_id into new.ror_id from public.organizations where id = new.organization_id;
  end if;
  return new;
end $$;
drop trigger if exists paper_author_affiliations_guard on public.paper_author_affiliations;
create trigger paper_author_affiliations_guard before insert or update on public.paper_author_affiliations for each row execute function public.guard_affiliation();

create or replace function public.contributors_snapshot(_paper_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', a.position, 'name', a.full_name, 'orcid', a.orcid,
           'roles', (select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb) from public.paper_author_roles r where r.author_id = a.id)) order by a.position), '[]'::jsonb)
  from public.paper_authors a where a.paper_id = _paper_id
$$;
create table if not exists public.contributor_confirmations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete restrict,
  version_id uuid references public.paper_versions(id),
  confirmed_by uuid not null,
  snapshot jsonb not null,
  statement text not null default 'I confirm these contributor roles are accurate and were assigned by the authors.',
  confirmed_at timestamptz not null default now(),
  constraint snapshot_has_authors check (jsonb_array_length(snapshot) > 0)
);
create index if not exists contributor_confirmations_paper_idx on public.contributor_confirmations(paper_id, confirmed_at desc);
create index if not exists contributor_confirmations_version_idx on public.contributor_confirmations(version_id);
drop trigger if exists contributor_confirmations_append_only on public.contributor_confirmations;
create trigger contributor_confirmations_append_only before update or delete on public.contributor_confirmations for each row execute function public.reject_modification();
alter table public.contributor_confirmations enable row level security;
revoke all on public.contributor_confirmations from anon, authenticated;
grant select on public.contributor_confirmations to authenticated;
grant all on public.contributor_confirmations to service_role;
drop policy if exists "confirmations visible to owner or paper readers" on public.contributor_confirmations;
create policy "confirmations visible to owner or paper readers" on public.contributor_confirmations for select to authenticated
  using (public.has_permission(auth.uid(), 'papers.read') or exists (select 1 from public.papers p where p.id = paper_id and p.owner_id = auth.uid()));

create or replace function public.contributors_confirmed(_paper_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contributor_confirmations c where c.paper_id = _paper_id and c.snapshot = public.contributors_snapshot(_paper_id)
                 order by c.confirmed_at desc limit 1)
$$;
revoke execute on function public.contributors_snapshot(uuid) from public, anon;
revoke execute on function public.contributors_confirmed(uuid) from public, anon;
grant execute on function public.contributors_snapshot(uuid) to authenticated, service_role;
grant execute on function public.contributors_confirmed(uuid) to authenticated, service_role;
