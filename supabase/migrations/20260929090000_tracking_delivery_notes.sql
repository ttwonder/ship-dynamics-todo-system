-- Delivery notes: append to current progress in the existing atomic command.
-- No table/schema/data rewrite; existing RPC signatures, role grants and exact
-- old pending payload/receipt signatures remain unchanged. Apply before frontend.
begin;
do $$
declare h text;
begin
 select md5(replace(prosrc,chr(13)||chr(10),chr(10))) into h from pg_proc
 where oid=to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)');
 if coalesce(h,'') not in ('44b9e1d7ac2b62faa3cd72d2801e15e3','edecbd070391e7f435c1b6a9c0561d55') then
  raise exception 'tracking-delivery-notes-predecessor-mismatch';
 end if;
end $$;

create or replace function ship_dynamics_tracking_private.plan_v1(w text,v text,command jsonb,groups jsonb,op_id text,at_text text,actor text,label text)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare note_text text; progress_text text; input jsonb; s jsonb; c jsonb; t jsonb; original jsonb; group_row jsonb; operations jsonb:='[]'; fields text[]; field text; log_entry jsonb; changes jsonb; before_value jsonb; event_value jsonb; action_name text; reporter text; settings jsonb;
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
   if exists(select 1 from jsonb_object_keys(input) x where not(x=any(case command->>'type' when 'request-delete' then array['id','expectedUpdatedAt','reason'] when 'reclassify' then array['id','expectedUpdatedAt','requestType','actualDate','deliveryStatus'] when 'edit' then array['id','expectedUpdatedAt','changes'] when 'progress' then array['id','expectedUpdatedAt','text'] when 'sync' then array['id','expectedUpdatedAt','item'] when 'delivery' then array['id','expectedUpdatedAt','status','date','note'] else array['id','expectedUpdatedAt','entry'] end))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
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
    if input ? 'note' then
     if jsonb_typeof(input->'note') is distinct from 'string' then raise exception 'tracking-delivery-note-invalid' using errcode='22023';end if;
     note_text:=btrim(input->>'note',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
     if length(note_text)>2000 then raise exception 'tracking-delivery-note-invalid' using errcode='22023';end if;
     if note_text<>'' then
      if s->>'isClosed'='true' or c->>'isClosed'='true' or t->>'isClosed'='true' then raise exception 'tracking-closed-progress' using errcode='22023';end if;
      progress_text:=case when coalesce(s->>'progress','')='' then '' else (s->>'progress')||E'\n' end||'送船備註：'||note_text;
      if length(progress_text)>10000 then raise exception 'tracking-progress-too-long' using errcode='22023';end if;
      progress_text:=btrim(progress_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
      log_entry:=jsonb_build_object('id',op_id||':'||(s->>'id')||':progress','at',at_text,'by',label,'byUserId',actor,'text',progress_text);
      s:=s||jsonb_build_object('progress',progress_text,'statusLogs',jsonb_build_array(log_entry)||coalesce(s->'statusLogs','[]'));
      if c is not null then
       c:=c||jsonb_build_object('status',progress_text,'statusLogs',jsonb_build_array(log_entry)||coalesce(c->'statusLogs','[]'),'updatedAt',at_text,'updatedBy',actor);
       if t is not null then t:=t||jsonb_build_object('status',progress_text,'statusLogs',c->'statusLogs','updatedAt',at_text,'updatedBy',actor);end if;
      end if;
     end if;
    end if;
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

commit;
