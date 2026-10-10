-- 0008: M-5 security hardening, from the live advisor report. Defence in depth: the server uses the service role, so browser roles need far fewer privileges.
-- RLS stays on everywhere and is not weakened. Idempotent.

-- 1) Browser roles never write directly. Writes happen in server functions (service role).
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('revoke insert, delete, truncate, references, trigger on public.%I from anon, authenticated', t.relname);
    execute format('revoke update on public.%I from anon, authenticated', t.relname);
    execute format('revoke select, update on public.%I from anon', t.relname);
  end loop;
end $$;
-- Signed-in users keep exactly the two direct updates the app uses with their own token (own profile, own notifications).
grant update on public.profiles to authenticated;
grant update on public.notifications to authenticated;
-- Anonymous visitors keep read access only to pricing data that is meant to be public.
grant select on public.products, public.product_prices, public.payment_settings to anon;

-- 2) Role-lookup helpers must not be callable by anonymous visitors.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_staff(uuid) from public, anon;
revoke execute on function public.can_access_paper(uuid, uuid) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_staff(uuid) to authenticated, service_role;
grant execute on function public.can_access_paper(uuid, uuid) to authenticated, service_role;

-- 3) Pin search_path on trigger and helper functions flagged by the advisor.
do $$
declare f text;
begin
  foreach f in array array[
    'paper_search_doc()', 'versions_immutable()', 'policies_immutable()', 'certificates_immutable()', 'audit_append_only()',
    'no_delete_papers()', 'guard_paper_status()', 'guard_peer_reviewed()', 'guard_journal_acceptance()', 'review_frozen()',
    'review_no_self()', 'guard_paperly_id()', 'guard_profile_orcid()', 'guard_published_children()', 'append_only()'
  ] loop
    begin execute format('alter function public.%s set search_path = public', f);
    exception when undefined_function then null; end;
  end loop;
  begin alter function public.paper_transition_allowed(public.paper_status, public.paper_status, boolean) set search_path = public; exception when undefined_function then null; end;
  begin alter function public.orcid_checksum_ok(text) set search_path = public; exception when undefined_function then null; end;
  begin alter function public.paper_search_doc(text, text, text[]) set search_path = public; exception when undefined_function then null; end;
end $$;
