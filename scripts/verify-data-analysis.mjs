import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const cases = [];
const test = (name, run) => { run(); cases.push(name); };
try {
  const model = await server.ssrLoadModule('/src/dataAnalysisModel.ts');
  const { createDataAnalysisFixture } = await server.ssrLoadModule('/scripts/fixtures/data-analysis.ts');
  const { default: Analysis } = await server.ssrLoadModule('/src/DataAnalysis.tsx');
  const { taskVesselIds } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const fixture = createDataAnalysisFixture();
  const before = JSON.stringify(fixture);
  const ids = new Set(fixture.vessels.map(v => v.id));
  const tasks = fixture.data.tasks.filter(t => taskVesselIds(t).some(id => ids.has(id)));
  const filters = { fromDate: '2026-01-01', toDate: '2026-03-31', source: 'all' };
  const selected = model.filterAnalysisTasks(tasks, filters);
  test('inclusive date cohort and no mutation', () => {
    assert.deepEqual(selected.map(t => t.id), ['a','b','c','d']);
    assert.equal(model.filterAnalysisTasks(tasks, model.emptyAnalysisFilters).length, 7);
    assert.equal(JSON.stringify(fixture), before);
  });
  test('source discriminator including legacy meeting provenance', () => {
    assert.deepEqual(model.filterAnalysisTasks(tasks, { ...filters, source: 'ordinary' }).map(t => t.id), ['a','b','c']);
    assert.deepEqual(model.filterAnalysisTasks(tasks, { ...filters, source: 'meeting' }).map(t => t.id), ['d']);
    for (const patch of [{ sourceMeetingId: 'legacy', sourceType: 'morning' }, { sourceMeetingId: '', sourceType: 'morning', attentionDimension: 'meeting' }]) {
      assert.equal(model.filterAnalysisTasks([{ ...tasks[0], ...patch }], { ...filters, source: 'meeting' }).length, 1);
    }
  });
  test('Taipei midnight and malformed dates', () => {
    const boundary = { ...tasks[0], createdAt: '2026-01-31T16:00:00.000Z' };
    assert.equal(model.analysisCreatedDate(boundary), '2026-02-01');
    assert.equal(model.filterAnalysisTasks([boundary], { ...filters, fromDate: '2026-01-31', toDate: '2026-01-31' }).length, 0);
    assert.equal(model.filterAnalysisTasks([boundary], { ...filters, fromDate: '2026-02-01', toDate: '2026-02-01' }).length, 1);
    assert.equal(model.analysisCreatedDate({ createdAt: '2026-02-30T00:00:00Z' }), '');
    assert.equal(model.analysisCreatedDate({ createdAt: 'invalid-date' }), '');
    assert.match(model.analysisDateError({ fromDate: '2026-02-30', toDate: '' }), /日期格式無效/);
    assert.deepEqual(model.filterAnalysisTasks(tasks, { ...filters, fromDate: '2027-01-01' }), []);
  });
  test('monthly series fills missing periods and counts a multi-vessel task once', () => {
    const trend = model.buildAnalysisTrend(selected, { ...filters, interval: 'month' });
    assert.deepEqual(trend.points.map(p => [p.key,p.ordinary,p.meeting]), [['2026-01-01',2,0],['2026-02-01',0,0],['2026-03-01',1,1]]);
  });
  test('Monday week buckets include only the selected edge days', () => {
    const trend = model.buildAnalysisTrend(tasks, { fromDate: '2026-01-02', toDate: '2026-01-09', interval: 'week' });
    assert.deepEqual(trend.points.map(p => [p.key,p.ordinary,p.meeting]), [['2025-12-29',1,0],['2026-01-05',0,0]]);
  });
  test('daily and empty ranges with zero-valued points', () => {
    assert.equal(model.buildAnalysisTrend(selected, { ...filters, interval: 'day' }).points.length, 90);
    const empty = model.buildAnalysisTrend([], { fromDate: '2026-02-01', toDate: '2026-02-03', interval: 'day' });
    assert.deepEqual(empty.points.map(p => [p.ordinary,p.meeting]), [[0,0],[0,0],[0,0]]);
    assert.deepEqual(model.buildAnalysisTrend([], { fromDate: '', toDate: '', interval: 'month' }).points, []);
  });
  test('undated records remain in unlimited counts but never make up a trend date', () => {
    const trend = model.buildAnalysisTrend(tasks, { fromDate: '', toDate: '', interval: 'month' });
    assert.equal(trend.invalidDates, 1);
    assert.equal(trend.points.reduce((n,p) => n+p.ordinary+p.meeting,0), 6);
    assert.equal(trend.fromDate, '2026-01-02'); assert.equal(trend.toDate, '2026-05-03');
  });
  test('wide periods produce an explicit limit rather than truncating the chart', () => {
    const result = model.buildAnalysisTrend(tasks, { fromDate: '2020-01-01', toDate: '2026-01-01', interval: 'day' });
    assert.match(result.error, /366/); assert.deepEqual(result.points, []);
    const reversed = model.buildAnalysisTrend(tasks, { fromDate: '2026-03-01', toDate: '2026-01-01', interval: 'month' });
    assert.match(reversed.error, /日期起不得晚於日期迄/);
  });
  test('ranking directions, ties and input stability', () => {
    const rows = [
      { id:'a', metrics:{ total:3, completionRate:50, overdueRate:10, overdue:2, proposed:1 } },
      { id:'b', metrics:{ total:3, completionRate:50, overdueRate:0, overdue:0, proposed:2 } },
      { id:'c', metrics:{ total:1, completionRate:0, overdueRate:0, overdue:0, proposed:0 } },
    ];
    const original = JSON.stringify(rows);
    assert.deepEqual(model.sortAnalysisRows(rows,'completionRate').map(r=>[r.id,r.rank]), [['b',1],['a',1],['c',3]]);
    assert.deepEqual(model.sortAnalysisRows(rows,'total').map(r=>r.rank), [1,1,3]);
    assert.equal(model.sortAnalysisRows(rows,'overdue')[0].id,'a');
    assert.equal(model.sortAnalysisRows(rows,'proposed')[0].id,'b');
    assert.equal(JSON.stringify(rows),original);
  });
  test('mounted view keeps visible scope, original metrics and distinct-source category denominators', () => {
    const html = renderToStaticMarkup(React.createElement(Analysis, fixture));
    assert.doesNotMatch(html, /QA HIDDEN/);
    assert.match(html, /<small>責任事項<\/small><b>7<\/b>/);
    assert.match(html, /<small>完成率<\/small><b>29<\/b>/);
    assert.match(html, /<small>高風險<\/small><b>4<\/b>/);
    assert.match(html, /data-category="維修" data-count="3" data-share="60"/);
    assert.match(html, /data-category="維修" data-count="1" data-share="50"/);
    assert.equal(JSON.stringify(fixture), before);
  });
  console.log(JSON.stringify({ result: 'PASS', count: cases.length, cases }, null, 2));
} finally { await server.close(); }
