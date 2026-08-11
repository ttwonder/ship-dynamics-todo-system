import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const batch = await server.ssrLoadModule('/src/batchTaskActions.ts');
  const base = {
    vesselId:'v1', vesselIds:['v1'], ownerUserIds:[], departments:[], categories:[], category:'', sourceType:'morning',
    priority:'中', description:'測試', status:'', expectedDate:'', isAware:false, isAbnormal:false, isInternalControl:false,
    isClosed:false, createdAt:'2026-07-01T00:00:00.000Z', updatedAt:'2026-07-01T00:00:00.000Z', updatedBy:'u0', statusLogs:[],
  };
  const tasks = [
    { ...base, id:'open-a', description:'A' },
    { ...base, id:'open-b', description:'B' },
    { ...base, id:'closed-c', description:'C', isClosed:true, closedDate:'2026-07-10', closedBy:'u0' },
  ];
  const companyMeeting = { ...base, id:'meeting-company', vesselIds:['v1','v2'], sourceType:'temporary', sourceMeetingId:'m1', attentionDimension:'meeting', distributeToVessels:false, vesselProgress:[] };
  const multiMeeting = { ...base, id:'meeting-multi', vesselIds:['v1','v2'], sourceType:'temporary', sourceMeetingId:'m2', attentionDimension:'meeting', distributeToVessels:true, vesselProgress:[] };
  const linkedMeeting = {
    id:'meeting-sync', status:'追蹤中', vessels:['v1','v2'], vesselScopeMode:'vessels', vesselTypeScopes:[], isInternalControl:false,
    taskItems:[{id:'item-sync',description:'同步父會議',categories:[],distributeToVessels:false,isClosed:false}],
    latestStatus:'',statusLogs:[],updatedAt:'2026-07-01T00:00:00.000Z',
  };
  const linkedMeetingTask = { ...companyMeeting, id:'meeting-sync-task', sourceMeetingId:'meeting-sync', sourceMeetingItemId:'item-sync', description:'同步父會議', vesselScopeMode:'vessels', vesselTypeScopes:[] };
  const result = batch.completeSelectedTasks(tasks, ['open-a','closed-c','missing'], {
    actorId:'u9', actorName:'測試主管', at:'2026-07-18T12:34:56.000Z', closedDate:'2026-07-18',
  });
  assert.deepEqual(result.completedIds, ['open-a'], '只完成存在且尚未結案的所選事項');
  const completed = result.tasks.find(task => task.id === 'open-a');
  assert.equal(completed.isClosed, true);
  assert.equal(completed.closedDate, '2026-07-18');
  assert.equal(completed.closedBy, 'u9');
  assert.equal(completed.updatedAt, '2026-07-18T12:34:56.000Z');
  assert.equal(completed.updatedBy, 'u9');
  assert.match(completed.statusLogs[0].text, /批量完成/);
  assert.equal(completed.statusLogs[0].byUserId,'u9','系統產生的批量完成歷程必須保存不可變 actor ID');
  assert.equal(result.tasks.find(task => task.id === 'open-b').isClosed, false, '未選事項不應改變');
  assert.equal(result.tasks.find(task => task.id === 'closed-c').closedDate, '2026-07-10', '既有結案資料不應被覆寫');

  const removed = batch.deleteSelectedTasks(tasks, ['open-a','closed-c','missing']);
  assert.deepEqual(removed.deletedIds, ['open-a','closed-c']);
  assert.deepEqual(removed.tasks.map(task => task.id), ['open-b']);
  assert.deepEqual(batch.sanitizeTaskSelection(['open-a','stale'], tasks.slice(0,1)), ['open-a']);
  assert.deepEqual(batch.validateBatchTaskSelection(tasks,['open-a'],new Set(['v1']),'complete').taskIds,['open-a']);
  assert.equal(batch.validateBatchTaskSelection(tasks,['open-a','missing'],new Set(['v1']),'complete').ok,false,'缺失记录必须拒绝整批');
  const duplicateTasks=[...tasks,{...tasks[0],description:'重複 ID'}];
  assert.equal(batch.validateBatchTaskSelection(duplicateTasks,['open-a'],new Set(['v1']),'delete').ok,false,'重複待辦 ID 必須拒絕整批，避免一次確認刪除多筆');
  assert.deepEqual(batch.deleteSelectedTasks(duplicateTasks,['open-a']),{tasks:duplicateTasks,deletedIds:[]},'批量刪除工具本身也必須對重複 ID fail closed');
  const duplicateComplete=batch.completeSelectedTasks(duplicateTasks,['open-a'],{actorId:'u9',actorName:'測試主管',at:'2026-07-18T12:34:56.000Z',closedDate:'2026-07-18'});
  assert.deepEqual(duplicateComplete,{tasks:duplicateTasks,completedIds:[]},'批量完成工具本身也必須對重複 ID fail closed');
  assert.equal(batch.validateBatchTaskSelection(tasks,['closed-c'],new Set(['v1']),'complete').ok,false,'已结案记录不得再次批量完成');
  assert.equal(batch.validateBatchTaskSelection(tasks,['open-a'],new Set(['other']),'complete').ok,false,'不可见船舶记录必须拒绝整批');
  assert.equal(batch.validateBatchTaskSelection(tasks,['closed-c'],new Set(['v1']),'delete').ok,true,'已结案记录仍可由授权角色批量删除');
  assert.equal(batch.validateBatchTaskSelection([...tasks,companyMeeting],['meeting-company'],new Set(['v1','v2']),'complete').ok,true,'未分派公司層會議待辦可在總表整體批量完成');
  const companyClosed=batch.completeSelectedTasks([companyMeeting],['meeting-company'],{actorId:'u9',actorName:'測試主管',at:'2026-07-18T12:34:56.000Z',closedDate:'2026-07-18'});
  assert.deepEqual(companyClosed.completedIds,['meeting-company'],'未分派公司層會議待辦應可整體結案');
  assert.equal(companyClosed.tasks[0].isClosed,true,'未分派公司層會議待辦整體結案應更新頂層狀態');
  assert.equal(batch.validateBatchTaskSelection([...tasks,multiMeeting],['meeting-multi'],new Set(['v1','v2']),'complete').ok,false,'已分派到單船逐船跟蹤的多船會議待辦不得通過批量完成校驗');
  const guarded=batch.completeSelectedTasks([multiMeeting],['meeting-multi'],{actorId:'u9',actorName:'測試主管',at:'2026-07-18T12:34:56.000Z',closedDate:'2026-07-18'});
  assert.deepEqual(guarded.completedIds,[],'批量工具本身也不得整体完成已分派逐船會議待辦');
  assert.equal(guarded.tasks[0].isClosed,false,'已分派逐船會議待辦顶层结案状态不得被批量改变');

  assert.equal(typeof batch.completeSelectedTasksWithMeetingSync,'function','待辦清單完成需提供同步父會議item的批量領域操作');
  const synced=batch.completeSelectedTasksWithMeetingSync(
    [tasks[0],linkedMeetingTask],
    [linkedMeeting],
    ['open-a','meeting-sync-task'],
    {actorId:'u9',actorName:'測試主管',at:'2026-07-18T12:34:56.000Z',closedDate:'2026-07-18'},
  );
  assert.deepEqual(synced.completedIds,['open-a','meeting-sync-task'],'普通待辦與會議待辦可在同一批完成');
  assert.equal(synced.tasks.find(task=>task.id==='meeting-sync-task').isClosed,true,'批量完成需更新canonical會議來源Task');
  assert.equal(synced.meetings[0].taskItems[0].isClosed,true,'批量完成需同步父會議item顯示已完成');
  assert.equal(synced.meetings[0].taskItems[0].closedDate,'2026-07-18');
  assert.equal(linkedMeeting.taskItems[0].isClosed,false,'同步操作不得原地修改舊父會議snapshot');

  const app = fs.readFileSync('src/App.tsx','utf8');
  const work = fs.readFileSync('src/WorkCenter.tsx','utf8');
  const bundleStart=app.indexOf('const runTaskMutationWithLockBundle=');
  const bundleEnd=app.indexOf('\n  const batchCompleteTasks',bundleStart);
  const bundleBranch=app.slice(bundleStart,bundleEnd);
  const planningFetch=bundleBranch.indexOf('const fetched=await fetchCloudData(config)');
  const planningKeys=bundleBranch.indexOf('plannedLockKeys=[...new Set([...taskRelationLockKeys(planningRemote,uniqueIds),...additionalLockKeys(planningRemote)])]');
  const bundleClaim=bundleBranch.indexOf('const result=await acquireEditLockBundle(');
  assert.ok(planningFetch>=0&&planningFetch<planningKeys&&planningKeys<bundleClaim,'batch task operations must plan the complete task/meeting/internal-control lock closure from fresh cloud data before claiming');
  assert.ok(bundleBranch.includes('plannedLockKeys.map')&&!bundleBranch.includes('uniqueIds.map(id=>({sectionKey:`task:${id}`'),'the bundle must claim every planned related key rather than only selected task keys');
  assert.ok(bundleBranch.includes('refreshedLockKeys=[...new Set([...taskRelationLockKeys(remote,uniqueIds),...additionalLockKeys(remote)])]')&&bundleBranch.includes('sameLockKeySet(refreshedLockKeys,plannedLockKeys)'),'the post-lock refresh must reject any task or additional internal-control relation set that changed while locks were being acquired');
  assert.ok(bundleBranch.includes("runCloudSaveQueueRpc('批量關聯鎖續期'")&&bundleBranch.includes('renewEditLock(')&&bundleBranch.includes('Promise.allSettled'),'the complete related bundle must renew concurrently for the whole mutation');
  assert.ok(app.includes('batchCompleteTasks') && app.includes('batchDeleteTasks'), 'App 必須集中處理批量完成與刪除');
  assert.ok(app.includes('completeSelectedTasksWithMeetingSync'), 'App批量完成需把來源Task與父會議item放入同一snapshot同步');
  assert.ok(app.includes("只有 Owner／管理員可以批量刪除待辦"), '批量刪除 handler 必須有角色防護');
  assert.ok(app.includes("目前角色未獲授權批量完成待辦"), '批量完成 handler 必須有權限防護');
  assert.ok(app.includes('validateBatchTaskSelection(prev.tasks'), '批量 handler 必须在原子状态事务内重新验证最新记录');
  assert.ok(app.includes("hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')"), '批量完成必须在原子事务内重新授权');
  assert.ok(app.includes("hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')"), '批量删除必须在原子事务内重新授权');
  assert.ok(app.includes("'批量完成事項'") && app.includes("'批量刪除事項'"), '每筆批量动作必须留下审计记录');
  for (const label of ['全選目前結果','批量完成']) {
    assert.ok(app.includes(label), `待辦總表／已結案缺少 ${label}`);
    assert.ok(work.includes(label), `我的待辦缺少 ${label}`);
  }
  assert.ok(app.includes('批量刪除'),'待辦總表／已結案缺少批量刪除');
  assert.ok(work.includes('永久刪除共用待辦'),'我的待辦缺少永久刪除共用待辦');
  assert.ok(work.includes('aria-label={`選取待辦'), '我的待辦每列必须有可存取名称的勾选框');
  assert.ok(app.includes('aria-label={`選取待辦'), '總表／已結案每列必须有可存取名称的勾选框');
  assert.ok(app.indexOf("['total',currentUser.role==='vessel'?'本船待辦':'待辦總表']") < app.indexOf("['closed','已結案']")
    && app.indexOf("['closed','已結案']") < app.indexOf("['reports','報告中心']"), '已結案標籤必須位於待辦總表與報告中心之間');

  assert.match(app,/let applied=false;[\s\S]*flushSync\(\(\)=>setData\(prev=>/, '批量交易必须同步取得最新-state updater 的真实结果');
  assert.match(app,/if\(!applied\)[^\n]*alert/, '最新状态重验失败必须提供反馈');
  assert.ok((app.match(/return applied;/g)||[]).length>=2, '完成与删除必须返回真实交易结果');
  console.log('Batch task action runtime and UI contracts passed.');
} finally {
  await server.close();
}
