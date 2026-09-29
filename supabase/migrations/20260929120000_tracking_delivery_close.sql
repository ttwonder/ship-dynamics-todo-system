-- Atomic delivered + closed, opt-in. Includes prior delivery-note support.
-- Compatible from soft-delete or delivery-notes revision; no business-data rewrite.
-- Preserve RPC signatures, grants, lease/CAS and old exact receipt identities.
begin;
do $$
declare h text;
begin
 select md5(replace(prosrc,chr(13)||chr(10),chr(10))) into h from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.plan_v1(text,text,jsonb,jsonb,text,text,text,text)');
 if coalesce(h,'') not in ('44b9e1d7ac2b62faa3cd72d2801e15e3','edecbd070391e7f435c1b6a9c0561d55','2fe7afd74cfca4db61d0862c85913b00') then raise exception 'tracking-delivery-close-predecessor-mismatch';end if;
 select md5(replace(prosrc,chr(13)||chr(10),chr(10))) into h from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)');
 if coalesce(h,'') not in ('dadd88ea4bd19b490035ce20293e0182','113ddde1e9a055357fcb055222660de2') then raise exception 'tracking-delivery-close-predecessor-mismatch';end if;
 select md5(replace(prosrc,chr(13)||chr(10),chr(10))) into h from pg_proc where oid=to_regprocedure('ship_dynamics_tracking_private.delivery_close_v1(jsonb,jsonb,text)');
 if h is not null and h not in ('58ad17bc8975696fd9c4a69cdde1186f') then raise exception 'tracking-delivery-close-predecessor-mismatch';end if;
end $$;

