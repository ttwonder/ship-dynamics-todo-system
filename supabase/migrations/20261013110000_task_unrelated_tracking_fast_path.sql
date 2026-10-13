-- Ordinary task requests must not hydrate unrelated tracking groups while the
-- shared workspace publication lock is held. No data rewrite, new endpoint,
-- grant, timeout change or weaker actor/CAS/lease rule is introduced.
-- Preserve the exact completion-close + unrelated-patch validator predecessor.
begin;
do $upgrade$
declare
 fn regprocedure:=to_regprocedure('public.ship_dynamics_tracking_validate_v1(text,jsonb,text,jsonb,jsonb)');
 source text; definition text; insertion_at integer;
 guard text:=$guard$ -- SD_TASK_UNRELATED_TRACKING_FAST_PATH_V1
 -- Do not guess from expected=null or a task's frontend flags: an existing
 -- tracking case can have a dangling linkedTaskId equal to this newly used ID.
 -- Preserve the original NULL equality, retained/closed-source participation,
 -- and malformed events error path. Linked/mixed commands use the full validator.
 if not exists (select 1 from jsonb_array_elements(p_ops) o
   where o->>'kind'='entity' and o->>'collection' in ('trackingItems','internalControlCases'))
  and not exists (select 1 from public.ship_dynamics_records s
   where s.workspace_key=p_workspace and s.collection='trackingItems'
    and coalesce(jsonb_typeof(s.value->'events'),'array')<>'array')
  and not exists (
   select 1 from public.ship_dynamics_records s
   join public.ship_dynamics_records c on c.workspace_key=s.workspace_key
    and c.collection='internalControlCases' and c.entity_id=s.value->>'linkedCaseId'
   join jsonb_array_elements(p_ops) o on o->>'kind'='entity'
    and o->>'collection'='tasks' and o->>'entityId'=c.value->>'linkedTaskId'
   where s.workspace_key=p_workspace and s.collection='trackingItems'
  ) then return null;end if;
$guard$;
begin
 guard:=replace(guard,E'\r','');
 if fn is null then raise exception 'task-unrelated-tracking-validator-missing';end if;
 select replace(prosrc,E'\r',''),replace(pg_get_functiondef(oid),E'\r','') into source,definition from pg_proc where oid=fn;
 if strpos(source,'SD_TASK_UNRELATED_TRACKING_FAST_PATH_V1')>0 then
  if strpos(source,guard)=0 or md5(replace(source,guard,''))<>'33cb06e2cd442c1ff80d5e0f75376287' then
   raise exception 'task-unrelated-tracking-predecessor-mismatch';
  end if;
  return;
 end if;
 if md5(source)<>'33cb06e2cd442c1ff80d5e0f75376287' then
  raise exception 'task-unrelated-tracking-predecessor-mismatch';
 end if;
 insertion_at:=strpos(definition,E'begin\n');
 if insertion_at=0 then raise exception 'task-unrelated-tracking-insertion-missing';end if;
 definition:=overlay(definition placing E'begin\n'||guard from insertion_at for length(E'begin\n'));
 execute definition;
 select replace(prosrc,E'\r','') into source from pg_proc where oid=fn;
 if strpos(source,guard)=0 or md5(replace(source,guard,''))<>'33cb06e2cd442c1ff80d5e0f75376287' then
  raise exception 'task-unrelated-tracking-install-mismatch';
 end if;
end $upgrade$;
commit;
