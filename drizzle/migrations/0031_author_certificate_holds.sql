-- 0031: admin can put one author's certificate on hold (paused) without touching the other authors'.
-- Additive and backward compatible. The hold lives in its own table (no grants to clients) so the reason is never visible to authors.
create table if not exists public.author_certificate_holds (
  author_id uuid primary key references public.paper_authors(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  paused_by uuid not null,
  paused_at timestamptz not null default now()
);
create index if not exists author_certificate_holds_paper_idx on public.author_certificate_holds(paper_id);
alter table public.author_certificate_holds enable row level security;
revoke all on public.author_certificate_holds from anon, authenticated;
grant all on public.author_certificate_holds to service_role;

-- A certificate that was already issued is hidden (list, download, public verification) while its author is on hold.
alter table public.certificates add column if not exists on_hold boolean not null default false;
drop policy if exists "own certs or staff" on public.certificates;
create policy "own certs or staff" on public.certificates for select to authenticated
  using ((recipient_user_id = auth.uid() and not on_hold) or public.is_staff(auth.uid()));

-- One e-mail can carry every author's certificate.
alter table public.email_outbox add column if not exists attachments jsonb;
