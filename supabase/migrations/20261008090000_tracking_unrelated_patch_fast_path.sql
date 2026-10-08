-- Pure report/vessel/audit patches do not change tracking relationships.
-- Preserve the installed validator, its signature, ACL and all relevant checks.
-- This forward patch accepts only the exact completion-close predecessor.
-- Unknown/newer definitions fail closed instead of overwriting features.
begin;
do $upgrade$
declare
 fn regprocedure:=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)');
 source text; definition text; insertion_at integer;
 guard text:=E' -- SD_TRACKING_UNRELATED_PATCH_FAST_PATH_V1\n if not exists (select 1 from jsonb_array_elements(p_ops) o where o->>''kind''=''entity'' and o->>''collection'' in (''trackingItems'',''internalControlCases'',''tasks'')) then return null;end if;\n';
begin
 if fn is null then raise exception 'tracking-unrelated-patch-validator-missing';end if;
 select replace(prosrc,E'\r',''),replace(pg_get_functiondef(oid),E'\r','') into source,definition from pg_proc where oid=fn;
 if md5(source)='33cb06e2cd442c1ff80d5e0f75376287' then return;end if;
 if md5(source)<>'d9b9d62989b03359d2092562807ed3b0' then
  raise exception 'tracking-unrelated-patch-predecessor-mismatch';
 end if;
 insertion_at:=strpos(definition,E'begin\n');
 if insertion_at=0 then raise exception 'tracking-unrelated-patch-insertion-missing';end if;
 definition:=overlay(definition placing E'begin\n'||guard from insertion_at for length(E'begin\n'));
 execute definition;
 select replace(prosrc,E'\r','') into source from pg_proc where oid=fn;
 if md5(source)<>'33cb06e2cd442c1ff80d5e0f75376287' then
  raise exception 'tracking-unrelated-patch-install-mismatch';
 end if;
end $upgrade$;
commit;
