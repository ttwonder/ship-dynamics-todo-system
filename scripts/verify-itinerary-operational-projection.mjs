import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const projection = await server.ssrLoadModule('/src/itinerary/itineraryOperationalProjection.ts');
  const drafts = await server.ssrLoadModule('/src/vesselOperationalDraft.ts');
  const smartShipApi = await server.ssrLoadModule('/src/smartShipApi.ts');

  const document = types.createEmptyItineraryDocument({
    workspaceKey: 'workspace-a', vesselId: 'v-1', vesselName: 'FPMC A', rowId: 'row-later',
  });
  Object.assign(document, { revision: 7, updatedAt: '2026-09-03T12:34:56Z' });
  Object.assign(document.rows[0], {
    sortOrder: 9,
    previousPortName: '',
    portDockName: 'WRONG LATER PORT',
    portTimeZone: 'UTC',
    etaUtc: '2026-09-09T00:00:00Z',
    etbUtc: '2026-09-09T01:00:00Z',
    etdUtc: '2026-09-09T02:00:00Z',
    cargoQuantityText: 'WRONG LATER CARGO',
  });
  const first = types.createBlankItineraryRow('row-first', 0);
  Object.assign(first, {
    previousPortName: 'BUSAN',
    portDockName: '',
    portTimeZone: 'UTC+8',
    etaTimeZone: 'UTC+8',
    etbTimeZone: 'UTC+9',
    etdTimeZone: 'UTC-6',
    etaUtc: '2026-09-01T00:00:00Z',
    etbUtc: '2026-09-01T00:00:00Z',
    etdUtc: '2026-09-01T00:00:00Z',
    cargoQuantityText: 'Crude Oil｜12,500 MT\nFuel Oil｜2,500 MT',
  });
  document.rows.unshift(first);
  document.alternativePlans = [{
    planId: 'alt-1', planNumber: 1, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    rows: [{ ...types.createBlankItineraryRow('alt-row', 0), previousPortName: 'FORBIDDEN', portDockName: 'FORBIDDEN ALT PORT', etaUtc: '2026-01-01T00:00:00Z', cargoQuantityText: 'FORBIDDEN ALT CARGO' }],
  }];

  const capture = '2026-09-01T00:00:00Z';
  const projected = projection.projectItineraryOperationalDocument(document, capture);
  const after = projection.projectItineraryOperationalDocument(document, '2026-09-01T08:00:00.001+08:00');
  assert.equal(after.values.portDockName, 'WRONG LATER PORT', 'strictly passed ETD selects sorted formal row two');
  assert.equal(after.values.previousPortName, 'BUSAN');
  assert.equal(after.values.cargoQuantityText, first.cargoQuantityText);
  assert.equal(after.rowId, first.rowId);
  for (const etdUtc of [null, '', 'invalid', '2026-08-31', '2026-02-30T00:00:00Z', '2026-09-02T00:00:00Z']) {
    const d = structuredClone(document); d.rows[0].etdUtc = etdUtc;
    assert.equal(projection.projectItineraryOperationalDocument(d, capture).values.portDockName, '');
  }
  const noSecond = structuredClone(document); noSecond.rows = [first];
  assert.equal(projection.projectItineraryOperationalDocument(noSecond, '2026-09-02T00:00:00Z').values.portDockName, 'TBA');
  const blankSecond = structuredClone(document); blankSecond.rows[1].portDockName = '  ';
  blankSecond.rows.push({ ...types.createBlankItineraryRow('third', 10), portDockName: 'NEVER THIRD' });
  assert.equal(projection.projectItineraryOperationalDocument(blankSecond, '2026-09-02T00:00:00Z').values.portDockName, 'TBA');

  assert.equal(projected.revision, 7);
  assert.equal(projected.rowId, 'row-first', 'formal first row must be selected by sortOrder, not array order');
  assert.equal(projected.values.previousPortName, 'BUSAN');
  assert.equal(projected.values.portDockName, '', 'blank formal values must stay blank instead of falling back per field');
  assert.equal(projected.values.etaSchedule, '2026-09-01T08:00');
  assert.equal(projected.values.etbSchedule, '2026-09-01T09:00');
  assert.equal(projected.values.etdSchedule, '2026-08-31T18:00');
  assert.equal(projected.values.cargoQuantityText, 'Crude Oil｜12,500 MT\nFuel Oil｜2,500 MT');
  assert.doesNotMatch(JSON.stringify(projected), /FORBIDDEN/, 'alternative plans must never enter the operational projection');

  const vessel = {
    id: 'v-1', name: 'FPMC A', shortName: 'A', fullName: 'FPMC A', shipType: 'bulk', fleetCategory: '', fleetTags: [], assignedUserIds: [], delegateManagers: [], isActive: true,
    position: { source: 'manual', location: 'SEA', speedKnots: 12, navigationStatus: '航行', lastPort: 'LEGACY LAST', nextPort: 'LEGACY NEXT', eta: '2026-10-01T01:00', etb: '2026-10-01T02:00', etd: '2026-10-01T03:00', updatedAt: '2026-08-01T00:00:00Z', manualRemark: '' },
    cargo: { source: 'manual', loadStatus: '非空載', name: 'LEGACY CARGO', quantity: '1 MT', items: [{ name: 'LEGACY CARGO', quantity: '1 MT' }], updatedAt: '2026-08-01T00:00:00Z' },
    note: { statusList: [], statusSupplement: '', captain: '', chiefOfficer: '', chiefEngineer: '', firstEngineer: '', recentDynamics: '', subsequentDynamics: '', updatedAt: '2026-08-01T00:00:00Z' },
    weeklyAttention: [], createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
  };

  const readyRecord = { status: 'ready', document, checkedAt: '2026-09-03T12:35:00Z' };
  const effective = projection.resolveVesselWithItineraryProjection(vessel, readyRecord, capture);
  assert.equal(effective.position.lastPort, 'BUSAN');
  assert.equal(effective.position.nextPort, '', 'a blank Itinerary next port must not borrow the legacy next port');
  assert.equal(effective.position.eta, '2026-09-01T08:00');
  assert.equal(effective.cargo.items.length, 2, 'free-form Itinerary cargo text must keep two display lines without parsing quantities');
  assert.deepEqual(effective.cargo.items.map(item=>item.name), first.cargoQuantityText.split('\n'), 'free-form cargo must keep each original report line without semantic name/quantity parsing');

  const missing = projection.resolveVesselWithItineraryProjection(vessel, { status: 'missing', document: null, checkedAt: '2026-09-03T12:35:00Z' });
  assert.deepEqual(missing.position, vessel.position, 'confirmed document absence must use the complete legacy position group');
  assert.deepEqual(missing.cargo, vessel.cargo, 'confirmed document absence must use the complete legacy cargo group');

  const sameRevisionDivergent = structuredClone(document);
  sameRevisionDivergent.rows[0].previousPortName = 'REWRITTEN';
  const divergent = projection.mergeItineraryOperationalRecord(readyRecord, sameRevisionDivergent, '2026-09-03T12:36:00Z');
  assert.equal(divergent.status, 'stale');
  assert.equal(divergent.document.rows[0].previousPortName, 'BUSAN', 'same-revision divergent bytes must not replace trusted bytes');
  const older = structuredClone(document); older.revision = 6;
  assert.equal(projection.mergeItineraryOperationalRecord(readyRecord, older, '2026-09-03T12:36:00Z').document.revision, 7);
  const newer = structuredClone(document); newer.revision = 8; newer.rows[0].previousPortName = 'YOKOHAMA';
  assert.equal(projection.mergeItineraryOperationalRecord(readyRecord, newer, '2026-09-03T12:36:00Z').document.revision, 8);

  const records = {
    'v-1': readyRecord,
    'v-2': { status: 'missing', document: null, checkedAt: '2026-09-03T12:35:00Z' },
  };
  const vessel2 = structuredClone(vessel); vessel2.id = 'v-2'; vessel2.position.lastPort = 'LEGACY V2';
  const snapshot = projection.buildItineraryProjectionSnapshot([vessel, vessel2], records, capture);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.itineraryProjections['v-1'].source, 'itinerary');
  assert.equal(snapshot.itineraryProjections['v-2'].source, 'legacy');
  const replayed = projection.applyItineraryProjectionSnapshot([vessel, vessel2], snapshot.itineraryProjections);
  assert.equal(replayed[0].position.lastPort, 'BUSAN');
  assert.equal(replayed[0].position.nextPort, '', 'snapshot is evaluated at capture, not at replay wall clock');
  assert.equal(replayed[1].position.lastPort, 'LEGACY V2');
  assert.throws(
    () => projection.buildItineraryProjectionSnapshot([vessel], { 'v-1': { status: 'error', document: null, checkedAt: null, error: 'offline' } }, '2026-09-03T12:35:00Z'),
    /尚未取得可信的 Itinerary/,
    'formal snapshots must fail closed on an unconfirmed feed',
  );

  const tampered = structuredClone(vessel);
  Object.assign(tampered.position, { lastPort: 'TAMPER', nextPort: 'TAMPER', eta: 'TAMPER', etb: 'TAMPER', etd: 'TAMPER', updatedAt: '2026-09-03T13:00:00Z' });
  Object.assign(tampered.cargo, { name: 'TAMPER', quantity: 'TAMPER', items: [{ name: 'TAMPER', quantity: '' }], updatedAt: '2026-09-03T13:00:00Z' });
  const maskedOnly = drafts.applyItineraryOperationalWriteMask(vessel, tampered);
  assert.deepEqual(maskedOnly.position, vessel.position, 'protected-only tampering must restore fields and avoid a phantom timestamp update');
  assert.deepEqual(maskedOnly.cargo, vessel.cargo);
  assert.equal(drafts.vesselOperationalDraftEquals(vessel, tampered), true, 'equality must ignore protected projection fields');
  tampered.position.location = 'NEW LOCATION';
  tampered.cargo.loadStatus = '滿載';
  const maskedAllowed = drafts.applyItineraryOperationalWriteMask(vessel, tampered);
  assert.equal(maskedAllowed.position.location, vessel.position.location);
  assert.equal(maskedAllowed.position.lastPort, 'LEGACY LAST');
  assert.equal(maskedAllowed.cargo.loadStatus, vessel.cargo.loadStatus);
  assert.equal(maskedAllowed.cargo.items[0].name, 'LEGACY CARGO');

  const smartProtectedOnly = smartShipApi.mergeSmartShipSnapshot(vessel, {
    externalVesselId:'v-1', fetchedAt:'2026-09-03T14:00:00Z', lastPort:'SMART LAST', nextPort:'SMART NEXT',
    eta:'SMART ETA', etb:'SMART ETB', etd:'SMART ETD', cargoItems:[{name:'SMART CARGO',quantity:'9 MT'}],
  });
  assert.deepEqual(smartProtectedOnly.position,vessel.position,'Smart Ship protected-only payload must be a no-op for Itinerary-owned position fields');
  assert.deepEqual(smartProtectedOnly.cargo,vessel.cargo,'Smart Ship must not overwrite Itinerary-owned cargo text');
  assert.equal(smartProtectedOnly.updatedAt,vessel.updatedAt,'ignored Smart Ship fields must not create a phantom vessel update');
  const smartAllowed = smartShipApi.mergeSmartShipSnapshot(vessel, {
    externalVesselId:'v-1', fetchedAt:'2026-09-03T14:00:00Z', location:'PACIFIC', navigationStatus:'航行', loadStatus:'滿載', nextPort:'FORBIDDEN',
  });
  assert.equal(smartAllowed.position.location,vessel.position.location);
  assert.equal(smartAllowed.position.nextPort,'LEGACY NEXT');
  assert.equal(smartAllowed.cargo.loadStatus,vessel.cargo.loadStatus);
  assert.equal(smartAllowed.position.navigationStatus,vessel.position.navigationStatus);
  assert.deepEqual(smartAllowed,vessel,'protected-only Smart Ship snapshot is a complete no-op');
  const fourTampered=structuredClone(vessel);
  Object.assign(fourTampered.position,{location:'NEW',navigationStatus:'停泊',source:'smart-ship-api',updatedAt:'NEW'});
  Object.assign(fourTampered.cargo,{loadStatus:'滿載',source:'smart-ship-api',updatedAt:'NEW'});
  Object.assign(fourTampered.note,{statusList:['drydock/repiar'],updatedAt:'NEW'});
  assert.equal(drafts.vesselOperationalDraftEquals(vessel,fourTampered),true);
  assert.deepEqual(drafts.applyItineraryOperationalWriteMask(vessel,fourTampered),vessel);
  fourTampered.note.captain='NEW CAPTAIN';
  fourTampered.position.manualRemark='NEW REMARK';
  const safe=drafts.applyItineraryOperationalWriteMask(vessel,fourTampered);
  assert.equal(safe.note.captain,'NEW CAPTAIN'); assert.equal(safe.position.manualRemark,'NEW REMARK');
  assert.deepEqual(safe.note.statusList,vessel.note.statusList);
  assert.equal(drafts.vesselOperationalDraftEquals(vessel,fourTampered),false);
  const speed=smartShipApi.mergeSmartShipSnapshot(vessel,{externalVesselId:'v-1',fetchedAt:'NEW',speedKnots:20,location:'FORBIDDEN'});
  assert.equal(speed.position.speedKnots,20);assert.equal(speed.position.location,vessel.position.location);


  const hookSource = fs.readFileSync('src/itinerary/useItineraryOperationalProjection.ts','utf8');
  assert.match(hookSource,/identityVersionRef\.current\.version!==identityVersion/,'late ACK from an old actor/workspace generation must not publish into the current feed');

  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
  const edit = fs.readFileSync('src/EditModals.tsx', 'utf8');
  const batch = fs.readFileSync('src/BatchManagedVesselModal.tsx', 'utf8');
  const smartShip = fs.readFileSync('src/smartShipApi.ts', 'utf8');
  const morning = fs.readFileSync('src/morningHistory.ts', 'utf8');
  const itineraryDashboard = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  assert.match(itineraryDashboard,/const backend = demoMode \? localBackend : cloudBackend;/,'office Itinerary must fail closed instead of falling back to demo storage');
  const migrationPath = 'supabase/migrations/20260903230000_itinerary_daily_morning_projection.sql';
  assert.match(app, /useItineraryOperationalProjection/);
  assert.match(app, /requireFreshItineraryProjection/);
  assert.match(app, /applyItineraryOperationalWriteMask/);
  assert.match(dashboard, /itineraryOperationalFeed/);
  assert.match(edit, /由 Itinerary 正式首列同步/);
  assert.match(batch, /由 Itinerary 正式首列同步/);
  assert.doesNotMatch(edit, /target\.position\.(lastPort|nextPort|eta|etb|etd)\s*=/);
  assert.match(smartShip, /applyItineraryOperationalWriteMask/);
  assert.match(morning, /itineraryProjections/);
  assert.match(itineraryDashboard, /publishConfirmed/);
  assert.equal(fs.existsSync(migrationPath), true);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /'schemaVersion',\s*2/);
  assert.match(sql, /'previousPortName'/);
  assert.match(sql, /'portDockName'/);
  assert.match(sql, /'cargoQuantityText'/);
  assert.match(sql, /'etaUtc'/);
  assert.match(sql, /'etbUtc'/);
  assert.match(sql, /'etdUtc'/);
  assert.match(sql, /rows_payload/);
  assert.doesNotMatch(sql, /alternative_plans_payload/, 'scheduled projections must never read alternative plans');
  assert.match(sql, /revoke all on function public\.sd_build_daily_morning_snapshot\(uuid,timestamptz\) from public,anon,authenticated/);

  console.log('itinerary_operational_projection=PASS');
} finally {
  await server.close();
}
