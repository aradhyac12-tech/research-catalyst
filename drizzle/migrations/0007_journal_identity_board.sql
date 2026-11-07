-- 0007: M-5. Journal identity placeholders (no invented ISSN) and an admin-confirmed editorial board.
-- Both tables are server-side only (RLS on, no policies): public pages read them through server functions that filter.

create or replace function public.issn_checksum_ok(_issn text) returns boolean language plpgsql immutable as $$
declare digits text; total int := 0; i int; chk int; expected text;
begin
  if _issn is null or _issn !~ '^[0-9]{4}-[0-9]{3}[0-9X]$' then return false; end if;
  digits := replace(_issn, '-', '');
  for i in 1..7 loop total := total + substr(digits, i, 1)::int * (9 - i); end loop;
  chk := (11 - (total % 11)) % 11;
  expected := case when chk = 10 then 'X' else chk::text end;
  return substr(digits, 8, 1) = expected;
end $$;

create table public.journal_identity (
  id boolean primary key default true check (id),
  journal_title text not null default 'Paperly',
  publisher_name text,
  aims_scope text,
  publication_frequency text not null default 'Continuous publication',
  editorial_office_email text check (editorial_office_email is null or editorial_office_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  editorial_office_address text,
  issn text check (issn is null or public.issn_checksum_ok(issn)),
  eissn text check (eissn is null or public.issn_checksum_ok(eissn)),
  issn_confirmed_at timestamptz,
  issn_confirmed_by uuid,
  updated_at timestamptz not null default now(),
  -- An ISSN can only be stored together with the administrator who confirmed it was officially assigned.
  constraint issn_needs_confirmation check ((issn is null and eissn is null) or (issn_confirmed_at is not null and issn_confirmed_by is not null))
);
insert into public.journal_identity default values on conflict do nothing;
grant all on public.journal_identity to service_role;
alter table public.journal_identity enable row level security;

create table public.editorial_board_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) >= 2),
  affiliation text not null check (length(trim(affiliation)) >= 2),
  country text,
  credentials text,
  orcid text check (orcid is null or public.orcid_checksum_ok(orcid)),
  role text not null check (role in ('EDITOR_IN_CHIEF','ASSOCIATE_EDITOR','EDITORIAL_BOARD_MEMBER','ADVISORY_BOARD_MEMBER')),
  biography text,
  user_id uuid,
  display_order int not null default 100,
  confirmed boolean not null default false,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  -- A person is shown publicly only after an administrator explicitly confirmed their participation.
  constraint board_confirmation_recorded check (not confirmed or (confirmed_by is not null and confirmed_at is not null))
);
create index editorial_board_public_idx on public.editorial_board_members(confirmed, display_order);
grant all on public.editorial_board_members to service_role;
alter table public.editorial_board_members enable row level security;
