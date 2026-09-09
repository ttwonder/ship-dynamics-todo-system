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
  result:=result-'__recordSnapshotAvailable';
  if jsonb_typeof(p_body->'snapshot')='object' and jsonb_typeof(p_body->'snapshot'->'vessels')='array' and jsonb_typeof(p_body->'snapshot'->'tasks')='array' and jsonb_typeof(p_body->'snapshot'->'meetings')='array' then
    result:=result || jsonb_build_object('__recordSnapshotAvailable',true);
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
