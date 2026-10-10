do $$
declare c record; cols text;
begin
  for c in
    select con.conname, con.conrelid, con.conrelid::regclass as tbl, con.conkey
    from pg_constraint con
    where con.contype = 'f' and con.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = con.conrelid
          and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(con.conkey, 1)] = con.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by array_position(c.conkey, a.attnum)) into cols
      from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey);
    execute format('create index if not exists %I on %s (%s)', left(c.conname, 55) || '_idx', c.tbl, cols);
  end loop;
end $$;

do $$
declare p record; q text; w text;
begin
  for p in
    select * from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')
      and coalesce(qual, '') !~* 'select auth\.uid' and coalesce(with_check, '') !~* 'select auth\.uid'
  loop
    q := replace(p.qual, 'auth.uid()', '(select auth.uid())');
    w := replace(p.with_check, 'auth.uid()', '(select auth.uid())');
    execute format('alter policy %I on public.%I %s %s', p.policyname, p.tablename,
                   case when q is not null then 'using (' || q || ')' else '' end,
                   case when w is not null then 'with check (' || w || ')' else '' end);
  end loop;
end $$;
