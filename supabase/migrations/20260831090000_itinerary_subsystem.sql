begin;

-- Additive Itinerary subsystem. No existing AppData, task, meeting, vessel,
-- operation, or edit-lease rows are rewritten by this migration.

create table if not exists public.sd_itinerary_rollout (
  workspace_id uuid primary key references public.sd_workspaces(id) on delete cascade,
  main_enabled boolean not null default false,
  ship_portal_enabled boolean not null default false,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.sd_itinerary_role_permissions (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  role text not null check (role in ('owner','admin','operator','vessel')),
  can_view boolean not null default false,
  can_edit boolean not null default false,
  can_import boolean not null default false,
  can_export boolean not null default false,
  can_calendar boolean not null default false,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id, role)
);

create table if not exists public.sd_itinerary_documents (
  workspace_id uuid not null,
  vessel_id text not null,
  revision bigint not null default 0 check (revision >= 0),
  schema_version integer not null default 1 check (schema_version = 1),
  rows_payload jsonb not null check (jsonb_typeof(rows_payload) = 'array'),
  updated_at timestamptz,
  updated_actor_kind text check (updated_actor_kind in ('office','public')),
  updated_actor_id uuid references auth.users(id),
  updated_actor_label text not null default '',
  primary key (workspace_id, vessel_id),
  foreign key (workspace_id, vessel_id) references public.sd_vessels(workspace_id, id) on delete cascade
);

create table if not exists public.sd_itinerary_history (
  workspace_id uuid not null,
  vessel_id text not null,
  revision bigint not null check (revision > 0),
  schema_version integer not null check (schema_version = 1),
  rows_payload jsonb not null check (jsonb_typeof(rows_payload) = 'array'),
  actor_kind text not null check (actor_kind in ('office','public')),
  actor_id uuid references auth.users(id),
  actor_label text not null default '',
  operation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, vessel_id, revision),
  unique (workspace_id, operation_id),
  foreign key (workspace_id, vessel_id) references public.sd_vessels(workspace_id, id) on delete cascade
);

create table if not exists public.sd_itinerary_leases (
  workspace_id uuid not null,
  vessel_id text not null,
  lease_id uuid not null,
  actor_kind text not null check (actor_kind in ('office','public')),
  actor_key text not null,
  holder_session text not null,
  holder_label text not null default '',
  fencing_token bigint not null check (fencing_token > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, vessel_id),
  foreign key (workspace_id, vessel_id) references public.sd_vessels(workspace_id, id) on delete cascade,
  constraint sd_itinerary_lease_actor_key_not_blank check (btrim(actor_key) <> ''),
  constraint sd_itinerary_lease_holder_session_not_blank check (btrim(holder_session) <> '')
);

create table if not exists public.sd_itinerary_operations (
  workspace_id uuid not null references public.sd_workspaces(id) on delete cascade,
  operation_id uuid not null,
  actor_kind text not null check (actor_kind in ('office','public')),
  actor_key text not null,
  target_key text not null,
  request_payload jsonb not null,
  request_hash text not null,
  result jsonb not null,
  committed_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, operation_id),
  constraint sd_itinerary_operation_actor_key_not_blank check (btrim(actor_key) <> ''),
  constraint sd_itinerary_operation_target_not_blank check (btrim(target_key) <> '')
);

create index if not exists sd_itinerary_history_recent
  on public.sd_itinerary_history(workspace_id, vessel_id, revision desc);
create index if not exists sd_itinerary_leases_expiry
  on public.sd_itinerary_leases(expires_at);

insert into public.sd_itinerary_rollout(workspace_id, main_enabled, ship_portal_enabled)
select w.id, false, false from public.sd_workspaces w
on conflict (workspace_id) do nothing;

insert into public.sd_itinerary_role_permissions(
  workspace_id, role, can_view, can_edit, can_import, can_export, can_calendar
)
select w.id, role_name,
  role_name = 'owner', role_name = 'owner', role_name = 'owner',
  role_name = 'owner', role_name = 'owner'
from public.sd_workspaces w
cross join unnest(array['owner','admin','operator','vessel']) role_name
on conflict (workspace_id, role) do nothing;

