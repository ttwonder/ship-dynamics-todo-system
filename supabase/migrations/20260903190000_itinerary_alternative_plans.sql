begin;

alter table public.sd_itinerary_documents
  add column if not exists alternative_plans_payload jsonb not null default '[]'::jsonb;

alter table public.sd_itinerary_history
  add column if not exists alternative_plans_payload jsonb not null default '[]'::jsonb;

create or replace function public.sd_itinerary_alternative_plans_valid(p_plans jsonb, p_rows jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_plan jsonb;
  v_alt_rows jsonb;
  v_row jsonb;
  v_plan_index integer := 0;
  v_plan_id text;
  v_row_id text;
  v_seen_plan_ids text[] := array[]::text[];
  v_seen_row_ids text[] := array[]::text[];
begin
  if jsonb_typeof(p_plans) is distinct from 'array'
     or jsonb_array_length(p_plans) > 5
     or public.sd_itinerary_rows_valid(p_rows) is not true then
    return false;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_seen_row_ids := array_append(v_seen_row_ids, v_row ->> 'rowId');
  end loop;

  for v_plan in select value from jsonb_array_elements(p_plans) loop
    if jsonb_typeof(v_plan) is distinct from 'object'
       or not (v_plan ?& array['planId','sortOrder','rows'])
       or (select count(*) from jsonb_object_keys(v_plan)) <> 3
       or jsonb_typeof(v_plan -> 'planId') is distinct from 'string'
       or length(v_plan ->> 'planId') not between 1 and 120
       or (v_plan ->> 'planId') !~ '[^[:space:]]'
       or jsonb_typeof(v_plan -> 'sortOrder') is distinct from 'number'
       or (v_plan ->> 'sortOrder') !~ '^(0|[1-9][0-9]*)$' then
      return false;
    end if;

    v_plan_id := v_plan ->> 'planId';
    if (v_plan ->> 'sortOrder')::integer <> v_plan_index
       or v_plan_id = any(v_seen_plan_ids) then
      return false;
    end if;
    v_seen_plan_ids := array_append(v_seen_plan_ids, v_plan_id);

    v_alt_rows := v_plan -> 'rows';
    if public.sd_itinerary_rows_valid(v_alt_rows) is not true
       or coalesce(v_alt_rows -> 0 ->> 'previousPortName', '') <> ''
       or coalesce(v_alt_rows -> 0 ->> 'calculationStartUtc', '') <> coalesce(p_rows -> 0 ->> 'calculationStartUtc', '')
       or coalesce(v_alt_rows -> 0 ->> 'calculationStartTimeZone', '') <> coalesce(p_rows -> 0 ->> 'calculationStartTimeZone', '') then
      return false;
    end if;

    for v_row in select value from jsonb_array_elements(v_alt_rows) loop
      v_row_id := v_row ->> 'rowId';
      if v_row_id = any(v_seen_row_ids) then return false; end if;
      v_seen_row_ids := array_append(v_seen_row_ids, v_row_id);
    end loop;
    v_plan_index := v_plan_index + 1;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.sd_itinerary_document_json(
  p_workspace_key text,
  p_vessel_id text,
  p_vessel_name text,
  p_revision bigint,
  p_rows jsonb,
  p_alternative_plans jsonb,
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
    'rows',p_rows,'alternativePlans',coalesce(p_alternative_plans,'[]'::jsonb)
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
declare
  v_operation public.sd_itinerary_operations%rowtype;
  v_request_matches boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':itinerary-op:' || p_operation_id::text,0));
  select * into v_operation from public.sd_itinerary_operations o
  where o.workspace_id=p_workspace_id and o.operation_id=p_operation_id for update;
  if not found then return null; end if;

  if v_operation.actor_kind <> p_actor_kind
     or v_operation.actor_key <> p_actor_key
     or v_operation.target_key <> p_target_key then
    raise exception using errcode='P0001', message='operation-mismatch';
  end if;

  v_request_matches := v_operation.request_payload = p_request
    or (
      p_target_key like 'vessel:%'
      and not (v_operation.request_payload ? 'alternativePlans')
      and p_request ? 'alternativePlans'
      and (p_request -> 'alternativePlans' = '[]'::jsonb or p_request -> 'alternativePlans' = 'null'::jsonb)
      and v_operation.request_payload = p_request - 'alternativePlans'
    );
  if not v_request_matches then
    raise exception using errcode='P0001', message='operation-mismatch';
  end if;

  return v_operation.result || jsonb_build_object('replayed',true);
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
    p_workspace_key,v.id,v.name,d.revision,d.rows_payload,d.alternative_plans_payload,
    d.updated_at,d.updated_actor_kind,d.updated_actor_label
  ) end
  from public.sd_vessels v left join public.sd_itinerary_documents d
    on d.workspace_id=v.workspace_id and d.vessel_id=v.id
  where v.workspace_id=p_workspace_id and v.id=p_vessel_id and v.is_active
