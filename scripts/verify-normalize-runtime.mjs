import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
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
    users: [null, { id: 'u1', name: '測試', username: 'qa', role: 'owner', passwordHash: 'hash', isActive: true, managedVesselIds: ['v1', { unsafe: true }] }],
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
  assert.deepEqual(data.users[0].managedVesselIds, ['v1']);
  assert.deepEqual(data.vessels[0].fleetTags, ['A']);
  assert.equal(data.vessels[0].position.navigationStatus, '停泊');
  assert.equal(data.vessels[0].position.etb, '2026-07-18 08:00');
  assert.deepEqual(data.vessels[0].cargo.items, [{ name: '原油', quantity: '5,000 MT' }]);
  assert.deepEqual(data.vessels[0].weeklyAttention, ['psc-window']);
  assert.deepEqual(data.tasks[0].departments, ['航務']);
  assert.equal(data.tasks[0].priority, '急');
  assert.equal(data.tasks[0].isAbnormal, true);
  assert.equal(data.tasks[0].statusLogs.length, 1);
  assert.equal(data.meetings[0].subject, '');
  assert.equal(data.meetings[0].taskDescription, '舊版已生成待辦', '舊會議需由既有关聯待辦回填獨立待辦欄');
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

  assert.equal(normalizeAppData({ settings: {}, users: [], vessels: [] }), null, 'missing core task collection must be rejected');
  console.log('Runtime payload normalization regression passed.');
} finally {
  await server.close();
}
