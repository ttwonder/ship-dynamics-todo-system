import assert from 'node:assert/strict';

// Shared oracle for persisted XLSX bytes and actual shore/ship browser downloads.
export function assertTemplateDateDropdowns(book, kind, year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(new Date()))) {
 const sheet = book.getWorksheet('填寫資料');
 const keys = sheet.getRow(3).values.slice(1).map(value => String(value).replace('tracking:', ''));
 const dateKeys = ['applicationDate', 'expectedDate', kind === 'supply' ? 'actualDeliveryDate' : 'completionDate'];
 for (const key of dateKeys) {
  const col = keys.indexOf(key) + 1;
  assert.ok(col > 0, key);
  for (const row of [...Array.from({ length: 10 }, (_, i) => i + 5), 15, 104, 10000]) {
   const cell = row <= 14 ? sheet.getCell(row, col) : null;
   const rule = sheet.dataValidations.find(`${sheet.getColumn(col).letter}${row}`) || {};
   assert.equal(rule.type, 'list', `${kind} ${key} row ${row} must have a date dropdown`);
   assert.equal(rule.allowBlank, true);
   assert.equal(rule.showErrorMessage, true);
   assert.equal(rule.errorStyle, 'stop');
   assert.equal(rule.showInputMessage, true);
   assert.equal(rule.formulae.length, 1);
   if (cell) {
    assert.equal(cell.value, null, 'do not prefill a date');
    assert.equal(cell.numFmt, '@', 'pre-styled blank input cells must also preserve ISO text');
   }
   assert.equal(sheet.getColumn(col).numFmt, '@', 'ISO text must not be coerced by the Excel locale');
  }
 }
 const options = book.getWorksheet('_tracking_dates');
 assert.ok(options && options.state !== 'visible', 'date options are hidden implementation data');
 const values = Array.from({ length: options.rowCount }, (_, i) => options.getCell(i + 1, 1).value);
 const start = `${year - 5}-01-01`, end = `${year + 10}-12-31`;
 assert.equal(values[0], start); assert.equal(values.at(-1), end);
 assert.equal(values.length, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
 values.forEach((value, i) => {
  assert.equal(typeof value, 'string'); assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Date.parse(value), Date.parse(start) + i * 86400000, 'continuous valid dates with no duplicates');
 });
 assert.ok(values.some(value => value.endsWith('-02-29')), 'include real leap days');
 const rule = sheet.getCell(5, keys.indexOf('applicationDate') + 1).dataValidation;
 const named = book.definedNames.getRanges(rule.formulae[0].replace(/^=/, '')).ranges;
 assert.deepEqual(named.map(ref => ref.replace(/'/g, '')), [`_tracking_dates!$A$1:$A$${values.length}`]);
 for (const key of dateKeys) assert.deepEqual(sheet.getCell(5, keys.indexOf(key) + 1).dataValidation.formulae, rule.formulae);
 assert.equal(sheet.rowCount, 14, 'keep exactly ten blank input rows');
 assert.equal(sheet.pageSetup.printArea, 'A1:N14', 'dropdown coverage must not expand printing');
 assert.deepEqual(book.worksheets.filter(s => s.state === 'visible').map(s => s.name), ['填寫資料', '列印明細']);
 return { dateKeys, start, end, optionCount: values.length };
}
