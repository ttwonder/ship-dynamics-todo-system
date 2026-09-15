-- SHIP DYNAMICS: ADDITIVE INSTALL ONLY. NOT CUTOVER / NOT A BACKUP.
-- Target workspace: ship-dynamics-main. Operator manually runs this exact file.
-- Brief schema maintenance: existing business rows are locked, not copied.
-- On any ERROR/timeout: STOP; use separate readback. Do not blindly retry.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
SET LOCAL work_mem='16MB';
SET LOCAL search_path=pg_catalog,public;
SELECT pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
DO $release_preflight$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls) THEN
  RAISE EXCEPTION 'release-admin-bypassrls-required';
 END IF;
 IF to_regclass('public.ship_dynamics_record_workspaces') IS NOT NULL THEN
  RAISE EXCEPTION 'release-records-already-present-use-readback';
 END IF;
 IF to_regclass('public.ship_dynamics_app_state') IS NULL OR to_regclass('public.sd_workspaces') IS NULL THEN
  RAISE EXCEPTION 'release-required-predecessor-missing';
 END IF;
 IF (SELECT count(*) FROM public.ship_dynamics_app_state WHERE workspace_key='ship-dynamics-main')<>1
 OR (SELECT count(*) FROM public.sd_workspaces WHERE legacy_key='ship-dynamics-main')<>1 THEN
  RAISE EXCEPTION 'release-exact-workspace-binding-required';
 END IF;
 IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE') THEN
  RAISE EXCEPTION 'release-public-schema-not-trusted';
 END IF;
END $release_preflight$;
CREATE TEMP TABLE release_existing_rows(relation regclass PRIMARY KEY,n bigint,stamp text,old_lock_fields boolean NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE release_existing_functions ON COMMIT DROP AS
 SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
DO $release_pin$
DECLARE t record; n bigint; stamp text; old_lock_fields boolean;
BEGIN
 FOR t IN SELECT c.oid,c.oid::regclass AS relation FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind='r' AND c.relname ~ '^(ship_dynamics_|sd_)' ORDER BY c.oid LOOP
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE',t.relation);
  old_lock_fields:=t.oid='public.ship_dynamics_edit_locks'::regclass AND NOT EXISTS(
   SELECT FROM pg_attribute WHERE attrelid=t.oid AND attname='lease_version' AND attnum>0 AND NOT attisdropped);
  IF old_lock_fields THEN
   -- ADD COLUMN with nextval rewrites a nonempty lock table. Pin ALL old values,
   -- not physical tuple IDs; only the intentionally added column is excluded.
   EXECUTE format('SELECT count(*),md5(coalesce(string_agg((to_jsonb(x)-''lease_version'')::text,chr(10) ORDER BY workspace_key,section_key),'''')) FROM %s x',t.relation) INTO n,stamp;
  ELSE
   -- All other tables retain physical guards; no historical payload aggregation.
   EXECUTE format('SELECT count(*),md5(coalesce(string_agg(ctid::text||'':''||xmin::text,'','' ORDER BY ctid),'''')) FROM %s',t.relation) INTO n,stamp;
  END IF;
  INSERT INTO pg_temp.release_existing_rows VALUES(t.relation,n,stamp,old_lock_fields);
 END LOOP;
 IF (SELECT count(*) FROM pg_temp.release_existing_rows)<>58 THEN RAISE EXCEPTION 'release-predecessor-table-set-drift';END IF;
END $release_pin$;

-- BEGIN COMPONENT: supabase/development/20260906_appdata_record_store.sql
-- DEVELOPMENT ONLY. Not a deployment migration. No legacy writes or browser grants.
-- Compatible row JSON is authoritative here; the legacy workspace is never a mirror.
-- Whole original operation envelopes; row bodies are never mirrored to legacy.
-- A small workspace metadata lock still allocates a commit revision. This is NOT
-- evidence of independent-connection throughput or the final lock/read design.

-- Before ANY DDL/table lock: all live compatible writers hold the shared side.
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);

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

-- Writer order: maintenance gate -> workspace gate -> operation -> exact entity
-- advisory keys (including absence) -> rows -> root publication -> audit/order.
-- Coarse writers use an exclusive workspace gate BEFORE root/entities. Private
-- materializers fail closed without a caller-owned gate/prepared entity key.
create or replace function public.ship_dynamics_record_lock_held_v1(p_a integer,p_b integer,p_exclusive boolean default false)
returns boolean language sql volatile security invoker set search_path=pg_catalog,public as $$
  select exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid()
    and database=(select oid from pg_database where datname=current_database())
    and classid=p_a::oid and objid=p_b::oid and objsubid=2 and granted
    and mode=any(case when p_exclusive then array['ExclusiveLock'] else array['ShareLock','ExclusiveLock'] end));
$$;
create or replace function public.ship_dynamics_record_other_writer_held_v1(p_workspace text)
returns boolean language sql volatile security invoker set search_path=pg_catalog,public as $$
  select exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid()
    and database=(select oid from pg_database where datname=current_database())
    and classid=hashtext('record-writer-v1')::oid and objid<>hashtext(p_workspace)::oid
    and objsubid=2 and granted and mode=any(array['ShareLock','ExclusiveLock']));
$$;
create or replace function public.ship_dynamics_record_writer_gate_v1(p_workspace text,p_exclusive boolean)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock_shared(hashtext('record-maintenance-v1'),0);
  -- A transaction retaining another workspace cannot wait in reverse order.
  -- Inspect only this backend's gates; no global exclusive writer marker.
  if public.ship_dynamics_record_other_writer_held_v1(p_workspace) then
    if p_exclusive then
      if not pg_try_advisory_xact_lock(hashtext('record-writer-v1'),hashtext(p_workspace)) then
        raise exception 'record-writer-restart-transaction' using errcode='40001';
      end if;
    else
      if not pg_try_advisory_xact_lock_shared(hashtext('record-writer-v1'),hashtext(p_workspace)) then
        raise exception 'record-writer-restart-transaction' using errcode='40001';
      end if;
    end if;
    return;
  end if;
  if p_exclusive then
    -- An uncontended multi-command transaction may upgrade; never WAIT on
    -- an upgrade, because two shared holders could otherwise deadlock.
    if public.ship_dynamics_record_lock_held_v1(hashtext('record-writer-v1'),hashtext(p_workspace))
      and not public.ship_dynamics_record_lock_held_v1(hashtext('record-writer-v1'),hashtext(p_workspace),true)
    then
      if not pg_try_advisory_xact_lock(hashtext('record-writer-v1'),hashtext(p_workspace)) then
        raise exception 'record-writer-gate-upgrade' using errcode='40001';
      end if;
      return;
    end if;
    perform pg_advisory_xact_lock(hashtext('record-writer-v1'),hashtext(p_workspace));
  else
    perform pg_advisory_xact_lock_shared(hashtext('record-writer-v1'),hashtext(p_workspace));
  end if;
end;
$$;
create or replace function public.ship_dynamics_record_assert_writer_v1(p_workspace text,p_collection text default null,p_entity text default null)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if public.ship_dynamics_record_lock_held_v1(hashtext('record-maintenance-v1'),0,true)
    or public.ship_dynamics_record_lock_held_v1(hashtext('record-writer-v1'),hashtext(p_workspace),true) then return; end if;
  if not public.ship_dynamics_record_lock_held_v1(hashtext('record-writer-v1'),hashtext(p_workspace))
    or (p_collection is not null and p_collection<>'auditLogs' and not public.ship_dynamics_record_lock_held_v1(
      hashtext('record-entity-v1:'||p_workspace),hashtext(jsonb_build_array(p_collection,p_entity)::text),true))
  then raise exception 'record-writer-prepare-required' using errcode='55000'; end if;
end;
$$;
revoke all on function public.ship_dynamics_record_lock_held_v1(integer,integer,boolean),
  public.ship_dynamics_record_other_writer_held_v1(text),
  public.ship_dynamics_record_writer_gate_v1(text,boolean),
  public.ship_dynamics_record_assert_writer_v1(text,text,text) from public,anon,authenticated;

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
  perform public.ship_dynamics_record_assert_writer_v1(p_workspace,'tasks',p_task);
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
  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);
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
  perform public.ship_dynamics_record_assert_writer_v1(p_workspace_key);
  for operation in select value from jsonb_array_elements(p_operations) where value->>'kind'='entity' loop
    perform public.ship_dynamics_record_assert_writer_v1(p_workspace_key,operation->>'collection',operation->>'entityId');
  end loop;
  select * into strict workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for no key update;
  perform pg_advisory_xact_lock_shared(hashtext('record-published-v1'),hashtext(p_workspace_key));
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

-- Private equivalence seam for an unchanged single-vessel + withAudit request.
-- NULL/fallback means the original strict CAS path, never guessed history.
-- Only audit bodies (<=500 base IDs plus current prefix) are inspected.
create or replace function public.ship_dynamics_record_merge_audit_v1(
  p_workspace text,p_operations jsonb,p_current_ids jsonb
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare
  order_op jsonb; vessel_op jsonb; add_op jsonb; op jsonb;
  base_ids jsonb; caller_ids jsonb; merged_ids jsonb; peer_ids jsonb;
  base_revision integer; base_count integer; peer_count integer;
  base_body jsonb; current_body jsonb; body_count bigint;
  id text; ordinal bigint; new_id text; new_at text;
  effective jsonb; prefix_bodies jsonb := '[]'::jsonb;
begin
  if jsonb_array_length(p_operations) not in (3,4) then return p_operations; end if;
  if (select count(*) from jsonb_array_elements(p_operations) x where x->>'kind'='order' and x->>'collection'='auditLogs')<>1
    or (select count(*) from jsonb_array_elements(p_operations) x where x->>'kind'='entity' and x->>'collection'='vessels' and jsonb_typeof(x->'expected')='object' and jsonb_typeof(x->'value')='object')<>1
    or (select count(*) from jsonb_array_elements(p_operations) x where x->>'kind'='entity' and x->>'collection'='auditLogs' and x->'expected'='null'::jsonb and jsonb_typeof(x->'value')='object')<>1
  then return p_operations; end if;
  select x into order_op from jsonb_array_elements(p_operations) x where x->>'kind'='order' and x->>'collection'='auditLogs';
  select x into vessel_op from jsonb_array_elements(p_operations) x where x->>'collection'='vessels';
  select x into add_op from jsonb_array_elements(p_operations) x where x->>'collection'='auditLogs' and x->>'kind'='entity' and x->'expected'='null'::jsonb;
  base_ids:=order_op->'expectedIds'; caller_ids:=order_op->'valueIds';
  if jsonb_typeof(base_ids) is distinct from 'array' or jsonb_typeof(caller_ids) is distinct from 'array'
    or jsonb_typeof(p_current_ids) is distinct from 'array' or p_current_ids=base_ids then return p_operations; end if;
  base_count:=jsonb_array_length(base_ids);
  if base_count>500 or jsonb_array_length(p_current_ids)>500 then return p_operations; end if;
  for op in select base_ids union all select caller_ids union all select p_current_ids loop
    if exists(select 1 from jsonb_array_elements(op) x where jsonb_typeof(x)<>'string' or x='""'::jsonb)
      or (select count(distinct x) from jsonb_array_elements_text(op) x)<>jsonb_array_length(op) then return p_operations; end if;
  end loop;
  new_id:=add_op->>'entityId'; new_at:=add_op#>>'{value,at}';
  if new_id is null or new_id='' or add_op#>>'{value,id}' is distinct from new_id
    or add_op#>>'{value,entityType}' is distinct from 'vessel'
    or add_op#>>'{value,entityId}' is distinct from vessel_op->>'entityId'
    or base_ids ? new_id or p_current_ids ? new_id
    or exists(select 1 from public.ship_dynamics_record_history h where h.workspace_key=p_workspace and h.collection='auditLogs' and h.entity_id=new_id)
    or exists(select 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='auditLogs' and r.entity_id=new_id)
  then return p_operations; end if;
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into merged_ids
    from jsonb_array_elements(jsonb_build_array(new_id)||base_ids) with ordinality t(x,n) where n<=500;
  if caller_ids is distinct from merged_ids or jsonb_array_length(p_operations)<>3+(case when base_count=500 then 1 else 0 end) then return p_operations; end if;
  -- Reject any extra/duplicate/rewrite/non-tail operation rather than discard it.
  for op in select x from jsonb_array_elements(p_operations) x where x<>order_op and x<>vessel_op and x<>add_op loop
    if base_count<>500 or op->>'kind' is distinct from 'entity' or op->>'collection' is distinct from 'auditLogs'
      or op->>'entityId' is distinct from base_ids->>499 or jsonb_typeof(op->'expected') is distinct from 'object'
      or op->'value' is distinct from 'null'::jsonb then return p_operations; end if;
  end loop;
  select max(v.revision) into base_revision from public.ship_dynamics_record_versions v
    where v.workspace_key=p_workspace and v.orders->'auditLogs'=base_ids;
  if base_revision is null then return p_operations; end if;
  -- P consists only of genuinely new, still immutable rows, not delete/recreate.
  select coalesce(jsonb_agg(to_jsonb(x) order by n),'[]'::jsonb) into peer_ids
    from jsonb_array_elements_text(p_current_ids) with ordinality t(x,n) where not base_ids ? x;
  peer_count:=jsonb_array_length(peer_ids);
  if peer_count<1 or peer_count>=500 then return p_operations; end if;
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into merged_ids
    from jsonb_array_elements(peer_ids||base_ids) with ordinality t(x,n) where n<=500;
  if p_current_ids is distinct from merged_ids then return p_operations; end if;
  -- Match mergeImmutableAuditLogs: a partial base may not lose base rows.
  if base_count<500 and base_count+peer_count>500 then return p_operations; end if;
  for id,ordinal in select * from jsonb_array_elements_text(base_ids) with ordinality loop
    select count(*),jsonb_agg(t.value)->0 into body_count,base_body from (
      select r.value from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='auditLogs' and r.entity_id=id and r.revision<=base_revision
      union all
      select h.value from public.ship_dynamics_record_history h where h.workspace_key=p_workspace and h.collection='auditLogs' and h.entity_id=id and h.valid_from_revision<=base_revision and h.valid_to_revision>base_revision
    ) t;
    if body_count<>1 then return p_operations; end if;
    -- Reappearing E is not caller provenance: an older body interval means
    -- this ID was rewritten/recreated before the selected matching revision.
    if exists(select 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='auditLogs' and r.entity_id=id and r.revision>base_revision)
      or exists(select 1 from public.ship_dynamics_record_history h where h.workspace_key=p_workspace and h.collection='auditLogs' and h.entity_id=id and (h.valid_from_revision>base_revision or h.valid_to_revision<=base_revision))
    then return p_operations; end if;
    select r.value into current_body from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='auditLogs' and r.entity_id=id;
    if (p_current_ids ? id and current_body is distinct from base_body) or (not p_current_ids ? id and current_body is not null) then return p_operations; end if;
    if ordinal=500 then
      select x into op from jsonb_array_elements(p_operations) x where x->>'kind'='entity' and x->>'collection'='auditLogs' and x->>'entityId'=id;
      if op->'expected' is distinct from base_body then return p_operations; end if;
    end if;
  end loop;
  prefix_bodies:=jsonb_build_array(add_op->'value');
  for id in select * from jsonb_array_elements_text(peer_ids) loop
    select r.value into current_body from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='auditLogs' and r.entity_id=id and r.revision>base_revision;
    if current_body is null or exists(select 1 from public.ship_dynamics_record_history h where h.workspace_key=p_workspace and h.collection='auditLogs' and h.entity_id=id) then return p_operations; end if;
    prefix_bodies:=prefix_bodies||jsonb_build_array(current_body);
  end loop;
  -- Distinct canonical UTC millisecond strings have the same ordering in JS
  -- localeCompare and C byte order. Ties/noncanonical dates retain strict CAS;
  -- never assume the deployment collation implements JS's ID tie comparator.
  if exists(select 1 from jsonb_array_elements(prefix_bodies) x where coalesce(x->>'at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$')
    or (select count(distinct x->>'at') from jsonb_array_elements(prefix_bodies) x)<>jsonb_array_length(prefix_bodies) then return p_operations; end if;
  begin
    for op in select x from jsonb_array_elements(prefix_bodies) x loop
      if to_char((op->>'at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>op->>'at' then return p_operations; end if;
    end loop;
  exception when invalid_datetime_format or datetime_field_overflow then return p_operations;
  end;
  select jsonb_agg(x->'id' order by (x->>'at') collate "C" desc) into merged_ids from jsonb_array_elements(prefix_bodies) x;
  select jsonb_agg(x order by n) into merged_ids from jsonb_array_elements(merged_ids||base_ids) with ordinality t(x,n) where n<=500;
  effective:=jsonb_build_array(vessel_op,add_op);
  -- Only the proven retained base tail is eligible. Never discard a peer audit.
  for id in select * from jsonb_array_elements_text(p_current_ids) loop
    if not merged_ids ? id then
      if not base_ids ? id then return p_operations; end if;
      select r.value into current_body from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='auditLogs' and r.entity_id=id;
      if current_body is null then return p_operations; end if;
      effective:=effective||jsonb_build_array(jsonb_build_object('kind','entity','collection','auditLogs','entityId',id,'expected',current_body,'value',null));
    end if;
  end loop;
  return effective||jsonb_build_array(jsonb_build_object('kind','order','collection','auditLogs','expectedIds',p_current_ids,'valueIds',merged_ids));
end;
$$;
revoke all on function public.ship_dynamics_record_merge_audit_v1(text,jsonb,jsonb) from public,anon,authenticated;

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
  next_revision integer; saved_at timestamptz; saved_text text; original_signature jsonb;
  prepared jsonb := '{}'::jsonb; prepared_key text; entity_lock integer; nonblocking_followup boolean;
begin
  if nullif(p_operation_id,'') is null or char_length(p_operation_id)>200 then
    return jsonb_build_object('ok',false,'code','invalid-operation-id'); end if;
  if jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations)>10000 then
    return jsonb_build_object('ok',false,'code','invalid-operations'); end if;
  if jsonb_typeof(p_lock_guards) is distinct from 'array' then
    return jsonb_build_object('ok',false,'code','invalid-lock-guards'); end if;
  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,false);
  -- Replay before authorization/lease checks: a committed lost ACK must stay
  -- recoverable after expiry or after a newer save. Payload must match exactly.
  -- A second RPC may own this root or another workspace's writer gate/root.
  -- Neither may wait behind a peer that can be waiting for a retained lock.
  nonblocking_followup:=public.ship_dynamics_record_lock_held_v1(hashtext('record-published-v1'),hashtext(p_workspace_key))
    or public.ship_dynamics_record_other_writer_held_v1(p_workspace_key);
  if nonblocking_followup then
    if not pg_try_advisory_xact_lock(hashtext('record-operation:' || p_workspace_key),hashtext(p_operation_id)) then
      raise exception 'record-writer-restart-transaction' using errcode='40001';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('record-operation:' || p_workspace_key),hashtext(p_operation_id));
  end if;
  receipt := public.get_ship_dynamics_record_receipt_v1(p_workspace_key,p_operation_id,p_operations,p_saved_by,p_actor_user_id,p_actor_guard,p_authorization_guard,p_lock_guards);
  if receipt ->> 'status' <> 'missing' then return receipt; end if;
  -- Do not lock audit/order here: they are the shared publication domain.
  -- Lock hashes in numeric order before rows, so even advisory hash collisions
  -- only reduce concurrency, never reverse a multi-entity lock order.
  for entity_lock in
    select distinct hashtext(jsonb_build_array(x->>'collection',x->>'entityId')::text)
    from jsonb_array_elements(p_operations) x
    where x->>'kind'='entity' and x->>'collection'<>'auditLogs'
      and x->>'collection'=any(names) and nullif(x->>'entityId','') is not null
    order by 1
  loop
    if nonblocking_followup then
      if not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),entity_lock) then
        raise exception 'record-writer-restart-transaction' using errcode='40001';
      end if;
    else
      perform pg_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),entity_lock);
    end if;
  end loop;
  for name,target_id in
    select distinct (x->>'collection') collate "C",(x->>'entityId') collate "C" from jsonb_array_elements(p_operations) x
    where x->>'kind'='entity' and x->>'collection'<>'auditLogs'
      and x->>'collection'=any(names) and nullif(x->>'entityId','') is not null
    order by 1,2
  loop
    -- Separate lock and hydration statements: a row changed while lock acquisition
    -- waited must be hydrated from the new READ COMMITTED snapshot, not the old one.
    if nonblocking_followup then
      begin
        perform 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace_key
          and r.collection=name and r.entity_id=target_id for update nowait;
      exception when lock_not_available then
        raise exception 'record-writer-restart-transaction' using errcode='40001';
      end;
    else
      perform 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace_key
        and r.collection=name and r.entity_id=target_id for update;
    end if;
    select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision)
      into current_value from public.ship_dynamics_records r
      where r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=target_id;
    prepared_key:=jsonb_build_array(name,target_id)::text;
    prepared:=jsonb_set(prepared,array[prepared_key],coalesce(current_value,'null'::jsonb),true);
  end loop;
  -- Global revision/history/delta/audit/order still publish atomically. Authority
  -- and leases are checked AFTER all entity waiting, against this locked root.
  if nonblocking_followup then
    begin
      select * into workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for no key update nowait;
    exception when lock_not_available then
      raise exception 'record-writer-restart-transaction' using errcode='40001';
    end;
  else
    select * into workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for no key update;
  end if;
  if not found then return jsonb_build_object('ok',false,'code','workspace-not-found'); end if;
  -- Shared marker only: never serializes independent preparers.
  perform pg_advisory_xact_lock_shared(hashtext('record-published-v1'),hashtext(p_workspace_key));

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
  original_signature := jsonb_build_array(p_operations,p_saved_by,p_actor_user_id,p_actor_guard,p_authorization_guard,p_lock_guards);
  p_operations := public.ship_dynamics_record_merge_audit_v1(p_workspace_key,p_operations,coalesce(orders->'auditLogs','[]'::jsonb));

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
      if name='auditLogs' then
        select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into current_value
          from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=target_id for update;
      else
        current_value:=nullif(prepared->(jsonb_build_array(name,target_id)::text),'null'::jsonb);
      end if;
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
    original_signature);
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
-- END COMPONENT: supabase/development/20260906_appdata_record_store.sql

-- BEGIN COMPONENT: supabase/development/20260906_appdata_record_delta.sql
-- DEVELOPMENT ONLY: private row-authority read protocol; no browser grants.
-- Apply after 20260906_appdata_record_store.sql. No legacy workspace/history read.

create or replace function public.read_ship_dynamics_record_delta_v1(
  p_workspace_key text,p_base_revision integer default null,p_base_token text default null
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare
  w public.ship_dynamics_record_workspaces%rowtype;
  b public.ship_dynamics_record_read_bases%rowtype;
  token text; envelope jsonb; orders jsonb; sets jsonb; removed jsonb;
  changes jsonb := '[]'::jsonb; change jsonb; name text;
  before_ids jsonb; after_ids jsonb; upserts jsonb; deleted_ids jsonb;
begin
  -- One STABLE statement snapshot for root, order metadata and all changed rows.
  select * into w from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key;
  if not found then return jsonb_build_object('protocol','ship-dynamics-delta-v1','workspace_key',p_workspace_key,'status','missing'); end if;
  token := md5(jsonb_build_array(p_workspace_key,w.import_token,w.revision)::text);
  envelope := jsonb_build_object('protocol','ship-dynamics-delta-v1','workspace_key',p_workspace_key,'revision',w.revision,'payload_token',token);
  if p_base_revision=w.revision and p_base_token=token then
    return envelope || jsonb_build_object('status','delta','base_revision',p_base_revision,'base_token',p_base_token,
      'root',jsonb_build_object('set','{}'::jsonb,'deleted','[]'::jsonb),'collections','[]'::jsonb);
  end if;
  if p_base_revision<w.revision then
    select rb.* into b from public.ship_dynamics_record_read_bases rb where rb.workspace_key=p_workspace_key and rb.revision=p_base_revision and rb.token=p_base_token;
  end if;
  if b.revision is null then
    return envelope || jsonb_build_object('status','snapshot','payload',public.read_ship_dynamics_records_v1(p_workspace_key) -> 'payload');
  end if;
  select coalesce(jsonb_object_agg(collection,ids),'{}'::jsonb) into orders
    from public.ship_dynamics_record_collections where workspace_key=p_workspace_key;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into sets
    from jsonb_each(w.root) where b.root -> key is distinct from value;
  select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into removed
    from jsonb_object_keys(b.root) key where not (w.root ? key);
  for name in select key from jsonb_object_keys(orders || b.orders) key loop
    before_ids := b.orders -> name; after_ids := orders -> name;
    if after_ids is null then removed := removed || jsonb_build_array(name); continue; end if;
    if before_ids is null then
      -- The existing consumer intentionally rejects entity deltas against a
      -- missing array. Materialize only this newly introduced collection.
      select coalesce(jsonb_agg(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) order by ids.ordinal),'[]'::jsonb) into upserts
        from jsonb_array_elements_text(after_ids) with ordinality ids(id,ordinal)
        join public.ship_dynamics_records r on r.workspace_key=p_workspace_key and r.collection=name and r.entity_id=ids.id;
      sets := jsonb_set(sets,array[name],upserts,true); continue;
    end if;
    select coalesce(jsonb_agg(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) order by r.entity_id),'[]'::jsonb) into upserts
      from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.revision>p_base_revision and r.collection=name;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into deleted_ids
      from jsonb_array_elements_text(before_ids) id where not (after_ids ? id);
    if before_ids=after_ids and upserts='[]'::jsonb then continue; end if;
    change := jsonb_build_object('collection',name,'upserts',upserts,'deleted',deleted_ids);
    if before_ids is distinct from after_ids then change := change || jsonb_build_object('order',after_ids); end if;
    changes := changes || jsonb_build_array(change);
  end loop;
  return envelope || jsonb_build_object('status','delta','base_revision',p_base_revision,'base_token',p_base_token,
    'root',jsonb_build_object('set',sets,'deleted',removed),'collections',changes);
end;
$$;
revoke all on function public.read_ship_dynamics_record_delta_v1(text,integer,text) from public,anon,authenticated;
-- END COMPONENT: supabase/development/20260906_appdata_record_delta.sql

-- BEGIN COMPONENT: supabase/development/20260909_task_member_protocol.sql
-- PRIVATE DEVELOPMENT CANDIDATE. Install after c448 record store, quiescent only.
-- No browser grants. Original UI and generic request/receipt signatures unchanged.

select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create sequence if not exists public.ship_dynamics_member_fence_seq;
create table if not exists public.ship_dynamics_member_fences(
 workspace_key text not null,task_id text not null,scope text not null,version bigint not null,
 primary key(workspace_key,task_id,scope));
alter table public.ship_dynamics_member_fences enable row level security;
revoke all on public.ship_dynamics_member_fences,public.ship_dynamics_member_fence_seq from public,anon,authenticated;
alter table public.ship_dynamics_edit_locks add column if not exists lease_version bigint not null default nextval('public.ship_dynamics_member_fence_seq');
create or replace function public.ship_dynamics_task_member_key_v1(p_task text,p_vessel text)
returns text language sql immutable strict as $$ select 'task-member-v1:'||jsonb_build_array(p_task,p_vessel)::text $$;
create or replace function public.ship_dynamics_task_lock_family_v1(p_key text)
returns text language plpgsql immutable as $$
declare j jsonb;
begin
 if left(p_key,5)='task:' then return substring(p_key from 6); end if;
 if left(p_key,15)='task-member-v1:' then
  begin j:=substring(p_key from 16)::jsonb; exception when others then raise exception 'invalid-member-key'; end;
  if jsonb_typeof(j) is distinct from 'array' or jsonb_array_length(j)<>2
   or jsonb_typeof(j->0) is distinct from 'string' or jsonb_typeof(j->1) is distinct from 'string'
   or j->>0='' or j->>1='' or p_key is distinct from public.ship_dynamics_task_member_key_v1(j->>0,j->>1)
  then raise exception 'invalid-member-key'; end if;
  return j->>0;
 end if;
 return null;
