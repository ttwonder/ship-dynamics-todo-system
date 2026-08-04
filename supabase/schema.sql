create table if not exists public.ship_dynamics_app_state (
  workspace_key text primary key,
  payload jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.ship_dynamics_app_state add column if not exists updated_by text;
alter table public.ship_dynamics_app_state enable row level security;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1
       from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='ship_dynamics_app_state'
     ) then
    alter publication supabase_realtime add table public.ship_dynamics_app_state;
  end if;
end;
$$;

drop policy if exists "ship dynamics public read workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public read workspace"
  on public.ship_dynamics_app_state for select
  using (true);

drop policy if exists "ship dynamics public upsert workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public upsert workspace"
  on public.ship_dynamics_app_state for insert
  with check (true);

drop policy if exists "ship dynamics public update workspace" on public.ship_dynamics_app_state;
create policy "ship dynamics public update workspace"
  on public.ship_dynamics_app_state for update
  using (true)
  with check (true);

create table if not exists public.ship_dynamics_app_revisions (
  workspace_key text not null,
  revision integer not null,
  payload jsonb not null,
  saved_by text,
  saved_at timestamptz not null default now(),
  primary key (workspace_key, revision)
);

alter table public.ship_dynamics_app_revisions enable row level security;

drop policy if exists "ship dynamics public read revisions" on public.ship_dynamics_app_revisions;
create policy "ship dynamics public read revisions"
  on public.ship_dynamics_app_revisions for select
  using (true);

drop policy if exists "ship dynamics public insert revisions" on public.ship_dynamics_app_revisions;
create policy "ship dynamics public insert revisions"
  on public.ship_dynamics_app_revisions for insert
  with check (true);

create or replace function public.record_ship_dynamics_revision_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ship_dynamics_app_revisions (workspace_key, revision, payload, saved_by, saved_at)
  values (new.workspace_key, new.revision, new.payload, new.updated_by, coalesce(new.updated_at, now()))
  on conflict (workspace_key, revision) do update
    set payload = excluded.payload,
        saved_by = excluded.saved_by,
        saved_at = excluded.saved_at;
  return new;
end;
$$;

drop trigger if exists ship_dynamics_revision_history_trigger on public.ship_dynamics_app_state;
create trigger ship_dynamics_revision_history_trigger
after insert or update on public.ship_dynamics_app_state
for each row execute function public.record_ship_dynamics_revision_history();

create table if not exists public.ship_dynamics_edit_locks (
  workspace_key text not null,
  section_key text not null,
  locked_by text not null,
  locked_by_name text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_key, section_key)
);

alter table public.ship_dynamics_edit_locks enable row level security;

drop policy if exists "ship dynamics public read edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public read edit locks"
  on public.ship_dynamics_edit_locks for select
  using (true);

drop policy if exists "ship dynamics public insert edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public insert edit locks"
  on public.ship_dynamics_edit_locks for insert
  with check (true);

drop policy if exists "ship dynamics public update edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public update edit locks"
  on public.ship_dynamics_edit_locks for update
  using (true)
  with check (true);

drop policy if exists "ship dynamics public delete edit locks" on public.ship_dynamics_edit_locks;
create policy "ship dynamics public delete edit locks"
  on public.ship_dynamics_edit_locks for delete
  using (true);

create or replace function public.claim_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text,
  p_locked_by_name text,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.ship_dynamics_edit_locks%rowtype;
  claimed public.ship_dynamics_edit_locks%rowtype;
