-- Manual payment entries: money an administrator received outside the checkout (cash, bank/UPI transfer, paywall waived and paid directly)
-- that never appeared in payment history. The row is a normal PAID payment (method MANUAL, provider manual) plus who recorded it and why.
-- recorded_by is the administrator's profile (their e-mail is shown in Admin > Money). Server code only: payments stay admin-only (0047).
alter table public.payments add column if not exists recorded_by uuid references public.profiles(id) on delete set null;
alter table public.payments add column if not exists recorded_note text;
create index if not exists payments_recorded_by_idx on public.payments (recorded_by) where recorded_by is not null;
