-- Founder-controlled paywall pause. One row per person; an active row (revoked_at is null) means the submission fee is not charged
-- for that person's papers. Server code only: no client policies, like email_outbox.
create table if not exists public.fee_waivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  email text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);
alter table public.fee_waivers enable row level security;
revoke all on public.fee_waivers from anon, authenticated;
grant all on public.fee_waivers to service_role;
