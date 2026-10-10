-- 0026 (Phase 20): atomic AI spend reservations and a one-active-run guard.
-- NOT APPLIED TO PRODUCTION. Replay on a disposable database first (scripts/replay-and-test.sh), then apply with approval.
--
-- Why: 0015 let the application read the totals, call the provider, then insert the cost. Two concurrent screenings both
-- read "under the cap" and both spent, so neither the per-paper nor the daily cap held under load. Reservations fix that:
-- the cap check and the insert happen in ONE transaction under an advisory lock, BEFORE the provider is called.

alter table public.ai_spend add column if not exists status text not null default 'SETTLED';
alter table public.ai_spend add column if not exists estimate_usd numeric(12,6);
alter table public.ai_spend add column if not exists settled_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_spend_status_check' and conrelid = 'public.ai_spend'::regclass) then
    alter table public.ai_spend add constraint ai_spend_status_check check (status in ('RESERVED','SETTLED','RELEASED'));
  end if;
end $$;
-- Rows written by 0015 code keep status SETTLED (the column default), so historic spend still counts against the caps.
create index if not exists ai_spend_day_status_idx on public.ai_spend(day, status);
create index if not exists ai_spend_paper_status_idx on public.ai_spend(paper_id, status);

-- Reserve budget. Returns ok=false (nothing inserted) when the reservation would pass either cap.
-- RESERVED and SETTLED rows count; RELEASED rows do not. A reservation that is never settled (process killed mid-call)
-- keeps counting at its estimate: the failure mode is "spend slightly less", never "spend without a cap".
create or replace function public.ai_spend_reserve(_paper uuid, _provider text, _model text, _estimate numeric, _paper_cap numeric, _day_cap numeric)
returns table (ok boolean, reservation_id uuid, reason text, paper_usd numeric, day_usd numeric)
language plpgsql security definer set search_path = public as $$
declare
  _day date := (now() at time zone 'utc')::date;
  _p numeric; _d numeric; _id uuid;
begin
  if _paper is null or _estimate is null or _estimate < 0 or _paper_cap is null or _paper_cap < 0 or _day_cap is null or _day_cap < 0 then
    raise exception 'invalid AI spend arguments';
  end if;
  -- The daily cap is a global invariant, so every reservation takes the same lock. Reservations are single indexed sums; contention is negligible.
  perform pg_advisory_xact_lock(hashtextextended('paperly.ai_spend', 0));
  select coalesce(sum(s.cost_usd), 0) into _p from public.ai_spend s where s.paper_id = _paper and s.status <> 'RELEASED';
  select coalesce(sum(s.cost_usd), 0) into _d from public.ai_spend s where s.day = _day and s.status <> 'RELEASED';
  if _p + _estimate > _paper_cap then
    return query select false, null::uuid, 'PAPER_BUDGET'::text, _p, _d; return;
  end if;
  if _d + _estimate > _day_cap then
    return query select false, null::uuid, 'DAILY_BUDGET'::text, _p, _d; return;
  end if;
  insert into public.ai_spend(paper_id, provider, model, cost_usd, estimate_usd, status)
  values (_paper, _provider, _model, _estimate, _estimate, 'RESERVED') returning id into _id;
  return query select true, _id, null::text, _p + _estimate, _d + _estimate;
end $$;

-- Replace the estimate with the real cost once the provider answered (also used for answers that were billed but unusable).
create or replace function public.ai_spend_settle(_id uuid, _actual numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if _id is null or _actual is null or _actual < 0 then raise exception 'invalid AI spend arguments'; end if;
  update public.ai_spend set cost_usd = _actual, status = 'SETTLED', settled_at = now() where id = _id and status = 'RESERVED';
  return found;
end $$;

-- Give the reservation back when the provider definitively did not bill (HTTP error response, rate limit, auth failure).
create or replace function public.ai_spend_release(_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if _id is null then raise exception 'invalid AI spend arguments'; end if;
  update public.ai_spend set cost_usd = 0, status = 'RELEASED', settled_at = now() where id = _id and status = 'RESERVED';
  return found;
end $$;

revoke all on function public.ai_spend_reserve(uuid, text, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.ai_spend_settle(uuid, numeric) from public, anon, authenticated;
revoke all on function public.ai_spend_release(uuid) from public, anon, authenticated;
grant execute on function public.ai_spend_reserve(uuid, text, text, numeric, numeric, numeric) to service_role;
grant execute on function public.ai_spend_settle(uuid, numeric) to service_role;
grant execute on function public.ai_spend_release(uuid) to service_role;

-- One active screening run per paper version: a second concurrent start cannot also spend AI budget.
-- Pre-flight: refuse (with a readable message) instead of failing half way if live data already violates it.
do $$ begin
  if exists (select 1 from public.ai_runs where status in ('QUEUED','RUNNING') group by paper_id, version_id having count(*) > 1) then
    raise exception 'ai_runs has several active (QUEUED/RUNNING) rows for one paper version. Mark the stale ones FAILED, then re-run this migration.';
  end if;
end $$;
create unique index if not exists ai_runs_one_active_uidx on public.ai_runs(paper_id, version_id) where status in ('QUEUED','RUNNING');
