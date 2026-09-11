-- Development only: current-state validated reopen exception, no new identity policy.
create or replace function public.ship_dynamics_meeting_responsibility_scope_v1(p_workspace text,p_meeting jsonb,p_vessel text)
returns boolean language sql stable set search_path=public as $scope$
 select case when jsonb_array_length(coalesce(p_meeting->'vessels','[]'::jsonb))>0 then p_meeting->'vessels' ? p_vessel
 else exists(select 1 from public.ship_dynamics_records v where v.workspace_key=p_workspace and v.collection='vessels' and v.entity_id=p_vessel and v.value->'isActive'='true'::jsonb
  and (p_meeting->>'vesselScopeMode'='all' or (p_meeting->>'vesselScopeMode'='types' and p_meeting->'vesselTypeScopes' ? (v.value->>'shipType')))) end;
$scope$;
revoke all on function public.ship_dynamics_meeting_responsibility_scope_v1(text,jsonb,text) from public;

create or replace function public.ship_dynamics_reopened_responsibilities_v1(p_workspace text,p_collection text,p_before jsonb,p_after jsonb)
returns jsonb language plpgsql set search_path=public as $reopen$
declare entry jsonb; result jsonb='[]'::jsonb; vid text; reopened boolean; team jsonb; oldclosed boolean; newclosed boolean;
begin
 if jsonb_typeof(p_before->'vesselResponsibilities') is distinct from 'array' then return p_before->'vesselResponsibilities'; end if;
 for entry in select x from jsonb_array_elements(p_before->'vesselResponsibilities') x loop
  vid:=entry->>'vesselId';reopened:=false;
  if p_collection='tasks' and (coalesce(nullif(p_before->'vesselIds','[]'::jsonb),jsonb_build_array(p_before->>'vesselId')) ? vid)
    and (coalesce(nullif(p_after->'vesselIds','[]'::jsonb),jsonb_build_array(p_after->>'vesselId')) ? vid) then
   oldclosed:=coalesce(p_before->'isClosed'='true'::jsonb,false);newclosed:=coalesce(p_after->'isClosed'='true'::jsonb,false);
   if coalesce(p_before->>'sourceMeetingId','')<>'' and p_before->'distributeToVessels'='true'::jsonb and jsonb_array_length(coalesce(p_before->'vesselIds','[]'::jsonb))>1 then
    oldclosed:=coalesce((select x->'isClosed'='true'::jsonb from jsonb_array_elements(coalesce(p_before->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=vid),false);
   end if;
   if coalesce(p_after->>'sourceMeetingId','')<>'' and p_after->'distributeToVessels'='true'::jsonb and jsonb_array_length(coalesce(p_after->'vesselIds','[]'::jsonb))>1 then
    newclosed:=coalesce((select x->'isClosed'='true'::jsonb from jsonb_array_elements(coalesce(p_after->'vesselProgress','[]'::jsonb)) x where x->>'vesselId'=vid),false);
   end if;
   reopened:=oldclosed and not newclosed;
  elsif p_collection='internalControlCases' then
   reopened:=p_before->>'vesselId'=vid and p_after->>'vesselId'=vid and p_before->'isClosed'='true'::jsonb and p_after->'isClosed'='false'::jsonb;
  elsif p_collection='meetings' then
   reopened:=p_before->>'status'='已完成' and p_after->>'status'<>'已完成' and public.ship_dynamics_meeting_responsibility_scope_v1(p_workspace,p_before,vid) and public.ship_dynamics_meeting_responsibility_scope_v1(p_workspace,p_after,vid);
  end if;
  if coalesce(reopened,false) then
   select coalesce(jsonb_agg(u.entity_id order by a.n),'[]'::jsonb) into team
   from ship_dynamics_record_collections c cross join lateral jsonb_array_elements_text(c.ids) with ordinality a(id,n)
   join ship_dynamics_records u on u.workspace_key=c.workspace_key and u.collection='users' and u.entity_id=a.id
   join ship_dynamics_records v on v.workspace_key=c.workspace_key and v.collection='vessels' and v.entity_id=vid
   where c.workspace_key=p_workspace and c.collection='users' and u.value->'isActive'='true'::jsonb and u.value->>'role' in ('admin','operator') and v.value->'isActive'='true'::jsonb
    and (v.value->'assignedUserIds' ? u.entity_id or u.value->'managedVesselIds' ? vid);
   entry:=entry||jsonb_build_object('managerUserIds',team);
  end if;
  result:=result||jsonb_build_array(entry);
 end loop;
 return result;
end $reopen$;
revoke all on function public.ship_dynamics_reopened_responsibilities_v1(text,text,jsonb,jsonb) from public;

-- Development only. Opt-in handover read-set CAS; legacy envelopes unchanged.
-- The exact guard remains in original_signature and receipt lookup.
do $handover$
declare definition text;
begin
 select pg_get_functiondef('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure) into definition;
 if position('-- handover-read-revision-v1' in definition)>0 then
  if position('ship_dynamics_reopened_responsibilities_v1' in definition)=0 then
   definition:=replace(definition,$old$and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}'))$old$,$new$and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}')
      and (op#>'{value,vesselResponsibilities}') is distinct from public.ship_dynamics_reopened_responsibilities_v1(p_workspace_key,op->>'collection',op->'expected',op->'value'))$new$);
   if position('ship_dynamics_reopened_responsibilities_v1' in definition)=0 then raise exception 'incompatible reopen upgrade boundary'; end if;
   execute definition;
  end if;
  return;
 end if;
 if position('  -- Only users/vessels/settings' in definition)=0 or position('is distinct from p_authorization_guard)' in definition)=0 then raise exception 'handover incompatible record publication boundary'; end if;
 definition:=replace(definition,'  -- Only users/vessels/settings', $guard$
  -- handover-read-revision-v1: locked publication, after exact receipt replay.
  if p_authorization_guard ? 'handoverReadRevision' then
    if jsonb_typeof(p_authorization_guard->'handoverReadRevision') is distinct from 'number'
      or p_authorization_guard->>'handoverReadRevision' !~ '^[0-9]+$'
      or (p_authorization_guard->>'handoverReadRevision')::numeric <> workspace.revision then
      return jsonb_build_object('ok',false,'code','block-conflict','conflict_key','handover-read-revision');
    end if;
  end if;
  -- Only users/vessels/settings$guard$);
 definition:=replace(definition,'is distinct from p_authorization_guard)','is distinct from (p_authorization_guard - ''handoverReadRevision''))');
 definition:=replace(definition,'  -- Prevalidate the whole operation graph', $authority$
  -- New responsibility is command-owned. An old client or ordinary edit may
  -- retain it, but cannot erase or independently retarget it.
  if exists(select 1 from jsonb_array_elements(p_operations) op
    where op->>'kind'='entity' and op->>'collection' in ('tasks','internalControlCases','meetings')
      and op->'expected' <> 'null'::jsonb and op->'value' <> 'null'::jsonb
      and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}')
      and (op#>'{value,vesselResponsibilities}') is distinct from public.ship_dynamics_reopened_responsibilities_v1(p_workspace_key,op->>'collection',op->'expected',op->'value')) then
    if not coalesce(p_authorization_guard ? 'handoverReadRevision',false)
      or not public.ship_dynamics_patch_touches_authorization_domain(p_operations) then
      return jsonb_build_object('ok',false,'code','invalid-responsibility-change');
    end if;
  end if;
  -- Prevalidate the whole operation graph$authority$);
 execute definition;
end $handover$;

-- Install after the existing member protocol when present. Its command/CAS,
-- actor validation and linked transaction remain unchanged.
do $member_reopen$
declare definition text; anchor text := ' operations:=jsonb_build_array(jsonb_build_object(''kind'',''entity'',''collection'',''tasks'',''entityId'',p_task_id,''value'',task));';
begin
 if to_regprocedure('public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb)') is null then return; end if;
 select pg_get_functiondef('public.save_ship_dynamics_task_member_v1(text,text,text,text,jsonb,jsonb,text,jsonb,jsonb)'::regprocedure) into definition;
 if position('-- member-reopen-team-v1' in definition)>0 then return; end if;
 if position(anchor in definition)=0 then raise exception 'incompatible member reopen boundary'; end if;
 definition:=replace(definition,anchor,$change$
 -- member-reopen-team-v1: only selected closed -> open member, under publication lock.
 if old->'isClosed'='true'::jsonb and updated->'isClosed'='false'::jsonb and task ? 'vesselResponsibilities' then
  select public.ship_dynamics_record_hydrate_v1(r.workspace_key,r.collection,r.entity_id,r.value,r.task_progress_meta,r.revision) into item
  from public.ship_dynamics_records r where r.workspace_key=p_workspace_key and r.collection='tasks' and r.entity_id=p_task_id;
  task:=task||jsonb_build_object('vesselResponsibilities',public.ship_dynamics_reopened_responsibilities_v1(p_workspace_key,'tasks',item,task));
 end if;
$change$||anchor);
 execute definition;
end $member_reopen$;