create or replace function public.sd_itinerary_workspace_id(p_workspace_key text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select w.id from public.sd_workspaces w
  where w.legacy_key = btrim(coalesce(p_workspace_key,'')) and w.is_active
$$;

create or replace function public.sd_itinerary_can_action(
  p_workspace_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_permission public.sd_itinerary_role_permissions%rowtype;
begin
  select m.role into v_role
  from public.sd_memberships m
  join public.sd_login_options login
    on login.workspace_id=m.workspace_id and login.user_id=m.user_id
   and login.is_active and not login.must_change_password
  where m.workspace_id=p_workspace_id and m.user_id=auth.uid() and m.is_active;
  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;
  if v_role = 'vessel' then return false; end if;
  select * into v_permission
  from public.sd_itinerary_role_permissions p
  where p.workspace_id = p_workspace_id and p.role = v_role;
  if not found then return false; end if;
  return case p_action
    when 'view' then v_permission.can_view
    when 'edit' then v_permission.can_edit
    when 'import' then v_permission.can_import
    when 'export' then v_permission.can_export
    when 'calendar' then v_permission.can_calendar
    else false
  end;
end;
$$;

create or replace function public.sd_itinerary_json_instant_valid(p_value jsonb)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare v_text text;
begin
  if p_value is null or p_value = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p_value) <> 'string' then return false; end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then return false; end if;
  perform v_text::timestamptz;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.sd_itinerary_rows_valid(p_rows jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb;
  v_ordinal bigint;
  v_zone text;
  v_distance numeric;
  v_speed numeric;
  v_sailing numeric;
  v_quantity numeric;
  v_rate numeric;
  v_operation numeric;
  v_allowed constant text[] := array[
    'rowId','sortOrder','voyageNumber','portDockName','operation','cargoQuantityText',
    'etaUtc','etbUtc','ldRateText','etcUtc','etdUtc','arrivalDraftText','departureDraftText',
    'arrivalRobText','departureRobText','portTimeZone','oceanDistanceNm','speedKnots','sailingHours',
    'berthWaitHours','tanksText','operationQuantityMt','operationRateMtPerHour','operationHours',
    'departureBufferDays','etaMode','etbMode','etcMode','etdMode'
  ];
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then return false; end if;
  for v_row, v_ordinal in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(v_row) <> 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(v_row) key where not (key = any(v_allowed))) then return false; end if;
    if (select count(*) from jsonb_object_keys(v_row)) <> cardinality(v_allowed) then return false; end if;
    if jsonb_typeof(v_row->'rowId') <> 'string' or length(v_row->>'rowId') not between 1 and 100 then return false; end if;
    if jsonb_typeof(v_row->'sortOrder') <> 'number' or (v_row->>'sortOrder') !~ '^\d+$' or (v_row->>'sortOrder')::bigint <> v_ordinal - 1 then return false; end if;
    if jsonb_typeof(v_row->'voyageNumber') <> 'string' or length(v_row->>'voyageNumber') > 120 then return false; end if;
    if jsonb_typeof(v_row->'portDockName') <> 'string' or length(v_row->>'portDockName') > 300 then return false; end if;
    if jsonb_typeof(v_row->'operation') <> 'string' or (v_row->>'operation') not in ('','Loading','Unloading') then return false; end if;
    if jsonb_typeof(v_row->'cargoQuantityText') <> 'string' or length(v_row->>'cargoQuantityText') > 500 then return false; end if;
    if jsonb_typeof(v_row->'ldRateText') <> 'string' or length(v_row->>'ldRateText') > 160 then return false; end if;
    if jsonb_typeof(v_row->'arrivalDraftText') <> 'string' or length(v_row->>'arrivalDraftText') > 120 then return false; end if;
    if jsonb_typeof(v_row->'departureDraftText') <> 'string' or length(v_row->>'departureDraftText') > 120 then return false; end if;
    if jsonb_typeof(v_row->'arrivalRobText') <> 'string' or length(v_row->>'arrivalRobText') > 300 then return false; end if;
    if jsonb_typeof(v_row->'departureRobText') <> 'string' or length(v_row->>'departureRobText') > 300 then return false; end if;
    if jsonb_typeof(v_row->'tanksText') <> 'string' or length(v_row->>'tanksText') > 300 then return false; end if;
    if not public.sd_itinerary_json_instant_valid(v_row->'etaUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etbUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etcUtc')
       or not public.sd_itinerary_json_instant_valid(v_row->'etdUtc') then return false; end if;
    if jsonb_typeof(v_row->'portTimeZone') <> 'string' then return false; end if;
    v_zone := v_row->>'portTimeZone';
    if v_zone <> '' and not exists(select 1 from pg_catalog.pg_timezone_names where name = v_zone) then return false; end if;
    if (v_row->'etaUtc' <> 'null'::jsonb or v_row->'etbUtc' <> 'null'::jsonb or v_row->'etcUtc' <> 'null'::jsonb or v_row->'etdUtc' <> 'null'::jsonb) and v_zone = '' then return false; end if;
    if (v_row->>'etaMode') not in ('auto','manual') or (v_row->>'etbMode') not in ('auto','manual')
       or (v_row->>'etcMode') not in ('auto','manual') or (v_row->>'etdMode') not in ('auto','manual') then return false; end if;

    if exists(select 1 from unnest(array['oceanDistanceNm','speedKnots','sailingHours','berthWaitHours','operationQuantityMt','operationRateMtPerHour','operationHours','departureBufferDays']) key
      where v_row->key <> 'null'::jsonb and jsonb_typeof(v_row->key) <> 'number') then return false; end if;
    v_distance := nullif(v_row->>'oceanDistanceNm','')::numeric;
    v_speed := nullif(v_row->>'speedKnots','')::numeric;
    v_sailing := nullif(v_row->>'sailingHours','')::numeric;
    v_quantity := nullif(v_row->>'operationQuantityMt','')::numeric;
    v_rate := nullif(v_row->>'operationRateMtPerHour','')::numeric;
    v_operation := nullif(v_row->>'operationHours','')::numeric;
    if v_distance is not null and (v_distance < 0 or v_distance > 50000) then return false; end if;
    if v_speed is not null and (v_speed <= 0 or v_speed > 100) then return false; end if;
    if nullif(v_row->>'berthWaitHours','')::numeric not between 0 and 720 and v_row->'berthWaitHours' <> 'null'::jsonb then return false; end if;
    if v_quantity is not null and (v_quantity < 0 or v_quantity > 1000000000) then return false; end if;
    if v_rate is not null and (v_rate <= 0 or v_rate > 10000000) then return false; end if;
    if nullif(v_row->>'departureBufferDays','')::numeric not between 0 and 365 and v_row->'departureBufferDays' <> 'null'::jsonb then return false; end if;
    if v_distance is not null and v_speed is not null then
      if v_sailing is null or v_sailing <> ceil(v_distance / v_speed) then return false; end if;
    elsif v_sailing is not null then return false;
    end if;
    if v_quantity is not null and v_rate is not null then
      if v_operation is null or abs(v_operation - (v_quantity / v_rate)) > 0.000001 then return false; end if;
    elsif v_operation is not null then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.sd_itinerary_document_json(
  p_workspace_key text,
  p_vessel_id text,
  p_vessel_name text,
  p_revision bigint,
  p_rows jsonb,
  p_updated_at timestamptz,
  p_actor_kind text,
  p_actor_label text
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'schemaVersion',1,'workspaceKey',p_workspace_key,'vesselId',p_vessel_id,
    'vesselName',p_vessel_name,'revision',p_revision,
    'updatedAt',case when p_updated_at is null then null else to_jsonb(p_updated_at) end,
    'updatedActorKind',p_actor_kind,'updatedActorLabel',coalesce(p_actor_label,''),
    'rows',p_rows
  )
$$;

create or replace function public.sd_itinerary_operation_replay(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_actor_kind text,
  p_actor_key text,
  p_target_key text,
  p_request jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare v_operation public.sd_itinerary_operations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':itinerary-op:' || p_operation_id::text,0));
  select * into v_operation from public.sd_itinerary_operations o
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id for update;
  if not found then return null; end if;
  if v_operation.actor_kind <> p_actor_kind or v_operation.actor_key <> p_actor_key
     or v_operation.target_key <> p_target_key or v_operation.request_payload <> p_request then
    raise exception using errcode='P0001', message='operation-mismatch';
  end if;
  return v_operation.result || jsonb_build_object('replayed',true);
