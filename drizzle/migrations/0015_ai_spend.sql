-- 0015: durable AI screening spend, so per-paper and per-day cost caps survive restarts and are shared across server instances.
-- Server-only: RLS on, no policies, no browser-role privileges (service_role bypasses RLS).
create table if not exists public.ai_spend (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  provider text not null,
  model text,
  cost_usd numeric(12,6) not null check (cost_usd >= 0),
  day date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now()
);
create index if not exists ai_spend_paper_idx on public.ai_spend(paper_id);
create index if not exists ai_spend_day_idx on public.ai_spend(day);
alter table public.ai_spend enable row level security;
revoke all on public.ai_spend from public, anon, authenticated;
grant all on public.ai_spend to service_role;
