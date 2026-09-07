-- DEVELOPMENT ONLY: private row-authority read protocol; no browser grants.
-- Apply after 20260906_appdata_record_store.sql. No legacy workspace/history read.
begin;
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
commit;
