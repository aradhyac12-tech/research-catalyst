-- Repo/live drift fix: public.payment_deferrals (pay-later dues granted by an administrator) already exists on the live project but had no
-- migration file. This file records it; it is idempotent and changes nothing where the table already exists.
-- status: DUE | PAID | CANCELLED. A DUE row past due_at blocks a founder (see founderHoldState in core.server.ts). Server code only.
create table if not exists public.payment_deferrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  name text,
  amount_minor integer not null,
  currency text not null default 'INR',
  note text,
  status text not null default 'DUE',
  granted_by uuid,
  granted_at timestamptz not null default now(),
  due_at timestamptz not null,
  paid_at timestamptz,
  payment_id uuid,
  cancelled_by uuid,
  cancelled_at timestamptz
);
alter table public.payment_deferrals enable row level security;
revoke all on public.payment_deferrals from anon, authenticated;
grant all on public.payment_deferrals to service_role;
