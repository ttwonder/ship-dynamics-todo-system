import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const cases = [];
try {
  const { default: Dashboard } = await server.ssrLoadModule('/src/Dashboard.tsx');
  const user = { id:'u1', name:'督導', role:'admin', department:'船務', passwordHash:'', isActive:true, managedVesselIds:['v1'], createdAt:'', updatedAt:'' };
  const vessel = { id:'v1', name:'測試輪', shortName:'測試輪', fullName:'TEST', shipType:'散裝船', fleetCategory:'bulk fleet', fleetTags:[], assignedUserIds:['u1'], delegateManagers:[], isActive:true, manualAttentionLevel:'', position:{ source:'manual', location:'', speedKnots:0, navigationStatus:'航行', lastPort:'A', nextPort:'B', eta:'', etb:'', etd:'', updatedAt:'', manualRemark:'' }, cargo:{ source:'manual', loadStatus:'空載', name:'', quantity:'', items:[], updatedAt:'' }, note:{ statusList:[], statusSupplement:'', captain:'', chiefOfficer:'', chiefEngineer:'', firstEngineer:'', recentDynamics:'', subsequentDynamics:'', updatedAt:'' }, weeklyAttention:[], createdAt:'', updatedAt:'' };
  const noop = () => {};
  const props = { user, users: [user], vessels: [vessel], tasks: [], calendarTasks: [], internalControlCases: [], meetings: [], selected: [], setSelected: noop, batchSelected: [], setBatchSelected: noop, onOpenVessel: noop, onEdit: noop, onAddTask: noop, onToggleAttention: noop, onAdjustAttention: noop, onStartMeeting: noop, onOpenReport: noop, onTaskMetric: noop, onOpenBatchManagedVessels: noop, canEdit: true, canCreateTasks: true, canUseMeetings: true, canUseReports: true };
  const render = (status, overrides = {}) => renderToStaticMarkup(React.createElement(Dashboard, {
    ...props, ...overrides,
    itineraryOperationalFeed: { backend: null, records: { v1: status ? { vesselId: 'v1', status } : undefined }, refresh: async () => ({ capturedAt: '', records: {} }), publishConfirmed: noop },
  }));
  for (const canEdit of [true, false]) {
    const markup = render('ready', { canEdit });
    assert.equal(/<span[^>]*>Itinerary<\/span>/.test(markup), false, 'Ready ship card must not display the redundant Itinerary source badge');
    assert.match(markup, /查看 TEST 單船詳情/);
    assert.match(markup, /自動：低關注/);
    assert.match(markup, /切換顯示Itinerary信息/);
    assert.match(markup, /切換行事曆顯示/);
    assert.equal(/<select disabled="" class="priority-pill/.test(markup), !canEdit, 'Attention editing authority is unchanged');
    assert.equal(markup.includes('>快速更新</button>'), canEdit, 'Quick update authority is unchanged');
    cases.push(canEdit ? 'READY-EDITOR-NO-BADGE' : 'READY-READONLY-NO-BADGE');
  }
  for (const [status, label] of [[undefined, '行程同步中'], ['loading', '行程同步中'], ['missing', '船卡資料'], ['stale', '行程資料過期'], ['error', '行程讀取失敗']]) {
    assert.ok(render(status).includes('>' + label + '</span>'), 'Preserve existing non-ready feedback: ' + label);
    cases.push('PRESERVE-' + (status || 'UNINITIALIZED').toUpperCase());
  }
} finally { await server.close(); }
console.log(JSON.stringify({ status: 'PASS', cases, count: cases.length }));
