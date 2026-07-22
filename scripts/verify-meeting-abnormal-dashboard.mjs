import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const types = fs.readFileSync('src/types.ts','utf8');
const meetingsPage = fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx','utf8');
const app = fs.readFileSync('src/App.tsx','utf8');
const analysis = fs.readFileSync('src/DataAnalysis.tsx','utf8');

assert.match(types,/interface TemporaryMeeting[\s\S]*isAbnormal: boolean;[\s\S]*isInternalControl: boolean;/,'臨會/專題需持久化異常與內部管控');
assert.ok(meetingsPage.includes('meeting-abnormal-toggle') && meetingsPage.includes('meeting-internal-control-toggle'), '臨會/專題輸入頁需提供異常與內部管控勾選');
assert.ok(meetingsPage.includes('isInternalControl: value, isAbnormal: value ? true : previous.isAbnormal'), '勾選內部管控時需同步標記異常');
assert.doesNotMatch(meetingsPage,/if \(!draft\.expectedDate\) return alert\('請選擇預計完成日期'\)/,'臨會/專題保存不得要求預計完成日期');
assert.ok(meetingsPage.includes('<label>預計完成日期</label><input type="date"'), '預計完成日期需保留可選欄位但不得標記必填');
assert.ok(meetingsPage.includes('isAbnormal:effectiveDraft.isAbnormal') && meetingsPage.includes('isInternalControl:effectiveDraft.isInternalControl'), '臨會旗標需同步到關聯待辦');
assert.ok(app.includes('dashboardMeetingAlerts(') && !app.includes('meetings={data.meetings}'), 'App 傳入看板的臨會資料必須先依內容授權最小化／去識別');
assert.ok(app.includes("const canUseMeetingWorkspace = Boolean(currentUser && currentUser.role!=='vessel')") && app.includes('canUseMeetings={canUseMeetingWorkspace}') && !app.includes("const canUseMeetings = hasPermission(data.settings.rolePermissions, currentUser, 'manageMeetings')"), '會議工作區／內容讀取資格需在未登入時保持 null-safe，且不得誤綁為會議新增修改權限');
assert.ok(meetingsPage.includes("trustedClosureDate(value,'')") && meetingsPage.includes('completedDate:trustedClosureDate(requestedDraft.completedDate,todayDate())'), '會議完成日期必須在輸入及最新狀態保存邊界驗證真實日曆日期');
assert.ok(meetingsPage.includes('let reconciliation:ReturnType<typeof reconcileMeetingTasks>') && meetingsPage.includes('try{reconciliation=reconcileMeetingTasks({') && meetingsPage.includes("catch(error:any){failure=error.message||'會議待辦對帳失敗，未保存任何變更';return prev;}"), '會議待辦 ID 或對帳完整性失敗必須在交易內捕捉並原子退回，不得讓 UI 卡死');
assert.ok(meetingsPage.includes('canCancelInternalControl') && meetingsPage.includes('meetingTaskInternalControlTransitionRequired') && meetingsPage.includes('meetingInternalControlTransition||taskInternalControlTransition') && meetingsPage.includes('有個別來源缺少歷史涉船範圍') && meetingsPage.includes("internalControlCancellation:internalControlCancellationRequested?{authorized:true,at,by:liveUser.id}:undefined") && meetingsPage.includes('disabled={!creating&&persistedInternalControlVesselIds.size>0&&!canCancelSelectedInternalControl}'), '臨會取消、範圍縮減或待辦移除必須逐一驗證完整舊範圍，任何來源範圍缺失時需拒絕');
assert.ok(meetingsPage.includes("if(effectiveDraft.isInternalControl&&!effectiveDraft.vessels.length)") && meetingsPage.includes('internalControlCancelledAt=at') && meetingsPage.includes('meetingCancellationNotices'), '內控臨會不得以空涉船範圍建立，取消資料與無待辦通知需持久化');
assert.ok(meetingsPage.includes("prev.revision !== data.revision || liveMeeting.updatedAt !== meeting.updatedAt") && meetingsPage.includes("'刪除臨會/專題', 'meeting'") && meetingsPage.includes('deletionNotices') && meetingsPage.includes("'刪除事項', 'task'") && meetingsPage.includes('meetingHistoricalVessels'), '刪除臨會需做 revision/updatedAt CAS，逐筆保留刪除通知／稽核，並完整覆蓋會議歷史範圍');
assert.ok(meetingsPage.includes("reconciliation.internalControlCancelledIds.forEach") && meetingsPage.includes("'取消內部管控','task'") && meetingsPage.includes("internalControlCancellationRequested?'取消臨會/專題內部管控'") && meetingsPage.includes('已記錄取消人、時間及FLOW申報提醒'), '臨會取消內控需為每個待辦及會議留下專用稽核語義');
assert.ok(meetingsPage.includes('parentAuthoritativeTaskTransition') && meetingsPage.includes('task.isInternalControl||liveMeeting.isInternalControl'), '父會議為內控但子待辦旗標不一致時，重存與刪除均須按父會議權威狀態進入取消授權、通知及稽核');
assert.ok(dashboard.includes('meetingCreatesVesselAbnormalAlert') && dashboard.includes('臨會/專題異常'), '看板需顯示具體涉船臨會的異常提醒');
assert.ok(dashboard.includes("canUseMeetings?abnormalMeetings.map") && dashboard.includes('存在需關注之臨會/專題異常'), '無會議內容權限時看板只可顯示去識別異常訊號，不得顯示標題');
assert.ok(analysis.includes('meetingCreatesVesselAbnormalAlert') && analysis.includes('hasMeetingAbnormal'), '數據分析的船舶關注度需納入與看板相同的臨會異常訊號');

