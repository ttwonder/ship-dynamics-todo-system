-- READ-ONLY. Replace __MORNING_WORKSPACE_KEY__ with the SAME verified
-- SQL-escaped public runtime literal used in 02. Do not run either writer,
-- wrapper, cron mutation, pause/source control or normalized RPC in readback.
-- No credentials, network calls, DML, temp tables or installed helper functions.
-- Catalog section works before installation. The later cron/workspace sections
-- require existing tables; missing prerequisites must ERROR, never count as PASS.
-- This is installation/readback evidence, NOT proof of actual cron execution.
--
-- Source-only delivery limitations / later authorized LOCAL acceptance cases:
-- C01 Sat/Sun each create exactly one scheduled report, business date in Taipei.
-- C02 same date + new operation + changed live rows => zero-op receipt; report,
--     audit, workspace/root revision, orders, versions/history/read-bases unchanged.
-- C03 old UNSUFFIXED source=scheduled + kind/date => same zero-op; no second report.
-- C04 old unsuffixed manual row stays byte-exact; new ID ends in -scheduled.
-- C05 manual/foreign occupant of scheduled ID => conflict; no writes/receipt.
-- C06 exact old/new operation-clock replay preserves result schema, replayed=true;
--     changed clock under same operation => mismatch. Retained early replay must
--     still work while paused/retired; NEW operations obey installed writer gate.
-- C07 no active listed records owner => original no-active-owner outcome/no write.
-- C08 two independent transactions same date => one snapshot/audit/revision,
--     two operation receipts; verify true PostgreSQL barriers, not source regex.
-- C09 late receipt insertion error => whole transaction rolls back (nonempty fixture).
-- C10 baseline and pause/authority predecessors preserve runner OID/ACL/config,
--     full replay splice, and later current-state builder; unknown anchors abort.
-- C11 cron/wrapper twice => one identical active 0 2 * * * owner job; inherited
--     browser/service/PUBLIC EXECUTE denied; UUID + server clock + literal target.
-- C12 pg_cron/timezone/mapping/job/body drift or another eligible old-job workspace
--     => whole install aborts; exact preexisting Itinerary 0 1 * * * unchanged.
-- C01-C12 are acceptance requirements; execution receipts are in the handoff document.
-- Once-per-day means while a qualifying frozen row remains in records. Deleting
-- that row can permit a future new operation to regenerate; a deletion-proof
-- tombstone/day-ledger is outside this minimal change. No history is deduplicated.
-- Owner-only excludes database administrators/superusers/roles allowed SET ROLE
-- to the owner. No new grants here; core preserves existing ACLs, cron install
-- fails on unexpected effective runner browser/service grants rather than changes.
-- Unknown installed old legacy runner scope or extra eligible workspace demands
-- a separate operator decision: do NOT broaden the automatic unschedule rule.
begin transaction read only;
set local statement_timeout = '15s';

-- 1. Exact function identity / configuration / effective privileges.
with signatures(signature) as (values
  ('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)'),
  ('public.run_ship_dynamics_record_daily_morning_1000_v1()'),
  ('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)'),
  ('public.ship_dynamics_record_writer_gate_v1(text,boolean)'),
  ('public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)')
), functions as (
  select signature,to_regprocedure(signature)::oid as fn from signatures
)
select f.signature,p.oid,p.oid is not null as present,
  pg_get_userbyid(p.proowner) as owner,not p.prosecdef as security_invoker,
  l.lanname as language,p.provolatile,p.proconfig,p.proacl::text as acl,
  md5(replace(p.prosrc,chr(13)||chr(10),chr(10))) as lf_source_md5,
  case when f.signature like 'public.run_ship_dynamics_record_daily_morning_v1(%' then
    case md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))
      when '3fbc1798df3d36fde1fa0e3872eabf12' then 'known-predecessor-no-pause'
      when '2b9cca1976041408af79642c7a7fc772' then 'known-predecessor-with-pause'
      when '1ae3124cbf78d0aa0528c1911156a254' then 'forward-freeze-once-no-pause'
      when 'fb2b887dfad04606fab02a3dc285d9c6' then 'forward-freeze-once-with-pause'
      else 'MISSING-OR-UNKNOWN; NOT PASS' end end as runner_body_state,
  case when p.oid is null then null else
    not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee<>p.proowner and a.privilege_type='EXECUTE') end as acl_owner_only,
  case when p.oid is null then null else
    not exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('anon','authenticated','service_role')
      and has_function_privilege(r.oid,p.oid,'EXECUTE')) end as no_effective_browser_or_service_execute,
  case when f.signature='public.ship_dynamics_record_writer_gate_v1(text,boolean)' then
    position('ship_dynamics_quiescence_private.assert_write_v1(p_workspace)' in p.prosrc)>0 end as installed_pause_gate,
  case when f.signature='public.ship_dynamics_record_writer_gate_v1(text,boolean)' then
    position('ship_dynamics_authority_private.assert_source_v1(p_workspace,''records-v1'')' in p.prosrc)>0 end as installed_records_authority_gate,
  case when f.signature='public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)' then
    position('public.sd_itinerary_operational_values_v1(d.rows_payload,p_captured_at)' in p.prosrc)>0 end as later_builder_helper_retained