end;
$$;

create or replace function public.sd_itinerary_claim_lease_internal(
  p_workspace_id uuid,p_vessel_id text,p_actor_kind text,p_actor_key text,
  p_holder_session text,p_holder_label text,p_ttl_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease public.sd_itinerary_leases%rowtype;
  v_token bigint;
  v_lease_id uuid;
begin
  if p_actor_kind not in ('office','public') or btrim(coalesce(p_actor_key,''))=''
     or btrim(coalesce(p_holder_session,''))='' or length(p_holder_session)>128
     or not exists(select 1 from public.sd_vessels v where v.workspace_id=p_workspace_id and v.id=p_vessel_id and v.is_active) then
    raise exception using errcode='P0001', message='not-authorized';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':itinerary:' || p_vessel_id,0));
  select * into v_lease from public.sd_itinerary_leases l
  where l.workspace_id=p_workspace_id and l.vessel_id=p_vessel_id for update;
  if found and v_lease.expires_at > v_now then
    if v_lease.actor_kind=p_actor_kind and v_lease.actor_key=p_actor_key and v_lease.holder_session=p_holder_session then
      update public.sd_itinerary_leases set expires_at=v_now+make_interval(secs=>least(greatest(p_ttl_seconds,30),300)),updated_at=v_now
      where workspace_id=p_workspace_id and vessel_id=p_vessel_id returning * into v_lease;
      return jsonb_build_object('ok',true,'leaseId',v_lease.lease_id,'fencingToken',v_lease.fencing_token,'expiresAt',v_lease.expires_at);
    end if;
    return jsonb_build_object('ok',false,'code','locked','holderLabel',case when p_actor_kind='public' then '另一個使用者' else coalesce(v_lease.holder_label,'另一個使用者') end,'expiresAt',v_lease.expires_at);
  end if;
  v_token := coalesce(v_lease.fencing_token,0)+1;
  v_lease_id := gen_random_uuid();
  insert into public.sd_itinerary_leases(workspace_id,vessel_id,lease_id,actor_kind,actor_key,holder_session,holder_label,fencing_token,expires_at,updated_at)
  values(p_workspace_id,p_vessel_id,v_lease_id,p_actor_kind,p_actor_key,p_holder_session,left(coalesce(p_holder_label,''),120),v_token,v_now+make_interval(secs=>least(greatest(p_ttl_seconds,30),300)),v_now)
  on conflict(workspace_id,vessel_id) do update set lease_id=excluded.lease_id,actor_kind=excluded.actor_kind,actor_key=excluded.actor_key,
    holder_session=excluded.holder_session,holder_label=excluded.holder_label,fencing_token=excluded.fencing_token,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true,'leaseId',v_lease_id,'fencingToken',v_token,'expiresAt',v_now+make_interval(secs=>least(greatest(p_ttl_seconds,30),300)));
