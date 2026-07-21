import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const editModals = fs.readFileSync('src/EditModals.tsx', 'utf8');
assert.ok(editModals.includes("import { appearsInSingleVesselTasks } from './taskAttention'"), '快速更新彈窗必須匯入單船清單判斷 helper');
assert.ok(
  editModals.includes('const openTasks = data.tasks.filter(task => appearsInSingleVesselTasks(task) && taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task,vessel.id));'),
  '快速更新的「未結要事」必須排除未勾選「分派到涉及船舶單船跟蹤」的臨會/專題待辦',
);

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { appearsInSingleVesselTasks } = await server.ssrLoadModule('/src/taskAttention.ts');
  const { taskHasVessel } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const { taskIsClosedForVessel } = await server.ssrLoadModule('/src/taskVesselProgress.ts');
  const tasks = [
    { id: 'ordinary', vesselId: 'v1', vesselIds: ['v1'], sourceType: 'morning', attentionDimension: 'task', isClosed: false },
    { id: 'meeting-company', vesselId: 'v1', vesselIds: ['v1', 'v2'], sourceType: 'temporary', sourceMeetingId: 'm1', attentionDimension: 'meeting', distributeToVessels: false, isClosed: false },
    { id: 'meeting-delegated', vesselId: 'v1', vesselIds: ['v1', 'v2'], sourceType: 'temporary', sourceMeetingId: 'm2', attentionDimension: 'meeting', distributeToVessels: true, isClosed: false },
    { id: 'foreign', vesselId: 'v2', vesselIds: ['v2'], sourceType: 'morning', attentionDimension: 'task', isClosed: false },
  ];
  const visibleInQuickUpdate = tasks
    .filter(task => appearsInSingleVesselTasks(task) && taskHasVessel(task, 'v1') && !taskIsClosedForVessel(task, 'v1'))
    .map(task => task.id);
  assert.deepEqual(visibleInQuickUpdate, ['ordinary', 'meeting-delegated'], '單船快速更新只應顯示普通要事與已分派到單船跟蹤的會議待辦');
} finally {
  await server.close();
}

console.log('Vessel quick update task scope contracts passed.');
