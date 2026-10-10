-- Operator-run cron installation; separate from core migration.
-- Operator separately authorizes this cron installation AFTER core/readback.
-- Replace the whole SQL literal __MORNING_WORKSPACE_KEY__ with the verified
-- public runtime workspace key (SQL-escape apostrophes; do not infer a key).
-- UTC 02:00 = Taipei 10:00, EVERY day. Itinerary 09:00 job is read-only here.
-- Missing pg_cron is a prerequisite failure, NOT permission to enable it.
begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(hashtext('record-maintenance-v1'),0);
do $cron_install$
declare
  target constant text := '__MORNING_WORKSPACE_KEY__';
  old_name constant text := 'ship-dynamics-daily-morning-0900-taipei';
  new_name constant text := 'ship-dynamics-record-daily-morning-1000-taipei';
  itinerary_name constant text := 'ship-dynamics-daily-itinerary-0900-taipei';
  old_command constant text := 'select public.ship_dynamics_run_daily_morning_snapshots();';
  new_command constant text := 'select public.run_ship_dynamics_record_daily_morning_1000_v1();';
  runner regprocedure; wrapper regprocedure; legacy_fn regprocedure;
  p pg_catalog.pg_proc%rowtype; runner_owner oid; formal_workspace uuid;
  old_job record; new_job record; itinerary_job record;
  old_count integer; new_count integer; itinerary_count integer; installed_job bigint;
  itinerary_before jsonb; itinerary_after jsonb; deps_before jsonb; deps_after jsonb; dep_ids oid[];
  body text; runner_source text; legacy_source text; cron_timezone text; role_name text;
