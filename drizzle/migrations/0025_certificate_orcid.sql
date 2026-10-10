-- The recipient's verified ORCID iD is recorded on the certificate at issue time (immutable like the other recorded details).
-- Existing certificates keep a null value and render exactly as before.
alter table public.certificates add column if not exists orcid_at_issue text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'certificates_orcid_at_issue_valid') then
    alter table public.certificates add constraint certificates_orcid_at_issue_valid check (orcid_at_issue is null or public.orcid_checksum_ok(orcid_at_issue));
  end if;
end $$;
