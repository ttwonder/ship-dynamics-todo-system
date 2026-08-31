-- Read-only verification for 20260831110000_itinerary_rollout_bootstrap.sql.
select
  to_regprocedure('public.sd_itinerary_get_rollout(text)') is not null as rollout_rpc_exists,
  has_function_privilege('authenticated', 'public.sd_itinerary_get_rollout(text)', 'EXECUTE') as authenticated_execute,
  not has_function_privilege('anon', 'public.sd_itinerary_get_rollout(text)', 'EXECUTE') as anon_execute_denied,
  coalesce((
    select position('''version''' in p.prosrc) > 0
    from pg_proc p
    where p.oid = to_regprocedure('public.sd_itinerary_get_rollout(text)')::oid
  ), false) as rollout_version_returned,
  not exists(
    select 1 from public.sd_itinerary_rollout where version < 1
  ) as rollout_versions_valid;
