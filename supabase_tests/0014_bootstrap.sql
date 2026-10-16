-- Database checks for migration 0014 (secure bootstrap). Run: psql -v ON_ERROR_STOP=1 -f supabase_tests/0014_bootstrap.sql
-- Everything runs in one transaction and is rolled back.
begin;
create or replace function pg_temp.expect(_what text, _ok boolean) returns void language plpgsql as $$
begin if not _ok then raise exception 'FAIL: %', _what; end if; end $$;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); ghost uuid := gen_random_uuid(); c uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values (a,'a@t.test'),(b,'b@t.test'),(c,'c@t.test');
  insert into public.profiles(id,display_name) values (a,'A'),(b,'B'),(c,'C');
  insert into public.user_roles(user_id,role) values (a,'researcher'),(b,'researcher'),(c,'researcher');
  -- start from a database with no administrators (inside this rolled-back transaction only)
  delete from public.user_roles where role in ('admin','super_admin');
  -- signup alone never elevates
  perform pg_temp.expect('plain signup has no admin role', not exists (select 1 from public.user_roles where role in ('admin','super_admin')));
  -- a user without a profile cannot be promoted
  perform pg_temp.expect('no profile -> refused', not public.claim_bootstrap_admin(ghost));
  perform pg_temp.expect('first claim succeeds', public.claim_bootstrap_admin(a));
  perform pg_temp.expect('repeat claim by same user is refused', not public.claim_bootstrap_admin(a));
  perform pg_temp.expect('second user refused', not public.claim_bootstrap_admin(b));
  perform pg_temp.expect('exactly one super_admin', (select count(*) from public.user_roles where role='super_admin') = 1);
  perform pg_temp.expect('other users untouched', (select count(*) from public.user_roles where user_id in (b,c) and role <> 'researcher') = 0);
  -- an existing plain admin (no super_admin) also blocks bootstrap
  delete from public.user_roles where role='super_admin';
  insert into public.user_roles(user_id,role) values (b,'admin');
  perform pg_temp.expect('existing admin blocks bootstrap', not public.claim_bootstrap_admin(c));
  -- privileges: only service_role may execute
  perform pg_temp.expect('anon cannot execute', not has_function_privilege('anon','public.claim_bootstrap_admin(uuid)','EXECUTE'));
  perform pg_temp.expect('authenticated cannot execute', not has_function_privilege('authenticated','public.claim_bootstrap_admin(uuid)','EXECUTE'));
  perform pg_temp.expect('service_role can execute', has_function_privilege('service_role','public.claim_bootstrap_admin(uuid)','EXECUTE'));
end $$;
rollback;
