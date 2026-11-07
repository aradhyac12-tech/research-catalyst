-- APPLIED TO PRODUCTION 2026-10-11 as "admin_purge_paper". Tested on a real paper inside a rolled-back transaction: all dependent rows removed, audit row written, no trigger left disabled.
-- 0029: permanent erase of a paper and every row that depends on it. Administrators only (service_role RPC), and only for a paper that was
-- first deleted (deleted_at set, migration 0028). It walks the foreign-key graph from the paper, so rows added by later migrations are
-- included without editing this function. Supabase does not let the postgres role switch session_replication_role, so instead the user
-- triggers (immutability / append-only / no-delete) are disabled on the affected tables inside this one transaction and re-enabled before
-- it ends; FK constraints stay enforced, rows are deleted leaf-first, and nullable FK cycles are cut by nulling the column.
-- Any failure rolls the whole transaction back, including the trigger changes. The audit log is kept and receives a snapshot of what was erased.
create or replace function public.admin_purge_paper(_paper uuid, _actor uuid, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _p public.papers%rowtype;
  fk record; r record; t record;
  _counts jsonb := '{}'::jsonb; _n bigint; _newrid tid; _progress boolean; _left bigint;
  _ms text[]; _cs text[]; _pay jsonb; _certs jsonb; _tbls regclass[];
begin
  if _reason is null or length(btrim(_reason)) < 10 then raise exception 'A reason of at least 10 characters is required'; end if;
  select * into _p from public.papers where id = _paper for update;
  if not found then raise exception 'Paper not found'; end if;
  if _p.deleted_at is null then raise exception 'Delete the paper first; only a deleted paper can be erased permanently'; end if;

  select coalesce(array_agg(x) filter (where x is not null), '{}') into _ms from (
    select storage_path x from public.paper_versions where paper_id = _paper
    union select anonymized_storage_path from public.paper_versions where paper_id = _paper) s;
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into _cs from public.certificates where paper_id = _paper;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into _pay from public.payments p where p.paper_id = _paper;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into _certs from public.certificates c where c.paper_id = _paper;

  create temp table _purge (tbl regclass not null, rid tid not null, primary key (tbl, rid)) on commit drop;
  create temp table _new (tbl regclass not null, rid tid not null, primary key (tbl, rid)) on commit drop;
  create temp table _next (tbl regclass not null, rid tid not null, primary key (tbl, rid)) on commit drop;
  insert into _purge select 'public.papers'::regclass, ctid from public.papers where id = _paper;
  insert into _new select * from _purge;

  -- 1. collect every dependent row by following foreign keys
  loop
    exit when not exists (select 1 from _new);
    for fk in
      select c.conrelid::regclass as child, a.attname as child_col, c.confrelid::regclass as parent, pa.attname as parent_col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
      join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.confrelid in (select distinct tbl from _new)
    loop
      execute format(
        'insert into _next select %L::regclass, ch.ctid from %s ch where ch.%I in (select p.%I from %s p where p.ctid in (select rid from _new where tbl = %L::regclass)) and not exists (select 1 from _purge x where x.tbl = %L::regclass and x.rid = ch.ctid) on conflict do nothing',
        fk.child, fk.child, fk.child_col, fk.parent_col, fk.parent, fk.parent, fk.child);
    end loop;
    insert into _purge select * from _next on conflict do nothing;
    truncate _new; insert into _new select * from _next; truncate _next;
  end loop;

  -- 2. lift the protective triggers on exactly the affected tables (this transaction only)
  select array_agg(distinct tbl) into _tbls from _purge;
  for t in select unnest(_tbls) as tbl loop
    execute format('alter table %s disable trigger user', t.tbl);
  end loop;

  -- 3. delete leaf-first; when nothing more can go, cut nullable FK cycles and try again
  loop
    select count(*) into _left from _purge;
    exit when _left = 0;
    _progress := false;
    for r in select tbl, rid from _purge loop
      begin
        execute format('delete from %s where ctid = %L::tid', r.tbl, r.rid);
        get diagnostics _n = row_count;
      exception when foreign_key_violation then
        continue;
      end;
      delete from _purge where tbl = r.tbl and rid = r.rid;
      if _n > 0 then _counts := jsonb_set(_counts, array[r.tbl::text], to_jsonb(coalesce((_counts ->> r.tbl::text)::int, 0) + 1)); end if;
      _progress := true;
    end loop;
    if not _progress then
      for fk in
        select c.conrelid::regclass as child, a.attname as child_col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and array_length(c.conkey, 1) = 1 and not a.attnotnull
          and c.conrelid in (select distinct tbl from _purge) and c.confrelid in (select distinct tbl from _purge)
      loop
        for r in select rid from _purge where tbl = fk.child loop
          _newrid := null;
          execute format('update %s set %I = null where ctid = %L::tid and %I is not null returning ctid', fk.child, fk.child_col, r.rid, fk.child_col) into _newrid;
          if _newrid is not null then
            update _purge set rid = _newrid where tbl = fk.child and rid = r.rid;
            _progress := true;
          end if;
        end loop;
      end loop;
      if not _progress then raise exception 'Could not erase the paper: % rows are still referenced by rows outside this paper', _left; end if;
    end if;
  end loop;

  -- 4. put the triggers back
  for t in select unnest(_tbls) as tbl loop
    execute format('alter table %s enable trigger user', t.tbl);
  end loop;

  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, metadata)
  values (_actor, 'USER', 'article_erased', 'paper', _paper, jsonb_build_object(
    'public_id', _p.public_id, 'paperly_id', _p.paperly_id, 'title', _p.title, 'status', _p.status, 'owner_id', _p.owner_id,
    'reason', left(btrim(_reason), 500), 'rows_deleted', _counts, 'payments', _pay, 'certificates', _certs));

  return jsonb_build_object('rows', _counts, 'manuscript_paths', to_jsonb(_ms), 'certificate_paths', to_jsonb(_cs));
end $$;

revoke all on function public.admin_purge_paper(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_purge_paper(uuid, uuid, text) to service_role;
