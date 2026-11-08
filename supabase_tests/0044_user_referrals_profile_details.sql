-- 0044: profile details (name, age) and referral links issued to registered users. Run against a database where 0043 and 0044 are applied.
do $$
declare
  u uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); pa uuid; la uuid; p1 uuid; p2 uuid; n int;
begin
  insert into auth.users(id, email) values (u, 'ref-user@t.test'), (s1, 'ref-s1@t.test'), (s2, 'ref-s2@t.test');
  insert into public.profiles(id, display_name, email) values (u, 'Ref User', 'ref-user@t.test'), (s1, 'S One', 'ref-s1@t.test'), (s2, 'S Two', 'ref-s2@t.test') on conflict do nothing;

  -- New accounts are not completed until the server says so.
  if (select details_completed from public.profiles where id = u) then raise exception 'a new account started as completed'; end if;
  -- Age is whole years 10..100.
  begin update public.profiles set age = 9 where id = u; raise exception 'age 9 accepted'; exception when check_violation then null; end;
  begin update public.profiles set age = 101 where id = u; raise exception 'age 101 accepted'; exception when check_violation then null; end;
  update public.profiles set age = 21 where id = u;

  -- One partner record per user; discount is never negative or absurd.
  insert into public.referral_partners(display_name, user_id) values ('Ref User · R-TEST', u) returning id into pa;
  begin insert into public.referral_partners(display_name, user_id) values ('Another label', u); raise exception 'second partner for one user accepted'; exception when unique_violation then null; end;
  insert into public.referral_links(partner_id, code, discount_minor) values (pa, 'K7XM92QF', 20000) returning id into la;
  begin update public.referral_links set discount_minor = -1 where id = la; raise exception 'negative discount accepted'; exception when check_violation then null; end;
  begin update public.referral_links set discount_minor = 100000001 where id = la; raise exception 'discount above the ceiling accepted'; exception when check_violation then null; end;

  -- Uploaders: only students with a live article attributed to the partner, once each, however many articles.
  insert into public.papers(owner_id, title) values (s1, 'A1') returning id into p1;
  insert into public.papers(owner_id, title) values (s1, 'A2');
  insert into public.papers(owner_id, title) values (s2, 'B1') returning id into p2;
  insert into public.referral_paper_attributions(paper_id, partner_id, link_id, share_percent, source) values (p1, pa, la, 100, 'SUBMISSION_LINK'), (p2, pa, la, 100, 'SUBMISSION_LINK');
  select count(*) into n from public.referral_partner_uploaders() where partner_id = pa; if n <> 2 then raise exception 'expected 2 uploaders, got %', n; end if;
  update public.papers set deleted_at = now() where id = p2;
  select count(*) into n from public.referral_partner_uploaders() where partner_id = pa; if n <> 1 then raise exception 'a deleted article still counts an uploader'; end if;

  -- Server-only function.
  if has_function_privilege('authenticated', 'public.referral_partner_uploaders()', 'execute') or has_function_privilege('anon', 'public.referral_partner_uploaders()', 'execute') then raise exception 'uploaders function reachable by clients'; end if;
  if not has_function_privilege('service_role', 'public.referral_partner_uploaders()', 'execute') then raise exception 'uploaders function not usable by the server'; end if;

  raise exception 'ROLLBACK_OK'; -- leave nothing behind
exception when others then
  if sqlerrm <> 'ROLLBACK_OK' then raise; end if;
end $$;
