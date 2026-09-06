-- DEVELOPMENT ONLY. Requires record_read and the existing alternative-plans migration.
-- Same sd_* document/lease/operation/history authority, current record actor first.
-- Additive private wrappers only: no legacy override, AppData writes, GUC or browser grants.
begin;

create or replace function public.sd_itinerary_record_claim_lease_v1(
  p_workspace_key text,
  p_vessel_id text,
  p_holder_session text,
  p_holder_label text,
  p_ttl_seconds integer,
  p_actor_user_id text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_claim_lease_internal(
    (v_actor ->> 'workspaceId')::uuid,
    p_vessel_id,
    'office',
    v_actor ->> 'actorKey',
    p_holder_session,
    v_actor ->> 'displayName',
    p_ttl_seconds
  );
end;
$$;

create or replace function public.sd_itinerary_record_renew_lease_v1(
  p_workspace_key text,
  p_vessel_id text,
  p_lease_id uuid,
  p_holder_session text,
  p_fencing_token bigint,
  p_ttl_seconds integer,
  p_actor_user_id text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_renew_lease_internal(
    (v_actor ->> 'workspaceId')::uuid,
    p_vessel_id,
    'office',
    v_actor ->> 'actorKey',
    p_lease_id,
    p_holder_session,
    p_fencing_token,
    p_ttl_seconds
  );
end;
$$;

create or replace function public.sd_itinerary_record_release_lease_v1(
  p_workspace_key text,
  p_vessel_id text,
  p_lease_id uuid,
  p_holder_session text,
  p_fencing_token bigint,
  p_actor_user_id text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_release_lease_internal(
    (v_actor ->> 'workspaceId')::uuid,
    p_vessel_id,
    'office',
    v_actor ->> 'actorKey',
    p_lease_id,
    p_holder_session,
    p_fencing_token
  );
end;
$$;

create or replace function public.sd_itinerary_record_save_v1(
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
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
begin
  return public.sd_itinerary_save_internal(
    p_workspace_key, p_vessel_id, p_expected_revision, p_operation_id, p_rows,
    'office', v_actor ->> 'actorKey', nullif(v_actor ->> 'actorUuid', '')::uuid,
    v_actor ->> 'displayName', p_lease_id, p_holder_session, p_fencing_token,
    p_alternative_plans
  );
end;
$$;

create or replace function public.sd_itinerary_record_operation_status_v1(
  p_workspace_key text,
  p_operation_id uuid,
  p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_result jsonb;
begin
  select operation.result
  into v_result
  from public.sd_itinerary_operations operation
  where operation.workspace_id = (v_actor ->> 'workspaceId')::uuid
    and operation.operation_id = p_operation_id
    and operation.actor_key = v_actor ->> 'actorKey';
  return coalesce(v_result, jsonb_build_object('status', 'missing'));
end;
$$;

revoke all on function public.sd_itinerary_record_claim_lease_v1(text,text,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_record_renew_lease_v1(text,text,uuid,text,bigint,integer,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_record_release_lease_v1(text,text,uuid,text,bigint,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_record_save_v1(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.sd_itinerary_record_operation_status_v1(text,uuid,text) from public, anon, authenticated;
commit;
