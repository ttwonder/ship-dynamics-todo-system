begin;

-- Auth/Edge orchestration. Requires pgcrypto installed in the `extensions`
-- schema in real Supabase. PGlite tests provide contract-compatible mocks.
do $$
begin
  if to_regprocedure('extensions.crypt(text,text)') is null
     or to_regprocedure('extensions.gen_salt(text,integer)') is null then
    raise exception 'pgcrypto-required';
  end if;
end;
$$;

create table public.sd_rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, key_hash),
  constraint sd_rate_limit_scope_not_blank check (btrim(scope) <> ''),
  constraint sd_rate_limit_hash_not_blank check (btrim(key_hash) <> '')
);
revoke all on table public.sd_rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_ship_dynamics_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket public.sd_rate_limit_buckets%rowtype;
  v_allowed boolean;
  v_retry integer;
begin
  if p_scope is null or btrim(p_scope) = ''
     or p_key_hash is null or btrim(p_key_hash) = ''
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception using errcode = 'P0001', message = 'invalid-rate-limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_key_hash, 0));
  select * into v_bucket
  from public.sd_rate_limit_buckets b
  where b.scope = p_scope and b.key_hash = p_key_hash
  for update;
  if not found or v_bucket.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    insert into public.sd_rate_limit_buckets(scope, key_hash, window_started_at, hit_count, updated_at)
    values (p_scope, p_key_hash, v_now, 1, v_now)
    on conflict (scope, key_hash) do update
      set window_started_at = excluded.window_started_at,
          hit_count = 1,
          updated_at = excluded.updated_at
    returning * into v_bucket;
  else
    update public.sd_rate_limit_buckets b
    set hit_count = b.hit_count + 1,
        updated_at = v_now
    where b.scope = p_scope and b.key_hash = p_key_hash
    returning * into v_bucket;
  end if;
  v_allowed := v_bucket.hit_count <= p_limit;
  v_retry := greatest(0, ceil(extract(epoch from (
    v_bucket.window_started_at + make_interval(secs => p_window_seconds) - v_now
  )))::integer);
  return jsonb_build_object(
    'allowed', v_allowed,
    'remaining', greatest(0, p_limit - v_bucket.hit_count),
    'retryAfterSeconds', case when v_allowed then 0 else v_retry end
  );
end;
$$;
revoke all on function public.consume_ship_dynamics_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_ship_dynamics_rate_limit(text,text,integer,integer) to service_role;

create table public.sd_login_options (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  department text not null,
  username_label text not null,
  display_name text not null,
  auth_alias text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, user_id),
  constraint sd_login_department_not_blank check (btrim(department) <> ''),
  constraint sd_login_username_not_blank check (btrim(username_label) <> ''),
  constraint sd_login_display_not_blank check (btrim(display_name) <> ''),
  constraint sd_login_alias_not_blank check (btrim(auth_alias) <> '')
);
create unique index sd_login_option_identity_unique
  on public.sd_login_options(
    workspace_id,
    lower(btrim(department)),
    lower(btrim(username_label))
  ) where is_active;
create unique index sd_login_option_alias_unique
  on public.sd_login_options(lower(auth_alias)) where is_active;
revoke all on table public.sd_login_options from public, anon, authenticated;

alter table public.sd_operations
  drop constraint if exists sd_operations_status_check,
  drop constraint if exists sd_operations_outcome_complete,
  alter column completed_at drop not null,
  add column if not exists external_effect jsonb not null default '{}'::jsonb;
alter table public.sd_operations
  add constraint sd_operations_status_check
    check (status in ('prepared','recovery_required','committed','rejected')),
  add constraint sd_operations_outcome_complete check (
    (status = 'committed' and result is not null and error_code is null and completed_at is not null)
    or (status = 'rejected' and result is null and error_code is not null and completed_at is not null)
    or (status = 'prepared' and result is null and error_code is null and completed_at is null)
    or (status = 'recovery_required' and result is null and error_code is not null and completed_at is null)
  );

create or replace function public.sd_user_operation_row(
  p_workspace_id uuid,
  p_operation_id uuid
)
returns public.sd_operations
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select o from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
    and o.actor_id = auth.uid()
