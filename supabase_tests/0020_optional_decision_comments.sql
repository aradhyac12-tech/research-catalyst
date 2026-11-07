-- A completed review no longer needs written comments, but still needs a recommendation, completion time and COI status.
do $$
declare c text;
begin
  select pg_get_constraintdef(oid) into c from pg_constraint where conrelid='public.review_assignments'::regclass and conname='review_completed_has_content';
  if c is null then raise exception 'review_completed_has_content missing'; end if;
  if c like '%comments_to_author%' then raise exception 'comments are still required'; end if;
  if c not like '%recommendation%' or c not like '%completed_at%' or c not like '%coi_status%' then raise exception 'constraint lost its other requirements'; end if;
end $$;
