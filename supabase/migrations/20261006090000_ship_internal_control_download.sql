-- Additive, records-v1-only capability. No changes to existing anonymous reads or intake.
-- Install after 20260923120000_ship_internal_control_due_date.sql; never stores plaintext credentials.
begin;
set local lock_timeout='10s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $$begin
 if to_regprocedure('ship_dynamics_internal_control_private.admit_v1(text)') is null
  or to_regprocedure('public.ship_dynamics_request_client_ip()') is null
  or to_regclass('public.ship_dynamics_record_workspaces') is null
  or to_regclass('public.ship_dynamics_record_collections') is null
  or to_regclass('public.ship_dynamics_records') is null then
  raise exception 'ship-internal-download-predecessor-required' using errcode='55000';
 end if;
 if has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE') then
  raise exception 'ship-internal-download-untrusted-public-schema' using errcode='55000';
 end if;
end $$;

create schema if not exists ship_dynamics_internal_control_private;
revoke all on schema ship_dynamics_internal_control_private from public,anon,authenticated,service_role;

create table if not exists ship_dynamics_internal_control_private.vessel_credentials (
 workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
 vessel_id text not null,
 secret_hash text not null check(secret_hash ~ '^[0-9a-f]{64}$'),
 changed_at timestamptz not null default clock_timestamp(),
 changed_by text not null,
 primary key(workspace_key,vessel_id)
);
create table if not exists ship_dynamics_internal_control_private.admin_sessions (
 workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
 token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
 actor_id text not null,
 password_hash text not null check(password_hash ~ '^[0-9a-f]{64}$'),
 user_revision integer not null,
 ip_address text not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 primary key(workspace_key,token_hash)
);
create table if not exists ship_dynamics_internal_control_private.auth_attempts (
 workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
 scope text not null,
 ip_address text not null,
 window_start timestamptz not null default clock_timestamp(),
 failed_count integer not null default 0 check(failed_count>=0),
 primary key(workspace_key,scope,ip_address)
);
create table if not exists ship_dynamics_internal_control_private.access_logs (
 receipt_id uuid primary key default gen_random_uuid(),
 workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
 vessel_id text,
 created_at timestamptz not null default clock_timestamp(),
 ip_address text,
 case_count integer not null default 0 check(case_count>=0),
 result text not null check(result in ('success','reset','denied','rate-limited')),
 actor_id text,
 action text not null check(action in ('admin-login','reset','download'))
);
create index if not exists ship_internal_download_log_workspace_time
 on ship_dynamics_internal_control_private.access_logs(workspace_key,created_at desc);
-- These tables are invisible to browser roles, including credentials, session digests and attempts.
revoke all on all tables in schema ship_dynamics_internal_control_private from public,anon,authenticated,service_role;

create or replace function ship_dynamics_internal_control_private.note_download_v1(
 p_workspace text,p_vessel text,p_actor text,p_ip text,p_action text,p_result text,p_count integer
) returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare receipt uuid;
begin
 insert into ship_dynamics_internal_control_private.access_logs(workspace_key,vessel_id,actor_id,ip_address,action,result,case_count)
 values(p_workspace,left(p_vessel,200),left(p_actor,200),p_ip,p_action,p_result,p_count)
 returning receipt_id into receipt;
 return receipt;
end $$;

-- Failure windows are serialized on their primary-key row; a successful authentication clears its own window.
create or replace function ship_dynamics_internal_control_private.attempts_limited_v1(
 p_workspace text,p_scope text,p_ip text
) returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare failures integer;
begin
 insert into ship_dynamics_internal_control_private.auth_attempts(workspace_key,scope,ip_address)
 values(p_workspace,p_scope,p_ip) on conflict do nothing;
 update ship_dynamics_internal_control_private.auth_attempts a
 set window_start=case when a.window_start<clock_timestamp()-interval '15 minutes' then clock_timestamp() else a.window_start end,
     failed_count=case when a.window_start<clock_timestamp()-interval '15 minutes' then 0 else a.failed_count end
 where a.workspace_key=p_workspace and a.scope=p_scope and a.ip_address=p_ip
 returning a.failed_count into failures;
 return failures>=5;
