import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const types=fs.readFileSync('src/types.ts','utf8');
const styles=fs.readFileSync('src/styles.css','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
const morning=fs.readFileSync('src/MorningWorkspace.tsx','utf8');
const work=fs.readFileSync('src/WorkCenter.tsx','utf8');
const analysis=fs.readFileSync('src/DataAnalysis.tsx','utf8');
const internal=fs.readFileSync('src/InternalControlPage.tsx','utf8');
const dashboard=fs.readFileSync('src/Dashboard.tsx','utf8');
const scheduler=fs.existsSync('supabase/migrations/20260806093000_daily_morning_reports.sql')
  ?fs.readFileSync('supabase/migrations/20260806093000_daily_morning_reports.sql','utf8')
  :'';

assert.ok(types.includes('interface TaskDismissal'),'個人移除必須有雲端可保存的逐人記錄型別');
assert.ok(types.includes('taskDismissals: TaskDismissal[]'),'AppData必須包含個人移除記錄集合');
assert.ok(types.includes("kind?: 'daily-morning' | 'ad-hoc'"),'報告記錄必須區分每日早會快照與一般報告');
assert.ok(types.includes('businessDate?: string'),'每日早會記錄必須保存台北業務日期');
assert.ok(types.includes('snapshot?: MorningReportSnapshot'),'每日早會記錄必須保存不可被來源資料回寫的快照');

assert.match(styles,/\.morning-workspace\{[^}]*height:calc\(100dvh\s*-\s*[^)]+\)/,'早會桌面工作區高度必須由動態viewport推導');
assert.match(styles,/\.temporary-meeting-workspace\{[^}]*height:calc\(100dvh\s*-\s*[^)]+\)/,'臨會桌面工作區高度必須由動態viewport推導');
assert.doesNotMatch(styles,/\.morning-workspace\{[^}]*height:1120px/,'早會工作區不得固定為單一超高像素值');
assert.doesNotMatch(styles,/\.temporary-meeting-workspace\{[^}]*height:1180px/,'臨會工作區不得固定為單一超高像素值');
assert.match(styles,/@media\(max-width:900px\)\{[^}]*\.morning-workspace,\.temporary-meeting-workspace\{[^}]*height:auto/,'窄螢幕必須回到自然高度');

assert.ok(internal.includes('是否同時被選中為要事'),'內控同步篩選必須使用確認後的新名稱');
assert.doesNotMatch(internal,/>是否和要事同步</,'內控畫面不得保留舊篩選名稱');
assert.match(styles,/\.ic-filter-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/,'內控桌面篩選必須一行五欄');
assert.match(styles,/\.ic-filter-state\.active\{[^}]*color:/,'已套用篩選狀態必須有明確顏色');
assert.match(styles,/\.ic-filter-state\.inactive\{[^}]*color:/,'不限狀態必須使用不同的中性色');

assert.ok(work.includes('從我的待辦移除'),'我的待辦必須提供個人移除操作');
assert.ok(work.includes('永久刪除共用待辦'),'Owner／管理員必須看到明確分離的永久刪除名稱');
assert.ok(work.includes('onDismiss'),'個人移除不可誤接永久刪除callback');
assert.ok(app.includes('dismissFromMyWorkCenter'),'正式App必須接上雲端確認後的個人移除流程');

assert.ok(app.includes('printing-work-center'),'我的待辦PDF必須使用專用列印模式');
assert.match(styles,/body\.printing-work-center \.app-print-header[^}]*display:none!important/,'我的待辦PDF必須排除全域螢幕列印標題');
assert.match(styles,/body\.printing-work-center \.work-center>\.page-heading[^}]*display:none!important/,'我的待辦PDF必須排除畫面頁首與通知操作');
assert.match(styles,/@page work-center\{size:A4 landscape/,'我的待辦PDF各頁必須使用一致A4尺寸');

assert.match(styles,/\.category-ratio-panel \.analysis-compare-row\{[^}]*grid-template-columns:minmax\(/,'分類比例列必須為分類名稱保留可伸縮寬度');
assert.match(styles,/\.category-ratio-panel \.analysis-name\{[^}]*white-space:normal[^}]*overflow:visible/,'分類名稱必須完整顯示並自然換行');
assert.doesNotMatch(styles,/\.category-ratio-panel \.analysis-name\{[^}]*text-overflow:ellipsis/,'分類名稱不得只靠省略號顯示');

assert.match(styles,/\.ship-summary\{[^}]*height:/,'船舶重要摘要區必須固定可見高度');
assert.match(styles,/\.ship-summary-content\{[^}]*overflow-y:auto[^}]*overflow-x:hidden/,'重要摘要只允許區內垂直捲動');
assert.match(styles,/\.ship-summary-content>p,\.ship-summary-content>ul\{[^}]*display:inline/,'摘要各段應優先同行排列');
assert.ok(!dashboard.includes('sortedTasks.slice(0, 3)'), '摘要不得只保留前三筆而截掉實際內容');

