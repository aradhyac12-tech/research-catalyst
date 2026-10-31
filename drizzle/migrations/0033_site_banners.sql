-- Site banners: admin-made announcements and offers, optionally tied to a promo code so visitors can copy it in one click.
-- Server-only like promo_codes: no grants to anon/authenticated, the public sees banners only through the server function.
create table if not exists public.site_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 90),
  message text not null default '' check (char_length(message) <= 240),
  theme text not null default 'ink' check (theme in ('ink','brand','gold','forest','plum')),
  placement text not null default 'TOP_BAR' check (placement in ('TOP_BAR','HERO')),
  promo_id uuid references public.promo_codes(id) on delete set null,
  cta_label text check (cta_label is null or char_length(cta_label) between 1 and 30),
  cta_url text check (cta_url is null or cta_url ~ '^(/($|[^/])|https://)'),
  show_countdown boolean not null default true,
  show_remaining boolean not null default true,
  dismissible boolean not null default true,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists site_banners_active_idx on public.site_banners (active, created_at desc);
create index if not exists site_banners_promo_idx on public.site_banners (promo_id);

alter table public.site_banners enable row level security;
revoke all on public.site_banners from public, anon, authenticated;
grant all on public.site_banners to service_role;
