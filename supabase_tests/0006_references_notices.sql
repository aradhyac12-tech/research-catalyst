create or replace function pg_temp.expect_fail(label text, sql text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise notice 'PASS  % (%)', label, left(sqlerrm,60); return; end; raise exception 'FAIL % succeeded', label; end $$;
do $$ declare o uuid := gen_random_uuid(); p uuid; begin
  insert into public.papers(owner_id,title) values (o,'T') returning id into p;
  insert into public.paper_references(paper_id,position,raw_text,doi) values (p,1,'Ref one text','10.1038/abc123');
  perform pg_temp.expect_fail('bad doi format', format($q$insert into public.paper_references(paper_id,position,raw_text,doi) values (%L,2,'Ref two text','notadoi')$q$,p));
  perform pg_temp.expect_fail('bad validation status', format($q$update public.paper_references set validation_status='FAKE' where paper_id=%L$q$,p));
  update public.paper_references set validation_status='DOI_NOT_FOUND' where paper_id=p;
  perform pg_temp.expect_fail('doi_records doi without confirmation', format($q$insert into public.doi_records(paper_id,provider,status,doi) values (%L,'x','PENDING','10.1/x')$q$,p));
  insert into public.doi_records(paper_id,provider,status) values (p,'none','READY');
  insert into public.corrections(paper_id,kind,notice,reason,issued_by) values (p,'ERRATUM',repeat('n',25),repeat('r',12),o);
  perform pg_temp.expect_fail('notice too short', format($q$insert into public.corrections(paper_id,kind,notice,reason,issued_by) values (%L,'ERRATUM','short','a long enough reason',%L)$q$,p,o));
  perform pg_temp.expect_fail('corrections append-only', format($q$update public.corrections set notice='x' where paper_id=%L$q$,p));
  -- published references are frozen
  perform set_config('paperly.via_transition','1',true);
  update public.papers set status='PUBLISHED' where id=p;
  perform pg_temp.expect_fail('published reference list frozen', format($q$update public.paper_references set raw_text='changed text' where paper_id=%L$q$,p));
  perform set_config('paperly.via_correction','1',true);
  update public.paper_references set raw_text='changed in correction' where paper_id=p;
  raise notice 'PASS  correction path allows edit';
end $$;
