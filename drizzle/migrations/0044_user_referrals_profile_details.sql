-- 0044: (1) every account gives a name and an age; (2) a referral link can be issued to a registered user and carries a discount amount.
-- NOT APPLIED to any database. Review, then apply manually. Additive: new columns, one trigger replacement, one function.
--
-- Profile details
--  * profiles.age: whole years, 10 to 100. profiles.details_completed: true once the person has confirmed a real name AND an age.
--  * Accounts that already have a real name (not empty, not the e-mail prefix, not "Researcher") are marked completed so only
--    people who never gave a name see the pop-up. New accounts start as not completed.
--  * Browsers cannot flip details_completed themselves (same protection as orcid_verified): only the server sets it.

alter table public.profiles add column if not exists age smallint check (age is null or (age between 10 and 100));
alter table public.profiles add column if not exists details_completed boolean not null default false;

update public.profiles
   set details_completed = true
 where details_completed = false
   and btrim(display_name) <> ''
   and lower(btrim(display_name)) <> 'researcher'
   and lower(btrim(display_name)) is distinct from lower(split_part(coalesce(email, ''), '@', 1));

create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    new.orcid_verified := old.orcid_verified;
    new.researcher_id := old.researcher_id;
    new.email := old.email;
    new.details_completed := old.details_completed;
    if new.orcid is distinct from old.orcid then new.orcid_verified := false; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Referral links for registered users
--  * A partner row may belong to a registered user (referral_partners.user_id). At most one partner row per user.
--  * A link carries a discount amount in minor units (paise). It is a pool: it is divided between the students who UPLOADED through
--    the link (see referral_partner_uploaders). Students who only signed up are not counted.
alter table public.referral_partners add column if not exists user_id uuid references public.profiles(id) on delete set null;
create unique index if not exists referral_partners_user_uidx on public.referral_partners (user_id) where user_id is not null;
alter table public.referral_links add column if not exists discount_minor integer not null default 0 check (discount_minor >= 0 and discount_minor <= 100000000);

-- Who uploaded through each partner's links: one row per (partner, student) with the number of live articles and the first upload time.
-- Deleted articles are not counted. Computed here (not by fetching rows) because API responses are capped at 1000 rows.
create or replace function public.referral_partner_uploaders()
returns table (partner_id uuid, user_id uuid, papers bigint, first_upload timestamptz)
language sql stable security definer set search_path = public as $$
  select a.partner_id, x.owner_id, count(distinct x.id), min(x.created_at)
  from public.referral_paper_attributions a
  join public.papers x on x.id = a.paper_id
  where x.deleted_at is null
  group by a.partner_id, x.owner_id;
$$;
revoke all on function public.referral_partner_uploaders() from public, anon, authenticated;
grant execute on function public.referral_partner_uploaders() to service_role;
