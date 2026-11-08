-- NOTE: these objects already exist in the live project (applied outside the tracked migration history, verified identical by columns, RLS and grants on 2026-10-09). Idempotent so a fresh database and live both converge.
-- Promo codes: admin-created, fixed amount off the publication fee.
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  amount_off_minor integer not null check (amount_off_minor > 0),
  currency text not null default 'INR',
  active boolean not null default true,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists promo_codes_code_uidx on public.promo_codes (upper(code));

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.promo_codes(id),
  payment_id uuid not null unique references public.payments(id),
  user_id uuid not null,
  paper_id uuid,
  amount_off_minor integer not null,
  created_at timestamptz not null default now()
);
create index if not exists promo_redemptions_promo_idx on public.promo_redemptions(promo_id);
create index if not exists promo_redemptions_user_idx on public.promo_redemptions(promo_id, user_id);

-- Server-only: no grants to anon/authenticated, so codes cannot be listed or guessed from the browser.
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes, public.promo_redemptions from public, anon, authenticated;
grant all on public.promo_codes, public.promo_redemptions to service_role;

alter table public.payments add column if not exists promo_code_id uuid references public.promo_codes(id);
alter table public.payments add column if not exists original_amount_minor integer;
alter table public.payments add column if not exists discount_minor integer not null default 0;
