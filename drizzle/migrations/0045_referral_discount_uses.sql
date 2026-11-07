-- 0045: the discount of a referral link is taken off the submission fee of the person who came through it, and each use is recorded.
-- NOT APPLIED to any database. Review, then apply manually. Additive: one new table, nothing existing is altered.
--
-- One row per payment that received a link discount: WHO got it (user_id: name and e-mail come from profiles), WHICH partner's link it came from,
-- for WHICH paper, and HOW MUCH. Administrators only: RLS is on and no client role has any grant; only the server (service_role) reads or writes it.
-- A cancelled or failed payment leaves its row behind, but the server ignores rows whose payment is not live when it decides whether a person
-- has already had their discount, so the person can still get it on a later attempt.
create table if not exists public.referral_discount_uses (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  paper_id uuid references public.papers(id) on delete set null,
  partner_id uuid not null references public.referral_partners(id) on delete restrict,
  link_id uuid references public.referral_links(id) on delete restrict,
  amount_minor integer not null check (amount_minor > 0 and amount_minor <= 100000000),
  created_at timestamptz not null default now()
);
create index if not exists referral_discount_uses_user_idx on public.referral_discount_uses (user_id);
create index if not exists referral_discount_uses_partner_idx on public.referral_discount_uses (partner_id);
create index if not exists referral_discount_uses_created_idx on public.referral_discount_uses (created_at desc);

alter table public.referral_discount_uses enable row level security;
revoke all on public.referral_discount_uses from public, anon, authenticated;
grant all on public.referral_discount_uses to service_role;