end $$;
-- Task-family mutations share one gate BEFORE touching a lease row. A retained
-- lease row also makes later record calls follow-ups: reuse the existing shared
-- nonexclusive marker so legacy/native multi-call consumers never reverse-WAIT.
create or replace function public.ship_dynamics_task_lease_gate_v1(p_workspace text,p_key text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare family text;followup boolean;
begin
 family:=public.ship_dynamics_task_lock_family_v1(p_key);
 if family is null then return; end if;
 perform public.ship_dynamics_record_writer_gate_v1(p_workspace,false);
 followup:=public.ship_dynamics_record_lock_held_v1(hashtext('record-published-v1'),hashtext(p_workspace)) or public.ship_dynamics_record_other_writer_held_v1(p_workspace);
 if followup then
  if not pg_try_advisory_xact_lock(hashtext('task-lease-family:'||p_workspace),hashtext(family)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
  begin perform 1 from public.ship_dynamics_edit_locks where workspace_key=p_workspace and section_key=p_key for update nowait;
  exception when lock_not_available then raise exception 'record-writer-restart-transaction' using errcode='40001'; end;
 else
  perform pg_advisory_xact_lock(hashtext('task-lease-family:'||p_workspace),hashtext(family));
  perform 1 from public.ship_dynamics_edit_locks where workspace_key=p_workspace and section_key=p_key for update;
 end if;
 perform pg_advisory_xact_lock_shared(hashtext('record-published-v1'),hashtext(p_workspace));
end $$;
revoke all on function public.ship_dynamics_task_lease_gate_v1(text,text) from public,anon,authenticated;
-- Same public signature: rollback/old clients participate in hierarchy too.
create or replace function public.claim_ship_dynamics_edit_lock(p_workspace_key text,p_section_key text,p_locked_by text,p_locked_by_name text,p_ttl_seconds integer default 75)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare family text; e public.ship_dynamics_edit_locks%rowtype; c public.ship_dynamics_edit_locks%rowtype;
begin
 family:=public.ship_dynamics_task_lock_family_v1(p_section_key);
 if family is not null then
  perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  select * into e from public.ship_dynamics_edit_locks l where l.workspace_key=p_workspace_key
   and l.expires_at>clock_timestamp() and l.section_key<>p_section_key
   and public.ship_dynamics_task_lock_family_v1(l.section_key)=family
   and (p_section_key='task:'||family or l.section_key='task:'||family) order by l.section_key limit 1;
  if found then return jsonb_build_object('ok',false,'code','parent-child-lock-conflict','section_key',e.section_key,'locked_by',e.locked_by); end if;
 end if;
 insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,locked_at,expires_at)
 values(p_workspace_key,p_section_key,p_locked_by,p_locked_by_name,clock_timestamp(),clock_timestamp()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120)))
 on conflict(workspace_key,section_key) do update set locked_by=excluded.locked_by,locked_by_name=excluded.locked_by_name,locked_at=excluded.locked_at,expires_at=excluded.expires_at,
 lease_version=case when ship_dynamics_edit_locks.expires_at<=clock_timestamp() or ship_dynamics_edit_locks.locked_by<>excluded.locked_by then nextval('public.ship_dynamics_member_fence_seq') else ship_dynamics_edit_locks.lease_version end
 where ship_dynamics_edit_locks.expires_at<=clock_timestamp() or ship_dynamics_edit_locks.locked_by=excluded.locked_by returning * into c;
 if not found then return jsonb_build_object('ok',false,'code','lock-conflict','section_key',p_section_key); end if;
 return jsonb_build_object('ok',true,'section_key',c.section_key,'locked_by',c.locked_by,'locked_by_name',c.locked_by_name,'expires_at',c.expires_at,'lease_version',c.lease_version::text);
end $$;
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
  if left(p_section_key,15)='task-member-v1:' then return jsonb_build_object('ok',false,'code','member-lease-fence-required'); end if;
  perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  update public.ship_dynamics_edit_locks
  set expires_at = (case when left(p_section_key,5)='task:' then clock_timestamp() else now() end) + make_interval(secs => least(greatest(p_ttl_seconds, 30), 120))
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by
    and expires_at > (case when left(p_section_key,5)='task:' then clock_timestamp() else now() end)
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
  if left(p_section_key,15)='task-member-v1:' then return false; end if;
  perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
  delete from public.ship_dynamics_edit_locks
  where workspace_key = p_workspace_key
    and section_key = p_section_key
    and locked_by = p_locked_by;
  return true;
end;
$$;


-- Only member scope requires new fenced cleanup/heartbeat. Legacy parent signatures unchanged.
create or replace function public.renew_ship_dynamics_task_member_lock_v1(p_workspace_key text,p_section_key text,p_locked_by text,p_lease_version text,p_ttl_seconds integer default 75)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare renewed public.ship_dynamics_edit_locks%rowtype;
begin
 if left(p_section_key,15) is distinct from 'task-member-v1:' then return jsonb_build_object('ok',false,'code','invalid-member-key'); end if;
 perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
 update public.ship_dynamics_edit_locks set expires_at=clock_timestamp()+make_interval(secs=>least(greatest(p_ttl_seconds,30),120))
 where workspace_key=p_workspace_key and section_key=p_section_key and locked_by=p_locked_by and lease_version::text=p_lease_version and expires_at>clock_timestamp() returning * into renewed;
 if not found then return jsonb_build_object('ok',false,'code','lock-conflict'); end if;
 return jsonb_build_object('ok',true,'section_key',renewed.section_key,'locked_by',renewed.locked_by,'lease_version',renewed.lease_version::text,'expires_at',renewed.expires_at);
end $$;
create or replace function public.release_ship_dynamics_task_member_lock_v1(p_workspace_key text,p_section_key text,p_locked_by text,p_lease_version text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if left(p_section_key,15) is distinct from 'task-member-v1:' then return false; end if;
 perform public.ship_dynamics_task_lease_gate_v1(p_workspace_key,p_section_key);
 delete from public.ship_dynamics_edit_locks where workspace_key=p_workspace_key and section_key=p_section_key and locked_by=p_locked_by and lease_version::text=p_lease_version;
 return found;
end $$;
revoke all on function public.renew_ship_dynamics_task_member_lock_v1(text,text,text,text,integer),public.release_ship_dynamics_task_member_lock_v1(text,text,text,text) from public,anon,authenticated;
create or replace function public.ship_dynamics_member_track_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare w text;t text;k text;v jsonb;
begin
 if TG_TABLE_NAME='ship_dynamics_records' then
  if coalesce(new.collection,old.collection)<>'tasks' then return null; end if;
  if TG_OP='UPDATE' and (old.value-array['vesselProgress','updatedAt','updatedBy']) is not distinct from (new.value-array['vesselProgress','updatedAt','updatedBy'])
   and ((old.task_progress_meta->>'kind' in ('array','absent') and new.task_progress_meta->>'kind' in ('array','absent')) or old.task_progress_meta is not distinct from new.task_progress_meta)
  then return null; end if;
  w:=coalesce(new.workspace_key,old.workspace_key);t:=coalesce(new.entity_id,old.entity_id);k:='structure';
  insert into public.ship_dynamics_member_fences values(w,t,k,nextval('public.ship_dynamics_member_fence_seq')) on conflict(workspace_key,task_id,scope) do update set version=excluded.version;
 else
  if TG_OP='UPDATE' and old.value=new.value then return null; end if;
  w:=coalesce(new.workspace_key,old.workspace_key);t:=coalesce(new.task_id,old.task_id);
  for v in select old.value where TG_OP<>'INSERT' union select new.value where TG_OP<>'DELETE' loop
   if jsonb_typeof(v->'vesselId')='string' then
    k:='member:'||(v->>'vesselId');
    insert into public.ship_dynamics_member_fences values(w,t,k,nextval('public.ship_dynamics_member_fence_seq')) on conflict(workspace_key,task_id,scope) do update set version=excluded.version;
   end if;
  end loop;
 end if;
 return null;
end $$;
drop trigger if exists ship_dynamics_member_structure on public.ship_dynamics_records;
create trigger ship_dynamics_member_structure after insert or update or delete on public.ship_dynamics_records for each row execute function public.ship_dynamics_member_track_v1();
drop trigger if exists ship_dynamics_member_progress on public.ship_dynamics_record_task_progress;
create trigger ship_dynamics_member_progress after insert or update or delete on public.ship_dynamics_record_task_progress for each row execute function public.ship_dynamics_member_track_v1();
insert into public.ship_dynamics_member_fences select workspace_key,entity_id,'structure',nextval('public.ship_dynamics_member_fence_seq') from public.ship_dynamics_records where collection='tasks' on conflict do nothing;
insert into public.ship_dynamics_member_fences select distinct workspace_key,task_id,'member:'||(value->>'vesselId'),nextval('public.ship_dynamics_member_fence_seq') from public.ship_dynamics_record_task_progress where jsonb_typeof(value->'vesselId')='string' on conflict do nothing;
create or replace function public.ship_dynamics_member_source_v1(p_workspace text,p_task text)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('collection',r.collection,'id',r.entity_id,'version',r.revision) order by r.collection collate "C",r.entity_id collate "C"),'[]'::jsonb)
 from public.ship_dynamics_records r join public.ship_dynamics_records t on t.workspace_key=r.workspace_key and t.collection='tasks' and t.entity_id=p_task
 where r.workspace_key=p_workspace and ((r.collection='meetings' and r.entity_id=t.value->>'sourceMeetingId')
 or (r.collection='internalControlCases' and (r.entity_id=t.value->>'internalControlCaseId' or r.value->>'linkedTaskId'=p_task)))
$$;
create or replace function public.read_ship_dynamics_task_member_v1(p_workspace_key text,p_task_id text,p_vessel_id text,p_actor_user_id text)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare task jsonb;progress jsonb;guard jsonb;auth jsonb;s text;m text;closure jsonb;
begin
 select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into task from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.entity_id=p_task_id;
 if task is null then return jsonb_build_object('ok',false,'code','task-not-found'); end if;
 select w.root||coalesce(jsonb_object_agg(c.collection,(select coalesce(jsonb_agg(r.value order by x.n),'[]'::jsonb) from jsonb_array_elements_text(c.ids) with ordinality x(id,n) join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=x.id)),'{}'::jsonb) into auth
 from public.ship_dynamics_record_workspaces w left join public.ship_dynamics_record_collections c on c.workspace_key=w.workspace_key and c.collection in ('users','vessels') where w.workspace_key=p_workspace_key group by w.root;
 guard:=public.ship_dynamics_actor_guard(auth,p_actor_user_id);
 if guard is null or not (guard->'visibleVesselIds') ? p_vessel_id then return jsonb_build_object('ok',false,'code','authorization-conflict'); end if;
 if jsonb_typeof(task->'vesselIds') is distinct from 'array' or not (task->'vesselIds') ? p_vessel_id or task->'distributeToVessels' is distinct from 'true'::jsonb or (select count(distinct x) from jsonb_array_elements_text(task->'vesselIds') x where x<>'')<2 or nullif(task->>'sourceMeetingId','') is null then return jsonb_build_object('ok',false,'code','invalid-member-target'); end if;
 if (task ? 'vesselProgress' and jsonb_typeof(task->'vesselProgress') is distinct from 'array')
  or exists(select 1 from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'vesselId') is distinct from 'string')
  or exists(select 1 from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x group by x->>'vesselId' having count(*)>1)
 then return jsonb_build_object('ok',false,'code','ambiguous-progress-parent-required'); end if;
 select x into progress from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=p_vessel_id;
 progress:=coalesce(progress,jsonb_build_object('vesselId',p_vessel_id,'status','','isClosed',false,'statusLogs','[]'::jsonb));
 select version::text into s from public.ship_dynamics_member_fences where workspace_key=p_workspace_key and task_id=p_task_id and scope='structure';
 select version::text into m from public.ship_dynamics_member_fences where workspace_key=p_workspace_key and task_id=p_task_id and scope='member:'||p_vessel_id;
 select jsonb_agg(jsonb_build_object('vesselId',id,'isClosed',coalesce((select x->'isClosed' from jsonb_array_elements(coalesce(task->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=id),'false'::jsonb)) order by n) into closure from jsonb_array_elements_text(task->'vesselIds') with ordinality v(id,n);
 return jsonb_build_object('ok',true,'protocol','ship-dynamics-task-member-v1','section_key',public.ship_dynamics_task_member_key_v1(p_task_id,p_vessel_id),'task',task-'vesselProgress','progress',progress,'expected',jsonb_build_object('structure',s,'member',coalesce(m,'0'),'source',public.ship_dynamics_member_source_v1(p_workspace_key,p_task_id)),'actor_guard',guard,'closure',closure,'revision',auth->'revision');
end $$;
create or replace function public.get_ship_dynamics_task_member_receipt_v1(p_workspace_key text,p_operation_id text,p_task_id text,p_vessel_id text,p_command jsonb,p_expected jsonb,p_actor_user_id text,p_actor_guard jsonb,p_lock_guards jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare r public.ship_dynamics_record_receipts%rowtype;s jsonb:=jsonb_build_array('ship-dynamics-task-member-v1',p_task_id,p_vessel_id,p_command,p_expected,p_actor_user_id,p_actor_guard,p_lock_guards);
begin
 select * into r from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=p_operation_id;
 if not found then return jsonb_build_object('status','missing'); end if;
 if r.signature is distinct from s then return jsonb_build_object('ok',false,'status','mismatch','code','operation-id-mismatch'); end if;
 return r.result||jsonb_build_object('replayed',true);
end $$;
-- Exact non-DOM richTextToPlainText projection used only for meeting audit detail.
create or replace function public.ship_dynamics_member_plain_text_v1(p_value text)
returns text language plpgsql immutable as $$
declare result text; entity text[]; number numeric; digit text; code integer;
begin
 result:=regexp_replace(coalesce(p_value,''),'<(script|style)[^>]*>.*?</\1>','','gis');
 result:=regexp_replace(result,'<br\s*/?>',E'\n','gi');
 result:=regexp_replace(result,'</(p|div|li|h[1-6]|blockquote)>',E'\n','gi');
 result:=regexp_replace(result,'<[^>]*>','','g');
 result:=regexp_replace(result,'&nbsp;',' ','gi');result:=regexp_replace(result,'&amp;','&','gi');
 result:=regexp_replace(result,'&lt;','<','gi');result:=regexp_replace(result,'&gt;','>','gi');
 result:=regexp_replace(result,'&quot;','"','gi');result:=regexp_replace(result,'&#39;|&apos;',chr(39),'gi');
 for entity in select regexp_matches(result,'&#([0-9]+);','g') loop
  number:=entity[1]::numeric;
  result:=replace(result,'&#'||entity[1]||';',case when number>1114111 or number between 55296 and 57343 then chr(65533) else chr(number::integer) end);
 end loop;
 for entity in select regexp_matches(result,'&#[xX]([0-9a-fA-F]+);','g') loop
  number:=0;for code in 1..length(entity[1]) loop number:=number*16+strpos('0123456789abcdef',lower(substr(entity[1],code,1)))-1; end loop;
  digit:=case when number>1114111 or number between 55296 and 57343 then chr(65533) else chr(number::integer) end;
  result:=replace(replace(result,'&#x'||entity[1]||';',digit),'&#X'||entity[1]||';',digit);
 end loop;
 result:=replace(result,E'\r','');
 result:=translate(result,chr(8203)||chr(8204)||chr(8205)||chr(8288)||chr(65279),'');
 result:=regexp_replace(result,E'[\t ]+\n',E'\n','g');result:=regexp_replace(result,E'\n{2,}',E'\n','g');
 return btrim(result,E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
end $$;
revoke all on function public.ship_dynamics_member_plain_text_v1(text) from public,anon,authenticated;
-- ECMAScript WhiteSpace + LineTerminator, comparison only; raw strings persist.
create or replace function public.ship_dynamics_member_js_trim_v1(p_value text)
returns text language sql immutable strict as $$
 select btrim(p_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
revoke all on function public.ship_dynamics_member_js_trim_v1(text) from public,anon,authenticated;
create or replace function public.save_ship_dynamics_task_member_v1(p_workspace_key text,p_operation_id text,p_task_id text,p_vessel_id text,p_command jsonb,p_expected jsonb,p_actor_user_id text,p_actor_guard jsonb,p_lock_guards jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='8s' as $$
declare
 r jsonb;ctx jsonb;task jsonb;old jsonb;updated jsonb;meeting jsonb;mi jsonb;guard jsonb;ag jsonb;actor jsonb;perms jsonb;
 operations jsonb:='[]'::jsonb;orders jsonb;nextorders jsonb;root jsonb;logs jsonb;log jsonb;source jsonb;keys jsonb;
 item jsonb;vessel jsonb;usr jsonb;audit jsonb;notices jsonb:='[]'::jsonb;auds jsonb:='[]'::jsonb;
 lock_number integer;target record;followup boolean;beforeclosed boolean;afterclosed boolean;shared boolean;changed boolean;
 section text;required text[];stamped text;day text;newid text;name text;removed_id text;ids jsonb;actorname text;role text;signature jsonb;
begin
 if nullif(p_operation_id,'') is null or length(p_operation_id)>200 then return jsonb_build_object('ok',false,'code','invalid-operation-id'); end if;
 perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,false);
 followup:=public.ship_dynamics_record_lock_held_v1(hashtext('record-published-v1'),hashtext(p_workspace_key)) or public.ship_dynamics_record_other_writer_held_v1(p_workspace_key);
 if followup then
  if not pg_try_advisory_xact_lock(hashtext('record-operation:'||p_workspace_key),hashtext(p_operation_id)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
 else perform pg_advisory_xact_lock(hashtext('record-operation:'||p_workspace_key),hashtext(p_operation_id)); end if;
 r:=public.get_ship_dynamics_task_member_receipt_v1(p_workspace_key,p_operation_id,p_task_id,p_vessel_id,p_command,p_expected,p_actor_user_id,p_actor_guard,p_lock_guards);
 if r->>'status'<>'missing' then return r; end if;
 signature:=jsonb_build_array('ship-dynamics-task-member-v1',p_task_id,p_vessel_id,p_command,p_expected,p_actor_user_id,p_actor_guard,p_lock_guards);
 if jsonb_typeof(p_command) is distinct from 'object' or jsonb_typeof(p_command->'status') is distinct from 'string' or jsonb_typeof(p_command->'isClosed') is distinct from 'boolean'
 or exists(select 1 from jsonb_object_keys(p_command) k where k<>all(array['status','isClosed','closedDate','newStatusLogs','mode']))
 or coalesce(p_command->>'mode','leaf') not in ('leaf','shared') or jsonb_typeof(p_expected->'source') is distinct from 'array' or jsonb_typeof(p_lock_guards) is distinct from 'array'
 then return jsonb_build_object('ok',false,'code','invalid-member-command'); end if;
 shared:=p_command->>'mode'='shared';shared:=coalesce(shared,false);
 -- Original intent provides only a versioned source identity vector, never graph bodies.
 keys:=jsonb_build_array(jsonb_build_object('collection','tasks','id',p_task_id))||(p_expected->'source');
 for lock_number in select distinct hashtext(jsonb_build_array(x->>'collection',x->>'id')::text) from jsonb_array_elements(keys) x order by 1 loop
  if followup then
   if not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),lock_number) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
  else perform pg_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),lock_number); end if;
 end loop;
 for target in select distinct (x->>'collection') collate "C" c,(x->>'id') collate "C" id from jsonb_array_elements(keys) x order by 1,2 loop
  if followup then
   begin perform 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=target.c and r.entity_id=target.id for update nowait;
   exception when lock_not_available then raise exception 'record-writer-restart-transaction' using errcode='40001'; end;
  else perform 1 from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection=target.c and r.entity_id=target.id for update; end if;
 end loop;
 if followup then
  begin select w.root into root from public.ship_dynamics_record_workspaces w where workspace_key=p_workspace_key for no key update nowait;
  exception when lock_not_available then raise exception 'record-writer-restart-transaction' using errcode='40001'; end;
 else select w.root into root from public.ship_dynamics_record_workspaces w where workspace_key=p_workspace_key for no key update; end if;
 perform pg_advisory_xact_lock_shared(hashtext('record-published-v1'),hashtext(p_workspace_key));
 ctx:=public.read_ship_dynamics_task_member_v1(p_workspace_key,p_task_id,p_vessel_id,p_actor_user_id);
 if ctx->'ok' is distinct from 'true'::jsonb then return ctx; end if;
 if ctx->'expected' is distinct from p_expected then return jsonb_build_object('ok',false,'code','member-context-conflict'); end if;
 ag:=ctx->'actor_guard';actor:=ag->'actor';actorname:=actor->>'name';role:=actor->>'role';perms:=ag->'effectivePermissions';
 if ag is distinct from p_actor_guard or role='vessel' or not (role='owner' or coalesce((perms->>'editBusinessContent')::boolean,role in ('admin','operator'))) then return jsonb_build_object('ok',false,'code','authorization-conflict'); end if;
 task:=ctx->'task';old:=ctx->'progress';
 select value into meeting from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='meetings' and entity_id=task->>'sourceMeetingId';
 if meeting is null or task->>'sourceType' is distinct from 'temporary' or task->>'attentionDimension' is distinct from 'meeting'
  or (select count(*) from jsonb_array_elements(meeting->'taskItems') x where x->>'id'=task->>'sourceMeetingItemId')<>1
  or task->'isInternalControl' is distinct from meeting->'isInternalControl'
  or coalesce(task->>'vesselScopeMode','vessels')<>coalesce(meeting->>'vesselScopeMode','vessels')
  or not ((task->'vesselIds') @> (meeting->'vessels') and (meeting->'vessels') @> (task->'vesselIds'))
  or (coalesce(task->>'vesselScopeMode','vessels')='types' and not(coalesce(task->'vesselTypeScopes','[]'::jsonb) @> coalesce(meeting->'vesselTypeScopes','[]'::jsonb) and coalesce(meeting->'vesselTypeScopes','[]'::jsonb) @> coalesce(task->'vesselTypeScopes','[]'::jsonb)))
 then return jsonb_build_object('ok',false,'code','source-graph-conflict'); end if;
 select x into mi from jsonb_array_elements(meeting->'taskItems') x where x->>'id'=task->>'sourceMeetingItemId';
 if mi->'distributeToVessels' is distinct from 'true'::jsonb then return jsonb_build_object('ok',false,'code','source-graph-conflict'); end if;
 required:=case when shared then array['task:'||p_task_id,'meeting:'||(task->>'sourceMeetingId')] else array[ctx->>'section_key'] end;
 if shared then for item in select x from jsonb_array_elements(p_expected->'source') x where x->>'collection'='internalControlCases' loop required:=array_append(required,'internal-control:'||(item->>'id')); end loop; end if;
 foreach section in array required loop
  select x into guard from jsonb_array_elements(p_lock_guards) x where x->>'section_key'=section;
  if guard is null then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',section); end if;
  perform 1 from public.ship_dynamics_edit_locks l where l.workspace_key=p_workspace_key and l.section_key=section and l.locked_by=guard->>'locked_by' and l.lease_version::text=guard->>'lease_version' and l.expires_at>clock_timestamp() for share;
  if not found then return jsonb_build_object('ok',false,'code','lock-conflict','conflict_key',section); end if;
 end loop;
 changed:=old->'isClosed' is distinct from p_command->'isClosed';
 if changed and not(role='owner' or coalesce((perms->>'closeTasks')::boolean,role in ('admin','operator'))) then return jsonb_build_object('ok',false,'code','close-permission-denied'); end if;
 logs:=coalesce(p_command->'newStatusLogs','[]'::jsonb);
 if jsonb_typeof(logs) is distinct from 'array' or exists(select 1 from jsonb_array_elements(logs) x where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'text') is distinct from 'string' or x-'text'<>'{}'::jsonb) then return jsonb_build_object('ok',false,'code','invalid-member-logs'); end if;
 if old->'isClosed'='true'::jsonb and p_command->'isClosed'='true'::jsonb and (old->'status' is distinct from p_command->'status' or jsonb_array_length(logs)>0 or (p_command ? 'closedDate' and old->'closedDate' is distinct from p_command->'closedDate')) then return jsonb_build_object('ok',false,'code','closed-member-readonly'); end if;
 if old->'status' is distinct from p_command->'status' and jsonb_array_length(logs)=0 then logs:=jsonb_build_array(jsonb_build_object('text',p_command->'status')); end if;
 if jsonb_array_length(logs)>0 and public.ship_dynamics_member_js_trim_v1(logs#>>'{0,text}')<>public.ship_dynamics_member_js_trim_v1(p_command->>'status') then return jsonb_build_object('ok',false,'code','status-log-mismatch'); end if;
 stamped:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');day:=to_char(clock_timestamp() at time zone 'Asia/Taipei','YYYY-MM-DD');
 updated:=old||jsonb_build_object('status',p_command->'status','isClosed',p_command->'isClosed','updatedAt',stamped,'updatedBy',p_actor_user_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid()::text,'at',stamped,'by',actorname,'byUserId',p_actor_user_id,'text',x->'text') order by n),'[]'::jsonb) into logs from jsonb_array_elements(logs) with ordinality a(x,n);
 updated:=updated||jsonb_build_object('statusLogs',logs||coalesce(old->'statusLogs','[]'::jsonb));
 if p_command->'isClosed'='true'::jsonb and changed then
  begin if btrim(p_command->>'closedDate') ~ '^\d{4}-\d{2}-\d{2}$' and to_char((btrim(p_command->>'closedDate'))::date,'YYYY-MM-DD')=btrim(p_command->>'closedDate') then day:=btrim(p_command->>'closedDate'); end if; exception when others then null; end;
  updated:=updated||jsonb_build_object('closedDate',day,'closedBy',p_actor_user_id);
 elsif p_command->'isClosed'='false'::jsonb then updated:=updated-array['closedDate','closedBy']; end if;
 select bool_and(x->'isClosed'='true'::jsonb),bool_and(case when x->>'vesselId'=p_vessel_id then p_command->'isClosed'='true'::jsonb else x->'isClosed'='true'::jsonb end) into beforeclosed,afterclosed from jsonb_array_elements(ctx->'closure') x;
 if beforeclosed is distinct from afterclosed then
  if not(role='owner' or (coalesce((perms->>'manageMeetings')::boolean,role='admin') and coalesce((perms->>'viewAllVessels')::boolean,role='admin'))) then return jsonb_build_object('ok',false,'code','meeting-permission-denied'); end if;
  if not afterclosed and meeting->>'status'='已完成' then return jsonb_build_object('ok',false,'code','meeting-reopen-required'); end if;
  if not shared then return jsonb_build_object('ok',false,'code','transition-required'); end if;
 end if;
 -- Fresh siblings, exact raw values and order; only existing helper's prepend/retention effects.
 select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into item from public.ship_dynamics_records r cross join lateral jsonb_array_elements(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision)->'vesselProgress') with ordinality a(x,n) where r.workspace_key=p_workspace_key and r.collection='tasks' and r.entity_id=p_task_id and x->>'vesselId'<>p_vessel_id and ((task->'vesselIds') ? (x->>'vesselId') or x->'isClosed'='true'::jsonb);
 task:=task||jsonb_build_object('vesselProgress',jsonb_build_array(updated)||item,'updatedAt',stamped,'updatedBy',p_actor_user_id);
 operations:=jsonb_build_array(jsonb_build_object('kind','entity','collection','tasks','entityId',p_task_id,'value',task));
 if beforeclosed is distinct from afterclosed then
  mi:=mi||jsonb_build_object('isClosed',afterclosed);
  mi:=mi-array['closedDate','closedBy'];
  if afterclosed then
   -- Original meetingDecisionLifecycleFromTask: latest closed progress by
   -- updatedAt, stable ties in task scope order (not prepended progress order).
   select x into item from jsonb_array_elements_text(task->'vesselIds') with ordinality v(id,n)
    cross join lateral jsonb_array_elements(task->'vesselProgress') x
    where x->>'vesselId'=v.id and x->'isClosed'='true'::jsonb
    order by coalesce(x->>'updatedAt','') collate "C" desc,v.n desc limit 1;
   if coalesce(nullif(item->>'closedDate',''),nullif(task->>'closedDate','')) is not null then mi:=mi||jsonb_build_object('closedDate',coalesce(nullif(item->>'closedDate',''),task->>'closedDate')); end if;
   if coalesce(nullif(item->>'closedBy',''),nullif(task->>'closedBy','')) is not null then mi:=mi||jsonb_build_object('closedBy',coalesce(nullif(item->>'closedBy',''),task->>'closedBy')); end if;
  end if;
  select jsonb_agg(case when x->>'id'=task->>'sourceMeetingItemId' then mi else x end order by n) into item from jsonb_array_elements(meeting->'taskItems') with ordinality a(x,n);
  name:=case when afterclosed then '決議待辦已完成' else '決議待辦重新開啟' end;
  meeting:=meeting||jsonb_build_object('taskItems',item,'latestStatus',name,'updatedAt',stamped,'statusLogs',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'at',stamped,'by',actorname,'byUserId',p_actor_user_id,'text',name))||coalesce(meeting->'statusLogs','[]'::jsonb));
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','meetings','entityId',meeting->>'id','value',meeting));
 end if;
 select value into vessel from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='vessels' and entity_id=p_vessel_id;
 -- Server-owned audit and notification suffixes preserve original collections/caps.
 audit:=jsonb_build_object('id',gen_random_uuid()::text,'at',stamped,'actorId',p_actor_user_id,'actorName',actorname,'actorRole',role,'action','更新單船進度','entityType','task','entityId',p_task_id,'detail',coalesce(nullif(btrim(vessel->>'fullName'),''),nullif(btrim(vessel->>'name'),''),nullif(btrim(vessel->>'shortName'),''),p_vessel_id)||'｜'||coalesce(nullif(updated->>'status',''),'未填狀態')||'｜'||case when updated->'isClosed'='true'::jsonb then '已結案' else '未結' end);
 auds:=jsonb_build_array(audit);
 if beforeclosed is distinct from afterclosed then auds:=jsonb_build_array(audit||jsonb_build_object('id',gen_random_uuid()::text,'action',case when afterclosed then '同步完成臨會/專題待辦' else '同步重新開啟臨會/專題待辦' end,'entityType','meeting','entityId',meeting->>'id','detail',coalesce(nullif(public.ship_dynamics_member_plain_text_v1(task->>'description'),''),p_task_id)))||auds; end if;
 -- Original stable concatenation: supervisors in users order, then eligible
 -- owners in ownerUserIds order, deduplicating by the first occurrence.
 for usr in
  with users as (
   select r.value u,a.n,
    (coalesce(vessel->'assignedUserIds','[]'::jsonb) ? r.entity_id or coalesce(r.value->'managedVesselIds','[]'::jsonb) ? p_vessel_id or exists(select 1 from jsonb_array_elements(coalesce(vessel->'delegateManagers','[]'::jsonb)) x where x->>'userId'=r.entity_id and x->'isActive'='true'::jsonb)) assigned
   from public.ship_dynamics_record_collections c cross join lateral jsonb_array_elements_text(c.ids) with ordinality a(id,n)
   join public.ship_dynamics_records r on r.workspace_key=c.workspace_key and r.collection=c.collection and r.entity_id=a.id
   where c.workspace_key=p_workspace_key and c.collection='users' and r.entity_id<>p_actor_user_id and r.value->'isActive' is distinct from 'false'::jsonb and r.value->>'role'<>'vessel'
  ), recipients as (
   select u,1 phase,n from users where assigned and coalesce(u->>'department','') ~ '督導|航運處'
   union all
   select u,2 phase,o.n from jsonb_array_elements_text(coalesce(task->'ownerUserIds','[]'::jsonb)) with ordinality o(id,n) join users on u->>'id'=o.id
   where assigned or u->>'role' in ('owner','admin') or root#>array['settings','rolePermissions',u->>'role','viewAllVessels']='true'::jsonb
  ), dedup as (select distinct on (u->>'id') u,phase,n from recipients order by u->>'id',phase,n)
  select u from dedup order by phase,n
 loop
   notices:=notices||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'userId',usr->>'id','vesselId',p_vessel_id,'taskId',p_task_id,'kind','task_updated','title','更新待辦｜'||case when task->'isInternalControl'='true'::jsonb then '內部管控｜' else '' end||coalesce(nullif(task->>'description',''),'未命名事項'),'message',actorname||' 更新待辦：'||coalesce(nullif(task->>'description',''),'未命名事項'),'actorId',p_actor_user_id,'createdAt',stamped));
 end loop;
 select jsonb_object_agg(collection,c.ids) into orders from public.ship_dynamics_record_collections c where workspace_key=p_workspace_key;nextorders:=orders;
 foreach name in array array['auditLogs','notifications'] loop
  item:=case when name='auditLogs' then auds else notices end;
  for log in select x from jsonb_array_elements(item) x loop
   -- New generated notification identities also require assertWriter prelock. Since
   -- publication is already held these MUST be try locks, never reverse waits.
   if name<>'auditLogs' and not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),hashtext(jsonb_build_array(name,log->>'id')::text)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
   operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection',name,'entityId',log->>'id','value',log));
  end loop;
  select coalesce(jsonb_agg(x->'id' order by n),'[]'::jsonb) into ids from jsonb_array_elements(item) with ordinality a(x,n);
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb) into ids from jsonb_array_elements(ids||coalesce(orders->name,'[]'::jsonb)) with ordinality a(x,n) where n<=case when name='auditLogs' then 500 else 1000 end;
  for removed_id in select x from jsonb_array_elements_text(coalesce(orders->name,'[]'::jsonb)) x where not ids ? x loop
   if name<>'auditLogs' and not pg_try_advisory_xact_lock(hashtext('record-entity-v1:'||p_workspace_key),hashtext(jsonb_build_array(name,removed_id)::text)) then raise exception 'record-writer-restart-transaction' using errcode='40001'; end if;
   operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection',name,'entityId',removed_id,'value',null));
  end loop;
  if item<>'[]'::jsonb then nextorders:=jsonb_set(nextorders,array[name],ids,true); end if;
 end loop;
 return public.ship_dynamics_record_commit_validated_v1(p_workspace_key,operations,root,nextorders,actorname,p_operation_id,signature);