$$;
revoke all on function public.sd_user_operation_row(uuid,uuid) from public, anon;
grant execute on function public.sd_user_operation_row(uuid,uuid) to authenticated;

create or replace function public.begin_ship_dynamics_user_operation(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_action text,
  p_target_user_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_operation public.sd_operations%rowtype;
  v_command text := 'manage_user:' || coalesce(p_action, '');
  v_target text := 'user:' || coalesce(p_target_user_id::text, 'new');
begin
  if v_actor is null or p_action not in ('create','disable','reset-password','change-role','transfer-owner')
     or p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_operation_id::text, 0));
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id and o.operation_id = p_operation_id
  for update;
  if found then
    if v_operation.actor_id <> v_actor
       or v_operation.command <> v_command
       or v_operation.target_key <> v_target
       or v_operation.request_payload <> p_request then
      raise exception using errcode = 'P0001', message = 'operation-mismatch';
    end if;
    return jsonb_build_object(
      'status', v_operation.status,
      'result', v_operation.result,
      'authUserId', nullif(v_operation.external_effect ->> 'authUserId', '')
    );
  end if;
  if public.sd_membership_role(p_workspace_id) <> 'owner' then
    raise exception using errcode = 'P0001', message = 'owner-required';
  end if;
  insert into public.sd_operations(
    workspace_id, operation_id, actor_id, command, target_key,
    request_payload, request_hash, status, result, error_code, completed_at
  ) values (
    p_workspace_id, p_operation_id, v_actor, v_command, v_target,
    p_request, md5(p_request::text), 'prepared', null, null, null
  );
  return jsonb_build_object('status','prepared','result',null,'authUserId',null);
end;
$$;

