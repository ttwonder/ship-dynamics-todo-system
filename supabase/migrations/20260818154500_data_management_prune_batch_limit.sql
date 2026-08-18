-- Ship Dynamics 歷史版本大批清理保護。
-- 單一 RPC 最多刪除 100 份；前端可跨頁累積後自動拆成多個冪等批次。
-- 安裝本檔只替換 prune RPC，不執行任何刪除；可重跑。

begin;

create or replace function public.prune_ship_dynamics_revision_history(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_revisions jsonb,
  p_delete_revisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_row public.ship_dynamics_app_state%rowtype;
  actor_role text;
  operation_row public.ship_dynamics_data_management_operations%rowtype;
  normalized_expected jsonb := '[]'::jsonb;
  normalized_delete jsonb := '[]'::jsonb;
  current_revisions jsonb := '[]'::jsonb;
  request_payload jsonb;
  response jsonb;
  expected_count integer := 0;
  expected_distinct_count integer := 0;
  delete_count integer := 0;
  delete_distinct_count integer := 0;
  current_count integer := 0;
  deleted_count integer := 0;
  deleted_bytes bigint := 0;
begin
  if p_operation_id is null
    or jsonb_typeof(p_expected_revisions) is distinct from 'array'
    or jsonb_typeof(p_delete_revisions) is distinct from 'array'
    or jsonb_array_length(p_expected_revisions) < 1
    or jsonb_array_length(p_delete_revisions) < 1
    or exists (
      select 1 from jsonb_array_elements(p_expected_revisions) value
      where jsonb_typeof(value) <> 'number'
        or value #>> '{}' !~ '^[1-9][0-9]{0,9}$'
        or case
          when value #>> '{}' ~ '^[1-9][0-9]{0,9}$'
            then (value #>> '{}')::numeric > 2147483647
          else false
        end
    )
    or exists (
      select 1 from jsonb_array_elements(p_delete_revisions) value
      where jsonb_typeof(value) <> 'number'
        or value #>> '{}' !~ '^[1-9][0-9]{0,9}$'
        or case
          when value #>> '{}' ~ '^[1-9][0-9]{0,9}$'
            then (value #>> '{}')::numeric > 2147483647
          else false
        end
    ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select coalesce(jsonb_agg(to_jsonb(revision_value) order by revision_value), '[]'::jsonb),
         count(*)::integer,
         count(distinct revision_value)::integer
  into normalized_expected, expected_count, expected_distinct_count
  from (
    select (value #>> '{}')::integer as revision_value
    from jsonb_array_elements(p_expected_revisions) value
  ) normalized;

  select coalesce(jsonb_agg(to_jsonb(revision_value) order by revision_value), '[]'::jsonb),
         count(*)::integer,
         count(distinct revision_value)::integer
  into normalized_delete, delete_count, delete_distinct_count
  from (
    select (value #>> '{}')::integer as revision_value
    from jsonb_array_elements(p_delete_revisions) value
  ) normalized;

  if expected_count <> expected_distinct_count or delete_count <> delete_distinct_count then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;
  if delete_count > 100 then
    return jsonb_build_object(
      'ok', false,
      'error', 'BATCH_LIMIT_EXCEEDED',
      'maximumDeleteCount', 100,
      'requestedDeleteCount', delete_count
    );
  end if;

  select * into current_row
  from public.ship_dynamics_app_state
  where workspace_key = p_workspace_key
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'WORKSPACE_NOT_FOUND');
  end if;

  select item ->> 'role' into actor_role
  from jsonb_array_elements(
    case when jsonb_typeof(current_row.payload -> 'users') = 'array'
      then current_row.payload -> 'users' else '[]'::jsonb end
  ) item
  where item ->> 'id' = p_actor_user_id
    and coalesce((item ->> 'isActive')::boolean, false)
  limit 1;
  if actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;

  request_payload := jsonb_build_object(
    'expectedRevisions', normalized_expected,
    'deleteRevisions', normalized_delete
  );

  insert into public.ship_dynamics_data_management_operations(
    operation_id, workspace_key, actor_user_id, command_type, request_payload, status
  ) values (
    p_operation_id, p_workspace_key, p_actor_user_id,
    'prune_revision_history', request_payload, 'STARTED'
  ) on conflict (operation_id) do nothing;

  select * into operation_row
  from public.ship_dynamics_data_management_operations
  where operation_id = p_operation_id
  for update;

  if operation_row.workspace_key <> p_workspace_key
    or operation_row.actor_user_id <> p_actor_user_id
    or operation_row.command_type <> 'prune_revision_history'
    or operation_row.request_payload is distinct from request_payload then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_MISMATCH');
  end if;
  if operation_row.status in ('COMMITTED', 'REJECTED') then
    return operation_row.result;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r.revision) order by r.revision), '[]'::jsonb), count(*)::integer
  into current_revisions, current_count
  from public.ship_dynamics_app_revisions r
  where r.workspace_key = p_workspace_key;

  if current_revisions is distinct from normalized_expected then
    response := jsonb_build_object(
      'ok', false,
      'error', 'REVISION_SET_CHANGED',
      'currentRevisionCount', current_count
    );
    update public.ship_dynamics_data_management_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  if not (current_revisions @> jsonb_build_array(current_row.revision)) then
    response := jsonb_build_object('ok', false, 'error', 'CURRENT_REVISION_HISTORY_MISSING');
    update public.ship_dynamics_data_management_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  if normalized_delete @> jsonb_build_array(current_row.revision) then
    response := jsonb_build_object('ok', false, 'error', 'CURRENT_REVISION_PROTECTED');
    update public.ship_dynamics_data_management_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(normalized_delete) selected(revision_text)
    where not (current_revisions @> jsonb_build_array((selected.revision_text)::integer))
  ) or current_count - delete_count < 1 then
    response := jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
    update public.ship_dynamics_data_management_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  select count(*)::integer, coalesce(sum((
    pg_column_size(r.payload)
    + pg_column_size(r.workspace_key)
    + pg_column_size(r.revision)
    + coalesce(pg_column_size(r.saved_by), 0)
    + pg_column_size(r.saved_at)
  )::bigint), 0)::bigint
  into deleted_count, deleted_bytes
  from public.ship_dynamics_app_revisions r
  where r.workspace_key = p_workspace_key
    and r.revision in (
      select revision_text::integer
      from jsonb_array_elements_text(normalized_delete) selected(revision_text)
    );

  if deleted_count <> delete_count then
    response := jsonb_build_object('ok', false, 'error', 'REVISION_SET_CHANGED');
    update public.ship_dynamics_data_management_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  delete from public.ship_dynamics_app_revisions r
  where r.workspace_key = p_workspace_key
    and r.revision in (
      select revision_text::integer
      from jsonb_array_elements_text(normalized_delete) selected(revision_text)
    );

  response := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'deletedCount', deleted_count,
    'deletedBytes', deleted_bytes,
    'deletedRevisions', normalized_delete,
    'remainingRevisionCount', current_count - deleted_count,
    'currentRevision', current_row.revision
  );
  update public.ship_dynamics_data_management_operations
  set status = 'COMMITTED', result = response, completed_at = clock_timestamp()
  where operation_id = p_operation_id;
  return response;
end;
$$;

revoke execute on function public.prune_ship_dynamics_revision_history(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.prune_ship_dynamics_revision_history(text, text, uuid, jsonb, jsonb) to anon, authenticated;

commit;
