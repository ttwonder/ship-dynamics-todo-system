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
  const pdf = await server.ssrLoadModule('/src/itineraryDailyReportPdf.ts');

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
    reportId: String(index + 10),
    businessDate: new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
    timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z', generatedBy: 'scheduled', generatedByActorId:null,
    vesselCount: 39, rowCount: index, sourceMaxRevision: 7, logicalBytes: 1000,
  }));
  itineraryReports.splice(1, 0, {
    ...itineraryReports[0], reportId:'2', generatedAt:'2026-09-04T03:15:00Z',
    generatedBy:'manual', generatedByActorId:'owner-1', rowCount:99,
  });
  const itineraryMarkup = renderToStaticMarkup(React.createElement(histories.ItineraryDailyHistoryPanel, {
    pageData: {
      items: itineraryReports.slice(0, 31), page:1, pageSize:30, pageCount:2, total:31, dateTotal:31, reportTotal:32,
      setToken:'11111111111111111111111111111111',
    },
    loading: false,
    errorText: '',
    openingReportId: '',
    onRefresh: () => {},
    onPage: () => {},
    onLocate: async () => true,
    onOpen: () => {},
  }));
  assert.match(itineraryMarkup, /2026年9月4日 Itinerary/);
  assert.match(itineraryMarkup, /2026年8月6日 Itinerary/);
  assert.doesNotMatch(itineraryMarkup, /2026年8月5日 Itinerary/, 'Itinerary history page one must stop at 30 dates');
  assert.match(itineraryMarkup, /aria-label="每日 Itinerary 記錄日期"/);
  assert.match(itineraryMarkup, /檢視橫版 PDF/);
  assert.match(itineraryMarkup, /手動保存/);
  assert.match(itineraryMarkup, /09:00 自動/);
  assert.equal((itineraryMarkup.match(/2026年9月4日 Itinerary/g) || []).length, 1, 'same-day snapshots must share one date group');
  assert.match(itineraryMarkup, /第 1／2 頁/);

  const report = {
    reportId:'2',
    businessDate: '2026-09-04', timezone: 'Asia/Taipei', generatedAt: '2026-09-04T01:00:00Z',
    generatedBy: 'scheduled', generatedByActorId:null, vesselCount: 2, rowCount: 1, sourceMaxRevision: 7, logicalBytes: 1000,
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

  const manualReport = { ...report, reportId:'3', generatedAt:'2026-09-04T03:15:09Z', generatedBy:'manual', generatedByActorId:'owner-1' };
  const manualPreviewMarkup = renderToStaticMarkup(React.createElement(preview.default, { report:manualReport, close:() => {} }));
  assert.match(manualPreviewMarkup, /<dt>產生方式<\/dt><dd>手動保存<\/dd>/);
  assert.doesNotMatch(manualPreviewMarkup, /<dt>產生方式<\/dt><dd>09:00 自動<\/dd>/);
  assert.match(manualPreviewMarkup, /手動建立/);
  assert.equal(
    pdf.itineraryDailyReportPdfTitle('2026-09-04','2026-09-04T03:15:09Z','manual','3'),
    '每日正式 Itinerary_2026-09-04_111509_手動_R3',
  );

  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const source = fs.readFileSync('src/ReportDailyHistories.tsx', 'utf8');
  const buttonSource = fs.readFileSync('src/ManualItineraryReportSaveButton.tsx', 'utf8');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert.match(app, /<ReportDailyHistories/);
  assert.doesNotMatch(app, /<h2>本次報告內容<\/h2>/, 'the old report-content block must be removed');
  assert.match(app, /每日 Itinerary 每天 09:00/);
  assert.match(app, /ManualItineraryReportSaveButton/);
  assert.match(buttonSource, /手動保存目前 Itinerary/);
  assert.match(app, /itineraryHistoryRefreshToken/);
  assert.match(source, /listItineraryDailyReportPage/);
  assert.match(source, /locateItineraryDailyReport/);
  assert.match(source, /p_page_size|pageSize:30|pageSize: 30/);
  assert.match(css, /body\.printing-itinerary-daily-report/);
  assert.match(css, /size:A4 landscape|size: A4 landscape/);
  assert.match(css, /\.itinerary-daily-report-vessel\{[^}]*break-inside:avoid-page/);
  assert.match(css, /\.itinerary-report-date-group\{/);
  assert.match(css, /\.itinerary-daily-report-shell\{width:min\(1720px,100%\)/, 'PDF shell must size against its padded modal parent, not viewport width');
  assert.match(css, /\.itinerary-daily-report-paper\{width:min\(1580px,100%\);min-width:1180px/, 'desktop PDF metadata must remain inside the modal');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['test:itinerary-daily-reports'], 'node scripts/verify-daily-report-history-pagination.mjs && node scripts/verify-itinerary-daily-reports-client.mjs && node scripts/verify-itinerary-daily-reports-db.mjs && node scripts/verify-manual-itinerary-daily-reports-db.mjs && node scripts/verify-itinerary-daily-reports-ui.mjs && node scripts/verify-itinerary-daily-report-data-management.mjs && node scripts/verify-manual-itinerary-report-button.mjs');
  assert.match(packageJson.scripts['test:itinerary'], /npm run test:itinerary-daily-reports/);

  console.log('itinerary_daily_reports_ui=PASS');
} finally {
  await server.close();
}