assert.ok(app.includes("['dashboard','work','internalControl'].includes(k)"),'只有船隊看板、我的待辦與內控異常需要辨識為特殊未選中導覽');
assert.match(app,/tab!==k&&\['dashboard','work','internalControl'\]\.includes\(k\)\?'gradient-nav-label'/,'三個指定導覽必須只在未選中狀態套用漸層class');
assert.match(styles,/\.nav button\.gradient-nav-label:not\(\.active\)\{[^}]*linear-gradient[^}]*background-clip:text[^}]*-webkit-text-fill-color:transparent/,'指定的未選中導覽文字必須使用藍綠漸層字色');
assert.ok(work.includes("onOpenInternalControl(item.id)"),'我的待辦內控列更新按鈕必須傳入該筆內控ID');
assert.match(work,/onClick=\{\(\)=>onOpenInternalControl\(item\.id\)\}>更新<\/button>/,'我的待辦內控列右側按鈕必須顯示更新並直接開啟該筆資料');
assert.ok(internal.includes('requestedCaseId')&&internal.includes('void openCase(item)'),'內控頁必須以既有openCase協作鎖流程處理我的待辦直接更新要求');

assert.ok(app.includes('onSaveDailyMorning={saveDailyMorningHistory}')&&app.includes('await onSaveDailyMorning(nowIso())'),'保存早會必須呼叫雲端確認型callback');
assert.ok(app.includes('saveDailyMorningHistory'),'正式App必須在雲端成功後才呈現當日歷史');
assert.ok(app.includes('onOpenHistory'),'報告中心必須能打開凍結的歷史快照');
assert.match(scheduler,/Asia\/Taipei/,'雲端排程必須明確使用Asia/Taipei');
assert.match(scheduler,/0 1 \* \* 1-5/,'09:00台北排程必須對應UTC 01:00且只在週一至週五執行');
assert.match(scheduler,/businessDate/,'雲端排程必須按台北業務日期做每日唯一更新');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const time=await server.ssrLoadModule('/src/taipeiTime.ts');
  assert.equal(time.taipeiDateKey('2026-08-05T15:59:59.000Z'),'2026-08-05','UTC午夜前不得提前切換台北日期');
  assert.equal(time.taipeiDateKey('2026-08-05T16:00:00.000Z'),'2026-08-06','UTC 16:00必須切換至下一個台北日期');
  assert.equal(time.taipeiYesterdayDate('2026-01-01T00:30:00.000Z'),'2025-12-31','跨年昨日計算必須依台北日期');
  assert.equal(time.taipeiDaysDiff('2026-08-07','2026-08-06T15:59:59.000Z'),1,'期限差必須依台北今天計算');
  assert.match(time.formatTaipeiDateTime('2026-08-05T16:05:00.000Z'),/2026.*8.*6.*00:05/,'顯示時間必須換算為台北時間');

  const history=await server.ssrLoadModule('/src/morningHistory.ts');
  const base={
    agendaReports:[],
    vessels:[{id:'v1',isActive:true,name:'一號輪'}],
    tasks:[{id:'t1',vesselId:'v1',vesselIds:['v1'],sourceType:'morning',isClosed:false}],
    meetings:[],
  };
  const first=history.upsertDailyMorningReport(structuredClone(base),{at:'2026-08-06T00:30:00.000Z',actorUserId:'u1',source:'manual'});
  assert.equal(first.status,'saved');
  assert.equal(first.data.agendaReports.length,1);
  assert.equal(first.report.businessDate,'2026-08-06');
  assert.equal(first.report.snapshot.vessels.length,1);
  const secondInput=structuredClone(first.data);
  secondInput.vessels[0].name='更新船名';
  const second=history.upsertDailyMorningReport(secondInput,{at:'2026-08-06T02:00:00.000Z',actorUserId:'u1',source:'manual'});
  assert.equal(second.data.agendaReports.length,1,'同一台北工作日只能有一份正式快照');
  assert.equal(second.report.snapshot.vessels[0].name,'更新船名','同日稍後手動保存必須更新當日快照');
  assert.equal(first.report.snapshot.vessels[0].name,'一號輪','既有快照物件不得被後續來源資料反向改寫');
  const weekend=history.upsertDailyMorningReport(structuredClone(base),{at:'2026-08-08T01:00:00.000Z',actorUserId:'system',source:'scheduled'});
  assert.equal(weekend.status,'not-business-day','週六週日不得建立每日早會歷史');

  const dismissal=await server.ssrLoadModule('/src/taskDismissals.ts');
  const dismissalBase={taskDismissals:[],tasks:[{id:'t1'}],internalControlCases:[{id:'c1'}]};
  const dismissed=dismissal.dismissWorkCenterItems(dismissalBase,{userId:'u1',taskIds:['t1'],internalControlCaseIds:['c1'],at:'2026-08-06T03:00:00.000Z'});
  assert.equal(dismissed.taskDismissals.length,2);
  assert.equal(dismissal.isWorkCenterItemDismissed(dismissed,'u1','task','t1'),true);
  assert.equal(dismissal.isWorkCenterItemDismissed(dismissed,'u2','task','t1'),false,'個人移除不得影響其他共同負責人');
  assert.equal(dismissed.tasks.length,1,'個人移除不得刪除共用待辦');
  assert.equal(dismissed.internalControlCases.length,1,'個人移除不得刪除內控來源資料');
}finally{
  await server.close();
}

console.log('August 06 confirmed requirement contracts passed.');
