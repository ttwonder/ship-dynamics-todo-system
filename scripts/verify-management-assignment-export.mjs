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
  assert.deepEqual(report.vessels[0].cells[0], { direct: ['測試督導甲'], delegates: ['測試代理丙'], mergeKey: JSON.stringify([['a'], ['c']]) }, 'dedupe direct/delegated IDs and exclude owner, ship, disabled and missing accounts');
  assert.equal(assignmentCellText(report.vessels[0].cells[0]), '測試督導甲\n（測試代理丙）');
  assert.equal(report.vessels[1].chineseName, '純中文測試輪');
  assert.equal(report.vessels[1].englishName, '');
  assert.equal(report.vessels[2].chineseName, '', 'English alias is not a Chinese name');
  assert.equal(report.vessels[2].englishName, 'FPMC QA BETA');
  assert.deepEqual(report.people.find(p => p.id === 'b').directVessels, ['FPMC QA BETA'], 'person-side assignment remains authoritative too');
  assert.deepEqual(report.people.find(p => p.id === 'c').delegateVessels, ['測試甲輪 QA ALPHA']);
  assert.deepEqual(report.people.find(p => p.id === 'd').delegateVessels, [], 'inactive delegation cannot be listed as current');
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
  const paper = renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report }));
  for (const text of ['目前船舶分管表', '測試甲輪', 'QA ALPHA', '測試督導甲', '（測試代理丙）', '純中文測試輪', 'FPMC QA BETA']) assert.ok(paper.includes(text), text);
  assert.ok(!/PRIVATE_|停用人員戊|未激活代理丁|INACTIVE SHIP/.test(paper));
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
  assert.equal(ships.getCell('C5').text, '測試甲輪');
  assert.equal(ships.getCell('D5').text, 'QA ALPHA');
  assert.equal(ships.getCell(3, ships.columnCount-1).text, '年分');
  assert.equal(ships.getCell(3, ships.columnCount).text, '噸數');
  assert.equal(ships.getCell(5, ships.columnCount-1).text, '2021.06');
  assert.equal(ships.getCell(5, ships.columnCount).text, '2.0萬');
  assert.equal(ships.getCell('E5').text, '測試督導甲 （測試代理丙）');
  assert.equal(ships.rowCount, 4 + report.vessels.length);
  assert.equal(ships.pageSetup.printTitlesRow ?? '', '', 'single-page matrix includes its headers once; repeating titles can distort native PDF page size');
  assert.equal(people.pageSetup.printTitlesRow, '1:4', 'multi-page personnel detail keeps its existing repeated headings');
  assert.ok(ships.getRow(2).height >= 24, 'compact merged metadata must retain room for both caption lines');
  assert.equal(ships.pageSetup.orientation, 'portrait');
  assert.equal(ships.pageSetup.paperSize, 9, 'A4 paper');
  assert.equal(ships.pageSetup.fitToPage, true);
  assert.equal(ships.pageSetup.fitToWidth, 1);
  assert.equal(ships.pageSetup.fitToHeight, 1, 'entire ship matrix must print on one page');
  assert.equal(Boolean(ships.getCell('E5').alignment.wrapText), false, 'OOXML omits false wrapText; absent also means no wrapping');
  assert.equal(ships.getCell('E5').alignment.shrinkToFit, true);
  assert.equal(ships.getColumn(5).width, 12.6, 'serialized supervisor width is half its previous 25.2');
  assert.ok(ships.getColumn(5).width >= ships.getColumn(6).width * 2, 'supervisor column reserves multiple names and enabled delegates');
  assert.ok((ships.getColumn(1).width ?? 9) < 16 && ships.getColumn(4).width < 28, 'fleet/type/names use compact widths; ExcelJS omits its default width 9');
  assert.equal(ships.views[0].ySplit, 4);
  assert.equal(people.getCell('D5').text, '測試甲輪 QA ALPHA');
  const strings = workbook.worksheets.flatMap(sheet => { const values = []; sheet.eachRow(row => row.eachCell(cell => values.push(cell.text))); return values; }).join('\n');
  assert.ok(!strings.includes('PRIVATE_'));
  assert.ok(!/來源版本|Rev\./.test(strings), 'workbook must omit the source revision');
  assert.ok(strings.includes('未分管人員己') && strings.includes('已啟用代理'));
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
    [['a'], []],
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
  const empty = buildManagementAssignmentReport({ ...original, vessels: [], users: [] });
  assert.deepEqual(empty.departments, ['分管人員']);
  assert.ok(renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: empty })).includes('目前無啟用船舶'));
  await new ExcelJS.Workbook().xlsx.load(await buildManagementAssignmentWorkbook(empty));
  console.log('PASS assignment export: mounted entry markup, source/roles/delegation, names, frozen redacted DTO, PDF renderer, serialized Excel and late-revocation guard');
} finally {
  delete globalThis.window;
  await server.close();
}
