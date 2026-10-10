-- email_outbox: private to the server, one row per dedupe_key, valid addresses and statuses only.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.email_outbox'::regclass) then raise exception 'RLS is off'; end if;
  if has_table_privilege('authenticated','public.email_outbox','select') or has_table_privilege('anon','public.email_outbox','select') then raise exception 'outbox readable by clients'; end if;
  insert into public.email_outbox(dedupe_key, kind, to_email, subject, text_body, html_body) values ('t:1','x','a@b.org','s','t','h');
  begin insert into public.email_outbox(dedupe_key, kind, to_email, subject, text_body, html_body) values ('t:1','x','a@b.org','s','t','h'); raise exception 'duplicate dedupe_key accepted';
  exception when unique_violation then null; end;
  begin insert into public.email_outbox(dedupe_key, kind, to_email, subject, text_body, html_body) values ('t:2','x','not-an-email','s','t','h'); raise exception 'bad address accepted';
  exception when check_violation then null; end;
  begin insert into public.email_outbox(dedupe_key, kind, to_email, subject, text_body, html_body, status) values ('t:3','x','a@b.org','s','t','h','BOGUS'); raise exception 'bad status accepted';
  exception when check_violation then null; end;
  delete from public.email_outbox where dedupe_key like 't:%';
end $$;
