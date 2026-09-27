import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent' });
const cases = [];
try {
  const api = await vite.ssrLoadModule('/src/tracking/trackingStatistics.ts');
  const query = { vesselId: 'v1', vesselIds: ['v1', 'v2'], from: '', to: '', type: 'all', urgency: 'all' };
  const row = (id, vesselId, done = false) => ({ id, vesselId, kind: 'supply', requestType: 'spares', referenceNo: 'SAME', description: 'PRIVATE', progress: 'PRIVATE PROGRESS', applicationDate: '2026-09-01', expectedDate: '2026-09-20', actualDeliveryDate: done ? '2026-09-19' : '', deliveryStatus: done ? 'delivered' : 'not-delivered', urgency: 'normal', isClosed: false, statusLogs: [] });
  const items = [row('one', 'v1', true), row('two', 'v2'), row('three', 'v2'), row('outside', 'v3')];
  const stats = api.calculateTrackingStatistics(items, query, '2026-09-27');
  assert.equal(stats.summary.total, 3, 'explicit multi-vessel scope must include both selected vessels, not only the editor vessel');
  assert.equal(stats.summary.completionRate, 1 / 3, 'aggregate counts, never average vessel rates');
  assert.equal(stats.summary.delayRate, 2 / 3);
  assert.equal(api.calculateTrackingStatistics(items, { ...query, vesselIds: [] }, '2026-09-27').summary.total, 0, 'explicit empty scope must not fall back to all or the editor vessel');
  assert.equal(api.calculateTrackingStatistics(items, { ...query, vesselIds: undefined }, '2026-09-27').summary.total, 1, 'legacy single-vessel call remains narrow');
  cases.push('explicit-scope-weighted-rates-empty-and-legacy');
  const reports = await vite.ssrLoadModule('/src/tracking/trackingStatisticsReport.ts');
  const report = reports.makeStatisticsReport(items, query, { metric: 'total', category: 'all' }, { vesselName: '全船隊', generatedAt: '2026-09-27T00:00:00Z', today: '2026-09-27' });
  assert.equal(report.rows, undefined, 'statistics report must no longer contain per-item detail rows');
  assert.equal(report.stats.rows, undefined, 'summary projection must strip underlying item rows, not just hide the table');
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  assert.equal(report.stats.summary.total, 3);
  cases.push('report-summary-only-no-item-content');
  const fs = await import('node:fs');
  const scopeApi = fs.existsSync('src/tracking/trackingStatisticsScope.ts') ? await vite.ssrLoadModule('/src/tracking/trackingStatisticsScope.ts') : null;
  assert.equal(typeof scopeApi?.resolveStatisticsVessels, 'function', 'statistics requires an independent exact vessel/fleet/type scope resolver');
  const vessels = [
    { id: 'v1', name: '甲船', shortName: 'A', fullName: 'VESSEL A', shipType: '巴拿馬散', fleetCategory: 'bulk fleet', isActive: true },
    { id: 'v2', name: 'VESSEL B', shortName: 'B', fullName: 'VESSEL B', shipType: '成品油', fleetCategory: 'tanker fleet', isActive: true },
    { id: 'off', name: '停用', shortName: 'OFF', fullName: 'OFF', shipType: '巴拿馬散', fleetCategory: 'bulk fleet', isActive: false },
    { id: 'other', name: '其他', shortName: 'O', fullName: 'OTHER', shipType: '', fleetCategory: '', isActive: true },
  ];
  const catalog = scopeApi.statisticsVesselCatalog(vessels);
  assert.deepEqual(scopeApi.resolveStatisticsVessels(catalog, { kind: 'all', value: '' }), ['v1', 'v2', 'other']);
  assert.deepEqual(scopeApi.resolveStatisticsVessels(catalog, { kind: 'fleet', value: 'bulk fleet' }), ['v1']);
  assert.deepEqual(scopeApi.resolveStatisticsVessels(catalog, { kind: 'fleet', value: 'tanker fleet' }), ['v2']);
  assert.deepEqual(scopeApi.resolveStatisticsVessels(catalog, { kind: 'type', value: '巴拿馬散' }), ['v1']);
  assert.deepEqual(scopeApi.resolveStatisticsVessels(catalog, { kind: 'type', value: '' }), ['other']);
  assert.deepEqual(scopeApi.resolveStatisticsVessels(catalog, { kind: 'vessel', value: 'missing' }), []);
  assert.ok(scopeApi.statisticsScopeOptions(catalog).some(o => o.label === '甲船 VESSEL A'));
  assert.ok(!scopeApi.statisticsScopeOptions(catalog).some(o => o.label.includes('停用')));
  cases.push('active-exact-fleet-type-single-and-bilingual-scope');
  const chartsApi = fs.existsSync('src/tracking/TrackingStatisticsCharts.tsx') ? await vite.ssrLoadModule('/src/tracking/TrackingStatisticsCharts.tsx') : null;
  assert.equal(typeof chartsApi?.trackingStatisticsCharts, 'function', 'replace details with chart totals');
  const charts = chartsApi.trackingStatisticsCharts(stats);
  assert.equal(charts.length, 3);
  for (const chart of charts) assert.equal(chart.rows.reduce((sum, r) => sum + r.value, 0), chart.total);
  assert.equal(charts[0].total, 3);
  cases.push('three-chart-partitions-reconcile-with-summary');
  const raw = { protocol: 'ship-tracking-statistics-v1', workspace: 'qa', vessels: catalog, vesselIds: ['v1', 'v2', 'other'], at: '2026-09-27T00:00:00Z', today: '2026-09-27', stats: report.stats };
  assert.equal(typeof scopeApi.parseStatisticsSnapshot, 'function', 'ship receiver must validate aggregate scope and reject partial/extra detail payloads');
  assert.equal(scopeApi.parseStatisticsSnapshot(raw, 'qa', { kind: 'all', value: '' }).stats.summary.total, 3);
  for (const invalid of [{ ...raw, workspace: 'other' }, { ...raw, vesselIds: ['v1'] }, { ...raw, rows: [] }, { ...raw, stats: { ...raw.stats, rows: [] } }, { ...raw, stats: { ...raw.stats, categories: [] } }]) assert.throws(() => scopeApi.parseStatisticsSnapshot(invalid, 'qa', { kind: 'all', value: '' }));
  cases.push('public-aggregate-envelope-scope-and-no-detail-validation');
  console.log(JSON.stringify({ gate: 'tracking-fleet-statistics', status: 'PASS', cases }));
} finally { await vite.close(); }
