-- Add annual inspection and drydock supplies. No data rewrite or schema change.
-- Preserve statistics v1 for clients still open during the additive rollout.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $$ begin
 if to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') is null
 or to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)') is null then
  raise exception 'tracking-annual-types-prerequisites-missing';
 end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)')) not in ('feb9156b15be250061f4a84af088b772','a5bb55bcad314a7a049997e8957ef303')
 or (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)')) is distinct from '132373bc016ed5b5502f746220fc9d04'
 or exists(select 1 from pg_proc where oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))<>'5899b3d72fac5f013cefca5acf3c6563') then
  raise exception 'tracking-annual-types-predecessor-mismatch';
 end if;
end $$;

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
  -- Optional on legacy rows. No inference, backfill or rewrite on read.
  if n ? 'requestType' then
   if jsonb_typeof(n->'requestType') is distinct from 'string' or coalesce(n->>'requestType','') not in ('repair','drydock','annual-inspection','semiannual-materials','temporary-materials','spares','drydock-spares','drydock-materials') then return 'tracking-request-type';end if;
   if (n->>'requestType' in ('repair','drydock','annual-inspection')) is distinct from (n->>'kind'='engineering') then return 'tracking-request-type-kind';end if;
  end if;
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

create or replace function public.read_ship_dynamics_tracking_statistics_public_v2(
 p_workspace_key text,p_scope jsonb,p_query jsonb
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 result jsonb; stamp timestamptz:=clock_timestamp(); today text;
 scope_kind text; scope_value text; date_from text; date_to text; filter_type text; filter_urgency text;
begin
 perform ship_dynamics_internal_control_private.admit_v1(p_workspace_key);
 if jsonb_typeof(p_scope) is distinct from 'object' or jsonb_typeof(p_query) is distinct from 'object' then
  raise exception 'tracking-statistics-invalid-query' using errcode='22023';
 end if;
 if not(p_scope ?& array['kind','value']) or exists(select 1 from jsonb_each(p_scope) e where e.key not in ('kind','value') or jsonb_typeof(e.value)<>'string')
 or not(p_query ?& array['from','to','type','urgency']) or exists(select 1 from jsonb_each(p_query) e where e.key not in ('from','to','type','urgency') or jsonb_typeof(e.value)<>'string') then
  raise exception 'tracking-statistics-invalid-query' using errcode='22023';
 end if;
 scope_kind:=p_scope->>'kind'; scope_value:=p_scope->>'value';
 date_from:=p_query->>'from'; date_to:=p_query->>'to'; filter_type:=p_query->>'type'; filter_urgency:=p_query->>'urgency';
 if scope_kind not in ('all','fleet','type','vessel') or length(scope_value)>200
 or (scope_kind='all' and scope_value<>'') or (scope_kind='vessel' and scope_value='')
 or (scope_kind='fleet' and scope_value not in ('bulk fleet','tanker fleet'))
 or filter_type not in ('all','materials','engineering','semiannual-materials','temporary-materials','spares','repair','drydock','annual-inspection','drydock-spares','drydock-materials','unclassified')
 or filter_urgency not in ('all','normal','urgent')
 or (date_from<>'' and not public.ship_dynamics_tracking_date_v1(date_from))
 or (date_to<>'' and not public.ship_dynamics_tracking_date_v1(date_to))
 or (date_from<>'' and date_to<>'' and date_from>date_to) then
  raise exception 'tracking-statistics-invalid-query' using errcode='22023';
 end if;
 today:=to_char(stamp at time zone 'Asia/Taipei','YYYY-MM-DD');
 -- One statement binds the catalog, selected membership and every aggregate to
 -- the same MVCC snapshot. No item bodies/IDs leave this function.
 with vessel_members as (
  select x.id,min(x.n) ordinal from public.ship_dynamics_record_collections c
  cross join lateral jsonb_array_elements_text(c.ids) with ordinality x(id,n)
  where c.workspace_key=p_workspace_key and c.collection='vessels' group by x.id
 ), vessels as (
  select r.entity_id id,m.ordinal,coalesce(r.value->>'shipType','') ship_type,coalesce(r.value->>'fleetCategory','') fleet_category,
   jsonb_build_object('id',r.entity_id,'name',coalesce(r.value->>'name',''),'shortName',coalesce(r.value->>'shortName',''),'fullName',coalesce(r.value->>'fullName',''),'shipType',coalesce(r.value->>'shipType',''),'fleetCategory',coalesce(r.value->>'fleetCategory','')) body
  from vessel_members m join public.ship_dynamics_records r on r.workspace_key=p_workspace_key and r.collection='vessels' and r.entity_id=m.id
  where r.value->'isActive'='true'::jsonb
 ), selected as (
  select * from vessels v where scope_kind='all' or scope_kind='vessel' and v.id=scope_value
   or scope_kind='fleet' and v.fleet_category=scope_value or scope_kind='type' and v.ship_type=scope_value
 ), sources as (
  select r.entity_id id,r.value b,
   case when r.value->>'kind'='supply' and r.value->>'requestType' in ('semiannual-materials','temporary-materials','spares','drydock-spares','drydock-materials') then r.value->>'requestType'
    when r.value->>'kind'='engineering' and r.value->>'requestType' in ('repair','drydock','annual-inspection') then r.value->>'requestType' else 'unclassified' end category
  from public.ship_dynamics_records r join selected v on v.id=r.value->>'vesselId'
  where r.workspace_key=p_workspace_key and r.collection='trackingItems'
   and exists(select 1 from public.ship_dynamics_record_collections c where c.workspace_key=r.workspace_key and c.collection=r.collection and c.ids ? r.entity_id)
 ), cohort as (
  select * from sources where
   ((date_from='' and date_to='') or public.ship_dynamics_tracking_date_v1(b->>'applicationDate') and (date_from='' or b->>'applicationDate'>=date_from) and (date_to='' or b->>'applicationDate'<=date_to))
   and (filter_urgency='all' or b->>'urgency'=filter_urgency)
   and (filter_type='all' or filter_type=category or filter_type='materials' and category in ('semiannual-materials','temporary-materials','drydock-materials') or filter_type='engineering' and b->>'kind'='engineering')
 ), base as (
  select *,coalesce(b->'isClosed'='true'::jsonb and b->>'closureOutcome'='cancelled',false) cancelled,
   coalesce(case when b->>'kind'='supply' then b->>'deliveryStatus'='delivered' else public.ship_dynamics_tracking_date_v1(b->>'completionDate') end,false) delivered,
   case when b->>'kind'='supply' then b->>'actualDeliveryDate' else b->>'completionDate' end actual_date,
   public.ship_dynamics_tracking_date_v1(b->>'expectedDate') deadline,
   coalesce(b->>'urgency'='urgent',false) urgent
  from cohort
 ), state as (
  select *,not cancelled and delivered completed,not cancelled and not delivered incomplete,
   public.ship_dynamics_tracking_date_v1(actual_date) actual,
   not cancelled and coalesce(b->>'kind'='supply' and b->>'deliveryStatus'='partially-delivered',false) partial
  from base
 ), delay as (
  select *,completed and deadline and actual and actual_date>b->>'expectedDate' overdue_completed,
   incomplete and deadline and today>b->>'expectedDate' overdue_incomplete,
   not cancelled and not deadline no_deadline,completed and deadline and not actual insufficient_date,
   incomplete and deadline and today<=b->>'expectedDate' not_yet_due
  from state
 ), facts as (
  select *,overdue_completed or overdue_incomplete delayed,
   not cancelled and deadline and (completed and actual or overdue_incomplete) delay_eligible from delay
 ), dimensions(category,label,n) as (values
  (null::text,'全部',0),('semiannual-materials','半年物料',1),('temporary-materials','臨時物料',2),('drydock-materials','塢修物料',3),('spares','備件',4),('drydock-spares','塢修備件',5),('repair','維修工程',6),('drydock','塢修工程',7),('annual-inspection','年檢工程',8),('unclassified','舊資料未分類',9)
 ), counts as (
  select d.category,d.label,d.n,count(f.id) total,
   count(*) filter(where f.cancelled) cancelled,count(*) filter(where not f.cancelled) effective,
   count(*) filter(where f.completed) completed,count(*) filter(where f.incomplete) incomplete,
   count(*) filter(where f.delayed) delayed,count(*) filter(where f.delay_eligible) delay_eligible,
   count(*) filter(where f.overdue_completed) overdue_completed,count(*) filter(where f.overdue_incomplete) overdue_incomplete,
   count(*) filter(where f.no_deadline) no_deadline,count(*) filter(where f.insufficient_date) insufficient_date,count(*) filter(where f.not_yet_due) not_yet_due,
   count(*) filter(where f.partial) partial,count(*) filter(where f.urgent) urgent,
   count(*) filter(where f.urgent and f.completed) urgent_completed,count(*) filter(where f.urgent and f.incomplete) urgent_incomplete,count(*) filter(where f.urgent and f.cancelled) urgent_cancelled
  from dimensions d left join facts f on d.category is null or f.category=d.category group by d.category,d.label,d.n
 ), summaries as (
  select category,label,n,jsonb_build_object(
   'total',total,'cancelled',cancelled,'effective',effective,'completed',completed,'incomplete',incomplete,'completionRate',completed::numeric/nullif(effective,0),
   'delayed',delayed,'delayEligible',delay_eligible,'delayRate',delayed::numeric/nullif(delay_eligible,0),
   'overdueCompleted',overdue_completed,'overdueIncomplete',overdue_incomplete,'noDeadline',no_deadline,'insufficientDate',insufficient_date,'notYetDue',not_yet_due,
   'partial',partial,'urgent',urgent,'urgentCompleted',urgent_completed,'urgentIncomplete',urgent_incomplete,'urgentCancelled',urgent_cancelled) summary from counts
 )
 select jsonb_build_object('protocol','ship-tracking-statistics-v2','workspace',p_workspace_key,'at',stamp,'today',today,
  'vessels',(select coalesce(jsonb_agg(body order by ordinal),'[]'::jsonb) from vessels),
  'vesselIds',(select coalesce(jsonb_agg(id order by ordinal),'[]'::jsonb) from selected),
  'stats',jsonb_build_object('summary',(select summary from summaries where n=0),
   'categories',(select jsonb_agg(jsonb_build_object('value',category,'label',label,'summary',summary) order by n) from summaries where n>0))) into result;
 if scope_kind='vessel' and jsonb_array_length(result->'vesselIds')<>1 then raise exception 'tracking-statistics-vessel-unavailable' using errcode='22023';end if;
 return result;
end $$;
revoke all on function public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
