-- An administrator's pause outranks a founder's: a founder cannot resume or replace a pause an administrator set.
alter table public.fee_waivers add column if not exists set_by_admin boolean not null default false;
