import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const summaryModule = await server.ssrLoadModule('/src/VesselImportantSummary.tsx');
  const VesselImportantSummary = summaryModule.default;
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const data = createInitialData();
  const vessel = structuredClone(data.vessels[0]);
  vessel.position.manualRemark = '';
  vessel.note.recentDynamics = '';
  const taskBase = data.tasks[0] || {};
  const priorities = [
    ['急', 'urgent'],
    ['高', 'high'],
    ['中', 'mid'],
    ['低', 'low'],
  ];
  const tasks = priorities.map(([priority], index) => ({
    ...taskBase,
    id: `dashboard-priority-${priority}`,
    vesselId: vessel.id,
    vesselIds: [vessel.id],
    description: `${priority}優先級測試內容`,
    priority,
    isAbnormal: index === 0,
    isInternalControl: false,
    isClosed: false,
    attentionDimension: 'task',
    sourceType: 'manual',
    sourceMeetingId: undefined,
    distributeToVessels: false,
  }));
  const markup = renderToStaticMarkup(
    React.createElement(VesselImportantSummary, {
      vessel,
      tasks,
      internalControlCases: [],
      meetings: [],
      canDiscloseMeetingSubjects: true,
      compact: false,
    }),
  );
  for (const [priority, tone] of priorities) {
    assert.ok(markup.includes(`class="badge ${tone}">${priority}</span>`), `船隊看板摘要的「${priority}」必須使用 badge ${tone} 語意色`);
  }
  assert.ok(markup.includes('class="inline-abnormal">異常</span>'), '船隊看板摘要的「異常」必須沿用紅色語意標籤');
} finally {
  await server.close();
}
console.log('PASS dashboard summary priority colors contract');
