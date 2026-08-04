import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const editModals = fs.readFileSync('src/EditModals.tsx', 'utf8');
const types = fs.readFileSync('src/types.ts', 'utf8');
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });

const payload = note => ({
  revision: 1,
  updatedAt: '2026-08-05T00:00:00.000Z',
  settings: { sitePasswordHash: 'x', systemTitle: 'QA', departments: [], taskCategories: [], vesselStatuses: ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar'], priorities: ['急', '高', '中', '低'], rolePermissions: {}, lastCloudSyncAt: '' },
  users: [],
  vessels: [{ id: 'v1', name: '測試輪', shortName: '測試輪', fullName: 'FPMC TEST', shipType: '超油', isActive: true, position: {}, cargo: {}, note }],
  tasks: [],
  meetings: [],
  agendaReports: [],
  auditLogs: [],
  notifications: [],
});

try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { buildCloudBlockPatch } = await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const { existingEntityLockKeysForPatch } = await server.ssrLoadModule('/src/collaborationLockPlan.ts');
  const normalized = normalizeAppData(payload({
    statusList: ['loading', 'to unload'],
    statusSupplement: '靠港補給後轉往下一港',
    captain: '王船長',
    chiefOfficer: '林大副',
    chiefEngineer: '陳輪機長',
    firstEngineer: '張大管輪',
  }));
  assert.ok(normalized, '含新增船舶資料的雲端 payload 必須可正規化');
  assert.deepEqual(normalized.vessels[0].note.statusList, ['loading', 'to unload'], '既有固定狀態陣列不得被自由文字取代');
  assert.equal(normalized.vessels[0].note.statusSupplement, '靠港補給後轉往下一港');
  assert.equal(normalized.vessels[0].note.captain, '王船長');
  assert.equal(normalized.vessels[0].note.chiefOfficer, '林大副');
  assert.equal(normalized.vessels[0].note.chiefEngineer, '陳輪機長');
  assert.equal(normalized.vessels[0].note.firstEngineer, '張大管輪');

  const legacy = normalizeAppData(payload({ statusList: [] }));
  assert.ok(legacy, '舊資料缺少新欄位時仍必須可載入');
  assert.equal(legacy.vessels[0].note.statusSupplement, '');
  assert.equal(legacy.vessels[0].note.captain, '');
  assert.equal(legacy.vessels[0].note.chiefOfficer, '');
  assert.equal(legacy.vessels[0].note.chiefEngineer, '');
  assert.equal(legacy.vessels[0].note.firstEngineer, '');

  for (const field of ['statusSupplement', 'captain', 'chiefOfficer', 'chiefEngineer', 'firstEngineer']) {
    assert.ok(types.includes(`${field}: string`), `VesselNote 必須正式宣告 ${field}`);
    assert.ok(editModals.includes(`target.note.${field} = value`), `快速更新必須把 ${field} 寫回同船 note`);
  }
  for (const label of ['船舶作業／動態補充', '船長', '大副', '輪機長', '大管輪']) {
    assert.ok(editModals.includes(label), `快速更新必須顯示「${label}」`);
  }
  assert.ok(editModals.includes('CheckboxMultiPicker label="船舶狀態"'), '六個既有快捷狀態必須保留多選操作');
  assert.ok(!editModals.includes('required={true}'), '快捷狀態與自由輸入都不得變成必填');

  const changed = structuredClone(legacy);
  changed.vessels[0].note.statusSupplement = '只輸入自由補充';
  changed.vessels[0].note.captain = '新船長';
  const operations = buildCloudBlockPatch(legacy, changed);
  const vesselOperation = operations.find(operation => operation.kind === 'entity' && operation.collection === 'vessels' && operation.entityId === 'v1');
  assert.ok(vesselOperation, '修改新增欄位必須產生同船的正式雲端 entity patch');
  assert.equal(vesselOperation.value.note.statusSupplement, '只輸入自由補充', '自由補充不得在雲端 patch 前被裁掉');
  assert.equal(vesselOperation.value.note.captain, '新船長', '船員姓名不得在雲端 patch 前被裁掉');
  assert.deepEqual(existingEntityLockKeysForPatch(operations), ['vessel:v1'], '新欄位保存必須要求精確單船協作鎖');

  console.log('Vessel status supplement, officer fields and normalization contracts passed.');
} finally {
  await server.close();
}
