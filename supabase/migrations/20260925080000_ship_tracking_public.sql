-- Additive anonymous, selected-vessel tracking portal. No existing RPC ACL changes.
-- The selected vessel is scope, NOT proof of a person's identity.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $$ begin
 if to_regprocedure('public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)') is null
 or to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') is null
 or to_regprocedure('ship_dynamics_internal_control_private.admit_v1(text)') is null
 or to_regprocedure('public.ship_dynamics_task_lease_gate_v1(text,text)') is null then
  raise exception 'ship-tracking-prerequisites-missing';
 end if;
end $$;
create schema if not exists ship_dynamics_tracking_private;
revoke all on schema ship_dynamics_tracking_private from public,anon,authenticated,service_role;

create or replace function ship_dynamics_tracking_private.pick_v1(body jsonb,fields text[])
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(body) where key=any(fields)
$$;

create or replace function ship_dynamics_tracking_private.read_v1(w text,v text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare catalog jsonb; rev integer; updated text; sources jsonb:='[]'; cases jsonb:='[]';
begin
 perform ship_dynamics_internal_control_private.admit_v1(w);
 select revision,root->>'updatedAt' into strict rev,updated from public.ship_dynamics_record_workspaces where workspace_key=w for share;
 catalog:=public.read_ship_dynamics_internal_control_public_v1(w,v);
 if v is not null then
  select coalesce(jsonb_agg(ship_dynamics_tracking_private.pick_v1(r.value,array[
   'id','kind','vesselId','referenceNo','description','applicationDate','originalItemNo','subitemNo','urgency','urgentSubtypes','purchaseNos','materialCategory','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','completionDate','originalRemarks','supplementalNotes','progress','expectedDate','deliveryStatus','actualDeliveryDate','isClosed','closedDate','closedBy','closureOutcome','linkedCaseId','linkState','source','createdBy','updatedBy','createdAt','updatedAt','statusLogs','events'
  ]) order by ids.n),'[]') into sources
  from public.ship_dynamics_record_collections co cross join lateral jsonb_array_elements_text(co.ids) with ordinality ids(id,n)
  join public.ship_dynamics_records r on r.workspace_key=co.workspace_key and r.collection=co.collection and r.entity_id=ids.id
  where co.workspace_key=w and co.collection='trackingItems' and r.value->>'vesselId'=v;
  select coalesce(jsonb_agg(ship_dynamics_tracking_private.pick_v1(c.value,array[
   'id','vesselId','trackingItemId','reportDate','reportSource','description','priority','category','equipmentSubcategory','isAware','status','departments','expectedDate','isClosed','closedDate','createdAt','updatedAt','statusLogs'
  ])||jsonb_build_object('syncToTask',false) order by c.entity_id),'[]') into cases
  from public.ship_dynamics_records c where c.workspace_key=w and c.collection='internalControlCases' and c.value->>'vesselId'=v
  and exists(select 1 from jsonb_array_elements(sources) s where s->>'linkState'='active' and s->>'linkedCaseId'=c.entity_id and s->>'id'=c.value->>'trackingItemId');
 end if;
 return jsonb_build_object('protocol','ship-tracking-public-v1','workspace',w,'vessels',catalog->'vessels','vessel',catalog->'vessel','catalog',catalog->'catalog',
 'revision',rev,'updatedAt',updated,'trackingItems',sources,'cases',cases);
end $$;

create table if not exists ship_dynamics_tracking_private.bundles (
 workspace text not null,bundle_id uuid not null,vessel text not null,actor uuid not null,holder uuid not null,
 ids jsonb not null,creation boolean not null,groups jsonb not null,guards jsonb not null,expires_at timestamptz not null,
 primary key(workspace,bundle_id)
);
revoke all on all tables in schema ship_dynamics_tracking_private from public,anon,authenticated,service_role;

create or replace function ship_dynamics_tracking_private.edit_fields_v1()
returns text[] language sql immutable set search_path=pg_catalog as $$
 select array['referenceNo','description','applicationDate','originalItemNo','subitemNo','urgency','urgentSubtypes','purchaseNos','materialCategory','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','completionDate','originalRemarks','supplementalNotes','expectedDate']::text[]
$$;

create or replace function ship_dynamics_tracking_private.groups_v1(w text,v text,ids jsonb,creation boolean)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare id text; s jsonb; c jsonb; t jsonb; result jsonb:='[]';
begin
 if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids) not between 1 and 100
 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 200)
 or (select count(distinct x) from jsonb_array_elements_text(ids) x)<>jsonb_array_length(ids) then raise exception 'ship-tracking-selection-invalid' using errcode='22023';end if;
 for id in select x from jsonb_array_elements_text(ids) x order by x loop
  select value into s from public.ship_dynamics_records where workspace_key=w and collection='trackingItems' and entity_id=id;
  c:=null;t:=null;
  if creation then
   if s is not null or exists(select 1 from public.ship_dynamics_record_history where workspace_key=w and collection='trackingItems' and entity_id=id) then raise exception 'ship-tracking-id-exists' using errcode='22023';end if;
  else
   if s is null or s->>'vesselId' is distinct from v or not exists(select 1 from public.ship_dynamics_record_collections where workspace_key=w and collection='trackingItems' and ship_dynamics_record_collections.ids ? id) then raise exception 'ship-tracking-source-unavailable' using errcode='22023';end if;
   if s->>'linkState'='active' then
    select value into c from public.ship_dynamics_records where workspace_key=w and collection='internalControlCases' and entity_id=s->>'linkedCaseId';
    if c is null or c->>'trackingItemId' is distinct from id or c->>'vesselId' is distinct from v or c->>'trackingLinkState'='invalid'
    or (select count(*) from public.ship_dynamics_records where workspace_key=w and collection='trackingItems' and value->>'linkState'='active' and value->>'linkedCaseId'=c->>'id')<>1 then raise exception 'ship-tracking-link-inconsistent' using errcode='22023';end if;
    if c->>'syncToTask'='true' or nullif(c->>'linkedTaskId','') is not null or exists(select 1 from public.ship_dynamics_records where workspace_key=w and collection='tasks' and value->>'internalControlCaseId'=c->>'id') then
     select public.ship_dynamics_record_hydrate_v1(w,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into t from public.ship_dynamics_records r where workspace_key=w and collection='tasks' and entity_id=c->>'linkedTaskId';
     if t is null or c->>'syncToTask' is distinct from 'true' or t->>'internalControlCaseId' is distinct from c->>'id' or t->>'isInternalControl' is distinct from 'true' or t->>'vesselId' is distinct from v or nullif(t->>'sourceMeetingId','') is not null
     or (select count(*) from public.ship_dynamics_records where workspace_key=w and collection='tasks' and value->>'internalControlCaseId'=c->>'id')<>1 then raise exception 'ship-tracking-link-inconsistent' using errcode='22023';end if;
    end if;
    if c->'isClosed' is distinct from s->'isClosed' or coalesce(c->>'closedDate','')<>coalesce(s->>'closedDate','')
    or (t is not null and (t->'isClosed' is distinct from s->'isClosed' or coalesce(t->>'closedDate','')<>coalesce(s->>'closedDate',''))) then raise exception 'ship-tracking-lifecycle-inconsistent' using errcode='22023';end if;
   end if;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',id,'source',s,'item',c,'task',t));
 end loop;
 return result;
end $$;

create or replace function ship_dynamics_tracking_private.live_v1(w text,guards jsonb)
returns boolean language sql volatile security invoker set search_path=pg_catalog,public as $$
 select jsonb_array_length(guards)>0 and not exists(select 1 from jsonb_array_elements(guards) g where not exists(
 select 1 from public.ship_dynamics_edit_locks l where l.workspace_key=w and l.section_key=g->>'section_key' and l.locked_by=g->>'locked_by' and l.lease_version::text=g->>'lease_version' and l.expires_at>clock_timestamp()))
$$;

create or replace function ship_dynamics_tracking_private.lease_v1(w text,v text,a uuid,h uuid,action text,p jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare b ship_dynamics_tracking_private.bundles%rowtype; bid uuid; groups jsonb; ids jsonb; guards jsonb:='[]'; k text; lease jsonb;
 deadline timestamptz; creation boolean; owner text:='ship-tracking:'||a::text||':'||h::text;
begin
 if jsonb_typeof(p->'bundleId') is distinct from 'string' then raise exception 'ship-tracking-bundle-invalid' using errcode='22023';end if;
 bid:=(p->>'bundleId')::uuid;
 perform public.ship_dynamics_record_writer_gate_v1(w,true);
 select * into b from ship_dynamics_tracking_private.bundles where workspace=w and bundle_id=bid for update;
 if found and (b.actor<>a or b.holder<>h or b.vessel<>v) then raise exception 'ship-tracking-bundle-owner' using errcode='22023';end if;
 if action='release' then
  if exists(select 1 from jsonb_object_keys(p) x where x<>'bundleId') then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
  if b.bundle_id is not null then
   delete from public.ship_dynamics_edit_locks l using jsonb_array_elements(b.guards) g where l.workspace_key=w and l.section_key=g->>'section_key' and l.locked_by=g->>'locked_by' and l.lease_version::text=g->>'lease_version';
   delete from ship_dynamics_tracking_private.bundles where workspace=w and bundle_id=bid;
  end if;
  return jsonb_build_object('ok',true,'bundleId',bid);
 end if;
 perform ship_dynamics_tracking_private.read_v1(w,v);
 if action='renew' then
  if exists(select 1 from jsonb_object_keys(p) x where x<>'bundleId') then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
  if b.bundle_id is null or b.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','lease-expired');end if;
  perform 1 from public.ship_dynamics_edit_locks l join jsonb_array_elements(b.guards) g on l.workspace_key=w and l.section_key=g->>'section_key' order by l.section_key for update of l;
  if not ship_dynamics_tracking_private.live_v1(w,b.guards) then return jsonb_build_object('ok',false,'code','lease-expired');end if;
  deadline:=clock_timestamp()+interval '75 seconds';
  update public.ship_dynamics_edit_locks l set expires_at=deadline where l.workspace_key=w and exists(select 1 from jsonb_array_elements(b.guards) g where l.section_key=g->>'section_key' and l.locked_by=g->>'locked_by' and l.lease_version::text=g->>'lease_version');
  update ship_dynamics_tracking_private.bundles set expires_at=deadline where workspace=w and bundle_id=bid;
  return jsonb_build_object('ok',true,'bundleId',bid,'expiresAt',deadline,'leaseMs',greatest(0,floor(extract(epoch from deadline-clock_timestamp())*1000)),'ids',b.ids,'creation',b.creation);
 end if;
 if action<>'claim' or exists(select 1 from jsonb_object_keys(p) x where x not in ('bundleId','ids','creation')) or jsonb_typeof(p->'creation') is distinct from 'boolean' then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
 creation:=(p->>'creation')::boolean;groups:=ship_dynamics_tracking_private.groups_v1(w,v,p->'ids',creation);
 select jsonb_agg(x->'id' order by x->>'id') into ids from jsonb_array_elements(groups) x;
 if b.bundle_id is not null then
  if b.ids is distinct from ids or b.creation is distinct from creation then raise exception 'ship-tracking-bundle-mismatch' using errcode='22023';end if;
  if b.expires_at<=clock_timestamp() or not ship_dynamics_tracking_private.live_v1(w,b.guards) then return jsonb_build_object('ok',false,'code','lease-expired');end if;
  return jsonb_build_object('ok',true,'bundleId',bid,'expiresAt',b.expires_at,'leaseMs',greatest(0,floor(extract(epoch from b.expires_at-clock_timestamp())*1000)),'ids',b.ids,'creation',b.creation,'data',ship_dynamics_tracking_private.read_v1(w,v));
 end if;
 -- Exception subtransaction rolls back ALL partial acquisitions, not only the last leaf.
 begin
  for k in select distinct section from (
   select 'tracking:'||(x->>'id') section from jsonb_array_elements(groups) x
   union all select 'internal-control:'||(x#>>'{item,id}') from jsonb_array_elements(groups) x where x->'item'<>'null'::jsonb
   union all select 'task:'||(x#>>'{task,id}') from jsonb_array_elements(groups) x where x->'task'<>'null'::jsonb
  ) q order by section loop
   lease:=public.claim_ship_dynamics_edit_lock(w,k,owner,'船端跟蹤（未驗證身份）',75);
   if lease->'ok' is distinct from 'true'::jsonb then raise exception 'ship-tracking-locked' using errcode='55P03';end if;
   guards:=guards||jsonb_build_array(ship_dynamics_tracking_private.pick_v1(lease,array['section_key','locked_by','lease_version']));
  end loop;
  deadline:=clock_timestamp()+interval '70 seconds';
  insert into ship_dynamics_tracking_private.bundles values(w,bid,v,a,h,ids,creation,groups,guards,deadline);
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','locked');end;
 return jsonb_build_object('ok',true,'bundleId',bid,'expiresAt',deadline,'leaseMs',greatest(0,floor(extract(epoch from deadline-clock_timestamp())*1000)),'ids',ids,'creation',creation,'data',ship_dynamics_tracking_private.read_v1(w,v));
end $$;

create or replace function ship_dynamics_tracking_private.plan_v1(w text,v text,command jsonb,groups jsonb,op_id text,at_text text,actor text,label text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare input jsonb; s jsonb; c jsonb; t jsonb; original jsonb; group_row jsonb; operations jsonb:='[]'; fields text[]; field text; log_entry jsonb; changes jsonb; before_value jsonb; event_value jsonb; action_name text; reporter text; settings jsonb;
begin
 if command->>'type'='create' then
  if command ? 'importClosures' then
   if jsonb_typeof(command->'importClosures') is distinct from 'array' then raise exception 'ship-tracking-import-closure-invalid' using errcode='22023';end if;
   if (select count(distinct x->>'id') from jsonb_array_elements(command->'importClosures') x)<>jsonb_array_length(command->'importClosures')
    or exists(select 1 from jsonb_array_elements(command->'importClosures') x where jsonb_typeof(x) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(x) k where k not in ('id','date','outcome'))
      or not exists(select 1 from jsonb_array_elements(command->'items') i where i->>'id'=x->>'id')
      or not public.ship_dynamics_tracking_date_v1(x->>'date') or coalesce(x->>'outcome','') not in ('completed','cancelled')) then
    raise exception 'ship-tracking-import-closure-invalid' using errcode='22023';end if;
  end if;
  fields:=ship_dynamics_tracking_private.edit_fields_v1()||array['id','kind','vesselId','progress','deliveryStatus','actualDeliveryDate','source'];
  for input in select x from jsonb_array_elements(command->'items') x loop
   if jsonb_typeof(input) is distinct from 'object' or input->>'vesselId' is distinct from v or exists(select 1 from jsonb_object_keys(input) x where not(x=any(fields))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
   foreach field in array fields loop
    if input ? field and field not in ('source','urgentSubtypes') and (jsonb_typeof(input->field) is distinct from 'string' or length(input->>field)>10000) then raise exception 'ship-tracking-invalid-text' using errcode='22023';end if;
   end loop;
   if input ? 'urgentSubtypes' and (jsonb_typeof(input->'urgentSubtypes') is distinct from 'array' or exists(select 1 from jsonb_array_elements(input->'urgentSubtypes') x where jsonb_typeof(x)<>'string')) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
   s:=jsonb_build_object('expectedDate','','supplementalNotes','','progress','','deliveryStatus','not-delivered','urgency','normal')||input||jsonb_build_object('isClosed',false,'createdBy',actor,'updatedBy',actor,'createdAt',at_text,'updatedAt',at_text,'statusLogs','[]'::jsonb,'events','[]'::jsonb);
   if coalesce(s->>'progress','')<>'' then s:=jsonb_set(s,'{statusLogs}',jsonb_build_array(jsonb_build_object('id',op_id||':'||(s->>'id')||':initial','at',at_text,'by',label,'byUserId',actor,'text',s->>'progress')));end if;
   select x into changes from jsonb_array_elements(coalesce(command->'importClosures','[]')) x where x->>'id'=s->>'id';
   if changes is not null then
    if changes->>'date'<s->>'applicationDate' then raise exception 'ship-tracking-invalid-close-date' using errcode='22023';end if;
    before_value:=jsonb_build_object('isClosed',false,'closedDate','','closedBy','');
    s:=s||jsonb_build_object('isClosed',true,'closedDate',changes->>'date','closedBy',actor);
    if s->>'kind'='engineering' then s:=s||jsonb_build_object('closureOutcome',changes->>'outcome');end if;
    event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':close','operationId',op_id,'action','close','before',before_value,'after',ship_dynamics_tracking_private.pick_v1(s,array['isClosed','closedDate','closedBy']),'byUserId',actor,'at',at_text,'entry','tracking');
    s:=s||jsonb_build_object('events',jsonb_build_array(event_value));
   end if;
   operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','trackingItems','entityId',s->>'id','expected',null,'value',s));
  end loop;
 else
  for input in select x from jsonb_array_elements(case when command->>'type'='lifecycle' then command->'targets' else command->'items' end) x loop
   if exists(select 1 from jsonb_object_keys(input) x where not(x=any(case command->>'type' when 'edit' then array['id','expectedUpdatedAt','changes'] when 'progress' then array['id','expectedUpdatedAt','text'] when 'sync' then array['id','expectedUpdatedAt','item'] when 'delivery' then array['id','expectedUpdatedAt','status','date'] else array['id','expectedUpdatedAt','entry'] end))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
   select x into group_row from jsonb_array_elements(groups) x where x->>'id'=input->>'id';
   original:=group_row->'source';s:=original;c:=nullif(group_row->'item','null');t:=nullif(group_row->'task','null');
   if s->>'updatedAt' is distinct from input->>'expectedUpdatedAt' then raise exception 'ship-tracking-revision-conflict' using errcode='22023';end if;
   if command->>'type' in ('edit','progress','sync') and s->>'isClosed'='true' then raise exception 'ship-tracking-closed-edit' using errcode='22023';end if;
   if command->>'type'='edit' then
    changes:=input->'changes';fields:=ship_dynamics_tracking_private.edit_fields_v1();
    if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) x where not(x=any(fields))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
    foreach field in array fields loop
     if changes ? field and field<>'urgentSubtypes' and (jsonb_typeof(changes->field) is distinct from 'string' or length(changes->>field)>10000) then raise exception 'ship-tracking-invalid-text' using errcode='22023';end if;
    end loop;
    if changes ? 'urgentSubtypes' and (jsonb_typeof(changes->'urgentSubtypes') is distinct from 'array' or exists(select 1 from jsonb_array_elements(changes->'urgentSubtypes') x where jsonb_typeof(x)<>'string')) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
    s:=s||changes;
   elsif command->>'type'='progress' then
    if jsonb_typeof(input->'text') is distinct from 'string' or length(btrim(input->>'text')) not between 1 and 10000 then raise exception 'ship-tracking-empty-progress' using errcode='22023';end if;
    if btrim(input->>'text')=s->>'progress' then continue;end if;
    log_entry:=jsonb_build_object('id',op_id||':'||(s->>'id')||':progress','at',at_text,'by',label,'byUserId',actor,'text',btrim(input->>'text'));
    s:=s||jsonb_build_object('progress',btrim(input->>'text'),'statusLogs',jsonb_build_array(log_entry)||coalesce(s->'statusLogs','[]'));
    if c is not null then
     c:=c||jsonb_build_object('status',s->>'progress','statusLogs',jsonb_build_array(log_entry)||coalesce(c->'statusLogs','[]'),'updatedAt',at_text,'updatedBy',actor);
     if t is not null then t:=t||jsonb_build_object('status',s->>'progress','statusLogs',c->'statusLogs','updatedAt',at_text,'updatedBy',actor);end if;
    end if;
   elsif command->>'type'='delivery' then
    if s->>'kind'<>'supply' or coalesce(input->>'status','') not in ('not-delivered','partially-delivered','delivered') or jsonb_typeof(input->'date') is distinct from 'string' then raise exception 'ship-tracking-delivery-invalid' using errcode='22023';end if;
    before_value:=jsonb_build_object('deliveryStatus',s->>'deliveryStatus','actualDeliveryDate',coalesce(s->>'actualDeliveryDate',''));
    s:=(s-'actualDeliveryDate')||jsonb_build_object('deliveryStatus',input->>'status');
    if input->>'status'='delivered' then s:=s||jsonb_build_object('actualDeliveryDate',input->>'date');end if;
    event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':delivery','operationId',op_id,'action','delivery','before',before_value,'after',jsonb_build_object('deliveryStatus',s->>'deliveryStatus','actualDeliveryDate',coalesce(s->>'actualDeliveryDate','')),'byUserId',actor,'at',at_text,'entry','tracking');
    s:=s||jsonb_build_object('events',coalesce(s->'events','[]')||jsonb_build_array(event_value));
   elsif command->>'type'='lifecycle' then
    action_name:=command->>'action';
    if input->>'entry' is distinct from 'tracking' or coalesce(action_name,'') not in ('close','reopen','correct-close-date') or ((action_name='close')=(s->>'isClosed'='true'))
     or (command ? 'outcome' and coalesce(command->>'outcome','') not in ('completed','cancelled')) then raise exception 'ship-tracking-lifecycle-state' using errcode='22023';end if;
    if action_name<>'reopen' and (not public.ship_dynamics_tracking_date_v1(command->>'date') or command->>'date'<s->>'applicationDate' or command->>'date'<c->>'reportDate') then raise exception 'ship-tracking-invalid-close-date' using errcode='22023';end if;
    before_value:=jsonb_build_object('isClosed',s->'isClosed','closedDate',coalesce(s->>'closedDate',''),'closedBy',coalesce(s->>'closedBy',''));
    s:=(s-array['closedDate','closedBy'])||jsonb_build_object('isClosed',action_name<>'reopen');
    if action_name<>'reopen' then s:=s||jsonb_build_object('closedDate',command->>'date','closedBy',case when action_name='close' then actor else original->>'closedBy' end);end if;
    if action_name='close' and s->>'kind'='engineering' then s:=s||jsonb_build_object('closureOutcome',coalesce(command->>'outcome','completed'));end if;
    event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':'||action_name,'operationId',op_id,'action',action_name,'before',before_value,'after',jsonb_build_object('isClosed',s->'isClosed','closedDate',coalesce(s->>'closedDate',''),'closedBy',coalesce(s->>'closedBy','')),'byUserId',actor,'at',at_text,'entry','tracking');
    s:=s||jsonb_build_object('events',coalesce(s->'events','[]')||jsonb_build_array(event_value));
    if c is not null then
     c:=(c-array['closedDate','closedBy'])||ship_dynamics_tracking_private.pick_v1(s,array['isClosed','closedDate','closedBy'])||jsonb_build_object('updatedAt',at_text,'updatedBy',actor,'trackingLifecycle',coalesce(c->'trackingLifecycle','[]')||jsonb_build_array(event_value));
     if t is not null then t:=(t-array['closedDate','closedBy'])||ship_dynamics_tracking_private.pick_v1(c,array['isClosed','closedDate','closedBy'])||jsonb_build_object('updatedAt',at_text,'updatedBy',actor,'trackingLifecycle',coalesce(t->'trackingLifecycle','[]')||jsonb_build_array(event_value));end if;
    end if;
   elsif command->>'type'='sync' then
    if c is not null or s->>'linkState'='active' then raise exception 'ship-tracking-already-linked' using errcode='22023';end if;
    reporter:=btrim(command->>'reporterNameAndRole');
    if jsonb_typeof(command->'reporterNameAndRole') is distinct from 'string' or length(reporter) not between 1 and 120 then raise exception 'ship-tracking-reporter-required' using errcode='22023';end if;
    changes:=input->'item';fields:=array['id','reportDate','reportSource','description','priority','category','equipmentSubcategory','isAware','status','departments','expectedDate'];
    if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) x where not(x=any(fields)))
     or not(changes ?& array['id','reportDate','reportSource','description','priority','category','isAware','status','departments']) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
    foreach field in array fields loop
     if changes ? field and field not in ('isAware','departments') and (jsonb_typeof(changes->field) is distinct from 'string' or length(changes->>field)>10000) then raise exception 'ship-tracking-invalid-text' using errcode='22023';end if;
    end loop;
    select root->'settings' into settings from public.ship_dynamics_record_workspaces where workspace_key=w;
    if length(changes->>'id') not between 1 and 200 or not public.ship_dynamics_tracking_date_v1(changes->>'reportDate') or (coalesce(changes->>'expectedDate','')<>'' and not public.ship_dynamics_tracking_date_v1(changes->>'expectedDate'))
     or changes->>'reportSource' not in ('日常','訪船','隨船','外部') or changes->>'priority' not in ('急','高','中','低') or not coalesce((settings->'priorities') ? (changes->>'priority'),false)
     or not (changes->>'category'='設備故障' or coalesce((settings->'taskCategories') ? (changes->>'category'),false))
     or (changes->>'category'='設備故障' and not coalesce((settings->'equipmentFailureSubcategories') ? (changes->>'equipmentSubcategory'),false))
     or length(btrim(regexp_replace(changes->>'description','<[^>]*>','','g'))) = 0 or length(btrim(regexp_replace(changes->>'status','<[^>]*>','','g')))=0
     or jsonb_typeof(changes->'isAware') is distinct from 'boolean' or jsonb_typeof(changes->'departments') is distinct from 'array' then raise exception 'ship-tracking-invalid-case' using errcode='22023';end if;
    if jsonb_array_length(changes->'departments')<1 or exists(select 1 from jsonb_array_elements(changes->'departments') d where jsonb_typeof(d)<>'string' or not coalesce((settings->'departments') ? (d#>>'{}'),false)) then raise exception 'ship-tracking-invalid-departments' using errcode='22023';end if;
    if exists(select 1 from public.ship_dynamics_records where workspace_key=w and entity_id=changes->>'id') or exists(select 1 from public.ship_dynamics_record_history where workspace_key=w and entity_id=changes->>'id')
     or exists(select 1 from jsonb_array_elements(operations) x where x->>'entityId'=changes->>'id') then raise exception 'ship-tracking-id-exists' using errcode='22023';end if;
    c:=changes||jsonb_build_object('vesselId',v,'trackingItemId',s->>'id','syncToTask',false,'origin','internal-control','isClosed',false,'description',btrim(changes->>'description')||E'\n\n報告人姓名＋職務：'||reporter,'createdBy',actor,'updatedBy',actor,'createdAt',at_text,'updatedAt',at_text,'statusLogs',jsonb_build_array(jsonb_build_object('id',op_id||':'||(s->>'id')||':case-initial','at',at_text,'by',label,'byUserId',actor,'text',btrim(changes->>'status'))));
    if length(c->>'description')>10000 then raise exception 'ship-tracking-invalid-text' using errcode='22023';end if;
    event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':link','operationId',op_id,'action','link','before',jsonb_build_object('caseId',coalesce(s->>'linkedCaseId',''),'linkState',coalesce(s->>'linkState','')),'after',jsonb_build_object('caseId',c->>'id','linkState','active'),'byUserId',actor,'at',at_text,'entry','tracking');
    s:=s||jsonb_build_object('linkedCaseId',c->>'id','linkState','active','events',coalesce(s->'events','[]')||jsonb_build_array(event_value));
   end if;
   s:=s||jsonb_build_object('updatedAt',at_text,'updatedBy',actor);
   operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','trackingItems','entityId',s->>'id','expected',original,'value',s));
   if c is distinct from nullif(group_row->'item','null') then operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','internalControlCases','entityId',c->>'id','expected',group_row->'item','value',c));end if;
   if t is distinct from nullif(group_row->'task','null') then operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','tasks','entityId',t->>'id','expected',group_row->'task','value',t));end if;
  end loop;
 end if;
 return operations;
end $$;

create or replace function ship_dynamics_tracking_private.submit_v1(w text,v text,a uuid,h uuid,p jsonb,status_only boolean)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
<<submission>>
declare signature jsonb; saved public.ship_dynamics_record_receipts%rowtype; operation_key text; op_id text; bid uuid;
 b ship_dynamics_tracking_private.bundles%rowtype; state_row public.ship_dynamics_record_workspaces%rowtype;
 command jsonb; input jsonb; s jsonb; operations jsonb:='[]'; orders jsonb; ids jsonb; result jsonb; at_text text; actor text:='public-tracking-vessel:'||v;
 label text:='船端跟蹤（未驗證身份）'; failure text; audit_id text; audit_ids jsonb; old_id text; case_ids jsonb:='[]'; new_lease jsonb;
begin
 if exists(select 1 from jsonb_object_keys(p) x where x not in ('bundleId','operationId','command')) or not(p ?& array['bundleId','operationId','command'])
 or jsonb_typeof(p->'operationId') is distinct from 'string' or length(p->>'operationId') not between 1 and 200 or jsonb_typeof(p->'command') is distinct from 'object' then raise exception 'ship-tracking-invalid-request' using errcode='22023';end if;
 op_id:=p->>'operationId';bid:=(p->>'bundleId')::uuid;operation_key:='ship-tracking:'||op_id;
 signature:=jsonb_build_object('endpoint','ship-tracking-public-v1','workspace',w,'vessel',v,'actor',a,'holder',h,'request',p);
 perform ship_dynamics_authority_private.gate_v1();
 select * into saved from public.ship_dynamics_record_receipts where workspace_key=w and operation_id=operation_key;
 if found then
  if saved.signature is distinct from signature then raise exception 'ship-tracking-operation-mismatch' using errcode='22023';end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 if status_only then return jsonb_build_object('ok',false,'status','not-found','operationId',op_id);end if;
 perform public.ship_dynamics_record_writer_gate_v1(w,true);
 perform pg_advisory_xact_lock(hashtext('record-operation:'||w),hashtext(operation_key));
 select * into saved from public.ship_dynamics_record_receipts where workspace_key=w and operation_id=operation_key;
 if found then
  if saved.signature is distinct from signature then raise exception 'ship-tracking-operation-mismatch' using errcode='22023';end if;
  return saved.result||jsonb_build_object('replayed',true);
 end if;
 begin
  perform ship_dynamics_tracking_private.read_v1(w,v);
  select * into strict state_row from public.ship_dynamics_record_workspaces where workspace_key=w for no key update;
  select * into b from ship_dynamics_tracking_private.bundles where workspace=w and bundle_id=bid for update;
  if not found or b.actor<>a or b.holder<>h or b.vessel<>v or b.expires_at<=clock_timestamp() then raise exception 'ship-tracking-lease-expired' using errcode='22023';end if;
  perform 1 from public.ship_dynamics_edit_locks l join jsonb_array_elements(b.guards) g on l.workspace_key=w and l.section_key=g->>'section_key' order by l.section_key for update of l;
  if not ship_dynamics_tracking_private.live_v1(w,b.guards) then raise exception 'ship-tracking-lease-expired' using errcode='22023';end if;
  if b.groups is distinct from ship_dynamics_tracking_private.groups_v1(w,v,b.ids,b.creation) then raise exception 'ship-tracking-revision-conflict' using errcode='22023';end if;
  command:=p->'command';
  if coalesce(command->>'type','') not in ('create','edit','progress','sync','delivery','lifecycle') or b.creation is distinct from (command->>'type'='create') then raise exception 'ship-tracking-command-invalid' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(command) x where not(x=any(case command->>'type' when 'lifecycle' then array['type','targets','action','date','outcome'] when 'sync' then array['type','items','reporterNameAndRole'] when 'create' then array['type','items','importClosures'] else array['type','items'] end)))
   or jsonb_typeof(case when command->>'type'='lifecycle' then command->'targets' else command->'items' end) is distinct from 'array' then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
  select jsonb_agg(x->'id' order by x->>'id') into ids from jsonb_array_elements(case when command->>'type'='lifecycle' then command->'targets' else command->'items' end) x;
  if ids is null or jsonb_array_length(ids) not between 1 and 100 or not(b.ids @> ids) or (b.creation and ids is distinct from b.ids)
   or (select count(distinct x) from jsonb_array_elements_text(ids) x)<>jsonb_array_length(ids) then raise exception 'ship-tracking-selection-mismatch' using errcode='22023';end if;
  at_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  operations:=ship_dynamics_tracking_private.plan_v1(w,v,command,b.groups,op_id,at_text,actor,label);
  select coalesce(jsonb_agg(o->'entityId'),'[]') into case_ids from jsonb_array_elements(operations) o where o->>'collection'='internalControlCases' and o->'expected'='null'::jsonb;
  for old_id in select x from jsonb_array_elements_text(case_ids) x order by x loop
   new_lease:=public.claim_ship_dynamics_edit_lock(w,'internal-control:'||old_id,'ship-tracking:'||a::text||':'||h::text,label,75);
   if new_lease->'ok' is distinct from 'true'::jsonb then raise exception 'ship-tracking-locked' using errcode='22023';end if;
   b.guards:=b.guards||jsonb_build_array(ship_dynamics_tracking_private.pick_v1(new_lease,array['section_key','locked_by','lease_version']));
  end loop;
  if jsonb_array_length(case_ids)>0 then update ship_dynamics_tracking_private.bundles set guards=b.guards where workspace=w and bundle_id=bid;end if;
  failure:=public.ship_dynamics_tracking_validate_v1(w,operations,actor,jsonb_build_object('actor',jsonb_build_object('role','public-tracking-service'),'visibleVesselIds',jsonb_build_array(v),'effectivePermissions',jsonb_build_object('createTasks',true,'editBusinessContent',true,'closeTasks',true)),b.guards);
  if failure is not null then raise exception '%',failure using errcode='22023';end if;
  select coalesce(jsonb_object_agg(collection,c.ids),'{}') into orders from public.ship_dynamics_record_collections c where workspace_key=w;
  if b.creation then orders:=jsonb_set(orders,'{trackingItems}',coalesce(orders->'trackingItems','[]')||ids,true);end if;
  if jsonb_array_length(case_ids)>0 then orders:=jsonb_set(orders,'{internalControlCases}',case_ids||coalesce(orders->'internalControlCases','[]'),true);end if;
  audit_id:='ship-tracking-audit:'||op_id;
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','auditLogs','entityId',audit_id,'value',jsonb_build_object('id',audit_id,'at',at_text,'actorId',actor,'actorName',label,'actorRole','vessel','action','船端跟蹤：'||(command->>'type'),'entityType','tracking','entityId',v,'detail','操作 '||op_id||'；選船僅作操作範圍，未驗證身份')));
  audit_ids:=jsonb_build_array(audit_id)||coalesce(orders->'auditLogs','[]');
  for old_id in select x from jsonb_array_elements_text(audit_ids) with ordinality q(x,n) where n>500 loop operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','auditLogs','entityId',old_id,'value',null));end loop;
  select jsonb_agg(x order by n) into audit_ids from jsonb_array_elements(audit_ids) with ordinality q(x,n) where n<=500;
  orders:=jsonb_set(orders,'{auditLogs}',audit_ids,true);
  result:=public.ship_dynamics_record_commit_validated_v1(w,operations,state_row.root,orders,label,operation_key,signature);
  result:=result||jsonb_build_object('protocol','ship-tracking-public-v1','workspace',w,'vesselId',v,'operationId',op_id,'ids',ids,'bundleId',bid,'caseIds',case_ids);
  update public.ship_dynamics_record_receipts r set result=submission.result where r.workspace_key=w and r.operation_id=operation_key;
  return result;
 exception when sqlstate '22023' then
  get stacked diagnostics failure=message_text;
  result:=jsonb_build_object('ok',false,'status','rejected','protocol','ship-tracking-public-v1','workspace',w,'vesselId',v,'operationId',op_id,'bundleId',bid,'code',failure,'replayed',false);
  insert into public.ship_dynamics_record_receipts values(w,operation_key,signature,result);
  return result;
 end;
end $$;

create or replace function public.ship_dynamics_tracking_public_v1(
 p_workspace_key text,p_vessel_id text,p_actor_key uuid,p_holder uuid,p_action text,p_payload jsonb
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
 if p_workspace_key is null or p_workspace_key='' or length(p_workspace_key)>200 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'ship-tracking-invalid-request' using errcode='22023';end if;
 if p_action='read' and p_payload='{}'::jsonb then return ship_dynamics_tracking_private.read_v1(p_workspace_key,p_vessel_id);end if;
 if p_actor_key is null or p_holder is null or p_vessel_id is null or p_vessel_id='' or length(p_vessel_id)>200 or octet_length(p_payload::text)>2000000 then raise exception 'ship-tracking-invalid-request' using errcode='22023';end if;
 if p_action in ('claim','renew','release') then return ship_dynamics_tracking_private.lease_v1(p_workspace_key,p_vessel_id,p_actor_key,p_holder,p_action,p_payload);end if;
 if p_action in ('submit','receipt') then return ship_dynamics_tracking_private.submit_v1(p_workspace_key,p_vessel_id,p_actor_key,p_holder,p_payload,p_action='receipt');end if;
 raise exception 'ship-tracking-invalid-action' using errcode='22023';
end $$;
revoke all on all functions in schema ship_dynamics_tracking_private from public,anon,authenticated,service_role;
revoke all on function public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
