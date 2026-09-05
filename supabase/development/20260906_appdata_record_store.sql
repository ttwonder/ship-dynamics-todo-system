-- DEVELOPMENT ONLY. Not a deployment migration. No legacy writes or browser grants.
-- Compatible row JSON is authoritative here; the legacy workspace is never a mirror.
-- First write slice: existing vessel note + original audit side effects only.
-- A small workspace metadata lock still allocates a commit revision. This is NOT
-- evidence of independent-connection throughput or the final lock/read design.
begin;

create table if not exists public.ship_dynamics_record_workspaces (
  workspace_key text primary key,
  root jsonb not null check (jsonb_typeof(root) = 'object'),
  revision integer not null check (revision >= 0),
  updated_at timestamptz not null,
  updated_by text not null,
  import_token text not null
);
create table if not exists public.ship_dynamics_record_collections (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  collection text not null,
  ids jsonb not null check (jsonb_typeof(ids) = 'array'),
  primary key (workspace_key, collection)
);
create table if not exists public.ship_dynamics_records (
  workspace_key text not null,
  collection text not null,
  entity_id text not null check (entity_id <> ''),
  value jsonb not null check (jsonb_typeof(value) = 'object' and jsonb_typeof(value -> 'id') = 'string' and value ->> 'id' = entity_id),
  revision integer not null,
  primary key (workspace_key, collection, entity_id),
  foreign key (workspace_key, collection) references public.ship_dynamics_record_collections(workspace_key, collection)
);
create table if not exists public.ship_dynamics_record_receipts (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  operation_id text not null,
  signature jsonb not null,
  result jsonb not null,
  primary key (workspace_key, operation_id)
);

alter table public.ship_dynamics_record_workspaces enable row level security;
alter table public.ship_dynamics_record_collections enable row level security;
alter table public.ship_dynamics_records enable row level security;
alter table public.ship_dynamics_record_receipts enable row level security;
revoke all on public.ship_dynamics_record_workspaces, public.ship_dynamics_record_collections,
  public.ship_dynamics_records, public.ship_dynamics_record_receipts from public, anon, authenticated;

-- Privileged, explicit fixture/import input; never reads the legacy table and never
-- replaces an existing authority. Exact same import is a replay even after edits.
create or replace function public.import_ship_dynamics_records_v1(p_workspace_key text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  names text[] := array['users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'];
  name text; items jsonb; item jsonb; ids jsonb; token text; previous text;
begin
  if nullif(p_workspace_key,'') is null or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload -> 'revision') is distinct from 'number'
    or (p_payload ->> 'revision') !~ '^[0-9]+$'
    or jsonb_typeof(p_payload -> 'updatedAt') is distinct from 'string'
  then raise exception 'invalid-record-import'; end if;
  token := md5(p_payload::text);
  perform pg_advisory_xact_lock(hashtext('record-import'), hashtext(p_workspace_key));
  select import_token into previous from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key;
  if found then
    if previous is distinct from token then raise exception 'record-import-mismatch'; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  -- Validate the complete source before inserting anything. Do not coerce, dedupe,
  -- trim, renumber or silently skip malformed legacy identifiers.
  foreach name in array names loop
    if not (p_payload ? name) then continue; end if;
    items := p_payload -> name;
    if jsonb_typeof(items) is distinct from 'array' then raise exception 'invalid-record-collection:%',name; end if;
    ids := '[]'::jsonb;
    for item in select value from jsonb_array_elements(items) loop
      if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item -> 'id') is distinct from 'string'
        or coalesce(item ->> 'id','')='' or ids ? (item ->> 'id')
      then raise exception 'invalid-record-id:%',name; end if;
      ids := ids || jsonb_build_array(item -> 'id');
    end loop;
  end loop;
  insert into public.ship_dynamics_record_workspaces values
    (p_workspace_key,p_payload-names,(p_payload ->> 'revision')::integer,(p_payload ->> 'updatedAt')::timestamptz,'import',token);
  foreach name in array names loop
    if not (p_payload ? name) then continue; end if;
    items := p_payload -> name;
    select coalesce(jsonb_agg(source.item -> 'id' order by ordinal),'[]'::jsonb) into ids
      from jsonb_array_elements(items) with ordinality source(item,ordinal);
    insert into public.ship_dynamics_record_collections values(p_workspace_key,name,ids);
    insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision)
      select p_workspace_key,name,source.item ->> 'id',source.item,(p_payload ->> 'revision')::integer from jsonb_array_elements(items) source(item);
  end loop;
  return jsonb_build_object('ok',true,'replayed',false);