end $$;
revoke all on function public.ship_dynamics_task_member_key_v1(text,text),public.ship_dynamics_task_lock_family_v1(text),public.ship_dynamics_member_track_v1(),public.ship_dynamics_member_source_v1(text,text),public.read_ship_dynamics_task_member_v1(text,text,text,text),public.get_ship_dynamics_task_member_receipt_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb),public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
-- END COMPONENT: supabase/development/20260909_task_member_protocol.sql

-- BEGIN COMPONENT: supabase/development/20260911_vessel_manager_handover.sql
-- Development only: current-state validated reopen exception, no new identity policy.
create or replace function public.ship_dynamics_meeting_responsibility_scope_v1(p_workspace text,p_meeting jsonb,p_vessel text)
returns boolean language sql stable set search_path=public as $scope$
 select case when jsonb_array_length(coalesce(p_meeting->'vessels','[]'::jsonb))>0 then p_meeting->'vessels' ? p_vessel
 else exists(select 1 from public.ship_dynamics_records v where v.workspace_key=p_workspace and v.collection='vessels' and v.entity_id=p_vessel and v.value->'isActive'='true'::jsonb
  and (p_meeting->>'vesselScopeMode'='all' or (p_meeting->>'vesselScopeMode'='types' and p_meeting->'vesselTypeScopes' ? (v.value->>'shipType')))) end;
$scope$;
revoke all on function public.ship_dynamics_meeting_responsibility_scope_v1(text,jsonb,text) from public;

create or replace function public.ship_dynamics_reopened_responsibilities_v1(p_workspace text,p_collection text,p_before jsonb,p_after jsonb)
returns jsonb language plpgsql set search_path=public as $reopen$
declare entry jsonb; result jsonb='[]'::jsonb; vid text; reopened boolean; team jsonb; oldclosed boolean; newclosed boolean;
begin
 if jsonb_typeof(p_before->'vesselResponsibilities') is distinct from 'array' then return p_before->'vesselResponsibilities'; end if;
 for entry in select x from jsonb_array_elements(p_before->'vesselResponsibilities') x loop
  vid:=entry->>'vesselId';reopened:=false;
  if p_collection='tasks' and (coalesce(nullif(p_before->'vesselIds','[]'::jsonb),jsonb_build_array(p_before->>'vesselId')) ? vid)
    and (coalesce(nullif(p_after->'vesselIds','[]'::jsonb),jsonb_build_array(p_after->>'vesselId')) ? vid) then
   oldclosed:=coalesce(p_before->'isClosed'='true'::jsonb,false);newclosed:=coalesce(p_after->'isClosed'='true'::jsonb,false);
   if coalesce(p_before->>'sourceMeetingId','')<>'' and p_before->'distributeToVessels'='true'::jsonb and jsonb_array_length(coalesce(p_before->'vesselIds','[]'::jsonb))>1 then
    oldclosed:=coalesce((select x->'isClosed'='true'::jsonb from jsonb_array_elements(coalesce(p_before->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=vid),false);
   end if;
   if coalesce(p_after->>'sourceMeetingId','')<>'' and p_after->'distributeToVessels'='true'::jsonb and jsonb_array_length(coalesce(p_after->'vesselIds','[]'::jsonb))>1 then
    newclosed:=coalesce((select x->'isClosed'='true'::jsonb from jsonb_array_elements(coalesce(p_after->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=vid),false);
   end if;
   reopened:=oldclosed and not newclosed;
  elsif p_collection='internalControlCases' then
   reopened:=p_before->>'vesselId'=vid and p_after->>'vesselId'=vid and p_before->'isClosed'='true'::jsonb and p_after->'isClosed'='false'::jsonb;
  elsif p_collection='meetings' then
   reopened:=p_before->>'status'='已完成' and p_after->>'status'<>'已完成' and public.ship_dynamics_meeting_responsibility_scope_v1(p_workspace,p_before,vid) and public.ship_dynamics_meeting_responsibility_scope_v1(p_workspace,p_after,vid);
  end if;
  if coalesce(reopened,false) then
   select coalesce(jsonb_agg(u.entity_id order by a.n),'[]'::jsonb) into team
   from ship_dynamics_record_collections c cross join lateral jsonb_array_elements_text(c.ids) with ordinality a(id,n)
   join ship_dynamics_records u on u.workspace_key=c.workspace_key and u.collection='users' and u.entity_id=a.id
   join ship_dynamics_records v on v.workspace_key=c.workspace_key and v.collection='vessels' and v.entity_id=vid
   where c.workspace_key=p_workspace and c.collection='users' and u.value->'isActive'='true'::jsonb and u.value->>'role' in ('admin','operator') and v.value->'isActive'='true'::jsonb
    and (v.value->'assignedUserIds' ? u.entity_id or u.value->'managedVesselIds' ? vid);
   entry:=entry||jsonb_build_object('managerUserIds',team);
  end if;
  result:=result||jsonb_build_array(entry);
 end loop;
 return result;
end $reopen$;
revoke all on function public.ship_dynamics_reopened_responsibilities_v1(text,text,jsonb,jsonb) from public;

-- Development only. Opt-in handover read-set CAS; legacy envelopes unchanged.
-- The exact guard remains in original_signature and receipt lookup.
do $handover$
declare definition text;
begin
 select pg_get_functiondef('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure) into definition;
 if position('-- handover-read-revision-v1' in definition)>0 then
  if position('ship_dynamics_reopened_responsibilities_v1' in definition)=0 then
   definition:=replace(definition,$old$and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}'))$old$,$new$and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}')
      and (op#>'{value,vesselResponsibilities}') is distinct from public.ship_dynamics_reopened_responsibilities_v1(p_workspace_key,op->>'collection',op->'expected',op->'value'))$new$);
   if position('ship_dynamics_reopened_responsibilities_v1' in definition)=0 then raise exception 'incompatible reopen upgrade boundary'; end if;
   execute definition;
  end if;
  return;
 end if;
 if position('  -- Only users/vessels/settings' in definition)=0 or position('is distinct from p_authorization_guard)' in definition)=0 then raise exception 'handover incompatible record publication boundary'; end if;
 definition:=replace(definition,'  -- Only users/vessels/settings', $guard$
  -- handover-read-revision-v1: locked publication, after exact receipt replay.
  if p_authorization_guard ? 'handoverReadRevision' then
    if jsonb_typeof(p_authorization_guard->'handoverReadRevision') is distinct from 'number'
      or p_authorization_guard->>'handoverReadRevision' !~ '^[0-9]+$'
      or (p_authorization_guard->>'handoverReadRevision')::numeric <> workspace.revision then
      return jsonb_build_object('ok',false,'code','block-conflict','conflict_key','handover-read-revision');
    end if;
  end if;
  -- Only users/vessels/settings$guard$);
 definition:=replace(definition,'is distinct from p_authorization_guard)','is distinct from (p_authorization_guard - ''handoverReadRevision''))');
 definition:=replace(definition,'  -- Prevalidate the whole operation graph', $authority$
  -- New responsibility is command-owned. An old client or ordinary edit may
  -- retain it, but cannot erase or independently retarget it.
  if exists(select 1 from jsonb_array_elements(p_operations) op
    where op->>'kind'='entity' and op->>'collection' in ('tasks','internalControlCases','meetings')
      and op->'expected' <> 'null'::jsonb and op->'value' <> 'null'::jsonb
      and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}')
      and (op#>'{value,vesselResponsibilities}') is distinct from public.ship_dynamics_reopened_responsibilities_v1(p_workspace_key,op->>'collection',op->'expected',op->'value')) then
    if not coalesce(p_authorization_guard ? 'handoverReadRevision',false)
      or not public.ship_dynamics_patch_touches_authorization_domain(p_operations) then
      return jsonb_build_object('ok',false,'code','invalid-responsibility-change');
    end if;
  end if;
  -- Prevalidate the whole operation graph$authority$);
 execute definition;
end $handover$;

-- Install after the existing member protocol when present. Its command/CAS,
-- actor validation and linked transaction remain unchanged.
do $member_reopen$
declare definition text; anchor text := ' operations:=jsonb_build_array(jsonb_build_object(''kind'',''entity'',''collection'',''tasks'',''entityId'',p_task_id,''value'',task));';
begin
 if to_regprocedure('public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb)') is null then return; end if;
 select pg_get_functiondef('public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb)'::regprocedure) into definition;
 if position('-- member-reopen-team-v1' in definition)>0 then return; end if;
 if position(anchor in definition)=0 then raise exception 'incompatible member reopen boundary'; end if;
 definition:=replace(definition,anchor,$change$
 -- member-reopen-team-v1: only selected closed -> open member, under publication lock.
 if old->'isClosed'='true'::jsonb and updated->'isClosed'='false'::jsonb and task ? 'vesselResponsibilities' then
  select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into item
  from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.entity_id=p_task_id;
  task:=task||jsonb_build_object('vesselResponsibilities',public.ship_dynamics_reopened_responsibilities_v1(p_workspace_key,'tasks',item,task));
 end if;
$change$||anchor);
 execute definition;
end $member_reopen$;
-- END COMPONENT: supabase/development/20260911_vessel_manager_handover.sql

-- BEGIN COMPONENT: supabase/development/20260908_appdata_record_scoped_read.sql
-- Development-only opt-in. No production migration manifest or ACL changes.
-- Complete ordered summaries plus explicitly requested linked record bodies.
create or replace function public.ship_dynamics_record_summary_v1(p_body jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare result jsonb:=p_body; logs jsonb; progress jsonb;
begin
  if jsonb_typeof(p_body->'statusLogs')='array' then
    select coalesce(jsonb_agg(x.value order by x.n),'[]') into logs from (select value,n from jsonb_array_elements(p_body->'statusLogs') with ordinality x(value,n) where jsonb_typeof(value)='object' and jsonb_typeof(value->'id')='string' and value->>'id'<>'' and jsonb_typeof(value->'text')='string' and value->>'text'<>'' order by n limit 2) x;
    result:=jsonb_set(result,'{statusLogs}',logs);
  end if;
  if jsonb_typeof(p_body->'vesselProgress')='array' then
    select coalesce(jsonb_agg(public.ship_dynamics_record_summary_v1(x.value) order by x.n),'[]') into progress from jsonb_array_elements(p_body->'vesselProgress') with ordinality x(value,n);
    result:=jsonb_set(result,'{vesselProgress}',progress);
  end if;
  result:=result-'__recordSnapshotAvailable'-'__recordMorningTimes';
  if jsonb_typeof(p_body->'snapshot')='object' and jsonb_typeof(p_body->'snapshot'->'vessels')='array' and jsonb_typeof(p_body->'snapshot'->'tasks')='array' and jsonb_typeof(p_body->'snapshot'->'meetings')='array' then
    result:=result || jsonb_build_object('__recordSnapshotAvailable',true,'__recordMorningTimes',jsonb_build_object('windowEndedAt',case when jsonb_typeof(p_body->'snapshot'->'windowEndedAt')='string' then p_body->'snapshot'->>'windowEndedAt' else '' end,'capturedAt',case when jsonb_typeof(p_body->'snapshot'->'capturedAt')='string' then p_body->'snapshot'->>'capturedAt' else '' end));
  end if;
  return result-'snapshot';
end; $$;

-- Retire the development three-argument overload; the default preserves callers.
drop function if exists public.read_ship_dynamics_record_scopes_v1(text,text,jsonb);
create or replace function public.read_ship_dynamics_record_scopes_v1(p_workspace_key text,p_scope text,p_versions jsonb,p_targets jsonb default '[]')
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare w public.ship_dynamics_record_workspaces%rowtype; result jsonb; targets jsonb;
begin
  if p_scope not in ('home','full','targets') or p_scope is null or jsonb_typeof(p_versions) is distinct from 'object' or jsonb_typeof(p_targets) is distinct from 'array' then raise exception 'invalid-record-read-scope'; end if;
  if exists(select 1 from jsonb_array_elements(p_targets) t where jsonb_typeof(t) is distinct from 'object' or t->>'collection' not in ('tasks','internalControlCases','meetings','agendaReports') or jsonb_typeof(t->'id') is distinct from 'string' or t->>'collection' is null) then raise exception 'invalid-record-read-target'; end if;
  select * into w from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key;
  if not found then return jsonb_build_object('protocol','ship-dynamics-record-scopes-v1','workspace_key',p_workspace_key,'scope',p_scope,'targets',p_targets,'status','missing'); end if;
  -- Use both directions of the existing task/case and meeting/task relationships.
  -- UNION (not UNION ALL) reaches a finite closure, including sibling decisions.
  with recursive edges as (
    select 'tasks'::text a_collection,r.entity_id a_id,'internalControlCases'::text b_collection,r.value->>'internalControlCaseId' b_id from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.value->>'internalControlCaseId' is not null
    union select 'tasks',r.entity_id,'meetings',r.value->>'sourceMeetingId' from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.value->>'sourceMeetingId' is not null
    union select 'internalControlCases',r.entity_id,'tasks',r.value->>'linkedTaskId' from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='internalControlCases' and r.value->>'linkedTaskId' is not null
  ), graph(collection,id) as (
    select t->>'collection',t->>'id' from jsonb_array_elements(p_targets) t
    union
    select case when e.a_collection=g.collection and e.a_id=g.id then e.b_collection else e.a_collection end,case when e.a_collection=g.collection and e.a_id=g.id then e.b_id else e.a_id end
    from graph g join edges e on (e.a_collection=g.collection and e.a_id=g.id) or (e.b_collection=g.collection and e.b_id=g.id)
  ) select coalesce(jsonb_agg(jsonb_build_array(collection,id)),'[]') into targets from graph;
  with bodies as (
    select r.*, (p_scope='full' or r.collection not in ('tasks','internalControlCases','meetings','agendaReports') or (p_scope='targets' and targets @> jsonb_build_array(jsonb_build_array(r.collection,r.entity_id)))) detail
    from public.ship_dynamics_records r where r.workspace_key=p_workspace_key
  )
  select jsonb_build_object('protocol','ship-dynamics-record-scopes-v1','workspace_key',p_workspace_key,'scope',p_scope,'targets',p_targets,'status','scopes','revision',w.revision,'root',w.root,
    'collections',coalesce(jsonb_object_agg(c.collection,jsonb_build_object('ids',c.ids,'rows',(
      select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'version',r.revision,'detail',r.detail,'value',case when not r.detail then public.ship_dynamics_record_summary_v1(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision)) else public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) end)),'[]')
      from bodies r where r.collection=c.collection and (p_versions->c.collection->r.entity_id) is distinct from jsonb_build_object('version',r.revision,'detail',r.detail)
    ))),'{}')) into result from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key;
  return result;
end; $$;
revoke all on function public.ship_dynamics_record_summary_v1(jsonb), public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb) from public,anon,authenticated;
-- END COMPONENT: supabase/development/20260908_appdata_record_scoped_read.sql

-- BEGIN COMPONENT: supabase/development/20260906_itinerary_record_read.sql
-- DEVELOPMENT ONLY: explicit records-v1 identity, existing formal document authority.
-- No replacement/alter of legacy RPCs, no writes, no browser grants or auto-detection.


create or replace function public.sd_itinerary_record_actor_v1(
  p_workspace_key text, p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_candidate_uuid uuid;
  v_actor_uuid uuid;
  v_legacy_user_id text;
  v_department text;
  v_display_name text;
  v_username_label text;
  v_uuid_identity boolean := false;
  v_user jsonb;
  v_role text;
begin
  if v_workspace is null or btrim(coalesce(p_actor_user_id, '')) = '' then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;
  begin
    v_candidate_uuid := p_actor_user_id::uuid;
  exception when invalid_text_representation then
    v_candidate_uuid := null;
  end;

  -- Preserve the existing UUID identity/metadata mapping, NOT membership authority.
  if v_candidate_uuid is not null then
    select membership.user_id, membership.legacy_user_id, membership.department,
           profile.display_name, profile.username_label
    into v_actor_uuid, v_legacy_user_id, v_department, v_display_name, v_username_label
    from public.sd_memberships membership
    join public.sd_profiles profile on profile.id = membership.user_id
    where membership.workspace_id = v_workspace
      and membership.user_id = v_candidate_uuid and membership.is_active
    limit 1;
    v_uuid_identity := found;
  end if;

  select record.value into v_user
  from public.ship_dynamics_records record
  where record.workspace_key = p_workspace_key and record.collection = 'users'
    and record.entity_id = case when v_uuid_identity then coalesce(v_legacy_user_id, p_actor_user_id) else p_actor_user_id end;
  v_role := lower(btrim(coalesce(v_user ->> 'role', '')));
  if v_user is null or (v_user -> 'isActive') is distinct from 'true'::jsonb
     or v_role not in ('owner', 'admin', 'operator', 'vessel') then
    raise exception using errcode = 'P0001', message = 'not-authorized';
  end if;

  if not v_uuid_identity then
    v_legacy_user_id := p_actor_user_id;
    select membership.user_id into v_actor_uuid
    from public.sd_memberships membership
    where membership.workspace_id = v_workspace and membership.legacy_user_id = p_actor_user_id
    order by membership.is_active desc, membership.user_id limit 1;
    v_department := v_user ->> 'department';
    v_display_name := v_user ->> 'name';
    v_username_label := v_user ->> 'username';
  end if;
  return jsonb_build_object(
    'workspaceId', v_workspace, 'legacyUserId', v_legacy_user_id,
    'actorKey', coalesce(v_actor_uuid::text, 'main:' || p_actor_user_id), 'actorUuid', v_actor_uuid,
    'department', coalesce(v_department, ''), 'displayName', coalesce(v_display_name, ''),
    'usernameLabel', coalesce(v_username_label, ''), 'role', v_role
  );
end;
$$;

create or replace function public.sd_itinerary_record_load_many_v1(
  p_workspace_key text, p_vessel_ids text[], p_actor_user_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace uuid := (v_actor ->> 'workspaceId')::uuid;
  v_result jsonb;
begin
  -- Same four-role read scope and shape as main_load_many. sd_* is still the
  -- formal vessel metadata/document/alternatives authority, never AppData row JSON.
  select coalesce(jsonb_agg(jsonb_build_object(
    'vesselId', vessel.id, 'vesselName', vessel.name,
    'document', public.sd_itinerary_document_for_vessel(v_workspace, p_workspace_key, vessel.id)
  ) order by vessel.name), '[]'::jsonb) into v_result
  from public.sd_vessels vessel
  where vessel.workspace_id = v_workspace and vessel.is_active
    and vessel.id = any(coalesce(p_vessel_ids, '{}'::text[]));
  return v_result;
end;
$$;

revoke all on function public.sd_itinerary_record_actor_v1(text,text) from public, anon, authenticated;
revoke all on function public.sd_itinerary_record_load_many_v1(text,text[],text) from public, anon, authenticated;
-- END COMPONENT: supabase/development/20260906_itinerary_record_read.sql

-- BEGIN COMPONENT: supabase/development/20260906_itinerary_record_write.sql
-- DEVELOPMENT ONLY. Requires record_read and the existing alternative-plans migration.
-- Same sd_* document/lease/operation/history authority, current record actor first.
-- Additive private wrappers only: no legacy override, AppData writes, GUC or browser grants.


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
-- END COMPONENT: supabase/development/20260906_itinerary_record_write.sql

-- BEGIN COMPONENT: supabase/development/20260906_itinerary_record_reports.sql
-- DEVELOPMENT ONLY. Explicit records actor; same report/history/operation authority.
-- Existing report IDs, receipt payloads and formal snapshot builder remain unchanged.
-- Mounted main migration makes both sd_vessels.id and document.vessel_id text.



create or replace function public.sd_itinerary_record_report_save_manual_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid;
  v_actor_workspace_id uuid;
  v_actor_role text;
  operation_row public.sd_itinerary_daily_report_operations%rowtype;
  request_payload jsonb;
  result_payload jsonb;
  report_row public.sd_itinerary_daily_reports%rowtype;
  report_snapshot jsonb;
  generated_at timestamptz;
  business_date date;
begin
  if p_operation_id is null or length(btrim(coalesce(p_actor_user_id, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select workspace.id into v_workspace_id
  from public.sd_workspaces workspace
  where workspace.id = (v_actor ->> 'workspaceId')::uuid;
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));

  request_payload := jsonb_build_object('snapshotSource', 'authoritative-formal-main-v1');

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if found then
    if operation_row.command_type <> 'save_manual_itinerary_report'
      or operation_row.actor_user_id is distinct from p_actor_user_id
      or operation_row.request_payload is distinct from request_payload then
      return jsonb_build_object('ok', false, 'error', 'OPERATION_ID_REUSED');
    end if;
    if operation_row.status in ('COMMITTED', 'REJECTED') then
      if operation_row.result is null then
        return jsonb_build_object('ok', false, 'error', 'INVALID_OPERATION_RECEIPT');
      end if;
      if operation_row.status = 'COMMITTED' then
        return operation_row.result || jsonb_build_object('created', false);
      end if;
      return operation_row.result;
    end if;
  end if;

  v_actor_workspace_id := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role := lower(btrim(coalesce(v_actor ->> 'role', '')));
  if v_actor_workspace_id is null or v_actor_workspace_id is distinct from v_workspace_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'OWNER_OR_ADMIN_REQUIRED');
  end if;

  if operation_row.operation_id is null then
    insert into public.sd_itinerary_daily_report_operations(
      workspace_id, operation_id, actor_user_id, command_type, request_payload, status
    ) values (
      v_workspace_id, p_operation_id, p_actor_user_id,
      'save_manual_itinerary_report', request_payload, 'STARTED'
    );
  end if;

  generated_at := clock_timestamp();
  business_date := (generated_at at time zone 'Asia/Taipei')::date;
  report_snapshot := public.sd_build_daily_itinerary_report_snapshot(
    v_workspace_id,
    business_date,
    generated_at
  );

  insert into public.sd_itinerary_daily_reports(
    workspace_id, business_date, timezone, generated_at, generated_by,
    generated_by_actor_id, operation_id,
    vessel_count, row_count, source_max_revision, snapshot
  ) values (
    v_workspace_id,
    business_date,
    'Asia/Taipei',
    generated_at,
    'manual',
    p_actor_user_id,
    p_operation_id,
    (report_snapshot ->> 'vesselCount')::integer,
    (report_snapshot ->> 'rowCount')::integer,
    (report_snapshot ->> 'sourceMaxRevision')::bigint,
    report_snapshot
  )
  returning * into report_row;

  result_payload := jsonb_build_object(
    'ok', true,
    'created', true,
    'operationId', p_operation_id,
    'report', jsonb_build_object(
      'reportId', report_row.report_id::text,
      'businessDate', report_row.business_date::text,
      'timezone', report_row.timezone,
      'generatedAt', report_row.generated_at,
      'generatedBy', report_row.generated_by,
      'generatedByActorId', report_row.generated_by_actor_id,
      'vesselCount', report_row.vessel_count,
      'rowCount', report_row.row_count,
      'sourceMaxRevision', report_row.source_max_revision,
      'logicalBytes', pg_column_size(report_row.snapshot)
    )
  );

  update public.sd_itinerary_daily_report_operations operation
  set status = 'COMMITTED',
      result = result_payload,
      completed_at = clock_timestamp()
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id;

  return result_payload;
end;
$$;

revoke all on function public.sd_itinerary_record_report_save_manual_v1(text,text,uuid) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_load_v1(
  p_workspace_key text,
  p_report_id bigint,
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
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  report_row public.sd_itinerary_daily_reports%rowtype;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_report_id is null or p_report_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select * into report_row
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.report_id = p_report_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'REPORT_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object(
      'reportId', report_row.report_id::text,
      'businessDate', report_row.business_date::text,
      'timezone', report_row.timezone,
      'generatedAt', report_row.generated_at,
      'generatedBy', report_row.generated_by,
      'generatedByActorId', report_row.generated_by_actor_id,
      'vesselCount', report_row.vessel_count,
      'rowCount', report_row.row_count,
      'sourceMaxRevision', report_row.source_max_revision,
      'logicalBytes', pg_column_size(report_row.snapshot),
      'snapshot', report_row.snapshot
    )
  );
end;
$$;

revoke all on function public.sd_itinerary_record_report_load_v1(text,bigint,text) from public, anon, authenticated;


create or replace function public.sd_itinerary_record_report_list_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_page integer default 1,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  v_page_size integer := least(30, greatest(1, coalesce(p_page_size, 30)));
  v_date_total bigint := 0;
  v_report_total bigint := 0;
  v_page_count integer := 1;
  v_page integer := greatest(1, coalesce(p_page, 1));
  reports jsonb := '[]'::jsonb;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select count(distinct report.business_date), count(*)
  into v_date_total, v_report_total
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id;
  v_page_count := greatest(1, ceil(v_date_total::numeric / v_page_size)::integer);
  v_page := least(v_page, v_page_count);

  with page_dates as (
    select distinct candidate.business_date
    from public.sd_itinerary_daily_reports candidate
    where candidate.workspace_id = v_workspace_id
    order by candidate.business_date desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reportId', report.report_id::text,
    'businessDate', report.business_date::text,
    'timezone', report.timezone,
    'generatedAt', report.generated_at,
    'generatedBy', report.generated_by,
    'generatedByActorId', report.generated_by_actor_id,
    'vesselCount', report.vessel_count,
    'rowCount', report.row_count,
    'sourceMaxRevision', report.source_max_revision,
    'logicalBytes', pg_column_size(report.snapshot)
  ) order by report.business_date desc, report.generated_at desc, report.report_id desc), '[]'::jsonb)
  into reports
  from public.sd_itinerary_daily_reports report
  join page_dates selected on selected.business_date = report.business_date
  where report.workspace_id = v_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'timezone', 'Asia/Taipei',
    'generatedAt', clock_timestamp(),
    'page', v_page,
    'pageSize', v_page_size,
    'pageCount', v_page_count,
    'total', v_date_total,
    'dateTotal', v_date_total,
    'reportTotal', v_report_total,
    'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id),
    'reports', reports
  );
