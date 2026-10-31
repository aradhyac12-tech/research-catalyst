-- APPLIED TO PRODUCTION 2026-10-11 as "author_certificates" (additive and backward compatible).
-- 0030: one certificate per listed author. A co-author does not need a Paperly account: the certificate is tied to the paper_authors row and
-- e-mailed to the address given at submission. Backward compatible: existing rows and old code keep working (new columns are nullable).
alter table public.certificates alter column recipient_user_id drop not null;
alter table public.certificates add column if not exists recipient_author_id uuid references public.paper_authors(id);
alter table public.certificates add column if not exists recipient_email text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'certificates_recipient_present' and conrelid = 'public.certificates'::regclass) then
    alter table public.certificates add constraint certificates_recipient_present check (recipient_user_id is not null or recipient_author_id is not null);
  end if;
end $$;
-- One certificate of a type per author row per version (the existing unique key already covers account holders).
create unique index if not exists certificates_author_uidx on public.certificates(paper_id, version_id, recipient_author_id, certificate_type) where recipient_author_id is not null;
create index if not exists certificates_author_idx on public.certificates(recipient_author_id) where recipient_author_id is not null;
