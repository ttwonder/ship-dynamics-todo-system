import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Render production JSX without mounting login or accessing any cloud service.
function printSection(source, filename, className) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.text === 'className'
      && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === className)) found = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, `Missing real print section ${filename}: ${className}`);
  return found;
}
const server = await createServer({
  server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent',
  plugins: [{ name: 'pdf-name-test-exports', enforce: 'pre', transform(source, id) {
    const filename = id.replaceAll('\\', '/').split('?')[0];
    if (filename.endsWith('/src/App.tsx')) {
      return `${source}\nexport { ReportPreviewModal };`;
    }
    const className = filename.endsWith('/src/WorkCenter.tsx') ? 'work-print-list print-only'
      : filename.endsWith('/src/InternalControlPage.tsx') ? 'internal-control-print print-only' : '';
    if (className) return `${source}\nexport function PdfNameQaPrint({user,vessels,printTasks,printInternalCases,visibleVesselIds,subpage,summary,printSummary,printCases,stats,printStats,filters,analyticsFilterSummary,analysisSelection,setAnalysisSelection}) { return (${printSection(source, filename, className)}); }`;
  } }],
});
try {
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { ReportPreviewModal } = await server.ssrLoadModule('/src/App.tsx');
  const data = normalizeAppData({
    revision: 1, updatedAt: '2026-09-17T00:00:00Z',
    settings: { systemTitle: 'PDF NAME QA', departments: [], rolePermissions: {} },
    users: [{ id: 'qa-owner', name: 'QA', role: 'owner', isActive: true }],
    vessels: [
      { id: 'qa-bilingual', name: '測試甲船', shortName: 'QA ALPHA', fullName: 'FPMC QA ALPHA', isActive: true },
      { id: 'qa-english', name: 'QA BETA', shortName: 'QA BETA', fullName: 'FPMC QA BETA', isActive: true },
      { id: 'qa-chinese', name: '測試丙船', shortName: '', fullName: '', isActive: true },
    ],
    tasks: [
      { id: 'qa-single', vesselId: 'qa-bilingual', description: 'QA SINGLE TASK', categories: [], sourceType: 'morning', createdAt: '2026-09-17T00:00:00Z' },
      { id: 'qa-cross', vesselId: 'qa-bilingual', vesselIds: ['qa-bilingual', 'qa-english'], vesselScopeMode: 'vessels', description: 'QA CROSS TASK', categories: [], sourceType: 'morning', createdAt: '2026-09-17T00:00:00Z' },
    ], meetings: [], internalControlCases: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  const markup = renderToStaticMarkup(React.createElement(ReportPreviewModal, {
    data, visibleVessels: data.vessels, user: data.users[0], selected: [],
    reportDate: '2026-09-17', close() {}, onPrint() {},
  }));
  const names = [...markup.matchAll(/class="report-vessel-name-cell"><strong>(.*?)<\/strong>/g)].map(match => match[1]);
  assert.deepEqual(names, ['測試甲船 FPMC QA ALPHA', 'FPMC QA BETA', '測試丙船'],
    'PDF name cells must show Chinese + English, or the one available name');
  const { pdfVesselDisplayName, vesselDisplayName, dashboardVesselDisplayName } = await server.ssrLoadModule('/src/vesselDisplay.ts');
  const { taskReportVesselLabel, taskVesselLabel } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const { meetingPdfVesselSummary } = await server.ssrLoadModule('/src/meetingPdf.ts');
  const nameCases = [
    [{ name: '  測試甲船  ', fullName: ' FPMC QA ALPHA ' }, '測試甲船 FPMC QA ALPHA'],
    [{ name: '', fullName: 'FPMC QA BETA' }, 'FPMC QA BETA'],
    [{ name: 'QA BETA', shortName: 'QA BETA', fullName: 'FPMC QA BETA' }, 'FPMC QA BETA'],
    [{ name: 'FPMC QA BETA', fullName: 'FPMC QA BETA' }, 'FPMC QA BETA'],
    [{ name: '測試丙船', fullName: '' }, '測試丙船'],
    [{ name: '測試丙船', fullName: '測試丙船' }, '測試丙船'],
    [{ name: '測試甲船', shortName: '測試甲船', fullName: 'FPMC QA ALPHA' }, '測試甲船 FPMC QA ALPHA'],
    [{ shortName: 'QA ONLY' }, 'QA ONLY'],
    [{ id: 'unknown-vessel' }, 'unknown-vessel'],
    [null, '未明船舶'],
  ];
  for (const [input, expected] of nameCases) assert.equal(pdfVesselDisplayName(input), expected);
  const vessels = data.vessels;
  const task = { vesselId: vessels[0].id, vesselIds: [vessels[0].id, vessels[1].id], vesselScopeMode: 'vessels' };
  const expectedPair = '測試甲船 FPMC QA ALPHA、FPMC QA BETA';
  assert.match(markup, /QA SINGLE TASK/, 'also render a vessel with tasks');
  assert.match(markup, /class="task-vessel-scope"><b>測試甲船 FPMC QA ALPHA、FPMC QA BETA<\/b>/, 'real cross-vessel report section');
  const unchanged = JSON.stringify({ task, vessels });
  assert.equal(taskReportVesselLabel(task, vessels), expectedPair, 'cross-vessel PDF rows must include Chinese names');
  assert.equal(taskReportVesselLabel(task, [vessels[0]]), '測試甲船 FPMC QA ALPHA', 'do not expand report selection');
  assert.equal(taskVesselLabel(task, vessels, pdfVesselDisplayName), expectedPair, 'work-center PDF names');
  assert.equal(taskVesselLabel({ ...task, vesselScopeMode: 'all' }, vessels, pdfVesselDisplayName), '全部船舶');
  assert.equal(taskVesselLabel(task, [vessels[0]], pdfVesselDisplayName), '測試甲船 FPMC QA ALPHA、另含受限船舶 1 艘');
  assert.equal(meetingPdfVesselSummary({ vessels: task.vesselIds }, vessels), expectedPair, 'meeting PDF names');
  assert.equal(meetingPdfVesselSummary({ vessels: task.vesselIds, vesselScopeMode: 'all' }, vessels), '全部船舶');
  assert.equal(meetingPdfVesselSummary({ vessels: task.vesselIds, vesselScopeMode: 'types', vesselTypeScopes: ['油輪'] }, vessels), '船舶類型：油輪');
  assert.equal(vesselDisplayName(vessels[0]), 'FPMC QA ALPHA', 'ordinary UI labels must not change');
  assert.equal(dashboardVesselDisplayName(vessels[0]), '測試甲船 FPMC QA ALPHA', 'dashboard labels must not change');
  assert.equal(taskVesselLabel(task, vessels), 'FPMC QA ALPHA、FPMC QA BETA', 'ordinary task UI must not change');
  assert.equal(JSON.stringify({ task, vessels }), unchanged, 'formatting must not mutate data');
  const testTask = { ...task, id: 'qa-task', description: 'QA TASK', status: 'QA STATUS', departments: [], statusLogs: [], priority: '中' };
  const testCase = { id: 'qa-case', vesselId: vessels[0].id, description: 'QA CASE', status: '', departments: [], priority: '中' };
  const work = await server.ssrLoadModule('/src/WorkCenter.tsx');
  const internal = await server.ssrLoadModule('/src/InternalControlPage.tsx');
  const workMarkup = renderToStaticMarkup(React.createElement(work.PdfNameQaPrint, {
    user: data.users[0], vessels, printTasks: [testTask], printInternalCases: [testCase], visibleVesselIds: new Set(vessels.map(vessel => vessel.id)),
  }));
  assert.match(workMarkup, /<td>測試甲船 FPMC QA ALPHA<\/td>/, 'work-center internal-case PDF row');
  assert.match(workMarkup, /<td>測試甲船 FPMC QA ALPHA、FPMC QA BETA<\/td>/, 'work-center task PDF row');
  const internalMarkup = renderToStaticMarkup(React.createElement(internal.PdfNameQaPrint, {
    user: data.users[0], vessels, printCases: [testCase], subpage: 'open', summary: 'QA', printSummary: 'QA',
  }));
  assert.match(internalMarkup, /<td>測試甲船 FPMC QA ALPHA<\/td>/, 'internal-control PDF row');
  const selected = await server.ssrLoadModule('/src/SelectedTaskPrintTable.tsx');
  const selectedMarkup = renderToStaticMarkup(React.createElement(selected.default, {
    title: 'QA', tasks: [{ ...testTask, categories: [], ownerUserIds: [] }], vessels, users: [], exportedBy: 'QA',
  }));
  assert.match(selectedMarkup, /<td>測試甲船 FPMC QA ALPHA、FPMC QA BETA<\/td>/, 'selected/open/closed task PDF rows');
  const { buildInternalControlStats } = await server.ssrLoadModule('/src/internalControlWorkflow.ts');
  const statCase = { ...testCase, reportDate: '2026-09-17', reportSource: '日常', category: 'QA' };
  const stats = buildInternalControlStats([statCase], vessels);
  const pdfStats = buildInternalControlStats([statCase], vessels, pdfVesselDisplayName);
  assert.deepEqual(pdfStats.byVessel, [{ label: '測試甲船 FPMC QA ALPHA', count: 1 }], 'PDF statistics names');
  assert.deepEqual(stats.byVessel, [{ label: '測試甲船', count: 1 }], 'web/Excel statistics names must not change');
  assert.deepEqual({ ...pdfStats, byVessel: [] }, { ...stats, byVessel: [] }, 'only statistic name labels may change');
  const statsMarkup = renderToStaticMarkup(React.createElement(internal.PdfNameQaPrint, {
    user: data.users[0], vessels, printCases: [statCase], subpage: 'stats', summary: 'QA', printSummary: 'QA', stats,
    filters: { fromDate: '', toDate: '' }, analyticsFilterSummary: '',
    analysisSelection: { dimension: 'vessel', interval: 'month', focusKey: '' }, setAnalysisSelection() {},
  }));
  assert.match(statsMarkup, /<span>測試甲船 FPMC QA ALPHA<\/span>/, 'real statistics PDF section');
  if (process.env.PDF_NAME_QA_HTML) {
    const css = fs.readFileSync('src/styles.css', 'utf8');
    fs.writeFileSync(process.env.PDF_NAME_QA_HTML, `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>PDF NAME QA — TEST DATA</title><style>${css}</style></head><body class="printing-report">${markup}</body></html>`);
  }
  console.log('PASS real morning PDF renderer and PDF name/scope/UI-preservation cases');
} finally {
  await server.close();
}
