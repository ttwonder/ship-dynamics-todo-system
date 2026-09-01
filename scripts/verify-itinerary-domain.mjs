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
  assert.equal(types.normalizeItineraryOperation('inspection / To Load / docking'), 'To Load / docking / inspection');
  assert.equal(types.normalizeItineraryOperation('waiting order, repair'), 'waiting order / repair');
  assert.equal(types.setItineraryOperationSelected('', 'load', true), 'To Load');
  assert.equal(types.setItineraryOperationSelected('To Load', 'unload', true), 'To Load / To Unload');
  assert.equal(types.setItineraryOperationSelected('To Load / docking', 'inspection', true), 'To Load / docking / inspection');
  assert.equal(types.setItineraryOperationSelected('To Load / To Unload', 'load', false), 'To Unload');
  assert.equal(types.itineraryOperationSelected('To Load / docking / inspection', 'load'), true);
  assert.equal(types.itineraryOperationSelected('To Load / docking / inspection', 'inspection'), true);
  assert.deepEqual(types.ITINERARY_PURPOSE_OPTIONS.map(option => option.label), ['To Load','To Unload','docking','waiting order','repair','inspection']);

  const first = types.createBlankItineraryRow('row-1', 0);
  Object.assign(first, {
    portDockName: 'KAOHSIUNG',
    portTimeZone: 'UTC+8',
    etaTimeZone: '',
    etbTimeZone: 'UTC+9',
    calculationStartUtc: '2026-08-31T00:00:00Z',
    calculationStartTimeZone: 'UTC+8',
    oceanDistanceNm: 120,
    speedKnots: 12,
    berthWaitHours: 2,
    channelSailingHours: 1,
    preCompletionDelayHours: 2,
    operationQuantityMt: 1000,
    operationRateMtPerHour: 250,
    postCompletionDelayHours: 3,
  });
  const second = types.createBlankItineraryRow('row-2', 1);
  Object.assign(second, {
    portDockName: 'YOKOHAMA',
    portTimeZone: 'UTC+9',
    etaTimeZone: 'UTC+8',
    oceanDistanceNm: 60,
    speedKnots: 12,
  });
  const calculated = domain.recalculateItineraryRows([first, second]);
  assert.equal(calculated.rows[0].sailingHours, 10);
  assert.equal(calculated.rows[0].etaUtc, '2026-08-31T10:00:00Z', 'first auto ETA uses the stored calculation anchor plus this row remaining sailing time');
  assert.equal(calculated.rows[0].etbUtc, '2026-08-31T13:00:00Z');
  assert.equal(calculated.rows[0].operationHours, 4);
  assert.equal(calculated.rows[0].etcUtc, '2026-08-31T19:00:00Z');
  assert.equal(calculated.rows[0].etdUtc, '2026-08-31T22:00:00Z');
  assert.equal(calculated.rows[1].sailingHours, 5);
  assert.equal(calculated.rows[1].etaUtc, '2026-09-01T03:00:00Z', 'subsequent ETA uses previous ETD plus the current row remaining sailing time');
  assert.equal(calculated.rows[1].etbUtc, calculated.rows[1].etaUtc, 'blank optional durations count as zero');
  assert.equal(calculated.rows[1].etcUtc, calculated.rows[1].etbUtc, 'blank operation inputs count as zero');
  assert.equal(calculated.rows[1].etdUtc, calculated.rows[1].etcUtc, 'blank post-completion delay counts as zero');
  assert.equal(calculated.issues.length, 0);

  const explicitBlankPost = types.createBlankItineraryRow('explicit-blank-post', 0);
  Object.assign(explicitBlankPost, {
    calculationStartUtc: '2026-09-01T00:00:00Z', calculationStartTimeZone: 'UTC',
    portTimeZone: 'UTC', departureBufferDays: 0.25, postCompletionDelayHours: null,
  });
  const explicitBlankPostCalculated = domain.recalculateItineraryRows([explicitBlankPost]).rows[0];
  assert.equal(explicitBlankPostCalculated.etdUtc, explicitBlankPostCalculated.etcUtc, 'an explicit v2 null post-delay must contribute zero');
  const legacyPost = structuredClone(explicitBlankPost);
  delete legacyPost.postCompletionDelayHours;
  const legacyPostCalculated = domain.recalculateItineraryRows([legacyPost]).rows[0];
  assert.equal(legacyPostCalculated.etdUtc, time.addHoursToInstant(legacyPostCalculated.etcUtc, 6), 'only a legacy row missing the v2 key may fall back to departureBufferDays');

  assert.equal(types.resolveItineraryTimeZone(first, 'etaUtc'), 'UTC+8');
  assert.equal(types.resolveItineraryTimeZone(first, 'etbUtc'), 'UTC+9');

  const manual = { ...second, etbMode: 'manual', etbUtc: '2026-09-01T05:30:00Z', preCompletionDelayHours: 1, operationQuantityMt: 500, operationRateMtPerHour: 250 };
  const manualResult = domain.recalculateItineraryRows([first, manual]);
  assert.equal(manualResult.rows[1].etbUtc, '2026-09-01T05:30:00Z');
  assert.equal(manualResult.rows[1].etcUtc, '2026-09-01T08:30:00Z');

  const invalidSpeed = { ...first, speedKnots: 0 };
  const invalidResult = domain.recalculateItineraryRows([invalidSpeed, second]);
  assert.equal(invalidResult.rows[0].sailingHours, null);
  assert.equal(invalidResult.rows[0].etaUtc, '2026-08-31T00:00:00Z', 'an invalid/missing optional duration contributes zero instead of deleting an available base time');
  assert.ok(invalidResult.issues.some(issue => issue.code === 'invalid-speed'));

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
  assert.equal(time.normalizeItineraryDateInput('2026-9-1'), '2026-09-01');
  assert.equal(time.normalizeItineraryDateInput('2026/09/01'), '2026-09-01');
  assert.equal(time.normalizeItineraryDateInput('20260901'), '2026-09-01');
  assert.equal(time.normalizeItineraryDateInput('2026-02-30'), null);
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
  combinedOperation.rows[0].operation = 'To Load / docking / inspection';
  assert.equal(validation.validateItineraryDocument(combinedOperation).ok, true);

  const legacyV1 = structuredClone(document);
  for (const key of ['etaTimeZone','etbTimeZone','etcTimeZone','etdTimeZone','calculationStartUtc','calculationStartTimeZone','channelSailingHours','preCompletionDelayHours','postCompletionDelayHours']) delete legacyV1.rows[0][key];
  legacyV1.rows[0].departureBufferDays = 0.25;
  const normalizedLegacyV1 = validation.validateItineraryDocument(legacyV1);
  assert.equal(normalizedLegacyV1.ok, true);
  assert.equal(normalizedLegacyV1.value.rows[0].etaTimeZone, '');
  assert.equal(normalizedLegacyV1.value.rows[0].calculationStartUtc, null);
  assert.equal(normalizedLegacyV1.value.rows[0].postCompletionDelayHours, 6, 'legacy days must migrate to post-completion hours');

  const invalidTimeOffset = structuredClone(document);
  invalidTimeOffset.rows[0].etaTimeZone = 'UTC+14:15';
  const invalidTimeOffsetResult = validation.validateItineraryDocument(invalidTimeOffset);
  assert.equal(invalidTimeOffsetResult.ok, false);
  assert.ok(invalidTimeOffsetResult.errors.some(error => error.path.endsWith('.etaTimeZone') && error.code === 'invalid-time-zone'));

  const invalidStartOffset = structuredClone(document);
  invalidStartOffset.rows[0].calculationStartUtc = '2026-09-01T00:00:00Z';
  invalidStartOffset.rows[0].calculationStartTimeZone = '';
  const invalidStartOffsetResult = validation.validateItineraryDocument(invalidStartOffset);
  assert.equal(invalidStartOffsetResult.ok, false);
  assert.ok(invalidStartOffsetResult.errors.some(error => error.path.endsWith('.calculationStartTimeZone') && error.code === 'time-zone-required'));

  const laterAnchor = structuredClone(document);
  laterAnchor.rows.push({
    ...structuredClone(document.rows[0]), rowId: 'row-2', sortOrder: 1,
    calculationStartUtc: '2026-09-01T00:00:00Z', calculationStartTimeZone: 'UTC+8',
  });
  const laterAnchorResult = validation.validateItineraryDocument(laterAnchor);
  assert.equal(laterAnchorResult.ok, false);
  assert.ok(laterAnchorResult.errors.some(error => error.path === 'rows[1].calculationStartUtc' && error.code === 'first-row-only'));

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
