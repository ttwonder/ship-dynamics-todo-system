import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const styles = fs.readFileSync('src/styles.css', 'utf8');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const summaryModule = await server.ssrLoadModule('/src/VesselImportantSummary.tsx');
  const VesselImportantSummary = summaryModule.default;
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const data = createInitialData();
  const vessel = structuredClone(data.vessels[0]);
  vessel.position.manualRemark = '人工備註測試內容';
  vessel.note.recentDynamics = '近期動態既有內容必須保留';
  const taskBase = data.tasks[0] || {};
  const task = {
    ...taskBase,
    id: 'summary-task-test',
    vesselId: vessel.id,
    description: '要事測試內容',
    priority: '中',
    isAbnormal: true,
    isInternalControl: false,
    isClosed: false,
    attentionDimension: 'task',
    sourceType: 'manual',
    sourceMeetingId: undefined,
    distributeToVessels: false,
  };
  const internalBase = data.internalControlCases[0] || {};
  const internalControl = {
    ...internalBase,
    id: 'summary-internal-test',
    vesselId: vessel.id,
    description: '內控測試內容',
    priority: '高',
    isClosed: false,
    linkedTaskId: 'linked-internal-task',
  };
  const meetingBase = data.meetings[0] || {};
  const meeting = {
    ...meetingBase,
    id: 'summary-meeting-test',
    subject: '臨會異常測試內容',
    vesselScopeMode: 'vessels',
    vessels: [vessel.id],
    isAbnormal: true,
    status: '追蹤中',
  };
  const compactMarkup = renderToStaticMarkup(
    React.createElement(VesselImportantSummary, {
      vessel,
      tasks: [task],
      internalControlCases: [internalControl],
      meetings: [meeting],
      canDiscloseMeetingSubjects: true,
      compact: true,
    }),
  );
  for (const text of ['人工備註', '人工備註測試內容', '船舶動態', '近期動態既有內容必須保留', '要事', '要事測試內容', '內控', '內控測試內容', '臨會／專題異常', '臨會異常測試內容']) {
    assert.ok(compactMarkup.includes(text), `早會摘要缺少：${text}`);
  }
  assert.equal((compactMarkup.match(/morning-summary-section/g) || []).length, 5, '三個要求來源與兩個既有來源必須各自形成一區');
  assert.ok(compactMarkup.includes('summary-source-manual') && compactMarkup.includes('summary-source-dynamics') && compactMarkup.includes('summary-source-task') && compactMarkup.includes('summary-source-internal') && compactMarkup.includes('summary-source-meeting'), '摘要來源缺少可辨識的分區樣式');
  assert.ok(compactMarkup.includes('inline-abnormal') && compactMarkup.includes('badge mid') && compactMarkup.includes('badge high'), '異常／中／高必須使用既有語意色 class');
  assert.equal((compactMarkup.match(/ship-summary-content/g) || []).length, 1, '早會摘要只能有一個內容捲動層');

  const dashboardMarkup = renderToStaticMarkup(
    React.createElement(VesselImportantSummary, {
      vessel,
      tasks: [task],
      internalControlCases: [internalControl],
      meetings: [meeting],
      canDiscloseMeetingSubjects: true,
      compact: false,
    }),
  );
  assert.ok(dashboardMarkup.includes('近期動態既有內容必須保留'), '船隊看板既有近期動態摘要不得被移除');

  assert.match(styles, /\.morning-summary-section\s*\+\s*\.morning-summary-section[^\n]*border-top:\s*1px\s+dashed/, '摘要信息源之間缺少虛線分隔');
  assert.match(styles, /\.ship-summary\.morning-vessel-summary[^\n]*height:\s*112px[^\n]*overflow:\s*clip/, '早會摘要外框必須保留 112px 與 overflow:clip');
  assert.match(styles, /\.morning-vessel-summary \.ship-summary-content[^\n]*overflow-y:\s*auto/, '只有內容層可以垂直捲動');
} finally {
  await server.close();
}
console.log('PASS morning summary source sections contract');
