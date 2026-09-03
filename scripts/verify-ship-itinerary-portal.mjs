import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

function firstRenderedHeaderTexts(markup) {
  const row = markup.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  assert.ok(row, 'rendered table must contain a header row');
  return [...row[1].matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g)]
    .map(match => match[1].replace(/<[^>]+>/g, ''));
}

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const model = await server.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const layoutPath = 'src/itinerary/itineraryFieldLayout.ts';
  assert.equal(fs.existsSync(layoutPath), true, 'main and ship editors need one shared field layout authority');
  const layout = await server.ssrLoadModule(`/${layoutPath}`);
  assert.deepEqual(layout.ITINERARY_MAIN_FIELD_LABELS, ['Voy No.','Next Port & Dock Name','Destination\nUTC Offset','Purpose','B/F or I/F Qty (MT/BBLS)','ETA (LT)','ETB (LT)','預計L/D rate (MT/h)','ETC (LT)','ETD (LT)','Arr Draft','Dep Draft','Arr ROB\n(Cargo/Fuel/FW)','Dep ROB\n(Cargo/Fuel/FW)','備註信息']);
  assert.deepEqual(layout.ITINERARY_PARAMETER_FIELD_LABELS, ['DTG(NM)','預估航速(kn)','剩餘航行時間(h)','預估等待時間(靠泊前)(h)','預計航道航行時間(h)','作業艙號','裝卸貨量(MT)','預計L/D rate (MT/h)','預計作業時間(h)','預估等待/延誤時間(完貨前)(h)','預估等待/延誤時間(完貨後)(h)']);
  assert.deepEqual(layout.ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS, [70,175,96,155,155,246,246,80,246,246,98,98,147,147,175]);
  assert.deepEqual(layout.ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS, [82,82,82,82,82,135,100,82,82,82,82]);
  assert.equal(layout.ITINERARY_EDITOR_MAIN_TABLE_WIDTH, 2450);
  assert.equal(layout.ITINERARY_EDITOR_PARAMETER_TABLE_WIDTH, 1007);
  assert.equal(layout.ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS[7], 80, 'main L/D rate must be twice its former 40px width');
  assert.deepEqual([5,6,8,9].map(index => layout.ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS[index]), [246,246,246,246], 'all four LT editor columns must be equally wide');
  assert.deepEqual([0,1,2,3,4,7,8,9,10].map(index => layout.ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS[index]), Array(9).fill(82), 'DTG and all eight requested estimate columns must match');
  assert.deepEqual(layout.ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS, [74,170,92,150,175,142,142,105,142,142,105,105,145,145,170]);
  assert.deepEqual(layout.ITINERARY_BROWSE_PARAMETER_COLUMN_WIDTHS, Array(11).fill(100));
  assert.equal(layout.ITINERARY_BROWSE_MAIN_TABLE_WIDTH, 2004);
  assert.equal(layout.ITINERARY_BROWSE_EXPANDED_TABLE_WIDTH, 3104);
  assert.deepEqual([5,6,8,9].map(index => layout.ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS[index]), [142,142,142,142], 'browse ETA/ETB/ETC/ETD columns must be equal and wide enough for complete local time');
  assert.equal(layout.ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS[14], layout.ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS[1], 'Notes and Next Port columns must have the same browse width');


  const latest = types.createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v1', vesselName: 'TEST', rowId: 'base-row' });
  latest.revision = 9;
  latest.rows[0].voyageNumber = 'OLD';
  const blank = model.createShipDraft(latest, 'blank', 'blank-row');
  assert.equal(blank.revision, 9);
  assert.equal(blank.rows.length, 1);
  assert.equal(blank.rows[0].voyageNumber, '');
  assert.equal(blank.rows[0].arrivalDraftText, 'A:\nF:', 'new rows must prefill Arr Draft as two editable A/F lines');
  assert.equal(blank.rows[0].departureDraftText, 'A:\nF:', 'new rows must prefill Dep Draft as two editable A/F lines');
  assert.equal(blank.rows[0].notesText, '');
  assert.equal(blank.rows[0].etaMode, 'manual');
  assert.equal(blank.rows[0].etbMode, 'auto');
  assert.equal(model.hasShipDraftBusinessContent(blank), false);
  const legacyDraftWithoutNotes = structuredClone(blank);
  delete legacyDraftWithoutNotes.rows[0].notesText;
  assert.equal(model.hasShipDraftBusinessContent(legacyDraftWithoutNotes), false, 'a pre-notes local draft must remain openable');
  const noteOnly = model.updateShipDraftRow(blank, blank.rows[0].rowId, { notesText: '靠港前請再次確認' });
  assert.equal(model.hasShipDraftBusinessContent(noteOnly), true, 'a note-only row is meaningful itinerary content');
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
  const anchoredRows = model.addShipDraftRow(blank, 'new-first-after-delete');
  Object.assign(anchoredRows.rows[0], { calculationStartUtc: '2026-09-01T00:00:00Z', calculationStartTimeZone: 'UTC+8' });
  const afterFirstRemoval = model.removeShipDraftRow(anchoredRows, anchoredRows.rows[0].rowId);
  assert.equal(afterFirstRemoval.rows[0].calculationStartUtc, '2026-09-01T00:00:00Z', 'deleting row one must transfer the ETA calculation anchor to the new first row');
  assert.equal(afterFirstRemoval.rows[0].calculationStartTimeZone, 'UTC+8');
  const anchoredThree = model.addShipDraftRow(model.addShipDraftRow(blank, 'anchor-row-2'), 'anchor-row-3');
  Object.assign(anchoredThree.rows[0], { calculationStartUtc: '2026-09-01T00:00:00Z', calculationStartTimeZone: 'UTC+8' });
  const afterLaterRemoval = model.removeShipDraftRow(anchoredThree, 'anchor-row-3');
  assert.equal(afterLaterRemoval.rows[0].calculationStartUtc, '2026-09-01T00:00:00Z', 'deleting a later row must not alter the first-row anchor');
  assert.equal(model.hasRemoteItineraryUpdate(9, 10), true);
  assert.equal(model.hasRemoteItineraryUpdate(9, 9), false);

  const automaticSource = model.addShipDraftRow(blank, 'auto-row-2');
  Object.assign(automaticSource.rows[0], { portTimeZone: 'UTC+8', calculationStartUtc: '2026-09-01T00:00:00Z', calculationStartTimeZone: 'UTC+8', berthWaitHours: 2, operationQuantityMt: 1000, operationRateMtPerHour: 250, postCompletionDelayHours: 6, oceanDistanceNm: 120, speedKnots: 12 });
  Object.assign(automaticSource.rows[1], { portTimeZone: 'UTC+9', berthWaitHours: 1, operationQuantityMt: 500, operationRateMtPerHour: 100, postCompletionDelayHours: 6, oceanDistanceNm: 60, speedKnots: 12 });
  const automatic = model.setShipAutomaticCalculation(automaticSource);
  assert.equal(automatic.missing.length, 0);
  assert.deepEqual(automatic.document.rows.map(row => [row.etaMode,row.etbMode,row.etcMode,row.etdMode]), [['auto','auto','auto','auto'],['auto','auto','auto','auto']]);
  assert.equal(automatic.document.rows[0].etaUtc, '2026-09-01T10:00:00Z');
  assert.equal(automatic.document.rows[1].etaUtc, '2026-09-02T03:00:00Z');
  const recalculated = model.updateShipDraftRow(automatic.document, automatic.document.rows[1].rowId, { speedKnots: 10 });
  assert.equal(recalculated.rows[1].etaUtc, '2026-09-02T04:00:00Z', 'the current row DTG/speed must immediately recalculate its own ETA');
  const rateSynced = model.updateShipDraftRow(recalculated, recalculated.rows[0].rowId, { ldRateText: '450 MT/h' });
  assert.equal(rateSynced.rows[0].operationRateMtPerHour, 450, 'parameter L/D rate must come from the left input');
  const rateCleared = model.updateShipDraftRow(rateSynced, rateSynced.rows[0].rowId, { ldRateText: '' });
  assert.equal(rateCleared.rows[0].operationRateMtPerHour, null);

  const demoData = await server.ssrLoadModule('/src/itinerary/itineraryDemoData.ts');
  const demo = demoData.createDemoItineraryDocument({
    id: 'demo-vessel', name: 'DEMO VESSEL', shortName: 'DEMO', fullName: 'DEMO VESSEL',
    position: { lastPort: 'KAOHSIUNG', nextPort: 'ULSAN', location: 'AT SEA' },
    cargo: { loadStatus: '空載', items: [] },
  }, 0, Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(demo.rows[0].calculationStartUtc, '2026-09-01T00:00:00Z');
  assert.equal(demo.rows[0].calculationStartTimeZone, 'UTC+8');
  assert.equal(demo.rows[0].etaMode, 'auto');
  assert.equal(demo.rows[0].channelSailingHours, 1);
  assert.equal(demo.rows[0].preCompletionDelayHours, 1);
  assert.equal(demo.rows[0].postCompletionDelayHours, 6);
  assert.equal(demo.rows[0].departureBufferDays, null);
  assert.equal(demo.rows[1].etbTimeZone, 'UTC+8:45');
  const manual = model.setAllShipTimesManual(recalculated);
  assert.ok(manual.rows.every(row => [row.etaMode,row.etbMode,row.etcMode,row.etdMode].every(mode => mode === 'manual')));
  assert.equal(manual.rows[1].etaUtc, recalculated.rows[1].etaUtc, 'manual switch must preserve the latest calculated values');
  const incompleteAutomatic = model.setShipAutomaticCalculation(withSecond);
  assert.ok(incompleteAutomatic.missing.some(item => item.rowNumber === 1 && item.field === 'calculationStartUtc'));
  assert.ok(incompleteAutomatic.missing.some(item => item.rowNumber === 1 && item.field === 'calculationStartTimeZone'));
  assert.ok(incompleteAutomatic.missing.some(item => item.field === 'portTimeZone'));
  assert.equal(incompleteAutomatic.missing.some(item => item.field === 'operationRateMtPerHour'), false, 'optional calculation inputs must not block automatic calculation');
  assert.equal(incompleteAutomatic.missing.some(item => item.field === 'berthWaitHours'), false);

  const zoneRow = types.createBlankItineraryRow('zone-row', 0);
  Object.assign(zoneRow, { portTimeZone: 'UTC+8', etaUtc: '2026-09-01T00:00:00Z', etbUtc: '2026-09-01T02:00:00Z', etbTimeZone: 'UTC+7' });
  const etaZonePatch = model.shipTimeZonePatch(zoneRow, 'etaUtc', 'UTC+9');
  assert.equal(etaZonePatch.etaTimeZone, 'UTC+9');
  assert.equal(etaZonePatch.etaUtc, '2026-08-31T23:00:00Z', 'changing an LT offset must preserve the visible local clock value');
  const portZonePatch = model.shipPortTimeZonePatch(zoneRow, 'UTC+9');
  assert.equal(portZonePatch.portTimeZone, 'UTC+9');
  assert.equal(portZonePatch.etaUtc, '2026-08-31T23:00:00Z', 'port offset changes reinterpret only fields still following the port');
  assert.equal(portZonePatch.etbUtc, undefined, 'an explicitly overridden LT offset must remain untouched');
  Object.assign(zoneRow, { calculationStartUtc: '2026-09-01T00:00:00Z', calculationStartTimeZone: 'UTC+8' });
  const startZonePatch = model.shipCalculationStartTimeZonePatch(zoneRow, 'UTC+9');
  assert.equal(startZonePatch.calculationStartTimeZone, 'UTC+9');
  assert.equal(startZonePatch.calculationStartUtc, '2026-08-31T23:00:00Z');

  const html = fs.readFileSync('ship-itinerary.html', 'utf8');
  const entry = fs.readFileSync('src/ship-itinerary-main.tsx', 'utf8');
  const portal = fs.readFileSync('src/itinerary/ShipItineraryPortal.tsx', 'utf8');
  assert.doesNotMatch(portal, /useShipPortalRollout|rollout\.enabled|rollout\.loading|Itinerary 尚未開放|正在確認 Itinerary 開放狀態/, 'ship input page must stay open without a rollout gate');
  assert.match(portal, /const demoMode = localShipPortalDemoRequested\(\)/, 'local QA data must remain isolated after rollout removal');
  const editor = fs.readFileSync('src/itinerary/ShipItineraryEditor.tsx', 'utf8');
  const shipEditorModule = await server.ssrLoadModule('/src/itinerary/ShipItineraryEditor.tsx');
  const shipEditorMarkup = renderToStaticMarkup(createElement(shipEditorModule.default, {
    document: blank, readOnly: false, canSave: false, remoteUpdated: false, saving: false,
    onChange() {}, onSave() {}, onCancel() {}, onClosePreservingDraft() {}, onDiscardDraft() {}, onSyncLatest() {}, onExportDraft() {},
  }));
  const shipMainHeaderTexts = firstRenderedHeaderTexts(shipEditorMarkup);
  assert.equal(shipMainHeaderTexts.length, 17, 'ship main editor must retain # + 15 fields + action');
  assert.equal(shipMainHeaderTexts[3], 'Destination\nUTC Offset', 'ship editor third data column must render the shared Destination UTC Offset heading');
  const panel = fs.readFileSync('src/itinerary/ItineraryPanel.tsx', 'utf8');
  const officeEditor = fs.readFileSync('src/itinerary/ItineraryEditor.tsx', 'utf8');
  const dateInput = fs.readFileSync('src/itinerary/ItineraryDateInput.tsx', 'utf8');
  const timeInputPath = 'src/itinerary/ItineraryTimeInput.tsx';
  const numericInputPath = 'src/itinerary/ItineraryNumericInput.tsx';
  const briefDialogPath = 'src/itinerary/ShipItineraryBriefDialog.tsx';
  assert.equal(fs.existsSync(timeInputPath), true, 'Owner and ship time editing need one caret-stable input');
  const timeInput = fs.readFileSync(timeInputPath, 'utf8');
  const purposeInput = fs.readFileSync('src/itinerary/ItineraryOperationOptions.tsx', 'utf8');
  const css = fs.readFileSync('src/itinerary/shipItinerary.css', 'utf8');
  const officeCompactCss = fs.readFileSync('src/itinerary/itineraryCompact.css', 'utf8');
  const browsePath = 'src/itinerary/ItineraryBrowseTable.tsx';
  const browseCssPath = 'src/itinerary/itineraryBrowseTable.css';
  assert.equal(fs.existsSync(browsePath), true, 'main and ship browse views need one shared table renderer');
  assert.equal(fs.existsSync(browseCssPath), true, 'shared browse geometry must come from one stylesheet');
  const browseSource = fs.readFileSync(browsePath, 'utf8');
  const browseCss = fs.readFileSync(browseCssPath, 'utf8');
  const browseModule = await server.ssrLoadModule(`/${browsePath}`);
  const browseRow = types.createBlankItineraryRow('browse-row', 0);
  Object.assign(browseRow, {
    voyageNumber: 'V-120', portDockName: 'KAOHSIUNG NO. 72', portTimeZone: 'UTC+8', operation: 'To Load',
    cargoQuantityText: '10,000 MT', etaUtc: '2026-09-01T00:00:00Z', etbUtc: '2026-09-01T02:00:00Z',
    etcUtc: '2026-09-01T08:00:00Z', etdUtc: '2026-09-01T10:00:00Z', ldRateText: '500',
    notesText: '靠港前請確認拖輪', oceanDistanceNm: 120, speedKnots: 12, berthWaitHours: 2,
    channelSailingHours: 1, tanksText: '1P / 1S', operationQuantityMt: 1000,
    operationRateMtPerHour: 250, preCompletionDelayHours: 1, postCompletionDelayHours: 6,
  });
  const collapsedBrowse = renderToStaticMarkup(createElement(browseModule.ItineraryBrowseTable, { rows: [browseRow], showMoreParameters: false, ariaLabel: 'collapsed itinerary' }));
  const expandedBrowse = renderToStaticMarkup(createElement(browseModule.ItineraryBrowseTable, { rows: [browseRow], showMoreParameters: true, ariaLabel: 'expanded itinerary' }));
  const collapsedBrowseHeaderTexts = firstRenderedHeaderTexts(collapsedBrowse);
  assert.equal(collapsedBrowseHeaderTexts.length, 15, 'shared browse table must retain its 15 main columns');
  assert.equal(collapsedBrowseHeaderTexts[2], 'Destination\nUTC Offset', 'main and ship browse third column must render the shared Destination UTC Offset heading');
  assert.match(collapsedBrowse, /Arr ROB\n\(Cargo\/Fuel\/FW\)/, 'shared Owner and ship browse header must render Arr ROB on two lines');
  assert.match(collapsedBrowse, /Dep ROB\n\(Cargo\/Fuel\/FW\)/, 'shared Owner and ship browse header must render Dep ROB on two lines');
  assert.match(collapsedBrowse, /備註信息/);
  assert.match(collapsedBrowse, /靠港前請確認拖輪/);
  assert.doesNotMatch(collapsedBrowse, /DTG\(NM\)/, 'estimate parameters must stay hidden by default');
  for (const label of layout.ITINERARY_PARAMETER_FIELD_LABELS) assert.ok(expandedBrowse.includes(label), `expanded browse table must include ${label}`);
  const moreButton = renderToStaticMarkup(createElement(browseModule.ItineraryMoreParametersButton, { expanded: false, onToggle() {} }));
  assert.match(moreButton, /aria-expanded="false"/);
  assert.match(moreButton, /顯示更多預估參數/);
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
  const saveEditorBlock = portal.slice(portal.indexOf('const saveEditor = async'), portal.indexOf('const exportDocument ='));
  assert.doesNotMatch(saveEditorBlock, /已保存並同步 Revision/, 'save confirmation must not foreground an internal revision number');
  assert.match(saveEditorBlock, /updatedAt:\s*result\.document\.updatedAt/, 'save confirmation must retain the server-confirmed update time');
  assert.match(portal, /formatItinerarySaveConfirmation\(notice\.updatedAt,\s*noticeNowMs\)/, 'save confirmation must render the exact and relative confirmed update time');
  assert.match(portal, /setInterval\(\(\)\s*=>\s*setNoticeNowMs\(Date\.now\(\)\)/, 'relative save time must continue advancing while the confirmation remains visible');
  assert.ok((portal.match(/setLatest\(previous => selectLatestItineraryDocument\(previous,/g) || []).length >= 4, 'initial load, polling, edit reload and sync reload must all publish monotonically');
  assert.match(editor, /ship-editor-workspace/);
  assert.match(editor, /ship-editor-main-pane/);
  assert.match(editor, /ship-editor-parameter-pane/);
  assert.match(css, /\.ship-editor-workspace\{[^}]*grid-template-columns:minmax\(0,var\(--ship-editor-left/);
  assert.match(css, /\.ship-editor-resizer\{/);
  assert.match(css, /\.ship-editor-grid th\.itinerary-field-heading-multiline\{white-space:pre-line!important\}/, 'ship editor must preserve the explicit ROB heading line break');
  assert.match(officeCompactCss, /\.itinerary-editor-table th\.itinerary-field-heading-multiline\{white-space:pre-line\}/, 'Owner editor must preserve the explicit ROB heading line break');
  assert.doesNotMatch(css, /prefers-color-scheme:dark/);
  assert.match(css, /--ship-card:#fff/);
  assert.doesNotMatch(editor, /<th>[A-W]\s/);
  assert.match(editor, /全部手動輸入/);
  assert.match(editor, /一鍵自動計算/);
  assert.match(editor, /首列 ETA 起算/);
  assert.match(editor, /calculationStartUtc/);
  assert.match(editor, /calculationStartTimeZone/);
  assert.match(editor, /使用現在/);
  assert.match(editor, /當下時間＋當下時區/);
  assert.doesNotMatch(editor, /當下時間＋Offset/);
  const calculationAnchorReminder = '請選擇實際計算值，如台北，則是UTC+8';
  assert.equal(editor.split(calculationAnchorReminder).length - 1, 1, 'ship editor must show the UTC offset calculation reminder exactly once');
  const calculationAnchorStart = editor.indexOf('return <div className="ship-calculation-anchor"');
  const calculationAnchorEnd = editor.indexOf('</div>;\n}', calculationAnchorStart);
  const calculationAnchorBlock = editor.slice(calculationAnchorStart, calculationAnchorEnd);
  assert.ok(calculationAnchorBlock.indexOf('>使用現在</button>') < calculationAnchorBlock.indexOf(calculationAnchorReminder), 'UTC offset calculation reminder must sit after the Use Now button in the same calculation anchor');
  assert.match(calculationAnchorBlock, /<p className="ship-calculation-anchor-note" role="note">/);
  assert.equal(officeEditor.includes(calculationAnchorReminder), false, 'UTC offset calculation reminder is requested only in the ship-side editor');
  assert.match(css, /\.ship-calculation-anchor\{[^}]*grid-template-columns:72px 112px 68px 94px 58px minmax\(0,1fr\)/, 'desktop calculation anchor must reserve a flexible sixth cell for the reminder');
  assert.match(css, /\.ship-calculation-anchor-note\{[^}]*margin:0[^}]*min-width:0[^}]*white-space:normal[^}]*overflow-wrap:anywhere/, 'calculation reminder must prefer one line but wrap safely when space is narrow');
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.ship-calculation-anchor-note\{grid-column:1\/-1\}/, 'narrow ship editor must place the reminder below the controls without creating a wider grid');
  assert.match(editor, /role="separator"/);
  assert.match(editor, /onPointerMove=/);
  assert.match(editor, /shipTimeZonePatch/);
  assert.match(editor, /shipPortTimeZonePatch/);
  assert.match(editor, /channelSailingHours/);
  assert.match(editor, /preCompletionDelayHours/);
  assert.match(editor, /postCompletionDelayHours/);
  assert.match(editor, /operationRateMtPerHour === null/);
  assert.match(editor, /notesText/, 'ship editor must provide the notes input after Dep ROB');
  assert.match(editor, /ItineraryOperationOptions/);
  assert.match(officeEditor, /ItineraryOperationOptions/);
  assert.match(officeEditor, /notesText/, 'owner editor must preserve the shared notes field');
  assert.match(editor, /<colgroup>/, 'ship editor widths must use explicit column geometry rather than brittle nth-child drift');
  assert.match(officeEditor, /<colgroup>/, 'owner editor widths must use the same explicit column geometry');
  assert.doesNotMatch(editor, /<select value=\{row\.operation\}/);
  assert.doesNotMatch(officeEditor, /<select value=\{row\.operation\}/);
  assert.match(editor, /ITINERARY_MAIN_FIELD_LABELS/);
  assert.match(panel, /ItineraryBrowseTable/);
  assert.match(portal, /dashboardVesselDisplayName/, 'ship selector and headings must use the main dashboard vessel naming rule');
  assert.match(portal, /ItineraryBrowseTable/, 'ship latest view must mount the same browse table as the main dashboard');
  assert.match(panel, /ItineraryMoreParametersButton/, 'main browse must expose the shared more-parameters action');
  assert.match(portal, /ItineraryMoreParametersButton/, 'ship browse must expose the shared more-parameters action');
  assert.match(browseSource, /formatItineraryUtcOffset/, 'shared browse rows must display canonical UTC offsets');
  assert.match(browseSource, /resolveItineraryTimeZone\(row,\s*field\)/, 'shared browse must resolve each LT field offset independently');
  assert.match(browseSource, /itinerary-browse-time-offset/, 'shared browse must show the resolved offset inside each LT cell');
  assert.match(browseSource, /notesText/, 'shared browse must render notes after Dep ROB');
  assert.match(browseSource, /row\.sailingHours/);
  assert.match(browseSource, /row\.operationHours/);
  assert.match(css, /\.ship-vessel-picker select\{[^}]*color-scheme:light[^}]*color:#172033/);
  assert.match(css, /\.ship-vessel-picker option\{[^}]*background:#fff[^}]*color:#172033/);
  assert.match(browseCss, /\.itinerary-browse-table\s*\{[^}]*font-size:\s*12px/);
  assert.match(browseCss, /\.itinerary-browse-table th\.itinerary-field-heading-multiline\s*\{[^}]*white-space:\s*pre-line/, 'shared browse header CSS must preserve the explicit ROB heading line break');
  assert.match(browseCss, /\.itinerary-browse-time\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.ship-editor-grid\{[^}]*font-size:12px/);
  assert.match(css, /\.ship-time-input\{[^}]*grid-template-columns:20px 118px 92px/, 'native time inputs need enough width to show all HH:mm digits');
  assert.match(purposeInput, /<details/);
  assert.match(purposeInput, /<summary/);
  assert.match(purposeInput, /ITINERARY_PURPOSE_OPTIONS\.map/);
  const purposeModule = await server.ssrLoadModule('/src/itinerary/ItineraryOperationOptions.tsx');
  const purposeHtml = renderToStaticMarkup(createElement(purposeModule.default, { value: 'To Load / To Unload', onChange() {} }));
  for (const label of ['to load','to unload','docking','waiting order','repair','inspection']) assert.ok(purposeHtml.includes(`>${label}</span>`), `Purpose option must display ${label} in lowercase`);
  assert.match(purposeHtml, /<summary[^>]*title="to load \/ to unload"[^>]*>to load \/ to unload<\/summary>/, 'selected Purpose summary must display lowercase labels');
  assert.doesNotMatch(purposeHtml, />To Load</, 'canonical stored values must not leak capitalized labels into the editor UI');
  assert.doesNotMatch(purposeHtml, />To Unload</, 'canonical stored values must not leak capitalized labels into the editor UI');
  assert.equal(types.setItineraryOperationSelected('', 'load', true), 'To Load', 'lowercase display must not change the cloud/Excel canonical value');
  assert.match(dateInput, /type="text"/);
  assert.match(dateInput, /type="date"/);
  assert.match(dateInput, /showPicker/);
  assert.match(dateInput, /placeholder="YYYY-MM-DD"/);
  assert.match(editor, /ItineraryDateInput/);
  assert.match(officeEditor, /ItineraryDateInput/);
  assert.match(officeEditor, /removeShipDraftRow/, 'owner row deletion must preserve the first-row ETA calculation anchor');
  assert.match(dateInput, /dateInputRef/, 'manual date input must retain an in-progress text editing state');
  assert.doesNotMatch(dateInput, /key=\{`date-(?:text|picker)-\$\{value\}`\}/, 'a parent date update must not remount the focused text input');
  const dateTextBlock = dateInput.slice(dateInput.indexOf('className="itinerary-date-text"'), dateInput.indexOf('/>', dateInput.indexOf('className="itinerary-date-text"')));
  assert.doesNotMatch(dateTextBlock, /onChange=\{[^}]*commit/, 'an in-progress date edit must not commit and re-render on every digit');
  assert.match(dateTextBlock, /onBlur=\{resetInvalid\}/, 'manual date text must commit only after the editing gesture is complete');
  assert.match(timeInput, /type="time"/);
  assert.match(timeInput, /defaultValue=\{value\}/, 'time must use an uncontrolled native editing buffer');
  assert.doesNotMatch(timeInput, /\bkey=/, 'a parent UTC update must not remount the focused time input');
  assert.match(editor, /ItineraryTimeInput/, 'ship time fields must use the caret-stable shared input');
  assert.match(officeEditor, /ItineraryTimeInput/, 'Owner time fields must use the caret-stable shared input');
  assert.match(dateInput, /className="itinerary-date-text"/, 'manual date text input must expose a stable semantic class');
  assert.match(dateInput, /onPaste=/, 'date text input must explicitly support pasted ISO dates');

  assert.equal(fs.existsSync(numericInputPath), true, 'requested numeric-only fields need one shared input contract');
  const numericInput = fs.readFileSync(numericInputPath, 'utf8');
  const numericModule = await server.ssrLoadModule(`/${numericInputPath}`);
  for (const valid of ['', '0', '26', '12.5', '12.', '.5']) assert.equal(numericModule.isItineraryNumericDraft(valid), true, `${valid || 'empty'} must be a valid numeric editing state`);
  for (const invalid of ['abc', '12a', '-1', '1e2', '1,000', '1.2.3']) assert.equal(numericModule.isItineraryNumericDraft(invalid), false, `${invalid} must be rejected as non-numeric input`);
  assert.equal(numericModule.itineraryNumericDraftValue('12.5'), 12.5);
  assert.equal(numericModule.itineraryNumericDraftValue('.'), null, 'a lone decimal point is an editing state, not persisted data');
  assert.equal(numericModule.itineraryNumericWarning('DTG(NM)'), 'DTG(NM)僅限輸入數字，可使用小數點。');
  assert.match(numericInput, /onBeforeInput=/, 'typing a forbidden character must be intercepted');
  assert.match(numericInput, /onPaste=/, 'pasting non-numeric text must be intercepted');
  assert.match(numericInput, /onChange\(itineraryNumericDraftValue\(raw\)\);/, 'a lone decimal point must clear the prior numeric value instead of leaving hidden stale data');
  assert.doesNotMatch(numericInput, /if \(raw !== '\.'\)/, 'numeric draft updates must not special-case a lone decimal point into stale parent state');
  assert.match(numericInput, /window\.alert/, 'non-numeric input must show the requested warning');
  assert.ok((editor.match(/<ItineraryNumericInput/g) || []).length >= 7, 'ship editor must protect L/D rate, DTG, speed and four waiting/sailing/delay fields');
  assert.ok((officeEditor.match(/<ItineraryNumericInput/g) || []).length >= 1, 'Owner L/D rate must use the same numeric-only input');

  const blankConfirm = '這將清空之前的記錄，如要更新，請點擊“從最新狀態修改”。是否繼續？';
  assert.ok(portal.includes(blankConfirm), 'blank start must show the exact destructive-change warning');
  assert.ok(startEditingBlock.indexOf(blankConfirm) >= 0 && startEditingBlock.indexOf(blankConfirm) < startClaimIndex, 'declining blank start must cancel before claiming a lease or changing a draft');
  assert.match(startEditingBlock, /mode === 'blank'[\s\S]*deleteItineraryDraft[\s\S]*else if \(saved/, 'confirmed blank start must clear the prior local record instead of restoring it');
  assert.match(startEditingBlock, /dirty: mode === 'blank' \? false : Boolean\(saved\)/, 'blank start must remain clean while latest-mode draft semantics stay unchanged');
  assert.doesNotMatch(startEditingBlock, /restoredDraft/, 'blank-start cleanup must not alter latest-mode restore bookkeeping');
  assert.match(portal, />簡要說明<\/button>/, 'the ship-name picker must expose the instructions button');
  const briefButtonIndex = portal.indexOf('>簡要說明</button>');
  const vesselLabelIndex = portal.indexOf('<label htmlFor="ship-vessel-select">船名</label>');
  const vesselSelectIndex = portal.indexOf('<select id="ship-vessel-select"');
  assert.ok(briefButtonIndex >= 0 && vesselLabelIndex > briefButtonIndex && vesselSelectIndex > vesselLabelIndex, 'brief instructions must sit to the left of the ship-name label, never between the label and select');
  assert.match(portal, /ShipItineraryBriefDialog/);
  assert.equal(fs.existsSync(briefDialogPath), true, 'ship portal needs a concise instructions dialog');
  const briefDialog = fs.readFileSync(briefDialogPath, 'utf8');
  const briefModule = await server.ssrLoadModule(`/${briefDialogPath}`);
  const briefHtml = renderToStaticMarkup(createElement(briefModule.default, { onClose() {} }));
  for (const text of [
    '首先選擇“當下時區”，然後點擊“使用現在”，則起算時間確定',
    '港口後跟隨的時區選擇，是該港口的時區',
    '所有帶有“手”或者“自”的欄位，均可以進行手動輸入，或者自動計算。',
    '自動計算的資料需要到“自動計算用變化參數區”中修改',
    '如果全部手動輸入，可以選擇“全部手動輸入”，則“自動計算用變化參數區”內數據，可以有選擇的輸入',
    '輸入完後，務必按“保存並同步”！',
    '瀏覽模式下，具備“一鍵複製”然後可以去郵件粘貼，或，導出excel發送的功能。',
    '首列 ETA＝起算時間＋DTG÷預估航速',
    '後續 ETA＝上一港 ETD＋本列 DTG÷本列預估航速',
    'ETB＝ETA＋預估等待時間（靠泊前）＋預計航道航行時間',
    'ETC＝ETB＋預估等待／延誤時間（完貨前）＋裝卸貨量÷預計 L/D rate',
    'ETD＝ETC＋預估等待／延誤時間（完貨後）',
  ]) assert.ok(briefHtml.includes(text), `brief instructions must include: ${text}`);
  assert.match(briefDialog, /role="dialog"/);
  assert.match(css, /\.ship-brief-dialog\{/);
  const briefBodyRules = css.match(/\.ship-brief-body\{[^}]*\}/g) || [];
  assert.ok(briefBodyRules.length >= 1 && briefBodyRules.every(rule => rule.includes('font-size:14px')), 'brief explanation text must stay 14px at every viewport');
  assert.match(css, /\.ship-brief-dialog header p\{[^}]*font-size:14px/, 'brief dialog subtitle must be 14px');
  assert.match(css, /\.ship-brief-formulas h3\{[^}]*font-size:14px/, 'brief formula heading must be 14px');
  assert.match(css, /\.ship-brief-formulas>p\{[^}]*font-size:14px/, 'brief formula note must be 14px');
  console.log('ship_itinerary_portal_model=PASS');
} finally {
  await server.close();
}
