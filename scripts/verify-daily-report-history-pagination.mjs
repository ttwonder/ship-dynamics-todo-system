import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const history = await server.ssrLoadModule('/src/dailyReportHistory.ts');
  assert.equal(history.DAILY_REPORT_HISTORY_PAGE_SIZE, 30, 'daily report histories must show at most 30 dates per page');

  const rows = Array.from({ length: 65 }, (_, index) => ({
    id: `report-${index}`,
    businessDate: new Date(Date.UTC(2026, 8, 4 - index)).toISOString().slice(0, 10),
  }));

  const first = history.paginateDailyReportHistory(rows, 1);
  assert.equal(first.page, 1);
  assert.equal(first.pageCount, 3);
  assert.equal(first.total, 65);
  assert.equal(first.items.length, 30);
  assert.equal(first.items[0].id, 'report-0');
  assert.equal(first.items[29].id, 'report-29');

  const overflow = history.paginateDailyReportHistory(rows, 99);
  assert.equal(overflow.page, 3, 'an out-of-range page must clamp to the last page');
  assert.equal(overflow.items.length, 5);
  assert.equal(overflow.items[0].id, 'report-60');

  const target = history.locateDailyReportDate(rows, rows[44].businessDate);
  assert.deepEqual(target, { index: 44, page: 2 }, 'date location must select the page containing the exact day');
  assert.equal(history.locateDailyReportDate(rows, '2025-01-01'), null, 'a missing date must not silently jump to a different day');

  const unsorted = [rows[32], rows[0], rows[31]];
  const sorted = history.sortDailyReportHistory(unsorted);
  assert.deepEqual(sorted.map(row => row.id), ['report-0', 'report-31', 'report-32'], 'daily histories must be newest first without mutating the input');
  assert.deepEqual(unsorted.map(row => row.id), ['report-32', 'report-0', 'report-31']);

  console.log('daily_report_history_pagination=PASS');
} finally {
  await server.close();
}
