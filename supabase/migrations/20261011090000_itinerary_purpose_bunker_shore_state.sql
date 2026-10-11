-- Add canonical Purpose bunker and permit existing authorized company editors
-- to update the same formal-first-row current state as the ship portal.
-- No grants, business-data rewrites, lease/CAS/replay or source gates are changed.
-- Requires 20260916090000 current state and 20260917090000 status bunker.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '5s';

do $purpose$
declare
  target oid := to_regprocedure('public.sd_itinerary_purpose_valid(text)');
  body_md5 text;
  definition text;
  old_options text := $options$'To Load','To Unload','docking','waiting order','repair','inspection'$options$;
  new_options text := $options$'To Load','To Unload','docking','waiting order','repair','inspection','bunker'$options$;
begin
  if target is null then raise exception 'purpose-bunker-predecessor-missing'; end if;
  select md5(replace(prosrc,chr(13),'')) into body_md5 from pg_proc where oid=target;
  if body_md5 = '0ef183eec57ef7d7fa929a1f4c31cb4b' then return; end if;
  if body_md5 is distinct from '02cf64975643df4691d7059e1dc7f0fd' then raise exception 'purpose-bunker-predecessor-mismatch'; end if;
  definition := pg_get_functiondef(target);
  if length(definition)-length(replace(definition,old_options,'')) <> length(old_options) then raise exception 'purpose-bunker-options-mismatch'; end if;
  execute replace(definition,old_options,new_options);
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) is distinct from '0ef183eec57ef7d7fa929a1f4c31cb4b' then raise exception 'purpose-bunker-install-verification-failed'; end if;
end $purpose$;

do $shared_state$
declare
  signature text;
  fn regprocedure;
  definition text;
  selected_old_guard text;
  selected_new_guard text;
  old_guard text := $old_guard$
  -- current_vessel_state_ship_only_v1
  if (p_rows->0) ? 'currentVesselState' then
    if p_actor_kind <> 'public' and p_rows->0->'currentVesselState' is distinct from
      (select rows_payload->0->'currentVesselState' from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id) then
      raise exception using errcode='P0001',message='current-vessel-state-ship-only';
    end if;
  elsif exists(select 1 from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id and (rows_payload->0) ? 'currentVesselState') then
    p_rows := jsonb_set(p_rows,'{0,currentVesselState}',
      (select rows_payload->0->'currentVesselState' from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id),true);
  end if;
$old_guard$;
  new_guard text := $new_guard$
  -- current_vessel_state_shared_edit_v1
  -- Existing actor, source, lease and revision gates still apply before here.
  -- Omission by an older client preserves current state; explicit values edit it.
  if not ((p_rows->0) ? 'currentVesselState') and exists(select 1 from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id and (rows_payload->0) ? 'currentVesselState') then
    p_rows := jsonb_set(p_rows,'{0,currentVesselState}',
      (select rows_payload->0->'currentVesselState' from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id),true);
  end if;
$new_guard$;
begin
  old_guard := replace(old_guard,chr(13),'');
  new_guard := replace(new_guard,chr(13),'');
  if to_regprocedure('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)') is null then raise exception 'shore-current-state-predecessor-missing'; end if;
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.sd_itinerary_rows_valid(jsonb)')) is distinct from 'b8de65122a24f611c7a9d9ad5941e62f' then raise exception 'shore-current-state-validator-predecessor-mismatch'; end if;
  foreach signature in array array[
    'public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',
    'ship_dynamics_authority_private.itinerary_record_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',
    'ship_dynamics_authority_private.itinerary_legacy_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',
    'ship_dynamics_authority_private.itinerary_public_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)'
  ] loop
    fn := to_regprocedure(signature);
    if fn is null then continue; end if;
    definition := pg_get_functiondef(fn);
    if position('-- current_vessel_state_shared_edit_v1' in definition)>0 then
      if length(replace(definition,chr(13),''))-length(replace(replace(definition,chr(13),''),new_guard,'')) <> length(new_guard) or position('current-vessel-state-ship-only' in definition)>0 then raise exception 'shore-current-state-predecessor-mismatch'; end if;
      continue;
    end if;
    if length(replace(definition,chr(13),''))-length(replace(replace(definition,chr(13),''),old_guard,'')) <> length(old_guard) then raise exception 'shore-current-state-predecessor-mismatch'; end if;
    if position(old_guard in definition)>0 then
      selected_old_guard := old_guard; selected_new_guard := new_guard;
    else
      selected_old_guard := replace(old_guard,chr(10),chr(13)||chr(10));
      selected_new_guard := replace(new_guard,chr(10),chr(13)||chr(10));
      if position(selected_old_guard in definition)=0 then raise exception 'shore-current-state-predecessor-mismatch'; end if;
    end if;
    -- Replace only the exact guard. Do not normalize unrelated function bytes.
    execute replace(definition,selected_old_guard,selected_new_guard);
    if position(new_guard in replace(pg_get_functiondef(fn),chr(13),''))=0 then raise exception 'shore-current-state-install-verification-failed'; end if;
  end loop;
end $shared_state$;

select 'purpose-bunker-and-shore-current-state-ready' as installation;
commit;