end;
$$;

-- Full compatibility read only for this first slice; selective bootstrap and a
-- record change cursor are subsequent work, not falsely claimed delta reads.
create or replace function public.read_ship_dynamics_records_v1(p_workspace_key text)
returns jsonb language sql stable security invoker set search_path = pg_catalog, public as $$
  select coalesce((
    select jsonb_build_object('protocol','ship-dynamics-records-v1','workspace_key',w.workspace_key,
      'status','snapshot','revision',w.revision,'updated_at',w.updated_at,
      'payload',w.root || coalesce((
        select jsonb_object_agg(c.collection,(
          select coalesce(jsonb_agg(r.value order by requested.ordinal),'[]'::jsonb)
          from jsonb_array_elements_text(c.ids) with ordinality requested(id,ordinal)
          join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=requested.id
        )) from public.ship_dynamics_record_collections c where c.workspace_key=w.workspace_key
      ),'{}'::jsonb))
    from public.ship_dynamics_record_workspaces w where w.workspace_key=p_workspace_key
  ),jsonb_build_object('protocol','ship-dynamics-records-v1','workspace_key',p_workspace_key,'status','missing'));
$$;

create or replace function public.get_ship_dynamics_record_receipt_v1(
  p_workspace_key text,p_operation_id text,p_operations jsonb,p_saved_by text,
  p_actor_user_id text,p_actor_guard jsonb,p_authorization_guard jsonb,p_lock_guards jsonb
)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare receipt public.ship_dynamics_record_receipts%rowtype;
  signature jsonb := jsonb_build_array(p_operations,p_saved_by,p_actor_user_id,p_actor_guard,p_authorization_guard,p_lock_guards);
begin
  select * into receipt from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=p_operation_id;
  if not found then return jsonb_build_object('status','missing'); end if;
  if receipt.signature is distinct from signature then
    return jsonb_build_object('ok',false,'status','mismatch','code','operation-id-mismatch');
  end if;
  return receipt.result || jsonb_build_object('replayed',true);
end;
$$;