begin
  if target=('__MORNING_'||'WORKSPACE_KEY__') or target='' or target<>btrim(target) then
    raise exception 'morning-explicit-runtime-workspace-literal-required';
  end if;
  if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron')
    or to_regclass('cron.job') is null
    or to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('cron.unschedule(bigint)') is null
    or to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'morning-existing-pg-cron-and-functions-required; extension NOT enabled';
  end if;
  cron_timezone := current_setting('cron.timezone',true);
  if cron_timezone is null or upper(cron_timezone) not in ('UTC','GMT') then
    raise exception 'morning-cron-timezone-UTC-or-GMT-required';
  end if;
  if pg_catalog.row_security_active('cron.job'::regclass) then
    raise exception 'morning-complete-cron-catalog-visibility-required';
  end if;
  runner := to_regprocedure('public.run_ship_dynamics_record_daily_morning_v1(text,text,timestamptz)');
  if runner is null then raise exception 'morning-existing-record-runner-required'; end if;
  select * into strict p from pg_catalog.pg_proc where oid=runner;
  runner_owner := p.proowner;
  runner_source := replace(p.prosrc,chr(13)||chr(10),chr(10));
  if runner_owner<>(select oid from pg_catalog.pg_roles where rolname=current_user) or p.prosecdef then
    raise exception 'morning-record-function-owner-invoker-required' using errcode='42501';
  end if;
  -- Accept only the exact forward body, optionally with its retained pause
  -- replay splice; a marker alone is not installed-state evidence.
  if md5(runner_source) not in ('1ae3124cbf78d0aa0528c1911156a254','fb2b887dfad04606fab02a3dc285d9c6') then
    raise exception 'morning-exact-freeze-once-core-required';
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_catalog.pg_roles where rolname=role_name) then
      raise exception 'morning-existing-Supabase-role-required: %',role_name;
    end if;
    if has_function_privilege(role_name,runner::oid,'EXECUTE') then
      -- Preserve runner ACL: an unexpected existing grant needs a separate decision.
      raise exception 'morning-private-runner-prerequisite-failed: %',role_name;
    end if;
  end loop;
  if to_regclass('public.ship_dynamics_record_workspaces') is null
    or to_regclass('public.ship_dynamics_records') is null
    or to_regclass('public.ship_dynamics_record_collections') is null
    or to_regclass('public.sd_workspaces') is null
    or to_regclass('public.sd_memberships') is null
    or to_regprocedure('public.sd_itinerary_workspace_id(text)') is null then
    raise exception 'morning-existing-workspace-tables-and-mapping-required';
  end if;
  if pg_catalog.row_security_active('public.sd_workspaces'::regclass)
    or pg_catalog.row_security_active('public.sd_memberships'::regclass) then
    raise exception 'morning-complete-legacy-workspace-visibility-required';
  end if;
  formal_workspace := public.sd_itinerary_workspace_id(target);
  if formal_workspace is null or not exists(select 1 from public.sd_workspaces where id=formal_workspace and legacy_key=target)
    or not exists(select 1 from public.ship_dynamics_record_workspaces where workspace_key=target) then
    raise exception 'morning-exact-workspace-binding-required';
  end if;
  -- The SAME records owner eligibility as the runner; no forged browser session.
  if not exists(
    select 1 from public.ship_dynamics_records r
    join public.ship_dynamics_record_collections c on c.workspace_key=r.workspace_key and c.collection=r.collection
    cross join lateral jsonb_array_elements_text(c.ids) with ordinality ids(id,ordinal)
    where r.workspace_key=target and r.collection='users' and ids.id=r.entity_id
      and r.value ->> 'role'='owner' and r.value -> 'isActive'='true'::jsonb
  ) then raise exception 'morning-target-active-record-owner-required'; end if;
  select count(*) into itinerary_count from cron.job where jobname=itinerary_name;
  if itinerary_count<>1 then raise exception 'morning-one-existing-Itinerary-0900-job-required'; end if;
  select * into itinerary_job from cron.job where jobname=itinerary_name;
  if itinerary_job.schedule<>'0 1 * * *' or not itinerary_job.active
    or itinerary_job.database<>current_database()
    or btrim(itinerary_job.command)<>'select public.ship_dynamics_run_daily_itinerary_reports();' then
    raise exception 'morning-Itinerary-0900-predecessor-mismatch; left untouched';
  end if;
  select to_jsonb(j) into itinerary_before from cron.job j where jobid=itinerary_job.jobid;
  select count(*) into old_count from cron.job where jobname=old_name;
  select count(*) into new_count from cron.job where jobname=new_name;
  if old_count>1 or new_count>1 then raise exception 'morning-duplicate-job-name-requires-manual-decision'; end if;
  if old_count=1 then
    select * into old_job from cron.job where jobname=old_name;
    if btrim(old_job.command)<>old_command or old_job.database<>current_database()
      or old_job.username<>current_user or old_job.schedule not in ('0 1 * * 1-5','0 1 * * *') then
      raise exception 'morning-old-job-target-mismatch; NOT unscheduled';
    end if;
    legacy_fn := to_regprocedure('public.ship_dynamics_run_daily_morning_snapshots()');
    if legacy_fn is null then raise exception 'morning-old-job-runner-missing; manual-decision-required'; end if;
    select replace(prosrc,chr(13)||chr(10),chr(10)) into legacy_source from pg_catalog.pg_proc where oid=legacy_fn;
    -- Source fingerprints, NOT a claim about the installed catalog. Two known
    -- bodies: 20260806093000 baseline and its exact authority scheduler splice.
    if md5(legacy_source) not in ('743e787a5b848247fe78524414005852','7cdef9a931a1a1d0b8b9b3bf76a8eb72') then
      raise exception 'morning-unknown-old-runner-scope; NOT unscheduled';
    end if;
    -- The old runner enumerates ALL active formal workspaces with active owners.
    -- Never silently stop another workspace's automatic meeting reports.
    if exists(
      select 1 from public.sd_workspaces w
      where w.is_active and w.legacy_key is distinct from target
        and exists(select 1 from public.sd_memberships m where m.workspace_id=w.id and m.role='owner' and m.is_active)
    ) then
      raise exception 'morning-old-job-serves-other-workspaces; manual-decision-required; NOT unscheduled';
    end if;
  end if;
  if new_count=1 then
    select * into new_job from cron.job where jobname=new_name;
    if new_job.command<>new_command or new_job.schedule<>'0 2 * * *' or not new_job.active
      or new_job.database<>current_database() or new_job.username<>current_user then
      raise exception 'morning-existing-1000-job-mismatch; NOT replaced';
    end if;
  end if;
  dep_ids := array[runner::oid,
    to_regprocedure('public.build_ship_dynamics_record_daily_morning_v1(text,timestamptz)')::oid,
    to_regprocedure('public.ship_dynamics_record_writer_gate_v1(text,boolean)')::oid,
    to_regprocedure('public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)')::oid];
  if array_position(dep_ids,null::oid) is not null then raise exception 'morning-record-dependencies-required'; end if;
  select jsonb_agg(to_jsonb(d) order by d.oid) into deps_before from pg_catalog.pg_proc d where d.oid=any(dep_ids);
  body := replace(format($wrapper$
begin
  if current_user is distinct from pg_get_userbyid((select proowner from pg_catalog.pg_proc
    where oid='public.run_ship_dynamics_record_daily_morning_1000_v1()'::regprocedure)) then
    raise exception 'morning-cron-owner-required' using errcode='42501';
  end if;
  return public.run_ship_dynamics_record_daily_morning_v1(
    %L,pg_catalog.gen_random_uuid()::text,pg_catalog.clock_timestamp());
end;
$wrapper$,target),chr(13)||chr(10),chr(10));
  wrapper := to_regprocedure('public.run_ship_dynamics_record_daily_morning_1000_v1()');
  if wrapper is not null then
    select * into strict p from pg_catalog.pg_proc where oid=wrapper;
    if replace(p.prosrc,chr(13)||chr(10),chr(10)) is distinct from body or p.proowner<>runner_owner
      or p.prosecdef or p.provolatile<>'v' or p.prorettype<>'jsonb'::regtype
      or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
      or p.proconfig is distinct from array['search_path=pg_catalog, public']::text[] then
      raise exception 'morning-existing-wrapper-scope-or-metadata-mismatch; NOT replaced';
    end if;
  else
    execute format('create function public.run_ship_dynamics_record_daily_morning_1000_v1() returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as %L',body);
    wrapper := 'public.run_ship_dynamics_record_daily_morning_1000_v1()'::regprocedure;
  end if;
  execute 'revoke all on function public.run_ship_dynamics_record_daily_morning_1000_v1() from public,anon,authenticated,service_role';
  select * into strict p from pg_catalog.pg_proc where oid=wrapper;
  if p.proowner<>runner_owner or p.prosecdef or replace(p.prosrc,chr(13)||chr(10),chr(10)) is distinct from body
    or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee<>p.proowner and a.privilege_type='EXECUTE') then
    raise exception 'morning-wrapper-owner-only-readback-failed';
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,wrapper::oid,'EXECUTE') then raise exception 'morning-wrapper-effective-grant-rejected: %',role_name; end if;
  end loop;
  if old_count=1 then
    if not cron.unschedule(old_job.jobid) then raise exception 'morning-old-job-unschedule-failed'; end if;
  end if;
  if new_count=0 then installed_job := cron.schedule(new_name,'0 2 * * *',new_command); end if;
  select count(*) into new_count from cron.job where jobname=new_name;
  select * into new_job from cron.job where jobname=new_name;
  select to_jsonb(j) into itinerary_after from cron.job j where jobid=itinerary_job.jobid;
  select jsonb_agg(to_jsonb(d) order by d.oid) into deps_after from pg_catalog.pg_proc d where d.oid=any(dep_ids);
  if new_count<>1 or new_job.command<>new_command or new_job.schedule<>'0 2 * * *'
    or not new_job.active or new_job.database<>current_database() or new_job.username<>current_user
    or exists(select 1 from cron.job where jobname=old_name)
    or itinerary_after is distinct from itinerary_before or deps_after is distinct from deps_before then
    raise exception 'morning-cron-exact-target-readback-failed';
  end if;
  raise notice 'morning-record-1000-installed; old morning removed only if present; Itinerary unchanged';
end;
$cron_install$;
commit;
