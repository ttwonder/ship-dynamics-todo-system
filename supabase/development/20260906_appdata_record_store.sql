-- DEVELOPMENT ONLY. Not a deployment migration. No legacy writes or browser grants.
-- Compatible row JSON is authoritative here; the legacy workspace is never a mirror.
-- Whole original operation envelopes; row bodies are never mirrored to legacy.
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

-- Read bases contain only root metadata and ordered IDs, never business bodies.
-- A writer captures its previous committed base after validation, in the same
-- transaction as row changes. Pruned/missing bases safely require a full read.
create table if not exists public.ship_dynamics_record_read_bases (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  revision integer not null,
  token text not null,
  root jsonb not null,
  orders jsonb not null,
  primary key (workspace_key, revision)
);
create index if not exists ship_dynamics_records_changed_revision
  on public.ship_dynamics_records(workspace_key, revision, collection);

-- Durable version metadata is separate from disposable delta read bases.
-- No AppData/body snapshot per commit; only overwritten/deleted rows are archived.
create table if not exists public.ship_dynamics_record_versions (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  revision integer not null check (revision >= 0),
  root jsonb not null check (jsonb_typeof(root) = 'object'),
  orders jsonb not null check (jsonb_typeof(orders) = 'object'),
  updated_at timestamptz not null,
  primary key (workspace_key, revision)
);
create table if not exists public.ship_dynamics_record_history (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  collection text not null,
  entity_id text not null check (entity_id <> ''),
  valid_from_revision integer not null check (valid_from_revision >= 0),
  valid_to_revision integer not null check (valid_to_revision > valid_from_revision),
  value jsonb not null check (jsonb_typeof(value) = 'object' and jsonb_typeof(value -> 'id') = 'string' and value ->> 'id' = entity_id),
  primary key (workspace_key, collection, entity_id, valid_from_revision)
);
alter table public.ship_dynamics_record_versions enable row level security;
alter table public.ship_dynamics_record_history enable row level security;
revoke all on public.ship_dynamics_record_versions, public.ship_dynamics_record_history from public, anon, authenticated;

alter table public.ship_dynamics_record_workspaces enable row level security;
alter table public.ship_dynamics_record_collections enable row level security;
alter table public.ship_dynamics_records enable row level security;
alter table public.ship_dynamics_record_receipts enable row level security;
alter table public.ship_dynamics_record_read_bases enable row level security;
revoke all on public.ship_dynamics_record_workspaces, public.ship_dynamics_record_collections,
  public.ship_dynamics_records, public.ship_dynamics_record_receipts,
  public.ship_dynamics_record_read_bases from public, anon, authenticated;

-- Internal storage metadata never occupies a user JSON key. NULL is an
-- unconverted legacy body (also used by non-task records), not an absent field.
alter table public.ship_dynamics_records add column if not exists task_progress_meta jsonb;
alter table public.ship_dynamics_record_history add column if not exists task_progress_meta jsonb;
create table if not exists public.ship_dynamics_record_task_progress (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  task_id text not null,
  entry_id text not null,
  value jsonb not null,
  revision integer not null check (revision>=0),
  primary key(workspace_key,task_id,entry_id)
);
create table if not exists public.ship_dynamics_record_task_progress_history (
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  task_id text not null,
  entry_id text not null,
  value jsonb not null,
  valid_from_revision integer not null check (valid_from_revision>=0),
  valid_to_revision integer not null check (valid_to_revision>valid_from_revision),
  primary key(workspace_key,task_id,entry_id,valid_from_revision)
);
alter table public.ship_dynamics_record_task_progress enable row level security;
alter table public.ship_dynamics_record_task_progress_history enable row level security;
revoke all on public.ship_dynamics_record_task_progress,public.ship_dynamics_record_task_progress_history from public,anon,authenticated;

