-- Add one allowed current-vessel status; no business rows are changed.
-- Requires the installed 20260916090000 current-state migration.
-- Keeps function identity, grants, save/lease/CAS logic and all existing options.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '5s';

do $bunker$
declare
  target oid := to_regprocedure('public.sd_itinerary_rows_valid(jsonb)');
  body_md5 text;
  definition text;
  old_options text := $options$'loading','unloading','to load','to unload','waiting order','drydock/repiar'$options$;
  new_options text := $options$'loading','unloading','to load','to unload','waiting order','drydock/repiar','bunker'$options$;
begin
  if target is null then raise exception 'bunker-current-state-predecessor-missing'; end if;
  select md5(replace(prosrc,chr(13),'')) into body_md5 from pg_proc where oid=target;
  if body_md5 = 'b8de65122a24f611c7a9d9ad5941e62f' then return; end if;
  if body_md5 is distinct from '029a21874ef2b4b2f5444a64d0ab5340' then
    raise exception 'bunker-current-state-predecessor-mismatch';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition)-length(replace(definition,old_options,'')) <> length(old_options) then
    raise exception 'bunker-current-state-option-list-mismatch';
  end if;
  execute replace(definition,old_options,new_options);
  if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) is distinct from 'b8de65122a24f611c7a9d9ad5941e62f' then
    raise exception 'bunker-current-state-install-verification-failed';
  end if;
end $bunker$;

select 'bunker-option-ready' as installation,
  md5(replace(prosrc,chr(13),'')) = 'b8de65122a24f611c7a9d9ad5941e62f' as bunker_ready
from pg_proc where oid=to_regprocedure('public.sd_itinerary_rows_valid(jsonb)');
commit;
