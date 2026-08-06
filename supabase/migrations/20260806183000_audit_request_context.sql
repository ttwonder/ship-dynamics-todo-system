begin;

-- Server-stamped audit network context. Existing audit rows remain unchanged.
-- Client-supplied IP/country fields are removed; new rows use Supabase request headers.
create or replace function public.ship_dynamics_request_client_ip()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  raw_headers text;
  request_headers jsonb;
  candidate text;
begin
  raw_headers := current_setting('request.headers', true);
  if nullif(raw_headers, '') is null then return null; end if;
  request_headers := raw_headers::jsonb;
  candidate := btrim(split_part(
    coalesce(nullif(request_headers ->> 'x-forwarded-for', ''), request_headers ->> 'cf-connecting-ip', ''),
    ',',
    1
  ));
  if candidate = '' then return null; end if;
  return host(candidate::inet);
exception when others then
  return null;
end;
$$;

create or replace function public.ship_dynamics_request_country_code()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  raw_headers text;
  request_headers jsonb;
  country_code text;
begin
  raw_headers := current_setting('request.headers', true);
  if nullif(raw_headers, '') is null then return null; end if;
  request_headers := raw_headers::jsonb;
  country_code := upper(btrim(coalesce(request_headers ->> 'cf-ipcountry', '')));
  if country_code ~ '^[A-Z]{2}$' and country_code not in ('XX', 'T1') then
    return country_code;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function public.ship_dynamics_request_client_ip() from public;
revoke all on function public.ship_dynamics_request_country_code() from public;

create or replace function public.stamp_ship_dynamics_audit_network_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  audit_item jsonb;
  previous_item jsonb;
  next_audit_logs jsonb := '[]'::jsonb;
  request_ip text := public.ship_dynamics_request_client_ip();
  request_country_code text := public.ship_dynamics_request_country_code();
begin
  if tg_op <> 'UPDATE' or jsonb_typeof(new.payload -> 'auditLogs') <> 'array' then
    return new;
  end if;

  for audit_item in select value from jsonb_array_elements(new.payload -> 'auditLogs') loop
    previous_item := null;
    select value into previous_item
    from jsonb_array_elements(coalesce(old.payload -> 'auditLogs', '[]'::jsonb))
    where value ->> 'id' = audit_item ->> 'id'
    limit 1;

    audit_item := audit_item - 'ipAddress' - 'ipCountryCode';
    if previous_item is not null then
      audit_item := audit_item || jsonb_strip_nulls(jsonb_build_object(
        'ipAddress', previous_item -> 'ipAddress',
        'ipCountryCode', previous_item -> 'ipCountryCode'
      ));
    else
      audit_item := audit_item || jsonb_strip_nulls(jsonb_build_object(
        'ipAddress', request_ip,
        'ipCountryCode', request_country_code
      ));
    end if;
    next_audit_logs := next_audit_logs || jsonb_build_array(audit_item);
  end loop;

  new.payload := jsonb_set(new.payload, '{auditLogs}', next_audit_logs, true);
  return new;
end;
$$;

drop trigger if exists ship_dynamics_audit_network_context_trigger on public.ship_dynamics_app_state;
create trigger ship_dynamics_audit_network_context_trigger
before update on public.ship_dynamics_app_state
for each row execute function public.stamp_ship_dynamics_audit_network_context();

do $migration$
begin
  if to_regclass('public.sd_audit_events') is not null then
    execute 'alter table public.sd_audit_events add column if not exists ip_address inet';
    execute 'alter table public.sd_audit_events add column if not exists ip_country_code text';
  end if;
end;
$migration$;

create or replace function public.sd_stamp_audit_request_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_ip text := public.ship_dynamics_request_client_ip();
begin
  new.ip_address := case when request_ip is null then null else request_ip::inet end;
  new.ip_country_code := public.ship_dynamics_request_country_code();
  return new;
end;
$$;

do $migration$
begin
  if to_regclass('public.sd_audit_events') is not null then
    execute 'drop trigger if exists sd_audit_request_context_trigger on public.sd_audit_events';
    execute 'create trigger sd_audit_request_context_trigger before insert on public.sd_audit_events for each row execute function public.sd_stamp_audit_request_context()';
  end if;
end;
$migration$;

-- Return the trigger-stamped payload so the UI sees the IP without a refresh.
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
      if collection_name is null or not (collection_name = any(array['users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])) then
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
  where workspace_key = p_workspace_key
  returning payload into working_payload;
  return jsonb_build_object('ok',true,'revision',next_revision,'updated_at',saved_at,'payload',working_payload);
end;
$$;

commit;
