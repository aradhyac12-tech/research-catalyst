-- 0027 (Phase 20): claim marker so two concurrent refund attempts cannot both call the payment provider.
-- NOT APPLIED TO PRODUCTION. The application degrades gracefully if this column is missing (logs refund_claim_column_missing),
-- but apply it BEFORE relying on automatic refunds.
alter table public.payments add column if not exists refund_claimed_at timestamptz;
