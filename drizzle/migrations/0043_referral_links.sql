-- 0043: opaque referral links for acquisition partners, with private attribution records.
-- NOT APPLIED to any database. Review, then apply manually. Strictly additive: new tables and functions only; nothing existing is altered.
--
-- Privacy model
--  * Partner identity (referral_partners.display_name / contact_email) exists ONLY in this table. A link carries an opaque random code:
--    nothing in the code or URL is derived from a name, initials, username or id.
--  * Every table here is server-only, like promo_codes and site_banners: RLS enabled, no grants to anon/authenticated.
--    Teachers/authors cannot read them even with their own token. Only the server (service_role) reads them, after an
--    application-level permission check (REFERRAL_ADMIN: admin and super_admin only).
--  * Attribution lives in separate tables and NOT as columns on papers/profiles, because author-facing queries read those rows whole.

create table if not exists public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  notes text check (notes is null or char_length(notes) <= 1000),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists referral_partners_name_uidx on public.referral_partners (lower(btrim(display_name)));

-- One partner can have several links over time (a link can be replaced); history keeps pointing at the link that was used.
create table if not exists public.referral_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.referral_partners(id) on delete restrict,
  code text not null check (code ~ '^[A-HJ-KM-NP-Z2-9]{8}$'),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists referral_links_code_uidx on public.referral_links (code);
create index if not exists referral_links_partner_idx on public.referral_links (partner_id);
-- At most one live link per partner.
create unique index if not exists referral_links_one_active_uidx on public.referral_links (partner_id) where active;

-- Who a person registered through. First touch wins; one row per person.
create table if not exists public.referral_user_attributions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.referral_partners(id) on delete restrict,
  link_id uuid not null references public.referral_links(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists referral_user_attr_partner_idx on public.referral_user_attributions (partner_id);
create index if not exists referral_user_attr_link_idx on public.referral_user_attributions (link_id);

-- Credit for a paper. Several partners may share it; shares of one paper always add up to exactly 100.
create table if not exists public.referral_paper_attributions (
  paper_id uuid not null references public.papers(id) on delete cascade,
  partner_id uuid not null references public.referral_partners(id) on delete restrict,
  link_id uuid references public.referral_links(id) on delete restrict,
  share_percent numeric(5,2) not null check (share_percent > 0 and share_percent <= 100),
  source text not null check (source in ('SUBMISSION_LINK','REGISTRATION','JOINT_AUTO','ADMIN')),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (paper_id, partner_id)
);
create index if not exists referral_paper_attr_partner_idx on public.referral_paper_attributions (partner_id);
create index if not exists referral_paper_attr_link_idx on public.referral_paper_attributions (link_id);

alter table public.referral_partners enable row level security;
alter table public.referral_links enable row level security;
alter table public.referral_user_attributions enable row level security;
alter table public.referral_paper_attributions enable row level security;
revoke all on public.referral_partners from public, anon, authenticated;
revoke all on public.referral_links from public, anon, authenticated;
revoke all on public.referral_user_attributions from public, anon, authenticated;
revoke all on public.referral_paper_attributions from public, anon, authenticated;
grant all on public.referral_partners to service_role;
grant all on public.referral_links to service_role;
grant all on public.referral_user_attributions to service_role;
grant all on public.referral_paper_attributions to service_role;

-- Atomically sets the shares of one paper. p_shares = [{"partner_id": "...", "link_id": "..."|null, "share_percent": 50}, ...].
-- p_overwrite = false keeps whatever is already there (automatic recording never overwrites an administrator's decision,
-- and a replayed submission is a no-op). Returns true when rows were written.
create or replace function public.referral_set_paper_shares(p_paper_id uuid, p_shares jsonb, p_source text, p_overwrite boolean, p_actor uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n int; total numeric; distinct_n int; known int; s jsonb;
begin
  if p_source not in ('SUBMISSION_LINK','REGISTRATION','JOINT_AUTO','ADMIN') then raise exception 'Invalid attribution source'; end if;
  if jsonb_typeof(p_shares) <> 'array' then raise exception 'Shares must be a list'; end if;
  n := jsonb_array_length(p_shares);
  if n < 1 or n > 10 then raise exception 'Between 1 and 10 partners are allowed'; end if;
  select coalesce(sum((e->>'share_percent')::numeric), 0), count(distinct e->>'partner_id') into total, distinct_n from jsonb_array_elements(p_shares) e;
  if distinct_n <> n then raise exception 'A partner can appear only once'; end if;
  if total <> 100 then raise exception 'Shares must add up to exactly 100 (got %)', total; end if;
  for s in select * from jsonb_array_elements(p_shares) loop
    if (s->>'share_percent')::numeric <= 0 then raise exception 'Every share must be above zero'; end if;
  end loop;
  select count(*) into known from public.referral_partners where id in (select (e->>'partner_id')::uuid from jsonb_array_elements(p_shares) e);
  if known <> n then raise exception 'Unknown partner'; end if;
  if not exists (select 1 from public.papers where id = p_paper_id) then raise exception 'Paper not found'; end if;

  perform pg_advisory_xact_lock(hashtext('referral_paper:' || p_paper_id::text));
  if exists (select 1 from public.referral_paper_attributions where paper_id = p_paper_id) then
    if not p_overwrite then return false; end if;
    delete from public.referral_paper_attributions where paper_id = p_paper_id;
  end if;
  insert into public.referral_paper_attributions (paper_id, partner_id, link_id, share_percent, source, created_by)
  select p_paper_id, (e->>'partner_id')::uuid, nullif(e->>'link_id','')::uuid, (e->>'share_percent')::numeric, p_source, p_actor
  from jsonb_array_elements(p_shares) e;
  return true;
end $$;
revoke all on function public.referral_set_paper_shares(uuid, jsonb, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.referral_set_paper_shares(uuid, jsonb, text, boolean, uuid) to service_role;

-- Per-partner totals for the administrator's referral screen. Computed in the database (not by counting fetched rows) because
-- API responses are capped at 1000 rows. "credited" is the fractional article credit: an article shared 50/50 counts 0.5 for each partner.
-- Deleted articles are not counted.
create or replace function public.referral_partner_stats()
returns table (partner_id uuid, registrations bigint, articles bigint, credited numeric)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*) from public.referral_user_attributions u where u.partner_id = p.id),
    (select count(*) from public.referral_paper_attributions a join public.papers x on x.id = a.paper_id where a.partner_id = p.id and x.deleted_at is null),
    (select coalesce(sum(a.share_percent), 0) / 100 from public.referral_paper_attributions a join public.papers x on x.id = a.paper_id where a.partner_id = p.id and x.deleted_at is null)
  from public.referral_partners p;
$$;
revoke all on function public.referral_partner_stats() from public, anon, authenticated;
grant execute on function public.referral_partner_stats() to service_role;
