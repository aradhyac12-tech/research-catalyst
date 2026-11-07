-- Phase 8 version-control checks. WRITTEN, NOT YET RUN (no PostgreSQL available when this was authored).
-- Run on a scratch database after migrations 0000..0011:  psql -v ON_ERROR_STOP=1 -f supabase_tests/0011_version_control.sql
-- Everything happens in one transaction that is rolled back at the end.
begin;
create or replace function pg_temp.expect_fail(label text, sql text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise notice 'PASS  % (%)', label, left(sqlerrm, 70); return; end; raise exception 'FAIL % succeeded', label; end $$;

do $$
declare
  o uuid := gen_random_uuid(); other uuid := gen_random_uuid(); p uuid; v1 uuid; v2 uuid; r jsonb;
  payload jsonb;
begin
  insert into public.papers(owner_id, title) values (o, 'Version control test') returning id into p;

  -- the first version must be 1.0 with no predecessor
  perform pg_temp.expect_fail('first version cannot be 1.1', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 1, 1, 'REVISION', 'x/a.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, repeat('a', 64), o));
  insert into public.paper_versions(paper_id, major, minor, version_kind, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (p, 1, 0, 'INITIAL', 'x/a.pdf', repeat('a', 64), 10, 'application/pdf', 'A', o) returning id into v1;
  update public.papers set current_version_id = v1 where id = p;
  raise notice 'PASS  first version 1.0 accepted';

  perform pg_temp.expect_fail('second INITIAL refused', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 2, 0, 'INITIAL', 'x/b.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, repeat('b', 64), o));
  perform pg_temp.expect_fail('missing predecessor refused', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, change_reason, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 1, 1, 'REVISION', 'a long enough reason', 'x/b.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, repeat('b', 64), o));
  perform pg_temp.expect_fail('skipped number refused', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, previous_version_id, change_reason, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 1, 5, 'REVISION', %L, 'a long enough reason', 'x/b.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, v1, repeat('b', 64), o));
  perform pg_temp.expect_fail('reason required', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, previous_version_id, change_reason, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 1, 1, 'REVISION', %L, 'short', 'x/b.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, v1, repeat('b', 64), o));
  perform pg_temp.expect_fail('identical file refused', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, previous_version_id, change_reason, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 1, 1, 'REVISION', %L, 'a long enough reason', 'x/b.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, v1, repeat('a', 64), o));

  -- revision through the atomic function
  perform pg_temp.expect_fail('revision refused outside REVISION_REQUIRED', format($q$select public.commit_new_version(%L, %L, 'REVISION', 'MINOR', '{"change_reason":"Added control group analysis","response_text":"We added the requested analysis in section 3.","version":{"storage_path":"x/b.pdf","file_hash":"%s","file_size":10,"author_name":"A","scan_result":{}}}'::jsonb)$q$, p, o, repeat('b', 64)));
  perform set_config('paperly.via_transition', '1', true);
  update public.papers set status = 'REVISION_REQUIRED' where id = p;
  perform set_config('paperly.via_transition', '0', true);
  payload := jsonb_build_object('change_reason', 'Added control group analysis', 'response_text', 'We added the requested analysis in section 3.',
    'version', jsonb_build_object('storage_path', 'x/b.pdf', 'file_hash', repeat('b', 64), 'file_size', 10, 'author_name', 'A', 'scan_result', '{}'::jsonb));
  perform pg_temp.expect_fail('only the owner may revise', format($q$select public.commit_new_version(%L, %L, 'REVISION', 'MINOR', %L::jsonb)$q$, p, other, payload::text));
  r := public.commit_new_version(p, o, 'REVISION', 'MINOR', payload);
  assert r->>'version' = '1.1', 'revision should be 1.1';
  assert (select status from public.papers where id = p) = 'SUBMITTED', 'revision returns the paper to SUBMITTED';
  assert (select current_version_id from public.papers where id = p) = (r->>'version_id')::uuid, 'pointer moved';
  assert (select previous_version_id from public.paper_versions where id = (r->>'version_id')::uuid) = v1, 'previous_version_id set';
  assert (select count(*) from public.revision_responses where paper_id = p) = 1, 'response stored';
  assert (select count(*) from public.paper_versions where paper_id = p) = 2, 'old version preserved';
  raise notice 'PASS  atomic revision 1.0 -> 1.1';
  v2 := (r->>'version_id')::uuid;

  -- immutability
  perform pg_temp.expect_fail('previous_version_id frozen', format($q$update public.paper_versions set previous_version_id = null where id = %L$q$, v2));
  perform pg_temp.expect_fail('change_reason frozen', format($q$update public.paper_versions set change_reason = 'rewritten history' where id = %L$q$, v2));
  perform pg_temp.expect_fail('file hash frozen', format($q$update public.paper_versions set file_hash = %L where id = %L$q$, repeat('c', 64), v2));
  perform pg_temp.expect_fail('versions cannot be deleted', format($q$delete from public.paper_versions where id = %L$q$, v1));
  update public.paper_versions set anonymized_storage_path = 'x/anon.pdf', anonymized_file_hash = repeat('d', 64) where id = v2;
  raise notice 'PASS  anonymized copy still updatable';

  -- retracted records take no new version
  perform set_config('paperly.via_transition', '1', true);
  update public.papers set status = 'RETRACTED' where id = p;
  perform set_config('paperly.via_transition', '0', true);
  perform pg_temp.expect_fail('no version on a retracted record', format($q$insert into public.paper_versions(paper_id, major, minor, version_kind, previous_version_id, change_reason, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (%L, 1, 2, 'REVISION', %L, 'a long enough reason', 'x/c.pdf', %L, 10, 'application/pdf', 'A', %L)$q$, p, v2, repeat('c', 64), o));

  -- browser roles cannot call the commit function
  perform pg_temp.expect_fail('anon cannot call commit_new_version', 'set local role anon; select public.commit_new_version(gen_random_uuid(), gen_random_uuid(), ''REVISION'', ''MINOR'', ''{}''::jsonb)');
end $$;
-- NOT covered here (needs a real admin user row): CORRECTION path of commit_new_version (admin only, conflict of interest, corrections row with new_version_id, CORRECTED status).
rollback;
