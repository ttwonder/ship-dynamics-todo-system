import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const calendar = await server.ssrLoadModule('/src/itinerary/itineraryCalendarModel.ts');
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

  const href = email.buildItineraryMailto({ vesselName: 'TEST VESSEL', fileName: 'Itinerary_TEST.xlsx', revision: 5 });
  assert.ok(href.startsWith('mailto:?'));
  assert.ok(decodeURIComponent(href).includes('Itinerary_TEST.xlsx'));
  assert.ok(decodeURIComponent(href).includes('Revision 5'));
  console.log('itinerary_calendar_and_email=PASS');
} finally {
  await server.close();
}
