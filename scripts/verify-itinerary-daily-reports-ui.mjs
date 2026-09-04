import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const histories = await server.ssrLoadModule('/src/ReportDailyHistories.tsx');
  const preview = await server.ssrLoadModule('/src/ItineraryDailyReportPreview.tsx');

  const morningReports = Array.from({ length: 31 }, (_, index) => ({
    id: `morning-${index}`,
    kind: 'daily-morning',
    title: `MORNING DAY ${index}`,
    businessDate: new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
    createdAt: '2026-09-04T01:00:00Z',
    updatedAt: '2026-09-04T01:00:00Z',
    source: 'scheduled',
    vesselIds: ['v1'],
    taskCount: index,
  }));
  morningReports.push({
    id: 'undated-report',
    kind: 'manual',
    title: '一般報告（無每日日期）',
    createdAt: '2026-09-04T01:00:00Z',
    updatedAt: '2026-09-04T01:00:00Z',
    source: 'manual',
    vesselIds: [],
    taskCount: 0,
  });
  const morningMarkup = renderToStaticMarkup(React.createElement(histories.MorningDailyHistoryPanel, {
    reports: morningReports,
    onOpen: () => {},
  }));
  assert.match(morningMarkup, /MORNING DAY 0/);
  assert.match(morningMarkup, /MORNING DAY 29/);
  assert.doesNotMatch(morningMarkup, /MORNING DAY 30/, 'morning history page one must stop at 30 dates');
  assert.match(morningMarkup, /aria-label="每日早會歷史日期"/);
  assert.match(morningMarkup, /定位日期/);
  assert.match(morningMarkup, /第 1／2 頁/);

  const itineraryReports = Array.from({ length: 31 }, (_, index) => ({
    businessDate: new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
    timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z', generatedBy: 'scheduled',
    vesselCount: 39, rowCount: index, sourceMaxRevision: 7, logicalBytes: 1000,
  }));
  const itineraryMarkup = renderToStaticMarkup(React.createElement(histories.ItineraryDailyHistoryPanel, {
    reports: itineraryReports,
    loading: false,
    errorText: '',
    openingDate: '',
    onRefresh: () => {},
    onOpen: () => {},
  }));
  assert.match(itineraryMarkup, /2026年9月4日 Itinerary/);
  assert.match(itineraryMarkup, /2026年8月6日 Itinerary/);
  assert.doesNotMatch(itineraryMarkup, /2026年8月5日 Itinerary/, 'Itinerary history page one must stop at 30 dates');
  assert.match(itineraryMarkup, /aria-label="每日 Itinerary 記錄日期"/);
  assert.match(itineraryMarkup, /檢視橫版 PDF/);
  assert.match(itineraryMarkup, /第 1／2 頁/);

  const report = {
    businessDate: '2026-09-04', timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z',
    generatedBy: 'scheduled', vesselCount: 2, rowCount: 1, sourceMaxRevision: 7, logicalBytes: 1000,
    snapshot: {
      schemaVersion: 1, businessDate: '2026-09-04', timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z',
      vesselCount: 2, rowCount: 1, sourceMaxRevision: 7,
      vessels: [
        {
          vesselId: 'v1', vesselName: 'FPMC ALPHA', revision: 7, updatedAt: '2026-09-04T00:30:00Z',
          rows: [{
            rowId: 'formal-row', sortOrder: 0, previousPortName: 'BUSAN', voyageNumber: 'V001',
            portDockName: 'KAOHSIUNG / PIER 8', operation: 'To Load / inspection', cargoQuantityText: '12,000 MT',
            etaUtc: '2026-09-04T02:00:00Z', etbUtc: '2026-09-04T03:00:00Z', ldRateText: '500 MT/h',
            etcUtc: '2026-09-04T12:00:00Z', etdUtc: '2026-09-04T13:00:00Z',
            arrivalDraftText: 'A: 8.0 / F: 8.2', departureDraftText: 'A: 9.0 / F: 9.2',
            arrivalRobText: 'FO 120 / DO 30', departureRobText: 'FO 90 / DO 25', notesText: 'FORMAL NOTE',
            portTimeZone: 'UTC+8', etaTimeZone: 'UTC+8', etbTimeZone: 'UTC+8', etcTimeZone: 'UTC+8', etdTimeZone: 'UTC+8',
            calculationStartUtc: null, calculationStartTimeZone: 'UTC+8', oceanDistanceNm: 700, speedKnots: 12,
            sailingHours: 58, berthWaitHours: 4, channelSailingHours: 2, preCompletionDelayHours: 1,
            postCompletionDelayHours: 2, tanksText: '1P/1S', operationQuantityMt: 12000,
            operationRateMtPerHour: 500, operationHours: 24, departureBufferDays: 0.5,
            etaMode: 'manual', etbMode: 'manual', etcMode: 'manual', etdMode: 'manual',
          }],
        },
        { vesselId: 'v2', vesselName: 'FPMC BETA', revision: 0, updatedAt: null, rows: [] },
      ],
    },
  };
  const previewMarkup = renderToStaticMarkup(React.createElement(preview.default, {
    report,
    close: () => {},
  }));
  for (const expected of [
    '每日正式 Itinerary 匯整', 'FPMC ALPHA', 'FPMC BETA', 'BUSAN', 'KAOHSIUNG / PIER 8',
    'To Load / inspection', '12,000 MT', 'FORMAL NOTE', '無正式 Itinerary 內容', 'A4 橫向',
    'Draft (Arr → Dep)', 'ROB (Arr → Dep)',
  ]) assert.ok(previewMarkup.includes(expected), `missing rendered Itinerary PDF content: ${expected}`);
  assert.doesNotMatch(previewMarkup, /<th>Arr Draft<\/th>|<th>Dep Draft<\/th>|<th>Arr ROB<\/th>|<th>Dep ROB<\/th>/);
  assert.doesNotMatch(previewMarkup, /Owner Test|查看者/, 'daily PDF must not vary with the current viewer');
  assert.doesNotMatch(previewMarkup, /alternativePlans|FORBIDDEN ALT/, 'daily PDF must remain formal-only');

  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const source = fs.readFileSync('src/ReportDailyHistories.tsx', 'utf8');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert.match(app, /<ReportDailyHistories/);
  assert.doesNotMatch(app, /<h2>本次報告內容<\/h2>/, 'the old report-content block must be removed');
  assert.match(app, /每日 Itinerary 每天 09:00/);
  assert.match(source, /paginateDailyReportHistory\(reports/);
  assert.match(source, /locateDailyReportDate\(reports/);
  assert.match(css, /body\.printing-itinerary-daily-report/);
  assert.match(css, /size:A4 landscape|size: A4 landscape/);
  assert.match(css, /\.itinerary-daily-report-vessel\{[^}]*break-inside:avoid-page/);
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['test:itinerary-daily-reports'], 'node scripts/verify-daily-report-history-pagination.mjs && node scripts/verify-itinerary-daily-reports-client.mjs && node scripts/verify-itinerary-daily-reports-db.mjs && node scripts/verify-itinerary-daily-reports-ui.mjs && node scripts/verify-itinerary-daily-report-data-management.mjs');
  assert.match(packageJson.scripts['test:itinerary'], /npm run test:itinerary-daily-reports/);

  console.log('itinerary_daily_reports_ui=PASS');
} finally {
  await server.close();
}
