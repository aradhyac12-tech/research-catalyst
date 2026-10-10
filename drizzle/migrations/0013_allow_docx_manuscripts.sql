-- Allow Word (.docx) manuscripts alongside PDF.
update storage.buckets
   set allowed_mime_types = array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
 where id = 'manuscripts';

-- The version-commit functions record 'application/pdf'; derive the true MIME type from the stored file name instead.
create or replace function public.paper_versions_set_mime() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.storage_path ~* '\.docx$' then new.mime_type := 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  else new.mime_type := 'application/pdf'; end if;
  return new;
end $$;
drop trigger if exists trg_paper_versions_set_mime on public.paper_versions;
create trigger trg_paper_versions_set_mime before insert on public.paper_versions
  for each row execute function public.paper_versions_set_mime();
