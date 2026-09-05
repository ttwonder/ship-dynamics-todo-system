import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const module = await server.ssrLoadModule('/src/ItineraryReportDataView.tsx');
  const reports = Array.from({ length: 31 }, (_, index) => ({
    reportId:String(index + 10),
    businessDate: new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
    timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z', generatedBy: 'scheduled', generatedByActorId:null,
    vesselCount: 39, rowCount: index, sourceMaxRevision: 9, logicalBytes: 1000 + index,
  }));
  const manual = { ...reports[0], reportId:'2', generatedAt:'2026-09-04T03:15:00Z', generatedBy:'manual', generatedByActorId:'owner-1' };
  const pageItems = [manual, ...reports.slice(0,30)];
  const ownerMarkup = renderToStaticMarkup(React.createElement(module.ItineraryReportDataTable, {
    pageData: { items:pageItems, page:1, pageSize:30, pageCount:2, total:31, dateTotal:31, reportTotal:32, setToken:'11111111111111111111111111111111' },
    owner: true, selectedReports: {}, setSelectedReports: () => {}, acting: false, pending: false,
    onDelete: () => {}, onPage: () => {},
  }));
  assert.match(ownerMarkup, /2026-09-04/);
  assert.match(ownerMarkup, /2026-08-06/);
  assert.doesNotMatch(ownerMarkup, /2026-08-05/, 'Itinerary data management page one must stop at 30 records');
  assert.match(ownerMarkup, /選擇刪除快照 2/);
  assert.match(ownerMarkup, /選擇刪除快照 10/);
  assert.match(ownerMarkup, /手動保存/);
  assert.match(ownerMarkup, /09:00自動/);
  assert.match(ownerMarkup, /共 31 天/);
  assert.match(ownerMarkup, /全部 32 份/);
  assert.match(ownerMarkup, /勾選當頁全部/);
  assert.match(ownerMarkup, /第 1／2 頁/);
  assert.match(ownerMarkup, /只刪除所選報告快照/);
  assert.match(ownerMarkup, /不會刪除同一天其他快照、各船目前正式 Itinerary/);

  const adminMarkup = renderToStaticMarkup(React.createElement(module.ItineraryReportDataTable, {
    pageData: { items:pageItems, page:1, pageSize:30, pageCount:2, total:31, dateTotal:31, reportTotal:32, setToken:'11111111111111111111111111111111' },
    owner: false, selectedReports: {}, setSelectedReports: () => {}, acting: false, pending: false,
    onDelete: () => {}, onPage: () => {},
  }));
  assert.match(adminMarkup, /管理員可查看；只有 Owner 可刪除/);
  assert.doesNotMatch(adminMarkup, /aria-label="選擇刪除快照 2"/, 'admin must not receive delete checkboxes');

  const legacyPendingMarkup = renderToStaticMarkup(React.createElement(module.ItineraryReportLegacyPendingDeleteNotice, {
    pending:{
      version:2, operationId:'33333333-3333-4333-8333-333333333333', actorUserId:'owner-1',
      configIdentity:'test', workspaceKey:'workspace-a', expectedSetToken:'11111111111111111111111111111111',
      deleteDates:['2026-09-03','2026-09-04'], createdAt:'2026-09-04T04:00:00.000Z',
    },
    acting:false,
    onReconcile:() => {},
  }));
  assert.match(legacyPendingMarkup, /舊版本 Itinerary 快照刪除結果尚未確認/);
  assert.match(legacyPendingMarkup, /預定刪除 2 個日期/);
  assert.match(legacyPendingMarkup, /對帳舊版本操作/);

  const panelSource = fs.readFileSync('src/DataManagementPanel.tsx', 'utf8');
  const viewSource = fs.readFileSync('src/ItineraryReportDataView.tsx', 'utf8');
  assert.match(panelSource, /type DataView = 'overview' \| 'items' \| 'history' \| 'itinerary'/);
  assert.match(panelSource, /<ItineraryReportDataView currentUser=\{currentUser\}\/>/);
  assert.match(panelSource, /Itinerary 日快照/);
  assert.match(viewSource, /window\.confirm/);
  assert.match(viewSource, /createPendingItineraryDailyReportDelete/);
  assert.match(viewSource, /writePendingItineraryDailyReportDelete/);
  assert.match(viewSource, /deleteItineraryDailyReports/);
  assert.match(viewSource, /readPendingItineraryDailyReportDelete/);
  assert.match(viewSource, /clearPendingItineraryDailyReportDelete/);
  assert.match(viewSource, /readPendingLegacyItineraryDailyReportDelete/);
  assert.match(viewSource, /reconcileLegacyItineraryDailyReportDelete/);
  assert.match(viewSource, /clearPendingLegacyItineraryDailyReportDelete/);
  assert.match(viewSource, /<ItineraryReportLegacyPendingDeleteNotice/);
  assert.match(viewSource, /listItineraryDailyReportPage/);
  assert.match(viewSource, /expectedSetToken/);
  assert.match(viewSource, /deleteReportIds/);
  assert.doesNotMatch(viewSource, /paginateDailyReportHistory/);
  assert.doesNotMatch(viewSource, /sd_itinerary_main_save|sd_itinerary_documents/, 'data management must not mutate formal itinerary documents');

  console.log('itinerary_daily_report_data_management=PASS');
} finally {
  await server.close();
}
