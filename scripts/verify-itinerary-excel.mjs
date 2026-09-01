import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { createEmptyItineraryDocument, createBlankItineraryRow } = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const { recalculateItineraryRows } = await server.ssrLoadModule('/src/itinerary/itineraryDomain.ts');
  const { buildItineraryWorkbook, parseItineraryWorkbook } = await server.ssrLoadModule('/src/itinerary/itineraryExcel.ts');

  const first = createBlankItineraryRow('row-a', 0);
  Object.assign(first, {
    voyageNumber: 'V001', portDockName: 'KAOHSIUNG', operation: 'To Load / To Unload', cargoQuantityText: 'TEST 5000 MT', portTimeZone: 'UTC+8',
    etaUtc: '2026-08-31T00:00:00Z', etaMode: 'manual', berthWaitHours: 2, operationQuantityMt: 5000, operationRateMtPerHour: 500,
    departureBufferDays: 0.25, oceanDistanceNm: 120, speedKnots: 12, arrivalDraftText: '10.2', departureDraftText: '11.0',
  });
  const second = createBlankItineraryRow('row-b', 1);
  Object.assign(second, {
    voyageNumber: 'V002', portDockName: 'ULSAN', operation: 'To Unload', cargoQuantityText: 'TEST 5000 MT', portTimeZone: 'UTC+5:45',
    berthWaitHours: 3, operationQuantityMt: 5000, operationRateMtPerHour: 400, departureBufferDays: 0.5,
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
  assert.equal(workbook.worksheets[0].getCell('C3').value, 'To Load / To Unload');
  assert.equal(workbook.worksheets[0].getCell('C4').value, 'To Load / To Unload');
  assert.match(String(workbook.worksheets[0].getCell('C4').dataValidation.formulae?.[0]), /To Load \/ To Unload/);
  assert.equal(workbook.worksheets[0].getCell('N4').value, 'UTC+8');
  assert.equal(workbook.worksheets[0].getCell('N6').value, 'UTC+5:45');
  assert.equal(workbook.worksheets[0].getCell('X4').value, 8);
  assert.equal(workbook.worksheets[0].getCell('X6').value, 5.75);
  assert.equal(workbook.worksheets[0].getCell('E6').value.formula.includes('I4'), true);
  assert.ok(workbook.worksheets[0].model.merges.includes('A4:A5'));
  assert.equal(workbook.worksheets[0].pageSetup.printArea, 'A1:M7');
  for (let column = 1; column <= 23; column += 1) assert.equal(workbook.worksheets[0].getColumn(column).width, templateSheet.getColumn(column).width, `column ${column} width must match the approved template`);
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

  const parsed = await parseItineraryWorkbook(output);
  assert.equal(parsed.sheets.length, 2);
  assert.equal(parsed.sheets[0].embeddedVesselId, 'v-alpha');
  assert.equal(parsed.sheets[0].rows.length, 2);
  assert.equal(parsed.sheets[0].rows[0].voyageNumber, 'V001');
  assert.equal(parsed.sheets[0].rows[0].operation, 'To Load / To Unload');
  assert.equal(parsed.sheets[0].rows[1].portTimeZone, 'UTC+5:45');
  if (parsed.sheets[0].issues.length) console.error('unexpected_excel_issues=', parsed.sheets[0].issues);
  assert.equal(parsed.sheets[0].issues.length, 0);

  workbook.worksheets[0].getCell('B10').value = '* footer instruction is not an itinerary row';
  const footerBytes = await workbook.xlsx.writeBuffer();
  const footerParsed = await parseItineraryWorkbook(footerBytes.buffer.slice(footerBytes.byteOffset, footerBytes.byteOffset + footerBytes.byteLength));
  assert.equal(footerParsed.sheets[0].rows.length, 2);

  workbook.worksheets[0].getCell('C4').value = 'Not An Operation';
  workbook.worksheets[0].getCell('N4').value = 5.5;
  const malformed = await workbook.xlsx.writeBuffer();
  const parsedMalformed = await parseItineraryWorkbook(malformed);
  assert.ok(parsedMalformed.sheets[0].issues.some(issue => issue.code === 'invalid-operation'));
  assert.equal(parsedMalformed.sheets[0].rows[0].portTimeZone, 'UTC+5:30');
  assert.equal(parsedMalformed.sheets[0].issues.some(issue => issue.code === 'time-zone-required'), false);

  workbook.worksheets[0].getCell('C4').value = 'Loading / Unloading';
  workbook.worksheets[0].getCell('N4').value = 'GMT+8';
  const invalidOffset = await workbook.xlsx.writeBuffer();
  const parsedInvalidOffset = await parseItineraryWorkbook(invalidOffset);
  assert.equal(parsedInvalidOffset.sheets[0].rows[0].operation, 'To Load / To Unload', 'legacy combined text must import to the canonical multi-select value');
  assert.ok(parsedInvalidOffset.sheets[0].issues.some(issue => issue.code === 'time-zone-required'));

  console.log('itinerary_excel_roundtrip=PASS');
} finally {
  await server.close();
}
