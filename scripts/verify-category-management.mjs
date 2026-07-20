import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const categoriesModule = await server.ssrLoadModule('/src/taskCategories.ts');
  const base = {
    revision: 1, updatedAt: '2026-07-18T00:00:00.000Z',
    users: [], vessels: [], tasks: [{ id:'t1', vesselId:'v1', category:'歷史分類', categories:['歷史分類'], description:'history' }],
    meetings: [], agendaReports: [], auditLogs: [], notifications: [],
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:[], taskCategories:['自訂一','自訂二'], meetingTaskCategories:['船員管理','岸基培訓'], taskCategorySchemaVersion:2, meetingTaskCategorySchemaVersion:2, vesselStatuses:[], priorities:[], rolePermissions:{}, lastCloudSyncAt:'' },
  };
  const customized = normalizeAppData(base);
  assert.ok(customized);
  assert.deepEqual(customized.settings.taskCategories, ['自訂一','自訂二'], '新版自訂分類不得被預設清單補回');
  assert.deepEqual(customized.settings.meetingTaskCategories, ['船員管理','岸基培訓'], '新版臨會/專題待辦分類不得被要事分類補回或覆蓋');
  assert.deepEqual(customized.tasks[0].categories, ['歷史分類'], '移除選項不得破壞歷史任務分類');

  assert.deepEqual(categoriesModule.REQUIRED_MEETING_TASK_CATEGORIES, ['船員管理','船員培訓','稽核認證','船舶維護管理','岸基培訓','岸基人員管理'], '臨會/專題待辦分類預設值需符合使用者指定');
  assert.ok(!categoriesModule.REQUIRED_TASK_CATEGORIES.includes('臨會/專題'), '臨會/專題不得再作為普通要事分類項目');

  const legacy = normalizeAppData({ ...base, settings: { sitePasswordHash:'x', systemTitle:'x', departments:[], taskCategories:['人員','證書'], vesselStatuses:[], priorities:[], rolePermissions:{}, lastCloudSyncAt:'' } });
  assert.ok(legacy.settings.taskCategories.includes('換員操作'));
  assert.ok(legacy.settings.taskCategories.includes('證書'));
  assert.ok(!legacy.settings.taskCategories.includes('人員'));
  assert.equal(legacy.settings.taskCategorySchemaVersion, 2);
  assert.deepEqual(legacy.settings.meetingTaskCategories, categoriesModule.REQUIRED_MEETING_TASK_CATEGORIES, '舊資料需補入獨立臨會/專題待辦分類');

  const management = fs.readFileSync('src/Management.tsx','utf8');
  for (const token of ["'categories'", '要事分類', '臨會/專題待辦分類', 'TaskCategoryManager', '新增分類', '保存分類設定', '上移', '下移', '刪除']) {
    assert.ok(management.includes(token), `管理頁缺少分類維護接線：${token}`);
  }
  assert.ok(management.includes('taskCategorySchemaVersion = 2'), '保存分類時必須標記新版 schema');
  assert.ok(management.includes('meetingTaskCategorySchemaVersion = 2'), '保存臨會分類時必須標記新版 schema');

  const app = fs.readFileSync('src/App.tsx','utf8');
  const editor = fs.readFileSync('src/EditModals.tsx','utf8');
  const meetings = fs.readFileSync('src/meetingTaskWorkflow.ts','utf8');
  const analysis = fs.readFileSync('src/DataAnalysis.tsx','utf8');
  assert.ok(app.includes('meetingCategories:[]') && app.includes('filters.meetingCategories'), '所有清單篩選需將要事分類與臨會/專題分類分開保存');
  assert.ok(editor.includes('taskCategoryChoices') && editor.includes('categoryChoicesForTask'), '待辦編輯器需依來源切換分類選項');
  assert.ok(meetings.includes('meetingTaskCategories') && meetings.includes('item.categories'), '臨會同步待辦需使用臨會待辦項目的分類');
  assert.ok(analysis.includes('要事分類比例') && analysis.includes('臨會/專題分類比例') && analysis.includes('isMeetingTaskSource'), '數據分析分類比例需按要事來源與臨會/專題來源分開');
  console.log('Category management contracts passed.');
} finally {
  await server.close();
}
