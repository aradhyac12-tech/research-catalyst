revoke execute on function public.contributors_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.contributors_confirmed(uuid) from public, anon, authenticated;
revoke execute on function public.user_permissions(uuid) from public, anon, authenticated;
revoke execute on function public.orcid_status(uuid, text) from public, anon, authenticated;
grant execute on function public.contributors_snapshot(uuid) to service_role;
grant execute on function public.contributors_confirmed(uuid) to service_role;
grant execute on function public.user_permissions(uuid) to service_role;
grant execute on function public.orcid_status(uuid, text) to service_role;

create or replace function public.has_permission(_user_id uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role = ur.role
                 where ur.user_id = _user_id and rp.permission_key = _permission
                   and (auth.uid() is null or _user_id = auth.uid()))
$$;