end $$;
create or replace function ship_dynamics_internal_control_private.attempt_result_v1(
 p_workspace text,p_scope text,p_ip text,p_success boolean
) returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 update ship_dynamics_internal_control_private.auth_attempts a
 set failed_count=case when p_success then 0 else a.failed_count+1 end,
     window_start=case when p_success then clock_timestamp() else a.window_start end
 where a.workspace_key=p_workspace and a.scope=p_scope and a.ip_address=p_ip;
end $$;

-- Resolve a user only through the LIVE records-v1 users collection, not supplied role claims.
create or replace function ship_dynamics_internal_control_private.admin_user_v1(p_workspace text,p_actor text)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('user',r.value,'revision',r.revision) from public.ship_dynamics_records r
 join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection='users'
 where r.workspace_key=p_workspace and r.collection='users' and r.entity_id=p_actor
   and c.ids ? p_actor and r.value->>'id'=p_actor
   and r.value->'isActive'='true'::jsonb
   and r.value->>'role' in ('owner','admin')
   and r.value->>'passwordHash' ~ '^[0-9a-f]{64}$'
 for share of r,c
$$;
create or replace function ship_dynamics_internal_control_private.admin_actor_v1(
 p_workspace text,p_token text,p_ip text
) returns text language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare session_row ship_dynamics_internal_control_private.admin_sessions%rowtype; current_user_row jsonb;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null;end if;
 select * into session_row from ship_dynamics_internal_control_private.admin_sessions s
 where s.workspace_key=p_workspace and s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
   and s.expires_at>clock_timestamp() and s.ip_address=p_ip;
 if not found then return null;end if;
 current_user_row:=ship_dynamics_internal_control_private.admin_user_v1(p_workspace,session_row.actor_id);
 if current_user_row->'user'->>'passwordHash' is distinct from session_row.password_hash
  or (current_user_row->>'revision')::integer is distinct from session_row.user_revision then return null;end if;
 return session_row.actor_id;
end $$;
create or replace function ship_dynamics_internal_control_private.active_vessel_v1(p_workspace text,p_vessel text)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $$
 select r.value from public.ship_dynamics_records r
 join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection='vessels'
 where r.workspace_key=p_workspace and r.collection='vessels' and r.entity_id=p_vessel
  and c.ids ? p_vessel and r.value->>'id'=p_vessel and r.value->'isActive'='true'::jsonb
 for share of r,c
$$;

-- This is minted at the SAME main-site login; no additional management password.
create or replace function public.issue_ship_dynamics_internal_control_admin_session_v1(
 p_workspace_key text,p_user_id text,p_password text
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare ip text; actor jsonb; token text; stored_hash text; expiry timestamptz;
begin
 perform ship_dynamics_internal_control_private.admit_v1(p_workspace_key);
 ip:=public.ship_dynamics_request_client_ip();
 if ip is null then
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,null,p_user_id,null,'admin-login','denied',0);
  return jsonb_build_object('ok',false,'code','request-ip-required');
 end if;
 if ship_dynamics_internal_control_private.attempts_limited_v1(p_workspace_key,'admin-login',ip) then
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,null,p_user_id,ip,'admin-login','rate-limited',0);
  return jsonb_build_object('ok',false,'code','rate-limited');
 end if;
 if p_user_id is not null and length(p_user_id) between 1 and 200
   and p_password is not null and octet_length(p_password) between 1 and 4096 then
  actor:=ship_dynamics_internal_control_private.admin_user_v1(p_workspace_key,p_user_id);
 end if;
 stored_hash:=actor->'user'->>'passwordHash';
 if stored_hash is null or stored_hash is distinct from encode(sha256(convert_to(p_password,'UTF8')),'hex') then
  perform ship_dynamics_internal_control_private.attempt_result_v1(p_workspace_key,'admin-login',ip,false);
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,null,p_user_id,ip,'admin-login','denied',0);
  return jsonb_build_object('ok',false,'code','admin-auth-denied');
 end if;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 expiry:=clock_timestamp()+interval '30 minutes';
 insert into ship_dynamics_internal_control_private.admin_sessions(workspace_key,token_hash,actor_id,password_hash,user_revision,ip_address,expires_at)
 values(p_workspace_key,encode(sha256(convert_to(token,'UTF8')),'hex'),p_user_id,stored_hash,(actor->>'revision')::integer,ip,expiry);
 perform ship_dynamics_internal_control_private.attempt_result_v1(p_workspace_key,'admin-login',ip,true);
 perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,null,p_user_id,ip,'admin-login','success',0);
 return jsonb_build_object('token',token,'expires_at',expiry);
