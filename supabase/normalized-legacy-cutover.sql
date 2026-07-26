begin;

-- Service-role-only maintenance controls for the legacy shared-payload table.
-- The trigger is installed only when the legacy table exists so the additive
-- normalized manifest remains composable on an empty staging database. Every
-- freeze/import/restore operation separately verifies that the trigger exists.

create table if not exists public.sd_legacy_write_controls (
  workspace_key text primary key,
  writes_frozen boolean not null default false,
  expected_revision bigint,
  payload_sha256 text,
  restore_in_progress boolean not null default false,
  frozen_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint sd_legacy_control_hash check (
    payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint sd_legacy_control_frozen_complete check (
    not writes_frozen
    or (expected_revision is not null and expected_revision >= 0 and payload_sha256 is not null)
  )
);
alter table public.sd_legacy_write_controls enable row level security;
revoke all on table public.sd_legacy_write_controls from public, anon, authenticated, service_role;

create or replace function public.sd_legacy_jsonb_sha256(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex')
$$;

create or replace function public.sd_guard_legacy_app_state_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_key text := case when tg_op = 'DELETE' then old.workspace_key else new.workspace_key end;
  v_restore boolean;
begin
  -- Serialize every legacy row mutation with freeze/backup/rollback control so
  -- a writer that entered its BEFORE trigger before freeze cannot commit after
  -- the authoritative snapshot was recorded.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workspace_key, 731921)
  );
  select c.restore_in_progress
  into v_restore
  from public.sd_legacy_write_controls c
  where c.workspace_key = v_workspace_key
    and c.writes_frozen;

  if found and not coalesce(v_restore, false) then
    raise exception using errcode = '55000', message = 'legacy-writes-frozen';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.ship_dynamics_app_state') is not null then
    execute 'drop trigger if exists ship_dynamics_maintenance_freeze_trigger on public.ship_dynamics_app_state';
    execute 'create trigger ship_dynamics_maintenance_freeze_trigger before insert or update or delete on public.ship_dynamics_app_state for each row execute function public.sd_guard_legacy_app_state_write()';
  end if;
end
$$;

create or replace function public.sd_assert_legacy_freeze_boundary(p_workspace_key text)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if to_regclass('public.ship_dynamics_app_state') is null then
    raise exception using errcode = '55000', message = 'legacy-source-table-missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ship_dynamics_app_state'::regclass
      and t.tgname = 'ship_dynamics_maintenance_freeze_trigger'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception using errcode = '55000', message = 'legacy-freeze-trigger-missing';
  end if;
  if not exists (
    select 1
    from public.sd_legacy_write_controls c
    where c.workspace_key = p_workspace_key
      and c.writes_frozen
      and not c.restore_in_progress
  ) then
    raise exception using errcode = '55000', message = 'legacy-writes-not-frozen';
  end if;
end;
$$;

drop function if exists public.freeze_ship_dynamics_legacy_writes(text, bigint, text);
create or replace function public.freeze_ship_dynamics_legacy_writes(
  p_workspace_key text,
  p_expected_revision bigint,
  p_expected_payload_sha256 text,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_revision bigint;
  v_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  if btrim(coalesce(p_workspace_key, '')) = ''
     or p_expected_revision is null or p_expected_revision < 0
     or coalesce(p_expected_payload_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid-freeze-identity';
  end if;
  if p_confirmation is distinct from
     'freeze:' || p_workspace_key || ':' || p_expected_revision::text || ':' ||
     p_expected_payload_sha256 then
    raise exception using errcode = '22023', message = 'confirmation-mismatch';
  end if;
  if to_regclass('public.ship_dynamics_app_state') is null then
    raise exception using errcode = '55000', message = 'legacy-source-table-missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ship_dynamics_app_state'::regclass
      and t.tgname = 'ship_dynamics_maintenance_freeze_trigger'
      and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception using errcode = '55000', message = 'legacy-freeze-trigger-missing';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );

  select s.revision, public.sd_legacy_jsonb_sha256(s.payload)
  into v_revision, v_hash
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-source-row-missing';
  end if;
  if v_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;
  if v_hash is distinct from p_expected_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-payload-hash-mismatch';
  end if;

  insert into public.sd_legacy_write_controls(
    workspace_key, writes_frozen, expected_revision, payload_sha256,
    restore_in_progress, frozen_at, updated_at
  ) values (
    p_workspace_key, true, p_expected_revision, v_hash,
    false, clock_timestamp(), clock_timestamp()
  )
  on conflict (workspace_key) do update
    set writes_frozen = true,
        expected_revision = excluded.expected_revision,
        payload_sha256 = excluded.payload_sha256,
        restore_in_progress = false,
        frozen_at = excluded.frozen_at,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'status', 'frozen',
    'workspaceKey', p_workspace_key,
    'revision', p_expected_revision,
    'payloadSha256', v_hash
  );
end;
$$;

