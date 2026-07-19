import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const modal = fs.readFileSync(new URL('../src/EditModals.tsx', import.meta.url), 'utf8');
const work = fs.readFileSync(new URL('../src/WorkCenter.tsx', import.meta.url), 'utf8');
const meetings = fs.readFileSync(new URL('../src/TemporaryMeetings.tsx', import.meta.url), 'utf8');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { validateBatchTaskSelection } = await server.ssrLoadModule('/src/batchTaskActions.ts');
  const { taskVesselLabel, taskShipTypeLabel } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const { isEligibleTaskOwner } = await server.ssrLoadModule('/src/permissions.ts');
  const { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications } = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const cross = { id:'cross', vesselId:'v1', vesselIds:['v1','v2'], ownerUserIds:[], isClosed:false };
  assert.equal(validateBatchTaskSelection([cross], ['cross'], new Set(['v1']), 'complete').ok, false, '部分可见范围不得完成整个多船事项');
  assert.equal(validateBatchTaskSelection([cross], ['cross'], new Set(['v1','v2']), 'complete').ok, true, '完整范围权限可完成多船事项');
  const visible = [{ id:'v1', name:'公开船', shortName:'公开船', fullName:'PUBLIC', shipType:'Bulk' }];
  assert.equal(taskVesselLabel(cross, visible), 'PUBLIC、另含受限船舶 1 艘', '不得泄露受限船名');
  assert.equal(taskShipTypeLabel(cross, visible), 'Bulk、另含受限船舶 1 艘', '不得泄露受限船型');
  assert.ok(!app.includes('involvedVesselIds.has(v.id)'), '事项负责人不得扩大整船访问权');
  assert.match(app, /flushSync\(\(\)=>setData\(prev=>[\s\S]*taskVessels\(candidate,prev\.vessels\)/, '保存需在最新 state 解析完整事项范围');
  assert.match(app, /previous\.updatedAt!==expectedUpdatedAt/, '单笔事项保存需以打开时版本执行 CAS');
  assert.match(app, /prev\.revision!==expectedRevision/, '单笔事项 CAS 必须同时使用无同毫秒碰撞的全局 revision');
  assert.match(app, /previousVessels[\s\S]*必須同時具備原涉船與新涉船範圍權限/, '单笔事项更新需同时验证原范围与新范围');
  assert.match(app, /invalidOwner=candidate\.ownerUserIds\.some[\s\S]*isEligibleTaskOwner/, '保存端需重新验证全部负责人资格');
  assert.match(app, /completedTasks\.flatMap[\s\S]*ownerUserIds:task\.ownerUserIds\.filter[\s\S]*'task_updated'/, '批量完成通知需过滤无完整涉船权限的负责人');
  assert.match(app, /liveSelection\.tasks\.flatMap[\s\S]*ownerUserIds:task\.ownerUserIds\.filter[\s\S]*'task_deleted'/, '批量删除通知需过滤无完整涉船权限的负责人');
  assert.match(modal, /visibleVessels/, '事项编辑器只能使用授权船舶资料显示范围');
  assert.ok(!work.includes('taskVesselLabel(task,data.vessels)')&&!work.includes('taskVesselLabel(task, data.vessels)'), '我的待办不得用全量船舶资料显示范围');
  assert.match(meetings, /previousTasks=new Map[\s\S]*buildTaskScopeChangeNotifications/, '会议范围移除通知必须使用旧＋新 task 快照');
  const vessels = [{ id:'v1', assignedUserIds:['old'] }, { id:'v2', assignedUserIds:['next'] }];
  const users = [
    { id:'old', role:'operator', department:'航務部', managedVesselIds:[], isActive:true },
    { id:'next', role:'operator', department:'航務部', managedVesselIds:[], isActive:true },
  ];
  assert.equal(isEligibleTaskOwner(undefined, users[0], [vessels[0]]), true);
  assert.equal(isEligibleTaskOwner(undefined, users[0], vessels), false, '部分船舶授权者不得成为多船负责人');
  const notices = buildTaskScopeChangeNotifications(
    users,
    { task:{ id:'t', description:'旧范围', isInternalControl:false, ownerUserIds:['old'] }, vessels:[vessels[0]] },
    { task:{ id:'t', description:'新范围', isInternalControl:false, ownerUserIds:['next'] }, vessels:[vessels[1]] },
    'actor','task_updated','Owner',
  );
  assert.ok(notices.some(item=>item.userId==='old'&&item.vesselId==='v1'), '旧负责人需收到旧范围变更通知');
  assert.ok(notices.some(item=>item.userId==='next'&&item.vesselId==='v2'), '新负责人需收到新范围通知');
  assert.ok(!notices.some(item=>item.userId==='next'&&item.vesselId==='v1'), '新负责人不得绑定到已移除旧范围');
  const guardedNotices=buildTaskNotificationsForVessels(users,vessels,'actor',{id:'cross',description:'跨船敏感事项',isInternalControl:false,ownerUserIds:['old']},'task_updated','Owner',undefined);
  assert.ok(!guardedNotices.some(item=>item.userId==='old'&&item.vesselId==='v2'),'无完整范围权限的旧负责人不得收到受限船通知');
  console.log('Multi-vessel authorization and redaction contracts passed.');
} finally { await server.close(); }
