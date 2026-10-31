-- 0011 Phase 8 — manuscript version control.
-- Additive and idempotent. Does not touch published files, hashes or certificates.
--
--  1. version_kind on paper_versions (INITIAL / REVISION / CORRECTION), backfilled from the existing numbering.
--  2. A before-insert guard that makes the chain a single line: 1.0 has no predecessor, every later version points at the
--     latest one, numbers only increase by one step, a reason is required, an identical file is refused, and no version
--     can be added to a record that is retracted, archived, withdrawn or rejected.
--  3. versions_immutable() now also freezes the chain columns (previous_version_id, change_reason, kind, uploader, time).
--     anonymized_* columns stay updatable on purpose (review.server.ts addAnonymizedCopy).
--  4. commit_new_version(): ONE transaction for revision upload (version row + reviewer response + paper pointer + status
--     change + audit) and for a corrected published version (version row + public notice + pointer + CORRECTED status + audit).
--     Storage is still outside the transaction; the server compensates (see versions.server.ts).

alter table public.paper_versions add column if not exists version_kind text not null default 'INITIAL';
alter table public.paper_versions drop constraint if exists paper_versions_kind_check;
alter table public.paper_versions add constraint paper_versions_kind_check check (version_kind in ('INITIAL', 'REVISION', 'CORRECTION'));

-- Backfill BEFORE the stricter immutability function below is installed (the old function does not guard version_kind).
update public.paper_versions v set version_kind = 'REVISION'
 where version_kind = 'INITIAL' and (v.major, v.minor) <> (1, 0);
update public.paper_versions v set version_kind = 'CORRECTION'
 where version_kind = 'REVISION' and exists (select 1 from public.corrections c where c.new_version_id = v.id);

create unique index if not exists paper_versions_one_initial on public.paper_versions(paper_id) where version_kind = 'INITIAL';
create index if not exists paper_versions_prev_idx on public.paper_versions(previous_version_id);

create or replace function public.versions_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Manuscript versions cannot be deleted'; end if;
  if new.file_hash <> old.file_hash or new.storage_path <> old.storage_path or new.major <> old.major or new.minor <> old.minor
     or new.paper_id <> old.paper_id or new.previous_version_id is distinct from old.previous_version_id
     or new.change_reason is distinct from old.change_reason or new.version_kind <> old.version_kind
     or new.uploaded_by <> old.uploaded_by or new.uploaded_at <> old.uploaded_at
     or new.file_size <> old.file_size or new.mime_type <> old.mime_type
     or new.author_name_at_submission <> old.author_name_at_submission then
    raise exception 'Manuscript version files are immutable; create a new version';
  end if;
  return new;
end $$;

create or replace function public.guard_version_chain()
returns trigger language plpgsql set search_path = public as $$
declare _last public.paper_versions; _status public.paper_status;
begin
  -- Serialise concurrent inserts for the same paper.
  select status into _status from public.papers where id = new.paper_id for update;
  select * into _last from public.paper_versions where paper_id = new.paper_id order by major desc, minor desc limit 1;
  if not found then
    if new.version_kind <> 'INITIAL' or new.major <> 1 or new.minor <> 0 or new.previous_version_id is not null then
      raise exception 'The first version of a paper must be 1.0 with no predecessor';
    end if;
    return new;
  end if;
  if new.version_kind = 'INITIAL' then raise exception 'A paper has exactly one initial version'; end if;
  if _status in ('RETRACTED', 'ARCHIVED', 'WITHDRAWN', 'REJECTED') then
    raise exception 'No new version can be added to a record that is %', _status;
  end if;
  if new.previous_version_id is distinct from _last.id then
    raise exception 'A new version must follow the latest version (%.%)', _last.major, _last.minor;
  end if;
  if not ((new.major = _last.major and new.minor = _last.minor + 1) or (new.major = _last.major + 1 and new.minor = 0)) then
    raise exception 'Version numbers advance by one minor step (%.%) or to the next major (%.0)', _last.major, _last.minor + 1, _last.major + 1;
  end if;
  if new.change_reason is null or length(trim(new.change_reason)) < 10 then
    raise exception 'A new version needs a description of what changed (at least 10 characters)';
  end if;
  if new.file_hash = _last.file_hash then raise exception 'This file is identical to the current version'; end if;
  return new;
end $$;
drop trigger if exists paper_versions_chain on public.paper_versions;
create trigger paper_versions_chain before insert on public.paper_versions
  for each row execute function public.guard_version_chain();

