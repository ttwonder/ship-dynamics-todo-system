import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const domain = await server.ssrLoadModule('/src/itinerary/itineraryDomain.ts');
  const time = await server.ssrLoadModule('/src/itinerary/itineraryTime.ts');
  const validation = await server.ssrLoadModule('/src/itinerary/itineraryValidation.ts');
  const operations = await server.ssrLoadModule('/src/itinerary/itineraryOperation.ts');

  assert.equal(types.normalizeItineraryOperation('Loading'), 'To Load');
  assert.equal(types.normalizeItineraryOperation('Unloading'), 'To Unload');
  assert.equal(types.normalizeItineraryOperation('Loading / Unloading'), 'To Load / To Unload');
  assert.equal(types.setItineraryOperationSelected('', 'load', true), 'To Load');
  assert.equal(types.setItineraryOperationSelected('To Load', 'unload', true), 'To Load / To Unload');
  assert.equal(types.setItineraryOperationSelected('To Load / To Unload', 'load', false), 'To Unload');
  assert.equal(types.itineraryOperationSelected('To Load / To Unload', 'load'), true);
  assert.equal(types.itineraryOperationSelected('To Load / To Unload', 'unload'), true);

  const first = types.createBlankItineraryRow('row-1', 0);
  Object.assign(first, {
    portDockName: 'KAOHSIUNG',
    portTimeZone: 'UTC+8',
    etdUtc: '2026-08-31T00:00:00Z',
    etdMode: 'manual',
    oceanDistanceNm: 120,
    speedKnots: 12,
  });
  const second = types.createBlankItineraryRow('row-2', 1);
  Object.assign(second, {
    portDockName: 'YOKOHAMA',
    portTimeZone: 'UTC+9',
    berthWaitHours: 2,
    operationQuantityMt: 1000,
    operationRateMtPerHour: 250,
    departureBufferDays: 0.5,
  });
  const calculated = domain.recalculateItineraryRows([first, second]);
  assert.equal(calculated.rows[0].sailingHours, 10);
  assert.equal(calculated.rows[1].etaUtc, '2026-08-31T10:00:00Z');
  assert.equal(calculated.rows[1].etbUtc, '2026-08-31T12:00:00Z');
  assert.equal(calculated.rows[1].operationHours, 4);
  assert.equal(calculated.rows[1].etcUtc, '2026-08-31T16:00:00Z');
  assert.equal(calculated.rows[1].etdUtc, '2026-09-01T04:00:00Z');
  assert.equal(calculated.issues.length, 0);

  const manual = { ...second, etbMode: 'manual', etbUtc: '2026-08-31T15:30:00Z' };
  const manualResult = domain.recalculateItineraryRows([first, manual]);
  assert.equal(manualResult.rows[1].etbUtc, '2026-08-31T15:30:00Z');
  assert.equal(manualResult.rows[1].etcUtc, '2026-08-31T19:30:00Z');

  const invalidSpeed = { ...first, speedKnots: 0 };
  const invalidResult = domain.recalculateItineraryRows([invalidSpeed, second]);
  assert.equal(invalidResult.rows[0].sailingHours, null);
  assert.equal(invalidResult.rows[1].etaUtc, null);
  assert.ok(invalidResult.issues.some(issue => issue.code === 'invalid-speed'));
  assert.ok(invalidResult.issues.some(issue => issue.code === 'missing-previous-sailing-time'));

  assert.deepEqual(
    time.wallTimeToInstant('2026-08-31', '16:00', 'UTC+8'),
    { ok: true, instant: '2026-08-31T08:00:00Z' },
  );
  assert.deepEqual(
    time.instantToWallTime('2026-08-31T08:00:00Z', 'UTC+8'),
    { ok: true, date: '2026-08-31', time: '16:00' },
  );
  assert.deepEqual(time.wallTimeToInstant('2026-08-31', '13:45', 'UTC+5:45'), { ok: true, instant: '2026-08-31T08:00:00Z' });
  assert.deepEqual(time.instantToWallTime('2026-08-31T08:00:00Z', 'UTC-6'), { ok: true, date: '2026-08-31', time: '02:00' });
  assert.equal(time.parseUtcOffsetMinutes('UTC+5:30'), 330);
  assert.equal(time.parseUtcOffsetMinutes('UTC-9:30'), -570);
  assert.equal(time.parseUtcOffsetMinutes('UTC'), 0);
  assert.equal(time.parseUtcOffsetMinutes('UTC+14:15'), null);
  assert.equal(time.parseUtcOffsetMinutes('UTC-12:15'), null);
  assert.equal(time.parseUtcOffsetMinutes('UTC+5:20'), null);
  assert.equal(time.formatUtcOffsetMinutes(330), 'UTC+5:30');
  assert.equal(time.formatUtcOffsetMinutes(-360), 'UTC-6');
  assert.equal(time.formatUtcOffsetMinutes(345), 'UTC+5:45');
  assert.equal(time.formatUtcOffsetMinutes(20), null);
  assert.equal(time.formatItineraryUtcOffset('UTC+5:30', '2026-09-01T00:00:00Z'), 'UTC+5:30');
  assert.equal(time.formatItineraryUtcOffset('Asia/Seoul', '2026-09-01T00:00:00Z'), 'UTC+9');
  assert.equal(time.formatItineraryUtcOffset('GMT+8', '2026-09-01T00:00:00Z'), '');
  assert.equal(time.isValidUtcOffset('UTC+8'), true);
  assert.equal(time.isValidUtcOffset('Asia/Seoul'), false);
  assert.equal(time.isValidItineraryTimeZone('UTC+5:45'), true);
  assert.equal(time.isValidItineraryTimeZone('Asia/Seoul'), true, 'legacy IANA rows must remain readable');
  assert.ok(time.UTC_OFFSET_OPTIONS.includes('UTC-12'));
  assert.ok(time.UTC_OFFSET_OPTIONS.includes('UTC+5:30'));
  assert.ok(time.UTC_OFFSET_OPTIONS.includes('UTC+5:45'));
  assert.ok(time.UTC_OFFSET_OPTIONS.includes('UTC+12:45'));
  assert.ok(time.UTC_OFFSET_OPTIONS.includes('UTC+14'));
  assert.ok(time.UTC_OFFSET_OPTIONS.every(value => !value.includes('/')), 'new selector options must contain offsets only');
  assert.equal(time.wallTimeToInstant('2026-03-08', '02:30', 'America/Los_Angeles').ok, false);
  assert.equal(time.wallTimeToInstant('2026-11-01', '01:30', 'America/Los_Angeles').ok, false);

  const now = Date.parse('2026-08-31T08:00:00Z');
  assert.equal(time.formatRelativeUpdatedAt('2026-08-31T07:49:00Z', now), '11 分鐘前更新');
  assert.equal(time.formatRelativeUpdatedAt('2026-08-31T05:00:00Z', now), '3 小時前更新');
  assert.equal(time.formatRelativeUpdatedAt('2026-08-29T08:00:00Z', now), '2 天前更新');
  assert.equal(time.formatRelativeUpdatedAt(null, now), '尚未同步');

  const document = types.createEmptyItineraryDocument({ workspaceKey: 'demo', vesselId: 'v-1', vesselName: 'TEST', rowId: 'row-1' });
  document.rows[0].portDockName = 'PORT';
  document.rows[0].portTimeZone = 'UTC+8';
  assert.deepEqual(validation.validateItineraryDocument(document), { ok: true, value: document });

  const legacyOperation = structuredClone(document);
  legacyOperation.rows[0].operation = 'Loading';
  const normalizedLegacyOperation = validation.validateItineraryDocument(legacyOperation);
  assert.equal(normalizedLegacyOperation.ok, true);
  assert.equal(normalizedLegacyOperation.value.rows[0].operation, 'To Load');
  const combinedOperation = structuredClone(document);
  combinedOperation.rows[0].operation = 'To Load / To Unload';
  assert.equal(validation.validateItineraryDocument(combinedOperation).ok, true);

  const duplicate = structuredClone(document);
  duplicate.rows.push({ ...duplicate.rows[0] });
  const duplicateResult = validation.validateItineraryDocument(duplicate);
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.errors.some(error => error.code === 'duplicate-row-id'));

  const invalidZone = structuredClone(document);
  invalidZone.rows[0].portTimeZone = 'GMT+8';
  const invalidZoneResult = validation.validateItineraryDocument(invalidZone);
  assert.equal(invalidZoneResult.ok, false);
  assert.ok(invalidZoneResult.errors.some(error => error.code === 'invalid-time-zone'));

  const resequenced = domain.resequenceItineraryRows([
    { ...second, rowId: 'b', sortOrder: 9 },
    { ...first, rowId: 'a', sortOrder: 4 },
  ]);
  assert.deepEqual(resequenced.map(row => [row.rowId, row.sortOrder]), [['b', 0], ['a', 1]]);

  assert.match(types.createItineraryOperationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const firstPending = operations.pendingOperationForDocument(document, null, () => '10000000-0000-4000-8000-000000000001');
  const samePending = operations.pendingOperationForDocument(structuredClone(document), firstPending, () => { throw new Error('same bytes must reuse the operation'); });
  assert.equal(samePending.id, firstPending.id);
  const changedDocument = structuredClone(document);
  changedDocument.rows[0].voyageNumber = 'CHANGED';
  const changedPending = operations.pendingOperationForDocument(changedDocument, firstPending, () => '10000000-0000-4000-8000-000000000002');
  assert.notEqual(changedPending.id, firstPending.id);

  console.log('itinerary_domain_and_timezone=PASS');
} finally {
  await server.close();
}
