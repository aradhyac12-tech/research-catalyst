do $$ declare bad text; begin
  -- no browser role may insert/delete anywhere
  select string_agg(c.relname||':'||r||':'||p, ', ') into bad
  from pg_class c join pg_namespace n on n.oid=c.relnamespace, unnest(array['anon','authenticated']) r, unnest(array['INSERT','DELETE']) p
  where n.nspname='public' and c.relkind='r' and has_table_privilege(r, c.oid, p);
  if bad is not null then raise exception 'FAIL browser write privileges remain: %', bad; end if;
  raise notice 'PASS  no INSERT/DELETE for anon/authenticated';
  select string_agg(c.relname||':'||r, ', ') into bad
  from pg_class c join pg_namespace n on n.oid=c.relnamespace, unnest(array['anon','authenticated']) r
  where n.nspname='public' and c.relkind='r' and has_table_privilege(r, c.oid, 'UPDATE') and c.relname not in ('profiles','notifications');
  if bad is not null then raise exception 'FAIL unexpected UPDATE: %', bad; end if;
  raise notice 'PASS  UPDATE only on profiles/notifications for authenticated';
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and has_table_privilege('anon', c.oid, 'SELECT') and c.relname not in ('products','product_prices','payment_settings');
  if bad is not null then raise exception 'FAIL anon can read: %', bad; end if;
  raise notice 'PASS  anon reads only public pricing tables';
  if has_function_privilege('anon','public.is_staff(uuid)','EXECUTE') or has_function_privilege('anon','public.has_role(uuid,public.app_role)','EXECUTE') or has_function_privilege('anon','public.can_access_paper(uuid,uuid)','EXECUTE') then raise exception 'FAIL anon can execute role helpers'; end if;
  raise notice 'PASS  anon cannot execute role helpers';
  if not has_function_privilege('authenticated','public.is_staff(uuid)','EXECUTE') then raise exception 'FAIL authenticated lost is_staff (RLS policies need it)'; end if;
  raise notice 'PASS  authenticated keeps helpers needed by RLS';
  if has_function_privilege('authenticated','public.transition_paper(uuid,public.paper_status,uuid,text,text,boolean,jsonb)','EXECUTE') then raise exception 'FAIL authenticated can call transition_paper'; end if;
  if has_function_privilege('authenticated','public.claim_bootstrap_admin(uuid)','EXECUTE') then raise exception 'FAIL authenticated can call claim_bootstrap_admin'; end if;
  raise notice 'PASS  privileged RPCs not callable by browser roles';
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then raise exception 'FAIL a public table has RLS disabled'; end if;
  raise notice 'PASS  RLS enabled on every public table';
end $$;