$$;

create or replace function public.sd_itinerary_save_internal(
  p_workspace_key text,p_vessel_id text,p_expected_revision bigint,p_operation_id uuid,p_rows jsonb,
  p_actor_kind text,p_actor_key text,p_actor_id uuid,p_actor_label text,
  p_lease_id uuid,p_holder_session text,p_fencing_token bigint,p_alternative_plans jsonb
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
  v_existing_alternatives jsonb:='[]'::jsonb;
  v_saved_alternatives jsonb;
begin
  if v_workspace is null or p_operation_id is null or not public.sd_itinerary_rows_valid(p_rows) then
    raise exception using errcode='P0001',message='invalid-itinerary-payload';
  end if;
  if p_alternative_plans is not null
     and public.sd_itinerary_alternative_plans_valid(p_alternative_plans,p_rows) is not true then
    raise exception using errcode='P0001',message='invalid-itinerary-payload';
  end if;
  v_request:=jsonb_build_object(
    'vesselId',p_vessel_id,'expectedRevision',p_expected_revision,'rows',p_rows,
    'alternativePlans',p_alternative_plans
  );
  v_replay:=public.sd_itinerary_operation_replay(v_workspace,p_operation_id,p_actor_kind,p_actor_key,'vessel:'||p_vessel_id,v_request);
  if v_replay is not null then return v_replay;end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||':itinerary:'||p_vessel_id,0));
  perform public.sd_itinerary_assert_live_lease(v_workspace,p_vessel_id,p_actor_kind,p_actor_key,p_lease_id,p_holder_session,p_fencing_token);
  select v.name into v_name from public.sd_vessels v where v.workspace_id=v_workspace and v.id=p_vessel_id and v.is_active;
  if not found then raise exception using errcode='P0001',message='not-authorized';end if;
  select d.revision,d.alternative_plans_payload into v_current,v_existing_alternatives
  from public.sd_itinerary_documents d
  where d.workspace_id=v_workspace and d.vessel_id=p_vessel_id
  for update;
  v_current:=coalesce(v_current,0);
  v_existing_alternatives:=coalesce(v_existing_alternatives,'[]'::jsonb);
  if v_current<>p_expected_revision then
    raise exception using errcode='40001',message='revision-conflict',detail=v_current::text;
  end if;
  v_saved_alternatives:=case when p_alternative_plans is null then v_existing_alternatives else p_alternative_plans end;
  if p_alternative_plans is null
     and public.sd_itinerary_alternative_plans_valid(v_saved_alternatives,p_rows) is not true then
    raise exception using errcode='P0001',message='alternative-anchor-sync-required';
  end if;
  v_next:=v_current+1;
  insert into public.sd_itinerary_documents(
    workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,
    updated_at,updated_actor_kind,updated_actor_id,updated_actor_label
  ) values(
    v_workspace,p_vessel_id,v_next,1,p_rows,v_saved_alternatives,
    v_now,p_actor_kind,p_actor_id,left(coalesce(p_actor_label,''),120)
  )
  on conflict(workspace_id,vessel_id) do update set
    revision=excluded.revision,rows_payload=excluded.rows_payload,
    alternative_plans_payload=excluded.alternative_plans_payload,
    updated_at=excluded.updated_at,updated_actor_kind=excluded.updated_actor_kind,
    updated_actor_id=excluded.updated_actor_id,updated_actor_label=excluded.updated_actor_label;
  insert into public.sd_itinerary_history(
    workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,
    actor_kind,actor_id,actor_label,operation_id,created_at
  ) values(
    v_workspace,p_vessel_id,v_next,1,p_rows,v_saved_alternatives,
    p_actor_kind,p_actor_id,left(coalesce(p_actor_label,''),120),p_operation_id,v_now
  );
  v_result:=jsonb_build_object(
    'ok',true,
    'document',public.sd_itinerary_document_json(
      p_workspace_key,p_vessel_id,v_name,v_next,p_rows,v_saved_alternatives,
      v_now,p_actor_kind,left(coalesce(p_actor_label,''),120)
    ),
    'revision',v_next,'replayed',false
  );
  insert into public.sd_itinerary_operations(
    workspace_id,operation_id,actor_kind,actor_key,target_key,request_payload,request_hash,result,committed_at
  ) values(
    v_workspace,p_operation_id,p_actor_kind,p_actor_key,'vessel:'||p_vessel_id,
    v_request,md5(v_request::text),v_result,v_now
  );
  perform public.sd_itinerary_release_lease_internal(
    v_workspace,p_vessel_id,p_actor_kind,p_actor_key,p_lease_id,p_holder_session,p_fencing_token
  );
  return v_result;
