-- Ship Dynamics：Supabase 用量、單項邏輯量與歷史 revision 選擇性清理。
-- 現行正式入口仍使用 public.ship_dynamics_app_state whole-AppData authority；
-- 本 migration 只清理 public.ship_dynamics_app_revisions，不刪正式業務內容。

begin;

create table if not exists public.ship_dynamics_data_management_operations (
  operation_id uuid primary key,
  workspace_key text not null,
  actor_user_id text not null,
  command_type text not null,
  request_payload jsonb not null,
  status text not null check (status in ('STARTED', 'COMMITTED', 'REJECTED')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.ship_dynamics_data_management_operations enable row level security;
revoke all on table public.ship_dynamics_data_management_operations from public, anon, authenticated;

create or replace function public.get_ship_dynamics_storage_stats(
  p_workspace_key text,
  p_actor_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_row public.ship_dynamics_app_state%rowtype;
  actor_role text;
  database_total_bytes bigint := 0;
  app_database_physical_bytes bigint := 0;
  storage_object_bytes bigint := 0;
  storage_object_count bigint := 0;
  current_state_bytes bigint := 0;
  revision_history_bytes bigint := 0;
  revision_history_count bigint := 0;
  revision_rows jsonb := '[]'::jsonb;
  collection_rows jsonb := '[]'::jsonb;
  item_rows_json jsonb := '[]'::jsonb;
begin
  select * into current_row
  from public.ship_dynamics_app_state
  where workspace_key = p_workspace_key;
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
  if actor_role is null or actor_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select pg_database_size(current_database())::bigint
  into database_total_bytes;

  select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint
  into app_database_physical_bytes
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'm')
    and (
      c.relname like 'ship\_dynamics\_%' escape '\'
      or c.relname like 'sd\_%' escape '\'
    );

  if to_regclass('storage.objects') is not null then
    execute $storage$
      select
        count(*)::bigint,
        coalesce(sum(
          case
            when coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
              then (metadata ->> 'size')::bigint
            else 0
          end
        ), 0)::bigint
      from storage.objects
    $storage$
    into storage_object_count, storage_object_bytes;
  end if;

  select (
    pg_column_size(s.payload)
    + pg_column_size(s.workspace_key)
    + pg_column_size(s.revision)
    + pg_column_size(s.updated_at)
    + coalesce(pg_column_size(s.updated_by), 0)
  )::bigint
  into current_state_bytes
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key;

  -- Do not call pg_column_size on the composite revision row. With thousands of
  -- 1 MiB JSONB snapshots that can assemble/detoast every payload and exceed
  -- PostgREST statement_timeout. Scalar pg_column_size reads the stored datum
  -- size (including TOAST/compression metadata) without materializing AppData.
  with sized_revisions as materialized (
    select
      r.revision,
      r.saved_at,
      r.saved_by,
      (
        pg_column_size(r.payload)
        + pg_column_size(r.workspace_key)
        + pg_column_size(r.revision)
        + coalesce(pg_column_size(r.saved_by), 0)
        + pg_column_size(r.saved_at)
      )::bigint as logical_bytes
    from public.ship_dynamics_app_revisions r
    where r.workspace_key = p_workspace_key
  )
  select
    coalesce(sum(r.logical_bytes), 0)::bigint,
    count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'revision', r.revision,
      'savedAt', r.saved_at,
      'savedBy', coalesce(nullif(r.saved_by, ''), '未記錄'),
      'logicalBytes', r.logical_bytes,
      'current', r.revision = current_row.revision
    ) order by r.revision desc), '[]'::jsonb)
  into revision_history_bytes, revision_history_count, revision_rows
  from sized_revisions r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', definition.collection_key,
    'label', definition.collection_label,
    'itemCount', case
      when jsonb_typeof(current_row.payload -> definition.collection_key) = 'array'
        then jsonb_array_length(current_row.payload -> definition.collection_key)
      when current_row.payload -> definition.collection_key is not null then 1
      else 0
    end,
    'logicalBytes', coalesce(pg_column_size(current_row.payload -> definition.collection_key), 0)::bigint
  ) order by definition.ordinal), '[]'::jsonb)
  into collection_rows
  from (values
    ('settings', '系統設定', 1),
    ('users', '人員帳號', 2),
    ('vessels', '船舶資料', 3),
    ('tasks', '待辦要事', 4),
    ('internalControlCases', '內控異常', 5),
    ('meetings', '臨會／專題', 6),
    ('agendaReports', '報告歷史', 7),
    ('taskDismissals', '個人移除狀態', 8),
    ('auditLogs', '操作紀錄', 9),
    ('notifications', '通知', 10)
  ) definition(collection_key, collection_label, ordinal);

  with current_items(collection_key, collection_label, ordinal, item) as (
    select 'users', '人員帳號', 2, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'users') = 'array' then current_row.payload -> 'users' else '[]'::jsonb end)
    union all
    select 'vessels', '船舶資料', 3, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'vessels') = 'array' then current_row.payload -> 'vessels' else '[]'::jsonb end)
    union all
    select 'tasks', '待辦要事', 4, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'tasks') = 'array' then current_row.payload -> 'tasks' else '[]'::jsonb end)
    union all
    select 'internalControlCases', '內控異常', 5, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'internalControlCases') = 'array' then current_row.payload -> 'internalControlCases' else '[]'::jsonb end)
    union all
    select 'meetings', '臨會／專題', 6, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'meetings') = 'array' then current_row.payload -> 'meetings' else '[]'::jsonb end)
    union all
    select 'agendaReports', '報告歷史', 7, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'agendaReports') = 'array' then current_row.payload -> 'agendaReports' else '[]'::jsonb end)
    union all
    select 'taskDismissals', '個人移除狀態', 8, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'taskDismissals') = 'array' then current_row.payload -> 'taskDismissals' else '[]'::jsonb end)
    union all
    select 'auditLogs', '操作紀錄', 9, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'auditLogs') = 'array' then current_row.payload -> 'auditLogs' else '[]'::jsonb end)
    union all
    select 'notifications', '通知', 10, value from jsonb_array_elements(case when jsonb_typeof(current_row.payload -> 'notifications') = 'array' then current_row.payload -> 'notifications' else '[]'::jsonb end)
  ), labeled as (
    select
      collection_key,
      collection_label,
      ordinal,
      coalesce(item ->> 'id', '') as item_id,
      left(coalesce(nullif(btrim(case collection_key
        when 'users' then coalesce(item ->> 'name', item ->> 'username')
        when 'vessels' then coalesce(item ->> 'shortName', item ->> 'name', item ->> 'fullName')
        when 'tasks' then item ->> 'description'
        when 'internalControlCases' then item ->> 'description'
        when 'meetings' then item ->> 'subject'
        when 'agendaReports' then item ->> 'title'
        when 'taskDismissals' then concat(item ->> 'itemKind', '｜', item ->> 'itemId')
        when 'auditLogs' then coalesce(item ->> 'action', item ->> 'detail')
        when 'notifications' then coalesce(item ->> 'title', item ->> 'message')
        else null
      end), ''), item ->> 'id', '未命名資料'), 120) as item_label,
      pg_column_size(item)::bigint as logical_bytes
    from current_items
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'collectionKey', collection_key,
    'collectionLabel', collection_label,
    'id', item_id,
    'label', item_label,
    'logicalBytes', logical_bytes
  ) order by ordinal, logical_bytes desc, item_id), '[]'::jsonb)
  into item_rows_json
  from labeled
  where item_id <> '';

  return jsonb_build_object(
    'ok', true,
    'generatedAt', clock_timestamp(),
    'databaseTotalBytes', database_total_bytes,
    'appDatabasePhysicalBytes', app_database_physical_bytes,
    'storageObjectBytes', storage_object_bytes,
    'storageObjectCount', storage_object_count,
    'currentStateBytes', current_state_bytes,
    'currentRevision', current_row.revision,
    'revisionHistoryBytes', revision_history_bytes,
    'revisionHistoryCount', revision_history_count,
    'revisions', revision_rows,
    'collections', collection_rows,
    'items', item_rows_json,
    'staticSiteHost', 'GitHub Pages',
    'staticSiteInSupabase', false,
    'logicalMetric', 'current_content_and_revision_history'
  );
end;
$$;

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

revoke execute on function public.get_ship_dynamics_storage_stats(text, text) from public, anon, authenticated;
grant execute on function public.get_ship_dynamics_storage_stats(text, text) to anon, authenticated;

revoke execute on function public.prune_ship_dynamics_revision_history(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.prune_ship_dynamics_revision_history(text, text, uuid, jsonb, jsonb) to anon, authenticated;

commit;
