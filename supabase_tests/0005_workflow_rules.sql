-- Run on scratch DB after migrations 0000-0005. Raises on first failed expectation; prints PASS notices.
create or replace function pg_temp.expect_fail(label text, sql text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'PASS  % (%)', label, left(sqlerrm,70); return; end;
  raise exception 'FAIL  % : statement succeeded', label;
end $$;
create or replace function pg_temp.expect_ok(label text, sql text) returns void language plpgsql as $$
begin execute sql; raise notice 'PASS  %', label; exception when others then raise exception 'FAIL  % : %', label, sqlerrm; end $$;

do $$ declare o uuid := gen_random_uuid(); ed uuid := gen_random_uuid(); rv uuid := gen_random_uuid(); p uuid; p2 uuid; ra uuid; begin
  insert into public.papers(owner_id,title) values (o,'T') returning id into p;
  -- machine decisions
  perform pg_temp.expect_fail('machine cannot ACCEPT', format($q$insert into public.decisions(paper_id,source,outcome,policy_key,policy_version,ai_run_id) values (%L,'MACHINE','ACCEPT','k','1',gen_random_uuid())$q$,p));
  perform pg_temp.expect_fail('machine cannot REJECT', format($q$insert into public.decisions(paper_id,source,outcome,policy_key,policy_version,ai_run_id) values (%L,'MACHINE','REJECT','k','1',gen_random_uuid())$q$,p));
  perform pg_temp.expect_fail('human decision needs actor', format($q$insert into public.decisions(paper_id,source,outcome) values (%L,'HUMAN','ACCEPT')$q$,p));
  -- paperly_id
  perform pg_temp.expect_fail('paperly_id immutable', format($q$update public.papers set paperly_id='PLY-2026-999999' where id=%L$q$,p));
  perform pg_temp.expect_fail('paperly_id bad format', format($q$insert into public.papers(owner_id,title,paperly_id) values (%L,'x','BAD')$q$,o));
  -- editor not owner
  perform pg_temp.expect_fail('editor cannot be owner', format($q$update public.papers set handling_editor_id=owner_id where id=%L$q$,p));
  -- peer_reviewed guard
  perform pg_temp.expect_fail('peer_reviewed needs completed review', format($q$update public.papers set peer_reviewed=true where id=%L$q$,p));
  -- journal acceptance guard: journal article, no completed review
  update public.papers set publication_type='JOURNAL_ARTICLE' where id=p;
  perform pg_temp.expect_fail('journal accept without completed review (trigger)', format($q$update public.papers set status='ACCEPTED' where id=%L and set_config('paperly.via_transition','1',true)='1'$q$,p));
  -- review rules
  perform pg_temp.expect_fail('reviewer cannot be owner', format($q$insert into public.review_assignments(paper_id,reviewer_id,assigned_by) values (%L,%L,%L)$q$,p,o,ed));
  perform pg_temp.expect_ok('invite external reviewer', format($q$insert into public.review_assignments(paper_id,reviewer_id,assigned_by) values (%L,%L,%L)$q$,p,rv,ed));
  select id into ra from public.review_assignments where paper_id=p;
  perform pg_temp.expect_fail('completed review needs content', format($q$update public.review_assignments set status='COMPLETED' where id=%L$q$,ra));
  perform pg_temp.expect_fail('POTENTIAL coi needs statement', format($q$update public.review_assignments set coi_status='POTENTIAL' where id=%L$q$,ra));
  perform pg_temp.expect_ok('complete review properly', format($q$update public.review_assignments set status='COMPLETED',recommendation='ACCEPT',comments_to_author=repeat('good ',20),completed_at=now(),coi_status='NONE' where id=%L$q$,ra));
  perform pg_temp.expect_fail('completed review frozen', format($q$update public.review_assignments set comments_to_author='edited' where id=%L$q$,ra));
  perform pg_temp.expect_fail('review delete blocked', format($q$delete from public.review_assignments where id=%L$q$,ra));
  perform pg_temp.expect_ok('peer_reviewed ok with completed review', format($q$update public.papers set peer_reviewed=true where id=%L$q$,p));
  -- ORCID
  perform pg_temp.expect_ok('orcid checksum', $q$select 1 where public.orcid_checksum_ok('0000-0002-1825-0097') and not public.orcid_checksum_ok('0000-0002-1825-0098')$q$);
  insert into public.profiles(id,display_name) values (o,'Owner');
  perform pg_temp.expect_fail('orcid needs verification row', format($q$update public.profiles set orcid='0000-0002-1825-0097' where id=%L$q$,o));
  -- state machine
  perform pg_temp.expect_ok('transition table', $q$select 1 where public.paper_transition_allowed('REVIEW_REQUIRED','REVIEWER_ASSIGNMENT',false) and public.paper_transition_allowed('PEER_REVIEW','EDITORIAL_DECISION',false) and not public.paper_transition_allowed('AI_SCREENING','ACCEPTED',false) and not public.paper_transition_allowed('SUBMITTED','PUBLISHED',false)$q$);
  -- bootstrap admin
  perform pg_temp.expect_ok('first bootstrap admin claimed', format($q$select 1 where public.claim_bootstrap_admin(%L)$q$,o));
  perform pg_temp.expect_ok('second bootstrap admin refused', format($q$select 1 where not public.claim_bootstrap_admin(%L)$q$,ed));
end $$;
