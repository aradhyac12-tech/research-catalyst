create or replace function pg_temp.expect_fail(label text, sql text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise notice 'PASS  % (%)', label, left(sqlerrm,60); return; end; raise exception 'FAIL % succeeded', label; end $$;
do $$ declare u uuid := gen_random_uuid(); begin
  -- 0378-5955 is used only as a checksum fixture in this scratch database; it is not a Paperly ISSN
  if not public.issn_checksum_ok('0378-5955') then raise exception 'FAIL checksum fixture'; end if;
  if public.issn_checksum_ok('0378-5956') then raise exception 'FAIL checksum accepts wrong digit'; end if;
  raise notice 'PASS  issn checksum';
  perform pg_temp.expect_fail('invalid issn rejected', $q$update public.journal_identity set issn='1234-5678', issn_confirmed_at=now(), issn_confirmed_by=gen_random_uuid()$q$);
  perform pg_temp.expect_fail('issn without confirmation rejected', $q$update public.journal_identity set issn='0378-5955'$q$);
  update public.journal_identity set issn='0378-5955', issn_confirmed_at=now(), issn_confirmed_by=u;
  raise notice 'PASS  confirmed valid issn accepted';
  update public.journal_identity set issn=null, issn_confirmed_at=null, issn_confirmed_by=null;
  perform pg_temp.expect_fail('confirmed board member needs confirmer', format($q$insert into public.editorial_board_members(full_name,affiliation,role,confirmed,created_by) values ('A Person','Uni','EDITOR_IN_CHIEF',true,%L)$q$,u));
  perform pg_temp.expect_fail('bad board role', format($q$insert into public.editorial_board_members(full_name,affiliation,role,created_by) values ('A Person','Uni','BOSS',%L)$q$,u));
  perform pg_temp.expect_fail('board orcid checksum', format($q$insert into public.editorial_board_members(full_name,affiliation,role,orcid,created_by) values ('A Person','Uni','ASSOCIATE_EDITOR','0000-0002-1825-0098',%L)$q$,u));
  insert into public.editorial_board_members(full_name,affiliation,role,created_by) values ('A Person','Uni','ASSOCIATE_EDITOR',u);
  if (select confirmed from public.editorial_board_members limit 1) then raise exception 'FAIL default confirmed'; end if;
  raise notice 'PASS  board members default to unconfirmed';
  delete from public.editorial_board_members;
end $$;
