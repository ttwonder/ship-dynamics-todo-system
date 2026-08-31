import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const rollout = await server.ssrLoadModule('/src/itinerary/itineraryRollout.ts');
  const model = await server.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');

  assert.equal(rollout.localShipPortalDemoRequested({ hostname: '127.0.0.1', search: '?itineraryDemo=1' }), true);
  assert.equal(rollout.localShipPortalDemoRequested({ hostname: 'example.com', search: '?itineraryDemo=1' }), false);

  const latest = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v1', vesselName: 'TEST', rowId: 'base-row' });
  latest.revision = 9;
  latest.rows[0].voyageNumber = 'OLD';
  const blank = model.createShipDraft(latest, 'blank', 'blank-row');
  assert.equal(blank.revision, 9);
  assert.equal(blank.rows.length, 1);
  assert.equal(blank.rows[0].voyageNumber, '');
  assert.equal(blank.rows[0].etaMode, 'manual');
  assert.equal(blank.rows[0].etbMode, 'auto');
  assert.equal(model.hasShipDraftBusinessContent(blank), false);
  const fromLatest = model.createShipDraft(latest, 'latest');
  assert.equal(fromLatest.rows[0].voyageNumber, 'OLD');
  assert.notEqual(fromLatest, latest);

  const withSecond = model.addShipDraftRow(blank, 'row-2');
  assert.equal(model.hasShipDraftBusinessContent(withSecond), false);
  assert.equal(withSecond.rows.length, 2);
  assert.deepEqual(withSecond.rows.map(row => row.sortOrder), [0, 1]);
  assert.equal(model.trimTrailingBlankShipRows(withSecond).rows.length, 1);
  assert.equal(model.removeShipDraftRow(withSecond, 'row-2').rows.length, 1);
  assert.equal(model.removeShipDraftRow(blank, 'blank-row').rows.length, 1);
  assert.equal(model.hasRemoteItineraryUpdate(9, 10), true);
  assert.equal(model.hasRemoteItineraryUpdate(9, 9), false);

  const html = fs.readFileSync('ship-itinerary.html', 'utf8');
  const entry = fs.readFileSync('src/ship-itinerary-main.tsx', 'utf8');
  assert.ok(html.includes('/src/ship-itinerary-main.tsx'));
  assert.ok(!entry.includes("from './App'"));
  assert.ok(entry.includes('ShipItineraryPortal'));
  console.log('ship_itinerary_portal_model=PASS');
} finally {
  await server.close();
}
