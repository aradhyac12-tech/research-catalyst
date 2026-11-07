-- Papers approved by an administrator (professors and teachers hold admin accounts) carry the peer reviewed mark,
-- and no reason is needed for the approval. peer_reviewed may now be true when either a review was completed
-- or an administrator approved the paper (review_waived).
create or replace function public.guard_peer_reviewed()
returns trigger language plpgsql as $$
begin
  if new.peer_reviewed and not new.review_waived and not exists (
    select 1 from public.review_assignments r where r.paper_id = new.id and r.status = 'COMPLETED'
  ) then
    raise exception 'peer_reviewed requires at least one completed review or an administrator approval';
  end if;
  return new;
end $$;
alter function public.guard_peer_reviewed() set search_path = public;

-- Papers already approved by an administrator get the mark too.
update public.papers set peer_reviewed = true where review_waived and not peer_reviewed;
