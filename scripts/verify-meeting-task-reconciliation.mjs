import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { reconcileMeetingTasks, meetingTaskDescription, meetingTaskNotificationEvents, shouldPreserveMeetingTaskDescriptions } = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const { buildTaskNotifications } = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const { canEditTemporaryMeetings, meetingAppliesToUser } = await server.ssrLoadModule('/src/meetingAccess.ts');
  const { departmentAfterRoleChange } = await server.ssrLoadModule('/src/personWorkflow.ts');
  const { scheduleInputValue } = await server.ssrLoadModule('/src/EditModals.tsx');
  const task = (id, vesselId, meetingId, closed = false) => ({
    id,
    vesselId,
    sourceMeetingId: meetingId,
    sourceType: 'temporary',
    priority: '中',
    isAware: true,
    isAbnormal: false,
    isInternalControl: false,
    category: '臨會/專題',
    description: '舊待辦',
    status: closed ? '已完成' : '待執行',
    expectedDate: '2026-07-20',
    departments: ['航務部'],
    ownerUserIds: [],
    isClosed: closed,
    createdBy: 'owner',
    updatedBy: 'owner',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    statusLogs: [],
  });
  const tasks = [
    task('canonical', 'v1', 'm1'),
    task('duplicate', 'v1', 'm1', true),
    task('removed-scope', 'v2', 'm1'),
    task('unrelated', 'v3', 'm2'),
  ];
  const common = {
    tasks,
    meetingId: 'm1',
    priority: '高',
    expectedDate: '2026-07-31',
    departments: ['工務部'],
    initialStatus: '待執行',
    actorId: 'owner',
    actorName: 'Owner',
    at: '2026-07-18T03:00:00.000Z',
  };

  const first = reconcileMeetingTasks({ ...common, vesselIds: ['v1'], followUp: '新待辦內容' });
  const activeLinked = tasks.filter(item => item.sourceMeetingId === 'm1');
  assert.equal(activeLinked.length, 1, '每個目前船舶只能保留一筆會議待辦');
  assert.equal(activeLinked[0].id, 'canonical');
  assert.equal(activeLinked[0].description, '新待辦內容');
  assert.equal(activeLinked[0].priority, '高');
  assert.equal(tasks.find(item => item.id === 'duplicate').isClosed, true, '舊重複項必須封存');
  assert.equal(tasks.find(item => item.id === 'duplicate').status, '已完成', '已結案的歷史狀態不得被對帳覆蓋');
  assert.equal(tasks.find(item => item.id === 'duplicate').sourceMeetingId, undefined, '舊重複項必須解除會議關聯');
  assert.equal(tasks.find(item => item.id === 'removed-scope').isClosed, true, '移出範圍的待辦必須封存');
  assert.equal(tasks.find(item => item.id === 'removed-scope').sourceMeetingId, undefined, '移出範圍的待辦必須解除會議關聯');
  assert.equal(tasks.find(item => item.id === 'unrelated').sourceMeetingId, 'm2', '不得修改其他會議待辦');
  assert.deepEqual(first.updatedIds, ['canonical']);

  const customizedTasks = [task('custom-v1', 'v1', 'legacy-custom'), task('custom-v2', 'v2', 'legacy-custom')];
  customizedTasks[0].description = '船一客製待辦';
  customizedTasks[1].description = '船二客製待辦';
  assert.equal(
    shouldPreserveMeetingTaskDescriptions({ id: 'legacy-custom' }, customizedTasks, '船一客製待辦'),
    true,
    '旧会议待办栏未编辑时必须自动保留逐船客制内容',
  );
  assert.equal(
    shouldPreserveMeetingTaskDescriptions({ id: 'legacy-custom' }, customizedTasks, '用户明确的新统一内容'),
    false,
    '用户明确修改会议待办栏时必须允许统一同步',
  );
  reconcileMeetingTasks({
    ...common,
    tasks: customizedTasks,
    meetingId: 'legacy-custom',
    vesselIds: ['v1', 'v2'],
    followUp: '船一客製待辦',
    preserveExistingDescriptions: true,
  });
  assert.deepEqual(customizedTasks.map(item => item.description), ['船一客製待辦', '船二客製待辦'], '保存舊會議其他欄位時不得覆蓋逐船客製待辦內容');
  assert.ok(customizedTasks.every(item => item.priority === '高' && item.expectedDate === '2026-07-31'), '保留描述時仍需同步其他會議欄位');

  const eventTasks = [task('event-created', 'v1', 'events'), task('event-updated', 'v2', 'events'), task('event-archived', 'v3', 'events')];
  const events = meetingTaskNotificationEvents(eventTasks, {
    created: [eventTasks[0]],
    updatedIds: ['event-updated'],
    archivedIds: ['event-archived'],
  });
  assert.deepEqual(events.map(event => [event.task.id, event.kind]), [
    ['event-created', 'task_created'],
    ['event-updated', 'task_updated'],
    ['event-archived', 'task_archived'],
  ], '会议 reconcile 的新增、更新、取消必须全部产生通知事件');
  const archivedNotices = buildTaskNotifications(
    [{ id:'supervisor', role:'operator', department:'督導', managedVesselIds:['v3'], isActive:true }],
    { id:'v3', assignedUserIds:[] },
    'owner',
    eventTasks[2],
    'task_archived',
    'Owner',
  );
  assert.equal(archivedNotices.length, 1);
  assert.ok(archivedNotices[0].title.includes('取消待辦'), '自動封存需明确显示取消待辦通知');

  const alreadyClosedDuplicateTasks = [task('active-canonical', 'v1', 'closed-duplicate'), task('already-closed', 'v1', 'closed-duplicate')];
  alreadyClosedDuplicateTasks[1].isClosed = true;
  alreadyClosedDuplicateTasks[1].status = '已完成';
  const closedDuplicateResult = reconcileMeetingTasks({
    ...common,
    tasks: alreadyClosedDuplicateTasks,
    meetingId: 'closed-duplicate',
    vesselIds: ['v1'],
    followUp: '跟進事項',
  });
  assert.equal(alreadyClosedDuplicateTasks[1].sourceMeetingId, undefined, '已結案重複項仍需解除会议关联');
  assert.equal(alreadyClosedDuplicateTasks[1].status, '已完成', '解除已結案重複項关联不得改写结案状态');
  assert.equal(closedDuplicateResult.archivedIds.includes('already-closed'), false, '原本已結案項目不得被列为本次取消');
  assert.equal(
    meetingTaskNotificationEvents(alreadyClosedDuplicateTasks, closedDuplicateResult).some(event => event.task.id === 'already-closed'),
    false,
    '原本已結案項目单纯解除关联时不得发送取消通知',
  );

  reconcileMeetingTasks({ ...common, vesselIds: ['v1'], followUp: '' });
  assert.equal(tasks.filter(item => item.sourceMeetingId === 'm1').length, 0, '清空待辦欄後不得保留活動關聯待辦');
  assert.equal(tasks.find(item => item.id === 'canonical').isClosed, true, '清空待辦欄需封存舊待辦');

  const restored = reconcileMeetingTasks({ ...common, vesselIds: ['v1'], followUp: '重新建立' });
  assert.equal(restored.created.length, 1, '重新填寫待辦時需建立一筆新關聯待辦');
  assert.equal(tasks.filter(item => item.sourceMeetingId === 'm1' && item.vesselId === 'v1').length, 1);

  assert.equal(departmentAfterRoleChange('船舶帳戶', 'operator', ['航務部', '工務部']), '航務部');
  assert.equal(departmentAfterRoleChange('工務部', 'admin', ['航務部', '工務部']), '工務部');
  assert.equal(departmentAfterRoleChange('航務部', 'vessel', ['航務部']), '船舶帳戶');
  assert.equal(departmentAfterRoleChange('船舶帳戶', 'operator', ['船舶帳戶', '航務部']), '航務部', '人員角色不得保留船舶帳戶部門');
  assert.equal(departmentAfterRoleChange('船舶帳戶', 'admin', ['船舶帳戶']), '', '沒有有效人員部門時不可回填船舶帳戶');

  const rolePermissions = {
    owner: { viewAllVessels: true, manageMeetings: true },
    admin: { viewAllVessels: true, manageMeetings: true },
    operator: { viewAllVessels: false, manageMeetings: true },
    vessel: { viewAllVessels: false, manageMeetings: false },
  };
  const scopedEditor = { id: 'u1', role: 'operator' };
  const fullEditor = { id: 'admin', role: 'admin' };
  const visibleVessels = [{ id: 'v1', shipType: '油輪' }];
  assert.equal(canEditTemporaryMeetings(rolePermissions, scopedEditor), false, '有 manageMeetings 但無 viewAllVessels 不得全域編輯會議');
  assert.equal(canEditTemporaryMeetings(rolePermissions, fullEditor), true, '具備 viewAllVessels 的會議管理者才可編輯');
  assert.equal(meetingAppliesToUser({ vesselScopeMode: 'vessels', vessels: ['v2'], vesselTypeScopes: [] }, visibleVessels, false), false, '不可見船舶的會議不得對 scoped 使用者曝光');
  assert.equal(meetingAppliesToUser({ vesselScopeMode: 'vessels', vessels: ['v2'], vesselTypeScopes: [] }, visibleVessels, true), true, '全域編輯者可看到全部會議');

  const legacyMeeting = { id: 'legacy', taskDescription: undefined };
  delete legacyMeeting.taskDescription;
  const legacyTasks = [task('legacy-task', 'v1', 'legacy')];
  legacyTasks[0].description = '既有 legacy 會議待辦';
  assert.equal(meetingTaskDescription(legacyMeeting, legacyTasks), '既有 legacy 會議待辦', 'legacy 會議缺 taskDescription 時需從既有关聯待辦回填');
  assert.equal(meetingTaskDescription({ id: 'explicit-clear', taskDescription: '' }, [task('clear-task', 'v1', 'explicit-clear')]), '', '已存在的空 taskDescription 表示使用者明確清空');

  assert.equal(scheduleInputValue('2026-07-17'), '2026-07-17T00:00', 'date-only ETA/ETB/ETD 應在 datetime-local 中顯示為當日 00:00');
  assert.equal(scheduleInputValue('2026-07-17 13:45:00'), '2026-07-17T13:45');
  assert.equal(scheduleInputValue('TBA'), '');

  const meetingsSource = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
  const managementSource = fs.readFileSync('src/Management.tsx', 'utf8');
  assert.ok(meetingsSource.includes('const selected = accessibleMeetings.find'), '目前選取會議必須從 accessibleMeetings 取值，避免切換身份後渲染不可見會議');
  const createPermissionResetIndex = meetingsSource.indexOf('if (creating && !editable)');
  const createReturnIndex = meetingsSource.indexOf('if (creating) return;');
  assert.ok(createPermissionResetIndex >= 0, '喪失編輯權限時不得渲染 create-mode 舊 draft');
  assert.ok(createReturnIndex === -1 || createPermissionResetIndex < createReturnIndex, 'creating 狀態略過重置前必須先處理權限喪失');
  assert.ok(meetingsSource.includes('if (!creating && !selected) return <section'), '不可見 selectedId 必須先回傳空狀態，不得渲染舊 draft');
  assert.ok(managementSource.includes("department !== '船舶帳戶'") && managementSource.includes("normalizedDepartment === '船舶帳戶'"), '非船舶角色保存路徑必須拒絕船舶帳戶部門');

  console.log('Meeting task reconciliation runtime contracts passed.');
} finally {
  await server.close();
}
