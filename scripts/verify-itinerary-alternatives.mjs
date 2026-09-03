import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const model = await server.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');

  const document = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v-alt', vesselName: 'TEST VESSEL', rowId: 'formal-row' });
  document.rows[0].previousPortName = 'BUSAN';
  document.rows[0].calculationStartUtc = '2026-09-03T00:00:00Z';
  document.rows[0].calculationStartTimeZone = 'UTC+8';
  assert.deepEqual(document.alternativePlans, [], 'new documents must start without alternative plans');
  assert.equal(types.ITINERARY_MAX_ALTERNATIVE_PLANS, 5);

  const withFirst = model.addShipAlternativePlan(document, 'alternative-1', 'alternative-row-1');
  assert.equal(withFirst.alternativePlans.length, 1);
  assert.equal(withFirst.alternativePlans[0].planId, 'alternative-1');
  assert.equal(withFirst.alternativePlans[0].sortOrder, 0);
  assert.equal(withFirst.alternativePlans[0].rows.length, 1);
  assert.equal(withFirst.alternativePlans[0].rows[0].previousPortName, '', 'alternative rows must not acquire formal previous-port metadata');
  assert.equal(withFirst.alternativePlans[0].rows[0].calculationStartUtc, document.rows[0].calculationStartUtc, 'new alternatives must use the formal first-row calculation anchor');
  assert.equal(withFirst.alternativePlans[0].rows[0].calculationStartTimeZone, document.rows[0].calculationStartTimeZone);
  assert.equal(withFirst.rows[0].voyageNumber, '', 'adding an alternative must not mutate the formal plan');

  const editedAlternative = model.updateShipAlternativePlanRow(withFirst, 'alternative-1', 'alternative-row-1', {
    voyageNumber: 'ALT-V001', portDockName: 'YOKOHAMA', portTimeZone: 'UTC+9', oceanDistanceNm: 120, speedKnots: 12,
  });
  assert.equal(editedAlternative.alternativePlans[0].rows[0].voyageNumber, 'ALT-V001');
  assert.equal(editedAlternative.rows[0].voyageNumber, '', 'alternative input must remain isolated from formal rows');

  const reanchored = model.updateShipDraftRow(editedAlternative, 'formal-row', {
    calculationStartUtc: '2026-09-04T00:00:00Z', calculationStartTimeZone: 'UTC+9',
  });
  assert.equal(reanchored.alternativePlans[0].rows[0].calculationStartUtc, '2026-09-04T00:00:00Z', 'formal anchor edits must be the one shared input for alternatives');
  assert.equal(reanchored.alternativePlans[0].rows[0].calculationStartTimeZone, 'UTC+9');

  const importedFormalRows = structuredClone(document.rows);
  importedFormalRows[0].calculationStartUtc = '2026-09-06T00:00:00Z';
  importedFormalRows[0].calculationStartTimeZone = 'UTC+10';
  const afterFormalImport = model.replaceShipDraftRows(editedAlternative, importedFormalRows);
  assert.equal(afterFormalImport.alternativePlans[0].rows[0].calculationStartUtc, '2026-09-06T00:00:00Z', 'formal Excel imports must live-link alternatives immediately');
  assert.equal(afterFormalImport.alternativePlans[0].rows[0].calculationStartTimeZone, 'UTC+10');

  let withFive = reanchored;
  for (let index = 2; index <= 5; index += 1) withFive = model.addShipAlternativePlan(withFive, `alternative-${index}`, `alternative-row-${index}`);
  assert.deepEqual(withFive.alternativePlans.map(plan => plan.sortOrder), [0, 1, 2, 3, 4]);
  const capped = model.addShipAlternativePlan(withFive, 'alternative-6', 'alternative-row-6');
  assert.equal(capped.alternativePlans.length, 5, 'a sixth alternative must not be created');
  assert.equal(capped.alternativePlans.some(plan => plan.planId === 'alternative-6'), false);

  const blankFormalDraft = model.createShipDraft(editedAlternative, 'blank', 'blank-formal-row');
  assert.equal(blankFormalDraft.rows.length, 1);
  assert.equal(blankFormalDraft.rows[0].rowId, 'blank-formal-row');
  assert.equal(blankFormalDraft.alternativePlans.length, 1, 'starting a blank formal draft must not silently delete alternatives');
  assert.equal(blankFormalDraft.alternativePlans[0].planId, editedAlternative.alternativePlans[0].planId);
  assert.equal(blankFormalDraft.alternativePlans[0].rows[0].portDockName, 'YOKOHAMA');

  const legacyDraftBeforeSave = structuredClone(document);
  delete legacyDraftBeforeSave.alternativePlans;
  const trimmedLegacyDraft = model.trimTrailingBlankShipRows(legacyDraftBeforeSave);
  assert.deepEqual(trimmedLegacyDraft.alternativePlans, [], 'pre-feature drafts must normalize before save trimming instead of throwing');

  const removed = model.removeShipAlternativePlan(withFive, 'alternative-2');
  assert.deepEqual(removed.alternativePlans.map(plan => plan.planId), ['alternative-1', 'alternative-3', 'alternative-4', 'alternative-5']);
  assert.deepEqual(removed.alternativePlans.map(plan => plan.sortOrder), [0, 1, 2, 3], 'remaining alternatives must be renumbered by display order');

  let createdId = 0;
  const promoted = model.promoteShipAlternativePlanToDraft(reanchored, 'alternative-1', () => `promoted-${++createdId}`);
  assert.equal(promoted.rows[0].rowId, 'promoted-1');
  assert.equal(promoted.rows[0].voyageNumber, 'ALT-V001');
  assert.equal(promoted.rows[0].previousPortName, 'BUSAN', 'promotion must preserve the current formal previous port');
  assert.equal(promoted.rows[0].calculationStartUtc, '2026-09-04T00:00:00Z', 'promotion must retain the current shared calculation anchor');
  assert.equal(promoted.alternativePlans.length, 1, 'promotion must retain the source alternative');
  assert.equal(promoted.alternativePlans[0].rows[0].rowId, 'alternative-row-1', 'formal and alternative rows must retain independent identities');

  const changedFormal = model.updateShipDraftRow(promoted, 'promoted-1', { voyageNumber: 'FORMAL-EDIT' });
  assert.equal(changedFormal.alternativePlans[0].rows[0].voyageNumber, 'ALT-V001', 'editing promoted formal rows must not back-write the retained alternative');

  const alternativeWithTwoRows = model.addShipAlternativePlanRow(editedAlternative, 'alternative-1', 'alternative-row-2');
  assert.equal(alternativeWithTwoRows.alternativePlans[0].rows.length, 2);
  assert.equal(alternativeWithTwoRows.alternativePlans[0].rows[1].calculationStartUtc, null, 'only the first alternative row may carry the shared anchor');
  const automaticAlternative = model.setShipAlternativeAutomaticCalculation(alternativeWithTwoRows, 'alternative-1');
  assert.equal(automaticAlternative.document.rows[0].rowId, 'formal-row', 'alternative calculation must return the untouched formal plan');
  assert.equal(automaticAlternative.document.alternativePlans[0].rows.every(row => row.etaMode === 'auto' && row.etbMode === 'auto' && row.etcMode === 'auto' && row.etdMode === 'auto'), true);
  const manualAlternative = model.setAllShipAlternativeTimesManual(automaticAlternative.document, 'alternative-1');
  assert.equal(manualAlternative.alternativePlans[0].rows.every(row => row.etaMode === 'manual' && row.etbMode === 'manual' && row.etcMode === 'manual' && row.etdMode === 'manual'), true);
  const removedAlternativeFirstRow = model.removeShipAlternativePlanRow(manualAlternative, 'alternative-1', 'alternative-row-1');
  assert.equal(removedAlternativeFirstRow.alternativePlans[0].rows.length, 1);
  assert.equal(removedAlternativeFirstRow.alternativePlans[0].rows[0].rowId, 'alternative-row-2');
  assert.equal(removedAlternativeFirstRow.alternativePlans[0].rows[0].calculationStartUtc, document.rows[0].calculationStartUtc, 'the new first row must reacquire the formal shared anchor');
  assert.equal(removedAlternativeFirstRow.alternativePlans[0].rows[0].previousPortName, '');

  const trimmedAlternatives = model.trimTrailingBlankShipRows(alternativeWithTwoRows);
  assert.equal(trimmedAlternatives.alternativePlans[0].rows.length, 1, 'save trimming must apply the same trailing-blank rule to alternatives');
  assert.equal(trimmedAlternatives.alternativePlans[0].rows[0].rowId, 'alternative-row-1');

  const validation = await server.ssrLoadModule('/src/itinerary/itineraryValidation.ts');
  const legacy = structuredClone(document);
  delete legacy.alternativePlans;
  const legacyResult = validation.validateItineraryDocument(legacy);
  assert.equal(legacyResult.ok, true, 'legacy documents without alternativePlans must remain readable');
  assert.deepEqual(legacyResult.value.alternativePlans, [], 'legacy documents must normalize to an empty alternative collection');
  for (const malformedRows of [null, [null]]) {
    const malformedDocument = structuredClone(document);
    malformedDocument.rows = malformedRows;
    malformedDocument.alternativePlans = [];
    const malformedResult = validation.validateItineraryDocument(malformedDocument);
    assert.equal(malformedResult.ok, false, 'malformed formal rows must return validation errors without throwing');
    assert.equal(malformedResult.errors.some(error => error.path === 'rows' || error.path.startsWith('rows[')), true);
  }
  assert.equal(validation.validateItineraryDocument(editedAlternative).ok, true, 'a valid isolated alternative must pass document validation');

  const tooMany = structuredClone(withFive);
  tooMany.alternativePlans.push({ ...structuredClone(withFive.alternativePlans[0]), planId: 'alternative-6', sortOrder: 5 });
  const tooManyResult = validation.validateItineraryDocument(tooMany);
  assert.equal(tooManyResult.ok, false);
  assert.equal(tooManyResult.errors.some(error => error.path === 'alternativePlans'), true);

  const duplicateId = structuredClone(withFive);
  duplicateId.alternativePlans[1].planId = duplicateId.alternativePlans[0].planId;
  assert.equal(validation.validateItineraryDocument(duplicateId).ok, false, 'duplicate alternative identities must be rejected');
  const contaminated = structuredClone(editedAlternative);
  contaminated.alternativePlans[0].rows[0].previousPortName = 'SHOULD NOT LEAK';
  assert.equal(validation.validateItineraryDocument(contaminated).ok, false, 'alternative rows must reject formal previous-port metadata');
  const mismatchedAnchor = structuredClone(editedAlternative);
  mismatchedAnchor.alternativePlans[0].rows[0].calculationStartUtc = '2026-09-05T00:00:00Z';
  const mismatchedAnchorResult = validation.validateItineraryDocument(mismatchedAnchor);
  assert.equal(mismatchedAnchorResult.ok, false, 'alternative anchors must match the formal first row at the validation boundary');
  assert.equal(mismatchedAnchorResult.errors.some(error => error.code === 'alternative-anchor-mismatch'), true);
  const duplicateCrossDimensionRowId = structuredClone(editedAlternative);
  duplicateCrossDimensionRowId.alternativePlans[0].rows[0].rowId = 'formal-row';
  const duplicateCrossDimensionResult = validation.validateItineraryDocument(duplicateCrossDimensionRowId);
  assert.equal(duplicateCrossDimensionResult.ok, false, 'formal and alternative rows must not share identities');
  assert.equal(duplicateCrossDimensionResult.errors.some(error => error.code === 'duplicate-row-id'), true);

  const editorModule = await server.ssrLoadModule('/src/itinerary/ShipItineraryEditor.tsx');
  const editorMarkup = renderToStaticMarkup(React.createElement(editorModule.default, {
    document: editedAlternative,
    readOnly: false,
    canSave: true,
    remoteUpdated: false,
    saving: false,
    onChange: () => undefined,
    onSave: () => undefined,
    onCancel: () => undefined,
    onClosePreservingDraft: () => undefined,
    onDiscardDraft: () => undefined,
    onSyncLatest: () => undefined,
    onExportDraft: () => undefined,
  }));
  assert.match(editorMarkup, /增加備選計劃/);
  assert.match(editorMarkup, /備選方案1/);
  assert.match(editorMarkup, /備選方案1 輸入與計算區/);
  assert.match(editorMarkup, /備選方案1 自動計算參數區/);
  assert.match(editorMarkup, /首列 ETA 起算沿用正式方案/);
  assert.match(editorMarkup, /帶入正式草稿/);
  assert.match(editorMarkup, /刪除備選方案1/);
  assert.equal((editorMarkup.match(/ship-editor-main-table/g) || []).length, 2, 'formal and alternative plans must use the same input table implementation');
  assert.equal((editorMarkup.match(/ship-editor-parameter-table/g) || []).length, 2, 'formal and alternative plans must use the same parameter table implementation');
  assert.equal((editorMarkup.match(/name="previousPortName"/g) || []).length, 1, 'previous port must remain a formal-only field');

  const alternativesBrowseModule = await server.ssrLoadModule('/src/itinerary/ShipItineraryAlternativesBrowse.tsx');
  const browseMarkup = renderToStaticMarkup(React.createElement(alternativesBrowseModule.ShipItineraryAlternativesBrowse, {
    document: editedAlternative,
  }));
  assert.match(browseMarkup, /瀏覽備選方案/);
  assert.match(browseMarkup, /備選方案1/);
  assert.match(browseMarkup, /只在船端顯示/);
  assert.doesNotMatch(browseMarkup, /previousPortName|上一港/, 'formal previous-port metadata must not appear in alternative browse modules');
  assert.equal((browseMarkup.match(/itinerary-browse-scroll/g) || []).length, 1, 'every alternative must reuse the formal browse table');

  const portalSource = fs.readFileSync('src/itinerary/ShipItineraryPortal.tsx', 'utf8');
  assert.match(portalSource, /import \{ ShipItineraryAlternativesBrowse \} from '\.\/ShipItineraryAlternativesBrowse';/, 'the ship portal must import the alternative browse projection');
  assert.match(portalSource, /\{selectedVesselId && latest && !editor && <ShipItineraryAlternativesBrowse document=\{latest\} \/>\}/, 'alternatives must render only in the ship-side browse branch');
  assert.match(portalSource, /downloadItineraryWorkbookWithAlternatives/, 'the ship portal must use the combined workbook exporter');
  assert.match(portalSource, /latest\.alternativePlans\?\.length[^\n]*匯出正式＋備選 Excel/, 'combined export must be a separate browse-mode action shown only when alternatives exist');
  assert.match(portalSource, /prepareEmailReport[\s\S]*?exportDocument\(document, 'Itinerary'\)/, 'email preparation must remain formal-only');
  assert.match(portalSource, /exportDocument\(editor\.draft, 'Itinerary_Draft'\)/, 'draft export must remain formal-only');

  const dashboardSource = fs.readFileSync('src/itinerary/ItineraryDashboard.tsx', 'utf8');
  const shipLink = /<a href=\{`\$\{import\.meta\.env\.BASE_URL\}ship-itinerary\.html`\} target="_blank" rel="noopener noreferrer"[^>]*>打開船端網頁<\/a>/;
  assert.match(dashboardSource, shipLink, 'the main itinerary board needs a deployment-safe, opener-isolated ship portal link');
  assert.ok(dashboardSource.indexOf('打開船端網頁') < dashboardSource.indexOf('選取目前可見'), 'the ship portal link must appear before visible-selection controls');
  assert.doesNotMatch(dashboardSource.match(shipLink)?.[0] ?? '', /[?&](?:vessel|role|token|session|user)=/i, 'the main-page link must not pass vessel selection or credentials');
  const dashboardCss = fs.readFileSync('src/itinerary/itinerary.css', 'utf8');
  assert.match(dashboardCss, /\.itinerary-ship-link\{[^}]*text-decoration:none[^}]*background:/, 'the ship portal link must be visibly styled as a toolbar action');

  const shipCss = fs.readFileSync('src/itinerary/shipItinerary.css', 'utf8');
  assert.match(shipCss, /\.ship-alternative-plans\{[^}]*display:grid[^}]*gap:/, 'alternative modules must stack with explicit separation');
  assert.match(shipCss, /\.ship-alternative-plan\{[^}]*min-width:0[^}]*border:/, 'each alternative needs a bounded full-width module');
  assert.match(shipCss, /\.ship-alternative-actions\{[^}]*flex-wrap:wrap/, 'alternative actions must wrap instead of overflowing');
  assert.match(shipCss, /@media\(max-width:900px\)\{[\s\S]*\.ship-alternative-head\{[^}]*align-items:flex-start/, 'narrow layouts must keep alternative headings and actions readable');
  assert.match(shipCss, /\.ship-alternative-browse\{[^}]*display:grid[^}]*min-width:0/, 'alternative browse modules need their own bounded ship-side section');
  assert.match(shipCss, /\.ship-alternative-browse-card\{[^}]*overflow:hidden[^}]*border:/, 'each browsed alternative must contain its shared table');

  console.log('itinerary_alternative_model=PASS');
  console.log('itinerary_alternative_validation=PASS');
  console.log('itinerary_alternative_editor_render=PASS');
} finally {
  await server.close();
}
