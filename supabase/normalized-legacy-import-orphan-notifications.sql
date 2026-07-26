begin;

do $migration$
declare
  v_signature constant regprocedure :=
    'public.import_ship_dynamics_legacy(uuid,text,text,bigint,jsonb,jsonb,jsonb,integer)'::regprocedure;
  v_marker constant text := '-- normalized-migration:orphan-notification-quarantine';
  v_early_old_crlf constant text := E'  if v_quarantine_count <> p_expected_quarantine_count then\r\n    raise exception using errcode = ''P0001'', message = ''quarantine-count-mismatch'';\r\n  end if;\r\n\r\n  -- Internal-control cases and exact reciprocal one-to-one links.\r\n';
  v_early_old_lf constant text := E'  if v_quarantine_count <> p_expected_quarantine_count then\n    raise exception using errcode = ''P0001'', message = ''quarantine-count-mismatch'';\n  end if;\n\n  -- Internal-control cases and exact reciprocal one-to-one links.\n';
  v_early_new_crlf constant text := E'  -- Internal-control cases and exact reciprocal one-to-one links.\r\n';
  v_early_new_lf constant text := E'  -- Internal-control cases and exact reciprocal one-to-one links.\n';
  v_relation_old_crlf constant text := E'    if v_auth_id is null\r\n       or not exists (\r\n         select 1 from public.sd_vessels v\r\n         where v.workspace_id = p_workspace_id\r\n           and v.id = v_item ->> ''vesselId''\r\n       )\r\n       or not exists (\r\n         select 1 from public.sd_tasks t\r\n         where t.workspace_id = p_workspace_id\r\n           and t.id = v_item ->> ''taskId''\r\n       ) then\r\n      raise exception using errcode = ''P0001'', message = ''unknown-notification-relation'';\r\n    end if;\r\n';
  v_relation_old_lf constant text := E'    if v_auth_id is null\n       or not exists (\n         select 1 from public.sd_vessels v\n         where v.workspace_id = p_workspace_id\n           and v.id = v_item ->> ''vesselId''\n       )\n       or not exists (\n         select 1 from public.sd_tasks t\n         where t.workspace_id = p_workspace_id\n           and t.id = v_item ->> ''taskId''\n       ) then\n      raise exception using errcode = ''P0001'', message = ''unknown-notification-relation'';\n    end if;\n';
  v_relation_new_crlf constant text := E'    if v_auth_id is null\r\n       or not exists (\r\n         select 1 from public.sd_vessels v\r\n         where v.workspace_id = p_workspace_id\r\n           and v.id = v_item ->> ''vesselId''\r\n       )\r\n       or not exists (\r\n         select 1 from public.sd_tasks t\r\n         where t.workspace_id = p_workspace_id\r\n           and t.id = v_item ->> ''taskId''\r\n       ) then\r\n      -- normalized-migration:orphan-notification-quarantine\r\n      v_quarantine_count := v_quarantine_count + 1;\r\n      insert into public.sd_migration_quarantine(\r\n        workspace_id, id, reason, legacy_revision,\r\n        entity_type, entity_id, payload, version, created_at\r\n      ) values (\r\n        p_workspace_id,\r\n        ''legacy-notification:'' || (v_item ->> ''id'') || '':r'' ||\r\n          p_expected_legacy_revision::text,\r\n        case\r\n          when v_auth_id is null then ''notification_recipient_missing''\r\n          when not exists (\r\n            select 1 from public.sd_vessels v\r\n            where v.workspace_id = p_workspace_id\r\n              and v.id = v_item ->> ''vesselId''\r\n          ) then ''notification_vessel_missing''\r\n          else ''notification_task_missing''\r\n        end,\r\n        p_expected_legacy_revision,\r\n        ''notification'', v_item ->> ''id'', v_item, 1, v_imported_at\r\n      );\r\n      continue;\r\n    end if;\r\n';
  v_relation_new_lf constant text := replace(v_relation_new_crlf, E'\r\n', E'\n');
  v_definition text;
  v_early_count integer;
  v_relation_count integer;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;

  if position(v_marker in v_definition) = 0 then
    v_early_count := (
      length(v_definition) - length(replace(v_definition, v_early_old_crlf, ''))
    ) / length(v_early_old_crlf);
    if v_early_count = 1 then
      v_definition := replace(v_definition, v_early_old_crlf, v_early_new_crlf);
    elsif v_early_count = 0 then
      v_early_count := (
        length(v_definition) - length(replace(v_definition, v_early_old_lf, ''))
      ) / length(v_early_old_lf);
      if v_early_count = 1 then
        v_definition := replace(v_definition, v_early_old_lf, v_early_new_lf);
      end if;
    end if;

    v_relation_count := (
      length(v_definition) - length(replace(v_definition, v_relation_old_crlf, ''))
    ) / length(v_relation_old_crlf);
    if v_relation_count = 1 then
      v_definition := replace(v_definition, v_relation_old_crlf, v_relation_new_crlf);
    elsif v_relation_count = 0 then
      v_relation_count := (
        length(v_definition) - length(replace(v_definition, v_relation_old_lf, ''))
      ) / length(v_relation_old_lf);
      if v_relation_count = 1 then
        v_definition := replace(v_definition, v_relation_old_lf, v_relation_new_lf);
      end if;
    end if;

    if v_early_count <> 1 or v_relation_count <> 1 then
      raise exception using errcode = 'P0001', message = 'orphan-notification-patch-unexpected-function-shape';
    end if;
    execute v_definition;
  elsif position(v_early_old_crlf in v_definition) > 0
        or position(v_early_old_lf in v_definition) > 0
        or position(v_relation_old_crlf in v_definition) > 0
        or position(v_relation_old_lf in v_definition) > 0 then
    raise exception using errcode = 'P0001', message = 'orphan-notification-patch-inconsistent-marker';
  end if;

  select pg_get_functiondef(v_signature) into strict v_definition;
  if position(v_marker in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'orphan-notification-patch-verification-failed';
  end if;
end;
$migration$;

commit;
