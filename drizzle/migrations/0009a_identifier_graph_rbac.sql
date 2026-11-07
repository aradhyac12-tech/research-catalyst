create table if not exists public.identifier_types (
  identifier_type text primary key,
  prefix text not null unique check (prefix ~ '^[A-Z]+$'),
  resource_type text not null,
  allocator text not null check (allocator in ('COUNTER', 'LEGACY_DEFAULT')),
  description text not null
);
insert into public.identifier_types(identifier_type, prefix, resource_type, allocator, description) values
  ('RESEARCHER',  'R',     'profiles',           'COUNTER',        'Researcher (legacy R-NNNNNN values stay valid; new ones are R-YYYY-NNNNNN)'),
  ('SUBMISSION',  'SUB',   'papers',             'COUNTER',        'Submission'),
  ('PAPER',       'PLY',   'papers',             'LEGACY_DEFAULT', 'Research object / paper (allocated by papers.paperly_id default)'),
  ('VERSION',     'VER',   'paper_versions',     'COUNTER',        'Manuscript version'),
  ('AI_RUN',      'AIRUN', 'ai_runs',            'COUNTER',        'AI screening run'),
  ('DECISION',    'DEC',   'decisions',          'COUNTER',        'Editorial decision'),
  ('REVIEW',      'REV',   'review_assignments', 'COUNTER',        'Peer review'),
  ('DOI_RECORD',  'DOI',   'doi_records',        'COUNTER',        'Internal DOI registration record (NOT a DOI)'),
  ('CERTIFICATE', 'CERT',  'certificates',       'LEGACY_DEFAULT', 'Certificate (allocated by certificates.certificate_id default)'),
  ('NOTICE',      'NOT',   'corrections',        'COUNTER',        'Correction / retraction / notice'),
  ('PAYMENT',     'PAY',   'payments',           'COUNTER',        'Payment')
on conflict (identifier_type) do nothing;

create table if not exists public.identifier_counters (
  identifier_type text not null references public.identifier_types(identifier_type),
  year int not null check (year between 2000 and 9999),
  last_value bigint not null default 0 check (last_value >= 0),
  primary key (identifier_type, year)
);

create or replace function public.reject_modification() returns trigger language plpgsql set search_path = public as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create or replace function public.counters_monotonic() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'identifier counters cannot be deleted'; end if;
  if new.last_value <= old.last_value then raise exception 'identifier counters can only increase'; end if;
  return new;
end $$;
drop trigger if exists identifier_counters_monotonic on public.identifier_counters;
create trigger identifier_counters_monotonic before update or delete on public.identifier_counters
  for each row execute function public.counters_monotonic();
drop trigger if exists identifier_counters_no_truncate on public.identifier_counters;
create trigger identifier_counters_no_truncate before truncate on public.identifier_counters
  for each statement execute function public.reject_modification();

create or replace function public.next_identifier(_type text, _at timestamptz default now())
returns text language plpgsql security definer set search_path = public as $$
declare t public.identifier_types%rowtype; y int; n bigint;
begin
  select * into t from public.identifier_types where identifier_type = _type;
  if not found then raise exception 'Unknown identifier type %', _type; end if;
  if t.allocator <> 'COUNTER' then raise exception 'Identifier type % is allocated by its table default', _type; end if;
  y := extract(year from (_at at time zone 'UTC'))::int;
  insert into public.identifier_counters(identifier_type, year, last_value) values (_type, y, 1)
    on conflict (identifier_type, year) do update set last_value = public.identifier_counters.last_value + 1
    returning last_value into n;
  if n > 999999 then raise exception 'Identifier space exhausted for % %', _type, y; end if;
  return t.prefix || '-' || y::text || '-' || lpad(n::text, 6, '0');
end $$;
revoke execute on function public.next_identifier(text, timestamptz) from public, anon, authenticated;
grant execute on function public.next_identifier(text, timestamptz) to service_role;

create table if not exists public.identifier_registry (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique check (identifier ~ '^[A-Z]+(-[0-9]{4})?-[0-9]{6}$'),
  identifier_type text not null references public.identifier_types(identifier_type),
  resource_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  unique (identifier_type, resource_id)
);
create index if not exists identifier_registry_resource_idx on public.identifier_registry(resource_type, resource_id);
create index if not exists identifier_registry_prefix_idx on public.identifier_registry(identifier text_pattern_ops);