begin
  select * into existing
  from public.ship_dynamics_edit_locks
  where workspace_key = p_workspace_key and section_key = p_section_key;

  if found and existing.expires_at > now() and existing.locked_by <> p_locked_by then
    return jsonb_build_object(
      'ok', false,
      'section_key', existing.section_key,
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  insert into public.ship_dynamics_edit_locks (workspace_key, section_key, locked_by, locked_by_name, locked_at, expires_at)
  values (p_workspace_key, p_section_key, p_locked_by, p_locked_by_name, now(), now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 120)))
  on conflict (workspace_key, section_key) do update
    set locked_by = excluded.locked_by,
        locked_by_name = excluded.locked_by_name,
        locked_at = now(),
        expires_at = excluded.expires_at
    where public.ship_dynamics_edit_locks.expires_at <= now()
       or public.ship_dynamics_edit_locks.locked_by = p_locked_by
  returning * into claimed;

  if claimed.workspace_key is null then
    select * into existing
    from public.ship_dynamics_edit_locks
    where workspace_key = p_workspace_key and section_key = p_section_key;
    return jsonb_build_object(
      'ok', false,
      'section_key', coalesce(existing.section_key, p_section_key),
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'section_key', claimed.section_key,
    'locked_by', claimed.locked_by,
    'locked_by_name', claimed.locked_by_name,
    'expires_at', claimed.expires_at
  );
end;
$$;

create or replace function public.renew_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text,
  p_ttl_seconds integer default 75
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  renewed public.ship_dynamics_edit_locks%rowtype;
  existing public.ship_dynamics_edit_locks%rowtype;
begin
  update public.ship_dynamics_edit_locks
  set expires_at = now() + make_interval(secs => least(greatest(p_ttl_seconds, 30), 120))
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by
    and expires_at > now()
  returning * into renewed;

  if renewed.workspace_key is null then
    select * into existing
    from public.ship_dynamics_edit_locks
    where workspace_key = p_workspace_key and section_key = p_section_key;
    return jsonb_build_object(
      'ok', false,
      'section_key', coalesce(existing.section_key, p_section_key),
      'locked_by', existing.locked_by,
      'locked_by_name', existing.locked_by_name,
      'expires_at', existing.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'section_key', renewed.section_key,
    'locked_by', renewed.locked_by,
    'locked_by_name', renewed.locked_by_name,
    'expires_at', renewed.expires_at
  );
end;
$$;

