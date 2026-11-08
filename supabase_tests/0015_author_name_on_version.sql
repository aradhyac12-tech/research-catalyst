-- Verifies commit_submission stores the name the server passes (corresponding author) on the version, not the account display name.
begin;
do $$
declare u uuid := gen_random_uuid(); att record; res jsonb; stored text; pol jsonb := '{"version":"seed-2","rules":{}}'::jsonb; initial text;
begin
  insert into auth.users(id,email) values (u,'owner@t.test');
  insert into public.profiles(id,display_name) values (u,'ACCOUNT DISPLAY NAME');
  select * into att from public.claim_submission_attempt(u,'key-author-name-1','hash1',gen_random_uuid());
  res := public.commit_submission(att.o_attempt_id, jsonb_build_object(
    'paper', jsonb_build_object('title','Title five','abstract',repeat('a',60),'keywords',jsonb_build_array('k'),'article_type','Original Research','field','Physics','license','CC-BY','copyright_holder','Authors','language','en','references_text',''),
    'authors', jsonb_build_array(
        jsonb_build_object('full_name','First Listed Author','is_corresponding',false,'roles','[]'::jsonb),
        jsonb_build_object('full_name','Dr. Corresponding Person','is_corresponding',true,'roles','[]'::jsonb)),
    'funders','[]'::jsonb,'ai_disclosures','[]'::jsonb,'references','[]'::jsonb,
    'version', jsonb_build_object('storage_path','u/p/v1.pdf','file_hash','abc','file_size',10,'author_name','Dr. Corresponding Person','scan_result','{}'::jsonb),
    'rights', jsonb_build_object('declaration_version','rights-1.1','ai_disclosure_version','ai-1','is_author',true,'coauthor_permission',true,'has_upload_rights',true,'previously_published',false,'manuscript_version_type','ORIGINAL_SUBMISSION','third_party_content',false,'ai_processing_consent',true),
    'ethics', jsonb_build_object('declaration_version','ethics-1.0','answers','{}'::jsonb,'conflict_of_interest','None','funding','None','data_availability','On request'),
    'policy', jsonb_build_object('version','seed-2','hash','h','rules','{}'::jsonb),
    'subject', jsonb_build_object('human_participants',false,'identifiable_info_present',false,'deidentification_status','NOT_APPLICABLE','informed_consent_status','NOT_APPLICABLE','publication_consent_status','NOT_APPLICABLE','waiver_status','NOT_APPLICABLE','committee_approval_status','NOT_APPLICABLE','privacy_sensitive_media',false),
    'case', jsonb_build_object('research_category','NONE','requires_trial_registration',false,'requires_publication_consent',false,'requires_committee_approval',false,'initial_status','ETHICS_NOT_REQUIRED','reasons','[]'::jsonb),
    'trial', jsonb_build_object('registration_required',false,'registration_status','NOT_APPLICABLE','verification_status','NOT_REQUIRED')));
  select v.author_name_at_submission into stored from public.paper_versions v join public.papers p on p.current_version_id=v.id where p.id=(res->>'paper_id')::uuid;
  raise notice 'stored author_name_at_submission = %', stored;
  if stored <> 'Dr. Corresponding Person' then raise exception 'FAIL: wrong name stored: %', stored; end if;
  if stored = 'ACCOUNT DISPLAY NAME' then raise exception 'FAIL: profile name used'; end if;
end $$;
rollback;
