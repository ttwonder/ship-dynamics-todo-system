-- Add optional expected-completion date (DL) to anonymous append-only intake.
-- No data rewrite, no new grants, no changed endpoint/signature for old requests.
-- Apply after 20260919090000_ship_internal_control_public.sql. Do not rerun cutover SQL.
begin;
set local lock_timeout='10s';
set local statement_timeout='60s';
do $$begin
 if to_regprocedure('ship_dynamics_internal_control_private.request_v1(text,text,uuid,uuid,jsonb)') is null
 or to_regprocedure('public.submit_ship_dynamics_internal_control_public_v1(text,text,uuid,uuid,jsonb)') is null then
  raise exception 'Install the original ship internal-control endpoint first';
 end if;
end $$;

create or replace function ship_dynamics_internal_control_private.request_v1(
 p_workspace text,p_vessel text,p_actor uuid,p_operation uuid,p_items jsonb
) returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare item jsonb; field text; expected_date date; fields text[]:=array['reportDate','reportSource','description','priority','category','equipmentSubcategory','isAware','status','departments'];
begin
 if p_workspace is null or p_workspace='' or p_workspace<>btrim(p_workspace) or length(p_workspace)>200
  or p_vessel is null or p_vessel='' or p_vessel<>btrim(p_vessel) or length(p_vessel)>200
  or p_actor is null or p_operation is null or jsonb_typeof(p_items) is distinct from 'array' then
  raise exception 'ship-internal-invalid-request' using errcode='22023';
 end if;
 if jsonb_array_length(p_items) not between 1 and 100 or octet_length(p_items::text)>2000000 then
  raise exception 'ship-internal-batch-limit' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'ship-internal-invalid-item' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(item) k where not(k=any(fields) or k='expectedDate'))
   or not(item ?& fields) then raise exception 'ship-internal-invalid-fields' using errcode='22023';end if;
  foreach field in array array['reportDate','reportSource','description','priority','category','equipmentSubcategory','status'] loop
   if jsonb_typeof(item->field) is distinct from 'string' or length(item->>field)>(case when field in ('description','status') then 10000 else 200 end) then
    raise exception 'ship-internal-invalid-text' using errcode='22023';end if;
  end loop;
  -- Optional field: omission preserves every old pending signature byte-for-byte.
  if item ? 'expectedDate' then
   if jsonb_typeof(item->'expectedDate') is distinct from 'string' then raise exception 'ship-internal-invalid-deadline' using errcode='22023';end if;
   if item->>'expectedDate'<>'' then
    if item->>'expectedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ship-internal-invalid-deadline' using errcode='22023';end if;
    begin expected_date:=(item->>'expectedDate')::date;
    exception when datetime_field_overflow or invalid_datetime_format then raise exception 'ship-internal-invalid-deadline' using errcode='22023';end;
    if to_char(expected_date,'YYYY-MM-DD')<>item->>'expectedDate' or extract(year from expected_date)<1 then raise exception 'ship-internal-invalid-deadline' using errcode='22023';end if;
   end if;
  end if;
  if jsonb_typeof(item->'isAware') is distinct from 'boolean' or jsonb_typeof(item->'departments') is distinct from 'array' then
   raise exception 'ship-internal-invalid-fields' using errcode='22023';end if;
  if jsonb_array_length(item->'departments')>100
   or exists(select 1 from jsonb_array_elements(item->'departments') x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>200)
   or (select count(distinct x) from jsonb_array_elements(item->'departments') x)<>jsonb_array_length(item->'departments') then
   raise exception 'ship-internal-invalid-departments' using errcode='22023';end if;
 end loop;
 return jsonb_build_object('endpoint','ship-internal-v1','workspace',p_workspace,'vessel',p_vessel,'actor',p_actor,'operation',p_operation,'items',p_items);
end $$;

