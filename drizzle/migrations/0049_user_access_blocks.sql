-- Per-person block. An administrator can close the site for one signed-in person (optionally with a message) and open it again.
-- Additive; apply once. Read and written only by the server (service role), so no public policies are created.
create table if not exists public.user_access_blocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  message text,
  blocked_by uuid,
  blocked_at timestamptz not null default now()
);
alter table public.user_access_blocks enable row level security;
