-- 0046: run where 0043 to 0046 are applied. Two live fees of one person: only the first claim wins; a cancelled fee frees the discount.
do $$
declare u uuid := gen_random_uuid(); pa uuid; pid1 uuid; pid2 uuid; pay1 uuid; pay2 uuid; prod uuid;
begin
  insert into auth.users(id, email) values (u, 'claim@t.test');
  insert into public.profiles(id, display_name, email) values (u, 'Claim User', 'claim@t.test') on conflict do nothing;
  insert into public.referral_partners(display_name) values ('Claim Partner') returning id into pa;
  insert into public.papers(owner_id, title) values (u, 'C1') returning id into pid1;
  insert into public.papers(owner_id, title) values (u, 'C2') returning id into pid2;
  select id into prod from public.products limit 1;
  insert into public.payments(order_id, user_id, paper_id, product_id, amount_minor, currency, provider, method, idempotency_key) values ('ORD-CL-1', u, pid1, prod, 60000, 'INR', 'test', 'TEST', 'cl-1') returning id into pay1;
  insert into public.payments(order_id, user_id, paper_id, product_id, amount_minor, currency, provider, method, idempotency_key) values ('ORD-CL-2', u, pid2, prod, 60000, 'INR', 'test', 'TEST', 'cl-2') returning id into pay2;
  if not public.referral_claim_discount(pay1, u, pid1, pa, null, 20000) then raise exception 'first claim refused'; end if;
  if not public.referral_claim_discount(pay1, u, pid1, pa, null, 20000) then raise exception 'repeat claim for the same payment refused'; end if;
  if public.referral_claim_discount(pay2, u, pid2, pa, null, 20000) then raise exception 'second live fee also got the discount'; end if;
  update public.payments set status = 'CANCELLED' where id = pay1;
  if not public.referral_claim_discount(pay2, u, pid2, pa, null, 20000) then raise exception 'discount not freed by a cancelled fee'; end if;
  rollback;
end $$;
