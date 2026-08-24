import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { classifyMorningAgenda } = await server.ssrLoadModule('/src/morningAgenda.ts');
  const window = { startedAt: '2026-08-03T01:00:00.000Z', endedAt: '2026-08-04T01:30:00.000Z' };
  const task = (id, extra = {}) => ({
    id, vesselId: 'v1', vesselIds: ['v1'], sourceType: 'morning', priority: '中', isInternalControl: false, isClosed: false, description: id,
    createdAt: '2026-08-02T01:00:00.000Z', updatedAt: '2026-08-02T01:00:00.000Z', ...extra,
  });
  const internalCase = (id, extra = {}) => ({
    id, vesselId: 'v1', priority: '中', isClosed: false, description: id, createdAt: '2026-08-02T01:00:00.000Z', updatedAt: '2026-08-02T01:00:00.000Z', ...extra,
  });
  const result = classifyMorningAgenda({
    tasks: [
      task('history-task'),
      task('changed-task', { description: '切點後內容', updatedAt: '2026-08-03T03:00:00.000Z' }),
      task('technical-task', { updatedAt: '2026-08-03T03:00:00.000Z' }),
      task('closed-task', { isClosed: true, updatedAt: '2026-08-03T04:00:00.000Z' }),
      task('old-closed-task', { isClosed: true }),
      task('linked-internal-task', { isInternalControl: true, internalControlCaseId: 'linked-case', updatedAt: '2026-08-03T05:00:00.000Z' }),
      task('hidden-meeting-task', { sourceType: 'temporary', sourceMeetingId: 'm-hidden', updatedAt: '2026-08-03T05:00:00.000Z' }),
      task('visible-meeting-task', { sourceType: 'temporary', sourceMeetingId: 'm-visible', updatedAt: '2026-08-03T05:00:00.000Z' }),
    ],
    internalControlCases: [
      internalCase('linked-case', { description: '切點後內控', updatedAt: '2026-08-03T05:00:00.000Z' }),
      internalCase('technical-case', { updatedAt: '2026-08-03T05:00:00.000Z' }),
      internalCase('history-case'),
      internalCase('closed-case', { isClosed: true, updatedAt: '2026-08-03T06:00:00.000Z' }),
      internalCase('old-closed-case', { isClosed: true }),
      internalCase('other-vessel-case', { vesselId: 'v2', updatedAt: '2026-08-03T06:00:00.000Z' }),
    ],
    meetings: [
      { id: 'm-hidden', includeInMorning: false },
      { id: 'm-visible', includeInMorning: true },
    ],
    scopeVesselIds: ['v1'],
    window,
    baselineTasks: [
      task('history-task'),
      task('changed-task', { description: '切點前內容' }),
      task('technical-task'),
    ],
    baselineInternalControlCases: [
      internalCase('linked-case', { description: '切點前內控' }),
      internalCase('history-case'),
      internalCase('technical-case'),
    ],
  });

  assert.deepEqual(result.todayTasks.map(item => item.id).sort(), ['changed-task', 'closed-task', 'visible-meeting-task']);
  assert.deepEqual(result.historyTasks.map(item => item.id).sort(), ['history-task', 'technical-task']);
  assert.deepEqual(result.todayInternalControlCases.map(item => item.id).sort(), ['closed-case', 'linked-case']);
  assert.deepEqual(result.historyInternalControlCases.map(item => item.id).sort(), ['history-case', 'technical-case']);
  assert.equal(result.todayTasks.some(item => item.isInternalControl), false, '同步內控只可顯示 canonical 內控案件，不得重複顯示內控要事');

  const frozen = classifyMorningAgenda({
    tasks: [task('changed-after-cutoff', { updatedAt: '2026-08-04T03:00:00.000Z' })],
    internalControlCases: [internalCase('case-changed-after-cutoff', { updatedAt: '2026-08-04T03:00:00.000Z' })],
    meetings: [],
    scopeVesselIds: ['v1'],
    window,
    todayTaskIds: ['changed-after-cutoff'],
    todayInternalControlCaseIds: ['case-changed-after-cutoff'],
  });
  assert.deepEqual(frozen.todayTasks.map(item => item.id), ['changed-after-cutoff'], '凍結快照必須以保存時的今日 ID 維持分類，不能被後續 updatedAt 改寫');
  assert.deepEqual(frozen.todayInternalControlCases.map(item => item.id), ['case-changed-after-cutoff']);
} finally {
  await server.close();
}
console.log('Morning agenda task/internal-control classification contracts passed.');