const server = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const { meetingCreatesVesselAbnormalAlert, dashboardMeetingAlerts } = await server.ssrLoadModule('/src/meetingVesselAttention.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { reconcileMeetingTasks } = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const baseMeeting = { id:'m1', subject:'主機異常專題', status:'追蹤中', vesselScopeMode:'vessels', vessels:['v1'], isAbnormal:true, isInternalControl:false };
  assert.equal(meetingCreatesVesselAbnormalAlert(baseMeeting,'v1'),true,'逐船選擇且異常的未完成會議需提醒對應船舶');
  assert.equal(meetingCreatesVesselAbnormalAlert({...baseMeeting,vesselScopeMode:'all'},'v1'),false,'全部船舶範圍不得在每艘看板產生異常提醒');
  assert.equal(meetingCreatesVesselAbnormalAlert({...baseMeeting,status:'已完成'},'v1'),false,'已完成會議不得繼續提醒');
  assert.equal(meetingCreatesVesselAbnormalAlert({...baseMeeting,isAbnormal:false},'v1'),false,'未勾選異常不得提醒');
  assert.equal(meetingCreatesVesselAbnormalAlert(baseMeeting,'v2'),false,'不得提醒未涉及船舶');
  const fullMeeting={...baseMeeting,resolution:'機密決議',statusLogs:[{id:'l1',text:'機密歷程'}],participantUserIds:['u1']};
  const redactedAlert=dashboardMeetingAlerts([fullMeeting],['v1'],()=>false)[0];
  assert.deepEqual(redactedAlert,{id:'m1',subject:'',status:'追蹤中',vesselScopeMode:'vessels',vessels:['v1'],isAbnormal:true},'無內容權限的看板臨會只可保留異常判斷所需最小欄位');
  assert.equal(dashboardMeetingAlerts([fullMeeting],['v1'],()=>true)[0].subject,'主機異常專題','具會議內容權限時才可保留標題');
  assert.deepEqual(dashboardMeetingAlerts([{...fullMeeting,id:'m2',vessels:['v2']}],['v1'],()=>true),[],'看板 props 不得包含使用者不可見船舶的會議識別碼或內容');

  const normalized = normalizeAppData({revision:1,updatedAt:'2026-07-22T00:00:00Z',settings:{sitePasswordHash:'x',departments:[],taskCategories:[],rolePermissions:{},nonOwnerPasswordResetVersion:2},users:[],vessels:[],tasks:[],meetings:[{...baseMeeting,meetingDate:'2026-07-22',reason:'原因',departments:[],participantUserIds:[],trackingUserIds:[],responsibleUserIds:[],resolution:'',taskItems:[],expectedDate:'',priority:'中',includeInMorning:false,isAbnormal:false,isInternalControl:true,internalControlCancelledAt:'2026-07-22T01:00:00Z',internalControlCancelledBy:'u2',createdBy:'u1',createdAt:'2026-07-22T00:00:00Z'}],agendaReports:[],auditLogs:[],notifications:[]});
  assert.equal(normalized.meetings[0].isInternalControl,true);
  assert.equal(normalized.meetings[0].isAbnormal,true,'內部管控正規化後必須同時視為異常');
  assert.equal(normalized.meetings[0].internalControlCancelledBy,'u2','臨會層取消人與時間需持久化');
  assert.equal(normalized.meetings[0].expectedDate,'','空白預計完成日期需保留');

  const tasks=[];
  reconcileMeetingTasks({tasks,meetingId:'m1',vesselIds:['v1'],vesselScopeMode:'vessels',followUps:[{id:'f1',description:'跟進主機異常',categories:[],distributeToVessels:false}],priority:'高',isAbnormal:true,isInternalControl:true,expectedDate:'',departments:[],ownerUserIds:[],initialStatus:'',actorId:'u1',actorName:'User',at:'2026-07-22T00:00:00Z'});
  assert.equal(tasks[0].isAbnormal,true,'臨會異常需同步至關聯待辦');
  assert.equal(tasks[0].isInternalControl,true,'臨會內部管控需同步至關聯待辦');
  assert.equal(tasks[0].expectedDate,'','臨會空白預計完成日期需同步到待辦');
  const malformedParentTask={...structuredClone(tasks[0]),id:'malformed-parent-task',sourceMeetingId:'m2',sourceMeetingItemId:'old-item',isInternalControl:false,isAbnormal:false,isClosed:false};
  assert.throws(()=>reconcileMeetingTasks({tasks:[malformedParentTask],meetingId:'m2',vesselIds:['v1'],followUps:[],priority:'中',isAbnormal:false,isInternalControl:true,expectedDate:'',departments:[],ownerUserIds:[],initialStatus:'',actorId:'u1',actorName:'User',at:'2026-07-22T00:00:00Z'}),/無權取消內部管控/,'父會議為內控但活動子待辦旗標錯誤時，移除事項必須 fail closed 要求取消授權');
  assert.equal(malformedParentTask.isInternalControl,false,'取消授權失敗不得先行改寫原待辦');
} finally { await server.close(); }

console.log('Meeting abnormal/internal-control dashboard and optional due-date contracts passed.');
