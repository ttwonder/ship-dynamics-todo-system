-- Read-only catalog check: no workspace data, credentials or writes.
with reader as (
 select oid,replace(prosrc,E'\r','') body,prosecdef,provolatile,proconfig
 from pg_proc where oid=to_regprocedure('public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb)')
), facts as (
 select exists(select 1 from reader) reader_exists,
 coalesce((select md5(body)='29a16b82cf452a72736a10448182e607' from reader),false) known_predecessor,
 coalesce((select md5(body)='ff3316f9b90469a0f41cad81082f531f' from reader),false) exact_inline_reader,
 coalesce((select prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, public'] from reader),false) execution_mode_expected,
 coalesce((select has_function_privilege('anon',oid,'EXECUTE') from reader),false) anon_can_read,
 coalesce((select has_function_privilege('authenticated',oid,'EXECUTE') from reader),false) authenticated_can_read
)
-- The mounted browser uses anon; report authenticated separately. Installed
-- v1 grants are inherited independently, so absent authenticated is not a defect.
select case when exact_inline_reader and execution_mode_expected and anon_can_read then 'PASS'
 when known_predecessor and execution_mode_expected and anon_can_read then 'REQUIRES_INSTALL'
 else 'REQUIRES_REVIEW' end status,reader_exists,known_predecessor,exact_inline_reader,execution_mode_expected,anon_can_read,authenticated_can_read from facts;
