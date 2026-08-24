import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const workCenter = fs.readFileSync('src/WorkCenter.tsx', 'utf8');
const vesselDetail = fs.readFileSync('src/vesselDetail.ts', 'utf8');
const vesselDetailPage = fs.readFileSync('src/VesselDetailPage.tsx', 'utf8');
const internalControlPage = fs.readFileSync('src/InternalControlPage.tsx', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { compareCreatedNewestFirst, sortRecordsNewestCreated } = await server.ssrLoadModule('/src/recordSorting.ts');
  const records = [
    { id:'legacy-z', createdAt:'', updatedAt:'2099-01-01T00:00:00.000Z' },
    { id:'older', createdAt:'2026-07-01T00:00:00.000Z', updatedAt:'2099-01-01T00:00:00.000Z' },
    { id:'same-b', createdAt:'2026-08-05T08:00:00.000Z', updatedAt:'2026-08-05T08:00:00.000Z' },
    { id:'invalid-a', createdAt:'not-a-date', updatedAt:'2099-01-01T00:00:00.000Z' },
    { id:'same-a', createdAt:'2026-08-05T08:00:00.000Z', updatedAt:'2020-01-01T00:00:00.000Z' },
  ];
  const originalIds = records.map(item => item.id);
  assert.deepEqual(sortRecordsNewestCreated(records).map(item => item.id), ['same-a','same-b','older','invalid-a','legacy-z'], '最新建立需在前；同時刻與舊資料都必須用固定ID穩定排序');
  assert.deepEqual(records.map(item => item.id), originalIds, '共用排序不得直接改動來源陣列');
  assert.ok(compareCreatedNewestFirst(records[4], records[1]) < 0, 'updatedAt不得讓舊項目跳到新建立項目前面');

  assert.ok(app.includes('sortRecordsNewestCreated') && app.includes('const closedTasks'), '總清單與已結案清單必須接入共用建立時間排序');
  assert.ok(workCenter.includes("type TaskSort='created-desc'") && workCenter.includes("useState<TaskSort>('created-desc')"), '我的待辦預設必須是最新建立');
  assert.ok(workCenter.includes('compareCreatedNewestFirst'), '我的待辦混合要事／內控資料必須用同一個建立時間比較器');
  assert.ok(vesselDetail.includes("VesselTaskSort = 'created-desc'"), '單船要事清單必須提供最新建立排序');
  assert.ok(vesselDetailPage.includes("useState<VesselTaskSort>('created-desc')"), '單船要事清單預設必須是最新建立');
  assert.ok(internalControlPage.includes("useState<ListColumnSort>('created-desc')") && /sortListRecords\(\s*filterInternalControlCases/.test(internalControlPage), '內控未完／結案清單必須預設按最新建立，並支援同一排序器切換欄位');
  assert.ok(meetings.includes('sortRecordsNewestCreated(data.meetings.filter(appliesToUser))'), '臨會／專題清單必須預設按最新建立');
} finally {
  await server.close();
}

console.log('Created-at newest-first list sorting contracts passed.');