end $$;

create or replace function public.manage_ship_dynamics_internal_control_download_v1(
 p_workspace_key text,p_token text,p_action text,p_vessel_id text default null
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare ip text; actor text; vessel jsonb; secret text; vessels jsonb; logs jsonb;
begin
 perform ship_dynamics_internal_control_private.admit_v1(p_workspace_key);
 ip:=public.ship_dynamics_request_client_ip();
 if ip is null then
  if p_action='reset' then
   perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,null,null,'reset','denied',0);
  end if;
  return jsonb_build_object('ok',false,'code','request-ip-required');
 end if;
 actor:=ship_dynamics_internal_control_private.admin_actor_v1(p_workspace_key,p_token,ip);
 if actor is null then
  if p_action='reset' then
   perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,null,ip,'reset','denied',0);
  end if;
  return jsonb_build_object('ok',false,'code','admin-session-denied');
 end if;
 if p_action='list' and p_vessel_id is null then
  select coalesce(jsonb_agg(jsonb_build_object('vessel_id',r.entity_id,'configured',v.secret_hash is not null) order by c.ordinal),'[]'::jsonb)
   into vessels from public.ship_dynamics_record_collections orders
   cross join lateral jsonb_array_elements_text(orders.ids) with ordinality c(id,ordinal)
   join public.ship_dynamics_records r on r.workspace_key=orders.workspace_key and r.collection='vessels' and r.entity_id=c.id
   left join ship_dynamics_internal_control_private.vessel_credentials v on v.workspace_key=r.workspace_key and v.vessel_id=r.entity_id
   where orders.workspace_key=p_workspace_key and orders.collection='vessels' and r.value->'isActive'='true'::jsonb;
  select coalesce(jsonb_agg(jsonb_build_object('receipt_id',e.receipt_id,'vessel_id',coalesce(e.vessel_id,''),'created_at',e.created_at,
   'ip_address',e.ip_address,'case_count',e.case_count,'result',e.result,'actor_id',e.actor_id) order by e.created_at desc,e.receipt_id desc),'[]'::jsonb)
   into logs from (select * from ship_dynamics_internal_control_private.access_logs
    where workspace_key=p_workspace_key and action in ('reset','download') order by created_at desc,receipt_id desc limit 500) e;
  return jsonb_build_object('vessels',vessels,'logs',logs);
 end if;
 if p_action is distinct from 'reset' or p_vessel_id is null or length(p_vessel_id) not between 1 and 200 then
  if p_action='reset' then
   perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,actor,ip,'reset','denied',0);
  end if;
  return jsonb_build_object('ok',false,'code','invalid-action');
 end if;
 vessel:=ship_dynamics_internal_control_private.active_vessel_v1(p_workspace_key,p_vessel_id);
 if vessel is null then
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,actor,ip,'reset','denied',0);
  return jsonb_build_object('ok',false,'code','vessel-unavailable');
 end if;
 secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into ship_dynamics_internal_control_private.vessel_credentials(workspace_key,vessel_id,secret_hash,changed_by)
 values(p_workspace_key,p_vessel_id,encode(sha256(convert_to(secret,'UTF8')),'hex'),actor)
 on conflict(workspace_key,vessel_id) do update set secret_hash=excluded.secret_hash,
 changed_at=clock_timestamp(),changed_by=excluded.changed_by;
 -- The reset result denotes a successful rotation; download success remains "success".
 perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,actor,ip,'reset','reset',0);
 return jsonb_build_object('vessel_id',p_vessel_id,'password',secret);
end $$;

