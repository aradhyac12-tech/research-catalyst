-- Database checks for migration 0026 (atomic AI spend + one-active-run guard). Run on a DISPOSABLE database after migrations 0000..0026:
--   psql -v ON_ERROR_STOP=1 -f supabase_tests/0026_ai_spend_atomic.sql
-- One transaction, rolled back. The real concurrent race is exercised separately by scripts/concurrency-ai-spend.sh.
begin;
create or replace function pg_temp.expect(_what text, _ok boolean) returns void language plpgsql as $$
begin if not _ok then raise exception 'FAIL: %', _what; end if; raise notice 'PASS  %', _what; end $$;
create or replace function pg_temp.expect_fail(label text, sql text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise notice 'PASS  % (%)', label, left(sqlerrm, 70); return; end; raise exception 'FAIL % succeeded', label; end $$;

do $$
declare
  o uuid := gen_random_uuid(); p uuid; p2 uuid; v1 uuid; r record; r2 record; rid uuid; before_day numeric;
begin
  insert into public.papers(owner_id, title) values (o, 'ai spend one') returning id into p;
  insert into public.papers(owner_id, title) values (o, 'ai spend two') returning id into p2;

  -- within both caps: reserved
  select * into r from public.ai_spend_reserve(p, 'gemini', 'm', 0.30, 0.50, 1000);
  perform pg_temp.expect('first reservation inside the caps succeeds', r.ok and r.reservation_id is not null and r.reason is null);
  rid := r.reservation_id;

  -- would pass the per-paper cap: refused, and NOTHING is inserted
  select * into r from public.ai_spend_reserve(p, 'anthropic', 'm', 0.30, 0.50, 1000);
  perform pg_temp.expect('second reservation over the per-paper cap is refused', not r.ok and r.reason = 'PAPER_BUDGET' and r.reservation_id is null);
  perform pg_temp.expect('a refused reservation inserts no row', (select count(*) from public.ai_spend where paper_id = p) = 1);

  -- another paper is unaffected by the first paper's cap
  select * into r from public.ai_spend_reserve(p2, 'gemini', 'm', 0.30, 0.50, 1000);
  perform pg_temp.expect('another paper has its own per-paper cap', r.ok);

  -- settling to the real (smaller) cost frees budget for the same paper
  perform pg_temp.expect('settle returns true for a RESERVED row', public.ai_spend_settle(rid, 0.10));
  perform pg_temp.expect('settle is not repeatable', not public.ai_spend_settle(rid, 9.99));
  perform pg_temp.expect('settled cost replaced the estimate', (select cost_usd from public.ai_spend where id = rid) = 0.10 and (select status from public.ai_spend where id = rid) = 'SETTLED');
  select * into r from public.ai_spend_reserve(p, 'groq', 'm', 0.35, 0.50, 1000);
  perform pg_temp.expect('freed budget can be reserved again', r.ok);

  -- release returns the whole reservation
  perform pg_temp.expect('release returns true for a RESERVED row', public.ai_spend_release(r.reservation_id));
  perform pg_temp.expect('released row no longer counts', (select coalesce(sum(cost_usd),0) from public.ai_spend where paper_id = p and status <> 'RELEASED') = 0.10);
  perform pg_temp.expect('a SETTLED row cannot be released', not public.ai_spend_release(rid));

  -- daily cap is global across papers
  select coalesce(sum(cost_usd),0) into before_day from public.ai_spend where day = (now() at time zone 'utc')::date and status <> 'RELEASED';
  select * into r from public.ai_spend_reserve(p2, 'gemini', 'm', 0.05, 5, before_day + 0.01);
  perform pg_temp.expect('daily cap refuses a reservation that would pass it', not r.ok and r.reason = 'DAILY_BUDGET');

  -- historic (0015-style) rows count: they default to SETTLED
  insert into public.ai_spend(paper_id, provider, model, cost_usd) values (p2, 'legacy', 'm', 0.15);
  perform pg_temp.expect('legacy rows default to SETTLED', (select status from public.ai_spend where provider = 'legacy' and paper_id = p2) = 'SETTLED');
  select * into r from public.ai_spend_reserve(p2, 'gemini', 'm', 0.10, 0.50, 1000);
  perform pg_temp.expect('legacy spend counts against the per-paper cap (0.30+0.15+0.10 > 0.50)', not r.ok and r.reason = 'PAPER_BUDGET');

  -- bad arguments are rejected loudly
  perform pg_temp.expect_fail('negative estimate rejected', format($q$select * from public.ai_spend_reserve(%L,'g','m',-1,1,1)$q$, p));
  perform pg_temp.expect_fail('null cap rejected', format($q$select * from public.ai_spend_reserve(%L,'g','m',0.1,null,1)$q$, p));
  perform pg_temp.expect_fail('negative actual rejected', format($q$select public.ai_spend_settle(%L, -1)$q$, rid));
  perform pg_temp.expect_fail('unknown status rejected', format($q$update public.ai_spend set status='BOGUS' where id=%L$q$, rid));

  -- privileges: server only
  perform pg_temp.expect('anon cannot reserve', not has_function_privilege('anon', 'public.ai_spend_reserve(uuid,text,text,numeric,numeric,numeric)', 'EXECUTE'));
  perform pg_temp.expect('authenticated cannot reserve', not has_function_privilege('authenticated', 'public.ai_spend_reserve(uuid,text,text,numeric,numeric,numeric)', 'EXECUTE'));
  perform pg_temp.expect('authenticated cannot settle', not has_function_privilege('authenticated', 'public.ai_spend_settle(uuid,numeric)', 'EXECUTE'));
  perform pg_temp.expect('authenticated cannot release', not has_function_privilege('authenticated', 'public.ai_spend_release(uuid)', 'EXECUTE'));
  perform pg_temp.expect('service_role can reserve', has_function_privilege('service_role', 'public.ai_spend_reserve(uuid,text,text,numeric,numeric,numeric)', 'EXECUTE'));
  perform pg_temp.expect('authenticated has no table access to ai_spend', not has_table_privilege('authenticated', 'public.ai_spend', 'SELECT'));

  -- one active screening run per paper version
  insert into public.paper_versions(paper_id, major, minor, version_kind, storage_path, file_hash, file_size, mime_type, author_name_at_submission, uploaded_by)
    values (p, 1, 0, 'INITIAL', 'x/a.pdf', repeat('a', 64), 10, 'application/pdf', 'A', o) returning id into v1;
  insert into public.ai_runs(paper_id, version_id, status, provider, model_name, policy_key, policy_version, prompt_version, privacy_mode)
    values (p, v1, 'RUNNING', 'multi', 'm', 'GENERAL_RESEARCH_POLICY', '1.0', 'v', 'EXTERNAL_WITH_CONSENT');
  perform pg_temp.expect_fail('a second RUNNING run for the same version is refused', format($q$insert into public.ai_runs(paper_id, version_id, status, provider, model_name, policy_key, policy_version, prompt_version, privacy_mode)
    values (%L, %L, 'RUNNING', 'multi', 'm', 'GENERAL_RESEARCH_POLICY', '1.0', 'v', 'EXTERNAL_WITH_CONSENT')$q$, p, v1));
  update public.ai_runs set status = 'FAILED', error = 'abandoned' where paper_id = p;
  insert into public.ai_runs(paper_id, version_id, status, provider, model_name, policy_key, policy_version, prompt_version, privacy_mode)
    values (p, v1, 'RUNNING', 'multi', 'm', 'GENERAL_RESEARCH_POLICY', '1.0', 'v', 'EXTERNAL_WITH_CONSENT');
  perform pg_temp.expect('after the stale run is FAILED a new run may start', true);
end $$;
rollback;