create or replace function public.mark_ship_dynamics_user_operation_effect(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.sd_operations%rowtype;
begin
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
    and o.actor_id = auth.uid()
  for update;
  if not found or v_operation.status in ('committed','rejected') then
    raise exception using errcode = 'P0001', message = 'operation-not-pending';
  end if;
  if v_operation.external_effect ? 'authUserId'
     and (v_operation.external_effect ->> 'authUserId')::uuid <> p_auth_user_id then
    raise exception using errcode = 'P0001', message = 'operation-effect-mismatch';
  end if;
  update public.sd_operations o
  set external_effect = jsonb_build_object('authUserId', p_auth_user_id),
      status = 'prepared', error_code = null
  where o.workspace_id = p_workspace_id and o.operation_id = p_operation_id;
  return jsonb_build_object('status','prepared','authUserId',p_auth_user_id);
end;
$$;

create or replace function public.mark_ship_dynamics_user_operation_recovery_required(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.sd_operations o
  set status = 'recovery_required',
      error_code = coalesce(nullif(btrim(p_error_code),''),'operation-recovery-required'),
      completed_at = null
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
    and o.actor_id = auth.uid()
    and o.status in ('prepared','recovery_required');
  if not found then raise exception using errcode='P0001', message='operation-not-pending'; end if;
  return true;
end;
$$;

create or replace function public.reject_ship_dynamics_user_operation(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.sd_operations o
  set status = 'rejected',
      error_code = coalesce(nullif(btrim(p_error_code),''),'operation-rejected'),
      completed_at = clock_timestamp()
  where o.workspace_id = p_workspace_id
    and o.operation_id = p_operation_id
    and o.actor_id = auth.uid()
    and o.status = 'prepared'
    and o.external_effect = '{}'::jsonb;
  if not found then raise exception using errcode='P0001', message='operation-cannot-reject'; end if;
  return true;
end;
$$;

create or replace function public.complete_ship_dynamics_user_operation(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.sd_operations%rowtype;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception using errcode='P0001', message='invalid-operation-result';
  end if;
  select * into v_operation
  from public.sd_operations o
  where o.workspace_id=p_workspace_id
    and o.operation_id=p_operation_id
    and o.actor_id=auth.uid()
  for update;
  if not found then raise exception using errcode='P0001', message='operation-not-found'; end if;
  if v_operation.status='committed' then return v_operation.result; end if;
  if v_operation.status='rejected' then raise exception using errcode='P0001', message='operation-rejected'; end if;
  if v_operation.command in ('manage_user:create','manage_user:disable','manage_user:reset-password')
     and not (v_operation.external_effect ? 'authUserId') then
    raise exception using errcode='P0001', message='operation-effect-required';
  end if;
  update public.sd_operations o
  set status='committed', result=p_result, error_code=null, completed_at=clock_timestamp()
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id;
  insert into public.sd_audit_events(
    workspace_id,id,actor_id,command,entity_type,entity_id,detail
  ) values (
    p_workspace_id, public.sd_core_event_id(p_operation_id,'audit'), auth.uid(),
    v_operation.command, 'user', replace(v_operation.target_key,'user:',''), p_result
  ) on conflict do nothing;
  return p_result;
end;
$$;

create or replace function public.provision_ship_dynamics_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_username_label text,
  p_department text,
  p_role text,
  p_auth_alias text,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation public.sd_operations%rowtype;
begin
  select * into v_operation from public.sd_operations o
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id
    and o.actor_id=auth.uid() and o.command='manage_user:create'
  for update;
  if not found or v_operation.status not in ('prepared','recovery_required')
     or (v_operation.external_effect->>'authUserId')::uuid <> p_user_id
     or p_role not in ('admin','operator','vessel') then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_user_id) then
    raise exception using errcode='P0001', message='auth-user-missing';
  end if;
  insert into public.sd_profiles(id,display_name,username_label)
  values(p_user_id,btrim(p_display_name),btrim(p_username_label))
  on conflict(id) do update set
    display_name=excluded.display_name,
    username_label=excluded.username_label,
    updated_at=clock_timestamp();
  insert into public.sd_memberships(
    workspace_id,user_id,department,role,is_active,updated_by
  ) values (
    p_workspace_id,p_user_id,btrim(p_department),p_role,true,auth.uid()
  ) on conflict(workspace_id,user_id) do update set
    department=excluded.department,role=excluded.role,is_active=true,
    version=public.sd_memberships.version+1,
    updated_at=clock_timestamp(),updated_by=auth.uid();
  insert into public.sd_login_options(
    workspace_id,user_id,department,username_label,display_name,auth_alias,is_active
  ) values (
    p_workspace_id,p_user_id,btrim(p_department),btrim(p_username_label),
    btrim(p_display_name),lower(btrim(p_auth_alias)),true
  ) on conflict(workspace_id,user_id) do update set
    department=excluded.department,username_label=excluded.username_label,
    display_name=excluded.display_name,auth_alias=excluded.auth_alias,
    is_active=true,updated_at=clock_timestamp();
  return true;
end;
$$;

create or replace function public.disable_ship_dynamics_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.sd_membership_role(p_workspace_id) <> 'owner'
     or exists(select 1 from public.sd_memberships m where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.role='owner')
     or not exists(select 1 from public.sd_operations o where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id and o.actor_id=auth.uid() and o.command='manage_user:disable' and o.status in ('prepared','recovery_required')) then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  update public.sd_memberships m
  set is_active=false,version=m.version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.is_active;
  update public.sd_login_options l set is_active=false,updated_at=clock_timestamp()
  where l.workspace_id=p_workspace_id and l.user_id=p_user_id and l.is_active;
  return true;
end;
$$;

create or replace function public.change_ship_dynamics_user_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text,
  p_operation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.sd_membership_role(p_workspace_id) <> 'owner'
     or p_role not in ('admin','operator','vessel')
     or exists(select 1 from public.sd_memberships m where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.role='owner')
     or not exists(select 1 from public.sd_operations o where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id and o.actor_id=auth.uid() and o.command='manage_user:change-role' and o.status in ('prepared','recovery_required')) then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  update public.sd_memberships m
  set role=p_role,version=m.version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.is_active;
  if not found then raise exception using errcode='P0001', message='target-inactive'; end if;
  return true;
end;
$$;

create or replace function public.transfer_ship_dynamics_owner(
  p_workspace_id uuid,
  p_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid:=auth.uid();
  v_operation public.sd_operations%rowtype;
  v_actor_role text;
  v_target_role text;
begin
  select * into v_operation from public.sd_operations o
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id
    and o.actor_id=v_actor and o.command='manage_user:transfer-owner'
    and o.status in ('prepared','recovery_required') for update;
  if not found then raise exception using errcode='P0001', message='not-authorized'; end if;
  select role into v_actor_role from public.sd_memberships where workspace_id=p_workspace_id and user_id=v_actor and is_active for update;
  select role into v_target_role from public.sd_memberships where workspace_id=p_workspace_id and user_id=p_user_id and is_active for update;
  if v_target_role is null then raise exception using errcode='P0001', message='target-inactive'; end if;
  if v_actor_role='owner' then
    update public.sd_memberships set role='admin',version=version+1,updated_at=clock_timestamp(),updated_by=v_actor
      where workspace_id=p_workspace_id and user_id=v_actor;
    update public.sd_memberships set role='owner',version=version+1,updated_at=clock_timestamp(),updated_by=v_actor
      where workspace_id=p_workspace_id and user_id=p_user_id;
  elsif not (v_actor_role='admin' and v_target_role='owner') then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  return jsonb_build_object('previousOwnerId',v_actor,'ownerId',p_user_id);
end;
$$;

-- Site gate hashes are server-only. Legacy SHA-256 remains readable only so an
-- existing site can rotate without plaintext recovery; all new writes are bcrypt.
alter table public.sd_public_site_gate drop constraint if exists sd_public_site_gate_sha256;
alter table public.sd_public_site_gate
  add constraint sd_public_site_gate_hash_format check (
    password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'
    or password_hash ~ '^[0-9a-f]{64}$'
  );

create or replace function public.verify_ship_dynamics_site_password(
  p_workspace_key text,
  p_password text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
begin
  if p_password is null or length(p_password)>256 then return false; end if;
  select g.password_hash into v_hash
  from public.sd_public_site_gate g
  join public.sd_workspaces w on w.id=g.workspace_id
  where w.legacy_key=p_workspace_key and w.is_active;
  if not found then return false; end if;
  if v_hash ~ '^[0-9a-f]{64}$' then
    return v_hash = encode(sha256(convert_to(p_password,'UTF8')),'hex');
  end if;
  return v_hash = extensions.crypt(p_password,v_hash);
end;
$$;
revoke all on function public.verify_ship_dynamics_site_password(text,text) from public, anon, authenticated;
grant execute on function public.verify_ship_dynamics_site_password(text,text) to service_role;

drop function public.command_ship_dynamics_update_site_gate(uuid,uuid,bigint,text,uuid,bigint,text);

create function public.command_ship_dynamics_update_site_gate(
  p_operation_id uuid,
  p_workspace_id uuid,
  p_base_version bigint,
  p_lease_key text,
  p_owner_session uuid,
  p_fencing_token bigint,
  p_password text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid:=auth.uid();
  v_gate public.sd_public_site_gate%rowtype;
  v_operation public.sd_operations%rowtype;
  v_password_hash text;
  v_request jsonb;
  v_result jsonb;
  v_version bigint;
begin
  if v_actor is null or public.sd_membership_role(p_workspace_id)<>'owner'
     or p_lease_key<>'settings:site-gate' or length(p_password)<12 or length(p_password)>256 then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  v_request:=jsonb_build_object(
    'baseVersion',p_base_version,'leaseKey',p_lease_key,
    'ownerSession',p_owner_session,'fencingToken',p_fencing_token
  );
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_operation_id::text,0));
  select * into v_operation from public.sd_operations o
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id for update;
  if found then
    if v_operation.actor_id<>v_actor or v_operation.command<>'update_site_gate'
       or v_operation.target_key<>'settings:site-gate'
       or (v_operation.request_payload - 'credentialHash')<>v_request
       or not (v_operation.request_payload ? 'credentialHash')
       or extensions.crypt(p_password,v_operation.request_payload->>'credentialHash')
          <> v_operation.request_payload->>'credentialHash' then
      raise exception using errcode='P0001', message='operation-mismatch';
    end if;
    if v_operation.status='committed' then
      return v_operation.result||jsonb_build_object('replayed',true);
    end if;
    raise exception using errcode='P0001', message=coalesce(v_operation.error_code,'operation-rejected');
  end if;
  perform public.sd_assert_live_lease(p_workspace_id,p_lease_key,p_owner_session,p_fencing_token);
  select * into v_gate from public.sd_public_site_gate g where g.workspace_id=p_workspace_id for update;
  if (found and v_gate.version<>p_base_version) or (not found and p_base_version<>0) then
    raise exception using errcode='40001', message='version-conflict';
  end if;
  v_password_hash:=extensions.crypt(p_password,extensions.gen_salt('bf',12));
  v_request:=v_request||jsonb_build_object('credentialHash',v_password_hash);
  if v_gate.workspace_id is not null then
    update public.sd_public_site_gate g
    set password_hash=v_password_hash,content_hash=md5(v_password_hash),
        version=g.version+1,updated_at=clock_timestamp(),updated_by=v_actor
    where g.workspace_id=p_workspace_id and g.version=p_base_version
    returning g.version into v_version;
  else
    insert into public.sd_public_site_gate(workspace_id,password_hash,content_hash,version,updated_by)
    values(p_workspace_id,v_password_hash,md5(v_password_hash),1,v_actor)
    returning version into v_version;
  end if;
  v_result:=jsonb_build_object('status','committed','replayed',false,'entityType','settings','entityId','site-gate','version',v_version);
  perform public.sd_core_commit_operation(
    p_operation_id,p_workspace_id,v_actor,'update_site_gate','settings:site-gate',v_request,
    jsonb_build_object('siteGate',p_base_version),
    jsonb_build_object('leaseKey',p_lease_key,'ownerSession',p_owner_session,'fencingToken',p_fencing_token),
    v_result
  );
  insert into public.sd_audit_events(workspace_id,id,actor_id,command,entity_type,entity_id,detail)
  values(p_workspace_id,public.sd_core_event_id(p_operation_id,'audit'),v_actor,'update_site_gate','settings','site-gate',jsonb_build_object('version',v_version,'hashScheme','bcrypt'));
  return v_result;
end;
$$;

-- User saga RPCs are JWT-bound; the service key cannot substitute an actor.
revoke all on function public.begin_ship_dynamics_user_operation(uuid,uuid,text,uuid,jsonb) from public, anon;
revoke all on function public.mark_ship_dynamics_user_operation_effect(uuid,uuid,uuid) from public, anon;
revoke all on function public.mark_ship_dynamics_user_operation_recovery_required(uuid,uuid,text) from public, anon;
revoke all on function public.reject_ship_dynamics_user_operation(uuid,uuid,text) from public, anon;
revoke all on function public.complete_ship_dynamics_user_operation(uuid,uuid,jsonb) from public, anon;
revoke all on function public.provision_ship_dynamics_user(uuid,uuid,text,text,text,text,text,uuid) from public, anon;
revoke all on function public.disable_ship_dynamics_user(uuid,uuid,uuid) from public, anon;
revoke all on function public.change_ship_dynamics_user_role(uuid,uuid,text,uuid) from public, anon;
revoke all on function public.transfer_ship_dynamics_owner(uuid,uuid,uuid) from public, anon;
grant execute on function public.begin_ship_dynamics_user_operation(uuid,uuid,text,uuid,jsonb) to authenticated;
grant execute on function public.mark_ship_dynamics_user_operation_effect(uuid,uuid,uuid) to authenticated;
grant execute on function public.mark_ship_dynamics_user_operation_recovery_required(uuid,uuid,text) to authenticated;
grant execute on function public.reject_ship_dynamics_user_operation(uuid,uuid,text) to authenticated;
grant execute on function public.complete_ship_dynamics_user_operation(uuid,uuid,jsonb) to authenticated;
grant execute on function public.provision_ship_dynamics_user(uuid,uuid,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.disable_ship_dynamics_user(uuid,uuid,uuid) to authenticated;
grant execute on function public.change_ship_dynamics_user_role(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.transfer_ship_dynamics_owner(uuid,uuid,uuid) to authenticated;
revoke all on function public.command_ship_dynamics_update_site_gate(uuid,uuid,bigint,text,uuid,bigint,text) from public, anon;
grant execute on function public.command_ship_dynamics_update_site_gate(uuid,uuid,bigint,text,uuid,bigint,text) to authenticated;

commit;
