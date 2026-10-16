-- 0036: Zenodo OAuth connection. One row (singleton) holding the access/refresh token an administrator authorised through
-- "Connect Zenodo". Tokens are stored ENCRYPTED (AES-GCM, key derived from ZENODO_CLIENT_SECRET on the server), never in plain text.
-- The table is server-only: row level security is on, no policy exists, and anon/authenticated have no privileges. Only service_role reads it.
-- ZENODO_ACCESS_TOKEN / ZENODO_ACCESS_TOKEN_<ENV> in the environment still win when present.
create table if not exists public.zenodo_oauth_connection (
  id boolean primary key default true check (id),
  environment text not null check (environment in ('sandbox','production')),
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  scope text,
  zenodo_user_id text,
  zenodo_user_name text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.zenodo_oauth_connection enable row level security;
revoke all on table public.zenodo_oauth_connection from public, anon, authenticated;
grant all on table public.zenodo_oauth_connection to service_role;
