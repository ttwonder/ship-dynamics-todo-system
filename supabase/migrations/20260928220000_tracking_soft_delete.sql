-- Additive retained-source soft deletion and anonymous ship requests.
-- Install after 20260928180000_tracking_reclassification.sql. No business-row rewrite.
-- Existing RPC JSON signatures, leases, CAS, authority gates and receipts are retained.
begin;
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $$ begin
 if to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)')) not in ('a9e4ddcf3e24ecd3b39181bec343f70f','dadd88ea4bd19b490035ce20293e0182') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)')) not in ('6acaf632e93142adc7d5137341352ac1','44b9e1d7ac2b62faa3cd72d2801e15e3') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.submit_v1(text,text,uuid,uuid,jsonb,boolean)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.submit_v1(text,text,uuid,uuid,jsonb,boolean)')) not in ('9b1efe1e226db0fe596be32a3221bab8','691c2196056262fd6b0ee41688873eaf') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.request_kind_v1(text)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.request_kind_v1(text)')) not in ('db224d273d95acd55dc14284ae1b2af5') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.request_label_v1(text)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.request_label_v1(text)')) not in ('551f268ac78ec0ffe3e5d4b194a1b59d') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.classification_value_v1(jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.classification_value_v1(jsonb)')) not in ('9d158b013a3a2804f72a3fce9e372987') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.type_description_v1(text,jsonb,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.type_description_v1(text,jsonb,jsonb)')) not in ('3830bb5ab2d9456e519a8f9988dcde4f') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.reclassify_event_v1(jsonb,jsonb,text,text,text)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.reclassify_event_v1(jsonb,jsonb,text,text,text)')) not in ('400bbf1fd76a331167d5065b2d7b82b0') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.reclassify_link_v1(jsonb,jsonb,jsonb,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.reclassify_link_v1(jsonb,jsonb,jsonb,jsonb)')) not in ('6c7bfe2b15644896d338d83e7e43d57c') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.read_v1(text,text)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.read_v1(text,text)')) not in ('ee5722007c0fcfb1dcb0e2fc9a837f2d','ab7f28a13f51bfba81ff8414ede43327') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.groups_v1(text,text,jsonb,boolean)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.groups_v1(text,text,jsonb,boolean)')) not in ('e0193cc06b0882794e08b86e55c1bb0c') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('ship_dynamics_tracking_private.lease_v1(text,text,uuid,uuid,text,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.lease_v1(text,text,uuid,uuid,text,jsonb)')) not in ('bd9382e95dd5ee0768d14805bc06575a') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_public_v1(text,text,uuid,uuid,text,jsonb)')) not in ('d6f7b0a4c775198cef8d0e7f59492097') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v2(text,jsonb,jsonb)')) not in ('5899b3d72fac5f013cefca5acf3c6563','490ee92796ce0897f11968846ebdcd8d') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)') is null then raise exception 'tracking-soft-delete-prerequisites-missing';end if;
 if (select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid=to_regprocedure('public.read_ship_dynamics_tracking_statistics_public_v1(text,jsonb,jsonb)')) not in ('132373bc016ed5b5502f746220fc9d04','1413af92306985312ef9a35f06a6d978') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.deletion_value_v1(jsonb)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))<>'55e8b5a5d463fc81c9b18cec6278d812') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.apply_deletion_v1(jsonb,text,text,text,text,text)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))<>'e52ab08eaad1f388b56c841ca1113769') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
 if exists(select 1 from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.validate_deletion_v1(text,jsonb,text,jsonb)') and md5(replace(prosrc,chr(13)||chr(10),chr(10)))<>'a1c88a4e9d33b540a11496c2d83048c2') then raise exception 'tracking-soft-delete-predecessor-mismatch';end if;
end $$;

create or replace function ship_dynamics_tracking_private.deletion_value_v1(s jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('deletion',s->'deletion','deletionRequest',s->'deletionRequest')
$$;

create or replace function ship_dynamics_tracking_private.apply_deletion_v1(b jsonb,action_name text,reason text,actor text,at_text text,op_id text)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare n jsonb:=b; event_value jsonb;
begin
 -- ECMAScript trim whitespace, including non-ASCII spaces, without changing the request signature.
 reason:=btrim(reason,E' \t\n\r\v\f'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
 if reason is null or length(reason) not between 1 and 500 or coalesce(actor,'')='' or coalesce(at_text,'')='' or coalesce(op_id,'')='' or length(op_id)>200 then raise exception 'tracking-deletion-invalid' using errcode='22023';end if;
 -- Match JS string.length: astral Unicode code points occupy two UTF-16 units.
 if length(reason)+(select count(*) from regexp_split_to_table(reason,'') c where ascii(c)>65535)>500 then raise exception 'tracking-deletion-invalid' using errcode='22023';end if;
 if action_name='delete' then
  if b ? 'deletion' then raise exception 'tracking-already-deleted' using errcode='22023';end if;
  n:=n||jsonb_build_object('deletion',jsonb_build_object('at',at_text,'byUserId',actor,'reason',reason));
  if b#>>'{deletionRequest,status}'='pending' then n:=jsonb_set(n,'{deletionRequest}',(b->'deletionRequest')||jsonb_build_object('status','approved','reviewedAt',at_text,'reviewedBy',actor,'reviewReason',reason));end if;
 elsif action_name='restore' then
  if not(b ? 'deletion') then raise exception 'tracking-not-deleted' using errcode='22023';end if;
  n:=n-'deletion';
 elsif action_name='request-delete' then
  if b ? 'deletion' or b#>>'{deletionRequest,status}'='pending' then raise exception 'tracking-deletion-request-state' using errcode='22023';end if;
  n:=n||jsonb_build_object('deletionRequest',jsonb_build_object('at',at_text,'byUserId',actor,'reason',reason,'status','pending'));
 elsif action_name='reject-delete' then
  if b ? 'deletion' or b#>>'{deletionRequest,status}' is distinct from 'pending' then raise exception 'tracking-deletion-request-state' using errcode='22023';end if;
  n:=jsonb_set(n,'{deletionRequest}',(b->'deletionRequest')||jsonb_build_object('status','rejected','reviewedAt',at_text,'reviewedBy',actor,'reviewReason',reason));
 else raise exception 'tracking-deletion-invalid' using errcode='22023';end if;
 event_value:=jsonb_build_object('id',op_id||':'||(b->>'id')||':'||action_name,'operationId',op_id,'action',action_name,
  'before',ship_dynamics_tracking_private.deletion_value_v1(b),'after',ship_dynamics_tracking_private.deletion_value_v1(n)||jsonb_build_object('reason',reason),'byUserId',actor,'at',at_text,'entry','tracking');
 return n||jsonb_build_object('updatedAt',at_text,'updatedBy',actor,'events',coalesce(b->'events','[]')||jsonb_build_array(event_value));
end $$;

create or replace function ship_dynamics_tracking_private.validate_deletion_v1(w text,ops jsonb,actor text,guard_value jsonb)
returns text language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare o jsonb; b jsonb; n jsonb; e jsonb; canonical jsonb; old_events jsonb; new_events jsonb; c jsonb; failure text; action_name text; selected_count integer;
begin
 for o in select x from jsonb_array_elements(ops) x where x->>'kind'='entity' and x->>'collection'='trackingItems' loop
  b:=nullif(o->'expected','null');n:=nullif(o->'value','null');
  if n is null then continue;end if; -- Existing hard-delete denial remains authoritative.
  if b is null then
   if n ?| array['deletion','deletionRequest'] or exists(select 1 from jsonb_array_elements(coalesce(n->'events','[]')) x where x->>'action' in ('delete','restore','request-delete','reject-delete')) then return 'tracking-deletion-forged';end if;
   continue;
  end if;
  old_events:=coalesce(b->'events','[]');new_events:=coalesce(n->'events','[]');
  if jsonb_typeof(new_events) is distinct from 'array' then return 'tracking-history-immutable';end if;
  if b->'deletion' is distinct from n->'deletion' or (b ? 'deletion') is distinct from (n ? 'deletion')
   or b->'deletionRequest' is distinct from n->'deletionRequest' or (b ? 'deletionRequest') is distinct from (n ? 'deletionRequest')
   or exists(select 1 from jsonb_array_elements(new_events) with ordinality x(v,k) where k>jsonb_array_length(old_events) and v->>'action' in ('delete','restore','request-delete','reject-delete')) then
   e:=new_events->-1;action_name:=e->>'action';
   if coalesce(action_name,'') not in ('delete','restore','request-delete','reject-delete') then return 'tracking-deletion-event-required';end if;
   if (guard_value#>>'{actor,role}'='public-tracking-service') is distinct from (action_name='request-delete') then return 'tracking-deletion-permission-denied';end if;
   if action_name='request-delete' and actor is distinct from 'public-tracking-vessel:'||(b->>'vesselId') then return 'tracking-deletion-permission-denied';end if;
   if jsonb_typeof(e#>'{after,reason}') is distinct from 'string' or jsonb_typeof(e->'operationId') is distinct from 'string'
    or jsonb_typeof(n->'updatedAt') is distinct from 'string' then return 'tracking-deletion-event-invalid';end if;
   begin canonical:=ship_dynamics_tracking_private.apply_deletion_v1(b,action_name,e#>>'{after,reason}',actor,n->>'updatedAt',e->>'operationId');
   exception when sqlstate '22023' then get stacked diagnostics failure=message_text;return failure;end;
   if n is distinct from canonical then return 'tracking-deletion-event-invalid';end if;
   -- A dedicated batch has only selected source mutations and optional existing audit bookkeeping.
   -- Linked endpoints, business fields, orders and other source actions cannot piggyback.
   select count(*) into selected_count from jsonb_array_elements(ops) x where x->>'kind'='entity' and x->>'collection'='trackingItems';
   if selected_count not between 1 and 100 or selected_count<>(select count(distinct x->>'entityId') from jsonb_array_elements(ops) x where x->>'kind'='entity' and x->>'collection'='trackingItems')
    or exists(select 1 from jsonb_array_elements(ops) x where coalesce(x->>'collection','')<>'auditLogs' and
     (x->>'kind' is distinct from 'entity' or x->>'collection' is distinct from 'trackingItems' or x#>>'{value,events,-1,action}' is distinct from action_name
      or x#>>'{value,events,-1,operationId}' is distinct from e->>'operationId')) then return 'tracking-deletion-mixed-command';end if;
  elsif b ? 'deletion' then
   -- Retained sources may follow genuine case/task lifecycle only, never direct tracking edits.
   e:=new_events->-1;
   if new_events is distinct from old_events||jsonb_build_array(e) or coalesce(e->>'entry','') not in ('internal-control','task')
    or coalesce(e->>'action','') not in ('close','reopen','correct-close-date','invalidate-link')
    or e->>'byUserId' is distinct from actor or n->>'updatedBy' is distinct from actor or e->>'at' is distinct from n->>'updatedAt'
    or coalesce(e->>'operationId','')='' or e->>'id' is distinct from (e->>'operationId')||':'||(b->>'id')||':'||(e->>'action')
    or (b-array['isClosed','closedDate','closedBy','closureOutcome','linkState','events','updatedAt','updatedBy']) is distinct from (n-array['isClosed','closedDate','closedBy','closureOutcome','linkState','events','updatedAt','updatedBy']) then return 'tracking-deleted-edit-forbidden';end if;
   select value into c from public.ship_dynamics_records where workspace_key=w and collection='internalControlCases' and entity_id=b->>'linkedCaseId';
   if b->>'linkState' is distinct from 'active' or c is null or not exists(select 1 from jsonb_array_elements(ops) x where x->>'kind'='entity' and
    ((x->>'collection'='internalControlCases' and x->>'entityId'=c->>'id') or (x->>'collection'='tasks' and x->>'entityId'=c->>'linkedTaskId'))) then return 'tracking-deleted-edit-forbidden';end if;
   if e->>'action'='invalidate-link' then
    if (b-array['linkState','events','updatedAt','updatedBy']) is distinct from (n-array['linkState','events','updatedAt','updatedBy']) or n->>'linkState' is distinct from 'invalid'
     or not exists(select 1 from jsonb_array_elements(ops) x where x->>'kind'='entity' and x->'value'='null'::jsonb and
      ((x->>'collection'='internalControlCases' and x->>'entityId'=c->>'id') or (x->>'collection'='tasks' and x->>'entityId'=c->>'linkedTaskId'))) then return 'tracking-deleted-edit-forbidden';end if;
   else
    if b->'linkState' is distinct from n->'linkState' or (b->'isClosed' is not distinct from n->'isClosed' and b->'closedDate' is not distinct from n->'closedDate')
     or e->>'action' is distinct from (case when n->>'isClosed'='false' then 'reopen' when b->>'isClosed'='true' then 'correct-close-date' else 'close' end)
     or e->'before' is distinct from jsonb_build_object('isClosed',b->'isClosed','closedDate',coalesce(b->>'closedDate',''),'closedBy',coalesce(b->>'closedBy',''))
     or e->'after' is distinct from jsonb_build_object('isClosed',n->'isClosed','closedDate',coalesce(n->>'closedDate',''),'closedBy',coalesce(n->>'closedBy','')) then return 'tracking-deleted-edit-forbidden';end if;
   end if;
  end if;
 end loop;
 return null;
end $$;

create or replace function public.ship_dynamics_tracking_validate_v1(p_workspace text,p_ops jsonb,p_actor text,p_guard jsonb,p_locks jsonb)
returns text language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare op jsonb; b jsonb; n jsonb; permission_name text; g jsonb; source_id text; c jsonb; t jsonb; old_c jsonb; f text; old_events jsonb; new_events jsonb; old_logs jsonb; new_logs jsonb; reclassify_count integer; reclassifying boolean; old_t jsonb; canonical_c jsonb; canonical_t jsonb;
begin
 f:=ship_dynamics_tracking_private.validate_deletion_v1(p_workspace,p_ops,p_actor,p_guard);
 if f is not null then return f;end if;
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
  if b is not null and (b->'vesselId' is distinct from n->'vesselId' or b->'id' is distinct from n->'id' or b->'createdAt' is distinct from n->'createdAt' or b->'createdBy' is distinct from n->'createdBy') then return 'tracking-identity-immutable';end if;
  old_events:=coalesce(b->'events','[]');new_events:=coalesce(n->'events','[]');old_logs:=coalesce(b->'statusLogs','[]');new_logs:=n->'statusLogs';
  if jsonb_typeof(new_events)<>'array' or jsonb_array_length(new_events)<jsonb_array_length(old_events) or exists(select 1 from jsonb_array_elements(old_events) with ordinality e(v,k) where v is distinct from new_events->(k::int-1)) then return 'tracking-history-immutable';end if;
  if jsonb_array_length(new_logs)<jsonb_array_length(old_logs) or exists(select 1 from jsonb_array_elements(old_logs) with ordinality e(v,k) where v is distinct from new_logs->(jsonb_array_length(new_logs)-jsonb_array_length(old_logs)+k::int-1)) then return 'tracking-history-immutable';end if;
  -- A classification correction is bound to exact before/after snapshots, actor,
  -- clock and operation identity. Old history is a prefix, never reconstructed.
  select count(*) into reclassify_count from jsonb_array_elements(new_events) with ordinality e(v,k)
   where k>jsonb_array_length(old_events) and v->>'action'='reclassify';
  if (b is not null and (b->'kind' is distinct from n->'kind' or b->'requestType' is distinct from n->'requestType')) or reclassify_count>0 then
   if b is null or reclassify_count<>1 then return 'tracking-reclassify-event-required';end if;
   select v into g from jsonb_array_elements(new_events) with ordinality e(v,k) where k>jsonb_array_length(old_events) and v->>'action'='reclassify';
   if b->>'isClosed'='true' or n->>'isClosed'='true' then return 'tracking-closed-reclassify';end if;
   if ship_dynamics_tracking_private.request_kind_v1(n->>'requestType') is distinct from n->>'kind' then return 'tracking-request-type-kind';end if;
   if jsonb_typeof(g->'operationId') is distinct from 'string' or length(g->>'operationId') not between 1 and 200
    or jsonb_typeof(n->'updatedAt') is distinct from 'string' or coalesce(n->>'updatedAt','')=''
    or n->>'updatedBy' is distinct from p_actor or new_events->-1 is distinct from g
    or g is distinct from ship_dynamics_tracking_private.reclassify_event_v1(b,n,g->>'operationId',n->>'updatedAt',p_actor) then return 'tracking-reclassify-event-invalid';end if;
   if (b-array['kind','requestType','completionDate','actualDeliveryDate','deliveryStatus','events','updatedAt','updatedBy','referenceNo','description','applicationDate','originalItemNo','subitemNo','urgency','urgentSubtypes','purchaseNos','materialCategory','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','originalRemarks','supplementalNotes','expectedDate','progress','statusLogs'])
    is distinct from (n-array['kind','requestType','completionDate','actualDeliveryDate','deliveryStatus','events','updatedAt','updatedBy','referenceNo','description','applicationDate','originalItemNo','subitemNo','urgency','urgentSubtypes','purchaseNos','materialCategory','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','originalRemarks','supplementalNotes','expectedDate','progress','statusLogs']) then return 'tracking-reclassify-overwrites-source';end if;
   -- Cross-kind and explicit same-type corrections are dedicated operations.
   -- A same-kind type change may also be an ordinary edit of source-owned fields.
   if b->'kind' is distinct from n->'kind' or b->'requestType' is not distinct from n->'requestType' then
    if (b-(array['kind','requestType','deliveryStatus','events','updatedAt','updatedBy']||case when n->>'kind'='supply' then array['actualDeliveryDate'] else array['completionDate'] end))
     is distinct from (n-(array['kind','requestType','deliveryStatus','events','updatedAt','updatedBy']||case when n->>'kind'='supply' then array['actualDeliveryDate'] else array['completionDate'] end))
     or new_events is distinct from old_events||jsonb_build_array(g) then return 'tracking-reclassify-overwrites-source';end if;
    f:=case when n->>'kind'='supply' then 'actualDeliveryDate' else 'completionDate' end;
    if jsonb_typeof(n->f) is distinct from 'string'
     or (n->>'kind'='supply' and (n->>'deliveryStatus'='delivered') is distinct from (coalesce(n->>'actualDeliveryDate','')<>''))
     or (n->>'kind'='engineering' and n->'deliveryStatus' is distinct from b->'deliveryStatus') then return 'tracking-reclassify-delivery';end if;
   end if;
  end if;
  if b is not null and b->'progress' is distinct from n->'progress' then
   if reclassify_count>0 and jsonb_array_length(new_logs)<>jsonb_array_length(old_logs)+1 then return 'tracking-progress-history-required';end if;
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
  g:=null;
  select v into g from jsonb_array_elements(coalesce(n->'events','[]')) with ordinality e(v,k) where k>jsonb_array_length(coalesce(b->'events','[]')) and v->>'action'='reclassify';
  reclassifying:=g is not null;
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
   if reclassifying then
    if old_c is null or b->>'linkState' is distinct from 'active' or old_c->>'isClosed'='true' then return 'tracking-closed-or-new-reclassify-link';end if;
    canonical_c:=old_c;
    old_t:=null;
    if t is not null then
     select public.ship_dynamics_record_hydrate_v1(p_workspace,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into old_t
      from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='tasks' and r.entity_id=old_c->>'linkedTaskId';
     if old_t is null or old_t->>'isClosed'='true' then return 'tracking-closed-or-new-reclassify-link';end if;
    end if;
    canonical_t:=old_t;
    if n->'progress' is distinct from b->'progress' then
     canonical_c:=canonical_c||jsonb_build_object('status',n->>'progress','statusLogs',jsonb_build_array(n#>'{statusLogs,0}')||coalesce(old_c->'statusLogs','[]'));
     if old_t is not null then canonical_t:=canonical_t||jsonb_build_object('status',n->>'progress','statusLogs',canonical_c->'statusLogs');end if;
    end if;
    canonical_c:=ship_dynamics_tracking_private.reclassify_link_v1(canonical_c,b,n,g);
    canonical_t:=ship_dynamics_tracking_private.reclassify_link_v1(canonical_t,b,n,g);
    if c is distinct from canonical_c or not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'kind'='entity' and o->>'collection'='internalControlCases' and o->>'entityId'=old_c->>'id' and o->'expected'=old_c)
     or (t is not null and (t is distinct from canonical_t or not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'kind'='entity' and o->>'collection'='tasks' and o->>'entityId'=old_t->>'id' and o->'expected'=old_t))) then return 'tracking-reclassify-link-not-converged';end if;
    if not exists(select 1 from jsonb_array_elements(p_locks) l where l->>'section_key'='internal-control:'||(c->>'id'))
     or (t is not null and not exists(select 1 from jsonb_array_elements(p_locks) l where l->>'section_key'='task:'||(t->>'id'))) then return 'tracking-reclassify-link-lock-required';end if;
   end if;
   if b is not null and n->'progress' is distinct from b->'progress' then
    if c->'status' is distinct from n->'progress' or c#>'{statusLogs,0}' is distinct from n#>'{statusLogs,0}' or (t is not null and (t->'status' is distinct from n->'progress' or t->'statusLogs' is distinct from c->'statusLogs')) then return 'tracking-progress-not-converged';end if;
    if not reclassifying and not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'collection'='internalControlCases' and o->>'kind'='entity' and o->>'entityId'=c->>'id' and ((o->'expected')-array['status','statusLogs','updatedAt','updatedBy'])=((o->'value')-array['status','statusLogs','updatedAt','updatedBy'])) then return 'tracking-progress-overwrites-basic';end if;
    if not reclassifying and t is not null and not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'collection'='tasks' and o->>'kind'='entity' and o->>'entityId'=t->>'id' and ((o->'expected')-array['status','statusLogs','updatedAt','updatedBy'])=((o->'value')-array['status','statusLogs','updatedAt','updatedBy'])) then return 'tracking-progress-overwrites-basic';end if;
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
   if exists(select 1 from jsonb_object_keys(input) x where not(x=any(case command->>'type' when 'request-delete' then array['id','expectedUpdatedAt','reason'] when 'reclassify' then array['id','expectedUpdatedAt','requestType','actualDate','deliveryStatus'] when 'edit' then array['id','expectedUpdatedAt','changes'] when 'progress' then array['id','expectedUpdatedAt','text'] when 'sync' then array['id','expectedUpdatedAt','item'] when 'delivery' then array['id','expectedUpdatedAt','status','date'] else array['id','expectedUpdatedAt','entry'] end))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
   select x into group_row from jsonb_array_elements(groups) x where x->>'id'=input->>'id';
   original:=group_row->'source';s:=original;c:=nullif(group_row->'item','null');t:=nullif(group_row->'task','null');
   if s->>'updatedAt' is distinct from input->>'expectedUpdatedAt' then raise exception 'ship-tracking-revision-conflict' using errcode='22023';end if;
   if s ? 'deletion' then raise exception 'tracking-deleted-edit-forbidden' using errcode='22023';end if;
   if command->>'type'='request-delete' then
    if not(input ?& array['id','expectedUpdatedAt','reason']) or exists(select 1 from jsonb_each(input) e where jsonb_typeof(e.value) is distinct from 'string') then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
    s:=ship_dynamics_tracking_private.apply_deletion_v1(original,'request-delete',input->>'reason',actor,at_text,op_id);
    operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','trackingItems','entityId',s->>'id','expected',original,'value',s));
    continue;
   end if;
   if command->>'type' in ('edit','progress','sync','reclassify') and s->>'isClosed'='true' then raise exception 'ship-tracking-closed-edit' using errcode='22023';end if;
   if command->>'type'='edit' then
    changes:=input->'changes';fields:=ship_dynamics_tracking_private.edit_fields_v1();
    if jsonb_typeof(changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(changes) x where not(x=any(fields))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
    foreach field in array fields loop
     if changes ? field and field<>'urgentSubtypes' and (jsonb_typeof(changes->field) is distinct from 'string' or length(changes->>field)>10000) then raise exception 'ship-tracking-invalid-text' using errcode='22023';end if;
    end loop;
    if changes ? 'urgentSubtypes' and (jsonb_typeof(changes->'urgentSubtypes') is distinct from 'array' or exists(select 1 from jsonb_array_elements(changes->'urgentSubtypes') x where jsonb_typeof(x)<>'string')) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
    -- Basic edits may include latest progress, but still own only source fields.
    if changes ? 'progress' and btrim(changes->>'progress') is distinct from s->>'progress' then
     if length(btrim(changes->>'progress')) not between 1 and 10000 or c->>'isClosed'='true' or t->>'isClosed'='true' then raise exception 'ship-tracking-empty-or-closed-progress' using errcode='22023';end if;
     log_entry:=jsonb_build_object('id',op_id||':'||(s->>'id')||':progress','at',at_text,'by',label,'byUserId',actor,'text',btrim(changes->>'progress'));
     s:=s||jsonb_build_object('progress',btrim(changes->>'progress'),'statusLogs',jsonb_build_array(log_entry)||coalesce(s->'statusLogs','[]'));
     if c is not null then
      c:=c||jsonb_build_object('status',s->>'progress','statusLogs',jsonb_build_array(log_entry)||coalesce(c->'statusLogs','[]'),'updatedAt',at_text,'updatedBy',actor);
      if t is not null then t:=t||jsonb_build_object('status',s->>'progress','statusLogs',c->'statusLogs','updatedAt',at_text,'updatedBy',actor);end if;
     end if;
    end if;
    if changes ? 'actualDeliveryDate' and coalesce(changes->>'actualDeliveryDate','')=coalesce(original->>'actualDeliveryDate','') then changes:=changes-'actualDeliveryDate';end if;
    s:=s||(changes-'progress');
    if s->>'kind'='supply' and s->'actualDeliveryDate' is distinct from original->'actualDeliveryDate' then
     before_value:=jsonb_build_object('deliveryStatus',original->>'deliveryStatus','actualDeliveryDate',coalesce(original->>'actualDeliveryDate',''));
     s:=s||jsonb_build_object('deliveryStatus',case when coalesce(s->>'actualDeliveryDate','')<>'' then 'delivered' else 'not-delivered' end);
     event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':delivery','operationId',op_id,'action','delivery','before',before_value,'after',jsonb_build_object('deliveryStatus',s->>'deliveryStatus','actualDeliveryDate',coalesce(s->>'actualDeliveryDate','')),'byUserId',actor,'at',at_text,'entry','tracking');
     s:=s||jsonb_build_object('events',coalesce(s->'events','[]')||jsonb_build_array(event_value));
    end if;
    if s->>'kind'='engineering' and coalesce(s->>'completionDate','')<>coalesce(original->>'completionDate','') then
     event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':completion','operationId',op_id,'action','completion','before',jsonb_build_object('completionDate',coalesce(original->>'completionDate','')),'after',jsonb_build_object('completionDate',coalesce(s->>'completionDate','')),'byUserId',actor,'at',at_text,'entry','tracking');
     s:=s||jsonb_build_object('events',coalesce(s->'events','[]')||jsonb_build_array(event_value));
    end if;
   elsif command->>'type'='reclassify' then
    fields:=array['id','expectedUpdatedAt','requestType','actualDate','deliveryStatus'];
    if not(input ?& fields) or exists(select 1 from jsonb_each(input) e where jsonb_typeof(e.value) is distinct from 'string' or length(e.value#>>'{}')>10000)
     or ship_dynamics_tracking_private.request_kind_v1(input->>'requestType') is null
     or input->>'deliveryStatus' not in ('not-delivered','partially-delivered','delivered')
     or (input->>'actualDate'<>'' and not public.ship_dynamics_tracking_date_v1(input->>'actualDate')) then raise exception 'ship-tracking-reclassify-invalid' using errcode='22023';end if;
    if c->>'isClosed'='true' or t->>'isClosed'='true' then raise exception 'ship-tracking-closed-edit' using errcode='22023';end if;
    s:=s||jsonb_build_object('kind',ship_dynamics_tracking_private.request_kind_v1(input->>'requestType'),'requestType',input->>'requestType');
    if s->>'kind'='supply' then
     if (input->>'deliveryStatus'='delivered') is distinct from (input->>'actualDate'<>'') then raise exception 'ship-tracking-reclassify-delivery' using errcode='22023';end if;
     s:=s||jsonb_build_object('actualDeliveryDate',input->>'actualDate','deliveryStatus',input->>'deliveryStatus');
    else
     if input->'deliveryStatus' is distinct from original->'deliveryStatus' then raise exception 'ship-tracking-reclassify-delivery' using errcode='22023';end if;
     s:=s||jsonb_build_object('completionDate',input->>'actualDate');
    end if;
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
   if command->>'type'='reclassify' or (command->>'type'='edit' and original->'requestType' is distinct from s->'requestType') then
    if original->>'isClosed'='true' or c->>'isClosed'='true' or t->>'isClosed'='true' then raise exception 'ship-tracking-closed-edit' using errcode='22023';end if;
    event_value:=ship_dynamics_tracking_private.reclassify_event_v1(original,s,op_id,at_text,actor);
    s:=s||jsonb_build_object('events',coalesce(s->'events','[]')||jsonb_build_array(event_value));
    c:=ship_dynamics_tracking_private.reclassify_link_v1(c,original,s,event_value);
    t:=ship_dynamics_tracking_private.reclassify_link_v1(t,original,s,event_value);
   end if;
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
  if coalesce(command->>'type','') not in ('create','edit','progress','sync','delivery','lifecycle','reclassify','request-delete') or b.creation is distinct from (command->>'type'='create') then raise exception 'ship-tracking-command-invalid' using errcode='22023';end if;
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

create or replace function ship_dynamics_tracking_private.read_v1(w text,v text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare catalog jsonb; rev integer; updated text; sources jsonb:='[]'; cases jsonb:='[]';
begin
 perform ship_dynamics_internal_control_private.admit_v1(w);
 select revision,root->>'updatedAt' into strict rev,updated from public.ship_dynamics_record_workspaces where workspace_key=w for share;
 catalog:=public.read_ship_dynamics_internal_control_public_v1(w,v);
 if v is not null then
  select coalesce(jsonb_agg(ship_dynamics_tracking_private.pick_v1(r.value,array[
   'id','kind','vesselId','requestType','referenceNo','description','applicationDate','originalItemNo','subitemNo','urgency','urgentSubtypes','purchaseNos','materialCategory','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','completionDate','originalRemarks','supplementalNotes','progress','expectedDate','deliveryStatus','actualDeliveryDate','isClosed','closedDate','closedBy','closureOutcome','linkedCaseId','linkState','source','createdBy','updatedBy','createdAt','updatedAt','statusLogs','events','deletion','deletionRequest'
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
  where r.workspace_key=p_workspace_key and r.collection='trackingItems' and not(r.value ? 'deletion')
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
  where r.workspace_key=p_workspace_key and r.collection='trackingItems' and not(r.value ? 'deletion')
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

revoke all on function ship_dynamics_tracking_private.deletion_value_v1(jsonb),
 ship_dynamics_tracking_private.apply_deletion_v1(jsonb,text,text,text,text,text),
 ship_dynamics_tracking_private.validate_deletion_v1(text,jsonb,text,jsonb),
 ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text),
 ship_dynamics_tracking_private.submit_v1(text,text,uuid,uuid,jsonb,boolean),
 ship_dynamics_tracking_private.read_v1(text,text) from public,anon,authenticated,service_role;
revoke all on function public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
