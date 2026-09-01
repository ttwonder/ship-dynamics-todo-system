import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { createEmptyItineraryDocument, createBlankItineraryRow } = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const { recalculateItineraryRows } = await server.ssrLoadModule('/src/itinerary/itineraryDomain.ts');
  const { UTC_OFFSET_OPTIONS } = await server.ssrLoadModule('/src/itinerary/itineraryTime.ts');
  const { buildItineraryWorkbook, parseItineraryWorkbook } = await server.ssrLoadModule('/src/itinerary/itineraryExcel.ts');

  const first = createBlankItineraryRow('row-a', 0);
  Object.assign(first, {
    voyageNumber: 'V001', portDockName: 'KAOHSIUNG', operation: 'To Load / To Unload / docking / inspection', cargoQuantityText: 'TEST 5000 MT', portTimeZone: 'UTC+8',
    etaUtc: '2026-08-31T08:00:00Z', etaMode: 'auto', etaTimeZone: '', etbTimeZone: 'UTC+9', etcTimeZone: 'UTC+8:45', etdTimeZone: 'UTC-6',
    calculationStartUtc: '2026-08-30T22:00:00Z', calculationStartTimeZone: 'UTC+8', berthWaitHours: 2, channelSailingHours: 1,
    preCompletionDelayHours: 2, postCompletionDelayHours: 6, operationQuantityMt: 5000, operationRateMtPerHour: 500, ldRateText: '500',
    departureBufferDays: null, oceanDistanceNm: 120, speedKnots: 12, arrivalDraftText: '10.2', departureDraftText: '11.0', notesText: '靠港前請再次確認',
  });
  const second = createBlankItineraryRow('row-b', 1);
  Object.assign(second, {
    voyageNumber: 'V002', portDockName: 'ULSAN', operation: 'waiting order / repair', cargoQuantityText: 'TEST 5000 MT', portTimeZone: 'UTC+5:45',
    berthWaitHours: null, channelSailingHours: null, preCompletionDelayHours: null, postCompletionDelayHours: null,
    operationQuantityMt: null, operationRateMtPerHour: null, departureBufferDays: null, oceanDistanceNm: 60, speedKnots: 12,
  });
  const calculated = recalculateItineraryRows([first, second]);
  assert.equal(calculated.issues.length, 0);

  const alpha = createEmptyItineraryDocument({ workspaceKey: 'qa', vesselId: 'v-alpha', vesselName: 'TEST ALPHA', rowId: 'unused' });
  alpha.rows = calculated.rows;
  alpha.revision = 7;
  alpha.updatedAt = '2026-08-31T01:02:03Z';
  const beta = structuredClone(alpha);
  beta.vesselId = 'v-beta';
  beta.vesselName = 'TEST/BETA:*?';
  beta.revision = 4;

  const template = await fs.readFile('public/templates/itinerary-template-v1.xlsx');
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(template);
  const templateSheet = templateWorkbook.worksheets[0];
  const output = await buildItineraryWorkbook([alpha, beta], template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength));
  assert.ok(output.byteLength > 10_000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.equal(workbook.worksheets.length, 3);
  assert.equal(workbook.worksheets[2].name, '_Itinerary_Meta');
  assert.equal(workbook.worksheets[2].state, 'veryHidden');
  assert.equal(workbook.worksheets[0].name, 'TEST ALPHA');
  assert.equal(workbook.worksheets[1].name, 'TEST BETA');
  assert.equal(workbook.worksheets[0].getCell('A2').value, 'Vsl name: TEST ALPHA');
  assert.equal(workbook.worksheets[0].getCell('A4').value, 'V001');
  assert.equal(workbook.worksheets[0].getCell('B3').value, 'Next Port & Dock Name');
  assert.equal(workbook.worksheets[0].getCell('C3').value, 'Purpose');
  assert.equal(workbook.worksheets[0].getCell('D3').value, 'B/F or I/F Qty (MT/BBLS)');
  assert.equal(workbook.worksheets[0].getCell('G3').value, '預計L/D rate (MT/h)');
  assert.equal(workbook.worksheets[0].getCell('L3').value, 'Arr ROB');
  assert.equal(workbook.worksheets[0].getCell('M3').value, 'Dep ROB');
  assert.equal(workbook.worksheets[0].getCell('N3').value, '備註信息');
  assert.equal(workbook.worksheets[0].getCell('N4').value, '靠港前請再次確認');
  assert.equal(workbook.worksheets[0].getCell('C4').value, 'To Load / To Unload / docking / inspection');
  assert.match(String(workbook.worksheets[0].getCell('C4').dataValidation.formulae?.[0]), /To Load \/ To Unload/);
  assert.equal(workbook.worksheets[0].getCell('O3').value, 'UTC Offset');
  assert.equal(workbook.worksheets[0].getCell('P3').value, 'DTG(NM)');
  assert.equal(workbook.worksheets[0].getCell('R3').value, '剩餘航行時間(h)');
  assert.equal(workbook.worksheets[0].getCell('T3').value, '預計航道航行時間(h)');
  assert.equal(workbook.worksheets[0].getCell('Y3').value, '預估等待/延誤時間(完貨前)(h)');
  assert.equal(workbook.worksheets[0].getCell('Z3').value, '預估等待/延誤時間(完貨後)(h)');
  assert.equal(workbook.worksheets[0].getCell('AA3').value, 'ETA UTC Offset');
  assert.equal(workbook.worksheets[0].getCell('AF3').value, '首列 ETA 起算 UTC Offset');
  assert.equal(workbook.worksheets[0].getCell('O4').value, 'UTC+8');
  assert.equal(workbook.worksheets[0].getCell('O6').value, 'UTC+5:45');
  assert.equal(workbook.worksheets[0].getCell('AA4').value, '');
  assert.equal(workbook.worksheets[0].getCell('AB4').value, 'UTC+9');
  assert.equal(workbook.worksheets[0].getCell('AC4').value, 'UTC+8:45');
  assert.equal(workbook.worksheets[0].getCell('AD4').value, 'UTC-6');
  assert.equal(workbook.worksheets[0].getCell('AF4').value, 'UTC+8');
  assert.equal(workbook.worksheets[2].getCell('G2').value, 3, 'metadata must identify the notes-aware Excel layout');
  const helperExpectations = [
    ['AG4', 'AF4', 8],
    ['AH4', 'IF(AA4="",O4,AA4)', 8],
    ['AI4', 'IF(AB4="",O4,AB4)', 9],
    ['AJ4', 'IF(AC4="",O4,AC4)', 8.75],
    ['AK4', 'IF(AD4="",O4,AD4)', -6],
  ];
  for (const [address, source, result] of helperExpectations) {
    const helper = workbook.worksheets[0].getCell(address).value;
    assert.equal(typeof helper, 'object', `${address} must be a live formula, not a stale numeric helper`);
    assert.match(helper.formula, /VLOOKUP/);
    assert.ok(helper.formula.includes(source), `${address} must derive from ${source}`);
    assert.equal(helper.result, result);
  }
  for (const address of ['O4','AA4','AB4','AC4','AD4','AF4']) {
    assert.equal(workbook.worksheets[0].getCell(address).dataValidation.formulae?.[0], 'ItineraryUtcOffsetLabels');
  }
  const offsetLabelRange = workbook.definedNames.getRanges('ItineraryUtcOffsetLabels').ranges.join(',');
  const offsetLookupRange = workbook.definedNames.getRanges('ItineraryUtcOffsetLookup').ranges.join(',');
  assert.match(offsetLabelRange, /_Itinerary_Meta.*\$H\$2:\$H\$/);
  assert.match(offsetLookupRange, /_Itinerary_Meta.*\$H\$2:\$I\$/);
  assert.equal(workbook.worksheets[2].getCell('H2').value, UTC_OFFSET_OPTIONS[0]);
  assert.equal(workbook.worksheets[2].getCell(1 + UTC_OFFSET_OPTIONS.length, 8).value, UTC_OFFSET_OPTIONS.at(-1));
  const outputZip = await JSZip.loadAsync(output);
  const workbookXml = await outputZip.file('xl/workbook.xml').async('string');
  assert.match(workbookXml, /<calcPr[^>]*fullCalcOnLoad="1"/, 'Excel must fully recalculate live offset helpers on open');
  for (const sheetNumber of [1, 2]) {
    const worksheetXml = await outputZip.file(`xl/worksheets/sheet${sheetNumber}.xml`).async('string');
    const sheetProperties = worksheetXml.match(/<sheetPr>.*?<\/sheetPr>/)?.[0] || '';
    const outlineIndex = sheetProperties.indexOf('<outlinePr');
    const pageSetupIndex = sheetProperties.indexOf('<pageSetUpPr');
    assert.ok(outlineIndex < 0 || pageSetupIndex < 0 || outlineIndex < pageSetupIndex, `sheet${sheetNumber}.xml must not place outlinePr after pageSetUpPr because Microsoft Excel discards that worksheet`);
  }
  assert.equal(workbook.worksheets[0].getCell('R4').value.formula.includes('P4/Q4'), true);
  assert.equal(workbook.worksheets[0].getCell('R4').value.formula.includes('ROUNDUP'), false);
  assert.equal(workbook.worksheets[0].getCell('E4').value.formula.includes('AE4'), true);
  assert.equal(workbook.worksheets[0].getCell('E6').value.formula.includes('I4'), true);
  assert.equal(workbook.worksheets[0].getCell('E6').value.formula.includes('R6'), true);
  assert.equal(workbook.worksheets[0].getCell('F4').value.formula.includes('T4'), true);
  assert.equal(workbook.worksheets[0].getCell('H4').value.formula.includes('Y4'), true);
  assert.equal(workbook.worksheets[0].getCell('I4').value.formula.includes('Z4'), true);
  for (let column = 33; column <= 37; column += 1) assert.equal(workbook.worksheets[0].getColumn(column).hidden, true, `helper column ${column} must stay hidden`);
  assert.ok(workbook.worksheets[0].model.merges.includes('A4:A5'));
  assert.equal(workbook.worksheets[0].pageSetup.printArea, 'A1:N7');
  for (let column = 1; column <= 13; column += 1) assert.equal(workbook.worksheets[0].getColumn(column).width, templateSheet.getColumn(column).width, `column ${column} width must match the approved template`);
  assert.ok(workbook.worksheets[0].getColumn(14).width >= 26, 'notes must have a readable visible Excel width');
  for (let row = 1; row <= 7; row += 1) assert.equal(workbook.worksheets[0].getRow(row).height, templateSheet.getRow(row).height, `row ${row} height must match the approved template`);
  assert.equal(workbook.worksheets[0].getCell('A1').font.bold, true);
  assert.equal(workbook.worksheets[0].getCell('A1').fill.fgColor.argb, 'FFF2F2F2');
  assert.equal(workbook.worksheets[0].getCell('B4').fill.fgColor.argb, 'FFFFFF00');
  assert.equal(workbook.worksheets[0].getCell('B4').alignment.wrapText, true);
  assert.equal(workbook.worksheets[0].views[0].state, 'frozen');
  assert.equal(workbook.worksheets[0].views[0].ySplit, 3);
  assert.equal(workbook.worksheets[0].views[0].topLeftCell, 'A4');
  assert.equal(workbook.worksheets[0].views[0].showGridLines, false);
  assert.equal(workbook.worksheets[0].pageSetup.orientation, 'landscape');
  assert.equal(workbook.worksheets[0].pageSetup.fitToWidth, 1);
  assert.equal(workbook.worksheets[0].pageSetup.fitToHeight, 0);
  assert.equal(workbook.worksheets[0].pageSetup.printTitlesRow, '1:3');
  assert.equal(workbook.worksheets[0].pageSetup.horizontalCentered, true);

  const editableOffsetWorkbook = new ExcelJS.Workbook();
  await editableOffsetWorkbook.xlsx.load(output);
  editableOffsetWorkbook.worksheets[0].getCell('AA4').value = 'UTC+9';
  const editableOffsetBytes = await editableOffsetWorkbook.xlsx.writeBuffer();
  const editableOffsetReloaded = new ExcelJS.Workbook();
  await editableOffsetReloaded.xlsx.load(editableOffsetBytes);
  assert.equal(editableOffsetReloaded.worksheets[0].getCell('AA4').value, 'UTC+9');
  assert.match(editableOffsetReloaded.worksheets[0].getCell('AH4').value.formula, /IF\(AA4="",O4,AA4\)/);
  assert.ok(editableOffsetReloaded.definedNames.getRanges('ItineraryUtcOffsetLookup').ranges.length > 0);
  assert.equal(editableOffsetReloaded.worksheets[0].getCell('AA4').dataValidation.formulae?.[0], 'ItineraryUtcOffsetLabels');

  const laterAnchorWorkbook = new ExcelJS.Workbook();
  await laterAnchorWorkbook.xlsx.load(output);
  laterAnchorWorkbook.worksheets[0].getCell('AE6').value = new Date('2026-09-01T00:00:00Z');
  laterAnchorWorkbook.worksheets[0].getCell('AF6').value = 'UTC+8';
  const laterAnchorBytes = await laterAnchorWorkbook.xlsx.writeBuffer();
  const parsedLaterAnchor = await parseItineraryWorkbook(laterAnchorBytes.buffer.slice(laterAnchorBytes.byteOffset, laterAnchorBytes.byteOffset + laterAnchorBytes.byteLength));
  assert.ok(parsedLaterAnchor.sheets[0].issues.some(issue => issue.code === 'first-row-only' && issue.rowNumber === 6), 'Excel must reject an ETA calculation anchor outside its first itinerary row');

  const parsed = await parseItineraryWorkbook(output);
  assert.equal(parsed.sheets.length, 2);
  assert.equal(parsed.sheets[0].embeddedVesselId, 'v-alpha');
  assert.equal(parsed.sheets[0].rows.length, 2);
  assert.equal(parsed.sheets[0].rows[0].voyageNumber, 'V001');
  assert.equal(parsed.sheets[0].rows[0].operation, 'To Load / To Unload / docking / inspection');
  assert.equal(parsed.sheets[0].rows[0].notesText, '靠港前請再次確認');
  assert.equal(parsed.sheets[0].rows[1].portTimeZone, 'UTC+5:45');
  assert.equal(parsed.sheets[0].rows[0].etaTimeZone, '');
  assert.equal(parsed.sheets[0].rows[0].etbTimeZone, 'UTC+9');
  assert.equal(parsed.sheets[0].rows[0].etcTimeZone, 'UTC+8:45');
  assert.equal(parsed.sheets[0].rows[0].etdTimeZone, 'UTC-6');
  assert.equal(parsed.sheets[0].rows[0].calculationStartUtc, '2026-08-30T22:00:00Z');
  assert.equal(parsed.sheets[0].rows[0].calculationStartTimeZone, 'UTC+8');
  assert.equal(parsed.sheets[0].rows[0].channelSailingHours, 1);
  assert.equal(parsed.sheets[0].rows[0].preCompletionDelayHours, 2);
  assert.equal(parsed.sheets[0].rows[0].postCompletionDelayHours, 6);
  if (parsed.sheets[0].issues.length) console.error('unexpected_excel_issues=', parsed.sheets[0].issues);
  assert.equal(parsed.sheets[0].issues.length, 0);

  workbook.worksheets[0].getCell('B10').value = '* footer instruction is not an itinerary row';
  const footerBytes = await workbook.xlsx.writeBuffer();
  const footerParsed = await parseItineraryWorkbook(footerBytes.buffer.slice(footerBytes.byteOffset, footerBytes.byteOffset + footerBytes.byteLength));
  assert.equal(footerParsed.sheets[0].rows.length, 2);

  workbook.worksheets[0].getCell('C4').value = 'Not An Operation';
  workbook.worksheets[0].getCell('O4').value = 5.5;
  const malformed = await workbook.xlsx.writeBuffer();
  const parsedMalformed = await parseItineraryWorkbook(malformed);
  assert.ok(parsedMalformed.sheets[0].issues.some(issue => issue.code === 'invalid-operation'));
  assert.equal(parsedMalformed.sheets[0].rows[0].portTimeZone, 'UTC+5:30');
  assert.equal(parsedMalformed.sheets[0].issues.some(issue => issue.code === 'time-zone-required'), false);

  workbook.worksheets[0].getCell('C4').value = 'Loading / Unloading';
  workbook.worksheets[0].getCell('O4').value = 'GMT+8';
  const invalidOffset = await workbook.xlsx.writeBuffer();
  const parsedInvalidOffset = await parseItineraryWorkbook(invalidOffset);
  assert.equal(parsedInvalidOffset.sheets[0].rows[0].operation, 'To Load / To Unload', 'legacy combined text must import to the canonical multi-select value');
  assert.ok(parsedInvalidOffset.sheets[0].issues.some(issue => issue.code === 'time-zone-required'));

  console.log('itinerary_excel_roundtrip=PASS');
} finally {
  await server.close();
}
