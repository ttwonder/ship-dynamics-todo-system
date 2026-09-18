import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { assignmentExportFixture } from './management-assignment-export-fixture.mjs';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const data = assignmentExportFixture(createInitialData());
  Object.assign(data.vessels[0], { yearLabel: '2021.06', tonnageLabel: '2.0萬' });
  const { default: Management } = await server.ssrLoadModule('/src/Management.tsx');
  globalThis.window = {}; // No cloud configuration in this renderer-only fixture.
  const markup = renderToStaticMarkup(React.createElement(Management, {
    data, currentUser: data.users[0], commit: async () => { throw new Error('exports cannot write'); },
    captureCommitContext: () => () => true, onSaveSupabaseConfig: async () => false,
  }));
  assert.ok(markup.includes('分管表 PDF'), 'management needs the shared assignment PDF export entry');
  assert.ok(markup.includes('分管表 Excel'), 'management needs the shared assignment Excel export entry');
  const { buildManagementAssignmentReport, assignmentCellText, canExportManagementAssignments } = await server.ssrLoadModule('/src/managementAssignmentReport.ts');
  const { ManagementAssignmentPaper } = await server.ssrLoadModule('/src/ManagementAssignmentExports.tsx');
  const before = JSON.stringify(data);
  const report = buildManagementAssignmentReport(data, '2026-09-17T01:00:00Z');
  assert.deepEqual(report.vessels.map(v => v.id), ['v1', 'v3', 'v2'], 'group fleet/type without losing active unassigned vessels');
  assert.deepEqual(report.departments, ['船東督導', '海技', '未設定部門']);
  assert.equal(report.vessels[0].yearLabel, '2021.06', 'report takes only the saved year label');
  assert.equal(report.vessels[0].tonnageLabel, '2.0萬', 'report takes the saved tonnage label verbatim');
  assert.equal(assignmentCellText(report.vessels[0].cells[1]), '(未激活代理丁)', 'configured inactive delegates must appear in every department column without gaining activation');
  assert.equal(assignmentCellText(report.vessels[0].cells[0]), '測試督導甲\n(測試代理丙*)', 'only activated delegates carry the star');
  assert.deepEqual(report.vessels[0].cells[0], { direct: ['測試督導甲'], delegates: ['測試代理丙*'], mergeKey: JSON.stringify([['a'], [['c', true]]]) }, 'dedupe identities and exclude owner, ship, disabled and missing accounts');
  assert.equal(report.vessels[1].chineseName, '純中文測試輪');
  assert.equal(report.vessels[1].englishName, '');
  assert.equal(report.vessels[2].chineseName, '', 'English alias is not a Chinese name');
  assert.equal(report.vessels[2].englishName, 'FPMC QA BETA');
  assert.deepEqual(report.people.find(p => p.id === 'b').directVessels, ['FPMC QA BETA'], 'person-side assignment remains authoritative too');
  assert.deepEqual(report.people.find(p => p.id === 'c').delegateVessels, [{ name: '測試甲輪 QA ALPHA', isActive: true }]);
  assert.deepEqual(report.people.find(p => p.id === 'd').delegateVessels, [{ name: '測試甲輪 QA ALPHA', isActive: false }], 'preset inactive delegates remain visible without an active label');
  const inactiveOnly = structuredClone(data);
  inactiveOnly.users.find(user => user.id === 'd').department = '預設代管專用部門';
  assert.ok(buildManagementAssignmentReport(inactiveOnly).departments.includes('預設代管專用部門'));
  assert.deepEqual(report.people.find(p => p.id === 'f').directVessels, [], 'active unassigned personnel remain in the people index');
  assert.ok(!JSON.stringify(report).includes('PRIVATE_'), 'DTO excludes passwords and login identifiers');
  assert.equal(JSON.stringify(data), before, 'report must not change business data');
  const frozen = JSON.stringify(report);
  data.users[1].name = 'CHANGED LATER';
  data.vessels[0].assignedUserIds = [];
  assert.equal(JSON.stringify(report), frozen, 'the captured export does not follow later live changes');
  const original = JSON.parse(before);
  assert.equal(canExportManagementAssignments(original, original.users[0]), true);
  assert.equal(canExportManagementAssignments(original, original.users[1]), true);
  for (const user of original.users.filter(u => u.role === 'operator' || u.role === 'vessel')) assert.equal(canExportManagementAssignments(original, user), false);
  assert.equal(canExportManagementAssignments(original, { ...original.users[0], isActive: false }), false);
  const denied = structuredClone(original);
  denied.settings.rolePermissions.admin.exportReports = false;
  assert.equal(canExportManagementAssignments(denied, denied.users[1]), false);
  const expectedNotes = ['註：()為職務代理人', '註2：船隊加油業務(燃油/潤滑油)改為資材組-王梓名負責。'];
  const paper = renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report }));
  assert.ok(paper.endsWith(expectedNotes.map(note => `<div>${note}</div>`).join('') + '</footer></article>'), 'the two supplied notes must be the final PDF content, on separate lines after the table');
  for (const text of ['目前船舶分管表', '測試甲輪', 'QA ALPHA', '測試督導甲', '(測試代理丙*)', '(未激活代理丁)', '純中文測試輪', 'FPMC QA BETA']) assert.ok(paper.includes(text), text);
  assert.ok(paper.includes('測試督導甲\n(測試代理丙*)'), 'the PDF must retain the same explicit delegation line break');
  assert.ok(!/PRIVATE_|停用人員戊|INACTIVE SHIP/.test(paper));
  assert.ok(!/來源版本|Rev\./.test(paper), 'printed assignment report must omit the source revision');
  const injection = structuredClone(report);
  injection.vessels[0].cells[0].direct = ['<script>not executable</script>'];
  assert.ok(!renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: injection })).includes('<script>'));
  const { buildManagementAssignmentWorkbook, downloadManagementAssignmentWorkbook } = await server.ssrLoadModule('/src/managementAssignmentExcel.ts');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const bytes = await buildManagementAssignmentWorkbook(report);
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map(s => s.name), ['船舶分管', '人員分管']);
  const ships = workbook.worksheets[0], people = workbook.worksheets[1];
  const groupMerges = sheet => sheet.model.merges.filter(range => /^[AB]\d+:[AB]\d+$/.test(range) && Number(range.match(/\d+/)[0]) >= 5).sort();
  assert.deepEqual(groupMerges(ships), ['A5:A7', 'B5:B6'], 'adjacent same fleet/type cells must be true Excel merges');
  assert.equal(ships.getCell('C5').text, '測試甲輪');
  assert.equal(ships.getCell('D5').text, 'QA ALPHA');
  assert.equal(ships.getCell(3, ships.columnCount-1).text, '年份');
  assert.equal(ships.getCell(3, ships.columnCount).text, '噸數');
  assert.equal(ships.getCell(5, ships.columnCount-1).text, '2021.06');
  assert.equal(ships.getCell(5, ships.columnCount).text, '2.0萬');
  assert.equal(ships.getCell('E5').text, '測試督導甲\n(測試代理丙*)', 'delegates must start a separate line');
  for (let row=5;row<=4+report.vessels.length;row++) for(let column=5;column<=ships.columnCount-2;column++) {
    assert.equal(ships.getCell(row,column).alignment.horizontal,'center','every department is centered');
  }
  const assertNotes = (sheet, vesselCount) => {
    const start = 5 + Math.max(1, vesselCount);
    assert.equal(sheet.rowCount, start + expectedNotes.length - 1, 'notes follow the last vessel or empty-state row');
    for (const [index, note] of expectedNotes.entries()) {
      const cell = sheet.getCell(start + index, 1);
      assert.equal(cell.text, note);
      assert.equal(sheet.getCell(start + index, sheet.columnCount).master.address, cell.address, 'notes span the existing table width');
      assert.equal(cell.alignment.horizontal, 'left');
      assert.equal(cell.alignment.wrapText, true);
      assert.equal(Boolean(cell.alignment.shrinkToFit), false, 'footnotes are not vessel single-line fields');
      assert.ok(sheet.getRow(start + index).height >= 13);
    }
    assert.equal(sheet.pageSetup.printArea, `A1:${sheet.getColumn(sheet.columnCount).letter}${sheet.rowCount}`, 'both notes are in the print area');
  };
  assertNotes(ships, report.vessels.length);
  assert.ok(expectedNotes.every(note => !people.getCell('A' + people.rowCount).text.includes(note)), 'personnel detail is unchanged');
  assert.equal(ships.pageSetup.printTitlesRow ?? '', '', 'single-page matrix includes its headers once; repeating titles can distort native PDF page size');
  assert.equal(people.pageSetup.printTitlesRow, '1:4', 'multi-page personnel detail keeps its existing repeated headings');
  assert.ok(ships.getRow(2).height >= 24, 'compact merged metadata must retain room for both caption lines');
  assert.equal(ships.pageSetup.orientation, 'portrait');
  assert.equal(ships.pageSetup.paperSize, 9, 'A4 paper');
  assert.equal(ships.pageSetup.fitToPage, true);
  assert.equal(ships.pageSetup.fitToWidth, 1);
  assert.equal(ships.pageSetup.fitToHeight, 1, 'entire ship matrix must print on one page');
  assert.equal(ships.getCell('E5').alignment.wrapText, true, 'supervisor names must wrap');
  for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => {
    const shrink = sheet === ships && Number(cell.row) >= 5 && Number(cell.row) <= 4 + report.vessels.length && [1, 2, 4, sheet.columnCount-1, sheet.columnCount].includes(Number(cell.col));
    assert.equal(Boolean(cell.alignment.wrapText), !shrink, `${sheet.name}!${cell.address} follows its column wrap policy`);
    assert.equal(Boolean(cell.alignment.shrinkToFit), shrink, `${sheet.name}!${cell.address} shrinks only the five selected fields`);
  }));
  assert.equal(Boolean(ships.getCell('E5').alignment.shrinkToFit), false);
  assert.ok(ships.getRow(5).height > 13, 'wrapped supervisor names must receive sufficient row height');
  assert.equal(ships.getColumn(5).width, 12.6, 'serialized supervisor width is half its previous 25.2');
  assert.ok(ships.getColumn(5).width >= ships.getColumn(6).width * 2, 'supervisor column reserves multiple names and enabled delegates');
  assert.ok((ships.getColumn(1).width ?? 9) < 16 && ships.getColumn(4).width < 28, 'fleet/type/names use compact widths; ExcelJS omits its default width 9');
  assert.equal(ships.views[0].ySplit, 4);
  assert.equal(people.getCell('D5').text, '測試甲輪 QA ALPHA');
  const strings = workbook.worksheets.flatMap(sheet => { const values = []; sheet.eachRow(row => row.eachCell(cell => values.push(cell.text))); return values; }).join('\n');
  assert.ok(!strings.includes('PRIVATE_'));
  assert.ok(!/來源版本|Rev\./.test(strings), 'workbook must omit the source revision');
  assert.ok(strings.includes('未分管人員己') && strings.includes('已激活代管') && strings.includes('預設代管') && strings.includes('測試代理丙*'));
  assert.equal(await downloadManagementAssignmentWorkbook(report, () => false), false, 'revoked context must not start a download');
  let checks = 0;
  assert.equal(await downloadManagementAssignmentWorkbook(report, () => ++checks === 1), false, 'revocation during workbook construction must prevent download');
  // Only contiguous whole assignments merge, by identity and direct/delegate status.
  const mergeData = structuredClone(original);
  mergeData.users.forEach(user => { user.managedVesselIds = []; });
  mergeData.users.push({ ...mergeData.users.find(user => user.id === 'a'), id: 'same-name', managedVesselIds: [] });
  const assignments = [
    [['a'], [{ userId: 'c', isActive: true }]],
    [['a'], [{ userId: 'c', isActive: true }]],
    [['a'], [{ userId: 'c', isActive: false }]],
    [['a'], [{ userId: 'c', isActive: false }]],
    [['same-name'], []],
    [[], []], [[], []],
    [['a'], [{ userId: 'c', isActive: true }]],
  ];
  mergeData.vessels = assignments.map(([assignedUserIds, delegateManagers], index) => ({ ...original.vessels[0], id: `merge-${index}`, name: `合併測試${index}`, fullName: `QA MERGE ${index}`, assignedUserIds, delegateManagers }));
  const mergedReport = buildManagementAssignmentReport(mergeData);
  const mergedPaper = renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: mergedReport }));
  assert.equal((mergedPaper.match(/rowspan="2"/gi) || []).length, 6, 'two adjacent personnel runs plus four vertical header cells');
  const mergedBook = new ExcelJS.Workbook();
  await mergedBook.xlsx.load(await buildManagementAssignmentWorkbook(mergedReport));
  const mergedSheet = mergedBook.worksheets[0];
  assert.deepEqual(mergedSheet.model.merges.filter(range => /^E(?:[5-9]|1[0-2]):E/.test(range)).sort(), ['E5:E6', 'E7:E8'], 'identity-aware vertical merges must match the PDF; blanks, different delegates, same-name people and nonadjacent runs stay separate');
  assert.equal(mergedSheet.getCell('E6').master.address, 'E5');
  assert.equal(mergedSheet.getCell('E8').master.address, 'E7');
  assert.equal(mergedSheet.getCell('E9').isMerged, false);
  assert.equal(mergedSheet.getCell('E10').isMerged, false);
  assert.equal(mergedSheet.getCell('E11').isMerged, false);
  assert.equal(mergedSheet.getCell('E12').isMerged, false);
  assert.deepEqual(mergedReport.vessels.map(row => row.id), assignments.map((_, index) => `merge-${index}`), 'merging never rearranges vessels');
  // Identical types at a fleet boundary and nonadjacent repeats stay separate.
  const groups = [['甲船隊', '油輪'], ['甲船隊', '油輪'], ['甲船隊', '化學船'], ['乙船隊', '化學船'], ['乙船隊', '化學船'], ['甲船隊', '油輪'], ['甲船隊', '油輪'], ['', ''], ['', '']];
  const groupReport = { ...structuredClone(report), vessels: groups.map(([fleet, shipType], index) => ({ ...structuredClone(report.vessels[0]), id: `group-${index}`, fleet, shipType })) };
  const expectedGroupSpans = [[3, 2], [0, 0], [0, 1], [2, 2], [0, 0], [2, 2], [0, 0], [1, 1], [1, 1]];
  const { assignmentGroupRowSpans } = await server.ssrLoadModule('/src/managementAssignmentReport.ts');
  const groupBefore = JSON.stringify(groupReport);
  assert.deepEqual(assignmentGroupRowSpans(groupReport), expectedGroupSpans);
  const groupPaper = renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: groupReport }));
  const pdfGroups = [...groupPaper.matchAll(/<td class="assignment-group-cell" rowspan="(\d+)"><span[^>]*>([^<]*)<\/span><\/td>/gi)].map(match => [match[2], Number(match[1])]);
  assert.deepEqual(pdfGroups, groups.flatMap((values, row) => values.flatMap((text, column) => expectedGroupSpans[row][column] ? [[text, expectedGroupSpans[row][column]]] : [])), 'PDF contains only actual group masters with the correct rowspan');
  const groupBook = new ExcelJS.Workbook();
  await groupBook.xlsx.load(await buildManagementAssignmentWorkbook(groupReport));
  const groupSheet = groupBook.worksheets[0];
  assert.deepEqual(groupMerges(groupSheet), ['A10:A11', 'A5:A7', 'A8:A9', 'B10:B11', 'B5:B6', 'B8:B9']);
  for (let row = 5; row < 5 + groups.length; row++) for (const column of [3, 4, groupSheet.columnCount - 1, groupSheet.columnCount]) assert.equal(groupSheet.getCell(row, column).isMerged, false, 'vessel names and particulars are never merged');
  assert.equal(JSON.stringify(groupReport), groupBefore, 'group merging cannot alter data or reorder vessels');
  const empty = buildManagementAssignmentReport({ ...original, vessels: [], users: [] });
  assert.deepEqual(assignmentGroupRowSpans(empty), []);
  assert.deepEqual(empty.departments, ['分管人員']);
  assert.ok(renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: empty })).includes('目前無啟用船舶'));
  const emptyBook = new ExcelJS.Workbook();
  await emptyBook.xlsx.load(await buildManagementAssignmentWorkbook(empty));
  assert.equal(emptyBook.worksheets[0].getCell('A5').text, '目前無啟用船舶');
  assertNotes(emptyBook.worksheets[0], 0);
  assert.ok(renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: empty })).endsWith(expectedNotes.map(note => `<div>${note}</div>`).join('') + '</footer></article>'));
  console.log('PASS assignment export: mounted entry markup, source/roles/delegation, names, frozen redacted DTO, PDF renderer, serialized Excel and late-revocation guard');
} finally {
  delete globalThis.window;
  await server.close();
}
