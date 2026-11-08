-- Submission fee at upload (INR 1500 price already exists on product PUBLICATION_PROCESSING; no price change here).
-- Adds the columns needed to record a partial refund when a paper is rejected (INR 300 kept, the rest returned).
alter table public.payments add column if not exists refunded_amount_minor integer not null default 0 check (refunded_amount_minor >= 0);
alter table public.payments add column if not exists retained_amount_minor integer check (retained_amount_minor is null or retained_amount_minor >= 0);
alter table public.payments add column if not exists provider_refund_id text;
alter table public.payments add column if not exists refund_error text;

update public.products
set name = 'Submission fee',
    description = 'Paid when a manuscript is uploaded. Screening starts after payment. It covers screening, editorial handling, hosting and a permanent public record if the work is published.',
    refund_policy = 'If the paper is rejected, INR 300 is kept and the rest of the amount paid is refunded to the original payment method.'
where code = 'PUBLICATION_PROCESSING';