end;
$$;

create or replace function public.sd_itinerary_assert_live_lease(
  p_workspace_id uuid,p_vessel_id text,p_actor_kind text,p_actor_key text,
  p_lease_id uuid,p_holder_session text,p_fencing_token bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1 from public.sd_itinerary_leases l
  where l.workspace_id=p_workspace_id and l.vessel_id=p_vessel_id
    and l.actor_kind=p_actor_kind and l.actor_key=p_actor_key
    and l.lease_id=p_lease_id and l.holder_session=p_holder_session
    and l.fencing_token=p_fencing_token and l.expires_at>clock_timestamp()
  for update;
  if not found then raise exception using errcode='P0001', message='lease-expired'; end if;
end;
$$;

create or replace function public.sd_itinerary_document_for_vessel(p_workspace_id uuid,p_workspace_key text,p_vessel_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when d.workspace_id is null then null else public.sd_itinerary_document_json(
    p_workspace_key,v.id,v.name,d.revision,d.rows_payload,d.updated_at,d.updated_actor_kind,d.updated_actor_label
  ) end
  from public.sd_vessels v left join public.sd_itinerary_documents d
    on d.workspace_id=v.workspace_id and d.vessel_id=v.id
  where v.workspace_id=p_workspace_id and v.id=p_vessel_id and v.is_active
$$;

create or replace function public.sd_itinerary_get_rollout(p_workspace_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid;
  v_role text;
  v_rollout public.sd_itinerary_rollout%rowtype;
  v_permission public.sd_itinerary_role_permissions%rowtype;
  v_identity jsonb;
begin
  v_workspace:=public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null then return jsonb_build_object('main_enabled',false,'ship_portal_enabled',false,'office_identity',null,'role_permissions','{}'::jsonb);end if;
  select m.role,jsonb_build_object('department',login.department,'display_name',login.display_name,'username_label',login.username_label,'role',m.role)
  into v_role,v_identity
  from public.sd_memberships m
  join public.sd_login_options login
    on login.workspace_id=m.workspace_id and login.user_id=m.user_id
   and login.is_active and not login.must_change_password
  where m.workspace_id=v_workspace and m.user_id=auth.uid() and m.is_active;
  if v_role is null or v_identity is null then return jsonb_build_object('main_enabled',false,'ship_portal_enabled',false,'office_identity',null,'role_permissions','{}'::jsonb);end if;
  select * into v_rollout from public.sd_itinerary_rollout where workspace_id=v_workspace;
  select * into v_permission from public.sd_itinerary_role_permissions where workspace_id=v_workspace and role=v_role;
  return jsonb_build_object('main_enabled',coalesce(v_rollout.main_enabled,false),'ship_portal_enabled',coalesce(v_rollout.ship_portal_enabled,false),
    'office_identity',v_identity,
    'role_permissions',jsonb_build_object(v_role,jsonb_build_object('view',v_role='owner' or coalesce(v_permission.can_view,false),'edit',v_role='owner' or coalesce(v_permission.can_edit,false),'import',v_role='owner' or coalesce(v_permission.can_import,false),'export',v_role='owner' or coalesce(v_permission.can_export,false),'calendar',v_role='owner' or coalesce(v_permission.can_calendar,false))));
end;
$$;

create or replace function public.sd_itinerary_get_office_entry(p_workspace_key text,p_role text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_role not in ('owner','admin','operator') then false
    else coalesce(r.main_enabled,false) and (p_role='owner' or coalesce(permission.can_view,false))
  end
  from (select public.sd_itinerary_workspace_id(p_workspace_key) id) workspace
  left join public.sd_itinerary_rollout r on r.workspace_id=workspace.id
  left join public.sd_itinerary_role_permissions permission on permission.workspace_id=workspace.id and permission.role=p_role
$$;

create or replace function public.sd_itinerary_get_public_rollout(p_workspace_key text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('ship_portal_enabled',coalesce(r.ship_portal_enabled,false))
  from (select public.sd_itinerary_workspace_id(p_workspace_key) id) w
  left join public.sd_itinerary_rollout r on r.workspace_id=w.id
$$;

create or replace function public.sd_itinerary_load_many(p_workspace_key text,p_vessel_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_workspace uuid;v_result jsonb;
begin
  v_workspace:=public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null or not coalesce((select main_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false)
     or not public.sd_itinerary_can_action(v_workspace,'view') then raise exception using errcode='P0001',message='not-authorized';end if;
  select coalesce(jsonb_agg(jsonb_build_object('vesselId',v.id,'vesselName',v.name,'document',public.sd_itinerary_document_for_vessel(v_workspace,p_workspace_key,v.id)) order by v.name),'[]'::jsonb)
  into v_result from public.sd_vessels v where v.workspace_id=v_workspace and v.is_active and v.id=any(coalesce(p_vessel_ids,'{}'));
  return v_result;
end;
$$;

create or replace function public.sd_itinerary_public_list_vessels(p_workspace_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_workspace uuid;v_result jsonb;
begin
  v_workspace:=public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null or not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) then return '[]'::jsonb;end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'shortName',v.short_name) order by v.name),'[]'::jsonb)
  into v_result from public.sd_vessels v where v.workspace_id=v_workspace and v.is_active;
  return v_result;
end;
$$;

create or replace function public.sd_itinerary_public_load(p_workspace_key text,p_vessel_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_workspace uuid;
begin
  v_workspace:=public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null or not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) then raise exception using errcode='P0001',message='portal-disabled';end if;
  return public.sd_itinerary_document_for_vessel(v_workspace,p_workspace_key,p_vessel_id);
end;
$$;

create or replace function public.sd_itinerary_claim_office_lease(p_workspace_key text,p_vessel_id text,p_holder_session text,p_holder_label text,p_ttl_seconds integer default 75)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid;v_actor uuid:=auth.uid();begin
  v_workspace:=public.sd_itinerary_workspace_id(p_workspace_key);
  if v_actor is null or not coalesce((select main_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) or not public.sd_itinerary_can_action(v_workspace,'edit') then raise exception using errcode='P0001',message='not-authorized';end if;
  return public.sd_itinerary_claim_lease_internal(v_workspace,p_vessel_id,'office',v_actor::text,p_holder_session,p_holder_label,p_ttl_seconds);
end;$$;

create or replace function public.sd_itinerary_claim_public_lease(p_workspace_key text,p_vessel_id text,p_actor_key text,p_holder_session text,p_ttl_seconds integer default 75)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid;begin
  v_workspace:=public.sd_itinerary_workspace_id(p_workspace_key);
  if v_workspace is null or not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) then raise exception using errcode='P0001',message='portal-disabled';end if;
  return public.sd_itinerary_claim_lease_internal(v_workspace,p_vessel_id,'public',p_actor_key,p_holder_session,'船端使用者',p_ttl_seconds);
end;$$;

create or replace function public.sd_itinerary_renew_lease_internal(p_workspace_id uuid,p_vessel_id text,p_actor_kind text,p_actor_key text,p_lease_id uuid,p_holder_session text,p_fencing_token bigint,p_ttl_seconds integer)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_expiry timestamptz;begin
  update public.sd_itinerary_leases l set expires_at=clock_timestamp()+make_interval(secs=>least(greatest(p_ttl_seconds,30),300)),updated_at=clock_timestamp()
  where l.workspace_id=p_workspace_id and l.vessel_id=p_vessel_id and l.actor_kind=p_actor_kind and l.actor_key=p_actor_key and l.lease_id=p_lease_id and l.holder_session=p_holder_session and l.fencing_token=p_fencing_token and l.expires_at>clock_timestamp()
  returning expires_at into v_expiry;
  if not found then return jsonb_build_object('ok',false,'code','lease-expired');end if;
  return jsonb_build_object('ok',true,'leaseId',p_lease_id,'fencingToken',p_fencing_token,'expiresAt',v_expiry);
end;$$;

create or replace function public.sd_itinerary_renew_office_lease(p_workspace_key text,p_vessel_id text,p_lease_id uuid,p_holder_session text,p_fencing_token bigint,p_ttl_seconds integer default 75)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_actor uuid:=auth.uid();begin
  if v_actor is null or not public.sd_itinerary_can_action(v_workspace,'edit') then raise exception using errcode='P0001',message='not-authorized';end if;
  return public.sd_itinerary_renew_lease_internal(v_workspace,p_vessel_id,'office',v_actor::text,p_lease_id,p_holder_session,p_fencing_token,p_ttl_seconds);
end;$$;

create or replace function public.sd_itinerary_renew_public_lease(p_workspace_key text,p_vessel_id text,p_lease_id uuid,p_actor_key text,p_holder_session text,p_fencing_token bigint,p_ttl_seconds integer default 75)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);begin
  if not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) then raise exception using errcode='P0001',message='portal-disabled';end if;
  return public.sd_itinerary_renew_lease_internal(v_workspace,p_vessel_id,'public',p_actor_key,p_lease_id,p_holder_session,p_fencing_token,p_ttl_seconds);
end;$$;

create or replace function public.sd_itinerary_release_lease_internal(p_workspace_id uuid,p_vessel_id text,p_actor_kind text,p_actor_key text,p_lease_id uuid,p_holder_session text,p_fencing_token bigint)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
  update public.sd_itinerary_leases l set expires_at=clock_timestamp(),updated_at=clock_timestamp()
  where l.workspace_id=p_workspace_id and l.vessel_id=p_vessel_id and l.actor_kind=p_actor_kind and l.actor_key=p_actor_key and l.lease_id=p_lease_id and l.holder_session=p_holder_session and l.fencing_token=p_fencing_token;
  return found;
end;$$;

create or replace function public.sd_itinerary_release_office_lease(p_workspace_key text,p_vessel_id text,p_lease_id uuid,p_holder_session text,p_fencing_token bigint)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_actor uuid:=auth.uid();begin
  if v_actor is null then return false;end if;
  return public.sd_itinerary_release_lease_internal(v_workspace,p_vessel_id,'office',v_actor::text,p_lease_id,p_holder_session,p_fencing_token);
end;$$;

create or replace function public.sd_itinerary_release_public_lease(p_workspace_key text,p_vessel_id text,p_lease_id uuid,p_actor_key text,p_holder_session text,p_fencing_token bigint)
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
  select public.sd_itinerary_release_lease_internal(public.sd_itinerary_workspace_id(p_workspace_key),p_vessel_id,'public',p_actor_key,p_lease_id,p_holder_session,p_fencing_token)
$$;

create or replace function public.sd_itinerary_save_internal(
  p_workspace_key text,p_vessel_id text,p_expected_revision bigint,p_operation_id uuid,p_rows jsonb,
  p_actor_kind text,p_actor_key text,p_actor_id uuid,p_actor_label text,
  p_lease_id uuid,p_holder_session text,p_fencing_token bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=pg_catalog,public
as $$
declare
  v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);
  v_request jsonb;
  v_replay jsonb;
  v_current bigint;
  v_next bigint;
  v_now timestamptz:=clock_timestamp();
  v_name text;
  v_result jsonb;
begin
  if v_workspace is null or p_operation_id is null or not public.sd_itinerary_rows_valid(p_rows) then raise exception using errcode='P0001',message='invalid-itinerary-payload';end if;
  v_request:=jsonb_build_object('vesselId',p_vessel_id,'expectedRevision',p_expected_revision,'rows',p_rows);
  v_replay:=public.sd_itinerary_operation_replay(v_workspace,p_operation_id,p_actor_kind,p_actor_key,'vessel:'||p_vessel_id,v_request);
  if v_replay is not null then return v_replay;end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||':itinerary:'||p_vessel_id,0));
  perform public.sd_itinerary_assert_live_lease(v_workspace,p_vessel_id,p_actor_kind,p_actor_key,p_lease_id,p_holder_session,p_fencing_token);
  select v.name into v_name from public.sd_vessels v where v.workspace_id=v_workspace and v.id=p_vessel_id and v.is_active;
  if not found then raise exception using errcode='P0001',message='not-authorized';end if;
  select d.revision into v_current from public.sd_itinerary_documents d where d.workspace_id=v_workspace and d.vessel_id=p_vessel_id for update;
  v_current:=coalesce(v_current,0);
  if v_current<>p_expected_revision then raise exception using errcode='40001',message='revision-conflict',detail=v_current::text;end if;
  v_next:=v_current+1;
  insert into public.sd_itinerary_documents(workspace_id,vessel_id,revision,schema_version,rows_payload,updated_at,updated_actor_kind,updated_actor_id,updated_actor_label)
  values(v_workspace,p_vessel_id,v_next,1,p_rows,v_now,p_actor_kind,p_actor_id,left(coalesce(p_actor_label,''),120))
  on conflict(workspace_id,vessel_id) do update set revision=excluded.revision,rows_payload=excluded.rows_payload,updated_at=excluded.updated_at,updated_actor_kind=excluded.updated_actor_kind,updated_actor_id=excluded.updated_actor_id,updated_actor_label=excluded.updated_actor_label;
  insert into public.sd_itinerary_history(workspace_id,vessel_id,revision,schema_version,rows_payload,actor_kind,actor_id,actor_label,operation_id,created_at)
  values(v_workspace,p_vessel_id,v_next,1,p_rows,p_actor_kind,p_actor_id,left(coalesce(p_actor_label,''),120),p_operation_id,v_now);
  v_result:=jsonb_build_object('ok',true,'document',public.sd_itinerary_document_json(p_workspace_key,p_vessel_id,v_name,v_next,p_rows,v_now,p_actor_kind,left(coalesce(p_actor_label,''),120)),'revision',v_next,'replayed',false);
  insert into public.sd_itinerary_operations(workspace_id,operation_id,actor_kind,actor_key,target_key,request_payload,request_hash,result,committed_at)
  values(v_workspace,p_operation_id,p_actor_kind,p_actor_key,'vessel:'||p_vessel_id,v_request,md5(v_request::text),v_result,v_now);
  perform public.sd_itinerary_release_lease_internal(v_workspace,p_vessel_id,p_actor_kind,p_actor_key,p_lease_id,p_holder_session,p_fencing_token);
  return v_result;