create or replace function public.ship_dynamics_record_hydrate_v1(
  p_workspace text,p_collection text,p_id text,p_body jsonb,p_meta jsonb,p_revision integer
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare ids jsonb; bodies jsonb; invalid bigint;
begin
  if p_meta is null then return p_body; end if;
  if p_collection<>'tasks' or p_body ? 'vesselProgress' then raise exception 'record-progress-incomplete'; end if;
  if p_meta=jsonb_build_object('kind','absent') then return p_body; end if;
  if p_meta ->> 'kind'='literal' and p_meta ? 'value' and jsonb_typeof(p_meta -> 'value')<>'array'
    and p_meta=jsonb_build_object('kind','literal','value',p_meta -> 'value') then
    return p_body || jsonb_build_object('vesselProgress',p_meta -> 'value');
  end if;
  ids := p_meta -> 'ids';
  if p_meta ->> 'kind' is distinct from 'array' or jsonb_typeof(ids) is distinct from 'array'
    or p_meta<>jsonb_build_object('kind','array','ids',ids) then raise exception 'record-progress-incomplete'; end if;
  if exists(select 1 from jsonb_array_elements(ids) id where jsonb_typeof(id)<>'string' or id='""'::jsonb)
    or (select count(distinct id) from jsonb_array_elements_text(ids) id)<>jsonb_array_length(ids)
    then raise exception 'record-progress-incomplete'; end if;
  select coalesce(jsonb_agg(m.body order by i.ordinal),'[]'::jsonb),count(*) filter(where m.n<>1)
    into bodies,invalid
  from jsonb_array_elements_text(ids) with ordinality i(id,ordinal)
  cross join lateral (
    select count(*) n,jsonb_agg(c.value) -> 0 body from (
      select r.value from public.ship_dynamics_record_task_progress r
        where r.workspace_key=p_workspace and r.task_id=p_id and r.entry_id=i.id and r.revision<=p_revision
      union all
      select h.value from public.ship_dynamics_record_task_progress_history h
        where h.workspace_key=p_workspace and h.task_id=p_id and h.entry_id=i.id
          and h.valid_from_revision<=p_revision and p_revision<h.valid_to_revision
    ) c
  ) m;
  if invalid<>0 then raise exception 'record-progress-incomplete'; end if;
  return p_body || jsonb_build_object('vesselProgress',bodies);
end;
$$;

-- Caller owns workspace/complete-task CAS and leases. entry_id is ONLY a
-- physical slot, not a vessel identity or a new business scope epoch.
create or replace function public.ship_dynamics_record_progress_write_v1(
  p_workspace text,p_task text,p_value jsonb,p_revision integer,p_valid_to integer default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  items jsonb := '[]'::jsonb; slots jsonb := '{}'::jsonb; used text[] := array[]::text[];
  ids jsonb := '[]'::jsonb; item jsonb; ordinal bigint; slot text; vessel jsonb; old_row record;
  meta jsonb;
begin
  if p_value is null or not (p_value ? 'vesselProgress') then meta:=jsonb_build_object('kind','absent');
  elsif jsonb_typeof(p_value -> 'vesselProgress')<>'array' then
    meta:=jsonb_build_object('kind','literal','value',p_value -> 'vesselProgress');
  else
    items:=p_value -> 'vesselProgress';
    if p_valid_to is not null then
      -- Upgrade an existing historical body with its exact original interval.
      -- No guesses from disposable read bases or the current business scope.
      for item in select value from jsonb_array_elements(items) loop
        slot:=gen_random_uuid()::text; ids:=ids || jsonb_build_array(slot);
        insert into public.ship_dynamics_record_task_progress_history values(p_workspace,p_task,slot,item,p_revision,p_valid_to);
      end loop;
      return jsonb_build_object('kind','array','ids',ids);
    end if;
    -- Reserve ALL exact raw matches before considering changed entries. This
    -- preserves duplicate/unknown/literal entries and their original order.
    for item,ordinal in select * from jsonb_array_elements(items) with ordinality loop
      select r.entry_id into slot from public.ship_dynamics_record_task_progress r
        where r.workspace_key=p_workspace and r.task_id=p_task and r.value=item and not(r.entry_id=any(used))
        order by r.entry_id limit 1;
      if slot is not null then
        slots:=jsonb_set(slots,array[ordinal::text],to_jsonb(slot)); used:=array_append(used,slot);
      end if;
    end loop;
    for item,ordinal in select * from jsonb_array_elements(items) with ordinality loop
      slot:=slots ->> ordinal::text; vessel:=item -> 'vesselId';
      if slot is null and jsonb_typeof(vessel)='string' and vessel<>'""'::jsonb
        and (select count(*) from jsonb_array_elements(items) x where x -> 'vesselId'=vessel)=1
        and (select count(*) from public.ship_dynamics_record_task_progress r where r.workspace_key=p_workspace and r.task_id=p_task and r.value -> 'vesselId'=vessel)=1 then
        select r.entry_id into slot from public.ship_dynamics_record_task_progress r
          where r.workspace_key=p_workspace and r.task_id=p_task and r.value -> 'vesselId'=vessel and not(r.entry_id=any(used));
      end if;
      if slot is null then slot:=gen_random_uuid()::text; end if;
      used:=array_append(used,slot); ids:=ids || jsonb_build_array(slot);
      select * into old_row from public.ship_dynamics_record_task_progress r
        where r.workspace_key=p_workspace and r.task_id=p_task and r.entry_id=slot;
      if not found then
        insert into public.ship_dynamics_record_task_progress values(p_workspace,p_task,slot,item,p_revision);
      elsif old_row.value is distinct from item then
        insert into public.ship_dynamics_record_task_progress_history values(p_workspace,p_task,slot,old_row.value,old_row.revision,p_revision);
        update public.ship_dynamics_record_task_progress set value=item,revision=p_revision
          where workspace_key=p_workspace and task_id=p_task and entry_id=slot;
      end if;
    end loop;
    meta:=jsonb_build_object('kind','array','ids',ids);
  end if;
  if p_valid_to is not null then return meta; end if;
  insert into public.ship_dynamics_record_task_progress_history
    select r.workspace_key,r.task_id,r.entry_id,r.value,r.revision,p_revision
    from public.ship_dynamics_record_task_progress r where r.workspace_key=p_workspace and r.task_id=p_task and not(ids ? r.entry_id);
  delete from public.ship_dynamics_record_task_progress where workspace_key=p_workspace and task_id=p_task and not(ids ? entry_id);
  return meta;
end;
$$;
revoke all on function public.ship_dynamics_record_hydrate_v1(text,text,text,jsonb,jsonb,integer) from public,anon,authenticated;
revoke all on function public.ship_dynamics_record_progress_write_v1(text,text,jsonb,integer,integer) from public,anon,authenticated;

-- Privileged, explicit fixture/import input; never reads the legacy table and never
-- replaces an existing authority. Exact same import is a replay even after edits.
create or replace function public.import_ship_dynamics_records_v1(p_workspace_key text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  names text[] := array['users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'];
  name text; items jsonb; item jsonb; ids jsonb; token text; previous text; meta jsonb;
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
    for item in select value from jsonb_array_elements(items) loop
      meta:=null;
      if name='tasks' then meta:=public.ship_dynamics_record_progress_write_v1(p_workspace_key,item ->> 'id',item,(p_payload ->> 'revision')::integer); end if;
      insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision,task_progress_meta)
        values(p_workspace_key,name,item ->> 'id',case when name='tasks' then item-'vesselProgress' else item end,(p_payload ->> 'revision')::integer,meta);
    end loop;
  end loop;
  insert into public.ship_dynamics_record_versions
    select w.workspace_key,w.revision,w.root,
      (select coalesce(jsonb_object_agg(c.collection,c.ids),'{}'::jsonb) from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key),w.updated_at
    from public.ship_dynamics_record_workspaces w where w.workspace_key=p_workspace_key;
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
          select coalesce(jsonb_agg(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) order by requested.ordinal),'[]'::jsonb)
          from jsonb_array_elements_text(c.ids) with ordinality requested(id,ordinal)
          join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=requested.id
        )) from public.ship_dynamics_record_collections c where c.workspace_key=w.workspace_key
      ),'{}'::jsonb))
    from public.ship_dynamics_record_workspaces w where w.workspace_key=p_workspace_key
  ),jsonb_build_object('protocol','ship-dynamics-records-v1','workspace_key',p_workspace_key,'status','missing'));
