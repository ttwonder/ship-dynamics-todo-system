import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root:process.cwd(), server:{ middlewareMode:true }, appType:'custom', logLevel:'silent' });
try {
  const module = await server.ssrLoadModule('/src/ManualItineraryReportSaveButton.tsx');
  const markup = renderToStaticMarkup(React.createElement(module.default, {
    actorUserId:'owner-1', onSaved:() => {},
  }));
  assert.match(markup, /手動保存目前 Itinerary/);
  assert.match(markup, /button/);

  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const component = fs.readFileSync('src/ManualItineraryReportSaveButton.tsx', 'utf8');
  const reportCenter = app.slice(app.indexOf('function ReportCenter('), app.indexOf('function valueOrDash('));
  const morningButton = reportCenter.indexOf('手動保存今日早會');
  const itineraryButton = reportCenter.indexOf('<ManualItineraryReportSaveButton');
  assert.ok(morningButton >= 0 && itineraryButton > morningButton && itineraryButton - morningButton < 900, 'manual Itinerary button must sit beside the morning save action');
  assert.match(reportCenter, /itineraryHistoryRefreshToken/);
  assert.match(reportCenter, /refreshToken=\{itineraryHistoryRefreshToken\}/);
  assert.match(reportCenter, /canSaveDailyMorning&&/);

  const submitSource = component.slice(component.indexOf('const submit = async'), component.indexOf('return <button'));
  const readIndex = submitSource.indexOf('readPendingManualItineraryReportSave');
  const createIndex = submitSource.indexOf('createPendingManualItineraryReportSave');
  const writeIndex = submitSource.indexOf('writePendingManualItineraryReportSave');
  const saveIndex = submitSource.indexOf('saveManualItineraryDailyReport');
  const clearIndex = submitSource.lastIndexOf('clearPendingManualItineraryReportSave');
  assert.ok(writeIndex >= 0 && saveIndex > writeIndex && clearIndex > saveIndex, 'manual save must durably record intent before RPC and clear only after confirmed result');
  assert.ok(readIndex >= 0 && createIndex > readIndex, 'submit must re-read durable pending before creating a new operation');
  assert.match(component, /readPendingManualItineraryReportSave/);
  assert.match(component, /ItineraryDailyReportRpcError/);
  assert.match(component, /onSaved/);

  console.log('manual_itinerary_report_button=PASS');
} finally {
  await server.close();
}
