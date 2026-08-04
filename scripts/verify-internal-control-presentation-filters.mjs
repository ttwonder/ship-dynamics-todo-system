import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const page = fs.readFileSync('src/InternalControlPage.tsx', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(types.includes('supervisorIds: string[];'), 'InternalControlFilters 必須有純篩選用的經管督導 ID 集合');
assert.ok(types.includes("syncMode: 'all' | 'synced' | 'not-synced';"), 'InternalControlFilters 必須有三態同步篩選，不得新增案件保存欄位');

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const workflow = await server.ssrLoadModule('/src/internalControlWorkflow.ts');
  const users = [
    { id: 's1', name: '甲督導', department: '督導', role: 'operator', isActive: true, managedVesselIds: ['v1'] },
    { id: 's2', name: '乙督導', department: '督導', role: 'operator', isActive: true, managedVesselIds: ['v2'] },
    { id: 'n1', name: '非督導', department: '管理組', role: 'operator', isActive: true, managedVesselIds: ['v1'] },
  ];
  const vessels = [
    { id: 'v1', name: '一號輪', shortName: '', fullName: '', shipType: '油輪', isActive: true, assignedUserIds: [], delegateManagers: [] },
    { id: 'v2', name: '二號輪', shortName: '', fullName: '', shipType: '散貨輪', isActive: true, assignedUserIds: ['s2'], delegateManagers: [] },
  ];
  const base = { reportDate: '2026-08-05', reportSource: '訪船', description: '測試事項', priority: '高', category: '設備故障', departments: ['輪機'], isAware: false, status: '跟進中', syncToTask: false, isClosed: false };
  const cases = [
    { ...base, id: 'c1', vesselId: 'v1', linkedTaskId: 'task-1' },
    { ...base, id: 'c2', vesselId: 'v1' },
    { ...base, id: 'c3', vesselId: 'v2', linkedTaskId: 'task-3' },
  ];
  const empty = workflow.emptyInternalControlFilters();
  assert.deepEqual(
    workflow.filterInternalControlCases(cases, vessels, { ...empty, supervisorIds: ['s1'], syncMode: 'synced' }, users).map(item => item.id),
    ['c1'],
    '經管督導與同步狀態必須跨類別 AND 篩選',
  );
  assert.deepEqual(
    workflow.filterInternalControlCases(cases, vessels, { ...empty, supervisorIds: ['s1'], syncMode: 'not-synced' }, users).map(item => item.id),
    ['c2'],
    '未同步篩選必須以實際沒有 linkedTaskId 判斷',
  );
  assert.deepEqual(
    workflow.filterInternalControlCases(cases, vessels, { ...empty, supervisorIds: ['s1', 's2'], syncMode: 'all' }, users).map(item => item.id),
    ['c1', 'c2', 'c3'],
    '同一經管督導篩選組內必須採 OR',
  );
} finally {
  await server.close();
}

assert.ok(page.includes("import { vesselSupervisorOptions } from './vesselDashboardFilters';"), '內控督導候選必須復用正式船舶分管 helper');
assert.ok(page.includes('<MultiFilter label="經管督導"'), '篩選區必須有經管督導姓名多選');
assert.ok(page.includes('<span>是否和要事同步</span>'), '報告來源下方必須新增同步狀態篩選');
for (const option of ['不限', '已同步要事', '未同步要事']) assert.ok(page.includes(`>${option}<`), `同步篩選必須提供「${option}」`);
assert.ok(page.includes("item.linkedTaskId ? '已同步要事' : '未同步要事'"), '同步欄只可顯示二元人話狀態');
assert.ok(!page.includes('<small>{item.linkedTaskId}</small>'), '同步欄不得再顯示長 task ID');
assert.ok(!page.includes(" : '僅內控'"), '未同步案件必須明確顯示「未同步要事」');
assert.ok(page.includes('className="ic-description-column"') && page.includes('className="ic-status-column"') && page.includes('className="ic-sync-column"'), '事項、最新狀態及同步欄必須有明確欄寬 class');

assert.match(styles, /\.ic-filter-options\{[^}]*overflow-x:hidden/, '內控多選名單不得有水平捲動條');
assert.match(styles, /\.ic-filter-options label\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/, '內控多選項必須一列顯示 checkbox＋姓名');
assert.match(styles, /\.ic-description-column,\.ic-status-column\{[^}]*font-size:15px[^}]*white-space:normal/, '事項內容與最新狀態文字必須放大且可換行');
assert.match(styles, /\.ic-status-column\{[^}]*width:25%/, '同步欄釋出的空間必須優先分配給最新狀態');
assert.match(styles, /\.ic-sync-column\{[^}]*width:7%/, '同步欄必須縮至緊湊寬度');

console.log('Internal-control supervisor/sync filters and readable list presentation contracts passed.');