$$;

-- Owner-only reconstruction foundation, not a browser/data-management RPC rollout.
-- Missing metadata never falls back to current state. Every ordered ID must have
-- exactly one body in [from,to), including deletion/recreation of an identical ID.
create or replace function public.read_ship_dynamics_record_history_v1(p_workspace_key text,p_revision integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v public.ship_dynamics_record_versions%rowtype;
  payload jsonb; name text; ids jsonb; bodies jsonb; expected_count bigint := 0;
  active_count bigint; invalid_count bigint;
begin
  select * into v from public.ship_dynamics_record_versions where workspace_key=p_workspace_key and revision=p_revision;
  if not found then
    return jsonb_build_object('protocol','ship-dynamics-record-history-v1','workspace_key',p_workspace_key,'revision',p_revision,'status','missing');
  end if;
  payload := v.root;
  for name,ids in select * from jsonb_each(v.orders) loop
    if jsonb_typeof(ids) is distinct from 'array' then raise exception 'record-history-incomplete'; end if;
    if exists(select 1 from jsonb_array_elements(ids) id where jsonb_typeof(id)<>'string')
      or (select count(distinct id) from jsonb_array_elements_text(ids) id) <> jsonb_array_length(ids)
    then raise exception 'record-history-incomplete'; end if;
    select coalesce(jsonb_agg(matches.body order by requested.ordinal),'[]'::jsonb),
      count(*) filter (where matches.n<>1) into bodies,invalid_count
    from jsonb_array_elements_text(ids) with ordinality requested(id,ordinal)
    cross join lateral (
      select count(*) as n,jsonb_agg(candidate.value) -> 0 as body from (
        select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,p_revision) value from public.ship_dynamics_records r
          where r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=requested.id and r.revision<=p_revision
        union all
        select public.ship_dynamics_record_hydrate_v1(h.workspace_key,h.collection,h.entity_id,h.value,h.task_progress_meta,p_revision) value from public.ship_dynamics_record_history h
          where h.workspace_key=p_workspace_key and h.collection=name and h.entity_id=requested.id
            and h.valid_from_revision<=p_revision and p_revision<h.valid_to_revision
      ) candidate
    ) matches;
    if invalid_count<>0 then raise exception 'record-history-incomplete'; end if;
    expected_count := expected_count + jsonb_array_length(ids);
    payload := jsonb_set(payload,array[name],bodies,true);
  end loop;
  select (select count(*) from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.revision<=p_revision)
    + (select count(*) from public.ship_dynamics_record_history h where h.workspace_key=p_workspace_key
      and h.valid_from_revision<=p_revision and p_revision<h.valid_to_revision) into active_count;
  if active_count<>expected_count then raise exception 'record-history-incomplete'; end if;
  return jsonb_build_object('protocol','ship-dynamics-record-history-v1','workspace_key',p_workspace_key,
    'revision',v.revision,'updated_at',v.updated_at,'status','snapshot','payload',payload);
