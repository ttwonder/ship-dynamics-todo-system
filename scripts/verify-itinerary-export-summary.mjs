import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { createBlankItineraryRow, createEmptyItineraryDocument } = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const { default: Preview } = await server.ssrLoadModule('/src/ItineraryDailyReportPreview.tsx');
  const first = Object.assign(createBlankItineraryRow('first', 0), {
    previousPortName: 'QA-PREVIOUS', portDockName: 'QA-NEXT', voyageNumber: 'QA-001',
    portTimeZone: 'UTC+9', etaTimeZone: 'UTC+10', calculationStartTimeZone: 'UTC+5:45',
    calculationStartUtc: '2026-09-17T00:00:00Z', etaUtc: '2026-09-17T06:00:00Z',
    etdUtc: '2026-09-17T07:00:00Z',
    currentVesselState: { location: 'QA-AREA 測試海域', navigationStatus: '航行', loadStatus: '滿載', statusList: ['drydock/repiar', 'bunker'] },
  });
  const second = Object.assign(createBlankItineraryRow('second', 1), {
    previousPortName: 'WRONG-PREVIOUS', portDockName: 'QA-SECOND', calculationStartTimeZone: 'UTC-4',
    currentVesselState: { location: 'WRONG-AREA', navigationStatus: '停泊', loadStatus: '空載', statusList: ['loading'] },
  });
  const formal = createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'qa-vessel', vesselName: '測試船 QA VESSEL', rowId: 'unused' });
  formal.rows = [second, first]; // Physical array order is not the formal first-row order.
  formal.revision = 7;
  formal.updatedAt = '2026-09-17T01:00:00Z';
  const snapshotVessel = { vesselId: formal.vesselId, vesselName: formal.vesselName, revision: formal.revision, updatedAt: formal.updatedAt, rows: structuredClone(formal.rows) };
  const longVessel = structuredClone(snapshotVessel);
  longVessel.vesselId = 'qa-long';
  longVessel.vesselName = '長內容測試 QA LONG VESSEL';
  longVessel.rows = [structuredClone(first)];
  longVessel.rows[0].currentVesselState.location = '北太平洋測試海域 LONG-AREA '.repeat(8).trim();
  longVessel.rows[0].currentVesselState.statusList = ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar', 'bunker'];
  const legacyVessel = { ...snapshotVessel, vesselId: 'qa-legacy', vesselName: 'QA LEGACY', rows: [createBlankItineraryRow('legacy', 0)] };
  delete legacyVessel.rows[0].currentVesselState;
  const vessels = [snapshotVessel, longVessel, legacyVessel, { ...legacyVessel, vesselId: 'qa-empty', vesselName: 'QA EMPTY', rows: [] }];
  const report = {
    reportId: 'qa-report', businessDate: '2026-09-17', generatedAt: '2026-09-17T01:00:00Z', generatedBy: 'scheduled',
    vesselCount: vessels.length, rowCount: vessels.reduce((sum, vessel) => sum + vessel.rows.length, 0), sourceMaxRevision: 7,
    snapshot: { schemaVersion: 1, businessDate: '2026-09-17', timezone: 'Asia/Taipei', generatedAt: '2026-09-17T01:00:00Z', vessels },
  };
  const before = JSON.stringify(report);
  const markup = renderToStaticMarkup(React.createElement(Preview, { report, close() {} }));
  const headers = [...markup.matchAll(/<section class="itinerary-daily-report-vessel"><header>([\s\S]*?)<\/header>/g)].map(match => match[1].replace(/<[^>]*>/g, ''));
  assert.equal(headers.length, vessels.length);
  const expected = ['目前位置：QA-AREA 測試海域', '現在所處時區：UTC+5:45', '目前航行狀態：航行', '目前載況：滿載', '目前船舶狀態：drydock/repair、bunker', '上一港：QA-PREVIOUS'];
  for (const value of expected) assert.ok(headers[0].includes(value), `PDF vessel header must include ${value}`);
  assert.equal(headers[0].match(/目前位置：/g)?.length, 1, 'do not duplicate location');
  assert.ok(!/WRONG-|UTC\+9|UTC\+10|UTC-4/.test(headers[0]), 'metadata uses the formal first row and current offset, not destination offset or second row');
  for (const header of headers.slice(2)) {
    assert.equal(header.match(/未填/g)?.length, 6, 'missing values stay explicit; no fallback to another vessel or current master data');
  }
  assert.equal(JSON.stringify(report), before, 'rendering must not mutate archived snapshots');
  formal.rows[1].currentVesselState.location = 'LIVE-CHANGED';
  assert.equal(renderToStaticMarkup(React.createElement(Preview, { report, close() {} })), markup, 'later live changes cannot rewrite an earlier report');
  formal.rows[1].currentVesselState.location = 'QA-AREA 測試海域';
  if (process.env.ITINERARY_EXPORT_QA_DIR) {
    const directory = process.env.ITINERARY_EXPORT_QA_DIR;
    await fs.mkdir(directory, { recursive: true });
    const css = await fs.readFile('src/styles.css', 'utf8');
    await fs.writeFile(path.join(directory, 'daily-report.html'), `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>${css}</style><body class="printing-itinerary-daily-report">${markup}</body></html>`);
  }
  const { default: ExcelJS } = await import('exceljs');
  const { buildItineraryWorkbook, buildItineraryWorkbookWithAlternatives, parseItineraryWorkbook } = await server.ssrLoadModule('/src/itinerary/itineraryExcel.ts');
  const templateBytes = await fs.readFile('public/templates/itinerary-template-v1.xlsx');
  const template = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength);
  const inputBefore = JSON.stringify(formal);
  const output = await buildItineraryWorkbook([formal], template);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  const sheet = workbook.worksheets[0];
  for (const value of expected) assert.ok(sheet.getCell('C2').text.includes(value), `Excel visible header must include ${value}`);
  assert.equal(sheet.getCell('A2').text, 'Vsl name: 測試船 QA VESSEL');
  assert.equal(sheet.getCell('A3').text, 'Voy No.');
  assert.equal(sheet.getCell('B4').text, 'QA-SECOND', 'existing body order/row coordinates must not change');
  assert.equal(sheet.pageSetup.printArea, 'A1:N7', 'summary must be inside the existing print area');
  assert.equal(sheet.pageSetup.printTitlesRow, '1:3');
  assert.equal(JSON.stringify(formal), inputBefore, 'export must not mutate the formal document');
  const imported = await parseItineraryWorkbook(output);
  assert.equal(imported.sheets[0].rows.length, 2, 'metadata band must not become an itinerary row');
  const combined = { ...formal, alternativePlans: [{ id: 'alt-1', sortOrder: 0, name: '備選', rows: [structuredClone(second)] }] };
  const combinedOutput = await buildItineraryWorkbookWithAlternatives(combined, template);
  const combinedWorkbook = new ExcelJS.Workbook();
  await combinedWorkbook.xlsx.load(combinedOutput);
  assert.equal(combinedWorkbook.worksheets.length, 3);
  for (const candidate of combinedWorkbook.worksheets.slice(0, 2)) {
    for (const value of expected) assert.ok(candidate.getCell('C2').text.includes(value), 'current ship metadata stays formal-owned on alternative sheets');
  }
  assert.equal(combinedWorkbook.worksheets[2].getCell('J3').text, '', 'alternative import metadata retains its previous-port exclusion');
  const metadataOnly = { ...formal, rows: [Object.assign(createBlankItineraryRow('only', 0), { currentVesselState: structuredClone(first.currentVesselState) })] };
  const extraOutput = await buildItineraryWorkbook([
    metadataOnly,
    { ...formal, vesselId: 'empty', vesselName: 'QA EMPTY', rows: [] },
    { ...formal, ...longVessel },
  ], template);
  const extraWorkbook = new ExcelJS.Workbook();
  await extraWorkbook.xlsx.load(extraOutput);
  assert.ok(extraWorkbook.worksheets[0].getCell('C2').text.includes('目前位置：QA-AREA 測試海域'), 'filtering blank body rows cannot discard header state');
  assert.equal(extraWorkbook.worksheets[1].getCell('C2').text.match(/未填/g)?.length, 6);
  assert.ok(extraWorkbook.worksheets[2].getRow(2).height > sheet.getRow(2).height, 'long metadata gets additional wrapped space');
  const portal = await fs.readFile('src/itinerary/ShipItineraryPortal.tsx', 'utf8');
  const dashboard = await fs.readFile('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  assert.match(portal, /await downloadItineraryWorkbook\(\[document\], fileName\)/);
  assert.match(portal, /await downloadItineraryWorkbookWithAlternatives\(document, fileName\)/);
  assert.match(dashboard, /await downloadItineraryWorkbook\(selectedDocuments,/);
  if (process.env.ITINERARY_EXPORT_QA_DIR) {
    await fs.writeFile(path.join(process.env.ITINERARY_EXPORT_QA_DIR, 'itinerary-summary.xlsx'), Buffer.from(extraOutput));
    await fs.writeFile(path.join(process.env.ITINERARY_EXPORT_QA_DIR, 'itinerary-alternatives.xlsx'), Buffer.from(combinedOutput));
  }
  console.log('PASS daily PDF and Excel six-field headers, first-row/current-offset selection, legacy/empty/long data, formal-owned alternatives, unchanged snapshot/import/body contracts');
} finally {
  await server.close();
}
