-- Development-only opt-in. No production migration manifest or ACL changes.
-- One statement snapshot: ordered complete list summaries + changed row bodies.
-- The 'full' scope is an explicit compatibility action, never a background hydrate.
create or replace function public.ship_dynamics_record_summary_v1(p_body jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare result jsonb:=p_body; logs jsonb; progress jsonb;
begin
  if jsonb_typeof(p_body->'statusLogs')='array' then
    select coalesce(jsonb_agg(x.value order by x.n),'[]') into logs from jsonb_array_elements(p_body->'statusLogs') with ordinality x(value,n) where x.n<=2;
    result:=jsonb_set(result,'{statusLogs}',logs);
  end if;
  if jsonb_typeof(p_body->'vesselProgress')='array' then
    select coalesce(jsonb_agg(public.ship_dynamics_record_summary_v1(x.value) order by x.n),'[]') into progress from jsonb_array_elements(p_body->'vesselProgress') with ordinality x(value,n);
    result:=jsonb_set(result,'{vesselProgress}',progress);
  end if;
  return result-'snapshot';
end; $$;

create or replace function public.read_ship_dynamics_record_scopes_v1(p_workspace_key text,p_scope text,p_versions jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare w public.ship_dynamics_record_workspaces%rowtype; result jsonb;
begin
  if p_scope not in ('home','full') or p_scope is null or jsonb_typeof(p_versions) is distinct from 'object' then raise exception 'invalid-record-read-scope'; end if;
  select * into w from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key;
  if not found then return jsonb_build_object('protocol','ship-dynamics-record-scopes-v1','workspace_key',p_workspace_key,'scope',p_scope,'status','missing'); end if;
  select jsonb_build_object('protocol','ship-dynamics-record-scopes-v1','workspace_key',p_workspace_key,'scope',p_scope,'status','scopes','revision',w.revision,'root',w.root,
    'collections',coalesce(jsonb_object_agg(c.collection,jsonb_build_object('ids',c.ids,'rows',(
      select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'version',r.revision,'value',case when p_scope='home' and r.collection in ('tasks','internalControlCases','meetings','agendaReports') then public.ship_dynamics_record_summary_v1(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision)) else public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) end)),'[]')
      from public.ship_dynamics_records r where r.workspace_key=c.workspace_key and r.collection=c.collection and (p_versions->c.collection->r.entity_id) is distinct from to_jsonb(r.revision)
    ))),'{}')) into result from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key;
  return result;
end; $$;
revoke all on function public.ship_dynamics_record_summary_v1(jsonb), public.read_ship_dynamics_record_scopes_v1(text,text,jsonb) from public,anon,authenticated;
