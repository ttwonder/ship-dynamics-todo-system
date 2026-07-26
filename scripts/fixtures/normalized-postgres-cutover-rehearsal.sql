\set ON_ERROR_STOP on

insert into public.ship_dynamics_app_state(
  workspace_key, revision, payload, updated_at, updated_by
) values (
  'runtime-cutover', 7, '{"b":1,"aa":2}'::jsonb,
  '2026-07-26T01:00:00Z'::timestamptz, 'runtime-fixture'
);

select
  payload::text as backup_payload,
  public.sd_legacy_jsonb_sha256(payload) as backup_hash
from public.ship_dynamics_app_state
where workspace_key = 'runtime-cutover'
\gset

set role service_role;
select public.freeze_ship_dynamics_legacy_writes(
  'runtime-cutover', 7, :'backup_hash',
  'freeze:runtime-cutover:7:' || :'backup_hash'
)::text as freeze_result
\gset
select (:'freeze_result'::jsonb ->> 'status' = 'frozen') as freeze_ok
\gset
\if :freeze_ok
\else
  \echo 'cutover-freeze-status-invalid'
  \quit 1
\endif

select public.export_ship_dynamics_legacy_backup(
  'runtime-cutover', 7, :'backup_hash'
)::text as backup_result
\gset
select (
  :'backup_result'::jsonb ->> 'revision' = '7'
  and :'backup_result'::jsonb ->> 'payloadSha256' = :'backup_hash'
  and :'backup_result'::jsonb ->> 'payloadText' = :'backup_payload'
) as backup_ok
\gset
\if :backup_ok
\else
  \echo 'cutover-backup-identity-invalid'
  \quit 1
\endif
reset role;

begin;
savepoint frozen_writer;
set role anon;
\set ON_ERROR_STOP off
update public.ship_dynamics_app_state
set revision = 8
where workspace_key = 'runtime-cutover';
\set frozen_write_state :SQLSTATE
\set ON_ERROR_STOP on
rollback to savepoint frozen_writer;
reset role;
commit;
select :'frozen_write_state' = '55000' as frozen_write_blocked
\gset
\if :frozen_write_blocked
\else
  \echo 'cutover-frozen-write-not-blocked state=' :frozen_write_state
  \quit 1
\endif

set role service_role;
select public.reenable_ship_dynamics_legacy_writes(
  'runtime-cutover', 7, :'backup_hash',
  'reenable:runtime-cutover:7:' || :'backup_hash'
)::text as first_reenable_result
\gset
reset role;

set role anon;
update public.ship_dynamics_app_state
set payload = '{"damaged":true}'::jsonb,
    revision = 8,
    updated_by = 'simulated-post-cutover-writer'
where workspace_key = 'runtime-cutover';
reset role;

select public.sd_legacy_jsonb_sha256(payload) as damaged_hash
from public.ship_dynamics_app_state
where workspace_key = 'runtime-cutover'
\gset

set role service_role;
select public.freeze_ship_dynamics_legacy_writes(
  'runtime-cutover', 8, :'damaged_hash',
  'freeze:runtime-cutover:8:' || :'damaged_hash'
)::text as damaged_freeze_result
\gset

select public.restore_ship_dynamics_legacy_backup(
  'runtime-cutover', 7, :'backup_payload'::jsonb, :'backup_hash',
  '2026-07-26T01:00:00Z'::timestamptz, 'runtime-fixture',
  'restore:runtime-cutover:7:' || :'backup_hash'
)::text as restore_result
\gset
select (:'restore_result'::jsonb ->> 'status' = 'restored') as restore_ok
\gset
\if :restore_ok
\else
  \echo 'cutover-restore-status-invalid'
  \quit 1
\endif

select public.reenable_ship_dynamics_legacy_writes(
  'runtime-cutover', 7, :'backup_hash',
  'reenable:runtime-cutover:7:' || :'backup_hash'
)::text as final_reenable_result
\gset
select (:'final_reenable_result'::jsonb ->> 'status' = 'write-enabled') as final_reenable_ok
\gset
\if :final_reenable_ok
\else
  \echo 'cutover-final-reenable-invalid'
  \quit 1
\endif
reset role;

set role anon;
update public.ship_dynamics_app_state
set updated_by = 'post-rollback-writer'
where workspace_key = 'runtime-cutover';
reset role;

select (
  revision = 7
  and payload::text = :'backup_payload'
  and public.sd_legacy_jsonb_sha256(payload) = :'backup_hash'
  and updated_by = 'post-rollback-writer'
) as restored_identity_ok
from public.ship_dynamics_app_state
where workspace_key = 'runtime-cutover'
\gset
\if :restored_identity_ok
\else
  \echo 'cutover-restored-identity-invalid'
  \quit 1
\endif

select 'postgres_cutover_rehearsal=PASS freeze=true frozen_write_blocked=true backup_identity=true restore=true reenable=true';
