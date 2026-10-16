-- Database-level checks for migration 0010. NOT EXECUTED in the authoring environment (no PostgreSQL was available).
-- Run against a scratch database migrated from zero:  psql -v ON_ERROR_STOP=1 -f supabase_tests/0010_trust_ethics.sql
-- Every block must either succeed silently or raise; a block that expects a failure raises if the failure does NOT happen.
begin;
-- helper: expect an exception whose message matches a pattern
create or replace function pg_temp.expect_fail(_sql text, _pattern text) returns void language plpgsql as $$
begin
  begin execute _sql; exception when others then
    if sqlerrm !~* _pattern then raise exception 'wrong error for [%]: %', _sql, sqlerrm; end if; return;
  end;
  raise exception 'expected failure did not happen for [%]', _sql;
end $$;

-- seed: the row-level guards below only fire when rows exist, so create one minimal valid chain (rolled back at the end)
do $$ declare o uuid := gen_random_uuid(); p uuid; rd uuid; ed uuid; c uuid;
begin
  insert into public.papers(owner_id,title) values (o,'Seed paper') returning id into p;
  insert into public.rights_declarations(paper_id,user_id,declaration_version,ai_disclosure_version,selected_license,is_author,coauthor_permission,has_upload_rights,previously_published,manuscript_version_type,third_party_content,ai_processing_consent)
    values (p,o,'rights-1.1','ai-1','CC-BY',true,true,true,false,'ORIGINAL_SUBMISSION',false,true) returning id into rd;
  insert into public.ethics_declarations(paper_id,user_id,declaration_version,answers,conflict_of_interest,funding,data_availability)
    values (p,o,'ethics-1.0','{}'::jsonb,'None','None','On request') returning id into ed;
  insert into public.ethics_policies(version,content_hash,rules) values ('seed-1','seed','{}'::jsonb) on conflict do nothing;
  insert into public.ethics_cases(paper_id,declaration_id,policy_version,research_category) values (p,ed,'seed-1','NONE') returning id into c;
  insert into public.ethics_events(case_id,paper_id,event_type,actor_type,policy_version) values (c,p,'CASE_CREATED','SYSTEM','seed-1');
end $$;

-- identifiers: format, uniqueness, monotonic
select pg_temp.expect_fail($q$select public.next_identifier('DOI')$q$, 'Unknown identifier type');
do $$ declare a text := public.next_identifier('ETHICS_CASE'); b text := public.next_identifier('ETHICS_CASE');
begin if a = b or a !~ '^ETH-[0-9]{4}-[0-9]{6}$' then raise exception 'ETH identifiers not unique/well-formed: % %', a, b; end if; end $$;

-- rights policy trigger rejects a declaration without upload rights, and legacy version
select pg_temp.expect_fail($q$insert into public.rights_declarations(paper_id,user_id,declaration_version,ai_disclosure_version,selected_license,is_author,coauthor_permission,has_upload_rights,previously_published,manuscript_version_type,third_party_content,ai_processing_consent)
  select id, owner_id, 'rights-1.1','ai-1','CC-BY',true,true,false,false,'ORIGINAL_SUBMISSION',false,true from public.papers limit 1$q$, 'upload rights');
-- (requires at least one paper; seed one before running if the scratch database is empty)

-- declarations are append-only
select pg_temp.expect_fail($q$update public.rights_declarations set selected_license = 'X'$q$, 'append-only evidence');
select pg_temp.expect_fail($q$delete from public.ethics_declarations$q$, 'append-only evidence');
select pg_temp.expect_fail($q$update public.ethics_events set reason = 'x'$q$, 'append-only');
select pg_temp.expect_fail($q$update public.identifier_registry set resource_type = 'PAPER'$q$, 'immutable');

-- ethics case cannot be edited directly, even by a privileged session
select pg_temp.expect_fail($q$update public.ethics_cases set status = 'ETHICS_CLEARED'$q$, 'audited ethics workflow');
-- AI cannot decide
-- (needs a case id) select pg_temp.expect_fail($q$select public.ethics_transition('<case>', 'ETHICS_CLEARED', null, 'AI', 'x')$q$, 'AI cannot take ethics decisions');
-- browser roles have no table access
do $$ begin
  if has_table_privilege('authenticated', 'public.ethics_cases', 'select') or has_table_privilege('anon', 'public.ethics_events', 'select') then raise exception 'browser roles must not read ethics tables directly'; end if;
  if has_function_privilege('authenticated', 'public.commit_submission(uuid,jsonb)', 'execute') then raise exception 'commit_submission must be service-role only'; end if;
end $$;
rollback;
