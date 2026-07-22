import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const modal = fs.readFileSync(new URL('../src/EditModals.tsx', import.meta.url), 'utf8');
const work = fs.readFileSync(new URL('../src/WorkCenter.tsx', import.meta.url), 'utf8');
const meetings = fs.readFileSync(new URL('../src/TemporaryMeetings.tsx', import.meta.url), 'utf8');
const analysis = fs.readFileSync(new URL('../src/DataAnalysis.tsx', import.meta.url), 'utf8');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { validateBatchTaskSelection } = await server.ssrLoadModule('/src/batchTaskActions.ts');
  const { taskVesselLabel, taskShipTypeLabel } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const { isEligibleTaskOwner } = await server.ssrLoadModule('/src/permissions.ts');
  const { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications } = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const { meetingTaskLinkIsValidForMutation } = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const cross = { id:'cross', vesselId:'v1', vesselIds:['v1','v2'], ownerUserIds:[], isClosed:false };
  assert.equal(validateBatchTaskSelection([cross], ['cross'], new Set(['v1']), 'complete').ok, false, '部分可见范围不得完成整个多船事项');
  assert.equal(validateBatchTaskSelection([cross], ['cross'], new Set(['v1','v2']), 'complete').ok, true, '完整范围权限可完成多船事项');
  const liveMeeting={id:'m-live',vessels:['v1','v2'],isInternalControl:true,taskItems:[{id:'item-live',distributeToVessels:true}]};
  const validMeetingTask={sourceType:'temporary',attentionDimension:'meeting',sourceMeetingId:'m-live',sourceMeetingItemId:'item-live',vesselId:'v1',vesselIds:['v1','v2'],distributeToVessels:true,isInternalControl:true};
  assert.equal(meetingTaskLinkIsValidForMutation(validMeetingTask,[liveMeeting]),true,'完整且與父會議一致的來源關聯可進入 mutation');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,sourceType:'morning',attentionDimension:'task',sourceMeetingId:undefined,sourceMeetingItemId:undefined,distributeToVessels:false,isInternalControl:false},[]),true,'普通待辦不應被會議 mutation guard 阻擋');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,sourceMeetingId:undefined},[liveMeeting]),false,'孤立會議語意不得由任何非刪除 mutation 修改');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,sourceMeetingItemId:'stale'},[liveMeeting]),false,'失效事項來源不得完成或更新進度');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,isInternalControl:false},[liveMeeting]),false,'父會議內控狀態必須權威約束子待辦 mutation');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,distributeToVessels:false},[liveMeeting]),false,'父事項分船模式必須權威約束子待辦 mutation');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,vesselIds:['v1']},[liveMeeting]),false,'父會議涉船範圍必須權威約束子待辦 mutation');
  assert.equal(meetingTaskLinkIsValidForMutation({...validMeetingTask,vesselScopeMode:'all'},[liveMeeting]),false,'父會議 scope mode metadata 必須權威約束子待辦 mutation');
  assert.ok((app.match(/meetingTaskLinkIsValidForMutation\(/g)||[]).length>=3,'普通保存、單船進度與批量完成均需共用 live meeting mutation guard');
  const visible = [{ id:'v1', name:'公开船', shortName:'公开船', fullName:'PUBLIC', shipType:'Bulk' }];
  assert.equal(taskVesselLabel(cross, visible), 'PUBLIC、另含受限船舶 1 艘', '不得泄露受限船名');
  assert.equal(taskShipTypeLabel(cross, visible), 'Bulk、另含受限船舶 1 艘', '不得泄露受限船型');
  assert.ok(!app.includes('involvedVesselIds.has(v.id)'), '事项负责人不得扩大整船访问权');
  assert.match(app, /flushSync\(\(\)=>setData\(prev=>[\s\S]*taskVessels\(candidate,prev\.vessels\)/, '保存需在最新 state 解析完整事项范围');
  assert.match(app, /previous\.updatedAt!==expectedUpdatedAt/, '单笔事项保存需以打开时版本执行 CAS');
  assert.match(app, /prev\.revision!==expectedRevision/, '单笔事项 CAS 必须同时使用无同毫秒碰撞的全局 revision');
  assert.ok(app.includes('candidate.sourceMeetingId!==previous.sourceMeetingId')&&app.includes('candidate.sourceMeetingItemId!==previous.sourceMeetingItemId')&&app.includes('candidate.sourceType!==previous.sourceType'),'普通待辦保存不得偽造、解除或改寫會議來源關聯');
  assert.ok(app.includes("candidate.sourceType==='temporary'")&&app.includes("candidate.attentionDimension==='meeting'")&&app.includes("boundaryCandidate.sourceType='morning'")&&app.includes("boundaryCandidate.attentionDimension='task'"),'普通新增路徑需拒絕並正規化偽造的會議語意');
  assert.ok(app.includes("candidate.isClosed&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')")&&app.includes('boundaryCandidate.createdBy=liveUser.id')&&app.includes('boundaryCandidate.createdAt=saveAt'),'新建已結案待辦需 closeTasks，建立來源與時間必須由保存端蓋章');
  assert.ok(app.includes('statusLogsAppendOnly')&&app.includes('trustedStatusLogs')&&app.includes('previousProgress.isClosed&&candidateProgress.isClosed'),'普通與單船進度保存需保護既有歷程並禁止直接改寫已結案分船資料');
  assert.ok(app.includes('candidate.distributeToVessels!==previous.distributeToVessels||JSON.stringify(candidate.vesselProgress||[])!==JSON.stringify(previous.vesselProgress||[])'),'普通保存路徑不得切換分船模式或注入任何 vesselProgress');
  assert.ok(app.includes('linkedMeetingItem')&&app.includes('normalizedCandidate.distributeToVessels!==(linkedMeetingItem.distributeToVessels===true)'),'關聯待辦的分船模式必須由父會議事項權威決定');
  assert.ok(analysis.includes('taskIsClosedForScope')&&!analysis.includes('tasks.filter(task => task.isClosed)')&&!analysis.includes('highRiskTasks.filter(task => task.isClosed)'),'數據分析需使用 canonical 範圍結案語意，不得只讀頂層 isClosed');
  assert.ok(app.includes('candidate.vesselScopeMode!==previous.vesselScopeMode')&&app.includes('candidate.vesselTypeScopes||[]'),'普通保存不得偽造或改寫 scope mode metadata');
  assert.ok(!app.includes('function Stats('),'未使用且仍依賴 raw isClosed 的舊 Stats 元件應移除，避免日後誤啟用');
  assert.ok(app.includes('meetingTaskLinkIsValidForMutation(previous,prev.meetings)')&&app.includes('會議來源關聯缺失、失效或與父會議狀態不一致'),'既有會議語意或關聯待辦保存前需以共用 guard 驗證父會議權威狀態，孤立或不一致語意均需拒絕');
  assert.ok(app.includes('JSON.stringify(candidate.vesselProgress||[])!==JSON.stringify(previous.vesselProgress||[])')&&app.includes("hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')"),'保存端需保護分船結案歷史並重新驗證結案／重開權限');
  assert.ok(app.includes('expectedUpdatedAtById')&&app.includes('prev.revision!==expectedRevision||liveSelection.tasks.some'),'批量完成需在確認後以 revision 及逐筆 updatedAt CAS');
  assert.ok(app.includes('vessels.length!==taskVesselIds(liveTask).length'),'單筆刪除需拒絕含缺失船舶的部分解析範圍');
  assert.match(app, /previousVessels[\s\S]*必須同時具備原涉船與新涉船範圍權限/, '单笔事项更新需同时验证原范围与新范围');
  assert.match(app, /savedScopeVessels[\s\S]*saved\.ownerUserIds\.some[\s\S]*isEligibleTaskOwner/, '保存端需按最终实际涉船范围重新验证全部负责人资格');
  assert.match(app, /completedTasks\.flatMap[\s\S]*ownerUserIds:task\.ownerUserIds\.filter[\s\S]*'task_updated'/, '批量完成通知需过滤无完整涉船权限的负责人');
  assert.match(app, /liveSelection\.tasks\.flatMap[\s\S]*ownerUserIds:task\.ownerUserIds\.filter[\s\S]*internalControlDeletion\?'internal_control_cancelled':'task_deleted'/, '批量删除通知需按最终取消范围过滤负责人并保留专用通知');
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
