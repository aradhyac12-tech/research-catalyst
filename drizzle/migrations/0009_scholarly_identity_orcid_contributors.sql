-- 0009: DUPLICATE OF 0003, NEUTRALISED (re-audit finding, Phase 6).
--
-- This file used to be a byte-for-byte copy of 0003_scholarly_identity_orcid_contributors.sql (only the trailing newline differed).
-- 0003 is not idempotent (plain CREATE TABLE, ADD CONSTRAINT, CREATE POLICY), so replaying it as 0009 fails with
-- "relation already exists" on any database migrated from zero. Its only possible purpose was a re-run that adds nothing.
--
-- It is kept, not deleted, so the migration journal (idx 9, tag 0009_...) stays valid for databases that already recorded it.
-- Drizzle's migrator tracks applied migrations by journal timestamp, so changing the body does not re-run it anywhere.
-- Nothing here changes schema. It only asserts that 0003 really did create everything it was supposed to, so a broken
-- chain fails loudly and early instead of silently.
do $$
begin
  if to_regclass('public.orcid_verifications') is null
     or to_regclass('public.paper_author_roles') is null
     or to_regclass('public.paper_author_affiliations') is null
     or to_regclass('public.paper_funding') is null
     or to_regclass('public.paper_ai_disclosures') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'papers' and column_name = 'paperly_id') then
    raise exception '0009: scholarly identity schema from 0003 is missing; the migration chain is broken';
  end if;
end $$;
