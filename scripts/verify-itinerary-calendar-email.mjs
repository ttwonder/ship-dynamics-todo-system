import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const calendar = await server.ssrLoadModule('/src/itinerary/itineraryCalendarModel.ts');
  const calendarView = await server.ssrLoadModule('/src/itinerary/ItineraryCalendar.tsx');
  const email = await server.ssrLoadModule('/src/itinerary/itineraryEmail.ts');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const doc = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v1', vesselName: 'TEST VESSEL', rowId: 'r1' });
  Object.assign(doc.rows[0], { voyageNumber: 'V001', portDockName: 'ULSAN', operation: 'To Load', etaUtc: '2026-09-01T00:00:00Z', etdUtc: '2026-09-03T00:00:00Z', portTimeZone: 'UTC+9' });
  const range = calendar.calendarRangeFromLocalDate('2026-09-01', 7, 'UTC+8');
  assert.equal(range.ok, true);
  const entries = calendar.buildItineraryCalendarEntries([doc], range.startInstant, range.endInstant);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].leftPercent, 8 / (7 * 24) * 100); // Taipei midnight is 16:00Z; event starts eight hours later
  assert.ok(entries[0].widthPercent > 28 && entries[0].widthPercent < 29);
  assert.equal(calendar.calendarRangeFromLocalDate('2026-09-01', 7, 'UTC+5:45').ok, true);
  assert.equal(calendar.calendarRangeFromLocalDate('2026-09-01', 7, 'GMT+8').ok, false);

  const sequential = types.createBlankItineraryRow('r2', 1);
  Object.assign(sequential, { voyageNumber: 'V002', etaUtc: '2026-09-03T00:00:00Z', etdUtc: '2026-09-04T00:00:00Z' });
  const overlapping = types.createBlankItineraryRow('r3', 2);
  Object.assign(overlapping, { voyageNumber: 'V003', etaUtc: '2026-09-02T12:00:00Z', etdUtc: '2026-09-03T12:00:00Z' });
  const tripleOverlap = types.createBlankItineraryRow('r5', 3);
  Object.assign(tripleOverlap, { voyageNumber: 'V004', etaUtc: '2026-09-02T18:00:00Z', etdUtc: '2026-09-02T21:00:00Z' });
  doc.rows.push(sequential, overlapping, tripleOverlap);
  const secondDoc = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v2', vesselName: 'SECOND VESSEL', rowId: 'r4' });
  Object.assign(secondDoc.rows[0], { etaUtc: '2026-10-01T00:00:00Z', etdUtc: '2026-10-02T00:00:00Z' });
  const lanes = calendar.buildItineraryCalendarLanes([doc, secondDoc], range.startInstant, range.endInstant);
  assert.deepEqual(lanes.map(lane => [lane.vesselId, lane.vesselName]), [['v1', 'TEST VESSEL'], ['v2', 'SECOND VESSEL']], 'every selected vessel needs one lane even without an event in range');
  assert.equal(lanes[0].events.length, 4);
  assert.deepEqual(lanes[0].events.map(event => [event.row.rowId, event.layer]), [['r1', 0], ['r3', 1], ['r5', 2], ['r2', 0]], 'only overlapping events should move to a higher sub-layer, and a later non-overlapping event should reuse the base layer');
  assert.equal(lanes[0].layerCount, 3, 'vessel lane height must follow arbitrary maximum overlap depth');
  assert.equal(lanes[1].events.length, 0);
  assert.equal(lanes[1].layerCount, 1, 'an empty selected vessel still needs one base-height lane');

  const now = Date.now();
  const renderedFirst = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'render-v1', vesselName: 'FIRST VESSEL', rowId: 'render-r1' });
  Object.assign(renderedFirst.rows[0], { voyageNumber: 'NOW-1', etaUtc: new Date(now).toISOString(), etdUtc: new Date(now + 48 * 60 * 60 * 1000).toISOString() });
  const renderedOverlap = types.createBlankItineraryRow('render-r2', 1);
  Object.assign(renderedOverlap, { voyageNumber: 'NOW-2', etaUtc: new Date(now + 24 * 60 * 60 * 1000).toISOString(), etdUtc: new Date(now + 72 * 60 * 60 * 1000).toISOString() });
  renderedFirst.rows.push(renderedOverlap);
  const renderedSecond = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'render-v2', vesselName: 'SECOND VESSEL', rowId: 'render-empty' });
  const calendarHtml = renderToStaticMarkup(React.createElement(calendarView.default, { documents: [renderedFirst, renderedSecond] }));
  assert.equal((calendarHtml.match(/class="itinerary-calendar-row"/g) || []).length, 2, 'two selected vessels must render exactly two vessel rows');
  assert.match(calendarHtml, /FIRST VESSEL/);
  assert.match(calendarHtml, /SECOND VESSEL/);
  assert.doesNotMatch(calendarHtml, /#1|#2/, 'port-order labels must not split one vessel into separate rows');
  assert.match(calendarHtml, />96px</, 'calendar default day width must be 96px');
  assert.match(calendarHtml, /min-height:68px/, 'two overlapping events must expand only their vessel lane');
  assert.match(calendarHtml, /top:36px/, 'the overlapping event must render in the second sub-layer');

  const compactCss = fs.readFileSync('src/itinerary/itineraryCompact.css', 'utf8');
  assert.match(compactCss, /\.itinerary-calendar-controls\{[^}]*font-size:12px/, 'calendar controls must remain readable');
  assert.match(compactCss, /\.itinerary-calendar-grid\{[^}]*font-size:12px/, 'calendar labels must use the same readable density as the browse table');
  assert.match(compactCss, /\.itinerary-calendar-axis,\.itinerary-calendar-row\{[^}]*min-height:36px/, 'calendar rows must have enough height for readable labels');
  assert.match(compactCss, /\.itinerary-calendar-day-track\{[^}]*height:36px[^}]*background:#eef3f8[^}]*color:#243142/, 'date headings need a light background and dark text');
  assert.match(compactCss, /\.itinerary-calendar-track\{[^}]*min-height:36px/, 'event tracks need a readable base height and must remain free to grow');
  assert.match(compactCss, /\.itinerary-calendar-event\{[^}]*height:28px[^}]*background:#176b5b[^}]*color:#fff[^}]*font-size:12px/, 'calendar events need readable high-contrast labels');
  assert.match(compactCss, /\.itinerary-calendar-event\.unloading\{[^}]*background:#3657a7[^}]*color:#fff/, 'unloading events need an equally readable semantic color');
  assert.match(compactCss, /\.itinerary-calendar-event span\{[^}]*font-size:11px/, 'optional ETA–ETD text must not fall back to 8px');
  assert.doesNotMatch(compactCss, /@media\(prefers-color-scheme:dark\)\{\.itinerary-calendar/, 'OS dark preference must not create a half-dark calendar inside the light app');
  assert.match(
    compactCss,
    /@media\(max-width:720px\)\{[\s\S]*\.itinerary-panel-head\{grid-template-columns:auto minmax\(0,1fr\)\}[\s\S]*\.itinerary-panel-meta\{grid-column:1\/-1;justify-content:flex-start\}/,
    'mobile Owner cards must keep vessel headings readable and move the longer action row below',
  );

  const copyButtonPath = 'src/itinerary/ItineraryCopyEmailButton.tsx';
  assert.ok(fs.existsSync(copyButtonPath), 'shared copy-and-email button must exist');
  const copyButtonSource = fs.readFileSync(copyButtonPath, 'utf8');
  const panelSource = fs.readFileSync('src/itinerary/ItineraryPanel.tsx', 'utf8');
  const dashboardSource = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  const shipPortalSource = fs.readFileSync('src/itinerary/ShipItineraryPortal.tsx', 'utf8');
  assert.match(copyButtonSource, /一鍵複製並發送郵件/);
  assert.match(copyButtonSource, /copyItineraryAndOpenMail/);
  assert.match(panelSource, /<ItineraryCopyEmailButton\b[\s\S]*<ItineraryMoreParametersButton\b/);
  assert.match(dashboardSource, /onNotice=\{setNotice\}/);
  assert.match(shipPortalSource, /<ItineraryCopyEmailButton\b[\s\S]*<ItineraryMoreParametersButton\b/);
  assert.match(shipPortalSource, /準備郵件報告/);

  Object.assign(doc.rows[0], {
    voyageNumber: 'V<001>',
    portDockName: 'ULSAN\nBERTH 2',
    cargoQuantityText: '12,500 MT',
    ldRateText: '500',
    arrivalDraftText: 'A: 6.5\nF: 6.8',
    departureDraftText: 'A: 7.1\nF: 7.3',
    arrivalRobText: 'FO: 900',
    departureRobText: 'FO: 800\nDO: 60',
    notesText: 'DO NOT COPY',
    oceanDistanceNm: 999,
  });
  assert.deepEqual(email.ITINERARY_EMAIL_COPY_FIELD_LABELS.slice(0, 1), ['Voy No.']);
  assert.equal(email.ITINERARY_EMAIL_COPY_FIELD_LABELS.at(-1), 'Dep ROB\n(Cargo/Fuel/FW)');
  assert.equal(email.ITINERARY_EMAIL_COPY_FIELD_LABELS.length, 14);
  assert.ok(!email.ITINERARY_EMAIL_COPY_FIELD_LABELS.includes('備註信息'));

  const payload = email.buildItineraryClipboardPayload(doc);
  assert.match(payload.html, /^<table\b/);
  assert.match(payload.html, /<th[^>]*>Voy No\.<\/th>/);
  assert.match(payload.html, /<th[^>]*>Arr ROB<br>\(Cargo\/Fuel\/FW\)<\/th>/);
  assert.match(payload.html, /<th[^>]*>Dep ROB<br>\(Cargo\/Fuel\/FW\)<\/th>/);
  assert.match(payload.html, /V&lt;001&gt;/);
  assert.match(payload.html, /ULSAN<br>BERTH 2/);
  assert.ok(!payload.html.includes('DO NOT COPY'));
  assert.ok(!payload.html.includes('DTG(NM)'));
  const plainLines = payload.text.split('\r\n');
  assert.equal(plainLines[0].split('\t')[0], 'Voy No.');
  assert.equal(plainLines[0].split('\t').at(-1), 'Dep ROB / (Cargo/Fuel/FW)');
  assert.equal(plainLines[1].split('\t').length, 14);
  assert.ok(plainLines[1].endsWith('FO: 800 / DO: 60'));
  assert.ok(!payload.text.includes('DO NOT COPY'));

  let richItem;
  let unexpectedPlainWrite = '';
  const richMode = await email.copyItineraryTableToClipboard(doc, {
    clipboard: {
      write: async items => { richItem = items[0]; },
      writeText: async value => { unexpectedPlainWrite = value; },
    },
    createClipboardItem: parts => ({ parts }),
  });
  assert.equal(richMode, 'rich');
  assert.equal(unexpectedPlainWrite, '');
  assert.equal(richItem.parts['text/html'].type, 'text/html');
  assert.equal(richItem.parts['text/plain'].type, 'text/plain');
  assert.equal(await richItem.parts['text/html'].text(), payload.html);
  assert.equal(await richItem.parts['text/plain'].text(), payload.text);

  let fallbackText = '';
  const fallbackMode = await email.copyItineraryTableToClipboard(doc, {
    clipboard: {
      write: async () => { throw new Error('rich clipboard denied'); },
      writeText: async value => { fallbackText = value; },
    },
    createClipboardItem: parts => ({ parts }),
  });
  assert.equal(fallbackMode, 'plain');
  assert.equal(fallbackText, payload.text);

  const sequence = [];
  const actionMode = await email.copyItineraryAndOpenMail(doc, {
    clipboard: { writeText: async () => { sequence.push('copy'); } },
    createClipboardItem: null,
    onCopied: message => { sequence.push(`notice:${message}`); },
    openMailClient: href => { sequence.push(`mailto:${href}`); },
  });
  assert.equal(actionMode, 'plain');
  assert.equal(sequence[0], 'copy');
  assert.equal(sequence[1], 'notice:已復製，請去郵箱客戶端粘貼');
  assert.ok(sequence[2].startsWith('mailto:mailto:?'));
  assert.ok(decodeURIComponent(sequence[2]).includes('TEST VESSEL Itinerary'));
  console.log('itinerary_calendar_and_email=PASS');
} finally {
  await server.close();
}
