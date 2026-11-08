-- 0042: a published record cannot be edited silently (triggers papers_guard and paper_authors_guard_published).
-- An administrator's spelling correction goes through these two functions, which open the same "correction" window the
-- existing apply_published_correction() uses. Only the service role (the server) can run them; every call is also written to the audit log by the server.
create or replace function public.admin_correct_article_title(_paper_id uuid, _title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _title is null or length(trim(_title)) < 3 then raise exception 'Title is too short'; end if;
  perform set_config('paperly.via_correction', '1', true);
  update public.papers set title = trim(_title) where id = _paper_id;
  perform set_config('paperly.via_correction', '0', true);
end $$;
revoke all on function public.admin_correct_article_title(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_correct_article_title(uuid, text) to service_role;

create or replace function public.admin_correct_author(_author_id uuid, _full_name text, _email text, _set_email boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _full_name is null or length(trim(_full_name)) < 2 then raise exception 'Name is too short'; end if;
  perform set_config('paperly.via_correction', '1', true);
  update public.paper_authors set full_name = trim(_full_name), email = case when _set_email then nullif(trim(_email), '') else email end where id = _author_id;
  perform set_config('paperly.via_correction', '0', true);
end $$;
revoke all on function public.admin_correct_author(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_correct_author(uuid, text, text, boolean) to service_role;
