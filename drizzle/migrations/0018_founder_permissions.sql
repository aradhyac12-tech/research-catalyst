-- Founder: can see users and payments, and can allow the editor and reviewer roles (enforced in server code).
-- No editorial, ethics, copyright, publication, settings, identity, board or audit permissions.
insert into public.role_permissions(role, permission_key) values
  ('founder','users.read'),('founder','payments.read')
on conflict do nothing;
