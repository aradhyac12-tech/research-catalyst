-- 0014: secure one-time administrator bootstrap.
-- Signup no longer promotes anyone. The ONLY path to the first super_admin is the server function claimBootstrapAdmin,
-- which requires a secret deployment token (ADMIN_BOOTSTRAP_TOKEN) that is verified server-side before this function runs.
-- This function is the database-side backstop: service_role only, advisory-locked (race-free), and it refuses once ANY
-- administrator exists, so existing legitimate administrators are never displaced and the claim can never repeat.
-- No role rows are created, changed or removed by this migration.
create or replace function public.claim_bootstrap_admin(_uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(727001);
  if exists (select 1 from public.user_roles where role in ('super_admin','admin')) then return false; end if;
  if not exists (select 1 from public.profiles where id = _uid) then return false; end if;
  insert into public.user_roles(user_id, role) values (_uid, 'super_admin') on conflict do nothing;
  return true;
end $$;
revoke all on function public.claim_bootstrap_admin(uuid) from public, anon, authenticated;
grant execute on function public.claim_bootstrap_admin(uuid) to service_role;
