import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { default: Dashboard } = await server.ssrLoadModule('/src/Dashboard.tsx');

  const user = {
    id: 'owner-1', department: '航運處', name: 'Owner', username: 'owner', role: 'owner',
    passwordHash: '', isActive: true, managedVesselIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const vessel = {
    id: 'v-1', name: '測試輪', shortName: '測試輪', fullName: 'TEST VESSEL', shipType: '散裝船',
    fleetCategory: 'bulk fleet', fleetTags: ['bulk fleet'], assignedUserIds: [], delegateManagers: [], isActive: true,
    position: {
      source: 'manual', location: '高雄', speedKnots: 0, navigationStatus: '停泊', lastPort: '高雄', nextPort: '台中',
      eta: '', etb: '', etd: '', updatedAt: '2026-01-01T00:00:00.000Z', manualRemark: '',
    },
    cargo: { source: 'manual', loadStatus: '空載', name: '', quantity: '', items: [], updatedAt: '2026-01-01T00:00:00.000Z' },
    note: {
      statusList: [], statusSupplement: '', captain: '', chiefOfficer: '', chiefEngineer: '', firstEngineer: '',
      recentDynamics: '', subsequentDynamics: '', updatedAt: '2026-01-01T00:00:00.000Z',
    },
    weeklyAttention: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const task = (overrides = {}) => ({
    id: 'task-ordinary', vesselId: vessel.id, vesselIds: [vessel.id], priority: '高', attentionDimension: 'task',
    isAware: false, isAbnormal: false, isInternalControl: false, category: '一般', categories: ['一般'], description: '一般未結要事',
    status: '', expectedDate: '2999-01-01', reportDate: '2026-08-12', departments: [], ownerUserIds: [], isClosed: false,
    sourceType: 'morning', createdBy: user.id, updatedBy: user.id, createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z', statusLogs: [], ...overrides,
  });
  const tasks = [
    task(),
    task({
      id: 'task-company-meeting', priority: '急', attentionDimension: 'meeting', sourceType: 'temporary',
      sourceMeetingId: 'meeting-1', sourceMeetingItemId: 'item-1', distributeToVessels: false,
      description: '公司層臨會決議', expectedDate: '2000-01-01',
    }),
  ];

  const markup = renderToStaticMarkup(React.createElement(Dashboard, {
    user, users: [user], vessels: [vessel], tasks, internalControlCases: [], meetings: [], selected: [], setSelected: () => {},
    batchSelected: [], setBatchSelected: () => {}, onOpenVessel: () => {}, onEdit: () => {}, onAddTask: () => {},
    onToggleAttention: () => {}, onAdjustAttention: () => {}, onStartMeeting: () => {}, onOpenReport: () => {},
    onTaskMetric: () => {}, onOpenBatchManagedVessels: () => {}, canEdit: false, canCreateTasks: false,
    canUseMeetings: false, canUseReports: false,
  }));

  const metricCount = label => {
    const match = markup.match(new RegExp(`<small>${label}</small><b>(\\d+)</b>`));
    assert.ok(match, `找不到首頁 KPI「${label}」`);
    return Number(match[1]);
  };

  assert.equal(metricCount('未結要事'), 2, '未結要事 KPI 必須包含待辦總表會列出的公司層臨會／專題決議');
  assert.equal(metricCount('急／高關注'), 2, '急／高關注 KPI 必須使用與待辦總表相同的實際項目集合');
  assert.equal(metricCount('已逾期'), 1, '已逾期 KPI 必須使用與待辦總表相同的實際項目集合');

  console.log('Dashboard task KPI/list parity contracts passed.');
} finally {
  await server.close();
}