end;
$$;

revoke all on function public.sd_itinerary_record_report_list_v1(text,text,integer,integer) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_locate_v1(
  p_workspace_key text,
  p_business_date date,
  p_actor_user_id text,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role text := lower(btrim(coalesce(v_actor ->> 'role', '')));
  v_page_size integer := least(30, greatest(1, coalesce(p_page_size, 30)));
  v_preceding bigint := 0;
begin
  if v_workspace_id is null or v_actor_role not in ('owner', 'admin', 'operator', 'vessel') then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if p_business_date is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;
  if not exists (
    select 1 from public.sd_itinerary_daily_reports report
    where report.workspace_id = v_workspace_id
      and report.business_date = p_business_date
  ) then
    return jsonb_build_object(
      'ok', true,
      'found', false,
      'businessDate', p_business_date::text,
      'pageSize', v_page_size,
      'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id)
    );
  end if;

  select count(distinct report.business_date) into v_preceding
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.business_date > p_business_date;

  return jsonb_build_object(
    'ok', true,
    'found', true,
    'businessDate', p_business_date::text,
    'page', floor(v_preceding::numeric / v_page_size)::integer + 1,
    'pageSize', v_page_size,
    'setToken', public.sd_itinerary_daily_report_set_token(v_workspace_id)
  );
end;
$$;

revoke all on function public.sd_itinerary_record_report_locate_v1(text,date,text,integer) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_delete_ids_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_set_token text,
  p_delete_report_ids jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid;
  v_actor_workspace_id uuid;
  v_actor_role text;
  operation_row public.sd_itinerary_daily_report_operations%rowtype;
  normalized_delete jsonb := '[]'::jsonb;
  current_set_token text := '';
  remaining_set_token text := '';
  request_payload jsonb;
  response jsonb;
  delete_count integer := 0;
  delete_distinct_count integer := 0;
  current_count integer := 0;
  deleted_count integer := 0;
  deleted_bytes bigint := 0;
begin
  if p_operation_id is null
    or p_expected_set_token is null
    or p_expected_set_token !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(p_delete_report_ids) is distinct from 'array'
    or jsonb_array_length(p_delete_report_ids) < 1
    or exists (
      select 1
      from jsonb_array_elements(p_delete_report_ids) value
      where jsonb_typeof(value) <> 'string'
         or not public.sd_itinerary_daily_report_id_valid(value #>> '{}')
    ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select workspace.id into v_workspace_id
  from public.sd_workspaces workspace
  where workspace.id = (v_actor ->> 'workspaceId')::uuid;
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(report_id::text) order by report_id), '[]'::jsonb),
    count(*)::integer,
    count(distinct report_id)::integer
  into normalized_delete, delete_count, delete_distinct_count
  from (
    select (value #>> '{}')::bigint as report_id
    from jsonb_array_elements(p_delete_report_ids) value
  ) normalized;

  if delete_count <> delete_distinct_count or delete_count > 100 then
    return jsonb_build_object(
      'ok', false,
      'error', case when delete_count > 100 then 'BATCH_LIMIT_EXCEEDED' else 'INVALID_PAYLOAD' end
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));

  request_payload := jsonb_build_object(
    'expectedSetToken', p_expected_set_token,
    'deleteReportIds', normalized_delete
  );

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if found then
    if operation_row.actor_user_id <> p_actor_user_id
      or operation_row.command_type <> 'delete_daily_itinerary_report_records'
      or operation_row.request_payload is distinct from request_payload then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_MISMATCH');
    end if;
    if operation_row.status in ('COMMITTED', 'REJECTED') then
      return operation_row.result;
    end if;
  end if;

  v_actor_workspace_id := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role := lower(btrim(coalesce(v_actor ->> 'role', '')));
  if v_actor_workspace_id is null or v_actor_workspace_id is distinct from v_workspace_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;

  if operation_row.operation_id is null then
    insert into public.sd_itinerary_daily_report_operations(
      workspace_id, operation_id, actor_user_id, command_type, request_payload, status
    ) values (
      v_workspace_id, p_operation_id, p_actor_user_id,
      'delete_daily_itinerary_report_records', request_payload, 'STARTED'
    );
  end if;

  select count(*)::integer into current_count
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id;
  current_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  if current_set_token is distinct from p_expected_set_token then
    response := jsonb_build_object(
      'ok', false,
      'error', 'REPORT_SET_CHANGED',
      'currentReportCount', current_count,
      'currentSetToken', current_set_token
    );
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(normalized_delete) selected(report_id_text)
    where not exists (
      select 1 from public.sd_itinerary_daily_reports report
      where report.workspace_id = v_workspace_id
        and report.report_id = selected.report_id_text::bigint
    )
  ) then
    response := jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  select count(*)::integer, coalesce(sum(pg_column_size(report.snapshot)), 0)::bigint
  into deleted_count, deleted_bytes
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.report_id in (
      select selected.report_id_text::bigint
      from jsonb_array_elements_text(normalized_delete) selected(report_id_text)
    );

  if deleted_count <> delete_count then
    response := jsonb_build_object('ok', false, 'error', 'REPORT_SET_CHANGED');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  delete from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.report_id in (
      select selected.report_id_text::bigint
      from jsonb_array_elements_text(normalized_delete) selected(report_id_text)
    );
  remaining_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  response := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'deletedCount', deleted_count,
    'deletedBytes', deleted_bytes,
    'deletedReportIds', normalized_delete,
    'remainingReportCount', current_count - deleted_count,
    'remainingSetToken', remaining_set_token
  );

  update public.sd_itinerary_daily_report_operations operation
  set status = 'COMMITTED', result = response, completed_at = clock_timestamp()
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id;

  return response;
end;
$$;

revoke all on function public.sd_itinerary_record_report_delete_ids_v1(text,text,uuid,text,jsonb) from public, anon, authenticated;

create or replace function public.sd_itinerary_record_report_delete_dates_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_set_token text,
  p_delete_dates jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor jsonb := public.sd_itinerary_record_actor_v1(p_workspace_key, p_actor_user_id);
  v_workspace_id uuid;
  v_actor_workspace_id uuid;
  v_actor_role text;
  operation_row public.sd_itinerary_daily_report_operations%rowtype;
  normalized_delete jsonb := '[]'::jsonb;
  current_set_token text := '';
  remaining_set_token text := '';
  request_payload jsonb;
  response jsonb;
  delete_count integer := 0;
  delete_distinct_count integer := 0;
  current_count integer := 0;
  deleted_count integer := 0;
  deleted_bytes bigint := 0;
begin
  if p_operation_id is null
    or p_expected_set_token is null
    or p_expected_set_token !~ '^[0-9a-f]{32}$'
    or jsonb_typeof(p_delete_dates) is distinct from 'array'
    or jsonb_array_length(p_delete_dates) < 1
    or exists (
      select 1
      from jsonb_array_elements(p_delete_dates) value
      where jsonb_typeof(value) <> 'string'
         or not public.sd_itinerary_daily_date_valid(value #>> '{}')
    ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(date_value::text) order by date_value), '[]'::jsonb),
    count(*)::integer,
    count(distinct date_value)::integer
  into normalized_delete, delete_count, delete_distinct_count
  from (
    select (value #>> '{}')::date as date_value
    from jsonb_array_elements(p_delete_dates) value
  ) normalized;

  if delete_count <> delete_distinct_count or delete_count > 100 then
    return jsonb_build_object(
      'ok', false,
      'error', case when delete_count > 100 then 'BATCH_LIMIT_EXCEEDED' else 'INVALID_PAYLOAD' end
    );
  end if;

  select workspace.id into v_workspace_id
  from public.sd_workspaces workspace
  where workspace.id = (v_actor ->> 'workspaceId')::uuid
  limit 1;
  if v_workspace_id is null then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text || ':daily-itinerary-report', 0));
  request_payload := jsonb_build_object(
    'expectedSetToken', p_expected_set_token,
    'deleteDates', normalized_delete
  );

  select * into operation_row
  from public.sd_itinerary_daily_report_operations operation
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id
  for update;

  if operation_row.operation_id is not null then
    if operation_row.actor_user_id <> p_actor_user_id
      or operation_row.command_type <> 'delete_daily_itinerary_reports'
      or operation_row.request_payload is distinct from request_payload then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_MISMATCH');
    end if;
    if operation_row.status in ('COMMITTED', 'REJECTED') then
      return operation_row.result;
    end if;
  end if;

  v_actor_workspace_id := nullif(v_actor ->> 'workspaceId', '')::uuid;
  v_actor_role := lower(btrim(coalesce(v_actor ->> 'role', '')));
  if v_actor_workspace_id is null or v_actor_workspace_id is distinct from v_workspace_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  if v_actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;

  if operation_row.operation_id is null then
    insert into public.sd_itinerary_daily_report_operations(
      workspace_id, operation_id, actor_user_id, command_type, request_payload, status
    ) values (
      v_workspace_id, p_operation_id, p_actor_user_id,
      'delete_daily_itinerary_reports', request_payload, 'STARTED'
    );
  end if;

  select count(*)::integer
  into current_count
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled';
  current_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  if current_set_token is distinct from p_expected_set_token then
    response := jsonb_build_object(
      'ok', false,
      'error', 'REPORT_SET_CHANGED',
      'currentReportCount', current_count,
      'currentSetToken', current_set_token
    );
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(normalized_delete) selected(date_text)
    where not exists (
      select 1
      from public.sd_itinerary_daily_reports report
      where report.workspace_id = v_workspace_id
        and report.business_date = selected.date_text::date
        and report.generated_by = 'scheduled'
    )
  ) then
    response := jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  select count(*)::integer, coalesce(sum(pg_column_size(report.snapshot)), 0)::bigint
  into deleted_count, deleted_bytes
  from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled'
    and report.business_date in (
      select selected.date_text::date
      from jsonb_array_elements_text(normalized_delete) selected(date_text)
    );

  if deleted_count <> delete_count then
    response := jsonb_build_object('ok', false, 'error', 'REPORT_SET_CHANGED');
    update public.sd_itinerary_daily_report_operations operation
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation.workspace_id = v_workspace_id
      and operation.operation_id = p_operation_id;
    return response;
  end if;

  delete from public.sd_itinerary_daily_reports report
  where report.workspace_id = v_workspace_id
    and report.generated_by = 'scheduled'
    and report.business_date in (
      select selected.date_text::date
      from jsonb_array_elements_text(normalized_delete) selected(date_text)
    );
  remaining_set_token := public.sd_itinerary_daily_report_set_token(v_workspace_id);

  response := jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'deletedCount', deleted_count,
    'deletedBytes', deleted_bytes,
    'deletedDates', normalized_delete,
    'remainingReportCount', current_count - deleted_count,
    'remainingSetToken', remaining_set_token
  );

  update public.sd_itinerary_daily_report_operations operation
  set status = 'COMMITTED', result = response, completed_at = clock_timestamp()
  where operation.workspace_id = v_workspace_id
    and operation.operation_id = p_operation_id;
  return response;
end;
$$;

revoke all on function public.sd_itinerary_record_report_delete_dates_v1(text,text,uuid,text,jsonb) from public, anon, authenticated;
-- END COMPONENT: supabase/development/20260906_itinerary_record_reports.sql

-- BEGIN COMPONENT: supabase/development/20260906_appdata_record_data_management.sql
-- DEVELOPMENT ONLY. Not in the production manifest; no browser grants.
-- Same explicit selection/CAS/batch/exact-replay contract, separate record authority.
-- Logical version size sums root/order metadata and the bodies visible at that
-- revision using pg_column_size. Shared bodies count once PER logical version;
-- this is NOT exclusive/reclaimable disk usage. Only selected version roots are
-- removed. No shared body GC, read-base/delta retention, current or legacy writes.
-- Earlier versions have no stored actor metadata; report 未記錄, never a legacy actor.


create table if not exists public.ship_dynamics_record_prune_operations (
  operation_id uuid primary key,
  workspace_key text not null references public.ship_dynamics_record_workspaces(workspace_key),
  actor_user_id text not null,
  command_type text not null check (command_type='prune_revision_history'),
  request_payload jsonb not null,
  status text not null check (status in ('STARTED','COMMITTED','REJECTED')),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
alter table public.ship_dynamics_record_prune_operations enable row level security;
revoke all on public.ship_dynamics_record_prune_operations from public, anon, authenticated;

create or replace function public.ship_dynamics_record_version_sizes_v1(p_workspace_key text)
returns table(revision integer, saved_at timestamptz, logical_bytes bigint)
language sql stable security invoker set search_path = pg_catalog, public as $$
  select v.revision, v.updated_at,
    (pg_column_size(v.root)::bigint + pg_column_size(v.orders)
      + coalesce((select sum(pg_column_size(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,v.revision))::bigint) from public.ship_dynamics_records r
        where r.workspace_key=v.workspace_key and r.revision<=v.revision),0)
      + coalesce((select sum(pg_column_size(public.ship_dynamics_record_hydrate_v1(h.workspace_key,h.collection,h.entity_id,h.value,h.task_progress_meta,v.revision))::bigint) from public.ship_dynamics_record_history h
        where h.workspace_key=v.workspace_key and h.valid_from_revision<=v.revision
          and v.revision<h.valid_to_revision),0))::bigint
  from public.ship_dynamics_record_versions v where v.workspace_key=p_workspace_key
$$;

create or replace function public.get_ship_dynamics_record_storage_stats_v1(
  p_workspace_key text,
  p_actor_user_id text
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = pg_catalog, public
as $$
declare
  current_row public.ship_dynamics_record_workspaces%rowtype;
  current_payload jsonb;
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
  from public.ship_dynamics_record_workspaces
  where workspace_key = p_workspace_key;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'WORKSPACE_NOT_FOUND');
  end if;

  select r.value ->> 'role' into actor_role
  from public.ship_dynamics_records r
  where r.workspace_key=p_workspace_key and r.collection='users' and r.entity_id=p_actor_user_id
    and r.value -> 'isActive' = 'true'::jsonb;
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

  current_payload := public.read_ship_dynamics_records_v1(p_workspace_key) -> 'payload';
  current_state_bytes := pg_column_size(current_payload);
  select coalesce(sum(r.logical_bytes),0)::bigint, count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'revision',r.revision,'savedAt',r.saved_at,
      'savedBy',case when r.revision=current_row.revision then current_row.updated_by else '未記錄' end,
      'logicalBytes',r.logical_bytes,'current',r.revision=current_row.revision
    ) order by r.revision desc),'[]'::jsonb)
  into revision_history_bytes, revision_history_count, revision_rows
  from public.ship_dynamics_record_version_sizes_v1(p_workspace_key) r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', definition.collection_key,
    'label', definition.collection_label,
    'itemCount', case
      when jsonb_typeof(current_payload -> definition.collection_key) = 'array'
        then jsonb_array_length(current_payload -> definition.collection_key)
      when current_payload -> definition.collection_key is not null then 1
      else 0
    end,
    'logicalBytes', coalesce(pg_column_size(current_payload -> definition.collection_key), 0)::bigint
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
    select 'users', '人員帳號', 2, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'users') = 'array' then current_payload -> 'users' else '[]'::jsonb end)
    union all
    select 'vessels', '船舶資料', 3, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'vessels') = 'array' then current_payload -> 'vessels' else '[]'::jsonb end)
    union all
    select 'tasks', '待辦要事', 4, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'tasks') = 'array' then current_payload -> 'tasks' else '[]'::jsonb end)
    union all
    select 'internalControlCases', '內控異常', 5, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'internalControlCases') = 'array' then current_payload -> 'internalControlCases' else '[]'::jsonb end)
    union all
    select 'meetings', '臨會／專題', 6, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'meetings') = 'array' then current_payload -> 'meetings' else '[]'::jsonb end)
    union all
    select 'agendaReports', '報告歷史', 7, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'agendaReports') = 'array' then current_payload -> 'agendaReports' else '[]'::jsonb end)
    union all
    select 'taskDismissals', '個人移除狀態', 8, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'taskDismissals') = 'array' then current_payload -> 'taskDismissals' else '[]'::jsonb end)
    union all
    select 'auditLogs', '操作紀錄', 9, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'auditLogs') = 'array' then current_payload -> 'auditLogs' else '[]'::jsonb end)
    union all
    select 'notifications', '通知', 10, value from jsonb_array_elements(case when jsonb_typeof(current_payload -> 'notifications') = 'array' then current_payload -> 'notifications' else '[]'::jsonb end)
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


create or replace function public.prune_ship_dynamics_record_revision_history_v1(
  p_workspace_key text,
  p_actor_user_id text,
  p_operation_id uuid,
  p_expected_revisions jsonb,
  p_delete_revisions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_row public.ship_dynamics_record_workspaces%rowtype;
  actor_role text;
  operation_row public.ship_dynamics_record_prune_operations%rowtype;
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

  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);
  select * into current_row
  from public.ship_dynamics_record_workspaces
  where workspace_key = p_workspace_key
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'WORKSPACE_NOT_FOUND');
  end if;

  select r.value ->> 'role' into actor_role
  from public.ship_dynamics_records r
  where r.workspace_key=p_workspace_key and r.collection='users' and r.entity_id=p_actor_user_id
    and r.value -> 'isActive' = 'true'::jsonb;
  if actor_role is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED');
  end if;

  request_payload := jsonb_build_object(
    'expectedRevisions', normalized_expected,
    'deleteRevisions', normalized_delete
  );

  insert into public.ship_dynamics_record_prune_operations(
    operation_id, workspace_key, actor_user_id, command_type, request_payload, status
  ) values (
    p_operation_id, p_workspace_key, p_actor_user_id,
    'prune_revision_history', request_payload, 'STARTED'
  ) on conflict (operation_id) do nothing;

  select * into operation_row
  from public.ship_dynamics_record_prune_operations
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
  from public.ship_dynamics_record_versions r
  where r.workspace_key = p_workspace_key;

  if current_revisions is distinct from normalized_expected then
    response := jsonb_build_object(
      'ok', false,
      'error', 'REVISION_SET_CHANGED',
      'currentRevisionCount', current_count
    );
    update public.ship_dynamics_record_prune_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  if not (current_revisions @> jsonb_build_array(current_row.revision)) then
    response := jsonb_build_object('ok', false, 'error', 'CURRENT_REVISION_HISTORY_MISSING');
    update public.ship_dynamics_record_prune_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  if normalized_delete @> jsonb_build_array(current_row.revision) then
    response := jsonb_build_object('ok', false, 'error', 'CURRENT_REVISION_PROTECTED');
    update public.ship_dynamics_record_prune_operations
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
    update public.ship_dynamics_record_prune_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  select count(*)::integer, coalesce(sum(r.logical_bytes),0)::bigint
  into deleted_count, deleted_bytes
  from public.ship_dynamics_record_version_sizes_v1(p_workspace_key) r
  where r.revision in (select value::integer from jsonb_array_elements_text(normalized_delete));

  if deleted_count <> delete_count then
    response := jsonb_build_object('ok', false, 'error', 'REVISION_SET_CHANGED');
    update public.ship_dynamics_record_prune_operations
    set status = 'REJECTED', result = response, completed_at = clock_timestamp()
    where operation_id = p_operation_id;
    return response;
  end if;

  delete from public.ship_dynamics_record_versions r
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
  update public.ship_dynamics_record_prune_operations
  set status = 'COMMITTED', result = response, completed_at = clock_timestamp()
  where operation_id = p_operation_id;
  return response;
end;
$$;

revoke execute on function public.ship_dynamics_record_version_sizes_v1(text) from public, anon, authenticated;
revoke execute on function public.get_ship_dynamics_record_storage_stats_v1(text,text) from public, anon, authenticated;
revoke execute on function public.prune_ship_dynamics_record_revision_history_v1(text,text,uuid,jsonb,jsonb) from public, anon, authenticated;
-- END COMPONENT: supabase/development/20260906_appdata_record_data_management.sql

-- BEGIN COMPONENT: supabase/development/20260906_record_daily_morning_scheduler.sql
-- DEVELOPMENT ONLY. Explicit owner-side workspace/operation/clock input.
-- No cron registration, workspace auto-enrolment, legacy write, browser grants,
-- fabricated user session, or invocation of the browser patch authorization path.


create or replace function public.build_ship_dynamics_record_daily_morning_v1(
  p_workspace_key text,p_captured_at timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_workspace uuid := public.sd_itinerary_workspace_id(p_workspace_key);
  v_vessels jsonb; v_tasks jsonb; v_meetings jsonb; v_projections jsonb;
begin
  if v_workspace is null then raise exception 'formal-workspace-not-found'; end if;
  -- Schedule semantics, NOT the manual cutoff/window helper. Row contents are
  -- preserved from records, including literal IDs and source-owned metadata.
  select coalesce(jsonb_agg(r.value order by r.entity_id),'[]'::jsonb) into v_vessels
  from public.ship_dynamics_records r
  where r.workspace_key=p_workspace_key and r.collection='vessels'
    and r.value -> 'isActive' is distinct from 'false'::jsonb;

  select coalesce(jsonb_agg(t.value order by t.entity_id),'[]'::jsonb) into v_tasks
  from (select r.entity_id,public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) value
    from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks') t
  where true
    and t.value -> 'isInternalControl' is distinct from 'true'::jsonb
    and t.value -> 'isClosed' is distinct from 'true'::jsonb
    and exists (
      select 1 from jsonb_array_elements(v_vessels) v
      where (case when jsonb_array_length(coalesce(t.value -> 'vesselIds','[]'::jsonb))>0
        then t.value -> 'vesselIds' else jsonb_build_array(t.value -> 'vesselId') end) ? (v ->> 'id')
      and not exists (select 1 from jsonb_array_elements(coalesce(t.value -> 'vesselProgress','[]'::jsonb)) progress
        where progress ->> 'vesselId'=v ->> 'id' and progress -> 'isClosed'='true'::jsonb)
    )
    and (nullif(t.value ->> 'sourceMeetingId','') is null or exists (
      select 1 from public.ship_dynamics_records m
      where m.workspace_key=p_workspace_key and m.collection='meetings' and m.entity_id=t.value ->> 'sourceMeetingId'
        and m.value -> 'includeInMorning'='true'::jsonb and m.value -> 'isInternalControl' is distinct from 'true'::jsonb
    ));

  -- Legacy schedule includes an eligible meeting with ANY open linked task,
  -- even when that task has no active vessel. Do not silently adopt manual rules.
  select coalesce(jsonb_agg(m.value order by m.entity_id),'[]'::jsonb) into v_meetings
  from public.ship_dynamics_records m
  where m.workspace_key=p_workspace_key and m.collection='meetings'
    and m.value -> 'includeInMorning'='true'::jsonb and m.value -> 'isInternalControl' is distinct from 'true'::jsonb
    and exists (select 1 from public.ship_dynamics_records t
      where t.workspace_key=p_workspace_key and t.collection='tasks' and t.value ->> 'sourceMeetingId'=m.entity_id
        and t.value -> 'isInternalControl' is distinct from 'true'::jsonb and t.value -> 'isClosed' is distinct from 'true'::jsonb);

  -- Same final formal six-group projection as 20260903230000. Vessel membership
  -- comes from records; ONLY shared formal documents supply operational values.
  select coalesce(jsonb_object_agg(v.value ->> 'id',
    case when d.vessel_id is null or first_row.value is null then jsonb_build_object('source','legacy')
    else jsonb_build_object(
      'source','itinerary','revision',d.revision,'updatedAt',d.updated_at,
      'rowId',coalesce(first_row.value ->> 'rowId',''),
      'values',jsonb_build_object(
        'previousPortName',btrim(coalesce(first_row.value ->> 'previousPortName','')),
        'portDockName',btrim(coalesce(first_row.value ->> 'portDockName','')),
        'etaUtc',nullif(btrim(coalesce(first_row.value ->> 'etaUtc','')),''),
        'etaTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etaTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'etbUtc',nullif(btrim(coalesce(first_row.value ->> 'etbUtc','')),''),
        'etbTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etbTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'etdUtc',nullif(btrim(coalesce(first_row.value ->> 'etdUtc','')),''),
        'etdTimeZone',coalesce(nullif(btrim(coalesce(first_row.value ->> 'etdTimeZone','')),''),nullif(btrim(coalesce(first_row.value ->> 'portTimeZone','')),''),''),
        'cargoQuantityText',btrim(coalesce(first_row.value ->> 'cargoQuantityText',''))
      )
    ) end order by v.value ->> 'id'),'{}'::jsonb) into v_projections
  from jsonb_array_elements(v_vessels) v(value)
  left join public.sd_itinerary_documents d on d.workspace_id=v_workspace and d.vessel_id=v.value ->> 'id'
  left join lateral (
    select row_item.value from jsonb_array_elements(d.rows_payload) with ordinality row_item(value,ordinality)
    order by case when coalesce(row_item.value ->> 'sortOrder','') ~ '^[0-9]+$'
      then (row_item.value ->> 'sortOrder')::integer else row_item.ordinality::integer-1 end,row_item.ordinality limit 1
  ) first_row on d.vessel_id is not null;
  return jsonb_build_object('schemaVersion',2,'capturedAt',p_captured_at,'projectionCapturedAt',p_captured_at,
    'itineraryProjections',v_projections,'vessels',v_vessels,'tasks',v_tasks,'meetings',v_meetings);
end;
$$;

create or replace function public.run_ship_dynamics_record_daily_morning_v1(
  p_workspace_key text,p_operation_id text,p_captured_at timestamptz
)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
declare
  w public.ship_dynamics_record_workspaces%rowtype;
  ledger public.ship_dynamics_record_receipts%rowtype;
  signature jsonb := jsonb_build_array('record-daily-morning-scheduler-v1',p_workspace_key,p_captured_at);
  operation_key text := 'record-daily-morning-scheduler:' || p_operation_id;
  business_date date := (p_captured_at at time zone 'Asia/Taipei')::date;
  report_id text; existing jsonb; report jsonb; snapshot jsonb; owner_row jsonb;
  orders jsonb; remaining jsonb; audit_id text; audit jsonb; operations jsonb; result jsonb;
begin
  if nullif(p_workspace_key,'') is null or nullif(p_operation_id,'') is null or length(p_operation_id)>160
    or p_captured_at is null or not isfinite(p_captured_at) then raise exception 'invalid-scheduler-request'; end if;
  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);
  perform pg_advisory_xact_lock(hashtext('record-operation:' || p_workspace_key),hashtext(operation_key));
  select * into ledger from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=operation_key;
  if found then
    if ledger.signature is distinct from signature then raise exception 'operation-id-mismatch'; end if;
    return ledger.result || jsonb_build_object('replayed',true);
  end if;
  select * into w from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for update;
  if not found then raise exception 'record-workspace-not-found'; end if;
  if extract(isodow from business_date)>5 then return jsonb_build_object('ok',true,'status','not-business-day','count',0); end if;
  select r.value into owner_row from public.ship_dynamics_records r
  join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
  cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
  where r.workspace_key=p_workspace_key and r.collection='users' and ids.id=r.entity_id
    and r.value ->> 'role'='owner' and r.value -> 'isActive'='true'::jsonb order by ids.ordinal limit 1;
  -- Owner is attribution/eligibility metadata, never a forged browser actor/guard.
  if owner_row is null then return jsonb_build_object('ok',true,'status','no-active-owner','count',0); end if;
  report_id := 'daily-morning-' || business_date::text;
  select value into existing from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='agendaReports' and entity_id=report_id;
  if existing is not null and existing ->> 'kind' is distinct from 'daily-morning' then raise exception 'report-kind-conflict'; end if;
  snapshot := public.build_ship_dynamics_record_daily_morning_v1(p_workspace_key,p_captured_at);
  report := jsonb_build_object('id',report_id,'title',to_char(business_date,'YYYY/MM/DD') || ' 早會內容',
    'vesselIds',(select coalesce(jsonb_agg(v -> 'id'),'[]'::jsonb) from jsonb_array_elements(snapshot -> 'vessels') v),
    'createdBy',coalesce(existing ->> 'createdBy',owner_row ->> 'id'),'createdAt',coalesce(existing -> 'createdAt',to_jsonb(p_captured_at)),
    'taskCount',jsonb_array_length(snapshot -> 'tasks'),'kind','daily-morning','businessDate',business_date,
    'source',case when existing ->> 'source'='manual' then 'manual' else 'scheduled' end,'updatedAt',p_captured_at,'snapshot',snapshot);
  select coalesce(jsonb_object_agg(collection,ids),'{}'::jsonb) into orders from public.ship_dynamics_record_collections where workspace_key=p_workspace_key;
  select coalesce(jsonb_agg(id order by ordinal),'[]'::jsonb) into remaining
    from jsonb_array_elements(coalesce(orders -> 'agendaReports','[]'::jsonb)) with ordinality source(id,ordinal) where id<>to_jsonb(report_id);
  orders := jsonb_set(orders,'{agendaReports}',jsonb_build_array(report_id)||remaining,true);
  audit_id := gen_random_uuid()::text;
  audit := jsonb_build_object('id',audit_id,'actorId',owner_row ->> 'id','actorName',owner_row ->> 'name',
    'action','scheduled_daily_morning_report','actorRole','system','entityType','agenda','entityId',report_id,
    'detail',jsonb_build_object('businessDate',business_date,'revision',w.revision+1)::text,'at',p_captured_at,'source','scheduled');
  orders := jsonb_set(orders,'{auditLogs}',jsonb_build_array(audit_id)||coalesce(orders -> 'auditLogs','[]'::jsonb),true);
  operations := jsonb_build_array(
    jsonb_build_object('kind','entity','collection','agendaReports','entityId',report_id,'expected',existing,'value',report),
    jsonb_build_object('kind','entity','collection','auditLogs','entityId',audit_id,'expected',null,'value',audit));
  result := public.ship_dynamics_record_commit_validated_v1(p_workspace_key,operations,w.root,orders,
    'scheduled-daily-morning:' || (owner_row ->> 'id'),operation_key,signature);
  return result;