end;$$;

create or replace function public.sd_itinerary_save_office(p_workspace_key text,p_vessel_id text,p_expected_revision bigint,p_operation_id uuid,p_rows jsonb,p_lease_id uuid,p_holder_session text,p_fencing_token bigint,p_actor_label text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_actor uuid:=auth.uid();begin
  if v_actor is null or not coalesce((select main_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) or not public.sd_itinerary_can_action(v_workspace,'edit') then raise exception using errcode='P0001',message='not-authorized';end if;
  return public.sd_itinerary_save_internal(p_workspace_key,p_vessel_id,p_expected_revision,p_operation_id,p_rows,'office',v_actor::text,v_actor,p_actor_label,p_lease_id,p_holder_session,p_fencing_token);
end;$$;

create or replace function public.sd_itinerary_save_public(p_workspace_key text,p_vessel_id text,p_expected_revision bigint,p_operation_id uuid,p_rows jsonb,p_lease_id uuid,p_actor_key text,p_holder_session text,p_fencing_token bigint)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);begin
  if not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) then raise exception using errcode='P0001',message='portal-disabled';end if;
  return public.sd_itinerary_save_internal(p_workspace_key,p_vessel_id,p_expected_revision,p_operation_id,p_rows,'public',p_actor_key,null,'船端使用者',p_lease_id,p_holder_session,p_fencing_token);
