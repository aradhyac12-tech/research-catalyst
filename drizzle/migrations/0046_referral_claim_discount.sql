-- 0046: makes "one link discount per person" safe when two checkouts happen at the same moment.
-- Additive: one new function; nothing existing is altered. The server calls it instead of inserting into referral_discount_uses directly.
-- It takes a per-person lock, refuses when another live fee of the same person already carries a discount, and otherwise records the use.
-- Returns true when the use is recorded (or already was for this payment), false when the person already has their discount elsewhere.
create or replace function public.referral_claim_discount(p_payment_id uuid, p_user_id uuid, p_paper_id uuid, p_partner_id uuid, p_link_id uuid, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('referral_discount:' || p_user_id::text));
  if exists (select 1 from public.referral_discount_uses where payment_id = p_payment_id) then return true; end if;
  if exists (
    select 1 from public.referral_discount_uses u join public.payments p on p.id = u.payment_id
    where u.user_id = p_user_id and u.payment_id <> p_payment_id
      and ((p.paper_id is distinct from p_paper_id and p.status::text in ('PAID','PROCESSING','REFUNDED','PENDING'))
        or (p.paper_id = p_paper_id and p.status::text in ('PAID','PROCESSING','REFUNDED')))
  ) then return false; end if;
  insert into public.referral_discount_uses (payment_id, user_id, paper_id, partner_id, link_id, amount_minor)
  values (p_payment_id, p_user_id, p_paper_id, p_partner_id, p_link_id, p_amount);
  return true;
end $$;
revoke all on function public.referral_claim_discount(uuid, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.referral_claim_discount(uuid, uuid, uuid, uuid, uuid, integer) to service_role;
