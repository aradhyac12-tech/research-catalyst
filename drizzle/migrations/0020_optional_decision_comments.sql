-- Reviewers no longer have to write comments to submit a review: what changes are needed, or why they disapprove, is optional.
-- Whatever they do write is still shown to the author. A completed review still needs a recommendation, a completion time and a conflict-of-interest status.
alter table public.review_assignments drop constraint if exists review_completed_has_content;
alter table public.review_assignments add constraint review_completed_has_content
  check (status <> 'COMPLETED' or (recommendation is not null and completed_at is not null and coi_status is not null));