end;$$;

create or replace function public.sd_itinerary_operation_status_office(p_workspace_key text,p_operation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_actor uuid:=auth.uid();v_result jsonb;begin
  if v_actor is null or not public.sd_itinerary_can_action(v_workspace,'view') then raise exception using errcode='P0001',message='not-authorized';end if;
  select o.result into v_result from public.sd_itinerary_operations o where o.workspace_id=v_workspace and o.operation_id=p_operation_id and o.actor_kind='office' and o.actor_key=v_actor::text;
  return coalesce(v_result,jsonb_build_object('status','missing'));
end;$$;

create or replace function public.sd_itinerary_operation_status_public(p_workspace_key text,p_operation_id uuid,p_actor_key text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select o.result from public.sd_itinerary_operations o where o.workspace_id=public.sd_itinerary_workspace_id(p_workspace_key) and o.operation_id=p_operation_id and o.actor_kind='public' and o.actor_key=p_actor_key),jsonb_build_object('status','missing'))
$$;

create or replace function public.sd_itinerary_history(p_workspace_key text,p_vessel_id text,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_result jsonb;begin
  if not public.sd_itinerary_can_action(v_workspace,'view') then raise exception using errcode='P0001',message='not-authorized';end if;
  select coalesce(jsonb_agg(jsonb_build_object('revision',h.revision,'rows',h.rows_payload,'actorKind',h.actor_kind,'actorLabel',h.actor_label,'operationId',h.operation_id,'createdAt',h.created_at) order by h.revision desc),'[]'::jsonb)
  into v_result from (select * from public.sd_itinerary_history where workspace_id=v_workspace and vessel_id=p_vessel_id order by revision desc limit least(greatest(p_limit,1),100)) h;
  return v_result;
end;$$;

create or replace function public.sd_itinerary_owner_update_rollout(p_workspace_key text,p_expected_version bigint,p_operation_id uuid,p_main_enabled boolean,p_ship_portal_enabled boolean,p_role_permissions jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_actor uuid:=auth.uid();v_request jsonb;v_replay jsonb;v_version bigint;v_role text;v_value jsonb;v_result jsonb;begin
  if v_actor is null or public.sd_membership_role(v_workspace)<>'owner'
     or not exists(select 1 from public.sd_login_options login where login.workspace_id=v_workspace and login.user_id=v_actor and login.is_active and not login.must_change_password)
     or jsonb_typeof(p_role_permissions)<>'object' then raise exception using errcode='P0001',message='owner-required';end if;
  if exists(select 1 from jsonb_object_keys(p_role_permissions) k where k not in ('admin','operator','vessel')) then raise exception using errcode='P0001',message='invalid-role-permissions';end if;
  if coalesce((p_role_permissions#>>'{vessel,view}')::boolean,false)
     or coalesce((p_role_permissions#>>'{vessel,edit}')::boolean,false)
     or coalesce((p_role_permissions#>>'{vessel,import}')::boolean,false)
     or coalesce((p_role_permissions#>>'{vessel,export}')::boolean,false)
     or coalesce((p_role_permissions#>>'{vessel,calendar}')::boolean,false)
  then raise exception using errcode='P0001',message='invalid-role-permissions';end if;
  v_request:=jsonb_build_object('expectedVersion',p_expected_version,'mainEnabled',p_main_enabled,'shipPortalEnabled',p_ship_portal_enabled,'rolePermissions',p_role_permissions);
  v_replay:=public.sd_itinerary_operation_replay(v_workspace,p_operation_id,'office',v_actor::text,'rollout',v_request);if v_replay is not null then return v_replay;end if;
  update public.sd_itinerary_rollout set main_enabled=p_main_enabled,ship_portal_enabled=p_ship_portal_enabled,version=version+1,updated_at=clock_timestamp(),updated_by=v_actor
  where workspace_id=v_workspace and version=p_expected_version returning version into v_version;
  if not found then raise exception using errcode='40001',message='version-conflict';end if;
  for v_role,v_value in select key,value from jsonb_each(p_role_permissions) loop
    if jsonb_typeof(v_value)<>'object' then raise exception using errcode='P0001',message='invalid-role-permissions';end if;
    insert into public.sd_itinerary_role_permissions(workspace_id,role,can_view,can_edit,can_import,can_export,can_calendar,version,updated_at,updated_by)
    values(v_workspace,v_role,coalesce((v_value->>'view')::boolean,false),coalesce((v_value->>'edit')::boolean,false),coalesce((v_value->>'import')::boolean,false),coalesce((v_value->>'export')::boolean,false),coalesce((v_value->>'calendar')::boolean,false),1,clock_timestamp(),v_actor)
    on conflict(workspace_id,role) do update set can_view=excluded.can_view,can_edit=excluded.can_edit,can_import=excluded.can_import,can_export=excluded.can_export,can_calendar=excluded.can_calendar,version=public.sd_itinerary_role_permissions.version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  end loop;
  v_result:=jsonb_build_object('ok',true,'version',v_version,'mainEnabled',p_main_enabled,'shipPortalEnabled',p_ship_portal_enabled,'replayed',false);
  insert into public.sd_itinerary_operations(workspace_id,operation_id,actor_kind,actor_key,target_key,request_payload,request_hash,result)
  values(v_workspace,p_operation_id,'office',v_actor::text,'rollout',v_request,md5(v_request::text),v_result);
  return v_result;
end;$$;

alter table public.sd_itinerary_rollout enable row level security;
alter table public.sd_itinerary_role_permissions enable row level security;
alter table public.sd_itinerary_documents enable row level security;
alter table public.sd_itinerary_history enable row level security;
alter table public.sd_itinerary_leases enable row level security;
alter table public.sd_itinerary_operations enable row level security;

revoke all on table public.sd_itinerary_rollout,public.sd_itinerary_role_permissions,public.sd_itinerary_documents,public.sd_itinerary_history,public.sd_itinerary_leases,public.sd_itinerary_operations from public,anon,authenticated;

revoke all on function public.sd_itinerary_workspace_id(text),public.sd_itinerary_can_action(uuid,text),public.sd_itinerary_json_instant_valid(jsonb),public.sd_itinerary_rows_valid(jsonb),public.sd_itinerary_document_json(text,text,text,bigint,jsonb,timestamptz,text,text),public.sd_itinerary_operation_replay(uuid,uuid,text,text,text,jsonb),public.sd_itinerary_claim_lease_internal(uuid,text,text,text,text,text,integer),public.sd_itinerary_assert_live_lease(uuid,text,text,text,uuid,text,bigint),public.sd_itinerary_document_for_vessel(uuid,text,text),public.sd_itinerary_renew_lease_internal(uuid,text,text,text,uuid,text,bigint,integer),public.sd_itinerary_release_lease_internal(uuid,text,text,text,uuid,text,bigint),public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint) from public,anon,authenticated;

revoke all on function public.sd_itinerary_get_rollout(text),public.sd_itinerary_get_office_entry(text,text),public.sd_itinerary_load_many(text,text[]),public.sd_itinerary_claim_office_lease(text,text,text,text,integer),public.sd_itinerary_renew_office_lease(text,text,uuid,text,bigint,integer),public.sd_itinerary_release_office_lease(text,text,uuid,text,bigint),public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text),public.sd_itinerary_operation_status_office(text,uuid),public.sd_itinerary_history(text,text,integer),public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.sd_itinerary_get_rollout(text),public.sd_itinerary_load_many(text,text[]),public.sd_itinerary_claim_office_lease(text,text,text,text,integer),public.sd_itinerary_renew_office_lease(text,text,uuid,text,bigint,integer),public.sd_itinerary_release_office_lease(text,text,uuid,text,bigint),public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text),public.sd_itinerary_operation_status_office(text,uuid),public.sd_itinerary_history(text,text,integer),public.sd_itinerary_owner_update_rollout(text,bigint,uuid,boolean,boolean,jsonb) to authenticated;
grant execute on function public.sd_itinerary_get_office_entry(text,text) to anon,authenticated;

revoke all on function public.sd_itinerary_get_public_rollout(text),public.sd_itinerary_public_list_vessels(text),public.sd_itinerary_public_load(text,text),public.sd_itinerary_claim_public_lease(text,text,text,text,integer),public.sd_itinerary_renew_public_lease(text,text,uuid,text,text,bigint,integer),public.sd_itinerary_release_public_lease(text,text,uuid,text,text,bigint),public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint),public.sd_itinerary_operation_status_public(text,uuid,text) from public,anon,authenticated;
grant execute on function public.sd_itinerary_get_public_rollout(text),public.sd_itinerary_public_list_vessels(text),public.sd_itinerary_public_load(text,text),public.sd_itinerary_claim_public_lease(text,text,text,text,integer),public.sd_itinerary_renew_public_lease(text,text,uuid,text,text,bigint,integer),public.sd_itinerary_release_public_lease(text,text,uuid,text,text,bigint),public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint),public.sd_itinerary_operation_status_public(text,uuid,text) to anon,authenticated;

commit;