create table if not exists public.identifier_aliases (
  alias text primary key,
  alias_kind text not null check (alias_kind in ('LEGACY_RP')),
  identifier_type text not null references public.identifier_types(identifier_type),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (identifier_type, resource_id) references public.identifier_registry(identifier_type, resource_id)
);

create or replace function public.registry_guard() returns trigger language plpgsql set search_path = public as $$
declare p text;
begin
  if tg_op <> 'INSERT' then raise exception '% is immutable', tg_table_name; end if;
  select prefix into p from public.identifier_types where identifier_type = new.identifier_type;
  if p is null or new.identifier not like p || '-%' then raise exception 'Identifier % does not match type %', new.identifier, new.identifier_type; end if;
  return new;
end $$;
drop trigger if exists identifier_registry_guard on public.identifier_registry;
create trigger identifier_registry_guard before insert or update or delete on public.identifier_registry
  for each row execute function public.registry_guard();
drop trigger if exists identifier_registry_no_truncate on public.identifier_registry;
create trigger identifier_registry_no_truncate before truncate on public.identifier_registry
  for each statement execute function public.reject_modification();
drop trigger if exists identifier_aliases_immutable on public.identifier_aliases;
create trigger identifier_aliases_immutable before update or delete on public.identifier_aliases
  for each row execute function public.reject_modification();

create or replace function public.register_identifier() returns trigger language plpgsql security definer set search_path = public as $$
declare code text := to_jsonb(new) ->> tg_argv[1];
begin
  insert into public.identifier_registry(identifier, identifier_type, resource_type, resource_id)
  values (code, tg_argv[0], tg_table_name, new.id);
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, new_value)
  values (auth.uid(), case when auth.uid() is null then 'SYSTEM' else 'USER' end, 'IDENTIFIER_ISSUED', tg_argv[0], code,
          jsonb_build_object('resource_type', tg_table_name, 'resource_id', new.id));
  return new;
end $$;
create or replace function public.guard_identifier_immutable() returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
    raise exception '% is immutable and cannot be reassigned', tg_argv[0];
  end if;
  return new;
