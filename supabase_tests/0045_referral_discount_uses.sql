-- 0045: referral discount uses. Run against a database where 0043, 0044 and 0045 are applied.
do $$
declare
  u uuid := gen_random_uuid(); pa uuid; la uuid; pid uuid; payid uuid; prod uuid; n int;
begin
  insert into auth.users(id, email) values (u, 'disc-user@t.test');
  insert into public.profiles(id, display_name, email) values (u, 'Disc User', 'disc-user@t.test') on conflict do nothing;
  insert into public.referral_partners(display_name) values ('Disc Partner') returning id into pa;
  insert into public.referral_links(partner_id, code, discount_minor) values (pa, 'D7XM92QF', 20000) returning id into la;
  insert into public.papers(owner_id, title) values (u, 'D1') returning id into pid;
  select id into prod from public.products limit 1;
  insert into public.payments(order_id, user_id, paper_id, product_id, amount_minor, currency, provider, method, idempotency_key)
    values ('ORD-DISC-1', u, pid, prod, 80000, 'INR', 'test', 'TEST', 'disc-1') returning id into payid;

  insert into public.referral_discount_uses(payment_id, user_id, paper_id, partner_id, link_id, amount_minor) values (payid, u, pid, pa, la, 20000);
  -- One use per payment; the amount must be above zero and within the ceiling.
  begin insert into public.referral_discount_uses(payment_id, user_id, partner_id, amount_minor) values (payid, u, pa, 100); raise exception 'second use for one payment accepted'; exception when unique_violation then null; end;
  begin update public.referral_discount_uses set amount_minor = 0 where payment_id = payid; raise exception 'zero amount accepted'; exception when check_violation then null; end;
  begin update public.referral_discount_uses set amount_minor = 100000001 where payment_id = payid; raise exception 'amount above the ceiling accepted'; exception when check_violation then null; end;

  -- Clients have no access at all.
  select count(*) into n from information_schema.role_table_grants where table_name = 'referral_discount_uses' and table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception 'a client role holds a grant on referral_discount_uses'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.referral_discount_uses'::regclass) then raise exception 'RLS is off'; end if;

  rollback;
end $$;
