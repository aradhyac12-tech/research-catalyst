-- 0002: M-1 safety fixes. Additive/replace-only; no data is deleted or rewritten.
-- 1) Automated screening can no longer accept, reject or request revision. It can only route to editors.
create or replace function public.paper_transition_allowed(_from public.paper_status, _to public.paper_status, _override boolean)
returns boolean language sql immutable as $$
  select case
    when _to = 'PUBLISHED' and _from <> 'PUBLICATION_PENDING' then false
    when (_from::text, _to::text) in (
      ('DRAFT','SUBMITTED'),
      ('SUBMITTED','PROCESSING'),
      ('PROCESSING','AI_SCREENING'),('PROCESSING','REVIEW_REQUIRED'),
      ('AI_SCREENING','REVIEW_REQUIRED'),('AI_SCREENING','PROCESSING'),
      ('REVIEW_REQUIRED','ACCEPTED'),('REVIEW_REQUIRED','REJECTED'),('REVIEW_REQUIRED','REVISION_REQUIRED'),
      ('REVISION_REQUIRED','SUBMITTED'),
      ('ACCEPTED','PAYMENT_PENDING'),('ACCEPTED','PUBLICATION_PENDING'),
      ('PAYMENT_PENDING','PAYMENT_COMPLETED'),('PAYMENT_PENDING','ACCEPTED'),
      ('PAYMENT_COMPLETED','PUBLICATION_PENDING'),
      ('PUBLICATION_PENDING','PUBLISHED'),
      ('PUBLISHED','CORRECTED'),('PUBLISHED','RETRACTED'),('PUBLISHED','ARCHIVED'),
      ('CORRECTED','CORRECTED'),('CORRECTED','RETRACTED'),('CORRECTED','ARCHIVED'),
      ('REJECTED','ARCHIVED')
    ) then true
    when _override and (_from::text, _to::text) in (
      ('REJECTED','REVIEW_REQUIRED'),('REJECTED','ACCEPTED'),('REJECTED','REVISION_REQUIRED'),
      ('ACCEPTED','REJECTED'),('ACCEPTED','REVIEW_REQUIRED'),
      ('REVISION_REQUIRED','REJECTED'),('REVISION_REQUIRED','ACCEPTED')
    ) then true
    else false
  end
$$;

-- Machine-sourced decisions may only be "route to editor". NOT VALID: legacy rows are kept untouched.
alter table public.decisions add constraint machine_cannot_decide
  check (source = 'HUMAN' or outcome = 'REVIEW_REQUIRED') not valid;

-- 2) Reviewers no longer get blanket read access to manuscripts (incl. author identity).
--    Reviewer access will be re-introduced through anonymised security-definer views (peer-review milestone).
create or replace function public.can_access_paper(_paper_id uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.papers p where p.id = _paper_id and p.owner_id = _uid)
      or public.is_staff(_uid)
$$;

-- 3) peer_reviewed can only be true when at least one review has actually been completed.
create or replace function public.guard_peer_reviewed()
returns trigger language plpgsql as $$
begin
  if new.peer_reviewed and not exists (
    select 1 from public.review_assignments r where r.paper_id = new.id and r.status = 'COMPLETED'
  ) then
    raise exception 'peer_reviewed requires at least one completed review';
  end if;
  return new;
end $$;
drop trigger if exists papers_guard_peer_reviewed on public.papers;
create trigger papers_guard_peer_reviewed before insert or update of peer_reviewed on public.papers
  for each row when (new.peer_reviewed) execute function public.guard_peer_reviewed();

-- 4) Race-free bootstrap of the first super_admin.
create or replace function public.claim_bootstrap_admin(_uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(727001);
  if exists (select 1 from public.user_roles where role = 'super_admin') then return false; end if;
  insert into public.user_roles(user_id, role) values (_uid, 'super_admin') on conflict do nothing;
  return true;
end $$;
revoke all on function public.claim_bootstrap_admin(uuid) from public, anon, authenticated;
grant execute on function public.claim_bootstrap_admin(uuid) to service_role;
