-- Management assignment particulars: classify only yearLabel / tonnageLabel
-- alongside the existing vessel-profile fields. No data backfill, grants,
-- schema columns, record protocol, lease rules for other fields or CAS changes.
-- Apply manually before deploying the matching client; safe to repeat.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $upgrade$
declare
  target regprocedure := to_regprocedure('public.ship_dynamics_patch_lock_covers_entity(text,text,jsonb,jsonb,jsonb,jsonb)');
  definition text;
  old_list constant text := $list$array['id','name','shortName','fullName','fleet','fleetId','fleetCategory','shipType','isActive','assignedUserIds','managedByUserIds','delegateManagers','updatedAt','updatedBy']$list$;
  new_list constant text := $list$array['id','name','shortName','fullName','fleet','fleetId','fleetCategory','shipType','yearLabel','tonnageLabel','isActive','assignedUserIds','managedByUserIds','delegateManagers','updatedAt','updatedBy']$list$;
begin
  if target is null then raise exception 'VESSEL_PARTICULARS_BASE_GUARD_MISSING'; end if;
  definition := pg_get_functiondef(target);
  if strpos(definition,new_list)>0 and strpos(definition,old_list)=0 then
    -- Already installed, or a fresh install of the current canonical schema.
    null;
  elsif length(definition)-length(replace(definition,old_list,''))=length(old_list)
        and strpos(definition,new_list)=0 then
    -- Preserve the installed function body, signature, security settings and ACL;
    -- change exactly the known profile allowlist, never replace unknown logic.
    execute replace(definition,old_list,new_list);
  else
    raise exception 'VESSEL_PARTICULARS_UNEXPECTED_GUARD: no changes applied';
  end if;
  if not public.ship_dynamics_patch_lock_covers_entity('vessels','probe',
      '{"id":"probe"}'::jsonb,'{"id":"probe","yearLabel":"2021.06","tonnageLabel":"2.0萬"}'::jsonb,'[]'::jsonb,'[]'::jsonb)
     or public.ship_dynamics_patch_lock_covers_entity('vessels','probe',
      '{"id":"probe"}'::jsonb,'{"id":"probe","note":{"recentDynamics":"operational"}}'::jsonb,'[]'::jsonb,'[]'::jsonb)
  then raise exception 'VESSEL_PARTICULARS_GUARD_CHECK_FAILED'; end if;
end;
$upgrade$;
commit;

select 'vessel-assignment-particulars-ready' as installation, true as particulars_ready;