end;
$$;
revoke all on function public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz) from public,anon,authenticated;
revoke all on function public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz) from public,anon,authenticated;
-- END COMPONENT: supabase/development/20260906_record_daily_morning_scheduler.sql

-- BEGIN COMPONENT: supabase/normalized-legacy-cutover.sql
-- Service-role-only maintenance controls for the legacy shared-payload table.
-- The trigger is installed only when the legacy table exists so the additive
-- normalized manifest remains composable on an empty staging database. Every
-- freeze/import/restore operation separately verifies that the trigger exists.

create table if not exists public.sd_legacy_write_controls (
  workspace_key text primary key,
  writes_frozen boolean not null default false,
  expected_revision bigint,
  payload_sha256 text,
  restore_in_progress boolean not null default false,
  frozen_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint sd_legacy_control_hash check (
    payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint sd_legacy_control_frozen_complete check (
    not writes_frozen
    or (expected_revision is not null and expected_revision >= 0 and payload_sha256 is not null)
  )
);
alter table public.sd_legacy_write_controls enable row level security;
revoke all on table public.sd_legacy_write_controls from public, anon, authenticated, service_role;

-- Extend the installed original-App audit trigger without replacing its normal
-- stamping logic or changing its owner/ACL. The private flag is visible only
-- inside the verified service-role restore transaction for this workspace.
do $audit_restore$
declare
  v_definition text;
  v_anchor text := E'begin\n  if tg_op <> ''UPDATE''';
  v_guard text := $guard$begin
  -- sd_trusted_legacy_restore_v1
  if current_setting('role', true) = 'service_role' then
    if exists (
      select 1 from public.sd_legacy_write_controls c
      where c.workspace_key = new.workspace_key
        and c.writes_frozen and c.restore_in_progress
    ) then
      return new;
    end if;
  end if;
  -- end_sd_trusted_legacy_restore_v1
  if tg_op <> 'UPDATE'$guard$;
begin
  if to_regprocedure('public.stamp_ship_dynamics_audit_network_context()') is not null then
    select pg_get_functiondef('public.stamp_ship_dynamics_audit_network_context()'::regprocedure)
    into v_definition;
    if position('-- sd_trusted_legacy_restore_v1' in v_definition) = 0 then
      -- Match the installed newline representation; leave its normal body intact.
      v_guard := replace(v_guard, chr(13) || chr(10), chr(10));
      if position(v_anchor in v_definition) = 0
         and position(replace(v_anchor, chr(10), chr(13) || chr(10)) in v_definition) > 0 then
        v_anchor := replace(v_anchor, chr(10), chr(13) || chr(10));
        v_guard := replace(v_guard, chr(10), chr(13) || chr(10));
      end if;
      if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
        raise exception using errcode = 'P0001', message = 'legacy-audit-trigger-definition-unrecognized';
      end if;
      execute replace(v_definition, v_anchor, v_guard);
    end if;
  end if;
end;
$audit_restore$;

create or replace function public.sd_legacy_jsonb_sha256(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex')
$$;

create or replace function public.sd_guard_legacy_app_state_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_key text := case when tg_op = 'DELETE' then old.workspace_key else new.workspace_key end;
  v_restore boolean;
begin
  -- Serialize every legacy row mutation with freeze/backup/rollback control so
  -- a writer that entered its BEFORE trigger before freeze cannot commit after
  -- the authoritative snapshot was recorded.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workspace_key, 731921)
  );
  select c.restore_in_progress
  into v_restore
  from public.sd_legacy_write_controls c
  where c.workspace_key = v_workspace_key
    and c.writes_frozen;

  if found and not coalesce(v_restore, false) then
    raise exception using errcode = '55000', message = 'legacy-writes-frozen';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.ship_dynamics_app_state') is not null then
    execute 'drop trigger if exists ship_dynamics_maintenance_freeze_trigger on public.ship_dynamics_app_state';
    execute 'create trigger ship_dynamics_maintenance_freeze_trigger before insert or update or delete on public.ship_dynamics_app_state for each row execute function public.sd_guard_legacy_app_state_write()';
  end if;
end
$$;

create or replace function public.sd_assert_legacy_freeze_boundary(p_workspace_key text)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if to_regclass('public.ship_dynamics_app_state') is null then
    raise exception using errcode = '55000', message = 'legacy-source-table-missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ship_dynamics_app_state'::regclass
      and t.tgname = 'ship_dynamics_maintenance_freeze_trigger'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception using errcode = '55000', message = 'legacy-freeze-trigger-missing';
  end if;
  if not exists (
    select 1
    from public.sd_legacy_write_controls c
    where c.workspace_key = p_workspace_key
      and c.writes_frozen
      and not c.restore_in_progress
  ) then
    raise exception using errcode = '55000', message = 'legacy-writes-not-frozen';
  end if;
end;
$$;

drop function if exists public.freeze_ship_dynamics_legacy_writes(text, bigint, text);
create or replace function public.freeze_ship_dynamics_legacy_writes(
  p_workspace_key text,
  p_expected_revision bigint,
  p_expected_payload_sha256 text,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_revision bigint;
  v_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_workspace_key, '')) = ''
     or p_expected_revision is null or p_expected_revision < 0
     or coalesce(p_expected_payload_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid-freeze-identity';
  end if;
  if p_confirmation is distinct from
     'freeze:' || p_workspace_key || ':' || p_expected_revision::text || ':' ||
     p_expected_payload_sha256 then
    raise exception using errcode = '22023', message = 'confirmation-mismatch';
  end if;
  if to_regclass('public.ship_dynamics_app_state') is null then
    raise exception using errcode = '55000', message = 'legacy-source-table-missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ship_dynamics_app_state'::regclass
      and t.tgname = 'ship_dynamics_maintenance_freeze_trigger'
      and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception using errcode = '55000', message = 'legacy-freeze-trigger-missing';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );

  select s.revision, public.sd_legacy_jsonb_sha256(s.payload)
  into v_revision, v_hash
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-source-row-missing';
  end if;
  if v_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;
  if v_hash is distinct from p_expected_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-payload-hash-mismatch';
  end if;

  insert into public.sd_legacy_write_controls(
    workspace_key, writes_frozen, expected_revision, payload_sha256,
    restore_in_progress, frozen_at, updated_at
  ) values (
    p_workspace_key, true, p_expected_revision, v_hash,
    false, clock_timestamp(), clock_timestamp()
  )
  on conflict (workspace_key) do update
    set writes_frozen = true,
        expected_revision = excluded.expected_revision,
        payload_sha256 = excluded.payload_sha256,
        restore_in_progress = false,
        frozen_at = excluded.frozen_at,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'status', 'frozen',
    'workspaceKey', p_workspace_key,
    'revision', p_expected_revision,
    'payloadSha256', v_hash
  );
end;
$$;