create or replace function public.apply_ship_dynamics_record_patch_v1(
  p_workspace_key text,p_operation_id text,p_operations jsonb,p_saved_by text,
  p_actor_user_id text,p_actor_guard jsonb,p_authorization_guard jsonb,p_lock_guards jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set statement_timeout = '8s' as $$
declare
  workspace public.ship_dynamics_record_workspaces%rowtype;
  receipt jsonb; auth_payload jsonb; operation jsonb; guard jsonb; current_value jsonb;
  expected_value jsonb; replacement jsonb; ids jsonb; final_ids jsonb; requested_ids jsonb;
  audit_ids jsonb; next_audit_ids jsonb; key text; seen text[] := array[]::text[];
  target_id text; name text; vessel_count integer := 0; audit_count integer := 0;
  next_revision integer; saved_at timestamptz; saved_text text;
begin
  if nullif(p_operation_id,'') is null or char_length(p_operation_id)>200 then
    return jsonb_build_object('ok',false,'code','invalid-operation-id'); end if;
  if jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations)>10000 then
    return jsonb_build_object('ok',false,'code','invalid-operations'); end if;
  if jsonb_typeof(p_lock_guards) is distinct from 'array' then
    return jsonb_build_object('ok',false,'code','invalid-lock-guards'); end if;
  -- Replay before authorization/lease checks: a committed lost ACK must stay
  -- recoverable after expiry or after a newer save. Payload must match exactly.
  perform pg_advisory_xact_lock(hashtext('record-operation:' || p_workspace_key),hashtext(p_operation_id));
  receipt := public.get_ship_dynamics_record_receipt_v1(p_workspace_key,p_operation_id,p_operations,p_saved_by,p_actor_user_id,p_actor_guard,p_authorization_guard,p_lock_guards);
  if receipt ->> 'status' <> 'missing' then return receipt; end if;
  select * into workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for update;
  if not found then return jsonb_build_object('ok',false,'code','workspace-not-found'); end if;

  -- Only users/vessels/settings are needed for the unchanged authority guards.
  -- Do not reconstruct tasks, meetings, cases, reports or historical audit bodies.
  select workspace.root || coalesce(jsonb_object_agg(c.collection,(
    select coalesce(jsonb_agg(r.value order by requested.ordinal),'[]'::jsonb)
    from jsonb_array_elements_text(c.ids) with ordinality requested(id,ordinal)
    join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=requested.id
  )),'{}'::jsonb) into auth_payload
  from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key and c.collection in ('users','vessels');
  if p_actor_guard is null or public.ship_dynamics_actor_guard(auth_payload,p_actor_user_id) is distinct from p_actor_guard
    or (p_authorization_guard is not null and public.ship_dynamics_authorization_guard(auth_payload) is distinct from p_authorization_guard)
  then return jsonb_build_object('ok',false,'code','authorization-conflict'); end if;
  for guard in select value from jsonb_array_elements(p_lock_guards) order by value ->> 'section_key' loop
    if coalesce(guard ->> 'section_key','')='' or coalesce(guard ->> 'locked_by','')='' then
      return jsonb_build_object('ok',false,'code','invalid-lock-guard'); end if;
    perform 1 from public.ship_dynamics_edit_locks where workspace_key=p_workspace_key
      and section_key=guard ->> 'section_key' and locked_by=guard ->> 'locked_by' and expires_at>clock_timestamp() for share;
    if not found then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',guard ->> 'section_key'); end if;
  end loop;
  select c.ids into audit_ids from public.ship_dynamics_record_collections c where workspace_key=p_workspace_key and collection='auditLogs';
  next_audit_ids := coalesce(audit_ids,'[]'::jsonb);

  -- Prevalidate the whole operation graph before any entity, order or receipt write.
  for operation in select value from jsonb_array_elements(p_operations) loop
    name := operation ->> 'collection'; target_id := operation ->> 'entityId';
    if operation ->> 'kind'='order' and name='auditLogs' then
      key := 'order:auditLogs';
      if jsonb_typeof(operation -> 'expectedIds') is distinct from 'array' or jsonb_typeof(operation -> 'valueIds') is distinct from 'array' then
        return jsonb_build_object('ok',false,'code','invalid-order-operation'); end if;
      if coalesce(audit_ids,'[]'::jsonb) is distinct from operation -> 'expectedIds' then
        return jsonb_build_object('ok',false,'code','block-conflict','conflict_key','order:auditLogs'); end if;
      requested_ids := operation -> 'valueIds';
    elsif operation ->> 'kind'='entity' and name in ('vessels','auditLogs') then
      if nullif(target_id,'') is null or not (operation ? 'expected') or not (operation ? 'value') then
        return jsonb_build_object('ok',false,'code','invalid-entity-operation'); end if;
      key := 'entity:' || name || ':' || target_id;
      expected_value := nullif(operation -> 'expected','null'::jsonb);
      replacement := nullif(operation -> 'value','null'::jsonb);
      if (expected_value is not null and (jsonb_typeof(expected_value) is distinct from 'object' or jsonb_typeof(expected_value -> 'id') is distinct from 'string' or expected_value ->> 'id' is distinct from target_id))
        or (replacement is not null and (jsonb_typeof(replacement) is distinct from 'object' or jsonb_typeof(replacement -> 'id') is distinct from 'string' or replacement ->> 'id' is distinct from target_id))
      then return jsonb_build_object('ok',false,'code','invalid-entity-id'); end if;
      select value into current_value from public.ship_dynamics_records where workspace_key=p_workspace_key and collection=name and ship_dynamics_records.entity_id=target_id for update;
      if current_value is distinct from expected_value then
        return jsonb_build_object('ok',false,'code','block-conflict','conflict_key',name || ':' || target_id); end if;
      if name='vessels' then
        if expected_value is null or replacement is null or not public.ship_dynamics_changed_fields_within(expected_value,replacement,array['note','updatedAt','updatedBy']) then
          return jsonb_build_object('ok',false,'code','unsupported-record-slice'); end if;
        if not public.ship_dynamics_patch_lock_covers_entity(name,target_id,expected_value,replacement,p_operations,p_lock_guards) then
          return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',name || ':' || target_id); end if;
        vessel_count := vessel_count+1;
      else
        -- Existing audit business fields are immutable. Retention deletions remain
        -- caller-authorized by the unchanged frontend authorization validator.
        if expected_value is not null and replacement is not null then
          return jsonb_build_object('ok',false,'code','immutable-audit'); end if;
        if replacement is not null then
          if replacement ->> 'actorId' is distinct from p_actor_user_id or replacement ->> 'entityType' is distinct from 'vessel'
            or not exists(select 1 from jsonb_array_elements(p_operations) op where op ->> 'kind'='entity' and op ->> 'collection'='vessels' and op ->> 'entityId'=replacement ->> 'entityId')
          then return jsonb_build_object('ok',false,'code','unaccompanied-audit'); end if;
          next_audit_ids := next_audit_ids || jsonb_build_array(target_id); audit_count := audit_count+1;
        else
          select coalesce(jsonb_agg(to_jsonb(id) order by ordinal),'[]'::jsonb) into next_audit_ids
            from jsonb_array_elements_text(next_audit_ids) with ordinality source(id,ordinal) where id<>target_id;
        end if;
      end if;
    else return jsonb_build_object('ok',false,'code','unsupported-record-slice'); end if;
    if key=any(seen) then return jsonb_build_object('ok',false,'code','duplicate-operation'); end if;
    seen := array_append(seen,key);
  end loop;
  if jsonb_array_length(p_operations)>0 and (
    vessel_count=0 or audit_count=0 or exists (
      select 1 from jsonb_array_elements(p_operations) vessel_op
      where vessel_op ->> 'kind'='entity' and vessel_op ->> 'collection'='vessels'
        and not exists (
          select 1 from jsonb_array_elements(p_operations) audit_op
          where audit_op ->> 'kind'='entity' and audit_op ->> 'collection'='auditLogs'
            and audit_op -> 'expected'='null'::jsonb
            and audit_op #>> '{value,entityId}'=vessel_op ->> 'entityId'
        )
    )
  ) then
    return jsonb_build_object('ok',false,'code','incomplete-vessel-audit-operation'); end if;
  if requested_ids is not null then
    if exists(select 1 from jsonb_array_elements(requested_ids) id where jsonb_typeof(id)<>'string') then
      return jsonb_build_object('ok',false,'code','invalid-order-result'); end if;
    select coalesce(jsonb_agg(to_jsonb(id) order by id),'[]'::jsonb) into final_ids from jsonb_array_elements_text(next_audit_ids) id;
    select coalesce(jsonb_agg(to_jsonb(id) order by id),'[]'::jsonb) into ids from jsonb_array_elements_text(requested_ids) id;
    if ids is distinct from final_ids then return jsonb_build_object('ok',false,'code','invalid-order-result'); end if;
    next_audit_ids := requested_ids;
  end if;
  saved_at := case when jsonb_array_length(p_operations)=0 then workspace.updated_at else clock_timestamp() end;
  saved_text := to_char(saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  next_revision := workspace.revision + case when jsonb_array_length(p_operations)=0 then 0 else 1 end;
  for operation in select value from jsonb_array_elements(p_operations) where value ->> 'kind'='entity' loop
    name := operation ->> 'collection'; target_id := operation ->> 'entityId'; replacement := nullif(operation -> 'value','null'::jsonb);
    if replacement is null then
      delete from public.ship_dynamics_records where workspace_key=p_workspace_key and collection=name and ship_dynamics_records.entity_id=target_id;
    else
      if name='auditLogs' then
        replacement := (replacement-'ipAddress'-'ipCountryCode') || jsonb_strip_nulls(jsonb_build_object(
          'ipAddress',public.ship_dynamics_request_client_ip(),'ipCountryCode',public.ship_dynamics_request_country_code()));
      end if;
      insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values(p_workspace_key,name,target_id,replacement,next_revision)
        on conflict (workspace_key,collection,entity_id) do update set value=excluded.value,revision=excluded.revision;
    end if;
  end loop;
  if jsonb_array_length(p_operations)>0 then
    update public.ship_dynamics_record_collections set ids=next_audit_ids where workspace_key=p_workspace_key and collection='auditLogs';
    update public.ship_dynamics_record_workspaces set revision=next_revision,updated_at=saved_at,updated_by=p_saved_by,
      root=root || jsonb_build_object('revision',next_revision,'updatedAt',saved_text) where workspace_key=p_workspace_key;
  end if;
  receipt := jsonb_build_object('ok',true,'status','committed','operation_id',p_operation_id,'revision',next_revision,'updated_at',saved_text,'replayed',false);
  insert into public.ship_dynamics_record_receipts values(p_workspace_key,p_operation_id,
    jsonb_build_array(p_operations,p_saved_by,p_actor_user_id,p_actor_guard,p_authorization_guard,p_lock_guards),receipt);
  return receipt;
end;
$$;

revoke all on function public.import_ship_dynamics_records_v1(text,jsonb) from public, anon, authenticated;
revoke all on function public.read_ship_dynamics_records_v1(text) from public, anon, authenticated;
revoke all on function public.get_ship_dynamics_record_receipt_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
commit;
