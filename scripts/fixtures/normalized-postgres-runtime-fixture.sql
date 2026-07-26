\set ON_ERROR_STOP on

begin;

insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@runtime.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'operator@runtime.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'vessel@runtime.invalid');

insert into public.sd_workspaces(id, legacy_key, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'runtime-gate', 'True PostgreSQL Runtime Gate');

insert into public.sd_profiles(id, display_name, username_label) values
  ('11111111-1111-4111-8111-111111111111', 'Owner', 'owner'),
  ('22222222-2222-4222-8222-222222222222', 'Operator', 'operator'),
  ('33333333-3333-4333-8333-333333333333', 'Vessel Account', 'vessel');

insert into public.sd_memberships(workspace_id, user_id, department, role, is_active) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '管理', 'owner', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', '業務', 'operator', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', '船舶', 'vessel', true);

insert into public.sd_vessels(
  workspace_id, id, name, short_name, full_name, ship_type, fleet_category, created_by, updated_by
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'vessel-a', '船舶 A', 'A', 'Vessel A', 'Bulk', 'Fleet', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'vessel-b', '船舶 B', 'B', 'Vessel B', 'Bulk', 'Fleet', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

insert into public.sd_vessel_assignments(
  workspace_id, vessel_id, user_id, assignment_kind, is_active, updated_by
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'vessel-a', '33333333-3333-4333-8333-333333333333', 'vessel_account', true, '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'vessel-a', '22222222-2222-4222-8222-222222222222', 'manager', true, '11111111-1111-4111-8111-111111111111');

insert into public.sd_meetings(
  workspace_id, id, scope_mode, subject, status, meeting_date, reason, priority,
  is_internal_control, created_by, updated_by
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-valid', 'vessels', '有效單船會議', '追蹤中', '2026-07-26', '驗證', '中', false, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-inactive', 'vessels', '停用項目會議', '追蹤中', '2026-07-26', '驗證', '中', false, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-cross', 'vessels', '跨船會議', '追蹤中', '2026-07-26', '驗證', '中', false, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

insert into public.sd_meeting_vessels(workspace_id, meeting_id, vessel_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-valid', 'vessel-a'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-inactive', 'vessel-a'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-cross', 'vessel-a'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-cross', 'vessel-b');

insert into public.sd_meeting_items(
  workspace_id, id, meeting_id, description, distribute_to_vessels, ordinal,
  is_active, created_by, updated_by
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'item-valid', 'meeting-valid', '有效分派項目', true, 1, true, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'item-inactive', 'meeting-inactive', '停用項目', true, 1, false, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'item-cross', 'meeting-cross', '跨船項目', true, 1, true, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'item-mismatch', 'meeting-cross', '不匹配來源項目', true, 2, true, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'item-orphan', 'meeting-valid', '孤立項目', true, 2, true, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

insert into public.sd_tasks(
  workspace_id, id, description, status, priority, source_kind,
  source_meeting_id, source_meeting_item_id, source_type, vessel_scope_mode,
  distribute_to_vessels, is_internal_control, internal_control_cancelled_at,
  internal_control_cancelled_by, created_by, updated_by
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ordinary-a', '一般單船事項', 'Open', '中', 'ordinary', null, null, 'morning', 'vessels', false, false, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'internal-a', '內部管控事項', 'Open', '中', 'ordinary', null, null, 'morning', 'vessels', false, true, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cancelled-a', '保留內控證據', 'Open', '中', 'ordinary', null, null, 'morning', 'vessels', false, false, clock_timestamp(), '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-valid-task', '有效分派會議事項', 'Open', '中', 'meeting', 'meeting-valid', 'item-valid', 'temporary', 'vessels', true, false, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-inactive-task', '停用來源事項', 'Open', '中', 'meeting', 'meeting-inactive', 'item-inactive', 'temporary', 'vessels', true, false, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-cross-task', '跨船來源事項', 'Open', '中', 'meeting', 'meeting-cross', 'item-cross', 'temporary', 'vessels', true, false, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-orphan-task', '孤立來源事項', 'Open', '中', 'meeting', 'missing-meeting', 'item-orphan', 'temporary', 'vessels', true, false, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-mismatched-task', '不匹配來源事項', 'Open', '中', 'meeting', 'meeting-valid', 'item-mismatch', 'temporary', 'vessels', true, false, null, null, '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

insert into public.sd_task_vessels(
  workspace_id, task_id, vessel_id, is_active_scope, status, is_closed, updated_by
)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'vessel-a', true, status, false,
       '11111111-1111-4111-8111-111111111111'
from public.sd_tasks
where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into public.sd_task_vessels(
  workspace_id, task_id, vessel_id, is_active_scope, status, is_closed, updated_by
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meeting-cross-task', 'vessel-b', true,
  'Open', false, '11111111-1111-4111-8111-111111111111'
);

insert into public.sd_internal_cases(
  workspace_id, id, vessel_id, report_date, report_source, description, priority,
  category, is_aware, status, origin, created_by, updated_by
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'case-a', 'vessel-a', '2026-07-26',
  '日常', '保留的內部案件證據', '中', 'Safety', false, 'Open', 'internal-control',
  '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'
);

commit;

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $vessel_confidentiality$
declare
  v_ids text[];
  v_hidden text[] := array[
    'cancelled-a', 'internal-a', 'meeting-cross-task', 'meeting-inactive-task',
    'meeting-mismatched-task', 'meeting-orphan-task'
  ];
begin
  select array_agg(id order by id) into v_ids from public.sd_tasks;
  if v_ids is distinct from array['meeting-valid-task', 'ordinary-a']::text[] then
    raise exception 'vessel-visible-task-set-invalid:%', coalesce(v_ids::text, '<null>');
  end if;
  if (select count(*) from public.sd_tasks) <> 2 then
    raise exception 'vessel-task-count-signal';
  end if;
  if (select count(*) from public.sd_tasks where id = any(v_hidden)) <> 0 then
    raise exception 'vessel-hidden-task-exact-signal';
  end if;
  if (select count(*) from public.sd_task_vessels where task_id = any(v_hidden)) <> 0 then
    raise exception 'vessel-hidden-task-child-signal';
  end if;
  if (select count(*) from public.sd_internal_cases) <> 0
     or (select count(*) from public.sd_internal_cases where id = 'case-a') <> 0 then
    raise exception 'vessel-internal-case-signal';
  end if;
  if (select count(*) from public.sd_meetings) <> 0
     or (select count(*) from public.sd_meeting_items) <> 0
     or (select count(*) from public.sd_meeting_vessels) <> 0 then
    raise exception 'vessel-meeting-parent-child-signal';
  end if;
end
$vessel_confidentiality$;

reset role;
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

do $owner_evidence$
begin
  if (select count(*) from public.sd_tasks) <> 8 then
    raise exception 'owner-task-evidence-missing';
  end if;
  if (select count(*) from public.sd_internal_cases where id = 'case-a') <> 1 then
    raise exception 'owner-internal-evidence-missing';
  end if;
  if (select count(*) from public.sd_tasks where id in ('cancelled-a', 'internal-a')) <> 2 then
    raise exception 'owner-retained-task-evidence-missing';
  end if;
end
$owner_evidence$;

reset role;
reset request.jwt.claim.sub;

select 'confidentiality_fixture=PASS vessel_visible=2 vessel_hidden=6 owner_visible=8';
