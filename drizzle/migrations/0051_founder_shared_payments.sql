-- Payments an administrator has chosen to show the founder. Founders hold no money permission (0047): they see ONLY the rows listed here,
-- and for each row the amount in shown_amount_minor if an administrator set one, otherwise the real amount.
-- The real amount, provider ids and everything else on the payment never leave the server for a founder.
-- Server code only: no client policies, like fee_waivers.
create table if not exists public.founder_shared_payments (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  shown_amount_minor integer check (shown_amount_minor is null or shown_amount_minor >= 0),
  shared_by uuid,
  shared_at timestamptz not null default now(),
  amount_set_by uuid,
  amount_set_at timestamptz
);
alter table public.founder_shared_payments enable row level security;
revoke all on public.founder_shared_payments from anon, authenticated;
grant all on public.founder_shared_payments to service_role;
