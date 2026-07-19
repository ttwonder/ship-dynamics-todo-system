import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { reconcileMeetingTasks, meetingTaskDescription, meetingTaskNotificationEvents, resolveMeetingTaskItemIdForDeletion, shouldPreserveMeetingTaskDescriptions } = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const { buildTaskNotifications } = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const { canEditTemporaryMeetings, meetingAppliesToUser } = await server.ssrLoadModule('/src/meetingAccess.ts');
  const { departmentAfterRoleChange } = await server.ssrLoadModule('/src/personWorkflow.ts');
  const { scheduleInputValue } = await server.ssrLoadModule('/src/EditModals.tsx');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { taskShipTypeLabel, taskVesselLabel } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  assert.equal(resolveMeetingTaskItemIdForDeletion({sourceMeetingItemId:'stale-item-id'},{taskItems:[{id:'actual-item-id',description:'Follow up'}]}),'actual-item-id','單一會議事項可安全修復失效關聯 ID');
  assert.equal(resolveMeetingTaskItemIdForDeletion({sourceMeetingItemId:'stale-item-id'},{taskItems:[{id:'item-1',description:'A'},{id:'item-2',description:'B'}]}),null,'多事項失效關聯 ID 必須拒絕猜測');
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
  const activeCustomizedTasks = customizedTasks.filter(item => item.sourceMeetingId === 'legacy-custom');
  assert.equal(activeCustomizedTasks.length, 1, '旧逐船待办必须聚合为一笔活动事项');
  assert.equal(activeCustomizedTasks[0].description, '船一客製待辦', '使用者未修改会议内容时应保留 canonical 客制描述');
  assert.deepEqual(activeCustomizedTasks[0].vesselIds, ['v1', 'v2']);
  assert.ok(activeCustomizedTasks[0].priority === '高' && activeCustomizedTasks[0].expectedDate === '2026-07-31', '保留描述时仍需同步其他会议栏位');
  assert.equal(customizedTasks.find(item => item.id === 'custom-v2').sourceMeetingId, undefined, '其余旧逐船记录必须解除关联并封存');

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

  const multiTasks = [];
  const multiResult = reconcileMeetingTasks({
    ...common,
    tasks: multiTasks,
    meetingId: 'multi',
    vesselIds: ['v1', 'v2'],
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    followUps: [{ id: 'item-1', description: '待辦一' }, { id: 'item-2', description: '待辦二' }],
  });
  assert.equal(multiResult.created.length, 2, '兩個待辦事項套用兩艘船時只能建立兩筆關聯待辦');
  assert.equal(multiTasks.filter(item => item.sourceMeetingItemId === 'item-1').length, 1);
  assert.equal(multiTasks.filter(item => item.sourceMeetingItemId === 'item-2').length, 1);
  assert.deepEqual(multiTasks.find(item => item.sourceMeetingItemId === 'item-1').vesselIds, ['v1', 'v2'], '每筆會議待辦應保存合併船舶範圍');
  const scopeVessels = [{ id:'v1', name:'S1', shortName:'S1', fullName:'第一船', shipType:'油輪' }, { id:'v2', name:'S2', shortName:'S2', fullName:'第二船', shipType:'散裝船' }];
  const allScopeTask = { ...multiTasks[0], vesselScopeMode:'all' };
  assert.equal(taskVesselLabel(allScopeTask, scopeVessels), '全部船舶');
  assert.equal(taskShipTypeLabel(allScopeTask, scopeVessels), '全部');
  assert.equal(taskVesselLabel(multiTasks[0], scopeVessels), '第一船、第二船');
  assert.equal(taskShipTypeLabel({ ...multiTasks[0], vesselScopeMode:'types', vesselTypeScopes:['油輪','散裝船'] }, scopeVessels), '油輪、散裝船');
  const removedItemResult = reconcileMeetingTasks({
    ...common,
    tasks: multiTasks,
    meetingId: 'multi',
    vesselIds: ['v1', 'v2'],
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    followUps: [{ id: 'item-2', description: '待辦二更新' }],
  });
  assert.equal(multiTasks.filter(item => item.sourceMeetingId === 'multi' && item.sourceMeetingItemId === 'item-1').length, 0, '刪除待辦事項格時需解除該事項的單筆船舶範圍關聯');
  assert.equal(multiTasks.filter(item => item.sourceMeetingId === 'multi' && item.sourceMeetingItemId === 'item-2').length, 1, '其他待辦事項不得受刪除影響');
  assert.equal(removedItemResult.archivedIds.length, 1, '刪除一個跨多船事項只應產生一筆取消事件');

  const legacyV1 = task('legacy-v1', 'v1', 'migration-meeting');
  const legacyV2 = task('legacy-v2', 'v2', 'migration-meeting');
  legacyV1.sourceMeetingItemId = 'migration-item';
  legacyV2.sourceMeetingItemId = 'migration-item';
  legacyV1.ownerUserIds = ['u1'];
  legacyV2.ownerUserIds = ['u2'];
  legacyV1.statusLogs = [{ id:'log-1', at:'2026-07-17T01:00:00.000Z', by:'u1', text:'船一更新' }];
  legacyV2.statusLogs = [{ id:'log-2', at:'2026-07-18T01:00:00.000Z', by:'u2', text:'船二更新' }];
  legacyV2.updatedAt = '2026-07-18T01:00:00.000Z';
  const migrated = normalizeAppData({
    revision: 12,
    updatedAt: '2026-07-18T02:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:['航務部'], taskCategories:['臨會/專題'], taskCategorySchemaVersion:2, rolePermissions:{}, nonOwnerPasswordResetVersion:1 },
    users: [],
    vessels: [{ id:'v1', name:'船一', isActive:true }, { id:'v2', name:'船二', isActive:true }],
    tasks: [legacyV1, legacyV2],
    meetings: [{ id:'migration-meeting', subject:'迁移会议', vesselScopeMode:'all', vessels:['v1','v2'], vesselTypeScopes:[], taskItems:[{ id:'migration-item', description:'旧事项' }] }],
    agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.ok(migrated, '旧资料应可安全正規化');
  assert.equal(migrated.tasks.length, 2, '普通 normalize 不得删除旧逐船历史记录');
  assert.equal(migrated.settings.meetingTaskAggregationVersion, 0, '普通读取不得自动标记破坏性迁移完成');
  const explicitMigration = reconcileMeetingTasks({
    tasks: migrated.tasks, meetingId:'migration-meeting', vesselIds:['v1','v2'], vesselScopeMode:'all', vesselTypeScopes:[],
    followUps:[{ id:'migration-item', description:'旧事项' }], priority:'中', expectedDate:'2026-07-31', departments:['航務部'], ownerUserIds:['u1','u2'],
    initialStatus:'待执行', actorId:'admin', actorName:'管理员', at:'2026-07-19T00:00:00.000Z',
  });
  assert.equal(migrated.tasks.filter(item=>item.sourceMeetingId==='migration-meeting').length, 1, '显式 reconciliation 后只保留一笔关联事项');
  assert.equal(explicitMigration.archivedIds.length, 1, '重复旧记录必须封存而非删除');
  assert.equal(migrated.tasks.length, 2, '封存后总记录数不得减少');
  assert.ok(migrated.tasks.find(item=>explicitMigration.archivedIds.includes(item.id))?.isClosed, '重复记录必须可恢复地保留为已结案历史');
  const migratedNormalized = normalizeAppData(structuredClone(migrated));
  const migratedAgain = normalizeAppData(structuredClone(migratedNormalized));
  assert.deepEqual(migratedAgain.tasks, migratedNormalized.tasks, '普通资料正規化必须幂等且不得再次聚合');

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
  const editModalsSource = fs.readFileSync('src/EditModals.tsx', 'utf8');
  const managementSource = fs.readFileSync('src/Management.tsx', 'utf8');
  assert.ok(meetingsSource.includes('const selected = accessibleMeetings.find'), '目前選取會議必須從 accessibleMeetings 取值，避免切換身份後渲染不可見會議');
  const createPermissionResetIndex = meetingsSource.indexOf('if (creating && !editable)');
  const createReturnIndex = meetingsSource.indexOf('if (creating) return;');
  assert.ok(createPermissionResetIndex >= 0, '喪失編輯權限時不得渲染 create-mode 舊 draft');
  assert.ok(createReturnIndex === -1 || createPermissionResetIndex < createReturnIndex, 'creating 狀態略過重置前必須先處理權限喪失');
  assert.ok(meetingsSource.includes('if (!creating && !selected) return <section'), '不可見 selectedId 必須先回傳空狀態，不得渲染舊 draft');
  assert.ok(managementSource.includes("department !== '船舶帳戶'") && managementSource.includes("normalizedDepartment === '船舶帳戶'"), '非船舶角色保存路徑必須拒絕船舶帳戶部門');
  assert.ok(editModalsSource.includes('<DropdownMultiPicker') && editModalsSource.includes('label="涉及人員"') && editModalsSource.includes('aria-label="搜尋涉及人員"'), '新增要事涉及人員必须使用可搜尋的下拉多选');
  assert.ok(!editModalsSource.includes('<CheckboxMultiPicker label="涉及人員"'), '涉及人员不得恢复成全名单平铺');

  console.log('Meeting task reconciliation runtime contracts passed.');
} finally {
  await server.close();
}
