-- A founder with dues pending: an administrator places a hold and the founder's data (overview, users, shared payments) and founder actions
-- are blocked on the server until it is lifted. Administrators are never affected. Server code only: no client policies.
create table if not exists public.founder_dues_holds (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  note text,
  set_by uuid,
  set_at timestamptz not null default now()
);
alter table public.founder_dues_holds enable row level security;
revoke all on public.founder_dues_holds from anon, authenticated;
grant all on public.founder_dues_holds to service_role;