create or replace function public.release_ship_dynamics_edit_lock(
  p_workspace_key text,
  p_section_key text,
  p_locked_by text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ship_dynamics_edit_locks
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by;
  return true;
end;
$$;

create or replace function public.ship_dynamics_actor_guard(
  p_payload jsonb,
  p_actor_user_id text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  actor jsonb;
  actor_role text;
  role_permissions jsonb;
  visible_vessel_ids jsonb;
begin
  select item into actor
  from jsonb_array_elements(coalesce(p_payload -> 'users', '[]'::jsonb)) item
  where item ->> 'id' = p_actor_user_id
    and coalesce((item ->> 'isActive')::boolean, false)
  limit 1;
  if actor is null then return null; end if;

  actor_role := actor ->> 'role';
  role_permissions := coalesce(p_payload #> array['settings','rolePermissions',actor_role], '{}'::jsonb);
  select coalesce(jsonb_agg(to_jsonb(vessel_id) order by vessel_id), '[]'::jsonb)
  into visible_vessel_ids
  from (
    select vessel ->> 'id' as vessel_id
    from jsonb_array_elements(coalesce(p_payload -> 'vessels', '[]'::jsonb)) vessel
    where coalesce((vessel ->> 'isActive')::boolean, false)
      and (
        actor_role in ('owner','admin')
        or coalesce((role_permissions ->> 'viewAllVessels')::boolean, false)
        or coalesce(vessel -> 'assignedUserIds', '[]'::jsonb) ? p_actor_user_id
        or coalesce(actor -> 'managedVesselIds', '[]'::jsonb) ? (vessel ->> 'id')
        or exists (
          select 1
          from jsonb_array_elements(coalesce(vessel -> 'delegateManagers', '[]'::jsonb)) delegate
          where delegate ->> 'userId' = p_actor_user_id
            and coalesce((delegate ->> 'isActive')::boolean, false)
        )
      )
  ) scoped;

  return jsonb_build_object(
    'actor', actor,
    'effectivePermissions', role_permissions,
    'visibleVesselIds', visible_vessel_ids,
    'nonOwnerPasswordResetVersion', case when actor_role = 'owner' then null else p_payload #> '{settings,nonOwnerPasswordResetVersion}' end
  );
end;
$$;

create or replace function public.ship_dynamics_changed_fields_within(
  p_expected jsonb,
  p_value jsonb,
  p_allowed text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1
    from jsonb_object_keys(coalesce(p_expected,'{}'::jsonb) || coalesce(p_value,'{}'::jsonb)) field_name
    where p_expected -> field_name is distinct from p_value -> field_name
      and not (field_name = any(p_allowed))
  );
$$;

create or replace function public.ship_dynamics_patch_touches_authorization_domain(p_operations jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  operation jsonb;
  expected_value jsonb;
  replacement_value jsonb;
  field_name text;
begin
  for operation in select value from jsonb_array_elements(coalesce(p_operations,'[]'::jsonb)) loop
    if operation ->> 'kind' = 'entity' and operation ->> 'collection' = 'users' then return true; end if;
    if operation ->> 'kind' not in ('entity','settings') then continue; end if;
    expected_value := operation -> 'expected'; replacement_value := operation -> 'value';
    if expected_value = 'null'::jsonb then expected_value := null; end if;
    if replacement_value = 'null'::jsonb then replacement_value := null; end if;
    if operation ->> 'kind' = 'settings' then
      foreach field_name in array array['rolePermissions','sitePasswordHash','nonOwnerPasswordResetVersion'] loop
        if expected_value -> field_name is distinct from replacement_value -> field_name then return true; end if;
      end loop;
    elsif operation ->> 'collection' = 'vessels' then
      foreach field_name in array array['assignedUserIds','managedByUserIds','delegateManagers'] loop
        if expected_value -> field_name is distinct from replacement_value -> field_name then return true; end if;
      end loop;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.ship_dynamics_authorization_guard(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'users', coalesce(p_payload -> 'users', '[]'::jsonb),
    'vesselAuthorization', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vessel -> 'id',
        'isActive', coalesce(vessel -> 'isActive', 'false'::jsonb),
        'assignedUserIds', coalesce(vessel -> 'assignedUserIds', '[]'::jsonb),
        'delegateManagers', coalesce(vessel -> 'delegateManagers', '[]'::jsonb)
      ) order by vessel ->> 'id')
      from jsonb_array_elements(coalesce(p_payload -> 'vessels', '[]'::jsonb)) vessel
    ), '[]'::jsonb),
    'sensitiveSettings', jsonb_build_object(
      'sitePasswordHash', p_payload #> '{settings,sitePasswordHash}',
      'rolePermissions', p_payload #> '{settings,rolePermissions}',
      'nonOwnerPasswordResetVersion', p_payload #> '{settings,nonOwnerPasswordResetVersion}'
    )
  );
$$;

