import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const read = path => fs.readFileSync(path, 'utf8');
const typesSource = read('src/types.ts');
const normalizeSource = read('src/normalize.ts');
const modalSource = read('src/EditModals.tsx');
const detailSource = read('src/VesselDetailPage.tsx');
const appSource = read('src/App.tsx');
const dashboardSource = read('src/Dashboard.tsx');
const summarySource = read('src/VesselImportantSummary.tsx');
const styles = read('src/styles.css');

assert.match(typesSource, /maintenanceOverview:\s*string/, 'VesselNote 必須有可持久化的 maintenanceOverview');
assert.match(normalizeSource, /maintenanceOverview:\s*text\(note\.maintenanceOverview\)/, '舊資料正規化必須補空字串');
assert.ok(modalSource.includes('船舶保養維護概況') && modalSource.includes('maintenanceOverview'), '快速更新窗口缺少新欄位');
assert.ok(detailSource.includes('船舶保養維護概況') && detailSource.includes('maintenanceOverview'), '單船資訊窗口缺少新欄位');
assert.ok(appSource.includes('report-vessel-maintenance') && appSource.includes('maintenanceOverview'), '早會 PDF 動態資料下方缺少獨立保養區塊');
assert.ok(!dashboardSource.includes('maintenanceOverview'), '船隊看板單船卡片不得顯示保養概況');
assert.ok(!summarySource.includes('maintenanceOverview'), '重要摘要不得代替使用者要求而加入保養概況');
assert.match(styles, /\.vessel-maintenance-overview-field[^\n]*textarea/, '快速更新保養欄位缺少多行版面契約');
assert.match(styles, /\.report-vessel-maintenance[^\n]*grid-column:\s*1\s*\/\s*-1/, '早會 PDF 保養區塊必須獨立占滿動態資料欄寬');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const seed = await server.ssrLoadModule('/src/data/seed.ts');
  const { VesselReportInfo } = await server.ssrLoadModule('/src/App.tsx');
  const normalize = await server.ssrLoadModule('/src/normalize.ts');
  const draft = await server.ssrLoadModule('/src/vesselOperationalDraft.ts');
  const blockPatch = await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const base = seed.createInitialData();
  assert.ok(base.vessels.length > 0, '測試資料缺少船舶');
  assert.equal(base.vessels[0].note.maintenanceOverview, '', '新船舶保養概況預設必須為空字串');

  const legacy = structuredClone(base);
  delete legacy.vessels[0].note.maintenanceOverview;
  const normalized = normalize.normalizeAppData(legacy);
  assert.ok(normalized, '舊資料必須仍可正規化');
  assert.equal(normalized.vessels[0].note.maintenanceOverview, '', '舊資料讀入時必須補空字串');

  const next = structuredClone(base);
  next.vessels[0].note.maintenanceOverview = '主機二號缸排氣閥預計下港保養';
  const reportMarkup = renderToStaticMarkup(React.createElement(VesselReportInfo, { v: next.vessels[0] }));
  assert.ok(reportMarkup.includes('船舶保養維護概況') && reportMarkup.includes('主機二號缸排氣閥預計下港保養'), '早會 PDF 投影必須輸出獨立保養區塊與內容');
  const emptyReportMarkup = renderToStaticMarkup(React.createElement(VesselReportInfo, { v: base.vessels[0] }));
  assert.match(emptyReportMarkup, /report-vessel-maintenance[\s\S]*?<span>-<\/span>/, '保養概況空值在 PDF 必須顯示「-」');
  const target = structuredClone(base.vessels[0]);
  draft.applyVesselOperationalDraft(target, next.vessels[0], '2026-08-25T01:00:00.000Z');
  assert.equal(target.note.maintenanceOverview, '主機二號缸排氣閥預計下港保養', '快速更新套用時不得遺失新欄位');
  assert.equal(draft.vesselOperationalDraftEquals(target, next.vessels[0]), true, '草稿相等判定必須涵蓋新欄位');

  const operations = blockPatch.buildCloudBlockPatch(base, next, base);
  const vesselOperation = operations.find(operation => operation.kind === 'entity' && operation.collection === 'vessels' && operation.entityId === base.vessels[0].id);
  assert.ok(vesselOperation && vesselOperation.value?.note?.maintenanceOverview === '主機二號缸排氣閥預計下港保養', '雲端 vessel patch 必須持久保存新欄位');
} finally {
  await server.close();
}
console.log('PASS vessel maintenance overview contract');
