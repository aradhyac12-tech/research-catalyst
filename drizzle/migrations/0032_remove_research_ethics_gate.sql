-- Research ethics is removed from the website: authors are no longer asked ethics questions and ethics review is not part of
-- publication. Publication must therefore never wait on an ethics case. Existing ethics tables and records stay as history.
drop trigger if exists papers_guard_ethics_publication on public.papers;
create or replace function public.guard_ethics_before_publication() returns trigger language plpgsql security definer set search_path = public as $$
begin
  return new; -- ethics no longer holds publication
end $$;
