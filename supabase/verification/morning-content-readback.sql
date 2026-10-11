-- READ-ONLY post-repair installation check. Use the already-confirmed runtime
-- workspace literal. No builder/runner invocation, business values, function
-- bodies, arbitrary GUC output or schema/cron writes. Old 10:00 install stays closed.
-- PASS_INSTALL_ONLY proves catalog installation, NOT a normal 10:00 tick or
-- full report content. Keep 10/11 unchanged; verify the NEXT normal scheduled ID.
begin transaction read only;
set local statement_timeout = '15s';

with target as (select '__MORNING_WORKSPACE_KEY__'::text workspace_key),
runner as (select * from pg_catalog.pg_proc where oid=to_regprocedure('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)')),
builder as (select * from pg_catalog.pg_proc where oid=to_regprocedure('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)')),
wrapper as (select * from pg_catalog.pg_proc where oid=to_regprocedure('public.run_ship_dynamics_record_daily_morning_1000_v1()')),
expected as (
  select replace(format($wrapper$
begin
  if current_user is distinct from pg_get_userbyid((select proowner from pg_catalog.pg_proc
    where oid='public.run_ship_dynamics_record_daily_morning_1000_v1()'::regprocedure)) then
    raise exception 'morning-cron-owner-required' using errcode='42501';
  end if;
  return public.run_ship_dynamics_record_daily_morning_v1(
    %L,pg_catalog.gen_random_uuid()::text,pg_catalog.clock_timestamp());
end;
$wrapper$,workspace_key),chr(13)||chr(10),chr(10)) body from target
), checks as (
select 'existing_pg_cron' as check_name,exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') as passed
union all select 'cron_timezone_is_UTC_or_GMT',coalesce(upper(current_setting('cron.timezone',true)) in ('UTC','GMT'),false)
union all select 'explicit_target_literal',
  (select workspace_key<>('__MORNING_'||'WORKSPACE_KEY__') and workspace_key<>'' and workspace_key=btrim(workspace_key) from target) as passed
union all select 'complete_cron_visibility',not pg_catalog.row_security_active('cron.job'::regclass)
union all select 'complete_legacy_scope_visibility',
  not pg_catalog.row_security_active('public.sd_workspaces'::regclass) and not pg_catalog.row_security_active('public.sd_memberships'::regclass)
union all select 'workspace_binding_present',exists(
  select 1 from target t join public.sd_workspaces w on w.legacy_key=t.workspace_key
  join public.ship_dynamics_record_workspaces r on r.workspace_key=t.workspace_key)
union all select 'active_listed_records_owner',exists(
  select 1 from target t join public.ship_dynamics_records r on r.workspace_key=t.workspace_key
  join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
  cross join lateral jsonb_array_elements_text(c.ids) ids(id)
  where r.collection='users' and ids.id=r.entity_id and r.value->>'role'='owner' and r.value->'isActive'='true'::jsonb)
union all select 'exact_complete_runner',exists(select 1 from runner where md5(replace(prosrc,chr(13)||chr(10),chr(10)))
  in ('4b20d5d01591725aab95ef23d42333b0','6de9249ad24b80ed36e37b0b80e7405e'))
union all select 'exact_complete_builder',exists(select 1 from builder where md5(replace(prosrc,chr(13)||chr(10),chr(10)))='72500bf7ac679d963ae4bbcfdc15889c')
union all select 'builder_invoker_existing_server_acl_config',exists(select 1 from builder b cross join runner r where not b.prosecdef and b.proowner=r.proowner
  and b.provolatile='s' and b.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
  and b.proconfig=array['search_path=pg_catalog, public']::text[]
  and not exists(select 1 from aclexplode(coalesce(b.proacl,acldefault('f',b.proowner))) a
    where a.privilege_type='EXECUTE' and a.grantee<>b.proowner
      and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='service_role'))
  and not exists(select 1 from pg_catalog.pg_roles a where a.rolname in ('anon','authenticated') and has_function_privilege(a.oid,b.oid,'EXECUTE')))
union all select 'runner_invoker_existing_server_acl',exists(select 1 from runner r where not r.prosecdef
  and (select count(*)=3 from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role'))
  and not exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
    where a.privilege_type='EXECUTE' and a.grantee<>r.proowner
      and a.grantee<>(select oid from pg_catalog.pg_roles where rolname='service_role'))
  and not exists(select 1 from pg_catalog.pg_roles b where b.rolname in ('anon','authenticated') and has_function_privilege(b.oid,r.oid,'EXECUTE')))
union all select 'pause_replay_coherent',exists(
  select 1 from runner r join pg_catalog.pg_proc g on g.oid=to_regprocedure('public.ship_dynamics_record_writer_gate_v1(text,boolean)')
  where position('ship_dynamics_quiescence_private.assert_write_v1(p_workspace)' in g.prosrc)=0
    or md5(replace(r.prosrc,chr(13)||chr(10),chr(10)))='6de9249ad24b80ed36e37b0b80e7405e')
union all select 'wrapper_exact_literal_owner_invoker',exists(select 1 from wrapper w cross join runner r cross join expected e
  where replace(w.prosrc,chr(13)||chr(10),chr(10))=e.body and w.proowner=r.proowner and not w.prosecdef
    and w.provolatile='v' and w.prorettype='jsonb'::regtype
    and w.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
    and w.proconfig=array['search_path=pg_catalog, public']::text[])
union all select 'wrapper_owner_only_acl',exists(select 1 from wrapper w where
  not exists(select 1 from aclexplode(coalesce(w.proacl,acldefault('f',w.proowner))) a where a.grantee<>w.proowner and a.privilege_type='EXECUTE')
  and not exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid,w.oid,'EXECUTE')))
union all select 'one_exact_1000_owner_job',
  (select count(*)=1 from cron.job where jobname='ship-dynamics-record-daily-morning-1000-taipei') and exists(
    select 1 from cron.job j cross join runner r
    where j.jobname='ship-dynamics-record-daily-morning-1000-taipei' and j.schedule='0 2 * * *' and j.active
      and j.database=current_database() and j.username=pg_get_userbyid(r.proowner)
      and j.command='select public.run_ship_dynamics_record_daily_morning_1000_v1();')
union all select 'old_morning_job_absent',not exists(select 1 from cron.job where jobname='ship-dynamics-daily-morning-0900-taipei')
union all select 'existing_Itinerary_0900_still_exact',
  (select count(*)=1 from cron.job where jobname='ship-dynamics-daily-itinerary-0900-taipei') and exists(
    select 1 from cron.job where jobname='ship-dynamics-daily-itinerary-0900-taipei' and schedule='0 1 * * *' and active
      and database=current_database() and btrim(command)='select public.ship_dynamics_run_daily_itinerary_reports();')
)
select case when bool_and(coalesce(passed,false)) then 'PASS_INSTALL_ONLY' else 'REQUIRES_INSTALL_OR_REVIEW' end as status,
  jsonb_object_agg(check_name,coalesce(passed,false)) as checks,
  'Catalog only; actual 10:00 job and exact saved report readback are still required'::text as evidence_boundary
from checks;

commit;
