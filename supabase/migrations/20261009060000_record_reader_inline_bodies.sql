-- Preserve full read coverage and every existing integrity/permission predicate.
-- Only let PostgreSQL inline the multiply-used wide record CTE, so indexed
-- collection/member probes do not copy and repeatedly scan snapshot bodies.
-- Accept the exact known v2 predecessor only; keep OID/ACL/security/settings.
begin;
do $upgrade$
declare
 fn regprocedure:=to_regprocedure('public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb)');
 source text; definition text;
begin
 if fn is null then raise exception 'record-reader-inline-function-missing';end if;
 select replace(prosrc,E'\r',''),replace(pg_get_functiondef(oid),E'\r','') into source,definition from pg_proc where oid=fn;
 if md5(source)='ff3316f9b90469a0f41cad81082f531f' then return;end if;
 if md5(source)<>'29a16b82cf452a72736a10448182e607' then raise exception 'record-reader-inline-predecessor-mismatch';end if;
 definition:=replace(definition,'with bodies as (','with bodies as not materialized (');
 execute definition;
 select replace(prosrc,E'\r','') into source from pg_proc where oid=fn;
 if md5(source)<>'ff3316f9b90469a0f41cad81082f531f' then raise exception 'record-reader-inline-install-mismatch';end if;
end $upgrade$;
commit;