drop function if exists public.export_ship_dynamics_legacy_backup(text, bigint);
create or replace function public.export_ship_dynamics_legacy_backup(
  p_workspace_key text,
  p_expected_revision bigint,
  p_expected_payload_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_payload_text text;
  v_hash text;
  v_control record;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  if to_regclass('public.ship_dynamics_app_state') is null then
    raise exception using errcode = '55000', message = 'legacy-source-table-missing';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );
  perform public.sd_assert_legacy_freeze_boundary(p_workspace_key);
  if p_expected_revision is null or p_expected_revision < 0
     or coalesce(p_expected_payload_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid-backup-identity';
  end if;
  select c.expected_revision, c.payload_sha256, c.frozen_at
  into v_control
  from public.sd_legacy_write_controls c
  where c.workspace_key = p_workspace_key
    and c.writes_frozen
    and not c.restore_in_progress
  for share;
  if not found
     or v_control.expected_revision is distinct from p_expected_revision
     or v_control.payload_sha256 is distinct from p_expected_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-freeze-snapshot-mismatch';
  end if;
  select s.workspace_key, s.revision, s.payload, s.updated_at, s.updated_by
  into v_row
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-source-row-missing';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;
  v_payload_text := v_row.payload::text;
  v_hash := encode(sha256(convert_to(v_payload_text, 'UTF8')), 'hex');
  if v_hash is distinct from v_control.payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-source-freeze-hash-mismatch';
  end if;
  return jsonb_build_object(
    'workspaceKey', v_row.workspace_key,
    'revision', v_row.revision,
    'payloadText', v_payload_text,
    'payloadSha256', v_hash,
    'updatedAt', v_row.updated_at,
    'updatedBy', v_row.updated_by,
    'frozenAt', v_control.frozen_at,
    'exportedAt', clock_timestamp()
  );
end;
$$;

create or replace function public.restore_ship_dynamics_legacy_backup(
  p_workspace_key text,
  p_legacy_revision bigint,
  p_legacy_payload jsonb,
  p_payload_sha256 text,
  p_updated_at timestamptz default null,
  p_updated_by text default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actual_hash text;
  v_restored_hash text;
  v_restored_revision bigint;
  v_payload_equal boolean;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );
  perform public.sd_assert_legacy_freeze_boundary(p_workspace_key);
  if p_legacy_revision is null or p_legacy_revision < 0 or p_legacy_payload is null then
    raise exception using errcode = '22023', message = 'invalid-restore-package';
  end if;
  v_actual_hash := public.sd_legacy_jsonb_sha256(p_legacy_payload);
  if p_payload_sha256 is distinct from v_actual_hash then
    raise exception using errcode = 'P0001', message = 'backup-payload-hash-mismatch';
  end if;
  if p_confirmation is distinct from
     'restore:' || p_workspace_key || ':' || p_legacy_revision::text || ':' || v_actual_hash then
    raise exception using errcode = '22023', message = 'confirmation-mismatch';
  end if;

  update public.sd_legacy_write_controls
  set restore_in_progress = true, updated_at = clock_timestamp()
  where workspace_key = p_workspace_key and writes_frozen;
  if not found then
    raise exception using errcode = '55000', message = 'legacy-writes-not-frozen';
  end if;

  insert into public.ship_dynamics_app_state(
    workspace_key, payload, revision, updated_at, updated_by
  ) values (
    p_workspace_key, p_legacy_payload, p_legacy_revision,
    coalesce(p_updated_at, clock_timestamp()), p_updated_by
  )
  on conflict (workspace_key) do update
    set payload = excluded.payload,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  -- BEFORE triggers may transform the supplied row. Success describes the
  -- actual persisted package, never merely the accepted input arguments.
  select s.revision, public.sd_legacy_jsonb_sha256(s.payload), s.payload = p_legacy_payload
  into v_restored_revision, v_restored_hash, v_payload_equal
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key;
  if not found or v_payload_equal is not true
     or v_restored_revision is distinct from p_legacy_revision
     or v_restored_hash is distinct from v_actual_hash then
    raise exception using errcode = 'P0001', message = 'restored-payload-mismatch';
  end if;

  update public.sd_legacy_write_controls
  set expected_revision = p_legacy_revision,
      payload_sha256 = v_actual_hash,
      restore_in_progress = false,
      updated_at = clock_timestamp()
  where workspace_key = p_workspace_key;

  return jsonb_build_object(
    'status', 'restored',
    'workspaceKey', p_workspace_key,
    'revision', p_legacy_revision,
    'payloadSha256', v_actual_hash
  );
end;
$$;

create or replace function public.reenable_ship_dynamics_legacy_writes(
  p_workspace_key text,
  p_expected_revision bigint,
  p_payload_sha256 text,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_revision bigint;
  v_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );
  perform public.sd_assert_legacy_freeze_boundary(p_workspace_key);
  if p_confirmation is distinct from
     'reenable:' || p_workspace_key || ':' || p_expected_revision::text || ':' || p_payload_sha256 then
    raise exception using errcode = '22023', message = 'confirmation-mismatch';
  end if;
  select s.revision, public.sd_legacy_jsonb_sha256(s.payload)
  into v_revision, v_hash
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-source-row-missing';
  end if;
  if v_revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;
  if v_hash is distinct from p_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-payload-hash-mismatch';
  end if;
  update public.sd_legacy_write_controls
  set writes_frozen = false,
      restore_in_progress = false,
      updated_at = clock_timestamp()
  where workspace_key = p_workspace_key
    and writes_frozen
    and expected_revision = p_expected_revision
    and payload_sha256 = p_payload_sha256;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-freeze-state-mismatch';
  end if;
  return jsonb_build_object(
    'status', 'write-enabled',
    'workspaceKey', p_workspace_key,
    'revision', p_expected_revision,
    'payloadSha256', p_payload_sha256
  );
end;
$$;

revoke all on function public.sd_legacy_jsonb_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.sd_guard_legacy_app_state_write() from public, anon, authenticated, service_role;
revoke all on function public.sd_assert_legacy_freeze_boundary(text) from public, anon, authenticated, service_role;
revoke all on function public.freeze_ship_dynamics_legacy_writes(text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.export_ship_dynamics_legacy_backup(text, bigint, text) from public, anon, authenticated;
revoke all on function public.restore_ship_dynamics_legacy_backup(text, bigint, jsonb, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.reenable_ship_dynamics_legacy_writes(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.freeze_ship_dynamics_legacy_writes(text, bigint, text, text) to service_role;
grant execute on function public.export_ship_dynamics_legacy_backup(text, bigint, text) to service_role;
grant execute on function public.restore_ship_dynamics_legacy_backup(text, bigint, jsonb, text, timestamptz, text, text) to service_role;
grant execute on function public.reenable_ship_dynamics_legacy_writes(text, bigint, text, text) to service_role;
-- END COMPONENT: supabase/normalized-legacy-cutover.sql

-- BEGIN COMPONENT: supabase/development/20260911_legacy_report_workspace_binding.sql
-- LOCAL development prerequisite for the canonical sd_workspaces(legacy_key)
-- schema. Correct only the three original-App legacy report workspace lookups.
-- No table/actor/receipt/CAS/ACL change; install after existing report migrations.
-- This is not a production execution or an arbitrary-schema upgrade strategy.
do $binding$
declare
 signature text;definition text;old_count integer;new_count integer;
 old_ref constant text:='workspace.workspace_key';
 new_ref constant text:='workspace.legacy_key';
begin
 if not exists(select 1 from pg_attribute where attrelid='public.sd_workspaces'::regclass and attname='legacy_key' and attnum>0 and not attisdropped)
 or exists(select 1 from pg_attribute where attrelid='public.sd_workspaces'::regclass and attname='workspace_key' and attnum>0 and not attisdropped)
 then raise exception 'legacy-report-workspace-schema-unrecognized';end if;
 foreach signature in array array[
  'public.sd_save_manual_itinerary_report(text,text,uuid)',
  'public.delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)',
  'public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)'
 ] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  old_count:=(length(definition)-length(replace(definition,old_ref,'')))/length(old_ref);
  new_count:=(length(definition)-length(replace(definition,new_ref,'')))/length(new_ref);
  if old_count=1 and new_count=0 then execute replace(definition,old_ref,new_ref);
  elsif old_count=0 and new_count=1 then null;
  else raise exception 'legacy-report-workspace-definition-unrecognized';end if;
 end loop;
end;
$binding$;
-- END COMPONENT: supabase/development/20260911_legacy_report_workspace_binding.sql

-- BEGIN COMPONENT: supabase/development/20260911_business_quiescence.sql
-- DEVELOPMENT ONLY. Explicit local install LAST, on an idle owned database.
-- Business quiescence, not route cutover or a browser maintenance UX.

select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create schema if not exists ship_dynamics_quiescence_private;
revoke all on schema ship_dynamics_quiescence_private from public,anon,authenticated,service_role;
create table if not exists ship_dynamics_quiescence_private.workspaces(
  workspace_key text primary key check(workspace_key<>'' and workspace_key=btrim(workspace_key)),
  workspace_id uuid unique,
  transition_id uuid not null
);
create table if not exists ship_dynamics_quiescence_private.transitions(
  workspace_key text not null references ship_dynamics_quiescence_private.workspaces(workspace_key),
  transition_id uuid not null,
  state text not null check(state in ('paused','resumed')),
  watermark jsonb not null check(jsonb_typeof(watermark)='object'),
  primary key(workspace_key,transition_id)
);
revoke all on all tables in schema ship_dynamics_quiescence_private from public,anon,authenticated,service_role;

create or replace function ship_dynamics_quiescence_private.tables_v1()
returns table(table_name text,key_column text) language sql immutable set search_path=pg_catalog as $$
 values
 ('ship_dynamics_app_state','workspace_key'),('ship_dynamics_app_revisions','workspace_key'),
 ('ship_dynamics_block_operations','workspace_key'),('ship_dynamics_data_management_operations','workspace_key'),
 ('ship_dynamics_record_workspaces','workspace_key'),('ship_dynamics_record_collections','workspace_key'),
 ('ship_dynamics_records','workspace_key'),('ship_dynamics_record_receipts','workspace_key'),
 ('ship_dynamics_record_versions','workspace_key'),('ship_dynamics_record_history','workspace_key'),
 ('ship_dynamics_record_task_progress','workspace_key'),('ship_dynamics_record_task_progress_history','workspace_key'),
 ('ship_dynamics_record_prune_operations','workspace_key'),
 ('sd_itinerary_documents','workspace_id'),('sd_itinerary_history','workspace_id'),
 ('sd_itinerary_operations','workspace_id'),('sd_itinerary_daily_reports','workspace_id'),
 ('sd_itinerary_daily_report_operations','workspace_id'),('sd_itinerary_rollout','workspace_id'),
 ('sd_itinerary_role_permissions','workspace_id'),('sd_saved_reports','workspace_id'),
 ('sd_saved_report_vessels','workspace_id'),('sd_audit_events','workspace_id'),('sd_operations','workspace_id'),
 ('sd_vessels','workspace_id'),('sd_workspaces','id')
$$;

create or replace function ship_dynamics_quiescence_private.operator_v1()
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if coalesce(nullif(current_setting('role',true),'none'),session_user) not in ('service_role',current_user::text) then
   raise exception 'business-pause-operator-required' using errcode='42501';
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'business-pause-read-committed-required' using errcode='25001';
 end if;
end $$;

create or replace function ship_dynamics_quiescence_private.assert_write_v1(p_workspace text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record;
begin
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'business-pause-read-committed-required' using errcode='25001';
 end if;
 -- Never wait here: direct DML or an existing RPC may already own a tuple or
 -- subsystem lock. A queued exclusive pause must not make a lock-order cycle.
 if not pg_try_advisory_xact_lock_shared(hashtext('record-maintenance-v1'),0) then
   raise exception 'business-pause-retry-transaction' using errcode='40001';
 end if;
 if p_workspace is null or p_workspace='' then
   raise exception 'business-pause-workspace-required' using errcode='55000';
 end if;
 -- VOLATILE + READ COMMITTED: fresh SPI statement after gate admission.
 select w.transition_id,t.state,t.watermark into c
 from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t
 on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if found then
   if c.state is null or c.watermark is null then
     raise exception 'business-pause-control-invalid' using errcode='55000';
   end if;
   if c.state='paused' then raise exception 'business-writes-paused' using errcode='55000';end if;
 elsif exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace) then
   raise exception 'business-pause-control-invalid' using errcode='55000';
 end if;
end $$;

create or replace function ship_dynamics_quiescence_private.row_guard_v1()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare item jsonb; k text; mapped text; uid uuid;
begin
 -- BOTH old and new identities are checked, including moves into/out of pause.
 for item in select v from unnest(case when TG_OP='INSERT' then array[to_jsonb(NEW)]
   when TG_OP='DELETE' then array[to_jsonb(OLD)] else array[to_jsonb(OLD),to_jsonb(NEW)] end) v loop
   if TG_ARGV[0]='workspace_key' then k:=item->>'workspace_key';
   else
     uid:=(item->>TG_ARGV[0])::uuid;
     select workspace_key into k from ship_dynamics_quiescence_private.workspaces where workspace_id=uid;
     select legacy_key into mapped from public.sd_workspaces where id=uid;
     if k is not null and mapped is distinct from k then
       raise exception 'business-pause-workspace-binding' using errcode='55000';
     end if;
     k:=coalesce(k,mapped,case when TG_TABLE_NAME='sd_workspaces' then item->>'legacy_key' end);
   end if;
   perform ship_dynamics_quiescence_private.assert_write_v1(k);
   if TG_TABLE_NAME='sd_workspaces' then
     perform ship_dynamics_quiescence_private.assert_write_v1(item->>'legacy_key');
   end if;
 end loop;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $$;

create or replace function ship_dynamics_quiescence_private.truncate_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- TRUNCATE has no workspace predicate; no maintenance exception in this slice.
 raise exception 'business-pause-truncate-unsupported' using errcode='55000';
end $$;

create or replace function ship_dynamics_quiescence_private.watermark_v1(p_workspace text,p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare t record; h text; n bigint; result jsonb:='{}';
begin
 -- MVCC only. Never SELECT FOR UPDATE / LOCK TABLE after exclusive drain.
 for t in select * from ship_dynamics_quiescence_private.tables_v1() loop
   execute format('select count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' order by to_jsonb(r)::text),'''')) from public.%I r where %I::text=$1',t.table_name,t.key_column)
     into n,h using case when t.key_column='workspace_key' then p_workspace else p_id::text end;
   result:=result||jsonb_build_object(t.table_name,jsonb_build_object('rows',n,'digest',h));
 end loop;
 return result;
end $$;

create or replace function ship_dynamics_quiescence_private.drain_v1()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform ship_dynamics_quiescence_private.operator_v1();
 -- Operator must start without prior business tuple/writer locks. No unsafe
 -- shared-to-exclusive upgrade or arbitrary SELECT FOR UPDATE -> drain cycle.
 if exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.granted and (
   (l.locktype='advisory' and l.classid=hashtext('record-maintenance-v1')::oid and l.objid=0 and l.objsubid=2)
   or (l.locktype='relation' and l.mode<>'AccessShareLock' and l.relation in
     (select to_regclass('public.'||table_name) from ship_dynamics_quiescence_private.tables_v1())))) then
   raise exception 'business-pause-fresh-transaction-required' using errcode='25001';
 end if;
 perform pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
end $$;

create or replace function public.pause_ship_dynamics_business_v1(p_workspace text,p_transition uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record; uid uuid; mark jsonb;
begin
 perform ship_dynamics_quiescence_private.drain_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_transition is null then
   raise exception 'business-pause-invalid-transition' using errcode='22023';
 end if;
 select id into uid from public.sd_workspaces where legacy_key=p_workspace;
 if uid is null and not exists(select 1 from public.ship_dynamics_app_state where workspace_key=p_workspace)
   and not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=p_workspace) then
   raise exception 'business-pause-workspace-missing' using errcode='55000';
 end if;
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if found then
   if c.state is null or c.workspace_id is distinct from uid then raise exception 'business-pause-control-invalid' using errcode='55000';end if;
   if c.state='paused' then
     if c.transition_id is distinct from p_transition then raise exception 'business-pause-transition-mismatch' using errcode='55000';end if;
     return jsonb_build_object('state','paused','workspace',p_workspace,'transition',p_transition,'watermark',c.watermark);
   end if;
 end if;
 if exists(select 1 from ship_dynamics_quiescence_private.transitions where transition_id=p_transition) then
   raise exception 'business-pause-transition-reused' using errcode='55000';
 end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,uid);
 insert into ship_dynamics_quiescence_private.workspaces values(p_workspace,uid,p_transition)
 on conflict(workspace_key) do update set transition_id=excluded.transition_id;
 insert into ship_dynamics_quiescence_private.transitions values(p_workspace,p_transition,'paused',mark);
 return jsonb_build_object('state','paused','workspace',p_workspace,'transition',p_transition,'watermark',mark);
end $$;

create or replace function public.read_ship_dynamics_business_pause_v1(p_workspace text,p_transition uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record; mark jsonb;
begin
 perform ship_dynamics_quiescence_private.operator_v1();
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if not found or c.state is null or c.transition_id is distinct from p_transition then
   raise exception 'business-pause-transition-mismatch' using errcode='55000';
 end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,c.workspace_id);
 return jsonb_build_object('state',c.state,'workspace',p_workspace,'transition',p_transition,'watermark',c.watermark,'unchanged',mark=c.watermark);
end $$;

create or replace function public.resume_ship_dynamics_business_v1(p_workspace text,p_transition uuid,p_watermark jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record; mark jsonb;
begin
 perform ship_dynamics_quiescence_private.drain_v1();
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 left join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id
 where w.workspace_key=p_workspace;
 if not found or c.state is distinct from 'paused' or c.transition_id is distinct from p_transition then
   raise exception 'business-pause-transition-mismatch' using errcode='55000';
 end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,c.workspace_id);
 if p_watermark is distinct from c.watermark or mark is distinct from c.watermark then
   raise exception 'business-pause-state-mismatch' using errcode='55000';
 end if;
 update ship_dynamics_quiescence_private.transitions set state='resumed'
 where workspace_key=p_workspace and transition_id=p_transition;
 return jsonb_build_object('state','resumed','workspace',p_workspace,'transition',p_transition);
end $$;

-- Existing terminal requests must remain readable while writes are paused.
-- This helper never creates a ledger row, takes a writer lock, or changes the
-- current actor policy. Input-array normalization remains in the original RPC.
create or replace function ship_dynamics_quiescence_private.prune_terminal_v1(
 p_workspace text,p_actor text,p_operation uuid,p_request jsonb,p_records boolean
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare entry jsonb; actor_role text;
begin
 if p_records then
  select to_jsonb(r) into entry from public.ship_dynamics_record_prune_operations r where operation_id=p_operation;
 else
  select to_jsonb(r) into entry from public.ship_dynamics_data_management_operations r where operation_id=p_operation;
 end if;
 if entry is null then return null;end if;
 if p_records then
  if not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=p_workspace) then
   return jsonb_build_object('ok',false,'error','WORKSPACE_NOT_FOUND');end if;
  select r.value->>'role' into actor_role from public.ship_dynamics_records r
   where r.workspace_key=p_workspace and r.collection='users' and r.entity_id=p_actor and r.value->'isActive'='true'::jsonb;
 else
  if not exists(select 1 from public.ship_dynamics_app_state where workspace_key=p_workspace) then
   return jsonb_build_object('ok',false,'error','WORKSPACE_NOT_FOUND');end if;
  select item->>'role' into actor_role from public.ship_dynamics_app_state s
   cross join lateral jsonb_array_elements(case when jsonb_typeof(s.payload->'users')='array' then s.payload->'users' else '[]'::jsonb end) item
   where s.workspace_key=p_workspace and item->>'id'=p_actor and coalesce((item->>'isActive')::boolean,false) limit 1;
 end if;
 if actor_role is distinct from 'owner' then return jsonb_build_object('ok',false,'error','OWNER_REQUIRED');end if;
 if entry->>'workspace_key' is distinct from p_workspace or entry->>'actor_user_id' is distinct from p_actor
  or entry->>'command_type' is distinct from 'prune_revision_history' or entry->'request_payload' is distinct from p_request then
  return jsonb_build_object('ok',false,'error','IDEMPOTENCY_MISMATCH');end if;
 if entry->>'status' in ('COMMITTED','REJECTED') then return entry->'result';end if;
 return null;
end $$;

-- Installation-only, source-shape-checked extension. Preserve the original
-- function body, OID, ACL and newline representation outside the named insertion.
create or replace function ship_dynamics_quiescence_private.splice_terminal_v1(
 p_function regprocedure,p_needle text,p_addition text,p_marker text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare def text; needle text:=p_needle; addition text:=p_addition;
begin
 def:=pg_get_functiondef(p_function);
 if position(p_marker in def)>0 then return;end if;
 if position(needle in def)=0 and position(replace(needle,chr(10),chr(13)||chr(10)) in def)>0 then
  needle:=replace(needle,chr(10),chr(13)||chr(10));addition:=replace(addition,chr(10),chr(13)||chr(10));end if;
 if length(def)-length(replace(def,needle,''))<>length(needle) then raise exception 'business-pause-terminal-source-mismatch';end if;
 execute replace(def,needle,addition||needle);
end $$;

do $$
declare is_records boolean; signature regprocedure; needle text; addition text;
begin
 for is_records in select unnest(array[false,true]) loop
  signature:=case when is_records then 'public.prune_ship_dynamics_record_revision_history_v1(text,text,uuid,jsonb,jsonb)'::regprocedure
   else 'public.prune_ship_dynamics_revision_history(text,text,uuid,jsonb,jsonb)'::regprocedure end;
  needle:=case when is_records then '  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);'
   else E'  select * into current_row\n  from public.ship_dynamics_app_state' end;
  addition:=format($add$  -- business_pause_terminal_prune_v1
  response := ship_dynamics_quiescence_private.prune_terminal_v1(
    p_workspace_key,p_actor_user_id,p_operation_id,
    jsonb_build_object('expectedRevisions',normalized_expected,'deleteRevisions',normalized_delete),%L::boolean);
  if response is not null then return response;end if;
$add$,is_records);
  perform ship_dynamics_quiescence_private.splice_terminal_v1(signature,needle,addition,'-- business_pause_terminal_prune_v1');
 end loop;
 perform ship_dynamics_quiescence_private.splice_terminal_v1(
  'public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)'::regprocedure,
  '  perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);',
  $add$  -- business_pause_terminal_scheduler_v1
  select * into ledger from public.ship_dynamics_record_receipts where workspace_key=p_workspace_key and operation_id=operation_key;
  if found then
    if ledger.signature is distinct from signature then raise exception 'operation-id-mismatch';end if;
    return ledger.result || jsonb_build_object('replayed',true);
  end if;
$add$,'-- business_pause_terminal_scheduler_v1');
end $$;

-- Task/member lease upkeep uses the unchanged locking protocol, not business
-- admission. Keep an installation-derived private copy of the original gate;
-- actual saves still use the public gated entry and every business row trigger.
do $lease$
declare def text; lease_def text;
 source_name constant text:='public.ship_dynamics_record_writer_gate_v1(';
 target_name constant text:='ship_dynamics_quiescence_private.lease_writer_gate_v1(';
 injected constant text:=E'\n  perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);';
 old_call constant text:='perform public.ship_dynamics_record_writer_gate_v1(p_workspace,false);';
 new_call constant text:='perform ship_dynamics_quiescence_private.lease_writer_gate_v1(p_workspace,false);';
begin
 def:=pg_get_functiondef('public.ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure);
 def:=replace(def,injected,'');
 if position('ship_dynamics_quiescence_private.assert_write_v1' in def)>0
 or length(def)-length(replace(def,source_name,''))<>length(source_name) then
  raise exception 'business-pause-lease-gate-source-mismatch';end if;
 execute replace(def,source_name,target_name);
 if to_regprocedure('public.ship_dynamics_task_lease_gate_v1(text,text)') is not null then
  lease_def:=pg_get_functiondef('public.ship_dynamics_task_lease_gate_v1(text,text)'::regprocedure);
  if length(lease_def)-length(replace(lease_def,old_call,''))=length(old_call) and position(new_call in lease_def)=0 then
   execute replace(lease_def,old_call,new_call);
  elsif position(old_call in lease_def)=0 and length(lease_def)-length(replace(lease_def,new_call,''))=length(new_call) then null;
  else raise exception 'business-pause-task-lease-source-mismatch';end if;
 end if;
end $lease$;

-- A narrow, fail-closed installation splice preserves every existing writer
-- early-return / cross-workspace / try-upgrade branch and its function OID/ACL.
do $$
declare def text; needle text:='perform pg_advisory_xact_lock_shared(hashtext(''record-maintenance-v1''),0);'; t record;
begin
 def:=pg_get_functiondef('public.ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure);
 if position('ship_dynamics_quiescence_private.assert_write_v1(p_workspace)' in def)=0 then
   if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then
     raise exception 'business-pause-writer-gate-source-mismatch';
   end if;
   execute replace(def,needle,needle||E'\n  perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);');
 end if;
 for t in select * from ship_dynamics_quiescence_private.tables_v1() loop
   -- Required families must exist: no partial installation silently accepted.
   if to_regclass('public.'||t.table_name) is null then raise exception 'business-pause-required-table-missing: %',t.table_name;end if;
   execute format('drop trigger if exists sd_business_pause_row_v1 on public.%I',t.table_name);
   execute format('create trigger sd_business_pause_row_v1 before insert or update or delete on public.%I for each row execute function ship_dynamics_quiescence_private.row_guard_v1(%L)',t.table_name,t.key_column);
   execute format('drop trigger if exists sd_business_pause_truncate_v1 on public.%I',t.table_name);
   execute format('create trigger sd_business_pause_truncate_v1 before truncate on public.%I for each statement execute function ship_dynamics_quiescence_private.truncate_guard_v1()',t.table_name);
 end loop;
end $$;
revoke all on all functions in schema ship_dynamics_quiescence_private from public,anon,authenticated,service_role;
revoke all on function public.pause_ship_dynamics_business_v1(text,uuid),public.read_ship_dynamics_business_pause_v1(text,uuid),public.resume_ship_dynamics_business_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pause_ship_dynamics_business_v1(text,uuid),public.read_ship_dynamics_business_pause_v1(text,uuid),public.resume_ship_dynamics_business_v1(text,uuid,jsonb) to service_role;
-- END COMPONENT: supabase/development/20260911_business_quiescence.sql

-- BEGIN COMPONENT: supabase/development/20260911_paused_record_legacy_transfer.sql
-- DEVELOPMENT ONLY: install after business_quiescence and legacy cutover.
-- Dedicated staging, not authority publication, resume, or arbitrary restore.

select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create table if not exists ship_dynamics_quiescence_private.stages_v1(
 request_id uuid primary key,
 workspace_key text not null,
 transition_id uuid not null,
 actor name not null,
 request jsonb not null,
 result jsonb not null,
 staged_watermark jsonb not null,
 unique(workspace_key,transition_id),
 foreign key(workspace_key,transition_id) references ship_dynamics_quiescence_private.transitions
);
-- Exists only between exact validation and readback in the same transaction.
-- No business payload or credentials are stored here.
create table if not exists ship_dynamics_quiescence_private.stage_context_v1(
 backend integer primary key,
 transaction_id xid8 not null,
 actor name not null,
 workspace_key text not null,
 old_row_sha256 text not null,
 new_row_sha256 text not null,
 history_row_sha256 text not null,
 state_used boolean not null default false,
 history_used boolean not null default false
);
revoke all on table ship_dynamics_quiescence_private.stages_v1,ship_dynamics_quiescence_private.stage_context_v1 from public,anon,authenticated,service_role;

create or replace function ship_dynamics_quiescence_private.stage_row_v1(
 p_table oid,p_operation text,p_old jsonb,p_new jsonb
) returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c ship_dynamics_quiescence_private.stage_context_v1%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then return false;end if;
 select * into c from ship_dynamics_quiescence_private.stage_context_v1
 where backend=pg_backend_pid() and transaction_id=pg_current_xact_id() and actor=session_user;
 if not found or p_new->>'workspace_key' is distinct from c.workspace_key then return false;end if;
 if p_table='public.ship_dynamics_app_state'::regclass and p_operation='UPDATE'
  and not c.state_used and public.sd_legacy_jsonb_sha256(p_old)=c.old_row_sha256
  and public.sd_legacy_jsonb_sha256(p_new)=c.new_row_sha256 then
  update ship_dynamics_quiescence_private.stage_context_v1 set state_used=true where backend=c.backend;
  return true;
 elsif p_table='public.ship_dynamics_app_revisions'::regclass and p_operation='INSERT'
  and c.state_used and not c.history_used and public.sd_legacy_jsonb_sha256(p_new)=c.history_row_sha256 then
  update ship_dynamics_quiescence_private.stage_context_v1 set history_used=true where backend=c.backend;
  return true;
 end if;
 return false;
end $$;

-- Keep every ordinary row guard branch/ACL/OID. Base then addon restores this
-- single source-checked insertion; unknown installed shapes abort installation.
select ship_dynamics_quiescence_private.splice_terminal_v1(
 'ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 ' -- BOTH old and new identities are checked, including moves into/out of pause.',
 $add$ -- paused_record_legacy_stage_row_v1
 if ship_dynamics_quiescence_private.stage_row_v1(TG_RELID,TG_OP,
  case when TG_OP='INSERT' then null else to_jsonb(OLD) end,
  case when TG_OP='DELETE' then null else to_jsonb(NEW) end) then return NEW;end if;
$add$,'-- paused_record_legacy_stage_row_v1');

create or replace function public.stage_ship_dynamics_paused_records_to_legacy_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_watermark jsonb,
 p_source_revision integer,p_source_sha256 text,p_target_revision integer,
 p_target_sha256 text,p_frozen_at timestamptz,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 c record; legacy public.ship_dynamics_app_state%rowtype;
 v_freeze public.sd_legacy_write_controls%rowtype;
 source jsonb; source_row public.ship_dynamics_record_workspaces%rowtype;
 v_request jsonb; previous ship_dynamics_quiescence_private.stages_v1%rowtype;
 target_revision integer; target_at timestamptz; target_text text; target_payload jsonb;
 target_hash text; expected_row jsonb; expected_history jsonb; actual_row jsonb;
 actual_history jsonb; mark jsonb; v_result jsonb; ctx record;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'paused-stage-service-required' using errcode='42501';end if;
 -- A fresh operator transaction owns no advisory/subsystem/control/business
 -- locks. All subsequent potentially contested locks are TRY/NOWAIT, so an
 -- ungated legacy operator or tuple holder cannot form a reversed wait cycle.
 perform ship_dynamics_quiescence_private.operator_v1();
 if exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.granted
  and (l.locktype='advisory' or (l.locktype='relation' and l.mode<>'AccessShareLock'
   and l.relation in(select cl.oid from pg_class cl join pg_namespace n on n.oid=cl.relnamespace
    where n.nspname in ('public','ship_dynamics_quiescence_private'))))) then
  raise exception 'paused-stage-fresh-transaction-required' using errcode='25001';end if;
 perform ship_dynamics_quiescence_private.drain_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace)
  or p_workspace_id is null or p_transition is null or p_request_id is null
  or jsonb_typeof(p_watermark) is distinct from 'object'
  or p_source_revision is null or p_source_revision<0 or p_target_revision is null or p_target_revision<0
  or coalesce(p_source_sha256,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_target_sha256,'') !~ '^[0-9a-f]{64}$' or p_frozen_at is null then
  raise exception 'paused-stage-invalid-request' using errcode='22023';end if;
 v_request:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,
  'watermark',p_watermark,'sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,
  'targetRevision',p_target_revision,'targetSha256',p_target_sha256,'frozenAt',p_frozen_at,'requestId',p_request_id);
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w
 join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id)
 where w.workspace_key=p_workspace;
 if not found or c.state is distinct from 'paused' or c.transition_id is distinct from p_transition
  or c.workspace_id is distinct from p_workspace_id or c.watermark is distinct from p_watermark
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace) then
  raise exception 'paused-stage-pause-binding-mismatch' using errcode='55000';end if;
 -- MVCC source read is fresh after global exclusive admission. No source write,
 -- row lock, externally supplied snapshot, or reconstruction from the target.
 select * into source_row from public.ship_dynamics_record_workspaces where workspace_key=p_workspace;
 source:=public.read_ship_dynamics_records_v1(p_workspace);
 if source->>'status' is distinct from 'snapshot' or source_row.revision is distinct from p_source_revision
  or (source->>'revision')::integer is distinct from p_source_revision
  or public.sd_legacy_jsonb_sha256(source->'payload') is distinct from p_source_sha256
  or (source->'payload'->>'revision')::integer is distinct from p_source_revision
  or (source->'payload'->>'updatedAt')::timestamptz is distinct from date_trunc('milliseconds',source_row.updated_at) then
  raise exception 'paused-stage-source-mismatch' using errcode='55000';end if;
 perform public.sd_assert_legacy_freeze_boundary(p_workspace);
 select * into v_freeze from public.sd_legacy_write_controls where workspace_key=p_workspace;
 select * into legacy from public.ship_dynamics_app_state where workspace_key=p_workspace;
 if not found or v_freeze.frozen_at is distinct from p_frozen_at then
  raise exception 'paused-stage-target-mismatch' using errcode='55000';end if;
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id);
 select * into previous from ship_dynamics_quiescence_private.stages_v1 where request_id=p_request_id;
 if found then
  if previous.actor is distinct from session_user or previous.request is distinct from v_request
   or mark is distinct from previous.staged_watermark
   or legacy.revision is distinct from (previous.result->>'targetRevision')::integer
   or public.sd_legacy_jsonb_sha256(legacy.payload) is distinct from previous.result->>'targetSha256'
   or v_freeze.expected_revision is distinct from legacy.revision::bigint
   or v_freeze.payload_sha256 is distinct from previous.result->>'targetSha256' then
   raise exception 'paused-stage-replay-mismatch' using errcode='55000';end if;
  return previous.result;
 end if;
 if exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where workspace_key=p_workspace and transition_id=p_transition)
  or mark is distinct from p_watermark then
  raise exception 'paused-stage-transition-already-changed' using errcode='55000';end if;
 if legacy.revision is distinct from p_target_revision
  or public.sd_legacy_jsonb_sha256(legacy.payload) is distinct from p_target_sha256
  or v_freeze.expected_revision is distinct from p_target_revision::bigint
  or v_freeze.payload_sha256 is distinct from p_target_sha256 then
  raise exception 'paused-stage-target-mismatch' using errcode='55000';end if;
 if greatest(p_source_revision,p_target_revision)=2147483647 then
  raise exception 'paused-stage-revision-exhausted' using errcode='22023';end if;
 target_revision:=greatest(p_source_revision,p_target_revision)+1;
 target_at:=date_trunc('milliseconds',clock_timestamp());
 target_text:=to_char(target_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 target_payload:=source->'payload'||jsonb_build_object('revision',target_revision,'updatedAt',target_text);
 target_hash:=public.sd_legacy_jsonb_sha256(target_payload);
 expected_row:=jsonb_build_object('workspace_key',p_workspace,'payload',target_payload,'revision',target_revision,
  'updated_at',target_at,'updated_by',source_row.updated_by);
 expected_history:=jsonb_build_object('workspace_key',p_workspace,'payload',target_payload,'revision',target_revision,
  'saved_at',target_at,'saved_by',source_row.updated_by);
 if exists(select 1 from public.ship_dynamics_app_revisions where workspace_key=p_workspace and revision=target_revision) then
  raise exception 'paused-stage-history-collision' using errcode='55000';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_workspace,731921)) then
  raise exception 'paused-stage-retry-transaction' using errcode='40001';end if;
 -- NOWAIT also covers a caller holding a tuple before entering its row guard.
 begin
  perform 1 from public.sd_legacy_write_controls where workspace_key=p_workspace for update nowait;
  perform 1 from public.ship_dynamics_app_state where workspace_key=p_workspace for update nowait;
 exception when lock_not_available then
  raise exception 'paused-stage-retry-transaction' using errcode='40001';end;
 insert into ship_dynamics_quiescence_private.stage_context_v1
  (backend,transaction_id,actor,workspace_key,old_row_sha256,new_row_sha256,history_row_sha256)
 values(pg_backend_pid(),pg_current_xact_id(),session_user,p_workspace,public.sd_legacy_jsonb_sha256(to_jsonb(legacy)),
  public.sd_legacy_jsonb_sha256(expected_row),public.sd_legacy_jsonb_sha256(expected_history));
 update public.sd_legacy_write_controls set restore_in_progress=true where workspace_key=p_workspace;
 update public.ship_dynamics_app_state set payload=target_payload,revision=target_revision,
  updated_at=target_at,updated_by=source_row.updated_by where workspace_key=p_workspace;
 -- Read after all row AND statement triggers, against precomputed expectations.
 select to_jsonb(s) into actual_row from public.ship_dynamics_app_state s where workspace_key=p_workspace;
 select to_jsonb(s) into actual_history from public.ship_dynamics_app_revisions s where workspace_key=p_workspace and revision=target_revision;
 select * into ctx from ship_dynamics_quiescence_private.stage_context_v1 where backend=pg_backend_pid();
 if actual_row is distinct from expected_row or actual_history is distinct from expected_history
  or public.sd_legacy_jsonb_sha256(actual_row->'payload') is distinct from target_hash
  or ctx.state_used is distinct from true or ctx.history_used is distinct from true then
  raise exception 'paused-stage-readback-mismatch' using errcode='55000';end if;
 update public.sd_legacy_write_controls set restore_in_progress=false,expected_revision=target_revision,
  payload_sha256=target_hash,updated_at=target_at where workspace_key=p_workspace;
 delete from ship_dynamics_quiescence_private.stage_context_v1 where backend=pg_backend_pid();
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id);
 if (mark-'ship_dynamics_app_state'-'ship_dynamics_app_revisions') is distinct from
  (p_watermark-'ship_dynamics_app_state'-'ship_dynamics_app_revisions') then
  raise exception 'paused-stage-independent-state-mismatch' using errcode='55000';end if;
 v_result:=jsonb_build_object('state','staged-paused','workspace',p_workspace,'workspaceId',p_workspace_id,
  'transition',p_transition,'requestId',p_request_id,'requestSha256',public.sd_legacy_jsonb_sha256(v_request),
  'sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,'sourceUpdatedAt',source->'payload'->'updatedAt',
  'previousTargetRevision',p_target_revision,'previousTargetSha256',p_target_sha256,
  'targetRevision',target_revision,'targetSha256',target_hash,'targetUpdatedAt',target_text,
  'metadataMapping','max(source,target)+1; server UTC milliseconds; preserve source updated_by');
 insert into ship_dynamics_quiescence_private.stages_v1 values(p_request_id,p_workspace,p_transition,session_user,v_request,v_result,mark);
 -- Receipt-trigger faults/tampering cannot turn an unverified mutation into ACK.
 if not exists(select 1 from ship_dynamics_quiescence_private.stages_v1 s where s.request_id=p_request_id
  and s.request=v_request and s.result=v_result and s.staged_watermark=mark and s.actor=session_user)
  or (select restore_in_progress or not writes_frozen or expected_revision is distinct from target_revision::bigint
      or payload_sha256 is distinct from target_hash or frozen_at is distinct from p_frozen_at
      from public.sd_legacy_write_controls where workspace_key=p_workspace) is distinct from false
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from mark then
  raise exception 'paused-stage-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
revoke all on function ship_dynamics_quiescence_private.stage_row_v1(oid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) to service_role;
-- END COMPONENT: supabase/development/20260911_paused_record_legacy_transfer.sql

-- BEGIN COMPONENT: supabase/development/20260911_source_authority_publication.sql
-- DEVELOPMENT ONLY: idle install after pause + paused transfer; no client adoption.

select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create schema if not exists ship_dynamics_authority_private;
revoke all on schema ship_dynamics_authority_private from public,anon,authenticated,service_role;
create table if not exists ship_dynamics_authority_private.current_v1(
 workspace_key text primary key, workspace_id uuid not null unique,
 epoch bigint not null check(epoch>0), source text not null check(source='legacy'),
 publication_id uuid not null unique, transition_id uuid not null,
 phase text not null check(phase in ('published-paused','resumed'))
);
create table if not exists ship_dynamics_authority_private.receipts_v1(
 request_id uuid primary key, actor name not null, action text not null,
 request jsonb not null, result jsonb not null, binding jsonb not null
);
revoke all on all tables in schema ship_dynamics_authority_private from public,anon,authenticated,service_role;

-- Admission-only shared maintenance read. It changes no business/ledger state.
-- TRY is required: old direct callers can already own subsystem or tuple locks.
create or replace function ship_dynamics_authority_private.gate_v1()
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'source-authority-read-committed-required' using errcode='25001';end if;
 if not pg_try_advisory_xact_lock_shared(hashtext('record-maintenance-v1'),0) then raise exception 'source-authority-retry-transaction' using errcode='40001';end if;
 return true;
end $$;
create or replace function ship_dynamics_authority_private.assert_source_v1(p_workspace text,p_source text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c ship_dynamics_authority_private.current_v1%rowtype;
begin
 perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);
 select * into c from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace;
 if found then
  if not exists(select 1 from public.sd_workspaces where id=c.workspace_id and legacy_key=p_workspace) then raise exception 'source-authority-binding-mismatch' using errcode='55000';end if;
  if c.phase<>'resumed' then raise exception 'business-writes-paused' using errcode='55000';end if;
  if p_source is null or p_source not in (c.source,'neutral-formal') then raise exception 'source-authority-retired' using errcode='55000';end if;
 end if;
end $$;
create or replace function ship_dynamics_authority_private.operator_v1()
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'source-authority-service-required' using errcode='42501';end if;
 perform ship_dynamics_quiescence_private.operator_v1();
 if exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.granted and
  (l.locktype='advisory' or (l.locktype='relation' and l.mode<>'AccessShareLock' and l.relation in
   (select cl.oid from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname in ('public','ship_dynamics_quiescence_private','ship_dynamics_authority_private'))))) then
  raise exception 'source-authority-fresh-transaction-required' using errcode='25001';end if;
 perform ship_dynamics_quiescence_private.drain_v1();
end $$;
-- Pin the frozen target against old ungated maintenance operators without
-- reversing WAIT order. Both controls acquire these before reading the proof.
create or replace function ship_dynamics_authority_private.lock_target_v1(p_workspace text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended(p_workspace,731921)) then raise exception 'source-authority-retry-transaction' using errcode='40001';end if;
 begin
  perform 1 from public.sd_legacy_write_controls where workspace_key=p_workspace for update nowait;
  perform 1 from public.ship_dynamics_app_state where workspace_key=p_workspace for update nowait;
 exception when lock_not_available then raise exception 'source-authority-retry-transaction' using errcode='40001';end;
end $$;
create or replace function ship_dynamics_authority_private.binding_v1(p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare s ship_dynamics_quiescence_private.stages_v1%rowtype;c record;f jsonb;r jsonb;l jsonb;
begin
 select * into s from ship_dynamics_quiescence_private.stages_v1 where request_id=p_stage;
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id) where workspace_key=p_workspace;
 if s.request_id is null or s.workspace_key is distinct from p_workspace or s.transition_id is distinct from p_transition
  or s.result is distinct from p_result or c.workspace_id is distinct from p_workspace_id or c.transition_id is distinct from p_transition
  or c.state is distinct from 'paused' or c.watermark is distinct from s.request->'watermark'
  or s.result->>'requestSha256' is distinct from public.sd_legacy_jsonb_sha256(s.request)
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from s.staged_watermark then
  raise exception 'source-authority-stage-binding-mismatch' using errcode='55000';end if;
 select to_jsonb(x) into f from public.sd_legacy_write_controls x where workspace_key=p_workspace;
 select to_jsonb(x) into l from public.ship_dynamics_app_state x where workspace_key=p_workspace;
 r:=public.read_ship_dynamics_records_v1(p_workspace);
 if f->'writes_frozen' is distinct from 'true'::jsonb or f->'restore_in_progress' is distinct from 'false'::jsonb
  or (f->>'frozen_at')::timestamptz is distinct from (s.request->>'frozenAt')::timestamptz
  or (f->>'expected_revision')::integer is distinct from (s.result->>'targetRevision')::integer
  or f->>'payload_sha256' is distinct from s.result->>'targetSha256'
  or (l->>'revision')::integer is distinct from (s.result->>'targetRevision')::integer
  or public.sd_legacy_jsonb_sha256(l->'payload') is distinct from s.result->>'targetSha256'
  or (r->>'revision')::integer is distinct from (s.result->>'sourceRevision')::integer
  or public.sd_legacy_jsonb_sha256(r->'payload') is distinct from s.result->>'sourceSha256' then
  raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 return jsonb_build_object('stage',to_jsonb(s),'freeze',f);
end $$;
create or replace function public.publish_ship_dynamics_source_authority_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_stage_result jsonb,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;v_binding jsonb;v_result jsonb;v_epoch bigint;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_stage is null or p_request_id is null or jsonb_typeof(p_stage_result) is distinct from 'object' then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'stageId',p_stage,'stageResult',p_stage_result,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor is distinct from session_user or prev.action<>'publish' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result);
 -- This bounded reverse has only records -> legacy ownership. It cannot recycle
 -- a later pause into another stale records publication after target progress.
 if exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace) then raise exception 'source-authority-already-managed' using errcode='55000';end if;
 v_epoch:=1;
 v_result:=jsonb_build_object('state','published-paused','workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_request_id,'stageId',p_stage,'source','legacy','epoch',v_epoch);
 insert into ship_dynamics_authority_private.current_v1 values(p_workspace,p_workspace_id,v_epoch,'legacy',p_request_id,p_transition,'published-paused');
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'publish',req,v_result,v_binding);
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id and actor=session_user and action='publish' and request=req and receipts_v1.result=v_result and receipts_v1.binding=v_binding)
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and epoch=v_epoch and source='legacy' and publication_id=p_request_id and transition_id=p_transition and phase='published-paused')
  or ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result) is distinct from v_binding then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
create or replace function public.resume_ship_dynamics_legacy_authority_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_publication uuid,p_publication_result jsonb,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;pub ship_dynamics_authority_private.receipts_v1%rowtype;v_result jsonb;v_binding jsonb;ctl jsonb;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_publication is null or p_request_id is null or jsonb_typeof(p_publication_result) is distinct from 'object' then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_publication,'publicationResult',p_publication_result,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor is distinct from session_user or prev.action<>'resume' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 select * into pub from ship_dynamics_authority_private.receipts_v1 where request_id=p_publication;
 if pub.action is distinct from 'publish' or pub.result is distinct from p_publication_result
  or pub.request->>'workspace' is distinct from p_workspace or pub.request->>'workspaceId' is distinct from p_workspace_id::text or pub.request->>'transition' is distinct from p_transition::text
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and transition_id=p_transition and publication_id=p_publication and phase='published-paused' and source='legacy' and epoch=(pub.result->>'epoch')::bigint) then raise exception 'source-authority-publication-mismatch' using errcode='55000';end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,(pub.request->>'stageId')::uuid,pub.request->'stageResult');
 if v_binding is distinct from pub.binding then raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 update public.sd_legacy_write_controls set writes_frozen=false,updated_at=clock_timestamp() where workspace_key=p_workspace;
 update ship_dynamics_quiescence_private.transitions set state='resumed' where workspace_key=p_workspace and transition_id=p_transition;
 update ship_dynamics_authority_private.current_v1 set phase='resumed' where workspace_key=p_workspace;
 v_result:=p_publication_result||jsonb_build_object('state','resumed','resumeId',p_request_id);
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'resume',req,v_result,v_binding);
 select to_jsonb(c) into ctl from public.sd_legacy_write_controls c where workspace_key=p_workspace;
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id and actor=session_user and action='resume' and request=req and receipts_v1.result=v_result and receipts_v1.binding=v_binding)
  or (ctl-'writes_frozen'-'updated_at') is distinct from ((v_binding->'freeze')-'writes_frozen'-'updated_at') or ctl->'writes_frozen' is distinct from 'false'::jsonb
  or not exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace and transition_id=p_transition and state='resumed' and watermark=v_binding->'stage'->'request'->'watermark')
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and publication_id=p_publication and transition_id=p_transition and phase='resumed' and source='legacy' and epoch=(pub.result->>'epoch')::bigint)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from v_binding->'stage'->'staged_watermark' then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
create or replace function public.read_ship_dynamics_source_authority_v1(p_workspace text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c record;
begin
 perform ship_dynamics_quiescence_private.operator_v1();
 select a.*,t.state into c from ship_dynamics_authority_private.current_v1 a join ship_dynamics_quiescence_private.workspaces w using(workspace_key) join ship_dynamics_quiescence_private.transitions t on t.workspace_key=w.workspace_key and t.transition_id=w.transition_id where a.workspace_key=p_workspace;
 if not found then return jsonb_build_object('managed',false,'workspace',p_workspace);end if;
 return jsonb_build_object('managed',true,'workspace',c.workspace_key,'workspaceId',c.workspace_id,'source',c.source,'epoch',c.epoch,'publicationId',c.publication_id,'publicationPhase',c.phase,'pauseState',c.state,'admitted',c.phase='resumed' and c.state='resumed');
end $$;

-- Source-checked extensions; original OIDs/signatures/ACLs and business bodies.
-- Records fan-in deliberately excludes the private lease-only copied gate.
select ship_dynamics_quiescence_private.splice_terminal_v1('public.ship_dynamics_record_writer_gate_v1(text,boolean)'::regprocedure,
 '  perform ship_dynamics_quiescence_private.assert_write_v1(p_workspace);',
 E'  -- authority_records_gate_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace,''records-v1'');\n','-- authority_records_gate_v1');
-- Base pause reapplication derives its lease copy from the current public
-- writer. Strip precisely our business-only insertion from that private copy.
do $$
declare def text;injected text:=E'  -- authority_records_gate_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace,''records-v1'');\n';
begin
 def:=pg_get_functiondef('ship_dynamics_quiescence_private.lease_writer_gate_v1(text,boolean)'::regprocedure);
 if position(injected in def)>0 then execute replace(def,injected,'');
 elsif position('ship_dynamics_authority_private.assert_source_v1' in def)>0 then raise exception 'source-authority-lease-copy-mismatch';end if;
end $$;
-- Direct legacy fallback: source ownership is known for this aggregate only.
select ship_dynamics_quiescence_private.splice_terminal_v1('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 '   perform ship_dynamics_quiescence_private.assert_write_v1(k);',
 E'   -- authority_legacy_row_v1\n   if TG_TABLE_NAME in (''ship_dynamics_app_state'',''ship_dynamics_app_revisions'',''ship_dynamics_block_operations'',''ship_dynamics_data_management_operations'') then perform ship_dynamics_authority_private.assert_source_v1(k,''legacy'');end if;\n','-- authority_legacy_row_v1');
-- These are exclusively the record representation, NOT the shared formal
-- tables. Keep a physical backstop for maintenance/direct-owner misuse too.
select ship_dynamics_quiescence_private.splice_terminal_v1('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 '   perform ship_dynamics_quiescence_private.assert_write_v1(k);',
 E'   -- authority_record_row_v1\n   if TG_TABLE_NAME in (''ship_dynamics_record_workspaces'',''ship_dynamics_record_collections'',''ship_dynamics_records'',''ship_dynamics_record_receipts'',''ship_dynamics_record_versions'',''ship_dynamics_record_history'',''ship_dynamics_record_task_progress'',''ship_dynamics_record_task_progress_history'',''ship_dynamics_record_prune_operations'') then perform ship_dynamics_authority_private.assert_source_v1(k,''records-v1'');end if;\n','-- authority_record_row_v1');
-- Fresh staging must never overwrite progressed managed legacy. Historical stage
-- lookup above this anchor retains the original stricter paused/hash contract.
select ship_dynamics_quiescence_private.splice_terminal_v1('public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid)'::regprocedure,
 ' if exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where workspace_key=p_workspace and transition_id=p_transition)',
 E' -- authority_no_stale_stage_v1\n if exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace) then raise exception ''source-authority-retired'' using errcode=''55000'';end if;\n','-- authority_no_stale_stage_v1');

-- Mode-specific reports retain their original terminal branches and their
-- intentionally different record-actor initialization / legacy replay policies.
do $$
declare fn regprocedure;mode text;actor text;needle text;
begin
 for fn,mode in select f::regprocedure,m from (values
 ('public.sd_itinerary_record_report_save_manual_v1(text,text,uuid)','records-v1'),
 ('public.sd_itinerary_record_report_delete_ids_v1(text,text,uuid,text,jsonb)','records-v1'),
 ('public.sd_itinerary_record_report_delete_dates_v1(text,text,uuid,text,jsonb)','records-v1'),
 ('public.sd_save_manual_itinerary_report(text,text,uuid)','legacy'),
 ('public.delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)','legacy'),
 ('public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)','legacy')) x(f,m) loop
  perform ship_dynamics_quiescence_private.splice_terminal_v1(fn,E'declare\n',E'-- authority_report_lock_v1\n','-- authority_report_lock_v1');
  -- Insert initialization immediately after DECLARE without altering actor code.
  perform ship_dynamics_quiescence_private.splice_terminal_v1(fn,'  v_actor jsonb',E'  authority_gate boolean := ship_dynamics_authority_private.gate_v1(); -- authority_report_admission_lock_v1\n','-- authority_report_admission_lock_v1');
  needle:=case when mode='records-v1' then '  v_actor_workspace_id := nullif(v_actor' else '  v_actor := public.sd_itinerary_main_actor' end;
  actor:=case when mode='records-v1' then E'  v_actor := public.sd_itinerary_record_actor_v1(p_workspace_key,p_actor_user_id);\n' else '' end;
  perform ship_dynamics_quiescence_private.splice_terminal_v1(fn,needle,format(E'  -- authority_report_new_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,%L);\n%s',mode,actor),'-- authority_report_new_v1');
 end loop;
end $$;

-- Shared formal core gets installation-derived private route variants rather
-- than a caller-set GUC/source parameter. The same original replay/CAS/lease/
-- actor/business statements execute. No persistent or forgeable entry context.
do $$
declare def text;copy text;mode text;route text;fn regprocedure;needle text;
begin
 def:=pg_get_functiondef('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'::regprocedure);
 -- Remove only our own admission insertion when reapplying the extension.
 def:=replace(def,E'  -- authority_core_new_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,NULL);\n','');
 needle:='  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text||'':itinerary:''||p_vessel_id,0));';
 if length(def)-length(replace(def,needle,''))<>length(needle) then raise exception 'source-authority-core-source-mismatch';end if;
 for mode,route in select * from (values('records-v1','record'),('legacy','legacy'),('neutral-formal','public')) x(m,r) loop
  copy:=replace(def,'public.sd_itinerary_save_internal(','ship_dynamics_authority_private.itinerary_'||route||'_v1(');
  copy:=replace(copy,needle,format(E'  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,%L);\n',mode)||needle);
  execute copy;
 end loop;
 -- Unclassified direct core calls may recover terminal outcomes but cannot
 -- introduce managed writes. Public-vessel wrappers explicitly choose neutral.
 execute replace(def,needle,E'  -- authority_core_new_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,NULL);\n'||needle);
 for fn,route in select f::regprocedure,r from (values
 ('public.sd_itinerary_record_save_v1(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','record'),
 ('public.sd_itinerary_main_save(text,text,bigint,uuid,jsonb,uuid,text,bigint,text,text,jsonb)','legacy'),
 ('public.sd_itinerary_save_public(text,text,bigint,uuid,jsonb,uuid,text,text,bigint,jsonb)','public')) x(f,r) loop
  copy:=pg_get_functiondef(fn);
  if position('ship_dynamics_authority_private.itinerary_'||route||'_v1(' in copy)=0 then
   if length(copy)-length(replace(copy,'public.sd_itinerary_save_internal(',''))<>length('public.sd_itinerary_save_internal(') then raise exception 'source-authority-wrapper-source-mismatch';end if;
   copy:=replace(copy,'public.sd_itinerary_save_internal(','ship_dynamics_authority_private.itinerary_'||route||'_v1(');
   -- Gate before DECLARE actor/authorization evaluation, never on actor helpers.
   -- pg_get_functiondef preserves the installed body's LF/CRLF representation.
   -- Match that exact declaration only; do not normalize business string bytes.
   needle:=case when position(E'declare\n' in copy)>0 then E'declare\n' else E'declare\r\n' end;
   if length(copy)-length(replace(copy,needle,''))<>length(needle) then raise exception 'source-authority-wrapper-declaration-mismatch';end if;
   copy:=replace(copy,needle,needle||'  authority_gate boolean := ship_dynamics_authority_private.gate_v1(); -- authority_wrapper_lock_v1'||substring(needle from 8));
   if position('-- authority_wrapper_lock_v1' in copy)=0 then raise exception 'source-authority-wrapper-declaration-mismatch';end if;
   execute copy;
  end if;
 end loop;
end $$;
-- The separate Auth/rollout office endpoint is formal-store-only, not the
-- original-App legacy main actor route. Preserve its existing auth/permissions
-- and classify that explicit entry as neutral, rather than its 'office' label.
do $$
declare def text;copy text;needle text:='public.sd_itinerary_save_internal(';
begin
 def:=pg_get_functiondef('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint)'::regprocedure);
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>2 then raise exception 'source-authority-neutral-overload-mismatch';end if;
 execute replace(def,needle,'ship_dynamics_authority_private.itinerary_public_v1(');
 def:=pg_get_functiondef('public.sd_itinerary_save_office(text,text,bigint,uuid,jsonb,uuid,text,bigint,text)'::regprocedure);
 if position('-- authority_office_neutral_v1' in def)=0 then
  if length(def)-length(replace(def,needle,''))<>length(needle) or position('declare v_workspace uuid:=' in def)=0 then raise exception 'source-authority-office-source-mismatch';end if;
  copy:=replace(def,needle,'ship_dynamics_authority_private.itinerary_public_v1(');
  copy:=replace(copy,'declare v_workspace uuid:=',E'declare authority_gate boolean := ship_dynamics_authority_private.gate_v1(); -- authority_office_neutral_v1\n v_workspace uuid:=');
  execute copy;
 end if;
end $$;
select ship_dynamics_quiescence_private.splice_terminal_v1('public.prune_ship_dynamics_revision_history(text,text,uuid,jsonb,jsonb)'::regprocedure,
 E'  select * into current_row\n  from public.ship_dynamics_app_state',
 E'  -- authority_legacy_prune_v1\n  perform ship_dynamics_authority_private.assert_source_v1(p_workspace_key,''legacy'');\n','-- authority_legacy_prune_v1');
-- The legacy scheduled snapshot runner is optional and absent in the observed
-- production predecessor. Do not install/enable a new legacy scheduler here.
-- If present, it must receive the same authority guard; never silently skip drift.
do $legacy_scheduler$
begin
 if to_regprocedure('public.ship_dynamics_run_daily_morning_snapshots()') is not null then
  perform ship_dynamics_quiescence_private.splice_terminal_v1('public.ship_dynamics_run_daily_morning_snapshots()'::regprocedure,
   '    v_report_id := ''daily-morning-'' || v_business_date::text;',
   E'    -- authority_legacy_scheduler_v1\n    perform ship_dynamics_authority_private.assert_source_v1((select legacy_key from public.sd_workspaces where id=v_workspace.id),''legacy'');\n','-- authority_legacy_scheduler_v1');
 end if;
end $legacy_scheduler$;
-- Formal scheduled Itinerary uses UUID + formal documents only, no AppData
-- source actor. It remains neutral, protected by existing pause row guards.
revoke all on all functions in schema ship_dynamics_authority_private from public,anon,authenticated,service_role;
revoke all on function public.publish_ship_dynamics_source_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.resume_ship_dynamics_legacy_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.read_ship_dynamics_source_authority_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.publish_ship_dynamics_source_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.resume_ship_dynamics_legacy_authority_v1(text,uuid,uuid,uuid,jsonb,uuid),public.read_ship_dynamics_source_authority_v1(text) to service_role;
-- END COMPONENT: supabase/development/20260911_source_authority_publication.sql

-- BEGIN COMPONENT: supabase/development/20260912_browser_source_authority.sql
-- DEVELOPMENT ONLY. Install after source authority publication, before client.
-- Website-readable projection, NOT the privileged operator getter. No writes,
-- locks, initialization, payloads, operator identities or control receipts.

create or replace function public.read_ship_dynamics_browser_authority_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a ship_dynamics_authority_private.current_v1%rowtype;
 q ship_dynamics_quiescence_private.workspaces%rowtype;
 pause_state text; managed boolean;
begin
 if p_workspace_key is null or p_workspace_key='' or p_workspace_key<>btrim(p_workspace_key) then
  raise exception 'browser-authority-invalid-workspace' using errcode='22023';
 end if;
 -- Same website read boundary as existing workspace readers; exact key only.
 if not exists(select 1 from public.ship_dynamics_app_state where workspace_key=p_workspace_key)
  and not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key) then
  raise exception 'browser-authority-workspace-unavailable' using errcode='55000';
 end if;
 select * into a from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace_key;
 managed:=found;
 select * into q from ship_dynamics_quiescence_private.workspaces where workspace_key=p_workspace_key;
 if found then
  select state into pause_state from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace_key and transition_id=q.transition_id;
  if pause_state is null then raise exception 'browser-authority-invalid-control' using errcode='55000';end if;
 elsif exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace_key) then
  raise exception 'browser-authority-invalid-control' using errcode='55000';
 else pause_state:='unmanaged';end if;
 if managed and (a.epoch<>1 or a.source<>'legacy' or q.workspace_id is distinct from a.workspace_id
  or not exists(select 1 from public.sd_workspaces where id=a.workspace_id and legacy_key=p_workspace_key)
  or (a.phase='published-paused' and pause_state<>'paused')) then
  raise exception 'browser-authority-invalid-binding' using errcode='55000';
 end if;
 return jsonb_build_object('workspace',p_workspace_key,'managed',managed,
  'source',case when managed then a.source else null end,'epoch',case when managed then a.epoch else 0 end,
  'pauseState',pause_state,'admitted',pause_state<>'paused' and (not managed or a.phase='resumed'));
end $$;
revoke all on function public.read_ship_dynamics_browser_authority_v1(text) from public;
grant execute on function public.read_ship_dynamics_browser_authority_v1(text) to anon,authenticated,service_role;
-- END COMPONENT: supabase/development/20260912_browser_source_authority.sql

-- BEGIN COMPONENT: supabase/development/20260914_source_authority_roundtrip.sql
-- DEVELOPMENT ONLY. Idle install after pause, stage, authority and browser addons.
-- Exact local cutover materialization. No production handoff or browser write grant.

select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
create table if not exists ship_dynamics_authority_private.forward_stages_v1(
 request_id uuid primary key,workspace_key text not null,transition_id uuid not null,
 actor name not null,request jsonb not null,result jsonb not null,staged_watermark jsonb not null,
 unique(workspace_key,transition_id)
);
create table if not exists ship_dynamics_authority_private.forward_row_context_v1(
 backend integer primary key,transaction_id xid8 not null,actor name not null,
 table_oid oid not null,operation text not null,old_sha text,new_sha text,used boolean not null
);
revoke all on table ship_dynamics_authority_private.forward_stages_v1,ship_dynamics_authority_private.forward_row_context_v1 from public,anon,authenticated,service_role;

-- One exact row, transaction, session actor and table/verb; consumed before any
-- other trigger can attempt a second write. Never a broad service-role bypass.
create or replace function ship_dynamics_authority_private.forward_row_v1(t oid,op text,o jsonb,n jsonb)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare c ship_dynamics_authority_private.forward_row_context_v1%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then return false;end if;
 select * into c from ship_dynamics_authority_private.forward_row_context_v1 where backend=pg_backend_pid();
 if not found or c.transaction_id<>pg_current_xact_id() or c.actor<>session_user or c.used or c.table_oid<>t or c.operation<>op
  or c.old_sha is distinct from public.sd_legacy_jsonb_sha256(o) or c.new_sha is distinct from public.sd_legacy_jsonb_sha256(n) then return false;end if;
 update ship_dynamics_authority_private.forward_row_context_v1 set used=true where backend=c.backend;
 return true;
end $$;
select ship_dynamics_quiescence_private.splice_terminal_v1('ship_dynamics_quiescence_private.row_guard_v1()'::regprocedure,
 ' -- BOTH old and new identities are checked, including moves into/out of pause.',
 $add$ -- forward_exact_row_v1
 if ship_dynamics_authority_private.forward_row_v1(TG_RELID,TG_OP,
  case when TG_OP='INSERT' then null else to_jsonb(OLD) end,
  case when TG_OP='DELETE' then null else to_jsonb(NEW) end) then
  if TG_OP='DELETE' then return OLD;end if;return NEW;
 end if;
$add$,'-- forward_exact_row_v1');

-- Private, table-allowlisted materializer. Callers supply an in-memory plan
-- derived only from the frozen database source; there is no public payload API.
create or replace function ship_dynamics_authority_private.forward_apply_v1(t text,op text,o jsonb,n jsonb)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare keys text[];cols text;projection text;predicate text;affected bigint;
begin
 keys:=case t when 'ship_dynamics_record_workspaces' then array['workspace_key']
 when 'ship_dynamics_record_collections' then array['workspace_key','collection']
 when 'ship_dynamics_records' then array['workspace_key','collection','entity_id']
 when 'ship_dynamics_record_versions' then array['workspace_key','revision']
 when 'ship_dynamics_record_history' then array['workspace_key','collection','entity_id','valid_from_revision']
 when 'ship_dynamics_record_task_progress' then array['workspace_key','task_id','entry_id']
 when 'ship_dynamics_record_task_progress_history' then array['workspace_key','task_id','entry_id','valid_from_revision'] end;
 if keys is null or op not in ('INSERT','UPDATE','DELETE') or current_setting('role',true) is distinct from 'service_role'
  or not public.ship_dynamics_record_lock_held_v1(hashtext('record-maintenance-v1'),0,true) then raise exception 'forward-materializer-invalid' using errcode='55000';end if;
 select string_agg(format('%I',a.attname),',' order by a.attnum),string_agg(format('x.%I',a.attname),',' order by a.attnum)
 into cols,projection from pg_attribute a where a.attrelid=to_regclass('public.'||t) and a.attnum>0 and not a.attisdropped;
 select string_agg(format('d.%I=x.%I',k,k),' and ') into predicate from unnest(keys) k;
 insert into ship_dynamics_authority_private.forward_row_context_v1 values(pg_backend_pid(),pg_current_xact_id(),session_user,to_regclass('public.'||t),op,public.sd_legacy_jsonb_sha256(o),public.sd_legacy_jsonb_sha256(n),false);
 if op='INSERT' then execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) x',t,cols,projection,t) using n;
 elsif op='UPDATE' then execute format('update public.%I d set (%s)=(%s) from jsonb_populate_record(null::public.%I,$1) x where %s',t,cols,projection,t,predicate) using n;
 else execute format('delete from public.%I d using jsonb_populate_record(null::public.%I,$1) x where %s',t,t,predicate) using o;end if;
 get diagnostics affected=row_count;
 if affected<>1 or not exists(select 1 from ship_dynamics_authority_private.forward_row_context_v1 where backend=pg_backend_pid() and used) then raise exception 'forward-row-readback-mismatch' using errcode='55000';end if;
 delete from ship_dynamics_authority_private.forward_row_context_v1 where backend=pg_backend_pid();
end $$;

create or replace function public.stage_ship_dynamics_paused_legacy_to_records_v1(
 p_workspace text,p_workspace_id uuid,p_transition uuid,p_watermark jsonb,
 p_source_revision integer,p_source_sha256 text,p_target_revision integer,p_target_sha256 text,
 p_frozen_at timestamptz,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 req jsonb;prev ship_dynamics_authority_private.forward_stages_v1%rowtype;c record;authority jsonb;v_freeze jsonb;
 source public.ship_dynamics_app_state%rowtype;target public.ship_dynamics_record_workspaces%rowtype;
 names text[]:=array['users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'];
 mutable text[]:=array['ship_dynamics_record_workspaces','ship_dynamics_record_collections','ship_dynamics_records','ship_dynamics_record_versions','ship_dynamics_record_history','ship_dynamics_record_task_progress','ship_dynamics_record_task_progress_history'];
 name text;t text;item jsonb;ids jsonb;orders jsonb:='{}';seen jsonb;rows jsonb;expected jsonb:='{}';actual jsonb;
 nr integer;stamp timestamptz;stamp_text text;payload jsonb;next_root jsonb;row_new jsonb;row_old jsonb;mark jsonb;v_result jsonb;
 meta jsonb;slot text;progress jsonb:='[]';bodies jsonb:='[]';old_revision integer;plan jsonb:='[]';step jsonb;current_rows jsonb;desired jsonb;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_request_id is null
  or jsonb_typeof(p_watermark) is distinct from 'object' or p_source_revision is null or p_source_revision<0
  or coalesce(p_source_sha256,'')!~'^[0-9a-f]{64}$' or p_frozen_at is null
  or (p_target_revision is null)<>(p_target_sha256 is null) or p_target_revision<0
  or (p_target_sha256 is not null and p_target_sha256!~'^[0-9a-f]{64}$') then raise exception 'forward-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'watermark',p_watermark,'sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,'targetRevision',p_target_revision,'targetSha256',p_target_sha256,'frozenAt',p_frozen_at,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.forward_stages_v1 where request_id=p_request_id;
 if found then
  if prev.actor<>session_user or prev.request is distinct from req then raise exception 'forward-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id) where workspace_key=p_workspace;
 if c.workspace_id is distinct from p_workspace_id or c.transition_id is distinct from p_transition or c.state is distinct from 'paused' or c.watermark is distinct from p_watermark
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace) then raise exception 'forward-pause-binding-mismatch' using errcode='55000';end if;
 select to_jsonb(a) into authority from ship_dynamics_authority_private.current_v1 a where workspace_key=p_workspace;
 if authority is not null and (authority->>'source'<>'legacy' or authority->>'phase'<>'resumed') then raise exception 'source-authority-retired' using errcode='55000';end if;
 if exists(select 1 from ship_dynamics_quiescence_private.stages_v1 where workspace_key=p_workspace and transition_id=p_transition)
  or exists(select 1 from ship_dynamics_authority_private.forward_stages_v1 where workspace_key=p_workspace and transition_id=p_transition)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from p_watermark then raise exception 'forward-transition-changed' using errcode='55000';end if;
 perform public.sd_assert_legacy_freeze_boundary(p_workspace);
 select to_jsonb(f) into v_freeze from public.sd_legacy_write_controls f where workspace_key=p_workspace;
 select * into source from public.ship_dynamics_app_state where workspace_key=p_workspace;
 if source.revision is distinct from p_source_revision or public.sd_legacy_jsonb_sha256(source.payload) is distinct from p_source_sha256
  or (v_freeze->>'frozen_at')::timestamptz is distinct from p_frozen_at then raise exception 'forward-source-mismatch' using errcode='55000';end if;
 -- Global drain first; old ungated tuple holders fail without a reversed WAIT.
 foreach t in array mutable loop
  begin execute format('select 1 from public.%I where workspace_key=$1 for update nowait',t) using p_workspace;
  exception when lock_not_available then raise exception 'source-authority-retry-transaction' using errcode='40001';end;
 end loop;
 select * into target from public.ship_dynamics_record_workspaces where workspace_key=p_workspace;
 if target.revision is distinct from p_target_revision or (p_target_revision is not null and public.sd_legacy_jsonb_sha256(public.read_ship_dynamics_records_v1(p_workspace)->'payload') is distinct from p_target_sha256) then raise exception 'forward-target-mismatch' using errcode='55000';end if;
 if greatest(p_source_revision,coalesce(p_target_revision,0))=2147483647 then raise exception 'forward-revision-exhausted' using errcode='22023';end if;
 nr:=greatest(p_source_revision,coalesce(p_target_revision,0))+1;stamp:=date_trunc('milliseconds',clock_timestamp());stamp_text:=to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 payload:=source.payload||jsonb_build_object('revision',nr,'updatedAt',stamp_text);next_root:=payload-names;
 -- Validate complete ordered source before any materialization, preserving exact IDs.
 foreach name in array names loop
  if not(payload ? name) then continue;end if;
  if jsonb_typeof(payload->name) is distinct from 'array' then raise exception 'invalid-record-collection:%',name;end if;
  ids:='[]';seen:='[]';
  for item in select value from jsonb_array_elements(payload->name) loop
   if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id'='' or seen ? (item->>'id') then raise exception 'invalid-record-id:%',name;end if;
   ids:=ids||jsonb_build_array(item->'id');seen:=ids;meta:=null;
   if name='tasks' then
    if not(item ? 'vesselProgress') then meta:=jsonb_build_object('kind','absent');
    elsif jsonb_typeof(item->'vesselProgress')<>'array' then meta:=jsonb_build_object('kind','literal','value',item->'vesselProgress');
    else
     meta:=jsonb_build_object('kind','array','ids','[]'::jsonb);
     for row_new in select value from jsonb_array_elements(item->'vesselProgress') loop
      slot:=gen_random_uuid()::text;meta:=jsonb_set(meta,'{ids}',(meta->'ids')||jsonb_build_array(slot));
      progress:=progress||jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'task_id',item->>'id','entry_id',slot,'value',row_new,'revision',nr));
     end loop;
    end if;
   end if;
   bodies:=bodies||jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'collection',name,'entity_id',item->>'id','value',case when name='tasks' then item-'vesselProgress' else item end,'revision',nr,'task_progress_meta',meta));
  end loop;
  orders:=orders||jsonb_build_object(name,ids);
 end loop;
 -- Full table expectations retain all historical rows. Only current records and
 -- progress are rematerialized at a new revision; receipts/read bases stay intact.
 foreach t in array mutable loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where workspace_key=$1',t) into rows using p_workspace;
  expected:=expected||jsonb_build_object(t,rows);
 end loop;
 for row_old in select value from jsonb_array_elements(expected->'ship_dynamics_records') loop
  row_new:=(row_old-'revision')||jsonb_build_object('valid_from_revision',(row_old->>'revision')::integer,'valid_to_revision',nr);
  expected:=jsonb_set(expected,array['ship_dynamics_record_history'],(expected->'ship_dynamics_record_history')||jsonb_build_array(row_new));
 end loop;
 for row_old in select value from jsonb_array_elements(expected->'ship_dynamics_record_task_progress') loop
  row_new:=(row_old-'revision')||jsonb_build_object('valid_from_revision',(row_old->>'revision')::integer,'valid_to_revision',nr);
  expected:=jsonb_set(expected,array['ship_dynamics_record_task_progress_history'],(expected->'ship_dynamics_record_task_progress_history')||jsonb_build_array(row_new));
 end loop;
 expected:=jsonb_set(expected,'{ship_dynamics_records}',bodies);
 expected:=jsonb_set(expected,'{ship_dynamics_record_task_progress}',progress);
 select coalesce(jsonb_agg(jsonb_build_object('workspace_key',p_workspace,'collection',key,'ids',value)),'[]') into rows from jsonb_each(orders);
 expected:=jsonb_set(expected,'{ship_dynamics_record_collections}',rows);
 expected:=jsonb_set(expected,'{ship_dynamics_record_workspaces}',jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'root',next_root,'revision',nr,'updated_at',stamp,'updated_by',coalesce(source.updated_by,''),'import_token',md5(req::text))));
 expected:=jsonb_set(expected,'{ship_dynamics_record_versions}',(expected->'ship_dynamics_record_versions')||jsonb_build_array(jsonb_build_object('workspace_key',p_workspace,'revision',nr,'root',next_root,'orders',orders,'updated_at',stamp)));
 -- Archive old current data first, then remove only current rows, recreate exact
 -- active sets in FK order. History/receipt tables are never deleted or rewritten.
 foreach t in array array['ship_dynamics_record_history','ship_dynamics_record_task_progress_history'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from public.%I x where workspace_key=$1',t) into current_rows using p_workspace;
  for row_new in select value from jsonb_array_elements(expected->t) where not current_rows @> jsonb_build_array(value) loop perform ship_dynamics_authority_private.forward_apply_v1(t,'INSERT',null,row_new);end loop;
 end loop;
 foreach t in array array['ship_dynamics_records','ship_dynamics_record_task_progress','ship_dynamics_record_collections'] loop
  for row_old in execute format('select to_jsonb(x) from public.%I x where workspace_key=$1',t) using p_workspace loop perform ship_dynamics_authority_private.forward_apply_v1(t,'DELETE',row_old,null);end loop;
 end loop;
 perform ship_dynamics_authority_private.forward_apply_v1('ship_dynamics_record_workspaces',case when target.workspace_key is null then 'INSERT' else 'UPDATE' end,case when target.workspace_key is null then null else to_jsonb(target) end,expected->'ship_dynamics_record_workspaces'->0);
 foreach t in array array['ship_dynamics_record_collections','ship_dynamics_record_task_progress','ship_dynamics_records'] loop
  for row_new in select value from jsonb_array_elements(expected->t) loop perform ship_dynamics_authority_private.forward_apply_v1(t,'INSERT',null,row_new);end loop;
 end loop;
 perform ship_dynamics_authority_private.forward_apply_v1('ship_dynamics_record_versions','INSERT',null,expected->'ship_dynamics_record_versions'->-1);
 mark:=ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id);
 if (mark-mutable) is distinct from (p_watermark-mutable) then raise exception 'forward-independent-state-mismatch' using errcode='55000';end if;
 v_result:=jsonb_build_object('state','staged-paused','workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'requestId',p_request_id,'requestSha256',public.sd_legacy_jsonb_sha256(req),'source','legacy','target','records-v1','sourceRevision',p_source_revision,'sourceSha256',p_source_sha256,'targetRevision',nr,'targetSha256',public.sd_legacy_jsonb_sha256(payload),'previousAuthority',authority,'freeze',v_freeze);
 insert into ship_dynamics_authority_private.forward_stages_v1 values(p_request_id,p_workspace,p_transition,session_user,req,v_result,mark);
 -- Read all expected tables AFTER receipt and triggers; never derive the oracle
 -- from a tampered result. Exact logical payload comparison includes audit fields.
 foreach t in array mutable loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where workspace_key=$1',t) into actual using p_workspace;
  select coalesce(jsonb_agg(value order by value::text),'[]') into desired from jsonb_array_elements(expected->t);
  if actual is distinct from desired then raise exception 'forward-final-readback-mismatch:%',t using errcode='55000';end if;
 end loop;
 if public.read_ship_dynamics_records_v1(p_workspace)->'payload' is distinct from payload
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from mark
  or not exists(select 1 from ship_dynamics_authority_private.forward_stages_v1 f where f.request_id=p_request_id and f.request=req and f.result=v_result and f.staged_watermark=mark and f.actor=session_user)
  or (select to_jsonb(a) from ship_dynamics_authority_private.current_v1 a where workspace_key=p_workspace) is distinct from authority
  or (select to_jsonb(f) from public.sd_legacy_write_controls f where workspace_key=p_workspace) is distinct from v_freeze then raise exception 'forward-final-proof-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
-- Both sources share the already-installed admission fan-in. Preserve historical
-- v1 entrypoints; new transitions use v2 rather than rewriting old receipts.
alter table ship_dynamics_authority_private.current_v1 drop constraint if exists current_v1_source_check;
alter table ship_dynamics_authority_private.current_v1 add constraint current_v1_source_check check(source in ('legacy','records-v1'));
alter table ship_dynamics_authority_private.current_v1 drop constraint if exists current_v1_epoch_browser_check;
alter table ship_dynamics_authority_private.current_v1 add constraint current_v1_epoch_browser_check check(epoch<=9007199254740991);
do $$
declare def text;old text:=E' if exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace) then raise exception ''source-authority-retired'' using errcode=''55000'';end if;';
 replacement text:=E' if exists(select 1 from ship_dynamics_authority_private.current_v1 ca where ca.workspace_key=p_workspace and (ca.source<>''records-v1'' or ca.phase<>''resumed'')) then raise exception ''source-authority-retired'' using errcode=''55000'';end if;\n if exists(select 1 from ship_dynamics_authority_private.forward_stages_v1 where workspace_key=p_workspace and transition_id=p_transition) then raise exception ''forward-transition-changed'' using errcode=''55000'';end if; -- authority_roundtrip_stage_v1';
begin
 def:=pg_get_functiondef('public.stage_ship_dynamics_paused_records_to_legacy_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid)'::regprocedure);
 if position('-- authority_roundtrip_stage_v1' in def)>0 then
  if position(replacement in def)=0 then raise exception 'roundtrip-install-source-mismatch';end if;
 elsif (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'roundtrip-install-source-mismatch';
 else execute replace(def,old,replacement);end if;
end $$;

create or replace function ship_dynamics_authority_private.binding_v2(p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_result jsonb,p_target text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare s ship_dynamics_authority_private.forward_stages_v1%rowtype;c record;f jsonb;l jsonb;r jsonb;
begin
 if p_target='legacy' then return ship_dynamics_authority_private.binding_v1(p_workspace,p_workspace_id,p_transition,p_stage,p_result);end if;
 if p_target is distinct from 'records-v1' then raise exception 'source-authority-invalid-target' using errcode='22023';end if;
 select * into s from ship_dynamics_authority_private.forward_stages_v1 where request_id=p_stage;
 select w.*,t.state,t.watermark into c from ship_dynamics_quiescence_private.workspaces w join ship_dynamics_quiescence_private.transitions t using(workspace_key,transition_id) where workspace_key=p_workspace;
 if s.request_id is null or s.workspace_key is distinct from p_workspace or s.transition_id is distinct from p_transition or s.result is distinct from p_result
  or c.workspace_id is distinct from p_workspace_id or c.transition_id is distinct from p_transition or c.state is distinct from 'paused'
  or c.watermark is distinct from s.request->'watermark' or s.result->>'requestSha256' is distinct from public.sd_legacy_jsonb_sha256(s.request)
  or not exists(select 1 from public.sd_workspaces where id=p_workspace_id and legacy_key=p_workspace)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from s.staged_watermark then raise exception 'source-authority-stage-binding-mismatch' using errcode='55000';end if;
 select to_jsonb(x) into f from public.sd_legacy_write_controls x where workspace_key=p_workspace;
 select to_jsonb(x) into l from public.ship_dynamics_app_state x where workspace_key=p_workspace;
 r:=public.read_ship_dynamics_records_v1(p_workspace);
 if f is distinct from s.result->'freeze' or f->'writes_frozen' is distinct from 'true'::jsonb or f->'restore_in_progress' is distinct from 'false'::jsonb
  or (l->>'revision')::integer is distinct from (s.result->>'sourceRevision')::integer or public.sd_legacy_jsonb_sha256(l->'payload') is distinct from s.result->>'sourceSha256'
  or (r->>'revision')::integer is distinct from (s.result->>'targetRevision')::integer or public.sd_legacy_jsonb_sha256(r->'payload') is distinct from s.result->>'targetSha256' then raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 return jsonb_build_object('stage',to_jsonb(s),'freeze',f);
end $$;

create or replace function public.publish_ship_dynamics_source_authority_v2(p_workspace text,p_workspace_id uuid,p_transition uuid,p_stage uuid,p_stage_result jsonb,p_target text,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;prior ship_dynamics_authority_private.current_v1%rowtype;v_binding jsonb;v_result jsonb;v_epoch bigint;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_stage is null or p_request_id is null
  or jsonb_typeof(p_stage_result) is distinct from 'object' or p_target is null or p_target not in ('legacy','records-v1') then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'stageId',p_stage,'stageResult',p_stage_result,'target',p_target,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor<>session_user or prev.action<>'publish-v2' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v2(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result,p_target);
 select * into prior from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace;
 if found and (prior.workspace_id is distinct from p_workspace_id or prior.source=p_target or prior.phase<>'resumed' or prior.transition_id=p_transition) then raise exception 'source-authority-transition-mismatch' using errcode='55000';end if;
 if p_target='records-v1' and nullif(p_stage_result->'previousAuthority','null'::jsonb) is distinct from (case when prior.workspace_key is null then null else to_jsonb(prior) end) then raise exception 'source-authority-transition-mismatch' using errcode='55000';end if;
 if coalesce(prior.epoch,0)>=9007199254740991 then raise exception 'source-authority-epoch-exhausted' using errcode='22023';end if;
 v_epoch:=coalesce(prior.epoch,0)+1;
 v_result:=jsonb_build_object('state','published-paused','workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_request_id,'stageId',p_stage,'source',p_target,'epoch',v_epoch);
 insert into ship_dynamics_authority_private.current_v1 values(p_workspace,p_workspace_id,v_epoch,p_target,p_request_id,p_transition,'published-paused')
 on conflict(workspace_key) do update set epoch=excluded.epoch,source=excluded.source,publication_id=excluded.publication_id,transition_id=excluded.transition_id,phase=excluded.phase;
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'publish-v2',req,v_result,v_binding);
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 x where request_id=p_request_id and actor=session_user and action='publish-v2' and request=req and x.result=v_result and x.binding=v_binding)
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and epoch=v_epoch and source=p_target and publication_id=p_request_id and transition_id=p_transition and phase='published-paused')
  or ship_dynamics_authority_private.binding_v2(p_workspace,p_workspace_id,p_transition,p_stage,p_stage_result,p_target) is distinct from v_binding then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;

create or replace function public.resume_ship_dynamics_source_authority_v2(p_workspace text,p_workspace_id uuid,p_transition uuid,p_publication uuid,p_publication_result jsonb,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare req jsonb;prev ship_dynamics_authority_private.receipts_v1%rowtype;pub ship_dynamics_authority_private.receipts_v1%rowtype;v_binding jsonb;v_result jsonb;ctl jsonb;target text;
begin
 perform ship_dynamics_authority_private.operator_v1();
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or p_workspace_id is null or p_transition is null or p_publication is null or p_request_id is null or jsonb_typeof(p_publication_result) is distinct from 'object' then raise exception 'source-authority-invalid-request' using errcode='22023';end if;
 req:=jsonb_build_object('workspace',p_workspace,'workspaceId',p_workspace_id,'transition',p_transition,'publicationId',p_publication,'publicationResult',p_publication_result,'requestId',p_request_id);
 select * into prev from ship_dynamics_authority_private.receipts_v1 where request_id=p_request_id;
 if found then
  if prev.actor<>session_user or prev.action<>'resume-v2' or prev.request is distinct from req then raise exception 'source-authority-replay-mismatch' using errcode='55000';end if;
  return prev.result;
 end if;
 select * into pub from ship_dynamics_authority_private.receipts_v1 where request_id=p_publication;target:=pub.result->>'source';
 if pub.action is distinct from 'publish-v2' or pub.result is distinct from p_publication_result or pub.request->>'workspace' is distinct from p_workspace
  or pub.request->>'workspaceId' is distinct from p_workspace_id::text or pub.request->>'transition' is distinct from p_transition::text
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and transition_id=p_transition and publication_id=p_publication and phase='published-paused' and source=target and epoch=(pub.result->>'epoch')::bigint) then raise exception 'source-authority-publication-mismatch' using errcode='55000';end if;
 perform ship_dynamics_authority_private.lock_target_v1(p_workspace);
 v_binding:=ship_dynamics_authority_private.binding_v2(p_workspace,p_workspace_id,p_transition,(pub.request->>'stageId')::uuid,pub.request->'stageResult',target);
 if v_binding is distinct from pub.binding then raise exception 'source-authority-proof-mismatch' using errcode='55000';end if;
 if target='legacy' then update public.sd_legacy_write_controls set writes_frozen=false,updated_at=clock_timestamp() where workspace_key=p_workspace;end if;
 update ship_dynamics_quiescence_private.transitions set state='resumed' where workspace_key=p_workspace and transition_id=p_transition;
 update ship_dynamics_authority_private.current_v1 set phase='resumed' where workspace_key=p_workspace;
 v_result:=p_publication_result||jsonb_build_object('state','resumed','resumeId',p_request_id);
 insert into ship_dynamics_authority_private.receipts_v1 values(p_request_id,session_user,'resume-v2',req,v_result,v_binding);
 select to_jsonb(c) into ctl from public.sd_legacy_write_controls c where workspace_key=p_workspace;
 if not exists(select 1 from ship_dynamics_authority_private.receipts_v1 x where request_id=p_request_id and actor=session_user and action='resume-v2' and request=req and x.result=v_result and x.binding=v_binding)
  or (target='records-v1' and ctl is distinct from v_binding->'freeze')
  or (target='legacy' and ((ctl-'writes_frozen'-'updated_at') is distinct from ((v_binding->'freeze')-'writes_frozen'-'updated_at') or ctl->'writes_frozen' is distinct from 'false'::jsonb))
  or not exists(select 1 from ship_dynamics_quiescence_private.transitions where workspace_key=p_workspace and transition_id=p_transition and state='resumed' and watermark=v_binding->'stage'->'request'->'watermark')
  or not exists(select 1 from ship_dynamics_authority_private.current_v1 where workspace_key=p_workspace and workspace_id=p_workspace_id and publication_id=p_publication and transition_id=p_transition and phase='resumed' and source=target and epoch=(pub.result->>'epoch')::bigint)
  or ship_dynamics_quiescence_private.watermark_v1(p_workspace,p_workspace_id) is distinct from v_binding->'stage'->'staged_watermark' then raise exception 'source-authority-final-readback-mismatch' using errcode='55000';end if;
 return v_result;
end $$;
-- Literal source-checked browser projection change, no new fields or grants.
do $$
declare def text;old text:='a.epoch<>1 or a.source<>''legacy''';replacement text:='a.epoch<1 or a.epoch>9007199254740991 or a.source not in (''legacy'',''records-v1'')';
begin
 def:=pg_get_functiondef('public.read_ship_dynamics_browser_authority_v1(text)'::regprocedure);
 if position(replacement in def)>0 then null;
 elsif (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'roundtrip-browser-source-mismatch';
 else execute replace(def,old,replacement);end if;
end $$;
revoke all on function public.publish_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,text,uuid),public.resume_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.publish_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,text,uuid),public.resume_ship_dynamics_source_authority_v2(text,uuid,uuid,uuid,jsonb,uuid) to service_role;
revoke all on all functions in schema ship_dynamics_authority_private from public,anon,authenticated,service_role;
revoke all on function public.stage_ship_dynamics_paused_legacy_to_records_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.stage_ship_dynamics_paused_legacy_to_records_v1(text,uuid,uuid,jsonb,integer,text,integer,text,timestamptz,uuid) to service_role;
-- END COMPONENT: supabase/development/20260914_source_authority_roundtrip.sql

-- Keep new implementation functions and data private. Original 27 browser APIs
-- retain their predecessor grants. Only the explicit new entrypoints below open.
DO $release_private$
DECLARE f record;t record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname ~ '^(ship_dynamics_|sd_|read_ship_|get_ship_|apply_ship_|save_ship_|renew_ship_|release_ship_|prune_ship_|import_ship_|pause_ship_|resume_ship_|stage_ship_|publish_ship_)'
  AND NOT EXISTS(SELECT FROM pg_temp.release_existing_functions old WHERE old.oid=p.oid) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
 FOR t IN SELECT c.oid::regclass AS relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ '^(ship_dynamics_|sd_)'
  AND NOT EXISTS(SELECT FROM pg_temp.release_existing_rows old WHERE old.relation=c.oid) LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t.relation);
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated',t.relation);
 END LOOP;
END $release_private$;
ALTER FUNCTION public.apply_ship_dynamics_record_patch_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.apply_ship_dynamics_record_patch_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.apply_ship_dynamics_record_patch_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ship_dynamics_record_patch_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) TO anon,authenticated;
ALTER FUNCTION public.get_ship_dynamics_record_receipt_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.get_ship_dynamics_record_receipt_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.get_ship_dynamics_record_receipt_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ship_dynamics_record_receipt_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb) TO anon,authenticated;
ALTER FUNCTION public.get_ship_dynamics_record_storage_stats_v1(text, text) SECURITY DEFINER;
ALTER FUNCTION public.get_ship_dynamics_record_storage_stats_v1(text, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.get_ship_dynamics_record_storage_stats_v1(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ship_dynamics_record_storage_stats_v1(text, text) TO anon,authenticated;
ALTER FUNCTION public.get_ship_dynamics_task_member_receipt_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.get_ship_dynamics_task_member_receipt_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.get_ship_dynamics_task_member_receipt_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ship_dynamics_task_member_receipt_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) TO anon,authenticated;
ALTER FUNCTION public.prune_ship_dynamics_record_revision_history_v1(text, text, uuid, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.prune_ship_dynamics_record_revision_history_v1(text, text, uuid, jsonb, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.prune_ship_dynamics_record_revision_history_v1(text, text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_ship_dynamics_record_revision_history_v1(text, text, uuid, jsonb, jsonb) TO anon,authenticated;
ALTER FUNCTION public.read_ship_dynamics_browser_authority_v1(text) SECURITY DEFINER;
ALTER FUNCTION public.read_ship_dynamics_browser_authority_v1(text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.read_ship_dynamics_browser_authority_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ship_dynamics_browser_authority_v1(text) TO anon,authenticated;
ALTER FUNCTION public.read_ship_dynamics_record_delta_v1(text, integer, text) SECURITY DEFINER;
ALTER FUNCTION public.read_ship_dynamics_record_delta_v1(text, integer, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.read_ship_dynamics_record_delta_v1(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ship_dynamics_record_delta_v1(text, integer, text) TO anon,authenticated;
ALTER FUNCTION public.read_ship_dynamics_record_scopes_v1(text, text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.read_ship_dynamics_record_scopes_v1(text, text, jsonb, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.read_ship_dynamics_record_scopes_v1(text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ship_dynamics_record_scopes_v1(text, text, jsonb, jsonb) TO anon,authenticated;
ALTER FUNCTION public.read_ship_dynamics_records_v1(text) SECURITY DEFINER;
ALTER FUNCTION public.read_ship_dynamics_records_v1(text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.read_ship_dynamics_records_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ship_dynamics_records_v1(text) TO anon,authenticated;
ALTER FUNCTION public.read_ship_dynamics_task_member_v1(text, text, text, text) SECURITY DEFINER;
ALTER FUNCTION public.read_ship_dynamics_task_member_v1(text, text, text, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.read_ship_dynamics_task_member_v1(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_ship_dynamics_task_member_v1(text, text, text, text) TO anon,authenticated;
ALTER FUNCTION public.release_ship_dynamics_task_member_lock_v1(text, text, text, text) SECURITY DEFINER;
ALTER FUNCTION public.release_ship_dynamics_task_member_lock_v1(text, text, text, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.release_ship_dynamics_task_member_lock_v1(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_ship_dynamics_task_member_lock_v1(text, text, text, text) TO anon,authenticated;
ALTER FUNCTION public.renew_ship_dynamics_task_member_lock_v1(text, text, text, text, integer) SECURITY DEFINER;
ALTER FUNCTION public.renew_ship_dynamics_task_member_lock_v1(text, text, text, text, integer) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.renew_ship_dynamics_task_member_lock_v1(text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_ship_dynamics_task_member_lock_v1(text, text, text, text, integer) TO anon,authenticated;
ALTER FUNCTION public.save_ship_dynamics_task_member_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.save_ship_dynamics_task_member_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.save_ship_dynamics_task_member_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_ship_dynamics_task_member_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_claim_lease_v1(text, text, text, text, integer, text) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_claim_lease_v1(text, text, text, text, integer, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_claim_lease_v1(text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_claim_lease_v1(text, text, text, text, integer, text) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_load_many_v1(text, text[], text) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_load_many_v1(text, text[], text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_load_many_v1(text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_load_many_v1(text, text[], text) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_operation_status_v1(text, uuid, text) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_operation_status_v1(text, uuid, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_operation_status_v1(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_operation_status_v1(text, uuid, text) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_release_lease_v1(text, text, uuid, text, bigint, text) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_release_lease_v1(text, text, uuid, text, bigint, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_release_lease_v1(text, text, uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_release_lease_v1(text, text, uuid, text, bigint, text) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_renew_lease_v1(text, text, uuid, text, bigint, integer, text) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_renew_lease_v1(text, text, uuid, text, bigint, integer, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_renew_lease_v1(text, text, uuid, text, bigint, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_renew_lease_v1(text, text, uuid, text, bigint, integer, text) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_report_delete_dates_v1(text, text, uuid, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_report_delete_dates_v1(text, text, uuid, text, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_report_delete_dates_v1(text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_report_delete_dates_v1(text, text, uuid, text, jsonb) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_report_delete_ids_v1(text, text, uuid, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_report_delete_ids_v1(text, text, uuid, text, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_report_delete_ids_v1(text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_report_delete_ids_v1(text, text, uuid, text, jsonb) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_report_list_v1(text, text, integer, integer) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_report_list_v1(text, text, integer, integer) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_report_list_v1(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_report_list_v1(text, text, integer, integer) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_report_load_v1(text, bigint, text) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_report_load_v1(text, bigint, text) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_report_load_v1(text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_report_load_v1(text, bigint, text) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_report_locate_v1(text, date, text, integer) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_report_locate_v1(text, date, text, integer) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_report_locate_v1(text, date, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_report_locate_v1(text, date, text, integer) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_report_save_manual_v1(text, text, uuid) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_report_save_manual_v1(text, text, uuid) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_report_save_manual_v1(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_report_save_manual_v1(text, text, uuid) TO anon,authenticated;
ALTER FUNCTION public.sd_itinerary_record_save_v1(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.sd_itinerary_record_save_v1(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb) SET search_path=pg_catalog,public,pg_temp;
REVOKE ALL ON FUNCTION public.sd_itinerary_record_save_v1(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sd_itinerary_record_save_v1(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb) TO anon,authenticated;
DO $release_api$ DECLARE e record; actual text; BEGIN FOR e IN SELECT * FROM (VALUES ('public.apply_ship_dynamics_block_patch(text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.apply_ship_dynamics_block_patch_v2(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.apply_ship_dynamics_record_patch_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.claim_ship_dynamics_edit_lock(text, text, text, text, integer)','p_workspace_key text, p_section_key text, p_locked_by text, p_locked_by_name text, p_ttl_seconds integer'),
('public.delete_sd_itinerary_daily_report_records(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_report_ids jsonb'),
('public.delete_sd_itinerary_daily_reports(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_dates jsonb'),
('public.get_ship_dynamics_block_patch_receipt(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.get_ship_dynamics_record_receipt_v1(text, text, jsonb, text, text, jsonb, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_operations jsonb, p_saved_by text, p_actor_user_id text, p_actor_guard jsonb, p_authorization_guard jsonb, p_lock_guards jsonb'),
('public.get_ship_dynamics_record_storage_stats_v1(text, text)','p_workspace_key text, p_actor_user_id text'),
('public.get_ship_dynamics_storage_stats(text, text)','p_workspace_key text, p_actor_user_id text'),
('public.get_ship_dynamics_task_member_receipt_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_task_id text, p_vessel_id text, p_command jsonb, p_expected jsonb, p_actor_user_id text, p_actor_guard jsonb, p_lock_guards jsonb'),
('public.prune_ship_dynamics_record_revision_history_v1(text, text, uuid, jsonb, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_revisions jsonb, p_delete_revisions jsonb'),
('public.prune_ship_dynamics_revision_history(text, text, uuid, jsonb, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_revisions jsonb, p_delete_revisions jsonb'),
('public.read_ship_dynamics_browser_authority_v1(text)','p_workspace_key text'),
('public.read_ship_dynamics_record_delta_v1(text, integer, text)','p_workspace_key text, p_base_revision integer, p_base_token text'),
('public.read_ship_dynamics_record_scopes_v1(text, text, jsonb, jsonb)','p_workspace_key text, p_scope text, p_versions jsonb, p_targets jsonb'),
('public.read_ship_dynamics_records_v1(text)','p_workspace_key text'),
('public.read_ship_dynamics_task_member_v1(text, text, text, text)','p_workspace_key text, p_task_id text, p_vessel_id text, p_actor_user_id text'),
('public.release_ship_dynamics_edit_lock(text, text, text)','p_workspace_key text, p_section_key text, p_locked_by text'),
('public.release_ship_dynamics_task_member_lock_v1(text, text, text, text)','p_workspace_key text, p_section_key text, p_locked_by text, p_lease_version text'),
('public.renew_ship_dynamics_edit_lock(text, text, text, integer)','p_workspace_key text, p_section_key text, p_locked_by text, p_ttl_seconds integer'),
('public.renew_ship_dynamics_task_member_lock_v1(text, text, text, text, integer)','p_workspace_key text, p_section_key text, p_locked_by text, p_lease_version text, p_ttl_seconds integer'),
('public.save_ship_dynamics_task_member_v1(text, text, text, text, jsonb, jsonb, text, jsonb, jsonb)','p_workspace_key text, p_operation_id text, p_task_id text, p_vessel_id text, p_command jsonb, p_expected jsonb, p_actor_user_id text, p_actor_guard jsonb, p_lock_guards jsonb'),
('public.sd_itinerary_claim_public_lease(text, text, text, text, integer)','p_workspace_key text, p_vessel_id text, p_actor_key text, p_holder_session text, p_ttl_seconds integer'),
('public.sd_itinerary_daily_report_list_v2(text, text, integer, integer)','p_workspace_key text, p_actor_user_id text, p_page integer, p_page_size integer'),
('public.sd_itinerary_daily_report_load_by_id(text, bigint, text)','p_workspace_key text, p_report_id bigint, p_actor_user_id text'),
('public.sd_itinerary_daily_report_locate_v2(text, date, text, integer)','p_workspace_key text, p_business_date date, p_actor_user_id text, p_page_size integer'),
('public.sd_itinerary_main_claim_lease(text, text, text, text, integer, text)','p_workspace_key text, p_vessel_id text, p_holder_session text, p_holder_label text, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_main_load_many(text, text[], text)','p_workspace_key text, p_vessel_ids text[], p_actor_user_id text'),
('public.sd_itinerary_main_operation_status(text, uuid, text)','p_workspace_key text, p_operation_id uuid, p_actor_user_id text'),
('public.sd_itinerary_main_release_lease(text, text, uuid, text, bigint, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_user_id text'),
('public.sd_itinerary_main_renew_lease(text, text, uuid, text, bigint, integer, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_main_save(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb)','p_workspace_key text, p_vessel_id text, p_expected_revision bigint, p_operation_id uuid, p_rows jsonb, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_label text, p_actor_user_id text, p_alternative_plans jsonb'),
('public.sd_itinerary_operation_status_public(text, uuid, text)','p_workspace_key text, p_operation_id uuid, p_actor_key text'),
('public.sd_itinerary_public_list_vessels(text)','p_workspace_key text'),
('public.sd_itinerary_public_load(text, text)','p_workspace_key text, p_vessel_id text'),
('public.sd_itinerary_record_claim_lease_v1(text, text, text, text, integer, text)','p_workspace_key text, p_vessel_id text, p_holder_session text, p_holder_label text, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_record_load_many_v1(text, text[], text)','p_workspace_key text, p_vessel_ids text[], p_actor_user_id text'),
('public.sd_itinerary_record_operation_status_v1(text, uuid, text)','p_workspace_key text, p_operation_id uuid, p_actor_user_id text'),
('public.sd_itinerary_record_release_lease_v1(text, text, uuid, text, bigint, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_user_id text'),
('public.sd_itinerary_record_renew_lease_v1(text, text, uuid, text, bigint, integer, text)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_ttl_seconds integer, p_actor_user_id text'),
('public.sd_itinerary_record_report_delete_dates_v1(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_dates jsonb'),
('public.sd_itinerary_record_report_delete_ids_v1(text, text, uuid, text, jsonb)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid, p_expected_set_token text, p_delete_report_ids jsonb'),
('public.sd_itinerary_record_report_list_v1(text, text, integer, integer)','p_workspace_key text, p_actor_user_id text, p_page integer, p_page_size integer'),
('public.sd_itinerary_record_report_load_v1(text, bigint, text)','p_workspace_key text, p_report_id bigint, p_actor_user_id text'),
('public.sd_itinerary_record_report_locate_v1(text, date, text, integer)','p_workspace_key text, p_business_date date, p_actor_user_id text, p_page_size integer'),
('public.sd_itinerary_record_report_save_manual_v1(text, text, uuid)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid'),
('public.sd_itinerary_record_save_v1(text, text, bigint, uuid, jsonb, uuid, text, bigint, text, text, jsonb)','p_workspace_key text, p_vessel_id text, p_expected_revision bigint, p_operation_id uuid, p_rows jsonb, p_lease_id uuid, p_holder_session text, p_fencing_token bigint, p_actor_label text, p_actor_user_id text, p_alternative_plans jsonb'),
('public.sd_itinerary_release_public_lease(text, text, uuid, text, text, bigint)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_actor_key text, p_holder_session text, p_fencing_token bigint'),
('public.sd_itinerary_renew_public_lease(text, text, uuid, text, text, bigint, integer)','p_workspace_key text, p_vessel_id text, p_lease_id uuid, p_actor_key text, p_holder_session text, p_fencing_token bigint, p_ttl_seconds integer'),
('public.sd_itinerary_save_public(text, text, bigint, uuid, jsonb, uuid, text, text, bigint, jsonb)','p_workspace_key text, p_vessel_id text, p_expected_revision bigint, p_operation_id uuid, p_rows jsonb, p_lease_id uuid, p_actor_key text, p_holder_session text, p_fencing_token bigint, p_alternative_plans jsonb'),
('public.sd_save_manual_itinerary_report(text, text, uuid)','p_workspace_key text, p_actor_user_id text, p_operation_id uuid')) v(sig,args) LOOP SELECT pg_get_function_identity_arguments(to_regprocedure(e.sig)) INTO actual; IF actual IS DISTINCT FROM e.args THEN RAISE EXCEPTION 'release-api-signature-drift: %',e.sig; END IF; IF NOT has_function_privilege('anon',e.sig,'EXECUTE') OR NOT has_function_privilege('authenticated',e.sig,'EXECUTE') THEN RAISE EXCEPTION 'release-api-grant-missing: %',e.sig;END IF;END LOOP;END $release_api$;

DO $release_unchanged$
DECLARE t record;n bigint;stamp text;
BEGIN
 FOR t IN SELECT * FROM pg_temp.release_existing_rows LOOP
  IF t.old_lock_fields THEN
   EXECUTE format('SELECT count(*),md5(coalesce(string_agg((to_jsonb(x)-''lease_version'')::text,chr(10) ORDER BY workspace_key,section_key),'''')) FROM %s x',t.relation) INTO n,stamp;
   IF EXISTS(SELECT FROM public.ship_dynamics_edit_locks WHERE lease_version IS NULL OR lease_version<=0)
    OR (SELECT count(*)<>count(DISTINCT lease_version) FROM public.ship_dynamics_edit_locks) THEN
    RAISE EXCEPTION 'release-invalid-added-lock-fences';
   END IF;
  ELSE
   EXECUTE format('SELECT count(*),md5(coalesce(string_agg(ctid::text||'':''||xmin::text,'','' ORDER BY ctid),'''')) FROM %s',t.relation) INTO n,stamp;
  END IF;
  IF n IS DISTINCT FROM t.n OR stamp IS DISTINCT FROM t.stamp THEN
   RAISE EXCEPTION 'release-existing-business-rows-changed: %',t.relation;
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM public.ship_dynamics_record_workspaces) THEN RAISE EXCEPTION 'release-unexpected-record-import';END IF;
END $release_unchanged$;
NOTIFY pgrst,'reload schema';
COMMIT;
