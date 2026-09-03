-- ONE-TIME ATOMIC BACKFILL.
-- Copies only nonblank sd_vessels.position.lastPort values into blank
-- previousPortName fields on the first row of existing formal Itineraries.
-- Existing nonblank values, alternative plans, missing documents, empty rows,
-- inactive vessels, and invalid payloads are never overwritten.
create or replace function pg_temp.ship_dynamics_backfill_itinerary_previous_ports()
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_target_count integer;
  v_workspace uuid;
  v_vessel_id text;
  v_vessel public.sd_vessels%rowtype;
  v_document public.sd_itinerary_documents%rowtype;
  v_source text;
  v_existing text;
  v_new_rows jsonb;
  v_new_revision bigint;
  v_now timestamptz;
  v_operation_id uuid;
  v_request jsonb;
  v_result jsonb;
  v_updated integer := 0;
  v_details jsonb := '[]'::jsonb;
begin
  select count(*)::integer, (array_agg(workspace_id order by workspace_id))[1]
  into v_target_count, v_workspace
  from (
    select distinct d.workspace_id
    from public.sd_itinerary_documents d
    join public.sd_workspaces w on w.id = d.workspace_id and w.is_active
  ) target;

  if v_target_count <> 1 or v_workspace is null then
    raise exception using
      errcode = 'P0001',
      message = 'expected-exactly-one-active-itinerary-workspace',
      detail = coalesce(v_target_count, 0)::text;
  end if;

  for v_vessel_id in
    select v.id
    from public.sd_vessels v
    where v.workspace_id = v_workspace and v.is_active
    order by v.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_workspace::text || ':itinerary:' || v_vessel_id, 0)
    );

    select * into strict v_vessel
    from public.sd_vessels v
    where v.workspace_id = v_workspace
      and v.id = v_vessel_id
      and v.is_active
    for update;

    select * into v_document
    from public.sd_itinerary_documents d
    where d.workspace_id = v_workspace and d.vessel_id = v_vessel_id
    for update;

    if not found then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'status', 'NO_FORMAL_DOCUMENT'
      ));
      continue;
    end if;

    if jsonb_typeof(v_document.rows_payload) is distinct from 'array'
       or jsonb_array_length(v_document.rows_payload) = 0 then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'revision', v_document.revision,
        'status', 'NO_FORMAL_ROWS'
      ));
      continue;
    end if;

    if jsonb_typeof(v_document.rows_payload -> 0) is distinct from 'object' then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'revision', v_document.revision,
        'status', 'INVALID_DOCUMENT'
      ));
      continue;
    end if;

    v_source := regexp_replace(
      coalesce(v_vessel.position ->> 'lastPort', ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    );
    v_existing := coalesce(v_document.rows_payload -> 0 ->> 'previousPortName', '');

    if v_source = '' then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'revision', v_document.revision,
        'status', 'SOURCE_EMPTY'
      ));
      continue;
    end if;

    if v_existing ~ '[^[:space:]]' then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'shipCardPreviousPort', v_source,
        'itineraryPreviousPort', v_existing,
        'revision', v_document.revision,
        'status', 'ALREADY_SET'
      ));
      continue;
    end if;

    if length(v_source) > 240 then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'revision', v_document.revision,
        'status', 'SOURCE_TOO_LONG'
      ));
      continue;
    end if;

    -- Lock the lease row regardless of its currently visible expiry. This waits
    -- for an in-flight renew/release before the live-lease decision below.
    perform 1
    from public.sd_itinerary_leases l
    where l.workspace_id = v_workspace
      and l.vessel_id = v_vessel.id
    for update;

    if exists (
      select 1
      from public.sd_itinerary_leases l
      where l.workspace_id = v_workspace
        and l.vessel_id = v_vessel.id
        and l.expires_at > clock_timestamp()
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'active-itinerary-lease',
        detail = v_vessel.id;
    end if;

    v_new_rows := jsonb_set(
      v_document.rows_payload,
      '{0,previousPortName}',
      to_jsonb(v_source),
      true
    );

    if public.sd_itinerary_rows_valid(v_new_rows) is not true
       or public.sd_itinerary_alternative_plans_valid(
         coalesce(v_document.alternative_plans_payload, '[]'::jsonb),
         v_new_rows
       ) is not true then
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'vesselId', v_vessel.id,
        'vesselName', v_vessel.name,
        'revision', v_document.revision,
        'status', 'INVALID_DOCUMENT'
      ));
      continue;
    end if;

    v_now := clock_timestamp();
    v_new_revision := v_document.revision + 1;
    v_operation_id := gen_random_uuid();
    v_request := jsonb_build_object(
      'kind', 'previous-port-backfill-v1',
      'vesselId', v_vessel.id,
      'expectedRevision', v_document.revision,
      'sourceVesselVersion', v_vessel.version,
      'rows', v_new_rows,
      'alternativePlans', coalesce(v_document.alternative_plans_payload, '[]'::jsonb)
    );
    v_result := jsonb_build_object(
      'ok', true,
      'backfill', true,
      'revision', v_new_revision,
      'replayed', false
    );

    update public.sd_itinerary_documents
    set revision = v_new_revision,
        rows_payload = v_new_rows,
        updated_at = v_now,
        updated_actor_kind = 'office',
        updated_actor_id = null,
        updated_actor_label = '系統回填：船卡上一港'
    where workspace_id = v_workspace
      and vessel_id = v_vessel.id
      and revision = v_document.revision;

    if not found then
      raise exception using errcode = '40001', message = 'revision-conflict';
    end if;

    insert into public.sd_itinerary_history(
      workspace_id, vessel_id, revision, schema_version, rows_payload,
      alternative_plans_payload, actor_kind, actor_id, actor_label,
      operation_id, created_at
    ) values (
      v_workspace, v_vessel.id, v_new_revision, v_document.schema_version,
      v_new_rows, coalesce(v_document.alternative_plans_payload, '[]'::jsonb),
      'office', null, '系統回填：船卡上一港', v_operation_id, v_now
    );

    insert into public.sd_itinerary_operations(
      workspace_id, operation_id, actor_kind, actor_key, target_key,
      request_payload, request_hash, result, committed_at
    ) values (
      v_workspace, v_operation_id, 'office',
      'system:previous-port-backfill-v1', 'vessel:' || v_vessel.id,
      v_request, md5(v_request::text), v_result, v_now
    );

    v_updated := v_updated + 1;
    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'vesselId', v_vessel.id,
      'vesselName', v_vessel.name,
      'previousPortName', v_source,
      'previousRevision', v_document.revision,
      'newRevision', v_new_revision,
      'status', 'FILLED'
    ));
  end loop;

  return jsonb_build_object(
    'mode', 'BACKFILL_COMMITTED',
    'workspace', left(v_workspace::text, 8),
    'updatedCount', v_updated,
    'details', v_details
  );
end;
$$;

select pg_temp.ship_dynamics_backfill_itinerary_previous_ports()
  as previous_port_backfill_result;