from functions f left join pg_catalog.pg_proc p on p.oid=f.fn
left join pg_catalog.pg_language l on l.oid=p.prolang order by f.signature;

-- 2. Existing Supabase/pg_cron prerequisites; no CREATE EXTENSION / setting change.
select 'pg_cron_extension' as check_name,
  exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') as passed
union all select 'cron_schedule_function',to_regprocedure('cron.schedule(text,text,text)') is not null
union all select 'cron_unschedule_function',to_regprocedure('cron.unschedule(bigint)') is not null
union all select 'server_uuid_function',to_regprocedure('pg_catalog.gen_random_uuid()') is not null
union all select 'cron_timezone_is_UTC_or_GMT',coalesce(upper(current_setting('cron.timezone',true)) in ('UTC','GMT'),false)
union all select 'Supabase_roles_present',(select count(*)=3 from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role'))
union all select 'cron_job_catalog_present',to_regclass('cron.job') is not null;
select current_setting('cron.timezone',true) as observed_cron_timezone;

-- 4. Bounded records-only readback, not history/legacy materialization.
with target as (select '__MORNING_WORKSPACE_KEY__'::text workspace_key)
select w.workspace_key,w.revision,w.updated_at,w.updated_by,
  exists(select 1 from public.ship_dynamics_records r
    join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
    cross join lateral jsonb_array_elements_text(c.ids) ids(id)
    where r.workspace_key=w.workspace_key and r.collection='users' and ids.id=r.entity_id
      and r.value ->> 'role'='owner' and r.value -> 'isActive'='true'::jsonb) as active_listed_records_owner
from public.ship_dynamics_record_workspaces w join target t on t.workspace_key=w.workspace_key;
with target as (select '__MORNING_WORKSPACE_KEY__'::text workspace_key)
select r.value ->> 'businessDate' as business_date,r.value ->> 'source' as source,
  count(*) as current_reports,array_agg(r.entity_id order by r.entity_id) as literal_report_ids
from public.ship_dynamics_records r join target t on t.workspace_key=r.workspace_key
where r.collection='agendaReports' and r.value ->> 'kind'='daily-morning'
group by r.value ->> 'businessDate',r.value ->> 'source'
order by business_date desc,source limit 31;

-- 3. Exact target/wrapper/new morning job; untouched Itinerary contract.
select jobid,jobname,schedule,active,username,database,md5(command) as command_md5
from cron.job where jobname in ('ship-dynamics-record-daily-morning-1000-taipei',
  'ship-dynamics-daily-morning-0900-taipei','ship-dynamics-daily-itinerary-0900-taipei') order by jobname,jobid;

with target as (select '__MORNING_WORKSPACE_KEY__'::text workspace_key),
runner as (select * from pg_catalog.pg_proc where oid=to_regprocedure('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)')),
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
union all select 'exact_forward_runner',exists(select 1 from runner where md5(replace(prosrc,chr(13)||chr(10),chr(10)))
  in ('1ae3124cbf78d0aa0528c1911156a254','fb2b887dfad04606fab02a3dc285d9c6'))
union all select 'runner_invoker_owner_only',exists(select 1 from runner r where not r.prosecdef
  and not exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a where a.grantee<>r.proowner and a.privilege_type='EXECUTE')
  and not exists(select 1 from pg_catalog.pg_roles b where b.rolname in ('anon','authenticated','service_role') and has_function_privilege(b.oid,r.oid,'EXECUTE')))
union all select 'pause_replay_coherent',exists(
  select 1 from runner r join pg_catalog.pg_proc g on g.oid=to_regprocedure('public.ship_dynamics_record_writer_gate_v1(text,boolean)')
  where position('ship_dynamics_quiescence_private.assert_write_v1(p_workspace)' in g.prosrc)=0
    or md5(replace(r.prosrc,chr(13)||chr(10),chr(10)))='fb2b887dfad04606fab02a3dc285d9c6')
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
