import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const calendar = await server.ssrLoadModule('/src/itinerary/itineraryCalendarModel.ts');
  const calendarView = await server.ssrLoadModule('/src/itinerary/ItineraryCalendar.tsx');
  const taskSchedule = await server.ssrLoadModule('/src/taskPlannedSchedule.ts');
  const email = await server.ssrLoadModule('/src/itinerary/itineraryEmail.ts');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const model = await server.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');
  const doc = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v1', vesselName: 'TEST VESSEL', rowId: 'r1' });
  Object.assign(doc.rows[0], { voyageNumber: 'V001', portDockName: 'ULSAN', operation: 'To Load', etaUtc: '2026-09-01T00:00:00Z', etdUtc: '2026-09-03T00:00:00Z', portTimeZone: 'UTC+9' });
  const range = calendar.calendarRangeFromLocalDate('2026-09-01', 7, 'UTC+8');
  assert.equal(range.ok, true);
  const entries = calendar.buildItineraryCalendarEntries([doc], range.startInstant, range.endInstant);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].leftPercent, 8 / (7 * 24) * 100); // Taipei midnight is 16:00Z; event starts eight hours later
  assert.ok(entries[0].widthPercent > 28 && entries[0].widthPercent < 29);
  const calendarWithAlternative = model.addShipAlternativePlan(doc, 'calendar-alternative', 'calendar-alternative-row');
  Object.assign(calendarWithAlternative.alternativePlans[0].rows[0], {
    voyageNumber: 'MUST-NOT-ENTER-CALENDAR',
    portDockName: 'ALTERNATIVE PORT',
    etaUtc: '2026-09-01T06:00:00Z',
    etdUtc: '2026-09-06T00:00:00Z',
  });
  assert.deepEqual(
    calendar.buildItineraryCalendarEntries([calendarWithAlternative], range.startInstant, range.endInstant),
    entries,
    'alternative rows must not enter the formal Calendar projection',
  );
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

  const task = {
    id: 'task-calendar-1', vesselId: 'v1', description: '跟進主機修理', status: '等待備件', priority: '高',
    plannedStartDate: '2026-09-02', plannedDurationDays: 0.5, isClosed: false,
  };
  const taskEvents = taskSchedule.projectTaskPlannedCalendarEvents([task], [{ id: 'v1', vesselName: 'TEST VESSEL' }], 'UTC+8');
  const mixedLanes = calendar.buildItineraryCalendarLanes([doc, secondDoc], range.startInstant, range.endInstant, taskEvents);
  const taskEntry = mixedLanes[0].events.find(event => event.source === 'task');
  assert.ok(taskEntry, 'scheduled tasks must be projected into the matching vessel lane');
  assert.equal(taskEntry.eventId, 'task:task-calendar-1:v1');
  assert.ok(taskEntry.widthPercent > 7 && taskEntry.widthPercent < 8, '0.5 day must occupy half of one 96px day column');
  assert.ok(taskEntry.layer > 0, 'a task overlapping an itinerary event must use the shared overlap allocator');

  const now = Date.now();
  const renderedFirst = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'render-v1', vesselName: 'FIRST VESSEL', rowId: 'render-r1' });
  Object.assign(renderedFirst.rows[0], { voyageNumber: 'NOW-1', etaUtc: new Date(now).toISOString(), etdUtc: new Date(now + 48 * 60 * 60 * 1000).toISOString() });
  const renderedOverlap = types.createBlankItineraryRow('render-r2', 1);
  Object.assign(renderedOverlap, { voyageNumber: 'NOW-2', etaUtc: new Date(now + 24 * 60 * 60 * 1000).toISOString(), etdUtc: new Date(now + 72 * 60 * 60 * 1000).toISOString() });
  renderedFirst.rows.push(renderedOverlap);
  const renderedSecond = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'render-v2', vesselName: 'SECOND VESSEL', rowId: 'render-empty' });
  const localTaskDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  const renderedTask = { ...task, id: 'render-task', vesselId: 'render-v2', description: '更新消防設備', plannedStartDate: localTaskDate, plannedDurationDays: 1 };
  const calendarHtml = renderToStaticMarkup(React.createElement(calendarView.default, { documents: [renderedFirst, renderedSecond], tasks: [renderedTask] }));
  assert.equal((calendarHtml.match(/class="itinerary-calendar-row"/g) || []).length, 2, 'two selected vessels must render exactly two vessel rows');
  assert.match(calendarHtml, /FIRST VESSEL/);
  assert.match(calendarHtml, /SECOND VESSEL/);
  assert.doesNotMatch(calendarHtml, /#1|#2/, 'port-order labels must not split one vessel into separate rows');
  assert.match(calendarHtml, />96px</, 'calendar default day width must be 96px');
  assert.match(calendarHtml, /min-height:68px/, 'two overlapping events must expand only their vessel lane');
  assert.match(calendarHtml, /top:36px/, 'the overlapping event must render in the second sub-layer');
  assert.match(calendarHtml, /要事｜更新消防設備/);
  assert.match(calendarHtml, /Itinerary 裝港/);
  assert.match(calendarHtml, /要事排程/);
  assert.match(calendarHtml, /預計執行天數：1 天/);
  const stickyAxisIndex = calendarHtml.indexOf('itinerary-calendar-sticky-axis');
  const horizontalScrollIndex = calendarHtml.indexOf('itinerary-calendar-scroll');
  assert.ok(stickyAxisIndex >= 0 && stickyAxisIndex < horizontalScrollIndex, 'the sticky date axis must sit outside the horizontal overflow container');
  assert.match(calendarHtml, /class="itinerary-calendar-day-viewport"/, 'the synchronized date axis needs its own clipping viewport');
  assert.match(calendarHtml, /transform:translateX\(0px\)/, 'the date axis must expose its horizontal scroll transform');
  assert.match(calendarHtml, /width:calc\(var\(--itinerary-calendar-vessel-width\) \+ 1344px\)/, 'grid width must share the responsive vessel-width variable');

  const compactCss = fs.readFileSync('src/itinerary/itineraryCompact.css', 'utf8');
  const calendarViewSource = fs.readFileSync('src/itinerary/ItineraryCalendar.tsx', 'utf8');
  assert.match(calendarViewSource, /querySelector<HTMLElement>\('\.topbar'\)/, 'sticky top must be measured from the actual responsive topbar');
  assert.match(calendarViewSource, /ResizeObserver/, 'topbar height changes from zoom or responsive wrapping must update the sticky offset');
  assert.match(calendarViewSource, /setHorizontalScroll\(event\.currentTarget\.scrollLeft\)/, 'body horizontal scrolling must synchronize the date axis');
  assert.match(compactCss, /\.itinerary-calendar-controls\{[^}]*font-size:12px/, 'calendar controls must remain readable');
  assert.match(compactCss, /\.itinerary-calendar-frame\{[^}]*--itinerary-calendar-vessel-width:164px[^}]*min-width:0[^}]*width:100%[^}]*max-width:100%[^}]*border:1px solid var\(--line\)/, 'the non-scrolling frame must contain wide timelines while owning the border and responsive vessel width');
  assert.match(compactCss, /\.itinerary-calendar-sticky-axis\{[^}]*position:sticky[^}]*top:var\(--itinerary-calendar-sticky-top,0px\)[^}]*z-index:/, 'date axis must stick below the measured app header');
  assert.match(compactCss, /\.itinerary-calendar-day-viewport\{[^}]*overflow:hidden/, 'the translated date row must be clipped to the calendar viewport');
  assert.match(compactCss, /\.itinerary-calendar-grid\{[^}]*font-size:12px/, 'calendar labels must use the same readable density as the browse table');
  assert.match(compactCss, /\.itinerary-calendar-sticky-axis,\.itinerary-calendar-row\{[^}]*min-height:36px/, 'calendar rows must have enough height for readable labels');
  assert.match(compactCss, /\.itinerary-calendar-vessel-label\{[^}]*z-index:3[^}]*width:var\(--itinerary-calendar-vessel-width\)[^}]*min-width:var\(--itinerary-calendar-vessel-width\)[^}]*background:var\(--paper,#fff\)/, 'body vessel labels must be an opaque mask above horizontally scrolled events');
  assert.match(compactCss, /\.itinerary-calendar-day-track\{[^}]*height:36px[^}]*background:#eef3f8[^}]*color:#243142/, 'date headings need a light background and dark text');
  assert.match(compactCss, /\.itinerary-calendar-track\{[^}]*min-height:36px/, 'event tracks need a readable base height and must remain free to grow');
  assert.match(compactCss, /\.itinerary-calendar-event\{[^}]*height:28px[^}]*background:#176b5b[^}]*color:#fff[^}]*font-size:12px/, 'calendar events need readable high-contrast labels');
  assert.match(compactCss, /\.itinerary-calendar-event\.unloading\{[^}]*background:#3657a7[^}]*color:#fff/, 'unloading events need an equally readable semantic color');
  assert.match(compactCss, /\.itinerary-calendar-event\.task\{[^}]*background:/, 'task events need a distinct fixed color');
  assert.match(compactCss, /\.itinerary-calendar-event\.task\.completed\{[^}]*background:#746f79[^}]*color:#fff/, 'closed task events need an opaque low-saturation color with readable white text');
  assert.doesNotMatch(compactCss, /\.itinerary-calendar-event\.task\.completed\{[^}]*opacity:/, 'completed event opacity must not reduce the 12px title contrast');
  assert.match(compactCss, /\.itinerary-calendar-event span\{[^}]*font-size:11px/, 'optional ETA–ETD text must not fall back to 8px');
  assert.doesNotMatch(compactCss, /@media\(prefers-color-scheme:dark\)\{\.itinerary-calendar/, 'OS dark preference must not create a half-dark calendar inside the light app');
  assert.match(compactCss, /@media\(max-width:850px\)\{[^}]*\.itinerary-calendar-frame\{--itinerary-calendar-vessel-width:126px\}/, 'zoom/mobile breakpoint must change the shared vessel width rather than only body labels');
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
  assert.doesNotMatch(dashboardSource, /alternativePlans|ShipItineraryAlternativesBrowse/, 'the main dashboard must not expose alternative data');
  assert.doesNotMatch(panelSource, /alternativePlans|ShipItineraryAlternativesBrowse/, 'main-page vessel panels must remain formal-only');
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
  const emailWithAlternative = model.addShipAlternativePlan(doc, 'email-alternative', 'email-alternative-row');
  Object.assign(emailWithAlternative.alternativePlans[0].rows[0], {
    voyageNumber: 'MUST-NOT-ENTER-EMAIL',
    portDockName: 'SECRET ALTERNATIVE PORT',
    cargoQuantityText: '999,999 MT',
  });
  assert.deepEqual(email.buildItineraryClipboardPayload(emailWithAlternative), payload, 'alternative rows must not enter email HTML or plain text');
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
