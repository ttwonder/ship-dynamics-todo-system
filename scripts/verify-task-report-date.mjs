import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const editSource = fs.readFileSync('src/EditModals.tsx', 'utf8');
const typesSource = fs.readFileSync('src/types.ts', 'utf8');
const normalizeSource = fs.readFileSync('src/normalize.ts', 'utf8');
const morningSource = fs.readFileSync('src/MorningWorkspace.tsx', 'utf8');

assert.ok(typesSource.includes('reportDate: string;'), 'TaskItem 必須保存報告日期欄位');
assert.ok(appSource.includes('reportDate:todayDate()'), '新增要事必須自動先帶入當天報告日期');
assert.ok(appSource.includes("expectedDate:''"), '新增要事仍不得自動帶入預計完成日期');
assert.ok(editSource.includes('<label>報告日期</label>') && editSource.includes('value={draft.reportDate}') && editSource.includes('target.reportDate=value'), '更新要事彈窗必須提供可編輯的報告日期 date input');
assert.ok(normalizeSource.includes('reportDate: normalizeDateText(item.reportDate) || normalizeDateText(text(item.createdAt, timestamp).slice(0, 10)) || timestamp.slice(0, 10)'), '舊資料需先驗證建立日期，再安全回填報告日期');
assert.ok(morningSource.includes("task.reportDate || (task.createdAt || task.updatedAt || '').slice(0, 10)"), '早會今日/歷史分組必須優先使用報告日期');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const data = normalizeAppData({
    revision: 1,
    updatedAt: '2026-07-21T09:00:00.000Z',
    settings: { sitePasswordHash: '', systemTitle: 'QA', departments: ['航運處'], taskCategories: ['PSC窗口'], rolePermissions: {} },
    users: [],
    vessels: [],
    tasks: [
      { id: 'legacy', vesselId: 'v1', priority: '中', isAware: false, isAbnormal: false, isInternalControl: false, category: 'PSC窗口', description: '舊資料', status: '', expectedDate: '', departments: [], ownerUserIds: [], isClosed: false, sourceType: 'morning', createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-07-20T08:30:00.000Z', updatedAt: '2026-07-21T10:00:00.000Z', statusLogs: [] },
      { id: 'kept', vesselId: 'v1', reportDate: '2026-07-19', priority: '中', isAware: false, isAbnormal: false, isInternalControl: false, category: 'PSC窗口', description: '已有報告日期', status: '', expectedDate: '', departments: [], ownerUserIds: [], isClosed: false, sourceType: 'morning', createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-07-20T08:30:00.000Z', updatedAt: '2026-07-21T10:00:00.000Z', statusLogs: [] },
      { id: 'bad', vesselId: 'v1', reportDate: 'not-a-date', priority: '中', isAware: false, isAbnormal: false, isInternalControl: false, category: 'PSC窗口', description: '錯誤日期', status: '', expectedDate: '', departments: [], ownerUserIds: [], isClosed: false, sourceType: 'morning', createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-07-18T08:30:00.000Z', updatedAt: '2026-07-21T10:00:00.000Z', statusLogs: [] },
    ],
    meetings: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.equal(data.tasks.find(task => task.id === 'legacy').reportDate, '2026-07-20', '舊待辦應由 createdAt 回填報告日期');
  assert.equal(data.tasks.find(task => task.id === 'kept').reportDate, '2026-07-19', '既有有效報告日期不可被覆蓋');
  assert.equal(data.tasks.find(task => task.id === 'bad').reportDate, '2026-07-18', '無效報告日期需回退建立日期');
} finally {
  await server.close();
}

console.log('Task report date contracts passed.');
