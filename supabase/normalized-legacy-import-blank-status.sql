begin;

do $migration$
declare
  v_signature constant regprocedure :=
    'public.import_ship_dynamics_legacy(uuid,text,text,bigint,jsonb,jsonb,jsonb,integer)'::regprocedure;
  v_definition text;
  v_old_crlf constant text := E'       or btrim(coalesce(v_item ->> ''status'', '''')) = ''''\r\n';
  v_old_lf constant text := E'       or btrim(coalesce(v_item ->> ''status'', '''')) = ''''\n';
  v_fixed_crlf constant text := E'       or btrim(coalesce(v_item ->> ''description'', '''')) = ''''\r\n       or v_item ->> ''priority'' <> all(v_priorities)\r\n';
  v_fixed_lf constant text := E'       or btrim(coalesce(v_item ->> ''description'', '''')) = ''''\n       or v_item ->> ''priority'' <> all(v_priorities)\n';
  v_count integer;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;

  v_count := (
    length(v_definition) - length(replace(v_definition, v_old_crlf, ''))
  ) / length(v_old_crlf);
  if v_count = 0 then
    v_count := (
      length(v_definition) - length(replace(v_definition, v_old_lf, ''))
    ) / length(v_old_lf);
    if v_count = 1 then
      v_definition := replace(v_definition, v_old_lf, '');
    elsif v_count > 1 then
      raise exception using errcode = 'P0001', message = 'blank-status-patch-ambiguous';
    end if;
  elsif v_count = 1 then
    v_definition := replace(v_definition, v_old_crlf, '');
  else
    raise exception using errcode = 'P0001', message = 'blank-status-patch-ambiguous';
  end if;

  if v_count = 1 then
    execute v_definition;
  elsif position(v_fixed_crlf in v_definition) = 0
        and position(v_fixed_lf in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'blank-status-patch-unexpected-function-shape';
  end if;

  select pg_get_functiondef(v_signature) into strict v_definition;
  if position(v_old_crlf in v_definition) > 0
     or position(v_old_lf in v_definition) > 0
     or (
       position(v_fixed_crlf in v_definition) = 0
       and position(v_fixed_lf in v_definition) = 0
     ) then
    raise exception using errcode = 'P0001', message = 'blank-status-patch-verification-failed';
  end if;
end;
$migration$;

commit;
