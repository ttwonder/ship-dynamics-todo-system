-- Additive summary-only ship statistics. No business data or existing RPC/ACL changes.
-- Vessel selection is a scope, not an authenticated identity.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $$ begin
 if to_regprocedure('ship_dynamics_internal_control_private.admit_v1(text)') is null
 or to_regprocedure('public.ship_dynamics_tracking_date_v1(text)') is null then
  raise exception 'tracking-statistics-prerequisites-missing';
 end if;
end $$;

create or replace function public.read_ship_dynamics_tracking_statistics_public_v1(
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
 or filter_type not in ('all','materials','engineering','semiannual-materials','temporary-materials','spares','repair','drydock','unclassified')
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
   case when r.value->>'kind'='supply' and r.value->>'requestType' in ('semiannual-materials','temporary-materials','spares') then r.value->>'requestType'
    when r.value->>'kind'='engineering' and r.value->>'requestType' in ('repair','drydock') then r.value->>'requestType' else 'unclassified' end category
  from public.ship_dynamics_records r join selected v on v.id=r.value->>'vesselId'
  where r.workspace_key=p_workspace_key and r.collection='trackingItems'
   and exists(select 1 from public.ship_dynamics_record_collections c where c.workspace_key=r.workspace_key and c.collection=r.collection and c.ids ? r.entity_id)
 ), cohort as (
  select * from sources where
   ((date_from='' and date_to='') or public.ship_dynamics_tracking_date_v1(b->>'applicationDate') and (date_from='' or b->>'applicationDate'>=date_from) and (date_to='' or b->>'applicationDate'<=date_to))
   and (filter_urgency='all' or b->>'urgency'=filter_urgency)
   and (filter_type='all' or filter_type=category or filter_type='materials' and category in ('semiannual-materials','temporary-materials') or filter_type='engineering' and b->>'kind'='engineering')
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
  (null::text,'全部',0),('semiannual-materials','半年物料',1),('temporary-materials','臨時物料',2),('spares','備件',3),('repair','維修工程',4),('drydock','塢修工程',5),('unclassified','舊資料未分類',6)
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
 select jsonb_build_object('protocol','ship-tracking-statistics-v1','workspace',p_workspace_key,'at',stamp,'today',today,
  'vessels',(select coalesce(jsonb_agg(body order by ordinal),'[]'::jsonb) from vessels),
  'vesselIds',(select coalesce(jsonb_agg(id order by ordinal),'[]'::jsonb) from selected),
  'stats',jsonb_build_object('summary',(select summary from summaries where n=0),
   'categories',(select jsonb_agg(jsonb_build_object('value',category,'label',label,'summary',summary) order by n) from summaries where n>0))) into result;
 if scope_kind='vessel' and jsonb_array_length(result->'vesselIds')<>1 then raise exception 'tracking-statistics-vessel-unavailable' using errcode='22023';end if;
 return result;
end $$;
revoke all on function public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
