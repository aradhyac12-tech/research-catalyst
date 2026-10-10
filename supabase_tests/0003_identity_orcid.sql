-- Run against a scratch database after migrations 0000-0003. Each block must raise (expected) or return true.
-- 1) paperly_id format + immutability
do $$ declare pid uuid; begin
  insert into public.papers(owner_id, title) values (gen_random_uuid(), 'T') returning id into pid;
  begin update public.papers set paperly_id = 'PLY-2026-999999' where id = pid; raise exception 'FAIL: paperly_id changed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  delete from public.papers where id = pid;
end $$;
-- 2) ORCID checksum function
select public.orcid_checksum_ok('0000-0002-1825-0097') and not public.orcid_checksum_ok('0000-0002-1825-0098') as ok;
-- 3) profile ORCID cannot be set without a verification row (expect exception)
-- update public.profiles set orcid = '0000-0002-1825-0097' where id = '<any user id>';
-- 4) peer_reviewed cannot be set without a completed review (expect exception)
-- update public.papers set peer_reviewed = true where id = '<any paper id>';
-- 5) published child rows are frozen (expect exception)
-- insert into public.paper_funding(paper_id, funder_name) values ('<published paper id>', 'X');
