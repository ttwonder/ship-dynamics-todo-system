-- Forward-only tracking collection extension. Install after the current record release.
-- Preserves installed source/maintenance gates, CAS, receipt and writer protocol.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);

-- Extend the installed bodies, not an obsolete development copy. Keep ACL/OIDs.
do $tracking_install$
declare fn regprocedure; def text; old_names text := 'array[''users'',''vessels'',''tasks'',''internalControlCases'',''meetings'',''agendaReports'',''taskDismissals'',''notifications'',''auditLogs'']';
begin
 foreach fn in array array['public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure,'public.import_ship_dynamics_records_v1(text,jsonb)'::regprocedure] loop
  def:=pg_get_functiondef(fn);
  if position('''trackingItems''' in def)=0 then
   if position(old_names in def)=0 then raise exception 'tracking-installed-writer-precondition';end if;
   execute replace(def,old_names,replace(old_names,'''auditLogs'']','''auditLogs'',''trackingItems'']'));
  end if;
 end loop;
 -- Old browser code enforces an exact nine-collection v1 envelope.
 def:=pg_get_functiondef('public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb)'::regprocedure);
 if position('-- tracking_v1_shape' in def)=0 then
  if position('from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key;' in def)=0 then raise exception 'tracking-installed-reader-precondition';end if;
  execute replace(def,'from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key;',E'from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key and c.collection<>''trackingItems''; -- tracking_v1_shape');
 end if;
end $tracking_install$;

create or replace function public.read_ship_dynamics_record_scopes_v2(p_workspace_key text,p_scope text,p_versions jsonb,p_targets jsonb default '[]',p_vessel_ids jsonb default '[]')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare w public.ship_dynamics_record_workspaces%rowtype; result jsonb; targets jsonb;
begin
 if p_scope not in ('home','full','targets') or p_scope is null or jsonb_typeof(p_versions) is distinct from 'object' or jsonb_typeof(p_targets) is distinct from 'array' or jsonb_typeof(p_vessel_ids) is distinct from 'array' then raise exception 'invalid-record-read-scope';end if;
 if exists(select 1 from jsonb_array_elements(p_targets) t where jsonb_typeof(t) is distinct from 'object' or t->>'collection' not in ('tasks','internalControlCases','meetings','agendaReports','trackingItems') or jsonb_typeof(t->'id') is distinct from 'string' or t->>'collection' is null)
 or exists(select 1 from jsonb_array_elements(p_vessel_ids) t where jsonb_typeof(t)<>'string') then raise exception 'invalid-record-read-target';end if;
 select * into w from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key;
 if not found then return jsonb_build_object('protocol','ship-dynamics-record-scopes-v2','workspace_key',p_workspace_key,'scope',p_scope,'targets',p_targets,'vessel_ids',p_vessel_ids,'status','missing');end if;
 with recursive edges as (
  select 'tasks'::text a_collection,r.entity_id a_id,'internalControlCases'::text b_collection,r.value->>'internalControlCaseId' b_id from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.value->>'internalControlCaseId' is not null
  union select 'tasks',r.entity_id,'meetings',r.value->>'sourceMeetingId' from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.value->>'sourceMeetingId' is not null
  union select 'internalControlCases',r.entity_id,'tasks',r.value->>'linkedTaskId' from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='internalControlCases' and r.value->>'linkedTaskId' is not null
  union select 'trackingItems',r.entity_id,'internalControlCases',r.value->>'linkedCaseId' from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='trackingItems' and r.value->>'linkState'='active'
 ), graph(collection,id) as (
  select t->>'collection',t->>'id' from jsonb_array_elements(p_targets) t
  union select case when e.a_collection=g.collection and e.a_id=g.id then e.b_collection else e.a_collection end,case when e.a_collection=g.collection and e.a_id=g.id then e.b_id else e.a_id end from graph g join edges e on (e.a_collection=g.collection and e.a_id=g.id) or (e.b_collection=g.collection and e.b_id=g.id)
 ) select coalesce(jsonb_agg(jsonb_build_array(collection,id)),'[]') into targets from graph;
 with bodies as (
  select r.*,(p_scope='full' or r.collection not in ('tasks','internalControlCases','meetings','agendaReports') or targets @> jsonb_build_array(jsonb_build_array(r.collection,r.entity_id))) detail
  from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and (r.collection<>'trackingItems' or p_scope='full' or p_vessel_ids ? (r.value->>'vesselId') or targets @> jsonb_build_array(jsonb_build_array(r.collection,r.entity_id)))
 ), collections as (
  select c.collection,c.ids from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key
  union all select 'trackingItems','[]'::jsonb where not exists(select 1 from public.ship_dynamics_record_collections c where c.workspace_key=p_workspace_key and c.collection='trackingItems')
 )
 select jsonb_build_object('protocol','ship-dynamics-record-scopes-v2','workspace_key',p_workspace_key,'scope',p_scope,'targets',p_targets,'vessel_ids',p_vessel_ids,'status','scopes','revision',w.revision,'root',w.root,
 'collections',coalesce(jsonb_object_agg(c.collection,jsonb_build_object('ids',case when c.collection='trackingItems' then (select coalesce(jsonb_agg(id order by n),'[]') from jsonb_array_elements(c.ids) with ordinality x(id,n) where exists(select 1 from bodies b where b.collection=c.collection and b.entity_id=id#>>'{}')) else c.ids end,'rows',(
 select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'version',r.revision,'detail',r.detail,'value',case when not r.detail then public.ship_dynamics_record_summary_v1(public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision)) else public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) end)),'[]') from bodies r where r.collection=c.collection and (p_versions->c.collection->r.entity_id) is distinct from jsonb_build_object('version',r.revision,'detail',r.detail)
 ))),'{}')) into result from collections c;
 return result;
