import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

function decodeHtmlAttribute(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const calendarView = await server.ssrLoadModule('/src/itinerary/ItineraryCalendar.tsx');
  const panelView = await server.ssrLoadModule('/src/itinerary/ItineraryPanel.tsx');
  const shipPortalView = await server.ssrLoadModule('/src/itinerary/ShipItineraryPortal.tsx');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const itineraryTime = await server.ssrLoadModule('/src/itinerary/itineraryTime.ts');
  const now = Date.now();
  const document = types.createEmptyItineraryDocument({
    workspaceKey: 'qa', vesselId: 'vessel-calendar-details', vesselName: 'FPMC B 202', rowId: 'row-calendar-details',
  });
  const row = document.rows[0];
  Object.assign(row, {
    previousPortName: 'BUSAN',
    voyageNumber: 'V-2026-09',
    portDockName: 'KAOHSIUNG NO. 72',
    operation: 'load',
    portTimeZone: 'UTC+8',
    calculationStartTimeZone: 'UTC+8',
    etaUtc: new Date(now + 60 * 60 * 1000).toISOString(),
    etbUtc: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    etcUtc: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    etdUtc: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    etaTimeZone: 'UTC+8',
    etbTimeZone: 'UTC+9',
    etcTimeZone: 'UTC-4',
    etdTimeZone: 'UTC+5:45',
    cargoQuantityText: 'Crude Oil | 12,500 MT\nFuel Oil | 2,500 MT',
    ldRateText: '500 MT/h',
    arrivalDraftText: 'A: 6.5 m\nF: 6.8 m',
    departureDraftText: 'A: 7.1 m\nF: 7.3 m',
  });
  const laterRowPlacedFirstInArray = types.createBlankItineraryRow('row-later-array-first', 9);
  laterRowPlacedFirstInArray.calculationStartTimeZone = 'UTC-3';
  document.rows.unshift(laterRowPlacedFirstInArray);

  const calendarHtml = renderToStaticMarkup(React.createElement(calendarView.default, { documents: [document] }));
  assert.match(
    calendarHtml,
    /<input type="checkbox" checked=""\/>ETA–ETD/,
    'calendar ETA–ETD content must be selected by default',
  );

  const titleMatch = calendarHtml.match(/<div class="itinerary-calendar-event loading"[^>]*title="([^"]*)"/);
  assert.ok(titleMatch, 'rendered Itinerary event must expose a hover title');

  function expectedTime(field) {
    const instant = row[field];
    const zone = types.resolveItineraryTimeZone(row, field);
    const wall = itineraryTime.instantToWallTime(instant, zone);
    assert.equal(wall.ok, true, `${String(field)} fixture must convert to LT`);
    const offset = itineraryTime.formatItineraryUtcOffset(zone, instant);
    return `${wall.date} ${wall.time}（${offset}）`;
  }

  const expectedTitle = [
    '船舶：FPMC B 202 ｜ 航次：V-2026-09',
    '港口：KAOHSIUNG NO. 72 ｜ 預計作業類型：To Load ｜ 目的地時區：UTC+8',
    `ETA：${expectedTime('etaUtc')} ｜ ETB：${expectedTime('etbUtc')}`,
    `ETC：${expectedTime('etcUtc')} ｜ ETD：${expectedTime('etdUtc')}`,
    'B/F or I/F Qty (MT/BBLS)：Crude Oil | 12,500 MT；Fuel Oil | 2,500 MT ｜ 預計裝卸速度：500 MT/h',
    '到港吃水：A: 6.5 m；F: 6.8 m ｜ 離港吃水：A: 7.1 m；F: 7.3 m',
  ].join('\n');
  assert.equal(decodeHtmlAttribute(titleMatch[1]).split('\n').length, 6, 'Itinerary hover must use no more than six grouped lines');
  assert.equal(
    decodeHtmlAttribute(titleMatch[1]),
    expectedTitle,
    'Itinerary event hover must show complete row details with each field’s effective LT offset',
  );

  const panelHtml = renderToStaticMarkup(React.createElement(panelView.default, {
    document,
    selected: false,
    nowMs: now,
    canEdit: true,
    onToggleSelected: () => {},
    onNotice: () => {},
    onEdit: () => {},
  }));
  assert.ok(
    panelHtml.includes('現在所處時區：<b>UTC+8</b>'),
    'main-site vessel heading must show the first sorted row’s saved current time zone',
  );
  assert.ok(
    panelHtml.includes('上一港名稱：<b>BUSAN</b>'),
    'main-site vessel heading must show the first sorted row’s saved previous port',
  );

  const noZoneDocument = types.createEmptyItineraryDocument({
    workspaceKey: 'qa', vesselId: 'vessel-no-zone', vesselName: 'FPMC B 101', rowId: 'row-no-zone',
  });
  const noZonePanelHtml = renderToStaticMarkup(React.createElement(panelView.default, {
    document: noZoneDocument,
    selected: false,
    nowMs: now,
    canEdit: true,
    onToggleSelected: () => {},
    onNotice: () => {},
    onEdit: () => {},
  }));
  assert.ok(
    noZonePanelHtml.includes('現在所處時區：<b>未設定</b>'),
    'main-site vessel heading must keep an explicit unset current-time-zone field',
  );
  assert.ok(
    noZonePanelHtml.includes('上一港名稱：<b>未設定</b>'),
    'main-site vessel heading must keep an explicit unset previous-port field for legacy documents',
  );

  assert.equal(
    typeof shipPortalView.ShipItineraryLatestHeading,
    'function',
    'ship portal must expose the production latest-document heading for render verification',
  );
  const shipHeadingHtml = renderToStaticMarkup(React.createElement(shipPortalView.ShipItineraryLatestHeading, {
    document,
    nowMs: now,
  }));
  assert.ok(
    shipHeadingHtml.includes('現在所處時區：<b>UTC+8</b>'),
    'ship-side vessel heading must show the same first-row saved current time zone',
  );
  assert.ok(
    shipHeadingHtml.includes('上一港名稱：<b>BUSAN</b>'),
    'ship-side vessel heading must show the same first-row saved previous port',
  );

  console.log('itinerary_calendar_details=PASS');
} finally {
  await server.close();
}
