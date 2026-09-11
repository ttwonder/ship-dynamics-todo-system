begin;
-- LOCAL development prerequisite for the canonical sd_workspaces(legacy_key)
-- schema. Correct only the three original-App legacy report workspace lookups.
-- No table/actor/receipt/CAS/ACL change; install after existing report migrations.
-- This is not a production execution or an arbitrary-schema upgrade strategy.
do $binding$
declare
 signature text;definition text;old_count integer;new_count integer;
 old_ref constant text:='workspace.workspace_key';
 new_ref constant text:='workspace.legacy_key';
begin
 if not exists(select 1 from pg_attribute where attrelid='public.sd_workspaces'::regclass and attname='legacy_key' and attnum>0 and not attisdropped)
 or exists(select 1 from pg_attribute where attrelid='public.sd_workspaces'::regclass and attname='workspace_key' and attnum>0 and not attisdropped)
 then raise exception 'legacy-report-workspace-schema-unrecognized';end if;
 foreach signature in array array[
  'public.sd_save_manual_itinerary_report(text,text,uuid)',
  'public.delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)',
  'public.delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)'
 ] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  old_count:=(length(definition)-length(replace(definition,old_ref,'')))/length(old_ref);
  new_count:=(length(definition)-length(replace(definition,new_ref,'')))/length(new_ref);
  if old_count=1 and new_count=0 then execute replace(definition,old_ref,new_ref);
  elsif old_count=0 and new_count=1 then null;
  else raise exception 'legacy-report-workspace-definition-unrecognized';end if;
 end loop;
end;
$binding$;
commit;
