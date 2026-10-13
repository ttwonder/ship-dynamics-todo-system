-- Read-only installed-state check; returns catalog metadata only, no business
-- payloads or credentials. Exact fingerprint verified by the native gate.
select case when p.oid is null then 'MISSING'
 when md5(replace(p.prosrc,E'\r',''))='33cb06e2cd442c1ff80d5e0f75376287' then 'NOT_INSTALLED'
 when md5(replace(p.prosrc,E'\r',''))='a4e8072efb82e2c64d87f8d664eb9f58'
  and p.provolatile='s' and not p.prosecdef
  and p.proconfig=array['search_path=pg_catalog, public']
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE') then 'PASS'
 else 'UNKNOWN_PREDECESSOR' end status,
 p.oid::text function_oid,md5(replace(p.prosrc,E'\r','')) validator_body_md5,
 p.provolatile='s' stable_unchanged,not p.prosecdef invoker_unchanged,
 p.proconfig function_settings,p.proacl::text function_acl
from (select to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)') oid) f
left join pg_proc p on p.oid=f.oid;
