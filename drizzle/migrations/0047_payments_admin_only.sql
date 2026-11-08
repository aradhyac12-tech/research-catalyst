-- Payments and the money history are for administrators only.
-- Before: any signed-in person could read their own payment rows straight from the database API, and founders held payments.read.
-- Now: only admin, super_admin and payment_admin can read payments. The app itself reads through the server (service role), so checkout is unaffected.
drop policy if exists "own payments or payments.read" on public.payments;
create policy "payments admins only" on public.payments for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'payment_admin'));
delete from public.role_permissions where role = 'founder' and permission_key = 'payments.read';
