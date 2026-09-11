-- Development only. Opt-in handover read-set CAS; legacy envelopes unchanged.
-- The exact guard remains in original_signature and receipt lookup.
do $handover$
declare definition text;
begin
 select pg_get_functiondef('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)'::regprocedure) into definition;
 if position('-- handover-read-revision-v1' in definition)>0 then return; end if;
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
      and (op#>'{expected,vesselResponsibilities}') is distinct from (op#>'{value,vesselResponsibilities}')) then
    if not coalesce(p_authorization_guard ? 'handoverReadRevision',false)
      or not public.ship_dynamics_patch_touches_authorization_domain(p_operations) then
      return jsonb_build_object('ok',false,'code','invalid-responsibility-change');
    end if;
  end if;
  -- Prevalidate the whole operation graph$authority$);
 execute definition;
end $handover$;