create or replace function ship_dynamics_tracking_private.delivery_close_v1(b jsonb,n jsonb,actor text)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog,public as $$
declare delivery_event jsonb; close_event jsonb; op_id text; at_text text; fields text[]:=array['progress','statusLogs','deliveryStatus','actualDeliveryDate','isClosed','closedDate','closedBy','events','updatedAt','updatedBy'];
begin
 if b is null or b->>'isClosed' is distinct from 'false' or n->>'isClosed' is distinct from 'true'
  or b->>'kind' is distinct from 'supply' or n->>'deliveryStatus' is distinct from 'delivered'
  or n->>'actualDeliveryDate' is distinct from n->>'closedDate' or coalesce(n->>'closedDate','')=''
  or n->>'closedBy' is distinct from actor or n->>'updatedBy' is distinct from actor
  or (b-fields) is distinct from (n-fields) or jsonb_typeof(n->'events') is distinct from 'array' then return false;end if;
 delivery_event:=n->'events'->-2;close_event:=n->'events'->-1;
 op_id:=close_event->>'operationId';at_text:=n->>'updatedAt';
 if coalesce(length(op_id),0) not between 1 and 200 or coalesce(at_text,'')='' then return false;end if;
 if n->'events' is distinct from coalesce(b->'events','[]')||jsonb_build_array(delivery_event,close_event) then return false;end if;
 if delivery_event is distinct from jsonb_build_object('id',op_id||':'||(n->>'id')||':delivery','operationId',op_id,'action','delivery',
  'before',jsonb_build_object('deliveryStatus',b->>'deliveryStatus','actualDeliveryDate',coalesce(b->>'actualDeliveryDate','')),
  'after',jsonb_build_object('deliveryStatus',n->>'deliveryStatus','actualDeliveryDate',n->>'actualDeliveryDate'),'byUserId',actor,'at',at_text,'entry','tracking') then return false;end if;
 if close_event is distinct from jsonb_build_object('id',op_id||':'||(n->>'id')||':close','operationId',op_id,'action','close',
  'before',jsonb_build_object('isClosed',b->'isClosed','closedDate',coalesce(b->>'closedDate',''),'closedBy',coalesce(b->>'closedBy','')),
  'after',jsonb_build_object('isClosed',n->'isClosed','closedDate',n->>'closedDate','closedBy',actor),'byUserId',actor,'at',at_text,'entry','tracking') then return false;end if;
 if b->'progress' is distinct from n->'progress' and (jsonb_array_length(n->'statusLogs')<>jsonb_array_length(coalesce(b->'statusLogs','[]'))+1
  or n#>>'{statusLogs,0,text}' is distinct from n->>'progress' or n#>>'{statusLogs,0,byUserId}' is distinct from actor
  or n#>>'{statusLogs,0,at}' is distinct from at_text) then return false;end if;
 return true;
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
   if exists(select 1 from jsonb_object_keys(input) x where not(x=any(case command->>'type' when 'request-delete' then array['id','expectedUpdatedAt','reason'] when 'reclassify' then array['id','expectedUpdatedAt','requestType','actualDate','deliveryStatus'] when 'edit' then array['id','expectedUpdatedAt','changes'] when 'progress' then array['id','expectedUpdatedAt','text'] when 'sync' then array['id','expectedUpdatedAt','item'] when 'delivery' then array['id','expectedUpdatedAt','status','date','note','closeOnDelivery'] else array['id','expectedUpdatedAt','entry'] end))) then raise exception 'ship-tracking-invalid-fields' using errcode='22023';end if;
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
    if input ? 'closeOnDelivery' and jsonb_typeof(input->'closeOnDelivery') is distinct from 'boolean' then raise exception 'tracking-delivery-close-invalid' using errcode='22023';end if;
    if input->'closeOnDelivery'='true'::jsonb then
     if input->>'status'<>'delivered' or s->>'isClosed'='true' or c->>'isClosed'='true' or t->>'isClosed'='true' then raise exception 'tracking-delivery-close-invalid' using errcode='22023';end if;
     if not public.ship_dynamics_tracking_date_v1(input->>'date') or input->>'date'<s->>'applicationDate' or input->>'date'<c->>'reportDate' then raise exception 'ship-tracking-invalid-close-date' using errcode='22023';end if;
     before_value:=jsonb_build_object('isClosed',s->'isClosed','closedDate',coalesce(s->>'closedDate',''),'closedBy',coalesce(s->>'closedBy',''));
     s:=s||jsonb_build_object('isClosed',true,'closedDate',input->>'date','closedBy',actor);
     event_value:=jsonb_build_object('id',op_id||':'||(s->>'id')||':close','operationId',op_id,'action','close','before',before_value,'after',jsonb_build_object('isClosed',true,'closedDate',input->>'date','closedBy',actor),'byUserId',actor,'at',at_text,'entry','tracking');
     s:=s||jsonb_build_object('events',s->'events'||jsonb_build_array(event_value));
     if c is not null then
      c:=c||ship_dynamics_tracking_private.pick_v1(s,array['isClosed','closedDate','closedBy'])||jsonb_build_object('updatedAt',at_text,'updatedBy',actor,'trackingLifecycle',coalesce(c->'trackingLifecycle','[]')||jsonb_build_array(event_value));
      if t is not null then t:=t||ship_dynamics_tracking_private.pick_v1(s,array['isClosed','closedDate','closedBy'])||jsonb_build_object('updatedAt',at_text,'updatedBy',actor,'trackingLifecycle',coalesce(t->'trackingLifecycle','[]')||jsonb_build_array(event_value));end if;
     end if;
    end if;
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

create or replace function public.ship_dynamics_tracking_validate_v1(p_workspace text,p_ops jsonb,p_actor text,p_guard jsonb,p_locks jsonb)
returns text language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare delivery_closing boolean; op jsonb; b jsonb; n jsonb; permission_name text; g jsonb; source_id text; c jsonb; t jsonb; old_c jsonb; f text; old_events jsonb; new_events jsonb; old_logs jsonb; new_logs jsonb; reclassify_count integer; reclassifying boolean; old_t jsonb; canonical_c jsonb; canonical_t jsonb;
begin
 f:=ship_dynamics_tracking_private.validate_deletion_v1(p_workspace,p_ops,p_actor,p_guard);
 if f is not null then return f;end if;
 for op in select x from jsonb_array_elements(p_ops) x where x->>'kind'='entity' and x->>'collection'='trackingItems' loop
  b:=nullif(op->'expected','null');n:=nullif(op->'value','null');
  delivery_closing:=ship_dynamics_tracking_private.delivery_close_v1(b,n,p_actor);
  if delivery_closing and p_guard#>>'{actor,role}'<>'owner' and coalesce((p_guard#>>'{effectivePermissions,editBusinessContent}')::boolean,false) is not true then return 'tracking-permission-denied';end if;
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
   if b->>'isClosed'='true' or (n->>'isClosed'='true' and not delivery_closing) then return 'tracking-closed-progress';end if;
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
  delivery_closing:=ship_dynamics_tracking_private.delivery_close_v1(b,n,p_actor);
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
   if delivery_closing then
    -- Canonical linked closure + optional note only; never broaden general edits.
    if old_c is null or old_c->>'isClosed' is distinct from 'false' then return 'tracking-lifecycle-inconsistent';end if;
    old_t:=null;
    if t is not null then
     select public.ship_dynamics_record_hydrate_v1(p_workspace,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into old_t
      from public.ship_dynamics_records r where r.workspace_key=p_workspace and r.collection='tasks' and r.entity_id=old_c->>'linkedTaskId';
     if old_t is null or old_t->>'isClosed' is distinct from 'false' then return 'tracking-lifecycle-inconsistent';end if;
    end if;
    canonical_c:=old_c;canonical_t:=old_t;
    if n->'progress' is distinct from b->'progress' then
     canonical_c:=canonical_c||jsonb_build_object('status',n->>'progress','statusLogs',jsonb_build_array(n#>'{statusLogs,0}')||coalesce(old_c->'statusLogs','[]'));
     if old_t is not null then canonical_t:=canonical_t||jsonb_build_object('status',n->>'progress','statusLogs',canonical_c->'statusLogs');end if;
    end if;
    canonical_c:=canonical_c||ship_dynamics_tracking_private.pick_v1(n,array['isClosed','closedDate','closedBy','updatedAt','updatedBy'])||jsonb_build_object('trackingLifecycle',coalesce(old_c->'trackingLifecycle','[]')||jsonb_build_array(n->'events'->-1));
    if old_t is not null then canonical_t:=canonical_t||ship_dynamics_tracking_private.pick_v1(n,array['isClosed','closedDate','closedBy','updatedAt','updatedBy'])||jsonb_build_object('trackingLifecycle',coalesce(old_t->'trackingLifecycle','[]')||jsonb_build_array(n->'events'->-1));end if;
    if c is distinct from canonical_c or (t is not null and t is distinct from canonical_t) then return 'tracking-delivery-close-link-not-converged';end if;
   end if;
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
    if not reclassifying and not delivery_closing and not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'collection'='internalControlCases' and o->>'kind'='entity' and o->>'entityId'=c->>'id' and ((o->'expected')-array['status','statusLogs','updatedAt','updatedBy'])=((o->'value')-array['status','statusLogs','updatedAt','updatedBy'])) then return 'tracking-progress-overwrites-basic';end if;
    if not reclassifying and not delivery_closing and t is not null and not exists(select 1 from jsonb_array_elements(p_ops) o where o->>'collection'='tasks' and o->>'kind'='entity' and o->>'entityId'=t->>'id' and ((o->'expected')-array['status','statusLogs','updatedAt','updatedBy'])=((o->'value')-array['status','statusLogs','updatedAt','updatedBy'])) then return 'tracking-progress-overwrites-basic';end if;
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

revoke all on function ship_dynamics_tracking_private.delivery_close_v1(jsonb,jsonb,text) from public,anon,authenticated;
commit;
