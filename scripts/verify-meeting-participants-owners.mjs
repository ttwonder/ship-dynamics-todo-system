import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const types = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/TemporaryMeetings.tsx', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../src/meetingTaskWorkflow.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

assert.match(types, /TemporaryMeetingStatus = '待召開' \| '追蹤中' \| '已完成'/, '会议状态只可保留三种');
assert.match(types, /participantUserIds: string\[\]/, '会议需保存與會人員');
assert.match(types, /trackingUserIds: string\[\]/, '会议需保存追蹤窗口');
assert.match(types, /responsibleUserIds: string\[\]/, '会议需保存负责人');
assert.match(page, /const statuses:[^=]+ = \['待召開', '追蹤中', '已完成'\]/, '表单与筛选只显示三状态');
assert.ok(!page.includes("'待開會', '進行中'"), 'UI 不得继续显示旧状态');
assert.match(page, /MeetingPeoplePicker/, '與會人員、追蹤窗口與负责人应使用专用下拉多选');
assert.match(page, /label="與會人員"[^>]+required/, '與會人員需标记必填');
assert.match(page, /label="追蹤窗口"[^>]+required/, '追蹤窗口需标记必填');
assert.match(page, /同與會人員/, '追蹤窗口需提供同與會人員快捷按鈕');
assert.match(page, /label="追蹤窗口" required users=\{meetingPeople\}/, '追蹤窗口需可手動選擇 active 非船舶帳戶，不得因空涉船範圍無人可選');
assert.match(page, /trackingUserIds: \[\.\.\.previous\.participantUserIds\]/, '同與會人員需複製與會人員到追蹤窗口');
assert.match(page, /label="負責人"/, '负责人需提供下拉多选');
assert.match(page, /請至少選擇一位與會人員/, '保存时需拒绝空與會人員');
assert.match(page, /請至少選擇一位追蹤窗口/, '保存时需拒绝空追蹤窗口');
assert.match(page, /請至少選擇一個涉及部門/, '保存时需拒绝空涉及部门');
assert.match(page, /請填寫會議決議/, '保存时需拒绝空会议决议');
assert.match(page, /請選擇召開日期/, '保存时需拒绝空召开日期');
assert.match(page, /請選擇預計完成日期/, '保存时需拒绝空预计完成日期');
assert.ok(!page.includes("if (!draft.reason.trim()) return alert('請填寫召開緣由')"), '召开缘由不再是必填');
assert.match(page, /ownerUserIds:effectiveDraft\.trackingUserIds/, '追蹤窗口需同步到会议待办');
assert.match(page, /flushSync\(\(\)=>setData\(prev=>[\s\S]*liveMeeting=prev\.meetings\.find/, '会议保存需在最新 state 重验目标与权限');
assert.match(page, /!wasCreating&&\(!liveMeeting[\s\S]*未保存任何變更/, '已删除会议不得被更新流程复活');
assert.match(page,/liveMeeting!\.updatedAt!==baseMeetingUpdatedAt/,'会议保存必须执行版本冲突检测');
assert.match(page,/prev\.revision!==baseRevision/,'会议 CAS 必须同时使用无同毫秒碰撞的全局 revision');
assert.match(page,/visibleVesselKey[\s\S]*\[selectedId, creating, editable, canViewAllMeetings, visibleVesselKey/,'会议编辑同步 effect 必须依赖稳定的船舶 ID 签名');
assert.doesNotMatch(page,/\[selectedId, creating[^\]]*visibleVessels/,'会议编辑同步 effect 不得依赖每次资料更新都会重建的船舶数组引用');
assert.match(app, /liveTask\.sourceMeetingId[\s\S]*meeting\.taskItems=meeting\.taskItems\.filter/, '明确删除会议关联待办时需同步移除会议事项，防止复活');
assert.ok((app.match(/resolveMeetingTaskItemIdForDeletion\(/g)||[]).length>=2,'单笔与批量删除都必须执行会议事项关联消歧');
assert.match(page, /<h2>與會人員<\/h2>/, '会议 PDF 需显示與會人員');
assert.match(page, /<h2>追蹤窗口<\/h2>/, '会议 PDF 需显示追蹤窗口');
assert.match(page, /<h2>負責人<\/h2>/, '会议 PDF 需显示负责人');
assert.match(page, /<th>追蹤窗口／負責人<\/th>/, '臨會總清單只需顯示追蹤窗口與負責人欄');
assert.doesNotMatch(page, /<th>與會人員／追蹤窗口／負責人<\/th>/, '臨會總清單不得列上與會人員');
assert.doesNotMatch(page, /<b>與會：\{peopleNames\(meeting\.participantUserIds\)\}<\/b>/, '臨會總清單內容不得列上與會人員');
assert.match(workflow, /ownerUserIds\?: string\[\]/, '会议待办 reconcile 需接收负责人');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { reconcileMeetingTasks } = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const { buildTaskNotificationsForVessels } = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const base = {
    revision: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
    settings: { sitePasswordHash: 'hash', systemTitle: 'QA', departments: ['航務部', '工務部'], taskCategories: [], taskCategorySchemaVersion: 2, lastCloudSyncAt: '' },
    users: [
      { id: 'owner', name: 'Owner', username: 'owner', role: 'owner', department: '管理層', passwordHash: 'hash', isActive: true, managedVesselIds: [] },
      { id: 'u1', name: '航務甲', username: 'u1', role: 'operator', department: '航務部', passwordHash: 'hash', isActive: true, managedVesselIds: [] },
      { id: 'u2', name: '工務乙', username: 'u2', role: 'operator', department: '工務部', passwordHash: 'hash', isActive: true, managedVesselIds: [] },
    ],
    vessels: [], tasks: [], agendaReports: [], auditLogs: [], notifications: [],
    meetings: [
      { id: 'm-old-wait', subject: '旧待开', status: '待開會', meetingDate: '2026-07-19', vessels: [], departments: ['航務部'], participantUserIds: ['u1', null], responsibleUserIds: ['u2', { bad: true }], resolution: '决议', expectedDate: '2026-07-20', priority: '中', taskItems: [], createdBy: 'owner', createdAt: '2026-07-19' },
      { id: 'm-old-doing', subject: '旧进行', status: '進行中', meetingDate: '2026-07-19', vessels: [], departments: [], resolution: '', expectedDate: '', priority: '中', taskItems: [], createdBy: 'owner', createdAt: '2026-07-19' },
    ],
  };
  const normalized = normalizeAppData(base);
  assert.equal(normalized.meetings[0].status, '待召開', '旧待开会需迁移为待召开');
  assert.equal(normalized.meetings[1].status, '追蹤中', '旧进行中需迁移为追踪中');
  assert.deepEqual(normalized.meetings[0].participantUserIds, ['u1']);
  assert.deepEqual(normalized.meetings[0].trackingUserIds, ['u2'], '旧会议追蹤窗口需由原负责人回填');
  assert.deepEqual(normalized.meetings[0].responsibleUserIds, ['u2']);
  assert.deepEqual(normalized.meetings[1].participantUserIds, [], '旧会议需补空人员字段');
  assert.deepEqual(normalized.meetings[1].responsibleUserIds, [], '旧会议需补空负责人字段');

  const tasks = [];
  const result = reconcileMeetingTasks({
    tasks, meetingId: 'm-new', vesselIds: ['v1'], followUps: [{ id: 'f1', description: '跟进' }], priority: '高', expectedDate: '2026-07-31', departments: ['航務部'], ownerUserIds: ['u2'], initialStatus: '待执行', actorId: 'owner', actorName: 'Owner', at: '2026-07-19T00:00:00.000Z',
  });
  assert.equal(result.created.length, 1);
  assert.deepEqual(result.created[0].ownerUserIds, ['u2'], '会议追蹤窗口需成为新待办追蹤窗口');
  reconcileMeetingTasks({
    tasks, meetingId: 'm-new', vesselIds: ['v1'], followUps: [{ id: 'f1', description: '跟进' }], priority: '高', expectedDate: '2026-07-31', departments: ['航務部'], ownerUserIds: ['u1'], initialStatus: '待执行', actorId: 'owner', actorName: 'Owner', at: '2026-07-20T00:00:00.000Z',
  });
  assert.deepEqual(tasks[0].ownerUserIds, ['u1'], '修改会议追蹤窗口需同步现有待办');
  const ownerNotices = buildTaskNotificationsForVessels(
    [{ id: 'u1', role: 'operator', department: '航務部', managedVesselIds: [], isActive: true }],
    [{ id: 'v1', assignedUserIds: ['u1'] }],
    'owner',
    tasks[0],
    'task_updated',
    'Owner',
  );
  assert.deepEqual(ownerNotices.map(notice => notice.userId), ['u1'], '会议追蹤窗口应收到自己追蹤事项的通知');
  console.log('Meeting participants, owners and required-field contracts passed.');
} finally {
  await server.close();
}
