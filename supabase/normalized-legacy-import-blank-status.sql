begin;

do $migration$
declare
  v_signature constant regprocedure :=
    'public.import_ship_dynamics_legacy(uuid,text,text,bigint,jsonb,jsonb,jsonb,integer)'::regprocedure;
  v_marker constant text := '-- normalized-migration:blank-legacy-task-status-preserved';
  v_status_condition constant text := 'btrim(coalesce(v_item ->> ''status'', '''')) = ''''';
  v_old_crlf constant text := E'       or btrim(coalesce(v_item ->> ''description'', '''')) = ''''\r\n       or btrim(coalesce(v_item ->> ''status'', '''')) = ''''\r\n       or v_item ->> ''priority'' <> all(v_priorities)\r\n       or v_item ->> ''sourceType'' not in (''morning'', ''temporary'')\r\n';
  v_old_lf constant text := E'       or btrim(coalesce(v_item ->> ''description'', '''')) = ''''\n       or btrim(coalesce(v_item ->> ''status'', '''')) = ''''\n       or v_item ->> ''priority'' <> all(v_priorities)\n       or v_item ->> ''sourceType'' not in (''morning'', ''temporary'')\n';
  v_new_crlf constant text := E'       or btrim(coalesce(v_item ->> ''description'', '''')) = ''''\r\n       -- normalized-migration:blank-legacy-task-status-preserved\r\n       or v_item ->> ''priority'' <> all(v_priorities)\r\n       or v_item ->> ''sourceType'' not in (''morning'', ''temporary'')\r\n';
  v_new_lf constant text := E'       or btrim(coalesce(v_item ->> ''description'', '''')) = ''''\n       -- normalized-migration:blank-legacy-task-status-preserved\n       or v_item ->> ''priority'' <> all(v_priorities)\n       or v_item ->> ''sourceType'' not in (''morning'', ''temporary'')\n';
  v_definition text;
  v_count integer;
  v_status_count_before integer;
  v_status_count_after integer;
  v_applied boolean := false;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  v_status_count_before := (
    length(v_definition) - length(replace(v_definition, v_status_condition, ''))
  ) / length(v_status_condition);

  if position(v_marker in v_definition) = 0 then
    v_count := (
      length(v_definition) - length(replace(v_definition, v_old_crlf, ''))
    ) / length(v_old_crlf);
    if v_count = 1 then
      v_definition := replace(v_definition, v_old_crlf, v_new_crlf);
    elsif v_count = 0 then
      v_count := (
        length(v_definition) - length(replace(v_definition, v_old_lf, ''))
      ) / length(v_old_lf);
      if v_count = 1 then
        v_definition := replace(v_definition, v_old_lf, v_new_lf);
      end if;
    end if;
    if v_count <> 1 then
      raise exception using errcode = 'P0001', message = 'blank-status-patch-unexpected-function-shape';
    end if;
    execute v_definition;
    v_applied := true;
  elsif position(v_old_crlf in v_definition) > 0
        or position(v_old_lf in v_definition) > 0 then
    raise exception using errcode = 'P0001', message = 'blank-status-patch-inconsistent-marker';
  end if;

  select pg_get_functiondef(v_signature) into strict v_definition;
  v_status_count_after := (
    length(v_definition) - length(replace(v_definition, v_status_condition, ''))
  ) / length(v_status_condition);
  if position(v_marker in v_definition) = 0
     or (v_applied and v_status_count_after <> v_status_count_before - 1)
     or (not v_applied and v_status_count_after <> v_status_count_before) then
    raise exception using errcode = 'P0001', message = 'blank-status-patch-verification-failed';
  end if;
end;
$migration$;

commit;
