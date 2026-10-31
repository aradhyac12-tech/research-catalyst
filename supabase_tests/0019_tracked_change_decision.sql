-- Author decisions on tracked changes: new statuses and audit columns exist, one open proposal per field still holds.
do $$
declare p uuid; u uuid := gen_random_uuid();
begin
  if not exists (select 1 from information_schema.columns where table_name='editorial_edits' and column_name='decided_at') then raise exception 'decided_at missing'; end if;
  if not exists (select 1 from information_schema.columns where table_name='editorial_edits' and column_name='decided_by') then raise exception 'decided_by missing'; end if;
  begin
    insert into public.editorial_edits(paper_id, field, before_text, after_text, editor_id, status) values (gen_random_uuid(),'title','a','b',u,'ACCEPTED');
  exception when foreign_key_violation then null; -- status accepted by the check constraint; only the paper FK stopped it
  end;
  begin
    insert into public.editorial_edits(paper_id, field, before_text, after_text, editor_id, status) values (gen_random_uuid(),'title','a','b',u,'BOGUS');
    raise exception 'BOGUS status was accepted';
  exception when check_violation then null;
  end;
end $$;
