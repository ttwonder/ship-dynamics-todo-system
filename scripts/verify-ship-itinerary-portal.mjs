import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const rollout = await server.ssrLoadModule('/src/itinerary/itineraryRollout.ts');
  const model = await server.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const layoutPath = 'src/itinerary/itineraryFieldLayout.ts';
  assert.equal(fs.existsSync(layoutPath), true, 'main and ship editors need one shared field layout authority');
  const layout = await server.ssrLoadModule(`/${layoutPath}`);
  assert.deepEqual(layout.ITINERARY_MAIN_FIELD_LABELS, ['Voy No.','Port & Dock Name','L / U','B/F or I/F Qty (MT)','ETA (LT)','ETB (LT)','L/D rate','ETC (LT)','ETD (LT)','Arr Draft','Dep Draft','arr ROB','dep ROB']);

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

  const automaticSource = model.addShipDraftRow(blank, 'auto-row-2');
  Object.assign(automaticSource.rows[0], { portTimeZone: 'UTC+8', etaUtc: '2026-09-01T00:00:00Z', etaMode: 'manual', berthWaitHours: 2, operationQuantityMt: 1000, operationRateMtPerHour: 250, departureBufferDays: 0.25, oceanDistanceNm: 120, speedKnots: 12 });
  Object.assign(automaticSource.rows[1], { portTimeZone: 'UTC+9', berthWaitHours: 1, operationQuantityMt: 500, operationRateMtPerHour: 100, departureBufferDays: 0.25 });
  const automatic = model.setShipAutomaticCalculation(automaticSource);
  assert.equal(automatic.missing.length, 0);
  assert.deepEqual(automatic.document.rows.map(row => [row.etaMode,row.etbMode,row.etcMode,row.etdMode]), [['manual','auto','auto','auto'],['auto','auto','auto','auto']]);
  assert.equal(automatic.document.rows[1].etaUtc, '2026-09-01T22:00:00Z');
  const recalculated = model.updateShipDraftRow(automatic.document, automatic.document.rows[0].rowId, { speedKnots: 10 });
  assert.equal(recalculated.rows[1].etaUtc, '2026-09-02T00:00:00Z', 'parameter edits must immediately recalculate downstream auto fields');
  const manual = model.setAllShipTimesManual(recalculated);
  assert.ok(manual.rows.every(row => [row.etaMode,row.etbMode,row.etcMode,row.etdMode].every(mode => mode === 'manual')));
  assert.equal(manual.rows[1].etaUtc, recalculated.rows[1].etaUtc, 'manual switch must preserve the latest calculated values');
  const incompleteAutomatic = model.setShipAutomaticCalculation(withSecond);
  assert.ok(incompleteAutomatic.missing.some(item => item.rowNumber === 1 && item.field === 'etaUtc'));
  assert.ok(incompleteAutomatic.missing.some(item => item.field === 'portTimeZone'));
  assert.ok(incompleteAutomatic.missing.some(item => item.field === 'operationRateMtPerHour'));

  const html = fs.readFileSync('ship-itinerary.html', 'utf8');
  const entry = fs.readFileSync('src/ship-itinerary-main.tsx', 'utf8');
  const portal = fs.readFileSync('src/itinerary/ShipItineraryPortal.tsx', 'utf8');
  const editor = fs.readFileSync('src/itinerary/ShipItineraryEditor.tsx', 'utf8');
  const panel = fs.readFileSync('src/itinerary/ItineraryPanel.tsx', 'utf8');
  const css = fs.readFileSync('src/itinerary/shipItinerary.css', 'utf8');
  assert.ok(html.includes('/src/ship-itinerary-main.tsx'));
  assert.ok(!entry.includes("from './App'"));
  assert.ok(entry.includes('ShipItineraryPortal'));
  const startEditingBlock = portal.slice(portal.indexOf("const startEditing = async"), portal.indexOf('const closeEditor ='));
  const startClaimIndex = startEditingBlock.indexOf('claimLease');
  const startLoadIndex = startEditingBlock.indexOf('backend.loadDocument');
  const startDraftIndex = startEditingBlock.indexOf('createShipDraft(editingBase, mode)');
  assert.ok(startClaimIndex >= 0 && startLoadIndex > startClaimIndex && startDraftIndex > startLoadIndex, 'ship editing must claim, reload the authoritative document, then create its draft');
  const syncLatestBlock = portal.slice(portal.indexOf('const syncLatest = async'), portal.indexOf('const importFile ='));
  const syncClaimIndex = syncLatestBlock.indexOf('claimLease');
  const syncLoadIndex = syncLatestBlock.indexOf('backend.loadDocument');
  const syncEditorIndex = syncLatestBlock.indexOf('setEditor');
  assert.ok(syncClaimIndex >= 0 && syncLoadIndex > syncClaimIndex && syncEditorIndex > syncLoadIndex, 'sync latest must claim, reload authority, then replace the editor base');
  assert.ok((portal.match(/setLatest\(previous => selectLatestItineraryDocument\(previous,/g) || []).length >= 4, 'initial load, polling, edit reload and sync reload must all publish monotonically');
  assert.match(editor, /ship-editor-workspace/);
  assert.match(editor, /ship-editor-main-pane/);
  assert.match(editor, /ship-editor-parameter-pane/);
  assert.match(css, /\.ship-editor-workspace\{[^}]*grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /prefers-color-scheme:dark/);
  assert.match(css, /--ship-card:#fff/);
  assert.doesNotMatch(editor, /<th>[A-W]\s/);
  assert.match(editor, /全部手動輸入/);
  assert.match(editor, /一鍵自動計算/);
  assert.match(editor, /ITINERARY_MAIN_FIELD_LABELS/);
  assert.match(panel, /ITINERARY_MAIN_FIELD_LABELS/);
  assert.match(portal, /dashboardVesselDisplayName/, 'ship selector and headings must use the main dashboard vessel naming rule');
  assert.match(portal, /ITINERARY_MAIN_FIELD_LABELS/, 'ship latest view must expose the same A:M columns as the main dashboard');
  console.log('ship_itinerary_portal_model=PASS');
} finally {
  await server.close();
}
