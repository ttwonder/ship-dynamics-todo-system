import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { assignmentExportFixture } from './management-assignment-export-fixture.mjs';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const data = assignmentExportFixture(createInitialData());
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
  assert.deepEqual(report.vessels[0].cells[0], { direct: ['測試督導甲'], delegates: ['測試代理丙'] }, 'dedupe direct/delegated IDs and exclude owner, ship, disabled and missing accounts');
  assert.equal(assignmentCellText(report.vessels[0].cells[0]), '測試督導甲\n（代理：測試代理丙）');
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
  for (const text of ['目前船舶分管表', '測試甲輪', 'QA ALPHA', '測試督導甲', '（代理：測試代理丙）', '純中文測試輪', 'FPMC QA BETA']) assert.ok(paper.includes(text), text);
  assert.ok(!/PRIVATE_|停用人員戊|未激活代理丁|INACTIVE SHIP/.test(paper));
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
  assert.equal(ships.getCell('E5').text, '測試督導甲\n（代理：測試代理丙）');
  assert.equal(ships.rowCount, 4 + report.vessels.length);
  assert.equal(ships.pageSetup.printTitlesRow, '1:4');
  assert.ok(ships.getRow(2).height >= 34, 'merged metadata must have room for the full wrapped caption');
  assert.equal(ships.views[0].ySplit, 4);
  assert.equal(people.getCell('D5').text, '測試甲輪 QA ALPHA');
  const strings = workbook.worksheets.flatMap(sheet => { const values = []; sheet.eachRow(row => row.eachCell(cell => values.push(cell.text))); return values; }).join('\n');
  assert.ok(!strings.includes('PRIVATE_'));
  assert.ok(strings.includes('未分管人員己') && strings.includes('已啟用代理'));
  assert.equal(await downloadManagementAssignmentWorkbook(report, () => false), false, 'revoked context must not start a download');
  let checks = 0;
  assert.equal(await downloadManagementAssignmentWorkbook(report, () => ++checks === 1), false, 'revocation during workbook construction must prevent download');
  const empty = buildManagementAssignmentReport({ ...original, vessels: [], users: [] });
  assert.deepEqual(empty.departments, ['分管人員']);
  assert.ok(renderToStaticMarkup(React.createElement(ManagementAssignmentPaper, { report: empty })).includes('目前無啟用船舶'));
  await new ExcelJS.Workbook().xlsx.load(await buildManagementAssignmentWorkbook(empty));
  console.log('PASS assignment export: mounted entry markup, source/roles/delegation, names, frozen redacted DTO, PDF renderer, serialized Excel and late-revocation guard');
} finally {
  delete globalThis.window;
  await server.close();
}