end $$;
revoke all on function public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
-- Same read capability as installed v1, no direct table access or control grants.
do $$ begin
 if has_function_privilege('anon','public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb)','EXECUTE') then grant execute on function public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb) to anon;end if;
 if has_function_privilege('authenticated','public.read_ship_dynamics_record_scopes_v1(text,text,jsonb,jsonb)','EXECUTE') then grant execute on function public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb) to authenticated;end if;
end $$;
-- Private prospective-body lookup; reads the current authority plus this patch only.
create or replace function public.ship_dynamics_tracking_after_v1(w text,c text,i text,ops jsonb)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select case when exists(select 1 from jsonb_array_elements(ops) o where o->>'kind'='entity' and o->>'collection'=c and o->>'entityId'=i)
 then (select nullif(o->'value','null'::jsonb) from jsonb_array_elements(ops) o where o->>'kind'='entity' and o->>'collection'=c and o->>'entityId'=i limit 1)
 else (select value from public.ship_dynamics_records where workspace_key=w and collection=c and entity_id=i) end
$$;
create or replace function public.ship_dynamics_tracking_date_v1(s text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if s is null or s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
 return to_char(s::date,'YYYY-MM-DD')=s;
exception when others then return false;
end $$;
revoke all on function public.ship_dynamics_tracking_after_v1(text,text,text,jsonb),public.ship_dynamics_tracking_date_v1(text) from public,anon,authenticated;
-- Called after authoritative actor/CAS/lease waiting and before any body write.
create or replace function public.ship_dynamics_tracking_validate_v1(p_workspace text,p_ops jsonb,p_actor text,p_guard jsonb,p_locks jsonb)
returns text language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare op jsonb; b jsonb; n jsonb; permission_name text; g jsonb; source_id text; c jsonb; t jsonb; old_c jsonb; f text; old_events jsonb; new_events jsonb; old_logs jsonb; new_logs jsonb;
begin
 for op in select x from jsonb_array_elements(p_ops) x where x->>'kind'='entity' and x->>'collection'='trackingItems' loop
  b:=nullif(op->'expected','null');n:=nullif(op->'value','null');
  if n is null then return 'tracking-source-delete-forbidden';end if;
  if p_guard#>>'{actor,role}'='vessel' then return 'tracking-shore-only';end if;
  if b is null and n->>'isClosed'='true' and p_guard#>>'{actor,role}'<>'owner' and coalesce((p_guard#>>'{effectivePermissions,closeTasks}')::boolean,false) is not true then return 'tracking-permission-denied';end if;
  permission_name:=case when b is null then 'createTasks' when (b->'isClosed' is distinct from n->'isClosed' or b->'closedDate' is distinct from n->'closedDate' or b->'closedBy' is distinct from n->'closedBy' or b->'closureOutcome' is distinct from n->'closureOutcome') then 'closeTasks' else 'editBusinessContent' end;
  if p_guard#>>'{actor,role}'<>'owner' and coalesce((p_guard->'effectivePermissions'->>permission_name)::boolean,false) is not true then return 'tracking-permission-denied';end if;
  if not coalesce(p_guard->'visibleVesselIds' ? (n->>'vesselId'),false) then return 'tracking-vessel-denied';end if;
  if not exists(select 1 from jsonb_array_elements(p_locks) l where l->>'section_key'='tracking:'||(op->>'entityId')) then return 'tracking-lock-required';end if;
  if coalesce(n->>'kind','') not in ('supply','engineering') or coalesce(n->>'referenceNo','')='' or coalesce(n->>'description','')='' or coalesce(n->>'urgency','') not in ('normal','urgent') or coalesce(n->>'deliveryStatus','') not in ('not-delivered','partially-delivered','delivered') or jsonb_typeof(n->'isClosed') is distinct from 'boolean' or jsonb_typeof(n->'statusLogs') is distinct from 'array' then return 'tracking-invalid-source';end if;
  foreach f in array array['applicationDate','expectedDate','preparationDate','countersignDate','completionDate','actualDeliveryDate'] loop
   if (f='applicationDate' or coalesce(n->>f,'')<>'') and not public.ship_dynamics_tracking_date_v1(n->>f) then return 'tracking-invalid-date';end if;
  end loop;
  if n->>'deliveryStatus'='delivered' and not public.ship_dynamics_tracking_date_v1(n->>'actualDeliveryDate') then return 'tracking-delivery-date-required';end if;
  if n->>'isClosed'='true' and (not public.ship_dynamics_tracking_date_v1(n->>'closedDate') or n->>'closedDate'<n->>'applicationDate') then return 'tracking-invalid-close-date';end if;
  if n->>'isClosed'='false' and nullif(n->>'closedDate','') is not null then return 'tracking-open-close-date';end if;
  if b is not null and (b->'vesselId' is distinct from n->'vesselId' or b->'kind' is distinct from n->'kind' or b->'createdAt' is distinct from n->'createdAt' or b->'createdBy' is distinct from n->'createdBy') then return 'tracking-identity-immutable';end if;
  old_events:=coalesce(b->'events','[]');new_events:=coalesce(n->'events','[]');old_logs:=coalesce(b->'statusLogs','[]');new_logs:=n->'statusLogs';
  if jsonb_typeof(new_events)<>'array' or jsonb_array_length(new_events)<jsonb_array_length(old_events) or exists(select 1 from jsonb_array_elements(old_events) with ordinality e(v,k) where v is distinct from new_events->(k::int-1)) then return 'tracking-history-immutable';end if;
  if jsonb_array_length(new_logs)<jsonb_array_length(old_logs) or exists(select 1 from jsonb_array_elements(old_logs) with ordinality e(v,k) where v is distinct from new_logs->(jsonb_array_length(new_logs)-jsonb_array_length(old_logs)+k::int-1)) then return 'tracking-history-immutable';end if;
  if b is not null and b->'progress' is distinct from n->'progress' then
   if b->>'isClosed'='true' or n->>'isClosed'='true' then return 'tracking-closed-progress';end if;
   if jsonb_array_length(new_logs)<=jsonb_array_length(old_logs) or new_logs#>>'{0,text}' is distinct from n->>'progress' or new_logs#>>'{0,byUserId}' is distinct from p_actor then return 'tracking-progress-history-required';end if;
  end if;
  if b is not null and (b->'isClosed' is distinct from n->'isClosed' or b->'closedDate' is distinct from n->'closedDate' or b->'deliveryStatus' is distinct from n->'deliveryStatus' or b->'actualDeliveryDate' is distinct from n->'actualDeliveryDate' or b->'linkedCaseId' is distinct from n->'linkedCaseId' or b->'linkState' is distinct from n->'linkState') then
   if jsonb_array_length(new_events)<=jsonb_array_length(old_events) or new_events->-1->>'byUserId' is distinct from p_actor then return 'tracking-event-required';end if;
  end if;
 end loop;
 -- Resolve only exact touched groups. No reference-number joins or new endpoints.
 for source_id in select entity_id from public.ship_dynamics_records where workspace_key=p_workspace and collection='trackingItems'
  union select o->>'entityId' from jsonb_array_elements(p_ops) o where o->>'kind'='entity' and o->>'collection'='trackingItems' loop
  select value into b from public.ship_dynamics_records where workspace_key=p_workspace and collection='trackingItems' and entity_id=source_id;
  n:=public.ship_dynamics_tracking_after_v1(p_workspace,'trackingItems',source_id,p_ops);
  old_c:=public.ship_dynamics_tracking_after_v1(p_workspace,'internalControlCases',b->>'linkedCaseId','[]');
  if not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'kind'='entity' and ((o->>'collection'='trackingItems' and o->>'entityId'=source_id) or (o->>'collection'='internalControlCases' and o->>'entityId' in (b->>'linkedCaseId',n->>'linkedCaseId')) or (o->>'collection'='tasks' and o->>'entityId'=old_c->>'linkedTaskId'))) then continue;end if;
  if b->>'linkState'='active' and (n->>'linkState' is distinct from 'active' or n->'linkedCaseId' is distinct from b->'linkedCaseId') then
   c:=public.ship_dynamics_tracking_after_v1(p_workspace,'internalControlCases',b->>'linkedCaseId',p_ops);
   if n->>'linkState' is distinct from 'invalid' or n->'linkedCaseId' is distinct from b->'linkedCaseId' then return 'tracking-link-immutable';end if;
   if c is not null and (c->>'trackingLinkState' is distinct from 'invalid' or c->>'trackingItemId' is distinct from source_id or c->>'syncToTask' is distinct from 'false' or nullif(c->>'linkedTaskId','') is not null or old_c->>'linkedTaskId' is null or public.ship_dynamics_tracking_after_v1(p_workspace,'tasks',old_c->>'linkedTaskId',p_ops) is not null) then return 'tracking-link-immutable';end if;
  end if;
  if n->>'linkState'='active' then
   c:=public.ship_dynamics_tracking_after_v1(p_workspace,'internalControlCases',n->>'linkedCaseId',p_ops);
   if c is null or c->>'trackingItemId' is distinct from source_id or c->'vesselId' is distinct from n->'vesselId' then return 'tracking-link-inconsistent';end if;
   if c->'isClosed' is distinct from n->'isClosed' or coalesce(c->>'closedDate','')<>coalesce(n->>'closedDate','') then return 'tracking-lifecycle-inconsistent';end if;
   if c->>'isClosed'='true' and n->>'closedDate'<c->>'reportDate' then return 'tracking-invalid-close-date';end if;
   if c->>'syncToTask'='true' or nullif(c->>'linkedTaskId','') is not null then
    t:=public.ship_dynamics_tracking_after_v1(p_workspace,'tasks',c->>'linkedTaskId',p_ops);
    if t is null or t->>'internalControlCaseId' is distinct from c->>'id' or t->>'isInternalControl' is distinct from 'true' or t->'vesselId' is distinct from n->'vesselId' or nullif(t->>'sourceMeetingId','') is not null then return 'tracking-task-link-inconsistent';end if;
    if t->'isClosed' is distinct from n->'isClosed' or coalesce(t->>'closedDate','')<>coalesce(n->>'closedDate','') then return 'tracking-lifecycle-inconsistent';end if;
   else t:=null;end if;
   if b is not null and n->'progress' is distinct from b->'progress' then
    if c->'status' is distinct from n->'progress' or c#>'{statusLogs,0}' is distinct from n#>'{statusLogs,0}' or (t is not null and (t->'status' is distinct from n->'progress' or t->'statusLogs' is distinct from c->'statusLogs')) then return 'tracking-progress-not-converged';end if;
    if not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'collection'='internalControlCases' and o->>'kind'='entity' and o->>'entityId'=c->>'id' and ((o->'expected')-array['status','statusLogs','updatedAt','updatedBy'])=((o->'value')-array['status','statusLogs','updatedAt','updatedBy'])) then return 'tracking-progress-overwrites-basic';end if;
    if t is not null and not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'collection'='tasks' and o->>'kind'='entity' and o->>'entityId'=t->>'id' and ((o->'expected')-array['status','statusLogs','updatedAt','updatedBy'])=((o->'value')-array['status','statusLogs','updatedAt','updatedBy'])) then return 'tracking-progress-overwrites-basic';end if;
   end if;
  end if;
 end loop;
 for op in select o from jsonb_array_elements(p_ops) o where o->>'kind'='entity' and o->>'collection'='internalControlCases' and nullif(o#>>'{value,trackingItemId}','') is not null loop
  n:=public.ship_dynamics_tracking_after_v1(p_workspace,'trackingItems',op#>>'{value,trackingItemId}',p_ops);
  if op#>>'{value,trackingLinkState}'='invalid' then
   if n is null or (n->>'linkState'='active' and n->>'linkedCaseId'=op->>'entityId') or op#>'{expected,trackingItemId}' is distinct from op#>'{value,trackingItemId}' then return 'tracking-link-inconsistent';end if;
  elsif n is null or n->>'linkState' is distinct from 'active' or n->>'linkedCaseId' is distinct from op->>'entityId' then return 'tracking-link-inconsistent';end if;
 end loop;
 return null;
end $$;
revoke all on function public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
do $$
declare def text; needle text:='  return public.ship_dynamics_record_commit_validated_v1(';
begin
 def:=pg_get_functiondef('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure);
 if position('-- tracking_validate_v1' in def)=0 then
  if position(needle in def)=0 then raise exception 'tracking-writer-commit-precondition';end if;
  execute replace(def,needle,E'  -- tracking_validate_v1\n  key := public.ship_dynamics_tracking_validate_v1(p_workspace_key,p_operations,p_actor_user_id,p_actor_guard,p_lock_guards);\n  if key is not null then return jsonb_build_object(''ok'',false,''code'',key);end if;\n'||needle);
 end if;
end $$;
commit;
