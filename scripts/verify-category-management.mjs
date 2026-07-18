import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const base = {
    revision: 1, updatedAt: '2026-07-18T00:00:00.000Z',
    users: [], vessels: [], tasks: [{ id:'t1', vesselId:'v1', category:'歷史分類', categories:['歷史分類'], description:'history' }],
    meetings: [], agendaReports: [], auditLogs: [], notifications: [],
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:[], taskCategories:['自訂一','自訂二'], taskCategorySchemaVersion:2, vesselStatuses:[], priorities:[], rolePermissions:{}, lastCloudSyncAt:'' },
  };
  const customized = normalizeAppData(base);
  assert.ok(customized);
  assert.deepEqual(customized.settings.taskCategories, ['自訂一','自訂二'], '新版自訂分類不得被預設清單補回');
  assert.deepEqual(customized.tasks[0].categories, ['歷史分類'], '移除選項不得破壞歷史任務分類');

  const legacy = normalizeAppData({ ...base, settings: { ...base.settings, taskCategorySchemaVersion: undefined, taskCategories:['人員','證書'] } });
  assert.ok(legacy.settings.taskCategories.includes('換員操作'));
  assert.ok(legacy.settings.taskCategories.includes('證書'));
  assert.ok(!legacy.settings.taskCategories.includes('人員'));
  assert.equal(legacy.settings.taskCategorySchemaVersion, 2);

  const management = fs.readFileSync('src/Management.tsx','utf8');
  for (const token of ["'categories'", '要事分類', 'TaskCategoryManager', '新增分類', '保存分類設定', '上移', '下移', '刪除']) {
    assert.ok(management.includes(token), `管理頁缺少分類維護接線：${token}`);
  }
  assert.ok(management.includes('taskCategorySchemaVersion = 2'), '保存分類時必須標記新版 schema');
  console.log('Category management contracts passed.');
} finally {
  await server.close();
}
