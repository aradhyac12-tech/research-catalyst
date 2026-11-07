-- 0050: submitted papers that never reached the editorial queue.
-- Cause: screening was started only by the author's browser after payment. If the page was closed (or the payment was settled
-- by the webhook), the paper stayed SUBMITTED, or stopped in PROCESSING / AI_SCREENING, and the queue (REVIEW_REQUIRED and later) never listed it.
-- The app now starts screening on the server (payment settlement, daily sweep, "Start screening now" in Admin). This migration repairs
-- the papers that are already stuck, the same way the app does when automated screening cannot finish: they go to an editor for manual screening.
-- Idempotent: only touches papers that are still stuck, always through transition_paper() (allowed transitions, audited, status history kept).

-- Queue lookups: status plus age, live papers only.
create index if not exists papers_queue_idx on public.papers (status, created_at) where deleted_at is null;

do $$
declare
  p record;
  moved int := 0;
begin
  -- 1) SUBMITTED with the fee settled (a PAID payment, or an active fee waiver for the owner) and no screening ever started.
  for p in
    select pa.id from public.papers pa
    where pa.status = 'SUBMITTED' and pa.deleted_at is null
      and (
        exists (select 1 from public.payments py where py.paper_id = pa.id and py.status = 'PAID')
        or exists (select 1 from public.fee_waivers fw where fw.user_id = pa.owner_id and fw.revoked_at is null)
      )
    order by pa.created_at
  loop
    perform public.transition_paper(p.id, 'PROCESSING', null, 'SYSTEM', 'screening started (repair: it never began after submission)');
    perform public.transition_paper(p.id, 'REVIEW_REQUIRED', null, 'SYSTEM', 'routed to editor for manual screening (repair: automated screening never started)');
    moved := moved + 1;
  end loop;

  -- 2) Stopped mid-screening: PROCESSING / AI_SCREENING for 30+ minutes with no live run.
  for p in
    select pa.id from public.papers pa
    where pa.status in ('PROCESSING', 'AI_SCREENING') and pa.deleted_at is null
      and pa.updated_at < now() - interval '30 minutes'
      and not exists (select 1 from public.ai_runs r where r.paper_id = pa.id and r.status in ('QUEUED', 'RUNNING') and r.started_at > now() - interval '30 minutes')
    order by pa.created_at
  loop
    update public.ai_runs set status = 'FAILED', error = 'abandoned: no completion was recorded (repair)', completed_at = now()
      where paper_id = p.id and status in ('QUEUED', 'RUNNING');
    perform public.transition_paper(p.id, 'REVIEW_REQUIRED', null, 'SYSTEM', 'routed to editor for manual screening (repair: screening stopped before finishing)');
    moved := moved + 1;
  end loop;

  raise notice '0050: % stuck paper(s) routed to the editorial queue', moved;
end $$;
