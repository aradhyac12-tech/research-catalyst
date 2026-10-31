-- Critical tests from the brief that can be proven at database level. Run on a scratch DB after migrations 0000-0008.
create or replace function pg_temp.expect_fail(label text, sql text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise notice 'PASS  % (%)', label, left(sqlerrm,70); return; end; raise exception 'FAIL % : succeeded', label; end $$;
create or replace function pg_temp.expect_true(label text, cond boolean) returns void language plpgsql as $$
begin if cond then raise notice 'PASS  %', label; else raise exception 'FAIL %', label; end if; end $$;

do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); pa uuid; pb uuid; d uuid; vid uuid; cid uuid; n int;
begin
  insert into public.profiles(id, display_name) values (a,'Author A'), (b,'Author B');
  insert into public.papers(owner_id,title) values (a,'A paper') returning id into pa;
  insert into public.papers(owner_id,title) values (b,'B paper') returning id into pb;
  insert into public.paper_versions(paper_id,major,minor,storage_path,file_hash,file_size,mime_type,author_name_at_submission,uploaded_by)
    values (pa,1,0,'p','h',1,'application/pdf','A',a) returning id into vid;

  -- 6) Payment cannot cause acceptance: payment states are unreachable from any pre-acceptance state.
  perform pg_temp.expect_true('payment states unreachable before acceptance',
    not exists (select 1 from unnest(array['DRAFT','SUBMITTED','PROCESSING','AI_SCREENING','REVIEW_REQUIRED','REVIEWER_ASSIGNMENT','PEER_REVIEW','EDITORIAL_DECISION','REVISION_REQUIRED','REJECTED']) s,
                unnest(array['PAYMENT_PENDING','PAYMENT_COMPLETED','PUBLICATION_PENDING','PUBLISHED']) t
                where public.paper_transition_allowed(s::public.paper_status, t::public.paper_status, true)));
  perform pg_temp.expect_fail('cannot jump to PUBLISHED from DRAFT even with override', format($q$select public.transition_paper(%L,'PUBLISHED',NULL,'SYSTEM','override reason here',true)$q$, pa));

  -- 7) DOI cannot exist for a record without agency confirmation (covers rejected manuscripts).
  perform pg_temp.expect_fail('DOI value without confirmed status', format($q$insert into public.doi_records(paper_id,provider,status,doi) values (%L,'x','FAILED','10.1/x')$q$, pa));

  -- 2) Decisions are not editable by anyone through SQL once written (append-only audit trail is separate).
  insert into public.decisions(paper_id,source,outcome,actor_id) values (pa,'HUMAN','REJECT',gen_random_uuid()) returning id into d;
  select count(*) into n from pg_trigger where tgrelid='public.decisions'::regclass and not tgisinternal;
  perform pg_temp.expect_true('decisions table has write protection trigger or no client write privilege',
    n > 0 or not has_table_privilege('authenticated','public.decisions','UPDATE'));

  insert into public.paper_authors(paper_id,position,full_name,user_id) values (pa,1,'Author A',a);
  -- 8) Published article cannot be silently overwritten.
  perform set_config('paperly.via_transition','1',true);
  update public.papers set status='PUBLISHED' where id=pa;
  perform set_config('paperly.via_transition','0',true);
  perform pg_temp.expect_fail('published author list frozen', format($q$update public.paper_authors set full_name='Changed' where paper_id=%L$q$, pa));
  perform pg_temp.expect_fail('published status cannot be changed outside transition_paper', format($q$update public.papers set status='DRAFT' where id=%L$q$, pa));
  perform pg_temp.expect_fail('version row immutable', format($q$update public.paper_versions set file_hash='tampered' where id=%L$q$, vid));
  perform pg_temp.expect_fail('version row cannot be deleted', format($q$delete from public.paper_versions where id=%L$q$, vid));

  -- 9) Retraction cannot delete the original record.
  perform pg_temp.expect_fail('papers cannot be deleted', format($q$delete from public.papers where id=%L$q$, pa));
  insert into public.corrections(paper_id,kind,notice,reason,issued_by) values (pa,'RETRACTION',repeat('notice ',5),repeat('reason ',3),b);
  perform pg_temp.expect_true('retraction preserves the paper row', exists (select 1 from public.papers where id=pa));
  perform pg_temp.expect_fail('notice cannot be deleted', format($q$delete from public.corrections where paper_id=%L$q$, pa));

  -- 10) Certificate cannot be forged or altered.
  insert into public.certificates(paper_id,version_id,recipient_user_id,recipient_name_at_issue,certificate_type,author_role,paper_title_at_issue,article_public_id)
    values (pa,vid,a,'Author A','PUBLICATION','Author','A paper','PLY-2026-000001') returning id into cid;
  perform pg_temp.expect_fail('certificate recipient name immutable', format($q$update public.certificates set recipient_name_at_issue='Someone Else' where id=%L$q$, cid));
  perform pg_temp.expect_fail('certificate title immutable', format($q$update public.certificates set paper_title_at_issue='Other work' where id=%L$q$, cid));
  perform pg_temp.expect_fail('certificate cannot be deleted', format($q$delete from public.certificates where id=%L$q$, cid));
  update public.certificates set status='RETRACTED', status_reason='Record retracted' where id=cid;
  perform pg_temp.expect_true('certificate can be marked retracted', (select status::text from public.certificates where id=cid)='RETRACTED');

  -- 12) RLS: cross-user manuscript access, under the real browser roles.
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  select count(*) into n from public.papers;
  perform pg_temp.expect_true('author A sees only own paper (RLS)', n = 1);
  select count(*) into n from public.papers where id = pb;
  perform pg_temp.expect_true('author A cannot see author B paper', n = 0);
  select count(*) into n from public.paper_versions where paper_id = pb;
  perform pg_temp.expect_true('author A cannot see author B versions', n = 0);
  perform pg_temp.expect_fail('author cannot insert a decision', format($q$insert into public.decisions(paper_id,source,outcome,actor_id) values (%L,'HUMAN','ACCEPT',%L)$q$, pa, a));
  perform pg_temp.expect_fail('author cannot update own paper status', format($q$update public.papers set status='ACCEPTED' where id=%L$q$, pa));
  perform pg_temp.expect_fail('author cannot read review_assignments', $q$select * from public.review_assignments$q$);
  perform pg_temp.expect_fail('author cannot read editorial_board_members', $q$select * from public.editorial_board_members$q$);
  perform pg_temp.expect_fail('author cannot grant self a role', format($q$insert into public.user_roles(user_id,role) values (%L,'super_admin')$q$, a));
  perform pg_temp.expect_fail('author cannot call transition_paper', format($q$select public.transition_paper(%L,'ACCEPTED',NULL,'USER','x',true)$q$, pa));
  reset role;

  -- 5) Public (anonymous) user cannot read manuscripts or papers at all through the database API.
  set local role anon;
  perform pg_temp.expect_fail('anon cannot read papers', $q$select count(*) from public.papers$q$);
  perform pg_temp.expect_fail('anon cannot read paper_versions', $q$select count(*) from public.paper_versions$q$);
  perform pg_temp.expect_fail('anon cannot read certificates', $q$select count(*) from public.certificates$q$);
  reset role;
  raise notice 'ALL CRITICAL DATABASE TESTS PASSED';
end $$;