end;
$$;

create or replace function public.sd_itinerary_save_internal(
  p_workspace_key text,p_vessel_id text,p_expected_revision bigint,p_operation_id uuid,p_rows jsonb,
  p_actor_kind text,p_actor_key text,p_actor_id uuid,p_actor_label text,
  p_lease_id uuid,p_holder_session text,p_fencing_token bigint
)
returns jsonb
language sql
volatile
security definer
set search_path=pg_catalog,public
as $$
  select public.sd_itinerary_save_internal(
    p_workspace_key,p_vessel_id,p_expected_revision,p_operation_id,p_rows,
    p_actor_kind,p_actor_key,p_actor_id,p_actor_label,
    p_lease_id,p_holder_session,p_fencing_token,null
  )
$$;

create or replace function public.sd_itinerary_history(p_workspace_key text,p_vessel_id text,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_workspace uuid:=public.sd_itinerary_workspace_id(p_workspace_key);v_result jsonb;begin
  if not public.sd_itinerary_can_action(v_workspace,'view') then raise exception using errcode='P0001',message='not-authorized';end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'revision',h.revision,'rows',h.rows_payload,'alternativePlans',h.alternative_plans_payload,
    'actorKind',h.actor_kind,'actorLabel',h.actor_label,'operationId',h.operation_id,'createdAt',h.created_at
  ) order by h.revision desc),'[]'::jsonb)
  into v_result from (
    select * from public.sd_itinerary_history
    where workspace_id=v_workspace and vessel_id=p_vessel_id
    order by revision desc limit least(greatest(p_limit,1),100)
  ) h;
  return v_result;
end;
$$;

drop function if exists public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text);

create or replace function public.sd_itinerary_main_save(
  p_workspace_key text,
  p_vessel_id text,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_rows jsonb,
  p_lease_id uuid,
  p_holder_session text,
  p_fencing_token bigint,
  p_actor_label text,
  p_actor_user_id text,
  p_alternative_plans jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_main_actor(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_save_internal(
    p_workspace_key, p_vessel_id, p_expected_revision, p_operation_id, p_rows,
    'office', v_actor ->> 'actorKey', nullif(v_actor ->> 'actorUuid', '')::uuid,
    v_actor ->> 'displayName', p_lease_id, p_holder_session, p_fencing_token,
    p_alternative_plans
  );
end;
$$;

drop function if exists public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint);

create or replace function public.sd_itinerary_save_public(
  p_workspace_key text,
  p_vessel_id text,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_rows jsonb,
  p_lease_id uuid,
  p_actor_key text,
  p_holder_session text,
  p_fencing_token bigint,
  p_alternative_plans jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_previous_port text;
begin
  if not coalesce((select ship_portal_enabled from public.sd_itinerary_rollout where workspace_id=v_workspace),false) then
    raise exception using errcode='P0001',message='portal-disabled';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then
    raise exception using errcode='P0001',message='invalid-itinerary-payload';
  end if;
  v_previous_port := p_rows -> 0 ->> 'previousPortName';
  if v_previous_port is null or v_previous_port !~ '[^[:space:]]' then
    raise exception using errcode='P0001',message='previous-port-required';
  end if;
  return public.sd_itinerary_save_internal(
    p_workspace_key,p_vessel_id,p_expected_revision,p_operation_id,p_rows,
    'public',p_actor_key,null,'船端使用者',p_lease_id,p_holder_session,p_fencing_token,
    p_alternative_plans
  );
end;
$$;

revoke all on function public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb) to anon, authenticated;
revoke all on function public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb) to anon, authenticated;

revoke all on function public.sd_itinerary_document_json(text,text,text,bigint,jsonb,jsonb,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.sd_itinerary_alternative_plans_valid(jsonb,jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
