-- 0027 (Phase 20): claim marker so two concurrent refund attempts cannot both call the payment provider.
-- APPLIED TO PRODUCTION 2026-10-11.
-- but apply it BEFORE relying on automatic refunds.
alter table public.payments add column if not exists refund_claimed_at timestamptz;