create or replace function public.ship_dynamics_patch_lock_covers_entity(
  p_collection text,
  p_entity_id text,
  p_expected jsonb,
  p_value jsonb,
  p_operations jsonb,
  p_lock_guards jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  related jsonb;
  related_id text;
  direct_key text;
begin
  if p_collection = 'vessels' and p_expected is null then return true; end if;
  if p_collection = 'vessels' and p_expected is not null and p_value is not null
    and public.ship_dynamics_changed_fields_within(
      p_expected,
      p_value,
      array['id','name','shortName','fullName','fleet','fleetId','fleetCategory','shipType','isActive','assignedUserIds','managedByUserIds','delegateManagers','updatedAt','updatedBy']
    )
  then return true; end if;

  if p_expected is not null then
    direct_key := case p_collection
      when 'vessels' then 'vessel:' || p_entity_id
      when 'tasks' then 'task:' || p_entity_id
      when 'meetings' then 'meeting:' || p_entity_id
      when 'internalControlCases' then 'internal-control:' || p_entity_id
      else '' end;
    return direct_key <> '' and exists (
      select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
      where guard ->> 'section_key' = direct_key
    );
  end if;

  if p_collection = 'tasks' then
    if exists (
      select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
      where left(guard ->> 'section_key',15) = 'task-create:v2:'
        and right(guard ->> 'section_key',char_length(p_entity_id)+1) = ':' || p_entity_id
    ) then return true; end if;

    related_id := coalesce(p_value ->> 'sourceMeetingId','');
    if related_id <> ''
      and exists (select 1 from jsonb_array_elements(p_operations) operation_item where operation_item ->> 'kind' = 'entity' and operation_item ->> 'collection' = 'meetings' and operation_item ->> 'entityId' = related_id)
      and exists (select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard where guard ->> 'section_key' in ('meeting:' || related_id,'meeting-create:' || related_id))
    then return true; end if;

    related_id := coalesce(p_value ->> 'internalControlCaseId','');
    if related_id <> ''
      and exists (select 1 from jsonb_array_elements(p_operations) operation_item where operation_item ->> 'kind' = 'entity' and operation_item ->> 'collection' = 'internalControlCases' and operation_item ->> 'entityId' = related_id)
      and exists (
        select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
        where guard ->> 'section_key' = 'internal-control:' || related_id
          or left(guard ->> 'section_key',24) = 'internal-control-create:'
      )
    then return true; end if;

    for related in select value from jsonb_array_elements(p_operations) where value ->> 'kind' = 'entity' and value ->> 'collection' = 'internalControlCases' loop
      if related #>> '{value,linkedTaskId}' = p_entity_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
          where guard ->> 'section_key' = 'internal-control:' || (related ->> 'entityId')
            or left(guard ->> 'section_key',24) = 'internal-control-create:'
        )
      then return true; end if;
    end loop;
    return false;
  end if;

  if p_collection = 'meetings' then
    return exists (
      select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
      where guard ->> 'section_key' = 'meeting-create:' || p_entity_id
    );
  end if;
  if p_collection = 'internalControlCases' then
    related_id := coalesce(p_value ->> 'linkedTaskId','');
    if related_id <> '' and not exists (
      select 1
      from jsonb_array_elements(p_operations) operation_item
      where operation_item ->> 'kind' = 'entity'
        and operation_item ->> 'collection' = 'tasks'
        and operation_item ->> 'entityId' = related_id
        and operation_item -> 'expected' = 'null'::jsonb
    ) then
      return exists (
        select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
        where guard ->> 'section_key' = 'internal-control-create:' || related_id
      );
    end if;
    return exists (
      select 1 from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) guard
      where left(guard ->> 'section_key',24) = 'internal-control-create:'
    );
  end if;
  return p_collection = 'vessels';
end;
$$;

