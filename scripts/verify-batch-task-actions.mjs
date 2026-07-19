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
  assert.equal(result.tasks.find(task => task.id === 'open-b').isClosed, false, '未選事項不應改變');
  assert.equal(result.tasks.find(task => task.id === 'closed-c').closedDate, '2026-07-10', '既有結案資料不應被覆寫');

  const removed = batch.deleteSelectedTasks(tasks, ['open-a','closed-c','missing']);
  assert.deepEqual(removed.deletedIds, ['open-a','closed-c']);
  assert.deepEqual(removed.tasks.map(task => task.id), ['open-b']);
  assert.deepEqual(batch.sanitizeTaskSelection(['open-a','stale'], tasks.slice(0,1)), ['open-a']);
  assert.deepEqual(batch.validateBatchTaskSelection(tasks,['open-a'],new Set(['v1']),'complete').taskIds,['open-a']);
  assert.equal(batch.validateBatchTaskSelection(tasks,['open-a','missing'],new Set(['v1']),'complete').ok,false,'缺失记录必须拒绝整批');
  assert.equal(batch.validateBatchTaskSelection(tasks,['closed-c'],new Set(['v1']),'complete').ok,false,'已结案记录不得再次批量完成');
  assert.equal(batch.validateBatchTaskSelection(tasks,['open-a'],new Set(['other']),'complete').ok,false,'不可见船舶记录必须拒绝整批');
  assert.equal(batch.validateBatchTaskSelection(tasks,['closed-c'],new Set(['v1']),'delete').ok,true,'已结案记录仍可由授权角色批量删除');

  const app = fs.readFileSync('src/App.tsx','utf8');
  const work = fs.readFileSync('src/WorkCenter.tsx','utf8');
  assert.ok(app.includes('batchCompleteTasks') && app.includes('batchDeleteTasks'), 'App 必須集中處理批量完成與刪除');
  assert.ok(app.includes("只有 Owner／管理員可以批量刪除待辦"), '批量刪除 handler 必須有角色防護');
  assert.ok(app.includes("目前角色未獲授權批量完成待辦"), '批量完成 handler 必須有權限防護');
  assert.ok(app.includes('validateBatchTaskSelection(prev.tasks'), '批量 handler 必须在原子状态事务内重新验证最新记录');
  assert.ok(app.includes("hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')"), '批量完成必须在原子事务内重新授权');
  assert.ok(app.includes("hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')"), '批量删除必须在原子事务内重新授权');
  assert.ok(app.includes("'批量完成事項'") && app.includes("'批量刪除事項'"), '每筆批量动作必须留下审计记录');
  for (const label of ['全選目前結果','批量完成','批量刪除']) {
    assert.ok(app.includes(label), `待辦總表／已結案缺少 ${label}`);
    assert.ok(work.includes(label), `我的待辦缺少 ${label}`);
  }
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
