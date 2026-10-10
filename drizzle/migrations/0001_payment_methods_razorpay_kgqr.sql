create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  currency text not null,
  amount_minor integer not null check (amount_minor > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, currency)
);
grant select on public.product_prices to authenticated, anon;
grant all on public.product_prices to service_role;
alter table public.product_prices enable row level security;
create policy "read prices" on public.product_prices for select to authenticated, anon using (true);

insert into public.product_prices(product_id, currency, amount_minor)
select id, 'INR', 150000 from public.products where code = 'PUBLICATION_PROCESSING';
insert into public.product_prices(product_id, currency, amount_minor)
select id, 'KGS', 50000 from public.products where code = 'PUBLICATION_PROCESSING';

alter table public.payments add column if not exists method text not null default 'TEST';
alter table public.payments add column if not exists payer_reference text;
alter table public.payments add column if not exists provider_order_id text;
alter table public.payments add column if not exists reviewed_by uuid;
alter table public.payments add column if not exists reviewed_at timestamptz;
alter table public.payments add column if not exists review_note text;
create unique index if not exists payments_provider_order_uidx on public.payments(provider, provider_order_id) where provider_order_id is not null;
create unique index if not exists payments_ref_uidx on public.payments(method, payer_reference) where payer_reference is not null;

create table public.payment_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
grant select on public.payment_settings to authenticated, anon;
grant all on public.payment_settings to service_role;
alter table public.payment_settings enable row level security;
create policy "read payment settings" on public.payment_settings for select to authenticated, anon using (true);
insert into public.payment_settings(key, value) values
  ('KG_QR', '{"enabled": false, "image_path": null, "recipient": null, "instructions": null}'::jsonb)
on conflict do nothing;

-- Private storage buckets the app code expects (present in the live project's equivalent migration).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('manuscripts', 'manuscripts', false, 26214400, array['application/pdf']),
  ('certificates', 'certificates', false, 5242880, array['application/pdf']),
  ('payment-qr', 'payment-qr', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
