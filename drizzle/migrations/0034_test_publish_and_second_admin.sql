-- "Test publish": a skip-payment variant that marks the paper, the payment and the certificates as Test,
-- and records the promo code with the discounted (actual received) amount. No real money moves.
alter table public.papers add column if not exists is_test boolean not null default false;
alter table public.payments add column if not exists is_test boolean not null default false;
alter table public.payments add column if not exists promo_code_text text;
alter table public.certificates add column if not exists is_test boolean not null default false;
create index if not exists payments_is_test_idx on public.payments (is_test) where is_test;

-- Second administrator: at most two accounts may hold admin or super_admin.
create or replace function public.enforce_max_two_admins() returns trigger language plpgsql as $$
begin
  if new.role in ('admin','super_admin') and
     (select count(distinct user_id) from public.user_roles where role in ('admin','super_admin') and user_id <> new.user_id) >= 2 then
    raise exception 'There can be at most two administrators';
  end if;
  return new;
end $$;
drop trigger if exists user_roles_max_two_admins on public.user_roles;
create trigger user_roles_max_two_admins before insert on public.user_roles
  for each row execute function public.enforce_max_two_admins();