create or replace function public.commit_new_version(_paper uuid, _actor uuid, _kind text, _bump text, _p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _pa public.papers; _last public.paper_versions; _maj int; _min int; _ver uuid;
  _reason text := trim(coalesce(_p->>'change_reason', ''));
  _title text := nullif(trim(coalesce(_p->>'title', '')), '');
  _abstract text := nullif(trim(coalesce(_p->>'abstract', '')), '');
begin
  if _kind not in ('REVISION', 'CORRECTION') then raise exception 'Unsupported version kind'; end if;
  if _bump not in ('MINOR', 'MAJOR') then raise exception 'Unsupported version step'; end if;
  select * into _pa from public.papers where id = _paper for update;
  if not found then raise exception 'Paper not found'; end if;

  if _kind = 'REVISION' then
    if _pa.owner_id <> _actor then raise exception 'Only the submitting author can upload a revision'; end if;
    if _pa.status <> 'REVISION_REQUIRED' then raise exception 'A revision can only be uploaded while one is requested (status is %)', _pa.status; end if;
    if length(trim(coalesce(_p->>'response_text', ''))) < 20 then raise exception 'A response to the reviewers and editor is required'; end if;
  else
    if not (public.has_role(_actor, 'admin') or public.has_role(_actor, 'super_admin')) then raise exception 'Only an administrator can issue a corrected version'; end if;
    if _pa.owner_id = _actor then raise exception 'Conflict of interest: you cannot correct a record you submitted'; end if;
    if _pa.status not in ('PUBLISHED', 'CORRECTED') then raise exception 'A corrected version can only be attached to a published record (status is %)', _pa.status; end if;
    if length(trim(coalesce(_p->>'notice', ''))) < 20 then raise exception 'The public notice needs at least 20 characters'; end if;
  end if;

  select * into _last from public.paper_versions where paper_id = _paper order by major desc, minor desc limit 1;
  if not found then raise exception 'This paper has no version to build on'; end if;
  if _bump = 'MAJOR' then _maj := _last.major + 1; _min := 0; else _maj := _last.major; _min := _last.minor + 1; end if;

  insert into public.paper_versions(paper_id, major, minor, version_kind, previous_version_id, storage_path, file_hash, file_size, mime_type, change_reason,
                                    author_name_at_submission, uploaded_by, scan_result, anonymized_storage_path, anonymized_file_hash)
  values (_paper, _maj, _min, _kind, _last.id, _p#>>'{version,storage_path}', _p#>>'{version,file_hash}', (_p#>>'{version,file_size}')::bigint, 'application/pdf', _reason,
          _p#>>'{version,author_name}', _actor, coalesce(_p#>'{version,scan_result}', '{}'::jsonb),
          nullif(_p#>>'{version,anonymized_storage_path}', ''), nullif(_p#>>'{version,anonymized_file_hash}', ''))
  returning id into _ver;

  if _kind = 'REVISION' then
    insert into public.revision_responses(paper_id, version_id, round, response_text, created_by)
    values (_paper, _ver, _pa.review_round, trim(_p->>'response_text'), _actor);
    update public.papers set current_version_id = _ver, review_round = _pa.review_round + 1,
           title = coalesce(_title, title), abstract = coalesce(_abstract, abstract) where id = _paper;
    perform public.transition_paper(_paper, 'SUBMITTED', _actor, 'USER', 'revision ' || _maj || '.' || _min || ' submitted', false,
                                    jsonb_build_object('version_id', _ver));
    insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, new_value, metadata)
    values (_actor, 'USER', 'revision_submitted', 'paper', _paper::text, jsonb_build_object('version', _maj || '.' || _min),
            jsonb_build_object('version_id', _ver, 'previous_version_id', _last.id, 'file_hash', _p#>>'{version,file_hash}',
                               'title_changed', _title is not null and _title <> _pa.title, 'abstract_changed', _abstract is not null and _abstract <> _pa.abstract));
  else
    insert into public.corrections(paper_id, kind, notice, reason, new_version_id, issued_by)
    values (_paper, 'CORRECTION', trim(_p->>'notice'), _reason, _ver, _actor);
    perform public.apply_published_correction(_paper, _ver, _title, _abstract);
    perform public.transition_paper(_paper, 'CORRECTED', _actor, 'USER', 'corrected version ' || _maj || '.' || _min || ': ' || _reason, false,
                                    jsonb_build_object('version_id', _ver));
    insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, new_value, metadata)
    values (_actor, 'USER', 'notice_correction_version', 'paper', _paper::text, jsonb_build_object('version', _maj || '.' || _min),
            jsonb_build_object('version_id', _ver, 'previous_version_id', _last.id, 'file_hash', _p#>>'{version,file_hash}', 'reason', _reason));
  end if;
  return jsonb_build_object('version_id', _ver, 'version', _maj || '.' || _min, 'previous_version_id', _last.id);
end $$;
revoke all on function public.commit_new_version(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.commit_new_version(uuid, uuid, text, text, jsonb) to service_role;
