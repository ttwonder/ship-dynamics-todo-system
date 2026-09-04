import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const module = await server.ssrLoadModule('/src/ItineraryReportDataView.tsx');
  const reports = Array.from({ length: 31 }, (_, index) => ({
    businessDate: new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
    timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z', generatedBy: 'scheduled',
    vesselCount: 39, rowCount: index, sourceMaxRevision: 9, logicalBytes: 1000 + index,
  }));
  const ownerMarkup = renderToStaticMarkup(React.createElement(module.ItineraryReportDataTable, {
    pageData: { items:reports.slice(0,30), page:1, pageSize:30, pageCount:2, total:31, setToken:'11111111111111111111111111111111' },
    owner: true, selectedReports: {}, setSelectedReports: () => {}, acting: false, pending: false,
    onDelete: () => {}, onPage: () => {},
  }));
  assert.match(ownerMarkup, /2026-09-04/);
  assert.match(ownerMarkup, /2026-08-06/);
  assert.doesNotMatch(ownerMarkup, /2026-08-05/, 'Itinerary data management page one must stop at 30 records');
  assert.match(ownerMarkup, /選擇刪除 2026-09-04/);
  assert.match(ownerMarkup, /勾選當頁全部/);
  assert.match(ownerMarkup, /第 1／2 頁/);
  assert.match(ownerMarkup, /只刪除每日報告快照/);
  assert.match(ownerMarkup, /不會刪除各船目前正式 Itinerary/);

  const adminMarkup = renderToStaticMarkup(React.createElement(module.ItineraryReportDataTable, {
    pageData: { items:reports.slice(0,30), page:1, pageSize:30, pageCount:2, total:31, setToken:'11111111111111111111111111111111' },
    owner: false, selectedReports: {}, setSelectedReports: () => {}, acting: false, pending: false,
    onDelete: () => {}, onPage: () => {},
  }));
  assert.match(adminMarkup, /管理員可查看；只有 Owner 可刪除/);
  assert.doesNotMatch(adminMarkup, /aria-label="選擇刪除 2026-09-04"/, 'admin must not receive delete checkboxes');

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
  assert.match(viewSource, /listItineraryDailyReportPage/);
  assert.match(viewSource, /expectedSetToken/);
  assert.doesNotMatch(viewSource, /paginateDailyReportHistory/);
  assert.doesNotMatch(viewSource, /sd_itinerary_main_save|sd_itinerary_documents/, 'data management must not mutate formal itinerary documents');

  console.log('itinerary_daily_report_data_management=PASS');
} finally {
  await server.close();
}
