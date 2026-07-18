import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const categories = await server.ssrLoadModule('/src/taskCategories.ts');
  const names = await server.ssrLoadModule('/src/vesselDisplay.ts');
  const normalizer = await server.ssrLoadModule('/src/normalize.ts');

  assert.deepEqual(categories.REQUIRED_TASK_CATEGORIES, [
    '換員操作', '加油加水', '物料配件', '維修', 'Survey', '稽核檢查', 'PSC窗口',
    '證書', '缺失驗證', 'vetting', '貨品', '港口安排', '臨會/專題',
  ]);
  assert.deepEqual(categories.attentionKeysForCategories(['換員操作', 'Survey', '證書']), ['crew-operation', 'survey']);
  assert.deepEqual(categories.mergeAttentionFromCategories(['psc-window'], ['維修', '證書']), ['psc-window', 'maintenance']);
  assert.deepEqual(categories.normalizeTaskCategoryList('臨時會議決議', []), ['臨會/專題']);
  assert.deepEqual(categories.normalizeTaskCategoryList('證書', ['證書', '貨品', '證書']), ['證書', '貨品']);
  assert.equal(names.vesselDisplayName({ id:'v1', name:'SA', shortName:'SA', fullName:'FPMC AURORA' }), 'FPMC AURORA');

  const normalized = normalizer.normalizeAppData({
    revision: 1, updatedAt: '2026-07-18T00:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:[], taskCategories:['人員','證書','臨時會議決議'], vesselStatuses:['裝載'], priorities:['急'], rolePermissions:{}, lastCloudSyncAt:'' },
    users: [],
    vessels: [{ id:'v1', name:'SA', shortName:'SA', fullName:'FPMC AURORA', isActive:true, position:{}, cargo:{}, note:{ statusList:['塢修/航修'] } }],
    tasks: [{ id:'t1', vesselId:'v1', category:'證書', description:'closed', isClosed:true }],
    meetings: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.tasks[0].categories, ['證書']);
  assert.equal(normalized.tasks[0].category, '證書');
  assert.ok(normalized.settings.taskCategories.includes('換員操作'));
  assert.ok(normalized.settings.taskCategories.includes('臨會/專題'));
  assert.ok(!normalized.settings.taskCategories.includes('人員'));
  assert.ok(normalized.settings.vesselStatuses.includes('塢修/航修'));

  const dashboard = fs.readFileSync('src/Dashboard.tsx','utf8');
  const app = fs.readFileSync('src/App.tsx','utf8');
  const editor = fs.readFileSync('src/EditModals.tsx','utf8');
  const morning = fs.readFileSync('src/MorningWorkspace.tsx','utf8');
  assert.ok(dashboard.includes('船舶狀態') && dashboard.includes('vessel.note.statusList'), '看板載況旁必須顯示船舶狀態');
  assert.ok(editor.includes('CheckboxMultiPicker label="分類"') && editor.includes('draft.categories'), '新增要事分類必須可多選');
  assert.ok(app.includes('mergeAttentionFromCategories') && app.includes('saved.categories'), '保存要事必須同步點亮看板狀態');
  assert.ok(app.includes('closedFilters') && app.includes("tasks={closedTasks}"), '已結案頁需使用獨立篩選與已結案資料源');
  assert.ok(morning.includes('onAddTask') && morning.includes('＋ 新增待辦'), '早會討論區需提供新增待辦');
  assert.ok(app.includes('onAddTask={addTaskForVessel}'), 'App 必須把新增待辦动作接入早會');

  console.log('Latest user requirement contracts passed.');
} finally {
  await server.close();
}
