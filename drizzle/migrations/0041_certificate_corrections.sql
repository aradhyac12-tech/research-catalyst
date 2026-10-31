-- 0041: let an administrator correct a spelling mistake (article name, author name or author e-mail) and re-issue the certificates.
-- A certificate itself stays immutable (its fingerprint, name and title never change). A correction marks the old certificate
-- SUPERSEDED (its ID then verifies as "superseded") and issues a fresh one with a new ID. "Deleting" a certificate marks it REVOKED.
-- To allow a second certificate for the same person, uniqueness now applies only to certificates that are not revoked or superseded.
-- Additive and backward compatible: no data is changed.
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.certificates'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname) from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
          = array['certificate_type','paper_id','recipient_user_id','version_id']
  loop
    execute format('alter table public.certificates drop constraint %I', r.conname);
  end loop;
end $$;

create unique index if not exists certificates_user_live_uidx
  on public.certificates(paper_id, version_id, recipient_user_id, certificate_type)
  where recipient_user_id is not null and status not in ('REVOKED', 'SUPERSEDED');

drop index if exists public.certificates_author_uidx;
create unique index if not exists certificates_author_uidx
  on public.certificates(paper_id, version_id, recipient_author_id, certificate_type)
  where recipient_author_id is not null and status not in ('REVOKED', 'SUPERSEDED');
