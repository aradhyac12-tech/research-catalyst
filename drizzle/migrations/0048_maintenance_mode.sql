-- Master pause (maintenance mode). Additive; apply once. Default is OFF, so nothing changes until an administrator switches it on.
-- While on, everyone except administrators sees the maintenance page; administrators keep full access.
alter table public.editorial_settings
  add column if not exists maintenance_enabled boolean not null default false,
  add column if not exists maintenance_message text;
