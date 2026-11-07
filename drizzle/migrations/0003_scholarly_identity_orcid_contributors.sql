-- 0003: M-2 scholarly identity, publication type, structured contributors / affiliations / funding / AI disclosure,
-- verified ORCID. Additive: no existing column is dropped or rewritten, legacy RP- identifiers stay valid.

-- ---------- 1) Immutable Paperly identifier PLY-YYYY-XXXXXX ----------
create sequence if not exists public.paperly_seq;
alter table public.papers add column if not exists paperly_id text;
do $$
declare r record;
begin
  for r in select id, created_at from public.papers where paperly_id is null order by created_at, id loop
    update public.papers
       set paperly_id = 'PLY-' || to_char(r.created_at, 'YYYY') || '-' || lpad(nextval('public.paperly_seq')::text, 6, '0')
     where id = r.id;
  end loop;
end $$;
alter table public.papers alter column paperly_id set default ('PLY-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.paperly_seq')::text, 6, '0'));
alter table public.papers alter column paperly_id set not null;
alter table public.papers add constraint papers_paperly_id_format check (paperly_id ~ '^PLY-[0-9]{4}-[0-9]{6}$');
create unique index if not exists papers_paperly_id_key on public.papers(paperly_id);

create or replace function public.guard_paperly_id() returns trigger language plpgsql as $$
begin
  if new.paperly_id is distinct from old.paperly_id then raise exception 'paperly_id is immutable'; end if;
  return new;
end $$;
drop trigger if exists papers_guard_paperly_id on public.papers;
create trigger papers_guard_paperly_id before update on public.papers for each row execute function public.guard_paperly_id();

-- ---------- 2) Publication type, language, copyright holder ----------
alter table public.papers
  add column if not exists publication_type text not null default 'REPOSITORY_RECORD'
    check (publication_type in ('REPOSITORY_RECORD','PREPRINT','JOURNAL_ARTICLE')),
  add column if not exists language text not null default 'en' check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  add column if not exists copyright_holder text;

-- ---------- 3) ORCID (verified through ORCID OAuth only) ----------
create or replace function public.orcid_checksum_ok(_orcid text) returns boolean language plpgsql immutable as $$
declare total int := 0; i int; d int; check_digit int; expected text;
begin
  if _orcid is null or _orcid !~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$' then return false; end if;
  _orcid := replace(_orcid, '-', '');
  for i in 1..15 loop
    d := substr(_orcid, i, 1)::int;
    total := (total + d) * 2;
  end loop;
  check_digit := (12 - (total % 11)) % 11;
  expected := case when check_digit = 10 then 'X' else check_digit::text end;
  return substr(_orcid, 16, 1) = expected;
end $$;

create table public.orcid_verifications (
  user_id uuid primary key,
  orcid text not null unique check (public.orcid_checksum_ok(orcid)),
  verified_at timestamptz not null default now(),
  source text not null default 'ORCID_OAUTH' check (source = 'ORCID_OAUTH'),
  name_at_verification text
);
grant select on public.orcid_verifications to authenticated;
grant all on public.orcid_verifications to service_role;
alter table public.orcid_verifications enable row level security;
create policy "own orcid verification" on public.orcid_verifications for select to authenticated using (user_id = auth.uid());

-- A profile ORCID can only be set to an ORCID this user verified through OAuth.
create or replace function public.guard_profile_orcid() returns trigger language plpgsql as $$
begin
  if coalesce(new.orcid, '') <> '' and (tg_op = 'INSERT' or new.orcid is distinct from old.orcid) then
    if not exists (select 1 from public.orcid_verifications v where v.user_id = new.id and v.orcid = new.orcid) then
      raise exception 'ORCID must be verified through ORCID sign-in';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_orcid on public.profiles;
create trigger profiles_guard_orcid before insert or update of orcid on public.profiles for each row execute function public.guard_profile_orcid();

-- Author-entered ORCIDs must at least be well formed with a valid checksum. Whether one is VERIFIED is a separate fact
-- (see orcid_verifications). NOT VALID keeps legacy rows; every new or updated row is checked.
alter table public.paper_authors add constraint paper_authors_orcid_valid
  check (orcid is null or orcid = '' or public.orcid_checksum_ok(orcid)) not valid;

-- ---------- 4) Structured contributors, affiliations, funding, AI disclosure ----------
create table public.paper_author_roles (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  author_id uuid not null references public.paper_authors(id) on delete cascade,
  role text not null check (role in ('CONCEPTUALIZATION','DATA_CURATION','FORMAL_ANALYSIS','FUNDING_ACQUISITION','INVESTIGATION','METHODOLOGY','PROJECT_ADMINISTRATION','RESOURCES','SOFTWARE','SUPERVISION','VALIDATION','VISUALIZATION','WRITING_ORIGINAL_DRAFT','WRITING_REVIEW_EDITING')),
  unique (author_id, role)
);
create index paper_author_roles_paper_idx on public.paper_author_roles(paper_id);

create table public.paper_author_affiliations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  author_id uuid not null references public.paper_authors(id) on delete cascade,
  position int not null check (position >= 1),
  organization text not null check (length(trim(organization)) >= 2),
  country text,
  ror_id text check (ror_id is null or ror_id ~ '^https://ror\.org/[0-9a-z]{9}$'),
  unique (author_id, position)
);
create index paper_author_affiliations_paper_idx on public.paper_author_affiliations(paper_id);

create table public.paper_funding (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  funder_name text not null check (length(trim(funder_name)) >= 2),
  grant_number text,
  created_at timestamptz not null default now()
);
create index paper_funding_paper_idx on public.paper_funding(paper_id);

create table public.paper_ai_disclosures (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  category text not null check (category in ('LITERATURE_SEARCH','WRITING','LANGUAGE_EDITING','DATA_ANALYSIS','CODING','IMAGE_GENERATION','FIGURE_GENERATION','OTHER')),
  tool_name text not null check (length(trim(tool_name)) >= 2),
  tool_version text,
  purpose text not null check (length(trim(purpose)) >= 3),
  extent text not null check (length(trim(extent)) >= 3),
  human_verification text not null check (length(trim(human_verification)) >= 10),
  created_at timestamptz not null default now()
);
create index paper_ai_disclosures_paper_idx on public.paper_ai_disclosures(paper_id);

-- Published records are not silently editable: children of a published/corrected/retracted paper are frozen
-- unless the change is made inside an explicit correction (paperly.via_correction = 1).
create or replace function public.guard_published_children() returns trigger language plpgsql as $$
declare _pid uuid; _status public.paper_status;
begin
  _pid := coalesce(new.paper_id, old.paper_id);
  select status into _status from public.papers where id = _pid;
  if _status in ('PUBLISHED','CORRECTED','RETRACTED') and coalesce(current_setting('paperly.via_correction', true), '') <> '1' then
    raise exception 'Published records cannot be edited silently; issue a correction';
  end if;
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['paper_authors','paper_author_roles','paper_author_affiliations','paper_funding','paper_ai_disclosures'] loop
    execute format('drop trigger if exists %I_guard_published on public.%I', t, t);
    execute format('create trigger %I_guard_published before insert or update or delete on public.%I for each row execute function public.guard_published_children()', t, t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['paper_author_roles','paper_author_affiliations','paper_funding','paper_ai_disclosures'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner or staff read" on public.%I for select to authenticated using (public.can_access_paper(paper_id, auth.uid()))', t);
  end loop;
end $$;