drop function if exists public.export_ship_dynamics_legacy_backup(text, bigint);
create or replace function public.export_ship_dynamics_legacy_backup(
  p_workspace_key text,
  p_expected_revision bigint,
  p_expected_payload_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_payload_text text;
  v_hash text;
  v_control record;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  if to_regclass('public.ship_dynamics_app_state') is null then
    raise exception using errcode = '55000', message = 'legacy-source-table-missing';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );
  perform public.sd_assert_legacy_freeze_boundary(p_workspace_key);
  if p_expected_revision is null or p_expected_revision < 0
     or coalesce(p_expected_payload_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid-backup-identity';
  end if;
  select c.expected_revision, c.payload_sha256, c.frozen_at
  into v_control
  from public.sd_legacy_write_controls c
  where c.workspace_key = p_workspace_key
    and c.writes_frozen
    and not c.restore_in_progress
  for share;
  if not found
     or v_control.expected_revision is distinct from p_expected_revision
     or v_control.payload_sha256 is distinct from p_expected_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-freeze-snapshot-mismatch';
  end if;
  select s.workspace_key, s.revision, s.payload, s.updated_at, s.updated_by
  into v_row
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-source-row-missing';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;
  v_payload_text := v_row.payload::text;
  v_hash := encode(sha256(convert_to(v_payload_text, 'UTF8')), 'hex');
  if v_hash is distinct from v_control.payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-source-freeze-hash-mismatch';
  end if;
  return jsonb_build_object(
    'workspaceKey', v_row.workspace_key,
    'revision', v_row.revision,
    'payloadText', v_payload_text,
    'payloadSha256', v_hash,
    'updatedAt', v_row.updated_at,
    'updatedBy', v_row.updated_by,
    'frozenAt', v_control.frozen_at,
    'exportedAt', clock_timestamp()
  );
end;
$$;

create or replace function public.restore_ship_dynamics_legacy_backup(
  p_workspace_key text,
  p_legacy_revision bigint,
  p_legacy_payload jsonb,
  p_payload_sha256 text,
  p_updated_at timestamptz default null,
  p_updated_by text default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actual_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );
  perform public.sd_assert_legacy_freeze_boundary(p_workspace_key);
  if p_legacy_revision is null or p_legacy_revision < 0 or p_legacy_payload is null then
    raise exception using errcode = '22023', message = 'invalid-restore-package';
  end if;
  v_actual_hash := public.sd_legacy_jsonb_sha256(p_legacy_payload);
  if p_payload_sha256 is distinct from v_actual_hash then
    raise exception using errcode = 'P0001', message = 'backup-payload-hash-mismatch';
  end if;
  if p_confirmation is distinct from
     'restore:' || p_workspace_key || ':' || p_legacy_revision::text || ':' || v_actual_hash then
    raise exception using errcode = '22023', message = 'confirmation-mismatch';
  end if;

  update public.sd_legacy_write_controls
  set restore_in_progress = true, updated_at = clock_timestamp()
  where workspace_key = p_workspace_key and writes_frozen;
  if not found then
    raise exception using errcode = '55000', message = 'legacy-writes-not-frozen';
  end if;

  insert into public.ship_dynamics_app_state(
    workspace_key, payload, revision, updated_at, updated_by
  ) values (
    p_workspace_key, p_legacy_payload, p_legacy_revision,
    coalesce(p_updated_at, clock_timestamp()), p_updated_by
  )
  on conflict (workspace_key) do update
    set payload = excluded.payload,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  update public.sd_legacy_write_controls
  set expected_revision = p_legacy_revision,
      payload_sha256 = v_actual_hash,
      restore_in_progress = false,
      updated_at = clock_timestamp()
  where workspace_key = p_workspace_key;

  return jsonb_build_object(
    'status', 'restored',
    'workspaceKey', p_workspace_key,
    'revision', p_legacy_revision,
    'payloadSha256', v_actual_hash
  );
end;
$$;

create or replace function public.reenable_ship_dynamics_legacy_writes(
  p_workspace_key text,
  p_expected_revision bigint,
  p_payload_sha256 text,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_revision bigint;
  v_hash text;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not-authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_key, 731921)
  );
  perform public.sd_assert_legacy_freeze_boundary(p_workspace_key);
  if p_confirmation is distinct from
     'reenable:' || p_workspace_key || ':' || p_expected_revision::text || ':' || p_payload_sha256 then
    raise exception using errcode = '22023', message = 'confirmation-mismatch';
  end if;
  select s.revision, public.sd_legacy_jsonb_sha256(s.payload)
  into v_revision, v_hash
  from public.ship_dynamics_app_state s
  where s.workspace_key = p_workspace_key
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-source-row-missing';
  end if;
  if v_revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'legacy-revision-mismatch';
  end if;
  if v_hash is distinct from p_payload_sha256 then
    raise exception using errcode = 'P0001', message = 'legacy-payload-hash-mismatch';
  end if;
  update public.sd_legacy_write_controls
  set writes_frozen = false,
      restore_in_progress = false,
      updated_at = clock_timestamp()
  where workspace_key = p_workspace_key
    and writes_frozen
    and expected_revision = p_expected_revision
    and payload_sha256 = p_payload_sha256;
  if not found then
    raise exception using errcode = 'P0001', message = 'legacy-freeze-state-mismatch';
  end if;
  return jsonb_build_object(
    'status', 'write-enabled',
    'workspaceKey', p_workspace_key,
    'revision', p_expected_revision,
    'payloadSha256', p_payload_sha256
  );
end;
$$;

revoke all on function public.sd_legacy_jsonb_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.sd_guard_legacy_app_state_write() from public, anon, authenticated, service_role;
revoke all on function public.sd_assert_legacy_freeze_boundary(text) from public, anon, authenticated, service_role;
revoke all on function public.freeze_ship_dynamics_legacy_writes(text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.export_ship_dynamics_legacy_backup(text, bigint, text) from public, anon, authenticated;
revoke all on function public.restore_ship_dynamics_legacy_backup(text, bigint, jsonb, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.reenable_ship_dynamics_legacy_writes(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.freeze_ship_dynamics_legacy_writes(text, bigint, text, text) to service_role;
grant execute on function public.export_ship_dynamics_legacy_backup(text, bigint, text) to service_role;
grant execute on function public.restore_ship_dynamics_legacy_backup(text, bigint, jsonb, text, timestamptz, text, text) to service_role;
grant execute on function public.reenable_ship_dynamics_legacy_writes(text, bigint, text, text) to service_role;

commit;
