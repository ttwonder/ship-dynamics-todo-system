import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const validPasswordHash = 'a'.repeat(64);
  const malformed = {
    revision: 7,
    updatedAt: '2026-07-17T00:00:00.000Z',
    settings: {
      sitePasswordHash: 'hash',
      systemTitle: 'QA',
      departments: ['航務', null, { unsafe: true }],
      taskCategories: ['人員', 123],
      vesselStatuses: ['裝載', { unsafe: true }],
      priorities: ['高', null],
      lastCloudSyncAt: '',
    },
    users: [null, { id: 'u1', name: '測試', username: 'qa', role: 'owner', passwordHash: validPasswordHash, isActive: true, managedVesselIds: ['v1', { unsafe: true }] }],
    vessels: [null, { id: 'v1', name: '船一', fleetTags: ['A', { unsafe: true }], assignedUserIds: ['u1', null], weeklyAttention: ['psc-window', 'unsafe'], position: { navigationStatus: '停泊', etb: '2026-07-18 08:00' }, cargo: { name: '原油', quantity: '5,000 MT' }, note: { statusList: ['裝載', { unsafe: true }] } }],
    tasks: [null, { id: 't1', vesselId: 'v1', sourceMeetingId: 'm1', description: '舊版已生成待辦', priority: '急', isAbnormal: true, departments: ['航務', { unsafe: true }], ownerUserIds: ['u1', null], statusLogs: [null, { id: 'l1', text: '正常', at: '2026-07-17', by: 'QA' }, { id: 'l2', text: { unsafe: true } }] }],
    meetings: [null, { id: 'm1', subject: { unsafe: true }, vessels: ['v1', { unsafe: true }], departments: [{ unsafe: true }] }],
    agendaReports: [null, { id: 'r1', title: { unsafe: true }, vesselIds: ['v1', { unsafe: true }], taskCount: 'bad' }],
    auditLogs: [null, { id: 'a1', actorName: { unsafe: true }, detail: { unsafe: true }, actorRole: 'invalid' }],
    notifications: [{ id: 'n1', userId: 'u1', vesselId: 'v1', taskId: 't1', kind: 'task_archived', title: '取消待辦', message: '已取消', actorId: 'owner', createdAt: '2026-07-18' }],
  };

  const data = normalizeAppData(malformed);
  assert.ok(data, 'malformed-but-migratable payload should normalize');
  assert.equal(data.users.length, 1);
  assert.equal(data.vessels.length, 1);
  assert.equal(data.tasks.length, 1);
  assert.deepEqual(data.settings.departments, ['航務']);
  assert.deepEqual(data.settings.priorities, ['急', '高', '中', '低']);
  assert.deepEqual(data.settings.vesselStatuses, ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar']);
  assert.deepEqual(data.vessels[0].note.statusList, ['loading']);
  assert.deepEqual(data.users[0].managedVesselIds, [], 'Owner／管理員不分管具體船舶');
  assert.deepEqual(data.vessels[0].assignedUserIds, [], '船舶分管名單不得保留管理層帳號');
  assert.equal(data.users[0].passwordHash, validPasswordHash, '通用 normalize 不得覆蓋有效 Owner 密碼');
  assert.equal(data.settings.nonOwnerPasswordResetVersion, 2, 'normalize 應標記本次操作員密碼清除遷移已完成');
  const invalidCredential=normalizeAppData({...malformed,users:[{...malformed.users[1],id:'bad-hash',passwordHash:{bad:true},isActive:true}]});
  assert.equal(invalidCredential.users[0].isActive,false,'異常密碼 hash 必須 fail-closed 停用帳戶');
  assert.equal(invalidCredential.users[0].passwordHash,'0'.repeat(64),'異常密碼 hash 必須轉成不可匹配的 fail-closed 哨兵');
  const explicitNoPassword=normalizeAppData({...malformed,users:[{...malformed.users[1],id:'no-password',passwordHash:'',isActive:true}]});
  assert.equal(explicitNoPassword.users[0].isActive,true,'只有明確空字串可保留無密碼帳戶語義');
  assert.deepEqual(data.vessels[0].fleetTags, ['A']);
  assert.equal(data.vessels[0].position.navigationStatus, '停泊');
  assert.equal(data.vessels[0].position.etb, '2026-07-18 08:00');
  assert.deepEqual(data.vessels[0].cargo.items, [{ name: '原油', quantity: '5,000 MT' }]);
  const adminAssignments = normalizeAppData({
    ...malformed,
    users: [
      { ...malformed.users[1], id:'owner', role:'owner', managedVesselIds:['v1'] },
      { id:'admin', name:'管理員甲', username:'admin', role:'admin', passwordHash:validPasswordHash, isActive:true, managedVesselIds:['v1'] },
      { id:'operator', name:'操作員乙', username:'operator', role:'operator', passwordHash:validPasswordHash, isActive:true, managedVesselIds:[] },
      { id:'ship-user', name:'船舶帳戶', username:'ship', role:'vessel', passwordHash:validPasswordHash, isActive:true, managedVesselIds:['v1'] },
    ],
    vessels: [{ ...malformed.vessels[1], assignedUserIds:['owner','admin','operator','ship-user'] }],
  });
  assert.deepEqual(adminAssignments.users.find(user=>user.id==='owner').managedVesselIds, [], 'Owner 不分管具體船舶');
  assert.deepEqual(adminAssignments.users.find(user=>user.id==='admin').managedVesselIds, ['v1'], '管理員可保留船舶經管關係');
  assert.ok(adminAssignments.vessels[0].assignedUserIds.includes('admin'), '船舶經管名單必須保留管理員');
  assert.ok(adminAssignments.vessels[0].assignedUserIds.includes('operator'), '船舶經管名單必須保留操作員');
  assert.ok(!adminAssignments.vessels[0].assignedUserIds.includes('owner'), '船舶經管名單不得保留 Owner');
  assert.ok(!adminAssignments.vessels[0].assignedUserIds.includes('ship-user'), '船舶經管名單不得保留船舶帳戶');
  assert.deepEqual(data.vessels[0].weeklyAttention, ['psc-window']);
  assert.deepEqual(data.tasks[0].departments, ['航務']);
  assert.equal(data.tasks[0].priority, '急');
  assert.equal(data.tasks[0].isAbnormal, true);
  assert.equal(data.tasks[0].statusLogs.length, 1);
  assert.equal(data.meetings[0].subject, '');
  assert.equal(data.meetings[0].taskDescription, '舊版已生成待辦', '舊會議需由既有关聯待辦回填獨立待辦欄');
  assert.deepEqual(data.meetings[0].taskItems.map(item => item.description), ['舊版已生成待辦'], '舊會議單一待辦需迁移為待辦事項 1');
  assert.equal(data.tasks[0].sourceMeetingItemId, data.meetings[0].taskItems[0].id, '舊关联待办需补上稳定会议事项 ID');
  const explicitCleared = normalizeAppData({
    ...malformed,
    tasks: [{ id: 't-clear', vesselId: 'v1', sourceMeetingId: 'm-clear', description: '不應回填的舊待辦' }],
    meetings: [{ id: 'm-clear', subject: '明確清空', taskDescription: '', vessels: ['v1'], departments: [] }],
  });
  assert.equal(explicitCleared.meetings[0].taskDescription, '', '明確存在的空 taskDescription 不得被舊關聯待辦回填');
  assert.deepEqual(data.meetings[0].vessels, ['v1']);
  assert.equal(data.agendaReports[0].title, '');
  assert.equal(data.auditLogs[0].actorRole, 'system');
  assert.equal(data.notifications[0].kind, 'task_archived', '会议取消待办通知经 normalize 后不得降级为一般更新');
  assert.doesNotThrow(() => JSON.stringify(data));

  const duplicateHistoryPayload = {
    ...malformed,
    settings: { ...malformed.settings, meetingTaskAggregationVersion: 0 },
    meetings: [{ id: 'm-history', subject: '歷史會議', vessels: ['v1'], taskItems: [{ id: 'follow-1', description: '統一跟進' }] }],
    tasks: [
      { id: 'history-open', vesselId: 'v1', sourceMeetingId: 'm-history', sourceMeetingItemId: 'follow-1', description: '船一原始內容', status: '待執行', createdAt: '2026-07-01', updatedAt: '2026-07-02' },
      { id: 'history-closed', vesselId: 'v1', sourceMeetingId: 'm-history', sourceMeetingItemId: 'follow-1', description: '已結案原始內容', status: '已完成', isClosed: true, closedDate: '2026-07-03', closedBy: 'u1', createdAt: '2026-07-01', updatedAt: '2026-07-03' },
    ],
  };
  const preservedHistory = normalizeAppData(duplicateHistoryPayload);
  assert.equal(preservedHistory.tasks.length, 2, '普通 normalize 不得删除重复历史任务');
  assert.deepEqual(preservedHistory.tasks.map(task => task.id), ['history-open', 'history-closed'], '任务 ID 与顺序必须保留');
  assert.equal(preservedHistory.tasks[1].description, '已結案原始內容', '非 canonical 描述不得丢失');
  assert.equal(preservedHistory.tasks[1].closedDate, '2026-07-03', '结案资料不得丢失');
  assert.equal(preservedHistory.settings.meetingTaskAggregationVersion, 0, '普通 normalize 不得假报已执行显式迁移');

  const legacyMulti=normalizeAppData({
    ...malformed,
    tasks:[{id:'legacy-multi',vesselId:'v1',vesselIds:['v1','v2'],sourceMeetingId:'m-multi',description:'旧多船',status:'已完成',isClosed:true,closedDate:'2026-07-02',closedBy:'u1',updatedAt:'2026-07-02',updatedBy:'u1',statusLogs:[]}],
    meetings:[{id:'m-multi',subject:'旧多船会议',vessels:['v1','v2'],taskItems:[{id:'follow',description:'旧多船'}]}],
  });
  assert.equal(legacyMulti.tasks[0].vesselProgress.length,2,'缺少 vesselProgress 字段的旧多船会议待办必须迁移所有船舶');
  assert.ok(legacyMulti.tasks[0].vesselProgress.every(progress=>progress.isClosed&&progress.status==='已完成'),'旧顶层结案与状态必须复制到各船，避免升级后重新显示未结');
  const explicitIndependent=normalizeAppData({...malformed,tasks:[{...legacyMulti.tasks[0],id:'new-multi',vesselProgress:[]}]});
  assert.deepEqual(explicitIndependent.tasks[0].vesselProgress,[],'显式空 vesselProgress 是新独立模型，不得继承总体状态');

  assert.equal(normalizeAppData({ settings: {}, users: [], vessels: [] }), null, 'missing core task collection must be rejected');
  console.log('Runtime payload normalization regression passed.');
} finally {
  await server.close();
}