create or replace function public.download_ship_dynamics_internal_control_v1(
 p_workspace_key text,p_vessel_id text,p_password text
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare ip text; vessel jsonb; cases jsonb; count_cases integer; receipt uuid; stored_hash text; scope text;
begin
 perform ship_dynamics_internal_control_private.admit_v1(p_workspace_key);
 ip:=public.ship_dynamics_request_client_ip();
 if ip is null then
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,null,null,'download','denied',0);
  return jsonb_build_object('ok',false,'code','request-ip-required');
 end if;
 if p_vessel_id is null or length(p_vessel_id) not between 1 and 200 then
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,null,ip,'download','denied',0);
  return jsonb_build_object('ok',false,'code','download-denied');
 end if;
 scope:='download:'||p_vessel_id;
 if ship_dynamics_internal_control_private.attempts_limited_v1(p_workspace_key,scope,ip) then
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,null,ip,'download','rate-limited',0);
  return jsonb_build_object('ok',false,'code','rate-limited');
 end if;
 vessel:=ship_dynamics_internal_control_private.active_vessel_v1(p_workspace_key,p_vessel_id);
 select c.secret_hash into stored_hash from ship_dynamics_internal_control_private.vessel_credentials c
 where c.workspace_key=p_workspace_key and c.vessel_id=p_vessel_id for share;
 if vessel is null or stored_hash is null or p_password is null or octet_length(p_password) not between 1 and 4096
   or stored_hash is distinct from encode(sha256(convert_to(p_password,'UTF8')),'hex') then
  perform ship_dynamics_internal_control_private.attempt_result_v1(p_workspace_key,scope,ip,false);
  perform ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,null,ip,'download','denied',0);
  return jsonb_build_object('ok',false,'code','download-denied');
 end if;
 -- Strictly a single vessel's explicitly open cases, in current collection order.
 -- Only allowlisted fields leave this function (never users, root, audit, other vessels or secret hashes).
 select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'vesselId',r.value->>'vesselId',
  'reportDate',r.value->>'reportDate','reportSource',r.value->>'reportSource','priority',r.value->>'priority',
  'description',r.value->>'description','category',r.value->>'category',
  'equipmentSubcategory',coalesce(r.value->>'equipmentSubcategory',''),
  'departments',case when jsonb_typeof(r.value->'departments')='array' then r.value->'departments' else '[]'::jsonb end,
  'status',r.value->>'status','closedDate',r.value->>'closedDate') order by ids.ordinal),'[]'::jsonb)
 into cases from public.ship_dynamics_record_collections c
 cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
 join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection='internalControlCases' and r.entity_id=ids.id
 where c.workspace_key=p_workspace_key and c.collection='internalControlCases'
  and r.value->>'id'=r.entity_id and r.value->>'vesselId'=p_vessel_id
  and r.value->'isClosed'='false'::jsonb;
 count_cases:=jsonb_array_length(cases);
 perform ship_dynamics_internal_control_private.attempt_result_v1(p_workspace_key,scope,ip,true);
 receipt:=ship_dynamics_internal_control_private.note_download_v1(p_workspace_key,p_vessel_id,'vessel:'||p_vessel_id,ip,'download','success',count_cases);
 return jsonb_build_object('receipt_id',receipt,'vessel',jsonb_build_object('id',p_vessel_id,'name',coalesce(vessel->>'name',''),
  'shortName',coalesce(vessel->>'shortName',''),'fullName',coalesce(vessel->>'fullName',''),'shipType',vessel->>'shipType'),
  'issued_at',clock_timestamp(),'ip_address',ip,'case_count',count_cases,'cases',cases);
end $$;

revoke all on all functions in schema ship_dynamics_internal_control_private from public,anon,authenticated,service_role;
revoke all on function public.issue_ship_dynamics_internal_control_admin_session_v1(text,text,text),
 public.manage_ship_dynamics_internal_control_download_v1(text,text,text,text),
 public.download_ship_dynamics_internal_control_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.issue_ship_dynamics_internal_control_admin_session_v1(text,text,text),
 public.manage_ship_dynamics_internal_control_download_v1(text,text,text,text),
 public.download_ship_dynamics_internal_control_v1(text,text,text) to anon,authenticated;
comment on function public.download_ship_dynamics_internal_control_v1(text,text,text) is 'ship-internal-control-download-v1: records-v1 only; own explicitly open cases; private hashed per-vessel secret and audited IP';
notify pgrst,'reload schema';
commit;