create or replace function public.submit_ship_dynamics_internal_control_public_v1(
 p_workspace_key text,p_vessel_id text,p_actor_key uuid,p_operation_id uuid,p_items jsonb
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare signature jsonb; receipt jsonb; operation_key text:='ship-internal:'||p_operation_id::text;
 workspace public.ship_dynamics_record_workspaces%rowtype; vessel jsonb; settings jsonb; orders jsonb;
 item jsonb; body jsonb; operations jsonb:='[]'; ids jsonb:='[]'; audit_ids jsonb; audit_id text;
 item_id text; old_id text; at_text text; actor_id text; actor_name text; n integer:=0; report_date date;
begin
 signature:=ship_dynamics_internal_control_private.request_v1(p_workspace_key,p_vessel_id,p_actor_key,p_operation_id,p_items);
 receipt:=public.get_ship_dynamics_internal_control_public_receipt_v1(p_workspace_key,p_vessel_id,p_actor_key,p_operation_id,p_items);
 if receipt->>'status'='committed' then return receipt;end if;
 -- Existing coarse command order: maintenance -> exclusive workspace -> operation -> root.
 -- No public lease or arbitrary patch authority is introduced.
 perform public.ship_dynamics_record_writer_gate_v1(p_workspace_key,true);
 perform pg_advisory_xact_lock(hashtext('record-operation:'||p_workspace_key),hashtext(operation_key));
 receipt:=public.get_ship_dynamics_internal_control_public_receipt_v1(p_workspace_key,p_vessel_id,p_actor_key,p_operation_id,p_items);
 if receipt->>'status'='committed' then return receipt;end if;
 perform ship_dynamics_internal_control_private.admit_v1(p_workspace_key);
 select * into strict workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for no key update;
 select value into vessel from public.ship_dynamics_records where workspace_key=p_workspace_key and collection='vessels' and entity_id=p_vessel_id;
 if vessel is null or vessel->'isActive' is distinct from 'true'::jsonb
  or not exists(select 1 from public.ship_dynamics_record_collections vc where vc.workspace_key=p_workspace_key and vc.collection='vessels' and vc.ids ? p_vessel_id) then
  raise exception 'ship-internal-vessel-unavailable' using errcode='22023';end if;
 select coalesce(jsonb_object_agg(collection,c.ids),'{}') into orders from public.ship_dynamics_record_collections c where workspace_key=p_workspace_key;
 settings:=workspace.root->'settings';
 at_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 actor_id:='public-vessel:'||p_vessel_id;
 actor_name:=coalesce(nullif(vessel->>'fullName',''),nullif(vessel->>'shortName',''),vessel->>'name',p_vessel_id)||' 船端(未驗證身份)';
 for item in select value from jsonb_array_elements(p_items) loop
  n:=n+1;
  if item->>'reportDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'ship-internal-invalid-date' using errcode='22023';end if;
  begin report_date:=(item->>'reportDate')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'ship-internal-invalid-date' using errcode='22023';end;
  if to_char(report_date,'YYYY-MM-DD')<>item->>'reportDate' or extract(year from report_date)<1 then raise exception 'ship-internal-invalid-date' using errcode='22023';end if;
  if not(item->>'reportSource'=any(array['日常','訪船','隨船','外部']))
   or not(item->>'priority'=any(array['急','高','中','低']))
   or not coalesce((settings->'priorities') ? (item->>'priority'),false)
   or not(item->>'category'='設備故障' or coalesce((settings->'taskCategories') ? (item->>'category'),false))
   or btrim(regexp_replace(item->>'description','<[^>]*>','','g'))=''
   or btrim(regexp_replace(item->>'status','<[^>]*>','','g'))='' then
   raise exception 'ship-internal-invalid-content' using errcode='22023';end if;
  if item->>'category'='設備故障' and not coalesce((settings->'equipmentFailureSubcategories') ? (item->>'equipmentSubcategory'),false) then
   raise exception 'ship-internal-invalid-equipment' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(item->'departments') d where not coalesce((settings->'departments') ? d,false)) then
   raise exception 'ship-internal-invalid-departments' using errcode='22023';end if;
  item_id:='ship-internal-case:'||p_operation_id::text||':'||n::text;
  if exists(select 1 from public.ship_dynamics_records where workspace_key=p_workspace_key and entity_id=item_id)
   or exists(select 1 from public.ship_dynamics_record_history where workspace_key=p_workspace_key and entity_id=item_id) then
   raise exception 'ship-internal-id-conflict' using errcode='22023';end if;
  body:=jsonb_build_object('id',item_id,'vesselId',p_vessel_id,'reportDate',item->>'reportDate','reportSource',item->>'reportSource',
   'description',btrim(item->>'description'),'priority',item->>'priority','category',item->>'category',
   'isAware',item->'isAware','status',btrim(item->>'status'),'departments',item->'departments',
   'syncToTask',false,'origin','internal-control','isClosed',false,
   'createdBy',actor_id,'updatedBy',actor_id,'createdAt',at_text,'updatedAt',at_text,
   'statusLogs',jsonb_build_array(jsonb_build_object('id','ship-internal-log:'||p_operation_id::text||':'||n::text,'at',at_text,'by',actor_name,'byUserId',actor_id,'text',btrim(item->>'status'))));
  if item ? 'expectedDate' then body:=body||jsonb_build_object('expectedDate',item->>'expectedDate');end if;
  if item->>'category'='設備故障' then body:=body||jsonb_build_object('equipmentSubcategory',item->>'equipmentSubcategory');end if;
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','internalControlCases','entityId',item_id,'expected',null,'value',body));
  ids:=ids||jsonb_build_array(item_id);
 end loop;
 audit_id:='ship-internal-audit:'||p_operation_id::text;
 if exists(select 1 from public.ship_dynamics_records where workspace_key=p_workspace_key and entity_id=audit_id)
  or exists(select 1 from public.ship_dynamics_record_history where workspace_key=p_workspace_key and entity_id=audit_id) then
  raise exception 'ship-internal-id-conflict' using errcode='22023';end if;
 body:=jsonb_build_object('id',audit_id,'at',at_text,'actorId',actor_id,'actorName',actor_name,'actorRole','vessel',
  'action','船端新增內控/訴求','entityType','internal-control','entityId',(select string_agg(x,',') from jsonb_array_elements_text(ids) x),
  'detail','新增 '||n::text||' 件｜船舶歸屬由填報者選擇，未驗證填報身份');
 operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','auditLogs','entityId',audit_id,'expected',null,'value',body));
 audit_ids:=jsonb_build_array(audit_id)||coalesce(orders->'auditLogs','[]');
 -- Preserve withAudit's 500-row retention, including physical deletes and history.
 for old_id in select x from jsonb_array_elements_text(audit_ids) with ordinality t(x,ordinal) where ordinal>500 loop
  operations:=operations||jsonb_build_array(jsonb_build_object('kind','entity','collection','auditLogs','entityId',old_id,'value',null));
 end loop;
 select coalesce(jsonb_agg(x order by ordinal),'[]') into audit_ids from jsonb_array_elements(audit_ids) with ordinality t(x,ordinal) where ordinal<=500;
 orders:=jsonb_set(jsonb_set(orders,'{internalControlCases}',ids||coalesce(orders->'internalControlCases','[]'),true),'{auditLogs}',audit_ids,true);
 receipt:=public.ship_dynamics_record_commit_validated_v1(p_workspace_key,operations,workspace.root,orders,actor_name,operation_key,signature);
 receipt:=receipt||jsonb_build_object('operation_id',p_operation_id,'workspace_key',p_workspace_key,'vessel_id',p_vessel_id,'case_ids',ids,'item_count',n);
 update public.ship_dynamics_record_receipts set result=receipt where workspace_key=p_workspace_key and operation_id=operation_key;
 return receipt;
end $$;

-- CREATE OR REPLACE retains the installed owner and ACL; private helper stays private.
revoke all on function ship_dynamics_internal_control_private.request_v1(text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.submit_ship_dynamics_internal_control_public_v1(text,text,uuid,uuid,jsonb) from public;
comment on function public.submit_ship_dynamics_internal_control_public_v1(text,text,uuid,uuid,jsonb) is 'ship-internal-control-due-date-v1: optional DL; open internal-control cases only; exact old/new replay; no task creation';
notify pgrst,'reload schema';
commit;
