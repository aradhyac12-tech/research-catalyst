-- Outbox for e-mail sent through Gmail. Every e-mail is a row first, so a failed send is retried instead of lost,
-- and one notification can never produce the same e-mail twice (dedupe_key is unique).
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  user_id uuid,
  notification_id uuid,
  paper_id uuid,
  kind text not null,
  to_email text not null check (position('@' in to_email) > 1 and length(to_email) <= 254),
  cc_email text check (cc_email is null or (position('@' in cc_email) > 1 and length(cc_email) <= 254)),
  subject text not null check (length(subject) between 1 and 300),
  text_body text not null,
  html_body text not null,
  attachment_bucket text,
  attachment_path text,
  attachment_name text,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','DEAD')),
  attempts int not null default 0,
  last_error text,
  provider_message_id text,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_outbox_due on public.email_outbox (next_attempt_at) where status in ('PENDING','SENDING');
create index if not exists email_outbox_user on public.email_outbox (user_id, created_at desc);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
grant all on public.email_outbox to service_role;
-- No RLS policies on purpose: e-mail addresses and message bodies are only read and written by server code.
