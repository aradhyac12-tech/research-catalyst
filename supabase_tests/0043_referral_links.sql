-- referral links: server-only tables, opaque codes, one live link per partner, shares of a paper always total exactly 100,
-- automatic recording never overwrites, and the existing erase-a-paper flow still works with attribution attached.
do $$
declare
  t text; f text; u uuid := gen_random_uuid(); p1 uuid; p2 uuid; pa uuid; pb uuid; la uuid; n int;
begin
  -- Private to the server: RLS on, no table or function access for clients.
  foreach t in array array['referral_partners','referral_links','referral_user_attributions','referral_paper_attributions'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '% has RLS off', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update')
       or has_table_privilege('authenticated', 'public.' || t, 'delete') or has_table_privilege('anon', 'public.' || t, 'insert') then
      raise exception '% reachable by clients', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') then raise exception '% not usable by the server', t; end if;
  end loop;
  foreach f in array array['referral_set_paper_shares(uuid,jsonb,text,boolean,uuid)','referral_partner_stats()'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then raise exception '% executable by clients', f; end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then raise exception '% not executable by the server', f; end if;
  end loop;

  -- Fixtures
  insert into auth.users(id, email) values (u, 'ref-test@t.test');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.papers(owner_id, title) values (u, 'T1') returning id into p1;
  insert into public.papers(owner_id, title) values (u, 'T2') returning id into p2;
  insert into public.referral_partners(display_name) values ('Zz Test Partner A') returning id into pa;
  insert into public.referral_partners(display_name) values ('Zz Test Partner B') returning id into pb;
  insert into public.referral_links(partner_id, code) values (pa, 'K7XM92QF') returning id into la;

  -- Opaque code format, uniqueness, one live link per partner, unique partner names.
  begin insert into public.referral_links(partner_id, code) values (pb, 'K7XM92QO'); raise exception 'ambiguous character accepted in code';
  exception when check_violation then null; end;
  begin insert into public.referral_links(partner_id, code) values (pb, 'k7xm92qf'); raise exception 'lowercase code accepted';
  exception when check_violation then null; end;
  begin insert into public.referral_links(partner_id, code) values (pb, 'K7XM92QF'); raise exception 'duplicate code accepted';
  exception when unique_violation then null; end;
  begin insert into public.referral_links(partner_id, code) values (pa, 'ABCDEFGH'); raise exception 'second live link accepted';
  exception when unique_violation then null; end;
  begin insert into public.referral_partners(display_name) values ('  zz test PARTNER a '); raise exception 'duplicate partner name accepted';
  exception when unique_violation then null; end;

  -- Shares: first write wins, replay is a no-op, admin overwrite works, and every bad input is refused without leaving a trace.
  if not public.referral_set_paper_shares(p1, jsonb_build_array(jsonb_build_object('partner_id', pa, 'link_id', la, 'share_percent', 100)), 'SUBMISSION_LINK', false, u) then raise exception 'first write refused'; end if;
  if public.referral_set_paper_shares(p1, jsonb_build_array(jsonb_build_object('partner_id', pb, 'share_percent', 100)), 'SUBMISSION_LINK', false, u) then raise exception 'automatic recording overwrote an existing record'; end if;
  if not public.referral_set_paper_shares(p1, jsonb_build_array(jsonb_build_object('partner_id', pa, 'share_percent', 50), jsonb_build_object('partner_id', pb, 'share_percent', 50)), 'ADMIN', true, u) then raise exception 'admin overwrite refused'; end if;
  select count(*) into n from public.referral_paper_attributions where paper_id = p1 and share_percent = 50; if n <> 2 then raise exception 'joint split not stored'; end if;
  begin perform public.referral_set_paper_shares(p2, jsonb_build_array(jsonb_build_object('partner_id', pa, 'share_percent', 60), jsonb_build_object('partner_id', pb, 'share_percent', 30)), 'ADMIN', true, u); raise exception 'total of 90 accepted';
  exception when raise_exception then if sqlerrm not like 'Shares must add up%' then raise; end if; end;
  begin perform public.referral_set_paper_shares(p2, jsonb_build_array(jsonb_build_object('partner_id', pa, 'share_percent', 50), jsonb_build_object('partner_id', pa, 'share_percent', 50)), 'ADMIN', true, u); raise exception 'duplicate partner accepted';
  exception when raise_exception then if sqlerrm not like 'A partner can appear only once' then raise; end if; end;
  begin perform public.referral_set_paper_shares(p2, jsonb_build_array(jsonb_build_object('partner_id', pa, 'share_percent', 0), jsonb_build_object('partner_id', pb, 'share_percent', 100)), 'ADMIN', true, u); raise exception 'zero share accepted';
  exception when raise_exception then if sqlerrm not like 'Every share must be above zero' then raise; end if; end;
  begin perform public.referral_set_paper_shares(p2, jsonb_build_array(jsonb_build_object('partner_id', gen_random_uuid(), 'share_percent', 100)), 'ADMIN', true, u); raise exception 'unknown partner accepted';
  exception when raise_exception then if sqlerrm not like 'Unknown partner' then raise; end if; end;
  begin perform public.referral_set_paper_shares(p2, jsonb_build_array(jsonb_build_object('partner_id', pa, 'share_percent', 100)), 'HACK', true, u); raise exception 'bad source accepted';
  exception when raise_exception then if sqlerrm not like 'Invalid attribution source' then raise; end if; end;
  begin perform public.referral_set_paper_shares(gen_random_uuid(), jsonb_build_array(jsonb_build_object('partner_id', pa, 'share_percent', 100)), 'ADMIN', true, u); raise exception 'unknown paper accepted';
  exception when raise_exception then if sqlerrm not like 'Paper not found' then raise; end if; end;
  select count(*) into n from public.referral_paper_attributions where paper_id = p2; if n <> 0 then raise exception 'a refused write left rows behind'; end if;
  begin insert into public.referral_paper_attributions(paper_id, partner_id, share_percent, source) values (p2, pa, 100.5, 'ADMIN'); raise exception 'share above 100 accepted';
  exception when check_violation then null; end;

  -- Stats count each partner's fractional credit and ignore deleted papers.
  insert into public.referral_user_attributions(user_id, partner_id, link_id) values (u, pa, la);
  begin insert into public.referral_user_attributions(user_id, partner_id, link_id) values (u, pb, la); raise exception 'second registration attribution accepted';
  exception when unique_violation then null; end;
  if (select credited from public.referral_partner_stats() where partner_id = pa) <> 0.5 then raise exception 'credit for a 50/50 article is not 0.5'; end if;
  update public.papers set deleted_at = now() where id = p1;
  if (select articles from public.referral_partner_stats() where partner_id = pa) <> 0 then raise exception 'deleted paper still counted'; end if;

  -- A partner who has history cannot be erased; erasing a paper (existing flow) removes its attribution and still works.
  begin delete from public.referral_partners where id = pa; raise exception 'partner with history deleted';
  exception when foreign_key_violation then null; end;
  perform public.admin_purge_paper(p1, u, 'referral test: erase with attribution attached');
  select count(*) into n from public.referral_paper_attributions where paper_id = p1; if n <> 0 then raise exception 'attribution survived the erase'; end if;

  -- Clean up this test's own rows.
  delete from public.referral_user_attributions where user_id = u;
  delete from public.papers where owner_id = u;
  delete from public.referral_links where partner_id in (pa, pb);
  delete from public.referral_partners where id in (pa, pb);
  delete from public.profiles where id = u;
  delete from auth.users where id = u;
end $$;
