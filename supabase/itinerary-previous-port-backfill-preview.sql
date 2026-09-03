-- READ ONLY: previews copying each active vessel card's current previous port
-- into the blank first row of its latest formal Itinerary document.
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
    coalesce(d.rows_payload -> 0 ->> 'previousPortName', '') as itinerary_previous_port,
    exists (
      select 1
      from public.sd_itinerary_leases l
      where l.workspace_id = tw.workspace_id
        and l.vessel_id = v.id
        and l.expires_at > clock_timestamp()
    ) as has_active_lease
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
      when itinerary_previous_port ~ '[^[:space:]]' then 'ALREADY_SET'
      when length(source_previous_port) > 240 then 'SOURCE_TOO_LONG'
      when has_active_lease then 'ACTIVE_LEASE'
      when public.sd_itinerary_rows_valid(candidate_rows) is not true
        or public.sd_itinerary_alternative_plans_valid(
          alternative_plans_payload,
          candidate_rows
        ) is not true then 'INVALID_DOCUMENT'
      else 'READY_TO_FILL'
    end as status
  from prepared
), totals as (
  select
    count(*) filter (where status = 'READY_TO_FILL')::integer as ready_to_fill,
    count(*) filter (where status = 'ALREADY_SET')::integer as already_set,
    count(*) filter (where status = 'SOURCE_EMPTY')::integer as source_empty,
    count(*) filter (where status = 'NO_FORMAL_DOCUMENT')::integer as no_formal_document,
    count(*) filter (where status = 'NO_FORMAL_ROWS')::integer as no_formal_rows,
    count(*) filter (where status = 'INVALID_DOCUMENT')::integer as invalid_document,
    count(*) filter (where status = 'SOURCE_TOO_LONG')::integer as source_too_long,
    count(*) filter (where status = 'ACTIVE_LEASE')::integer as active_lease
  from classified
), inactive as (
  select count(*)::integer as inactive_vessels
  from target_workspaces tw
  join public.sd_vessels v on v.workspace_id = tw.workspace_id
  where not v.is_active
)
select jsonb_build_object(
  'mode', 'READ_ONLY_PREVIEW',
  'targetWorkspaceCount', (select count(*)::integer from target_workspaces),
  'targetWorkspaceMasks', coalesce(
    (select jsonb_agg(left(workspace_id::text, 8) order by workspace_id) from target_workspaces),
    '[]'::jsonb
  ),
  'safeToRun',
    (select count(*) = 1 from target_workspaces)
    and (select active_lease = 0 from totals),
  'totals', jsonb_build_object(
    'readyToFill', (select ready_to_fill from totals),
    'alreadySet', (select already_set from totals),
    'sourceEmpty', (select source_empty from totals),
    'noFormalDocument', (select no_formal_document from totals),
    'noFormalRows', (select no_formal_rows from totals),
    'invalidDocument', (select invalid_document from totals),
    'sourceTooLong', (select source_too_long from totals),
    'activeLease', (select active_lease from totals),
    'inactiveVessels', (select inactive_vessels from inactive)
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
) as previous_port_backfill_preview;