create or replace function public.apply_ship_dynamics_block_patch(
  p_workspace_key text,
  p_operations jsonb,
  p_saved_by text,
  p_actor_user_id text,
  p_actor_guard jsonb,
  p_authorization_guard jsonb,
  p_lock_guards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.ship_dynamics_app_state%rowtype;
  working_payload jsonb;
  operation jsonb;
  guard jsonb;
  kind text;
  collection_name text;
  entity_id text;
  operation_key text;
  seen_keys text[] := array[]::text[];
  expected_value jsonb;
  replacement_value jsonb;
  current_value jsonb;
  current_array jsonb;
  current_order jsonb;
  reordered_array jsonb;
  next_revision integer;
  saved_at timestamptz := clock_timestamp();
  saved_at_text text;
begin
  if jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) > 10000 then
    return jsonb_build_object('ok',false,'code','invalid-operations');
  end if;
  if jsonb_typeof(coalesce(p_lock_guards,'[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok',false,'code','invalid-lock-guards');
  end if;

  select * into current_row
  from public.ship_dynamics_app_state
  where workspace_key = p_workspace_key
  for update;
  if not found then return jsonb_build_object('ok',false,'code','workspace-not-found'); end if;
  working_payload := current_row.payload;

  if p_actor_guard is null or public.ship_dynamics_actor_guard(working_payload,p_actor_user_id) is distinct from p_actor_guard then
    return jsonb_build_object('ok',false,'code','authorization-conflict','conflict_key','authorization-domain');
  end if;
  if (public.ship_dynamics_patch_touches_authorization_domain(p_operations) and p_authorization_guard is null)
    or (p_authorization_guard is not null and public.ship_dynamics_authorization_guard(working_payload) is distinct from p_authorization_guard)
  then
    return jsonb_build_object('ok',false,'code','authorization-conflict','conflict_key','authorization-domain');
  end if;

  for guard in select value from jsonb_array_elements(coalesce(p_lock_guards,'[]'::jsonb)) loop
    if coalesce(guard ->> 'section_key','') = '' or coalesce(guard ->> 'locked_by','') = '' then
      return jsonb_build_object('ok',false,'code','invalid-lock-guard');
    end if;
    perform 1
    from public.ship_dynamics_edit_locks
    where workspace_key = p_workspace_key
      and section_key = guard ->> 'section_key'
      and locked_by = guard ->> 'locked_by'
      and expires_at > now()
    for share;
    if not found then
      return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',guard ->> 'section_key');
    end if;
  end loop;

  for operation in select value from jsonb_array_elements(p_operations) loop
    kind := operation ->> 'kind';
    collection_name := operation ->> 'collection';
    if kind = 'settings' then
      operation_key := 'settings';
      expected_value := operation -> 'expected';
      replacement_value := operation -> 'value';
      if jsonb_typeof(expected_value) <> 'object' or jsonb_typeof(replacement_value) <> 'object' then
        return jsonb_build_object('ok',false,'code','invalid-settings-operation');
      end if;
      if working_payload -> 'settings' is distinct from expected_value then
        return jsonb_build_object('ok',false,'code','block-conflict','conflict_key','settings');
      end if;
    elsif kind in ('entity','order') then
      if collection_name is null or not (collection_name = any(array['users','vessels','tasks','internalControlCases','meetings','agendaReports','notifications','auditLogs'])) then
        return jsonb_build_object('ok',false,'code','invalid-collection');
      end if;
      current_array := coalesce(working_payload -> collection_name, '[]'::jsonb);
      if jsonb_typeof(current_array) <> 'array' then return jsonb_build_object('ok',false,'code','invalid-collection-data','conflict_key',collection_name); end if;
      if kind = 'entity' then
        entity_id := operation ->> 'entityId';
        operation_key := 'entity:' || collection_name || ':' || coalesce(entity_id,'');
        if coalesce(entity_id,'') = '' then return jsonb_build_object('ok',false,'code','invalid-entity-id'); end if;
        expected_value := operation -> 'expected';
        replacement_value := operation -> 'value';
        if expected_value = 'null'::jsonb then expected_value := null; end if;
        if replacement_value = 'null'::jsonb then replacement_value := null; end if;
        if expected_value is not null and expected_value ->> 'id' is distinct from entity_id then return jsonb_build_object('ok',false,'code','invalid-expected-id'); end if;
        if replacement_value is not null and replacement_value ->> 'id' is distinct from entity_id then return jsonb_build_object('ok',false,'code','invalid-replacement-id'); end if;
        select item into current_value from jsonb_array_elements(current_array) item where item ->> 'id' = entity_id limit 1;
        if current_value is distinct from expected_value then
          return jsonb_build_object('ok',false,'code','block-conflict','conflict_key',collection_name || ':' || entity_id);
        end if;
        if collection_name = any(array['vessels','tasks','internalControlCases','meetings'])
          and not public.ship_dynamics_patch_lock_covers_entity(collection_name,entity_id,expected_value,replacement_value,p_operations,p_lock_guards)
        then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',collection_name || ':' || entity_id); end if;
      else
        operation_key := 'order:' || collection_name;
        if jsonb_typeof(operation -> 'expectedIds') <> 'array' or jsonb_typeof(operation -> 'valueIds') <> 'array' then return jsonb_build_object('ok',false,'code','invalid-order-operation'); end if;
        if exists (
          select 1 from (
            select value #>> '{}' as id, count(*) as occurrences
            from jsonb_array_elements(operation -> 'expectedIds')
            group by value #>> '{}'
            having count(*) > 1
            union all
            select value #>> '{}' as id, count(*) as occurrences
            from jsonb_array_elements(operation -> 'valueIds')
            group by value #>> '{}'
            having count(*) > 1
          ) duplicates
        ) then return jsonb_build_object('ok',false,'code','invalid-order-result','conflict_key','order:' || collection_name); end if;
        select coalesce(jsonb_agg(to_jsonb(item ->> 'id') order by ordinal), '[]'::jsonb) into current_order
        from jsonb_array_elements(current_array) with ordinality source(item,ordinal);
        if current_order is distinct from operation -> 'expectedIds' then return jsonb_build_object('ok',false,'code','block-conflict','conflict_key','order:' || collection_name); end if;
      end if;
    else
      return jsonb_build_object('ok',false,'code','invalid-operation-kind');
    end if;
    if operation_key = any(seen_keys) then return jsonb_build_object('ok',false,'code','duplicate-operation','conflict_key',operation_key); end if;
    seen_keys := array_append(seen_keys,operation_key);
  end loop;

  if jsonb_array_length(p_operations) = 0 then
    return jsonb_build_object('ok',true,'revision',current_row.revision,'updated_at',current_row.updated_at,'payload',working_payload);
  end if;

  for operation in select value from jsonb_array_elements(p_operations) loop
    kind := operation ->> 'kind';
    if kind = 'settings' then
      working_payload := jsonb_set(working_payload,'{settings}',operation -> 'value',true);
    elsif kind = 'entity' then
      collection_name := operation ->> 'collection';
      entity_id := operation ->> 'entityId';
      replacement_value := operation -> 'value';
      if replacement_value = 'null'::jsonb then replacement_value := null; end if;
      current_array := coalesce(working_payload -> collection_name, '[]'::jsonb);
      if replacement_value is null then
        select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb) into current_array
        from jsonb_array_elements(current_array) with ordinality source(item,ordinal)
        where item ->> 'id' <> entity_id;
      elsif exists (select 1 from jsonb_array_elements(current_array) item where item ->> 'id' = entity_id) then
        select coalesce(jsonb_agg(case when item ->> 'id' = entity_id then replacement_value else item end order by ordinal), '[]'::jsonb) into current_array
        from jsonb_array_elements(current_array) with ordinality source(item,ordinal);
      else
        current_array := current_array || jsonb_build_array(replacement_value);
      end if;
      working_payload := jsonb_set(working_payload,array[collection_name],current_array,true);
    end if;
  end loop;

  for operation in select value from jsonb_array_elements(p_operations) where value ->> 'kind' = 'order' loop
    collection_name := operation ->> 'collection';
    current_array := coalesce(working_payload -> collection_name, '[]'::jsonb);
    select coalesce(jsonb_agg(item order by requested.ordinal), '[]'::jsonb) into reordered_array
    from jsonb_array_elements(operation -> 'valueIds') with ordinality requested(id_value,ordinal)
    join lateral (
      select candidate as item from jsonb_array_elements(current_array) candidate
      where candidate ->> 'id' = requested.id_value #>> '{}'
      limit 1
    ) matched on true;
    if jsonb_array_length(reordered_array) <> jsonb_array_length(current_array) or jsonb_array_length(reordered_array) <> jsonb_array_length(operation -> 'valueIds') then
      return jsonb_build_object('ok',false,'code','invalid-order-result','conflict_key','order:' || collection_name);
    end if;
    working_payload := jsonb_set(working_payload,array[collection_name],reordered_array,true);
  end loop;

  next_revision := current_row.revision + 1;
  saved_at_text := to_char(saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  working_payload := jsonb_set(working_payload,'{revision}',to_jsonb(next_revision),true);
  working_payload := jsonb_set(working_payload,'{updatedAt}',to_jsonb(saved_at_text),true);
  update public.ship_dynamics_app_state
  set payload = working_payload,
      revision = next_revision,
      updated_at = saved_at,
      updated_by = p_saved_by
  where workspace_key = p_workspace_key;
  return jsonb_build_object('ok',true,'revision',next_revision,'updated_at',saved_at,'payload',working_payload);
end;
$$;

-- 說明：
-- 這是 GitHub Pages 靜態前端的輕量共享 payload 模式。
-- 瀏覽器只傳變更區塊；RPC 在單一 PostgreSQL transaction 中重新驗證身份 guard、鎖 fencing 與區塊 CAS，
-- 並保留全局 revision 及 revision history。舊版整包 revision CAS 暫時保留作相容遷移用途。
-- 若日後要改成 Supabase Auth + 嚴格 RLS，可將 payload 拆分為 users/vessels/tasks/audit_logs 多表。