end;
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

-- Private materialization core. Callers MUST lock the workspace and validate their
-- complete command before calling. No actor impersonation or authorization here:
-- browser patch validates actor/CAS/leases; server jobs construct their own rows.
create or replace function public.ship_dynamics_record_commit_validated_v1(
  p_workspace_key text,p_operations jsonb,p_next_root jsonb,p_next_orders jsonb,
  p_saved_by text,p_operation_id text,p_signature jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  workspace public.ship_dynamics_record_workspaces%rowtype;
  orders jsonb; name text; ids jsonb; operation jsonb; target_id text; replacement jsonb;
  saved_at timestamptz; saved_text text; next_revision integer; receipt jsonb; meta jsonb;
begin
  select * into strict workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for update;
  select coalesce(jsonb_object_agg(collection,c.ids),'{}'::jsonb) into orders
    from public.ship_dynamics_record_collections c where workspace_key=p_workspace_key;
  saved_at := case when jsonb_array_length(p_operations)=0 then workspace.updated_at else clock_timestamp() end;
  saved_text := to_char(saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  next_revision := workspace.revision + case when jsonb_array_length(p_operations)=0 then 0 else 1 end;
  if jsonb_array_length(p_operations)>0 then
    insert into public.ship_dynamics_record_read_bases values(p_workspace_key,workspace.revision,
      md5(jsonb_build_array(p_workspace_key,workspace.import_token,workspace.revision)::text),workspace.root,orders)
      on conflict(workspace_key,revision) do nothing;
    -- On an existing development store, capture only the actual current baseline;
    -- never backfill older read bases whose row bodies were already lost.
    insert into public.ship_dynamics_record_versions values(p_workspace_key,workspace.revision,workspace.root,orders,workspace.updated_at)
      on conflict(workspace_key,revision) do nothing;
  end if;
  -- Materialize an originally absent collection only when this transaction touches
  -- it. All order validation is complete before any physical write starts.
  for name,ids in select * from jsonb_each(p_next_orders) loop
    if orders -> name is distinct from ids then
      insert into public.ship_dynamics_record_collections values(p_workspace_key,name,ids)
        on conflict(workspace_key,collection) do update set ids=excluded.ids;
    end if;
  end loop;
  for operation in select value from jsonb_array_elements(p_operations) where value ->> 'kind'='entity' loop
    name := operation ->> 'collection'; target_id := operation ->> 'entityId'; replacement := nullif(operation -> 'value','null'::jsonb);
    insert into public.ship_dynamics_record_history(workspace_key,collection,entity_id,valid_from_revision,valid_to_revision,value,task_progress_meta)
      select r.workspace_key,r.collection,r.entity_id,r.revision,next_revision,r.value,r.task_progress_meta
      from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=target_id;
    meta:=null;
    if name='tasks' then meta:=public.ship_dynamics_record_progress_write_v1(p_workspace_key,target_id,replacement,next_revision); end if;
    if replacement is null then
      delete from public.ship_dynamics_records where workspace_key=p_workspace_key and collection=name and ship_dynamics_records.entity_id=target_id;
    else
      if name='auditLogs' then
        replacement := (replacement-'ipAddress'-'ipCountryCode') || jsonb_strip_nulls(jsonb_build_object(
          'ipAddress',public.ship_dynamics_request_client_ip(),'ipCountryCode',public.ship_dynamics_request_country_code()));
      end if;
      insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision,task_progress_meta)
        values(p_workspace_key,name,target_id,case when name='tasks' then replacement-'vesselProgress' else replacement end,next_revision,meta)
        on conflict (workspace_key,collection,entity_id) do update set value=excluded.value,revision=excluded.revision,task_progress_meta=excluded.task_progress_meta;
    end if;
  end loop;
  if jsonb_array_length(p_operations)>0 then
    update public.ship_dynamics_record_workspaces set revision=next_revision,updated_at=saved_at,updated_by=p_saved_by,
      root=p_next_root || jsonb_build_object('revision',next_revision,'updatedAt',saved_text) where workspace_key=p_workspace_key;
    insert into public.ship_dynamics_record_versions
      select w.workspace_key,w.revision,w.root,p_next_orders,w.updated_at
      from public.ship_dynamics_record_workspaces w where w.workspace_key=p_workspace_key;
  end if;
  receipt := jsonb_build_object('ok',true,'status','committed','operation_id',p_operation_id,'revision',next_revision,'updated_at',saved_text,'replayed',false);
  insert into public.ship_dynamics_record_receipts values(p_workspace_key,p_operation_id,
    p_signature,receipt);
  return receipt;
end;
$$;
revoke all on function public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb) from public,anon,authenticated;

