-- Read-only installed-state check. Returns no workspace content or credentials.
with validator as (
 select oid,replace(prosrc,E'\r','') body,prosecdef,provolatile,proconfig
 from pg_proc where oid=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)')
), facts as (
 select
 exists(select 1 from validator) validator_exists,
 coalesce((select md5(body)='d9b9d62989b03359d2092562807ed3b0' from validator),false) known_predecessor,
 coalesce((select md5(body)='33cb06e2cd442c1ff80d5e0f75376287' from validator),false) exact_fast_path,
 coalesce((select not prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, public'] from validator),false) execution_mode_unchanged,
 coalesce((select strpos(prosrc,'ship_dynamics_tracking_validate_v1(')>0 from pg_proc where oid=to_regprocedure('public.apply_ship_dynamics_record_patch_v1(text,text,jsonb,text,text,jsonb,jsonb,jsonb)')),false) writer_calls_validator
)
select case when exact_fast_path and execution_mode_unchanged and writer_calls_validator then 'PASS'
 when known_predecessor and execution_mode_unchanged and writer_calls_validator then 'REQUIRES_INSTALL'
 else 'REQUIRES_REVIEW' end status,
 validator_exists,known_predecessor,exact_fast_path,execution_mode_unchanged,writer_calls_validator
from facts;
