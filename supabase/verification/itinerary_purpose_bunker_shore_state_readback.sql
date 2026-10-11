-- Read-only installed-state check. No business records are read or changed.
-- Run in the same Supabase project after the corresponding migration succeeds.
-- Stop on ERROR or FAIL; do not automatically rerun the installation.
begin transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
with
routes(signature,required) as (values
 ('public.sd_itinerary_save_internal(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',true),
 ('ship_dynamics_authority_private.itinerary_record_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',true),
 ('ship_dynamics_authority_private.itinerary_legacy_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',false),
 ('ship_dynamics_authority_private.itinerary_public_v1(text,text,bigint,uuid,jsonb,text,text,uuid,text,uuid,text,bigint,jsonb)',true)
),
expected_guard as (select replace($guard$
  -- current_vessel_state_shared_edit_v1
  -- Existing actor, source, lease and revision gates still apply before here.
  -- Omission by an older client preserves current state; explicit values edit it.
  if not ((p_rows->0) ? 'currentVesselState') and exists(select 1 from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id and (rows_payload->0) ? 'currentVesselState') then
    p_rows := jsonb_set(p_rows,'{0,currentVesselState}',
      (select rows_payload->0->'currentVesselState' from public.sd_itinerary_documents where workspace_id=v_workspace and vessel_id=p_vessel_id),true);
  end if;
$guard$,chr(13),'') as body),
expected_bodies(signature,body_md5) as (values
 ('public.sd_itinerary_purpose_valid(text)','0ef183eec57ef7d7fa929a1f4c31cb4b'),
 ('public.sd_itinerary_rows_valid(jsonb)','b8de65122a24f611c7a9d9ad5941e62f')
),
facts(check_name,ok) as (
 select 'read_only_transaction',current_setting('transaction_read_only')='on'
 union all
 select 'exact_body: '||e.signature,p.oid is not null and md5(replace(p.prosrc,chr(13),''))=e.body_md5
 from expected_bodies e left join pg_proc p on p.oid=to_regprocedure(e.signature)
 union all
 select 'private_validator_acl: '||e.signature,p.oid is not null and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
 and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
 from expected_bodies e left join pg_proc p on p.oid=to_regprocedure(e.signature)
 union all
 select 'shared_state_guard: '||r.signature,case when p.oid is null then not r.required else
 position(g.body in replace(p.prosrc,chr(13),''))>0 and position('current-vessel-state-ship-only' in p.prosrc)=0 end
 from routes r cross join expected_guard g left join pg_proc p on p.oid=to_regprocedure(r.signature)
 union all
 select 'bunker_single',public.sd_itinerary_purpose_valid('bunker')
 union all
 select 'bunker_mixed',public.sd_itinerary_purpose_valid('To Load / inspection / bunker')
 union all
 select 'existing_purposes_retained',public.sd_itinerary_purpose_valid('To Load / To Unload / docking / waiting order / repair / inspection')
 union all
 select 'out_of_order_rejected',not public.sd_itinerary_purpose_valid('bunker / To Load')
 union all
 select 'duplicate_rejected',not public.sd_itinerary_purpose_valid('bunker / bunker')
 union all
 select 'alternatives_still_reject_current_state',p.oid is not null and position('-- current_vessel_state_alternative_v1' in p.prosrc)>0
 from (select 1) anchor left join pg_proc p on p.oid=to_regprocedure('public.sd_itinerary_alternative_plans_valid(jsonb,jsonb)')
)
select case when bool_and(coalesce(ok,false)) then 'PASS' else 'FAIL' end as overall,
 count(*) as check_count,count(*) filter(where ok is not true) as failed_count,
 coalesce(jsonb_agg(check_name order by check_name) filter(where ok is not true),'[]'::jsonb) as failed_checks,
 'purpose-bunker-shore-state-v1' as readback_id
from facts;
commit;