create or replace function public.apply_ship_dynamics_record_patch_v1(
  p_workspace_key text,p_operation_id text,p_operations jsonb,p_saved_by text,
  p_actor_user_id text,p_actor_guard jsonb,p_authorization_guard jsonb,p_lock_guards jsonb
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public set statement_timeout = '8s' as $$
declare
  workspace public.ship_dynamics_record_workspaces%rowtype;
  receipt jsonb; auth_payload jsonb; operation jsonb; guard jsonb; current_value jsonb;
  expected_value jsonb; replacement jsonb; ids jsonb; final_ids jsonb; requested_ids jsonb;
  key text; seen text[] := array[]::text[];
  target_id text; name text; vessel_count integer := 0; audit_count integer := 0;
  names text[] := array['users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'];
  orders jsonb; next_orders jsonb; requested_orders jsonb := '{}'::jsonb; next_root jsonb;
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
    or (public.ship_dynamics_patch_touches_authorization_domain(p_operations) and p_authorization_guard is null)
    or (p_authorization_guard is not null and public.ship_dynamics_authorization_guard(auth_payload) is distinct from p_authorization_guard)
  then return jsonb_build_object('ok',false,'code','authorization-conflict'); end if;
  for guard in select value from jsonb_array_elements(p_lock_guards) order by value ->> 'section_key' loop
    if coalesce(guard ->> 'section_key','')='' or coalesce(guard ->> 'locked_by','')='' then
      return jsonb_build_object('ok',false,'code','invalid-lock-guard'); end if;
    perform 1 from public.ship_dynamics_edit_locks where workspace_key=p_workspace_key
      and section_key=guard ->> 'section_key' and locked_by=guard ->> 'locked_by' and expires_at>clock_timestamp() for share;
    if not found then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',guard ->> 'section_key'); end if;
  end loop;
  select coalesce(jsonb_object_agg(collection,c.ids),'{}'::jsonb) into orders
    from public.ship_dynamics_record_collections c where workspace_key=p_workspace_key;
  next_orders := orders; next_root := workspace.root;

  -- Prevalidate the whole operation graph before any entity, order or receipt write.
  for operation in select value from jsonb_array_elements(p_operations) loop
    name := operation ->> 'collection'; target_id := operation ->> 'entityId';
    if operation ->> 'kind' in ('order','entity') and (name is null or not (name=any(names))) then
      return jsonb_build_object('ok',false,'code','invalid-collection'); end if;
    if operation ->> 'kind'='settings' then
      key := 'settings';
      if jsonb_typeof(operation -> 'expected') is distinct from 'object' or jsonb_typeof(operation -> 'value') is distinct from 'object' then
        return jsonb_build_object('ok',false,'code','invalid-settings-operation'); end if;
      if workspace.root -> 'settings' is distinct from operation -> 'expected' then
        return jsonb_build_object('ok',false,'code','block-conflict','conflict_key','settings'); end if;
      next_root := jsonb_set(next_root,'{settings}',operation -> 'value',true);
    elsif operation ->> 'kind'='order' then
      key := 'order:' || name;
      if jsonb_typeof(operation -> 'expectedIds') is distinct from 'array' or jsonb_typeof(operation -> 'valueIds') is distinct from 'array' then
        return jsonb_build_object('ok',false,'code','invalid-order-operation'); end if;
      if coalesce(orders -> name,'[]'::jsonb) is distinct from operation -> 'expectedIds' then
        return jsonb_build_object('ok',false,'code','block-conflict','conflict_key',key); end if;
      requested_orders := jsonb_set(requested_orders,array[name],operation -> 'valueIds',true);
    elsif operation ->> 'kind'='entity' then
      if nullif(target_id,'') is null or not (operation ? 'expected') or not (operation ? 'value') then
        return jsonb_build_object('ok',false,'code','invalid-entity-operation'); end if;
      key := 'entity:' || name || ':' || target_id;
      expected_value := nullif(operation -> 'expected','null'::jsonb);
      replacement := nullif(operation -> 'value','null'::jsonb);
      if (expected_value is not null and (jsonb_typeof(expected_value) is distinct from 'object' or jsonb_typeof(expected_value -> 'id') is distinct from 'string' or expected_value ->> 'id' is distinct from target_id))
        or (replacement is not null and (jsonb_typeof(replacement) is distinct from 'object' or jsonb_typeof(replacement -> 'id') is distinct from 'string' or replacement ->> 'id' is distinct from target_id))
      then return jsonb_build_object('ok',false,'code','invalid-entity-id'); end if;
      select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into current_value
        from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=target_id for update;
      if current_value is distinct from expected_value then
        return jsonb_build_object('ok',false,'code','block-conflict','conflict_key',name || ':' || target_id); end if;
      if name in ('vessels','tasks','internalControlCases','meetings') then
        if not public.ship_dynamics_patch_lock_covers_entity(name,target_id,expected_value,replacement,p_operations,p_lock_guards) then
          return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',name || ':' || target_id); end if;
        if name='vessels' and not public.ship_dynamics_patch_lock_covers_entity(name,target_id,expected_value,replacement,p_operations,'[]'::jsonb) then vessel_count := vessel_count+1; end if;
      end if;
      if name='auditLogs' then
        -- Existing audit business fields are immutable. Retention deletions remain
        -- caller-authorized by the unchanged frontend authorization validator.
        if expected_value is not null and replacement is not null then
          return jsonb_build_object('ok',false,'code','immutable-audit'); end if;
        if replacement is not null then
          if replacement ->> 'actorId' is distinct from p_actor_user_id
            or not exists(select 1 from jsonb_array_elements(p_operations) op where op ->> 'kind'='settings'
              or (op ->> 'kind' in ('entity','order') and op ->> 'collection' not in ('auditLogs','notifications'))
              or (op ->> 'kind'='entity' and op ->> 'collection'='notifications' and op #>> '{value,userId}'=p_actor_user_id))
          then return jsonb_build_object('ok',false,'code','unaccompanied-audit'); end if;
          audit_count := audit_count+1;
        end if;
      end if;
      ids := coalesce(next_orders -> name,'[]'::jsonb);
      if replacement is null then
        select coalesce(jsonb_agg(to_jsonb(id) order by ordinal),'[]'::jsonb) into ids
          from jsonb_array_elements_text(ids) with ordinality source(id,ordinal) where id<>target_id;
      elsif expected_value is null then ids := ids || jsonb_build_array(target_id);
      end if;
      next_orders := jsonb_set(next_orders,array[name],ids,true);
    else return jsonb_build_object('ok',false,'code','invalid-operation-kind'); end if;
    if key=any(seen) then return jsonb_build_object('ok',false,'code','duplicate-operation'); end if;
    seen := array_append(seen,key);
  end loop;
  if vessel_count>0 and (
    audit_count=0 or exists (
      select 1 from jsonb_array_elements(p_operations) vessel_op
      where vessel_op ->> 'kind'='entity' and vessel_op ->> 'collection'='vessels'
        and not public.ship_dynamics_patch_lock_covers_entity('vessels',vessel_op ->> 'entityId',nullif(vessel_op -> 'expected','null'::jsonb),nullif(vessel_op -> 'value','null'::jsonb),p_operations,'[]'::jsonb)
        and not exists (
          select 1 from jsonb_array_elements(p_operations) audit_op
          where audit_op ->> 'kind'='entity' and audit_op ->> 'collection'='auditLogs'
            and audit_op -> 'expected'='null'::jsonb
            and audit_op #>> '{value,entityType}'='vessel'
            and audit_op #>> '{value,entityId}'=vessel_op ->> 'entityId'
        )
    )
  ) then
    return jsonb_build_object('ok',false,'code','incomplete-vessel-audit-operation'); end if;
  for name,requested_ids in select * from jsonb_each(requested_orders) loop
    if exists(select 1 from jsonb_array_elements(requested_ids) id where jsonb_typeof(id)<>'string') then
      return jsonb_build_object('ok',false,'code','invalid-order-result'); end if;
    select coalesce(jsonb_agg(to_jsonb(id) order by id),'[]'::jsonb) into final_ids from jsonb_array_elements_text(coalesce(next_orders -> name,'[]'::jsonb)) id;
    select coalesce(jsonb_agg(to_jsonb(id) order by id),'[]'::jsonb) into ids from jsonb_array_elements_text(requested_ids) id;
    if ids is distinct from final_ids then return jsonb_build_object('ok',false,'code','invalid-order-result'); end if;
    next_orders := jsonb_set(next_orders,array[name],requested_ids,true);
  end loop;
  return public.ship_dynamics_record_commit_validated_v1(
    p_workspace_key,p_operations,next_root,next_orders,p_saved_by,p_operation_id,
    jsonb_build_array(p_operations,p_saved_by,p_actor_user_id,p_actor_guard,p_authorization_guard,p_lock_guards));
end;
$$;

revoke all on function public.import_ship_dynamics_records_v1(text,jsonb) from public, anon, authenticated;
revoke all on function public.read_ship_dynamics_records_v1(text) from public, anon, authenticated;
revoke all on function public.read_ship_dynamics_record_history_v1(text,integer) from public, anon, authenticated;
revoke all on function public.get_ship_dynamics_record_receipt_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;

-- Atomic, reentrant DEVELOPMENT upgrade. Run only with local synthetic data.
-- Existing revision/import tokens/receipt signatures/results are never updated.
-- NULL-metadata historical intervals get fresh private slots; sharing between
-- old versions is not guessed. Subsequent writes reuse unchanged current leaves.
do $$
declare row record; version record; before_versions jsonb:='[]'::jsonb; before_current jsonb:='[]'::jsonb;
  meta jsonb; observed jsonb; idx integer:=0; boundary integer;
begin
  lock table public.ship_dynamics_record_workspaces,public.ship_dynamics_records,
    public.ship_dynamics_record_history,public.ship_dynamics_record_task_progress,
    public.ship_dynamics_record_task_progress_history in share row exclusive mode;
  if exists(
    with spans as (
      select workspace_key,entity_id,revision f,null::integer t from public.ship_dynamics_records where collection='tasks'
      union all select workspace_key,entity_id,valid_from_revision,valid_to_revision from public.ship_dynamics_record_history where collection='tasks'
    ) select 1 from spans a join spans b on a.workspace_key=b.workspace_key and a.entity_id=b.entity_id
      and a.f<b.f and int8range(a.f,a.t,'[)') && int8range(b.f,b.t,'[)')
  ) or exists(select 1 from public.ship_dynamics_records r join public.ship_dynamics_record_history h
    on r.workspace_key=h.workspace_key and r.collection=h.collection and r.entity_id=h.entity_id and r.revision=h.valid_from_revision
    where r.collection='tasks') then raise exception 'record-progress-overlap'; end if;
  for version in select workspace_key,revision from public.ship_dynamics_record_versions order by workspace_key,revision loop
    before_versions:=before_versions || jsonb_build_array(public.read_ship_dynamics_record_history_v1(version.workspace_key,version.revision));
  end loop;
  for row in select workspace_key from public.ship_dynamics_record_workspaces order by workspace_key loop
    before_current:=before_current || jsonb_build_array(public.read_ship_dynamics_records_v1(row.workspace_key));
  end loop;
  for row in select * from public.ship_dynamics_record_history where collection='tasks' and task_progress_meta is null order by workspace_key,entity_id,valid_from_revision loop
    meta:=public.ship_dynamics_record_progress_write_v1(row.workspace_key,row.entity_id,row.value,row.valid_from_revision,row.valid_to_revision);
    update public.ship_dynamics_record_history set value=row.value-'vesselProgress',task_progress_meta=meta
      where workspace_key=row.workspace_key and collection='tasks' and entity_id=row.entity_id and valid_from_revision=row.valid_from_revision;
  end loop;
  for row in select * from public.ship_dynamics_records where collection='tasks' and task_progress_meta is null order by workspace_key,entity_id loop
    if exists(select 1 from public.ship_dynamics_record_task_progress p where p.workspace_key=row.workspace_key and p.task_id=row.entity_id)
      then raise exception 'record-progress-incomplete'; end if;
    meta:=public.ship_dynamics_record_progress_write_v1(row.workspace_key,row.entity_id,row.value,row.revision);
    update public.ship_dynamics_records set value=row.value-'vesselProgress',task_progress_meta=meta
      where workspace_key=row.workspace_key and collection='tasks' and entity_id=row.entity_id;
  end loop;
  -- Check each body's whole interval at every leaf boundary, including versions
  -- whose root has been pruned. Missing, overlapping or cross-workspace refs fail.
  for row in
    select workspace_key,collection,entity_id,value,task_progress_meta,revision f,null::integer t from public.ship_dynamics_records where collection='tasks'
    union all select workspace_key,collection,entity_id,value,task_progress_meta,valid_from_revision,valid_to_revision from public.ship_dynamics_record_history where collection='tasks'
  loop
    for boundary in
      select row.f union select p.revision from public.ship_dynamics_record_task_progress p where p.workspace_key=row.workspace_key and p.task_id=row.entity_id and p.revision>=row.f and (row.t is null or p.revision<row.t)
      union select h.valid_from_revision from public.ship_dynamics_record_task_progress_history h where h.workspace_key=row.workspace_key and h.task_id=row.entity_id and h.valid_from_revision>=row.f and (row.t is null or h.valid_from_revision<row.t)
      union select h.valid_to_revision from public.ship_dynamics_record_task_progress_history h where h.workspace_key=row.workspace_key and h.task_id=row.entity_id and h.valid_to_revision>=row.f and (row.t is null or h.valid_to_revision<row.t)
    loop
      perform public.ship_dynamics_record_hydrate_v1(row.workspace_key,row.collection,row.entity_id,row.value,row.task_progress_meta,boundary);
    end loop;
  end loop;
  for version in select workspace_key,revision from public.ship_dynamics_record_versions order by workspace_key,revision loop
    observed:=public.read_ship_dynamics_record_history_v1(version.workspace_key,version.revision);
    if observed is distinct from before_versions -> idx then raise exception 'record-progress-upgrade-mismatch'; end if;
    idx:=idx+1;
  end loop;
  idx:=0;
  for row in select workspace_key from public.ship_dynamics_record_workspaces order by workspace_key loop
    if public.read_ship_dynamics_records_v1(row.workspace_key) is distinct from before_current -> idx then raise exception 'record-progress-upgrade-mismatch'; end if;
    idx:=idx+1;
  end loop;
end;
$$;
commit;
