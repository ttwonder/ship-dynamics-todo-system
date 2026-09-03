-- READ ONLY: verifies the committed previous-port backfill and reports all
-- remaining exceptions without changing any row.
with target_workspaces as (
  select distinct d.workspace_id
  from public.sd_itinerary_documents d
  join public.sd_workspaces w on w.id = d.workspace_id and w.is_active
), raw as (
  select
    tw.workspace_id,
    left(tw.workspace_id::text, 8) as workspace_mask,
    v.id as vessel_id,
    v.name as vessel_name,
    regexp_replace(
      coalesce(v.position ->> 'lastPort', ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ) as source_previous_port,
    d.workspace_id is not null as has_document,
    d.revision,
    d.rows_payload,
    coalesce(d.alternative_plans_payload, '[]'::jsonb) as alternative_plans_payload,
    case
      when jsonb_typeof(d.rows_payload) = 'array' then jsonb_array_length(d.rows_payload)
      else null
    end as row_count,
    coalesce(d.rows_payload -> 0 ->> 'previousPortName', '') as itinerary_previous_port
  from target_workspaces tw
  join public.sd_vessels v on v.workspace_id = tw.workspace_id and v.is_active
  left join public.sd_itinerary_documents d
    on d.workspace_id = v.workspace_id and d.vessel_id = v.id
), prepared as (
  select
    raw.*,
    case
      when has_document
       and jsonb_typeof(rows_payload) = 'array'
       and jsonb_array_length(rows_payload) > 0
       and jsonb_typeof(rows_payload -> 0) = 'object'
      then jsonb_set(
        rows_payload,
        '{0,previousPortName}',
        to_jsonb(source_previous_port),
        true
      )
      else null
    end as candidate_rows
  from raw
), classified as (
  select
    prepared.*,
    case
      when not has_document then 'NO_FORMAL_DOCUMENT'
      when jsonb_typeof(rows_payload) is distinct from 'array'
        or coalesce(row_count, 0) = 0 then 'NO_FORMAL_ROWS'
      when jsonb_typeof(rows_payload -> 0) is distinct from 'object' then 'INVALID_DOCUMENT'
      when source_previous_port = '' then 'SOURCE_EMPTY'
      when itinerary_previous_port ~ '[^[:space:]]'
        and btrim(itinerary_previous_port) = source_previous_port then 'MATCHED'
      when itinerary_previous_port ~ '[^[:space:]]' then 'PRESERVED_DIFFERENT_VALUE'
      when length(source_previous_port) > 240 then 'SOURCE_TOO_LONG'
      when public.sd_itinerary_rows_valid(candidate_rows) is not true
        or public.sd_itinerary_alternative_plans_valid(
          alternative_plans_payload,
          candidate_rows
        ) is not true then 'INVALID_DOCUMENT'
      else 'REMAINING_FILLABLE'
    end as status
  from prepared
), totals as (
  select
    count(*) filter (where status = 'MATCHED')::integer as matched,
    count(*) filter (where status = 'PRESERVED_DIFFERENT_VALUE')::integer as preserved_different_value,
    count(*) filter (where status = 'REMAINING_FILLABLE')::integer as remaining_fillable,
    count(*) filter (where status = 'SOURCE_EMPTY')::integer as source_empty,
    count(*) filter (where status = 'NO_FORMAL_DOCUMENT')::integer as no_formal_document,
    count(*) filter (where status = 'NO_FORMAL_ROWS')::integer as no_formal_rows,
    count(*) filter (where status = 'INVALID_DOCUMENT')::integer as invalid_document,
    count(*) filter (where status = 'SOURCE_TOO_LONG')::integer as source_too_long
  from classified
), history_receipts as (
  select h.workspace_id, h.vessel_id, h.operation_id
  from public.sd_itinerary_history h
  join target_workspaces tw on tw.workspace_id = h.workspace_id
  where h.actor_kind = 'office'
    and h.actor_label = '系統回填：船卡上一港'
), operation_receipts as (
  select o.workspace_id, o.target_key, o.operation_id
  from public.sd_itinerary_operations o
  join target_workspaces tw on tw.workspace_id = o.workspace_id
  where o.actor_kind = 'office'
    and o.actor_key = 'system:previous-port-backfill-v1'
    and coalesce((o.result ->> 'backfill')::boolean, false)
), receipts as (
  select
    (select count(*)::integer from history_receipts) as history_rows,
    (select count(*)::integer from operation_receipts) as operation_rows,
    (select count(*)::integer
     from history_receipts h
     where not exists (
       select 1
       from operation_receipts o
       where o.workspace_id = h.workspace_id
         and o.operation_id = h.operation_id
         and o.target_key = 'vessel:' || h.vessel_id
     )) as history_without_operation,
    (select count(*)::integer
     from operation_receipts o
     where not exists (
       select 1
       from history_receipts h
       where h.workspace_id = o.workspace_id
         and h.operation_id = o.operation_id
         and o.target_key = 'vessel:' || h.vessel_id
     )) as operation_without_history
)
select jsonb_build_object(
  'mode', 'READ_ONLY_READBACK',
  'targetWorkspaceCount', (select count(*)::integer from target_workspaces),
  'targetWorkspaceMasks', coalesce(
    (select jsonb_agg(left(workspace_id::text, 8) order by workspace_id) from target_workspaces),
    '[]'::jsonb
  ),
  'verified',
    (select count(*) = 1 from target_workspaces)
    and (select remaining_fillable = 0 from totals)
    and (select history_without_operation = 0 from receipts)
    and (select operation_without_history = 0 from receipts),
  'totals', jsonb_build_object(
    'matched', (select matched from totals),
    'preservedDifferentValue', (select preserved_different_value from totals),
    'remainingFillable', (select remaining_fillable from totals),
    'sourceEmpty', (select source_empty from totals),
    'noFormalDocument', (select no_formal_document from totals),
    'noFormalRows', (select no_formal_rows from totals),
    'invalidDocument', (select invalid_document from totals),
    'sourceTooLong', (select source_too_long from totals),
    'backfillHistoryRows', (select history_rows from receipts),
    'backfillOperationRows', (select operation_rows from receipts),
    'historyWithoutOperation', (select history_without_operation from receipts),
    'operationWithoutHistory', (select operation_without_history from receipts)
  ),
  'details', coalesce((
    select jsonb_agg(jsonb_build_object(
      'workspace', workspace_mask,
      'vesselId', vessel_id,
      'vesselName', vessel_name,
      'shipCardPreviousPort', source_previous_port,
      'itineraryPreviousPort', itinerary_previous_port,
      'revision', revision,
      'rowCount', row_count,
      'status', status
    ) order by vessel_name, vessel_id)
    from classified
  ), '[]'::jsonb)
) as previous_port_backfill_readback;