end $$;
create or replace function public.register_legacy_alias() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.identifier_aliases(alias, alias_kind, identifier_type, resource_id) values (new.public_id, 'LEGACY_RP', 'PAPER', new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function public.register_identifier() from public, anon, authenticated;
revoke execute on function public.register_legacy_alias() from public, anon, authenticated;

do $$
declare spec record; r record; pfx text;
begin
  for spec in select * from (values
    ('papers',             'submission_id',   'SUBMISSION', 'created_at'),
    ('paper_versions',     'version_code',    'VERSION',    'uploaded_at'),
    ('ai_runs',            'ai_run_code',     'AI_RUN',     'started_at'),
    ('decisions',          'decision_code',   'DECISION',   'created_at'),
    ('review_assignments', 'review_code',     'REVIEW',     'assigned_at'),
    ('doi_records',        'doi_record_code', 'DOI_RECORD', 'updated_at'),
    ('corrections',        'notice_code',     'NOTICE',     'issued_at'),
    ('payments',           'payment_code',    'PAYMENT',    'created_at')
  ) as v(tbl, col, typ, ts) loop
    select prefix into pfx from public.identifier_types where identifier_type = spec.typ;
    execute format('alter table public.%I add column if not exists %I text', spec.tbl, spec.col);
    execute format('alter table public.%I disable trigger user', spec.tbl);
    for r in execute format('select id, %I as ts from public.%I where %I is null order by %I, id', spec.ts, spec.tbl, spec.col, spec.ts) loop
      execute format('update public.%I set %I = $1 where id = $2', spec.tbl, spec.col) using public.next_identifier(spec.typ, r.ts), r.id;
    end loop;
    execute format('alter table public.%I enable trigger user', spec.tbl);
    execute format('alter table public.%I alter column %I set default public.next_identifier(%L)', spec.tbl, spec.col, spec.typ);
    execute format('alter table public.%I alter column %I set not null', spec.tbl, spec.col);
    execute format('create unique index if not exists %I on public.%I(%I)', spec.tbl || '_' || spec.col || '_key', spec.tbl, spec.col);
    execute format('alter table public.%I drop constraint if exists %I', spec.tbl, spec.tbl || '_' || spec.col || '_format');
    execute format('alter table public.%I add constraint %I check (%I ~ %L)', spec.tbl, spec.tbl || '_' || spec.col || '_format', spec.col, '^' || pfx || '-[0-9]{4}-[0-9]{6}$');
  end loop;
end $$;

alter table public.profiles alter column researcher_id set default public.next_identifier('RESEARCHER');

do $$
declare spec record; n bigint;
begin
  for spec in select * from (values
    ('profiles',           'RESEARCHER',  'researcher_id'),
    ('papers',             'PAPER',       'paperly_id'),
    ('papers',             'SUBMISSION',  'submission_id'),
    ('paper_versions',     'VERSION',     'version_code'),
    ('ai_runs',            'AI_RUN',      'ai_run_code'),
    ('decisions',          'DECISION',    'decision_code'),
    ('review_assignments', 'REVIEW',      'review_code'),
    ('doi_records',        'DOI_RECORD',  'doi_record_code'),
    ('certificates',       'CERTIFICATE', 'certificate_id'),
    ('corrections',        'NOTICE',      'notice_code'),
    ('payments',           'PAYMENT',     'payment_code')
  ) as v(tbl, typ, col) loop
    execute format('insert into public.identifier_registry(identifier, identifier_type, resource_type, resource_id) select %I, %L, %L, id from public.%I on conflict (identifier_type, resource_id) do nothing',
                   spec.col, spec.typ, spec.tbl, spec.tbl);
    get diagnostics n = row_count;
    insert into public.audit_logs(actor_type, action, resource_type, resource_id, new_value)
      values ('SYSTEM', 'IDENTIFIER_BACKFILL', spec.typ, null, jsonb_build_object('table', spec.tbl, 'registered', n));
    execute format('drop trigger if exists %I on public.%I', 'zz_register_' || spec.col, spec.tbl);
    execute format('create trigger %I after insert on public.%I for each row execute function public.register_identifier(%L, %L)', 'zz_register_' || spec.col, spec.tbl, spec.typ, spec.col);
    execute format('drop trigger if exists %I on public.%I', 'zz_immutable_' || spec.col, spec.tbl);
    execute format('create trigger %I before update on public.%I for each row execute function public.guard_identifier_immutable(%L)', 'zz_immutable_' || spec.col, spec.tbl, spec.col);
  end loop;
end $$;

insert into public.identifier_aliases(alias, alias_kind, identifier_type, resource_id)
  select public_id, 'LEGACY_RP', 'PAPER', id from public.papers on conflict do nothing;
drop trigger if exists zz_register_public_id_alias on public.papers;
create trigger zz_register_public_id_alias after insert on public.papers for each row execute function public.register_legacy_alias();

create table if not exists public.scholarly_relationships (
  id uuid primary key default gen_random_uuid(),
  relationship_type text not null check (relationship_type in
    ('PREPRINT_OF','CORRECTION_OF','RETRACTION_OF','NEW_VERSION_OF','HAS_DATASET','HAS_SOFTWARE','RELATED_WORK')),
  from_identifier text not null references public.identifier_registry(identifier),
  to_identifier text references public.identifier_registry(identifier),
  to_external text check (to_external is null or length(trim(to_external)) between 3 and 500),
  to_external_kind text check (to_external_kind in ('DOI','URL','ARXIV','OTHER')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint rel_one_target check (num_nonnulls(to_identifier, to_external) = 1),
  constraint rel_external_kind check ((to_external is null) = (to_external_kind is null)),
  constraint rel_not_self check (to_identifier is null or from_identifier <> to_identifier)
);
create unique index if not exists scholarly_relationships_unique on public.scholarly_relationships(from_identifier, relationship_type, coalesce(to_identifier, to_external));
create unique index if not exists scholarly_relationships_one_preprint_target on public.scholarly_relationships(from_identifier) where relationship_type = 'PREPRINT_OF';
create unique index if not exists scholarly_relationships_one_previous_version on public.scholarly_relationships(from_identifier) where relationship_type = 'NEW_VERSION_OF';
create index if not exists scholarly_relationships_to_idx on public.scholarly_relationships(to_identifier);

create or replace function public.relationship_endpoints_ok() returns trigger language plpgsql set search_path = public as $$
declare ft text; tt text;
begin
  select identifier_type into ft from public.identifier_registry where identifier = new.from_identifier;
  if new.to_identifier is not null then select identifier_type into tt from public.identifier_registry where identifier = new.to_identifier; end if;
  if new.relationship_type = 'PREPRINT_OF' and not (ft = 'PAPER' and tt = 'PAPER') then raise exception 'PREPRINT_OF links a paper to a paper'; end if;
  if new.relationship_type in ('CORRECTION_OF','RETRACTION_OF') and not (ft in ('NOTICE','PAPER') and tt = 'PAPER') then raise exception '% links a notice (or correction paper) to the original paper', new.relationship_type; end if;
  if new.relationship_type = 'NEW_VERSION_OF' and not (ft = 'VERSION' and tt = 'VERSION') then raise exception 'NEW_VERSION_OF links a version to its previous version'; end if;
  if new.relationship_type in ('HAS_DATASET','HAS_SOFTWARE','RELATED_WORK') and ft <> 'PAPER' then raise exception '% must start at a paper', new.relationship_type; end if;
  return new;
end $$;
drop trigger if exists scholarly_relationships_endpoints on public.scholarly_relationships;
create trigger scholarly_relationships_endpoints before insert on public.scholarly_relationships for each row execute function public.relationship_endpoints_ok();
drop trigger if exists scholarly_relationships_append_only on public.scholarly_relationships;
create trigger scholarly_relationships_append_only before update or delete on public.scholarly_relationships for each row execute function public.reject_modification();
drop trigger if exists scholarly_relationships_no_truncate on public.scholarly_relationships;
create trigger scholarly_relationships_no_truncate before truncate on public.scholarly_relationships for each statement execute function public.reject_modification();

create table if not exists public.permissions (
  permission_key text primary key check (permission_key ~ '^[a-z]+(\.[a-z]+)+$'),
  category text not null,
  description text not null,
  sensitive boolean not null default false
);
create table if not exists public.role_permissions (
  role public.app_role not null,
  permission_key text not null references public.permissions(permission_key) on delete restrict,
  granted_at timestamptz not null default now(),
  primary key (role, permission_key)
);
create index if not exists role_permissions_permission_idx on public.role_permissions(permission_key);

insert into public.permissions(permission_key, category, description, sensitive) values
  ('papers.read','papers','Read any manuscript record',false),
  ('papers.read.own','papers','Read own manuscripts',false),
  ('papers.create','papers','Create a manuscript',false),
  ('papers.edit','papers','Edit any manuscript record',false),
  ('papers.edit.own','papers','Edit own manuscripts',false),
  ('papers.decide','papers','Record an editorial decision',true),
  ('papers.publish','papers','Publish an accepted manuscript',true),
  ('submissions.create','papers','Create a submission',false),
  ('reviews.assign','reviews','Assign reviewers',false),
  ('reviews.read','reviews','Read peer-review reports',true),
  ('reviews.read.assigned','reviews','Read assigned review tasks',false),
  ('reviews.create','reviews','Submit a review',false),
  ('reviews.edit.own','reviews','Edit own draft review',false),
  ('reviews.manage','reviews','Manage review rounds',false),
  ('users.read','users','Read user accounts',false),
  ('users.manage','users','Manage user accounts and non-privileged roles',true),
  ('roles.manage','users','Grant or revoke privileged roles and edit role permissions',true),
  ('payments.read','payments','Read payment records',true),
  ('payments.refund','payments','Refund a payment',true),
  ('doi.read','doi','Read DOI records',false),
  ('doi.register','doi','Register a DOI',true),
  ('doi.update','doi','Update DOI metadata',true),
  ('doi.retry','doi','Retry a failed DOI registration',false),
  ('ai.read','ai','Read AI screening runs',false),
  ('ai.policy.read','ai','Read AI policies',false),
  ('ai.policy.create','ai','Create AI policies',false),
  ('ai.policy.update','ai','Edit draft AI policies',false),
  ('ai.policy.activate','ai','Activate or roll back AI policies',true),
  ('ai.model.configure','ai','Configure AI models and providers',true),
  ('journal.read','journal','Read journal identity and board settings',false),
  ('journal.edit','journal','Edit journal identity',true),
  ('board.manage','journal','Manage editorial board',false),
  ('audit.read','audit','Read the full audit log',true),
  ('audit.read.relevant','audit','Read audit events for papers the user handles',false),
  ('audit.export','audit','Export the audit log',true),
  ('certificates.read','certificates','Read certificates',false),
  ('certificates.read.own','certificates','Read own certificates',false),
  ('certificates.issue','certificates','Issue certificates',true),
  ('certificates.revoke','certificates','Revoke certificates',true),
  ('notices.read','notices','Read publication notices',false),
  ('notices.create','notices','Issue corrections / expressions of concern',true),
  ('notices.retract','notices','Issue retractions',true),
  ('ethics.read','ethics','Read ethics declarations',false),
  ('ethics.decide','ethics','Record ethics clearance',true),
  ('copyright.read','copyright','Read copyright complaints',false),
  ('copyright.decide','copyright','Resolve copyright complaints',true),
  ('security.read','security','Read security findings',false),
  ('security.manage','security','Manage security settings',true),
  ('system.configure','system','Change system configuration',true)
on conflict (permission_key) do nothing;

insert into public.role_permissions(role, permission_key) values
  ('researcher','papers.read.own'),('researcher','papers.create'),('researcher','papers.edit.own'),('researcher','submissions.create'),('researcher','certificates.read.own'),
  ('reviewer','reviews.read.assigned'),('reviewer','reviews.create'),('reviewer','reviews.edit.own'),
  ('editor','papers.read'),('editor','papers.edit'),('editor','papers.decide'),('editor','reviews.assign'),('editor','reviews.read'),('editor','reviews.manage'),
  ('editor','ai.read'),('editor','ai.policy.read'),('editor','audit.read.relevant'),('editor','certificates.read'),('editor','notices.read'),('editor','doi.read'),('editor','journal.read'),
  ('payment_admin','payments.read'),('payment_admin','payments.refund'),
  ('ethics_reviewer','papers.read'),('ethics_reviewer','ethics.read'),('ethics_reviewer','ethics.decide'),
  ('copyright_reviewer','papers.read'),('copyright_reviewer','copyright.read'),('copyright_reviewer','copyright.decide'),
  ('admin','papers.read'),('admin','papers.edit'),('admin','papers.decide'),('admin','papers.publish'),
  ('admin','reviews.assign'),('admin','reviews.read'),('admin','reviews.manage'),
  ('admin','users.read'),('admin','users.manage'),
  ('admin','doi.read'),('admin','doi.register'),('admin','doi.update'),('admin','doi.retry'),
  ('admin','ai.read'),('admin','ai.policy.read'),('admin','ai.policy.create'),('admin','ai.policy.update'),('admin','ai.policy.activate'),
  ('admin','journal.read'),('admin','journal.edit'),('admin','board.manage'),
  ('admin','audit.read'),('admin','certificates.read'),('admin','certificates.issue'),('admin','certificates.revoke'),
  ('admin','notices.read'),('admin','notices.create'),('admin','notices.retract'),
  ('admin','ethics.read'),('admin','copyright.read'),('admin','security.read')
on conflict do nothing;
insert into public.role_permissions(role, permission_key) select 'super_admin', permission_key from public.permissions on conflict do nothing;

create or replace function public.has_permission(_user_id uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role = ur.role
                 where ur.user_id = _user_id and rp.permission_key = _permission)
$$;
create or replace function public.user_permissions(_user_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select distinct rp.permission_key from public.user_roles ur join public.role_permissions rp on rp.role = ur.role where ur.user_id = _user_id
$$;
revoke execute on function public.has_permission(uuid, text) from public, anon;
revoke execute on function public.user_permissions(uuid) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.user_permissions(uuid) to authenticated, service_role;

create or replace function public.audit_role_change() returns trigger language plpgsql security definer set search_path = public as $$
declare r public.user_roles%rowtype;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, new_value, metadata)
  values (coalesce(auth.uid(), r.granted_by), case when coalesce(auth.uid(), r.granted_by) is null then 'SYSTEM' else 'USER' end,
          case when tg_op = 'DELETE' then 'ROLE_REVOKED' else 'ROLE_GRANTED' end, 'user', r.user_id::text,
          jsonb_build_object('role', r.role), jsonb_build_object('granted_by', r.granted_by));
  return r;
end $$;
drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit after insert or delete on public.user_roles for each row execute function public.audit_role_change();

create or replace function public.audit_permission_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'role_permissions' then
    insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id, new_value)
    values (auth.uid(), case when auth.uid() is null then 'SYSTEM' else 'USER' end,
            case when tg_op = 'DELETE' then 'ROLE_PERMISSION_REVOKED' else 'ROLE_PERMISSION_GRANTED' end, 'role',
            (case when tg_op = 'DELETE' then old.role else new.role end)::text,
            jsonb_build_object('permission', case when tg_op = 'DELETE' then old.permission_key else new.permission_key end));
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  insert into public.audit_logs(actor_id, actor_type, action, resource_type, resource_id)
  values (auth.uid(), case when auth.uid() is null then 'SYSTEM' else 'USER' end,
          case when tg_op = 'DELETE' then 'PERMISSION_REMOVED' else 'PERMISSION_DEFINED' end, 'permission',
          case when tg_op = 'DELETE' then old.permission_key else new.permission_key end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists role_permissions_audit on public.role_permissions;
create trigger role_permissions_audit after insert or delete on public.role_permissions for each row execute function public.audit_permission_change();
drop trigger if exists permissions_audit on public.permissions;
create trigger permissions_audit after insert or delete on public.permissions for each row execute function public.audit_permission_change();
revoke execute on function public.audit_role_change() from public, anon, authenticated;
revoke execute on function public.audit_permission_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['identifier_types','identifier_counters','identifier_registry','identifier_aliases','scholarly_relationships','permissions','role_permissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.identifier_types, public.identifier_registry, public.scholarly_relationships, public.permissions, public.role_permissions to authenticated;

drop policy if exists "types readable" on public.identifier_types;
create policy "types readable" on public.identifier_types for select to authenticated using (true);
drop policy if exists "registry by permission" on public.identifier_registry;
create policy "registry by permission" on public.identifier_registry for select to authenticated using (
  case identifier_type
    when 'PAYMENT'     then public.has_permission(auth.uid(), 'payments.read')
    when 'AI_RUN'      then public.has_permission(auth.uid(), 'ai.read')
    when 'DOI_RECORD'  then public.has_permission(auth.uid(), 'doi.read')
    when 'CERTIFICATE' then public.has_permission(auth.uid(), 'certificates.read')
    when 'NOTICE'      then public.has_permission(auth.uid(), 'notices.read')
    when 'REVIEW'      then public.has_permission(auth.uid(), 'reviews.read')
    when 'RESEARCHER'  then public.has_permission(auth.uid(), 'users.read')
    else public.has_permission(auth.uid(), 'papers.read')
  end);
drop policy if exists "relationships readable by paper readers" on public.scholarly_relationships;
create policy "relationships readable by paper readers" on public.scholarly_relationships for select to authenticated using (public.has_permission(auth.uid(), 'papers.read'));
drop policy if exists "permissions readable by user admins" on public.permissions;
create policy "permissions readable by user admins" on public.permissions for select to authenticated
  using (public.has_permission(auth.uid(), 'users.read') or public.has_permission(auth.uid(), 'roles.manage'));
drop policy if exists "role permissions readable by user admins" on public.role_permissions;
create policy "role permissions readable by user admins" on public.role_permissions for select to authenticated
  using (public.has_permission(auth.uid(), 'users.read') or public.has_permission(auth.uid(), 'roles.manage'));

drop policy if exists "own payments or staff" on public.payments;
drop policy if exists "own payments or payments.read" on public.payments;
create policy "own payments or payments.read" on public.payments for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'payments.read'));
drop policy if exists "staff read payment events" on public.payment_events;
drop policy if exists "payment events by permission" on public.payment_events;
create policy "payment events by permission" on public.payment_events for select to authenticated
  using (public.has_permission(auth.uid(), 'payments.read'));
drop policy if exists "admins read audit" on public.audit_logs;
drop policy if exists "audit by permission" on public.audit_logs;
create policy "audit by permission" on public.audit_logs for select to authenticated using (public.has_permission(auth.uid(), 'audit.read'));
drop policy if exists "own roles or staff" on public.user_roles;
drop policy if exists "own roles or users.read" on public.user_roles;
create policy "own roles or users.read" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission(auth.uid(), 'users.read'));
