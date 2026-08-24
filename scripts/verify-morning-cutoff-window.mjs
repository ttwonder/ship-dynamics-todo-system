import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const {
    upsertDailyMorningReport,
    liveMorningWindow,
    morningItemChangedInWindow,
    morningItemBusinessContentChanged,
    morningWindowIsAccumulatingNextMeeting,
  } = await server.ssrLoadModule('/src/morningHistory.ts');

  const previousCutoff = '2026-08-03T01:00:00.000Z';
  const previousReport = {
    id: 'daily-morning-2026-08-03',
    title: '前次早會',
    vesselIds: ['v1'],
    createdBy: 'owner',
    createdAt: previousCutoff,
    taskCount: 0,
    kind: 'daily-morning',
    businessDate: '2026-08-03',
    source: 'manual',
    snapshot: { capturedAt: previousCutoff, windowEndedAt: previousCutoff, vessels: [], tasks: [], internalControlCases: [], meetings: [] },
  };
  const vessel = {
    id: 'v1', name: 'V1', shortName: 'V1', fullName: 'V1', shipType: 'bulk', fleetCategory: 'bulk fleet', fleetTags: [], assignedUserIds: [], delegateManagers: [], isActive: true,
    position: { source: 'manual', location: '', speedKnots: 0, navigationStatus: '停泊', lastPort: '', nextPort: '', eta: '', etb: '', etd: '', updatedAt: previousCutoff, manualRemark: '' },
    cargo: { source: 'manual', loadStatus: '空載', name: '', quantity: '', items: [], updatedAt: previousCutoff },
    note: { statusList: [], statusSupplement: '', captain: '', chiefOfficer: '', chiefEngineer: '', firstEngineer: '', recentDynamics: '', subsequentDynamics: '', updatedAt: previousCutoff },
    weeklyAttention: [], createdAt: previousCutoff, updatedAt: previousCutoff,
  };
  const task = (id, extra = {}) => ({
    id, vesselId: 'v1', vesselIds: ['v1'], vesselScopeMode: 'vessels', vesselTypeScopes: [], priority: '中', attentionDimension: 'task',
    isAware: false, isAbnormal: false, isInternalControl: false, category: '其他', categories: ['其他'], description: id, status: '', expectedDate: '', reportDate: '2026-08-03', departments: [], ownerUserIds: [], isClosed: false, sourceType: 'morning', createdBy: 'owner', updatedBy: 'owner', createdAt: '2026-08-02T01:00:00.000Z', updatedAt: '2026-08-02T01:00:00.000Z', statusLogs: [], vesselProgress: [{ vesselId: 'v1', status: '', isClosed: false, statusLogs: [] }],
    ...extra,
  });
  const internalCase = (id, extra = {}) => ({
    id, vesselId: 'v1', reportDate: '2026-08-03', reportSource: '日常', description: id, priority: '中', category: '其他', isAware: false, status: '', departments: [], syncToTask: false, origin: 'internal-control', isClosed: false, createdBy: 'owner', updatedBy: 'owner', createdAt: '2026-08-02T01:00:00.000Z', updatedAt: '2026-08-02T01:00:00.000Z', statusLogs: [],
    ...extra,
  });

  previousReport.snapshot.tasks = [
    task('historical-open'),
    task('changed-open', { description: '切點前內容' }),
    task('technical-only'),
  ];
  previousReport.snapshot.internalControlCases = [
    internalCase('linked-case', { syncToTask: true, linkedTaskId: 'linked-internal-task', description: '切點前內控內容' }),
    internalCase('standalone-historical-open'),
    internalCase('standalone-technical'),
  ];

  const changedAt = '2026-08-03T06:00:00.000Z';
  const base = {
    agendaReports: [previousReport],
    vessels: [vessel],
    tasks: [
      task('historical-open'),
      task('changed-open', { description: '切點後實質修改', updatedAt: changedAt }),
      task('technical-only', { updatedAt: changedAt }),
      task('changed-closed', { isClosed: true, closedDate: '2026-08-03', updatedAt: changedAt }),
      task('historical-closed', { isClosed: true, closedDate: '2026-08-02' }),
      task('linked-internal-task', { isInternalControl: true, internalControlCaseId: 'linked-case', updatedAt: changedAt }),
    ],
    internalControlCases: [
      internalCase('linked-case', { syncToTask: true, linkedTaskId: 'linked-internal-task', description: '切點後內控實質修改', updatedAt: changedAt }),
      internalCase('standalone-technical', { updatedAt: changedAt }),
      internalCase('standalone-changed-closed', { isClosed: true, closedDate: '2026-08-03', updatedAt: changedAt }),
      internalCase('standalone-historical-open'),
      internalCase('standalone-historical-closed', { isClosed: true, closedDate: '2026-08-02' }),
    ],
    meetings: [],
  };

  const scheduledAt = '2026-08-04T01:00:00.000Z';
  const scheduled = upsertDailyMorningReport(base, { at: scheduledAt, actorUserId: 'owner', source: 'scheduled' });
  assert.equal(scheduled.status, 'saved');
  assert.equal(scheduled.report.snapshot.windowEndedAt, undefined, '排程快照不得冒充人工首次保存切點');

  const firstManualAt = '2026-08-04T01:30:00.000Z';
  const manual = upsertDailyMorningReport(scheduled.data, { at: firstManualAt, actorUserId: 'owner', source: 'manual' });
  assert.equal(manual.report.snapshot.windowStartedAt, previousCutoff, '本次早會區間必須承接上一次人工成功保存切點');
  assert.equal(manual.report.snapshot.windowEndedAt, firstManualAt, '當日第一次人工成功保存必須成為新切點');
  assert.deepEqual(manual.report.snapshot.tasks.map(item => item.id).sort(), ['changed-closed', 'changed-open', 'historical-open', 'technical-only'], '快照必須保留歷史未結，並納入區間內修改後結案的要事');
  assert.deepEqual(manual.report.snapshot.internalControlCases.map(item => item.id).sort(), ['linked-case', 'standalone-changed-closed', 'standalone-historical-open', 'standalone-technical'], '快照必須納入獨立及同步內控，並避免重複內控要事');
  assert.deepEqual(manual.report.snapshot.todayTaskIds.sort(), ['changed-closed', 'changed-open'], '純技術 updatedAt 變化不得進入本期要事');
  assert.deepEqual(manual.report.snapshot.todayInternalControlCaseIds.sort(), ['linked-case', 'standalone-changed-closed'], '純技術 updatedAt 變化不得進入本期內控');
  assert.equal(manual.report.taskCount, 8, '快照件數必須計算去重後的要事與內控');
  assert.equal(morningItemBusinessContentChanged(task('technical-only', { updatedAt: changedAt }), task('technical-only')), false, '只有技術時間戳不同不得算實質修改');
  assert.equal(morningItemBusinessContentChanged(task('changed-open', { description: '新內容', updatedAt: changedAt }), task('changed-open', { description: '舊內容' })), true, '業務內容不同必須算實質修改');

  const secondManualAt = '2026-08-04T02:15:00.000Z';
  const postCutoffTask = task('post-cutoff-new', { createdAt: '2026-08-04T02:00:00.000Z', updatedAt: '2026-08-04T02:00:00.000Z' });
  const secondInput = {
    ...manual.data,
    vessels: manual.data.vessels.map(item => ({ ...item, position: { ...item.position, location: '第二次保存更新的船位' } })),
    tasks: [...manual.data.tasks.map(item => item.id === 'changed-open' ? { ...item, description: '第一次切點後的修改，不得回灌今天', updatedAt: '2026-08-04T02:00:00.000Z' } : item), postCutoffTask],
    internalControlCases: manual.data.internalControlCases.map(item => item.id === 'linked-case' ? { ...item, description: '第一次切點後的內控修改，不得回灌今天', updatedAt: '2026-08-04T02:00:00.000Z' } : item),
  };
  const secondManual = upsertDailyMorningReport(secondInput, { at: secondManualAt, actorUserId: 'owner', source: 'manual' });
  assert.equal(secondManual.report.snapshot.windowEndedAt, firstManualAt, '同日後續保存不得移動首次成功保存切點');
  assert.equal(secondManual.report.updatedAt, secondManualAt, '同日後續保存仍須更新快照保存時間');
  assert.equal(secondManual.report.snapshot.capturedAt, secondManualAt, '同日後續保存須更新 snapshot capturedAt');
  assert.equal(secondManual.report.snapshot.vessels[0].position.location, '第二次保存更新的船位', '同日後續保存可刷新船舶動態快照');
  assert.deepEqual(secondManual.report.snapshot.tasks, manual.report.snapshot.tasks, '同日後續保存不得把第一次切點後的新建或修改要事回灌今天');
  assert.deepEqual(secondManual.report.snapshot.internalControlCases, manual.report.snapshot.internalControlCases, '同日後續保存不得把第一次切點後的內控修改回灌今天');
  assert.deepEqual(secondManual.report.snapshot.meetings, manual.report.snapshot.meetings, '同日後續保存不得改寫第一次切點的會議議題');
  assert.deepEqual(secondManual.report.snapshot.todayTaskIds, manual.report.snapshot.todayTaskIds, '同日後續保存須保留第一次切點的本期要事集合');
  assert.deepEqual(secondManual.report.snapshot.todayInternalControlCaseIds, manual.report.snapshot.todayInternalControlCaseIds, '同日後續保存須保留第一次切點的本期內控集合');

  const scheduledAfterManual = upsertDailyMorningReport(secondManual.data, { at: '2026-08-04T02:45:00.000Z', actorUserId: 'owner', source: 'scheduled' });
  assert.equal(scheduledAfterManual.report.source, 'manual', '同日人工報告不得被後到排程降級為排程報告');
  assert.equal(scheduledAfterManual.report.snapshot.windowEndedAt, firstManualAt, '後到排程不得清除或移動人工首次保存切點');
  assert.deepEqual(scheduledAfterManual.report.snapshot.todayTaskIds, manual.report.snapshot.todayTaskIds, '後到排程不得清除人工快照的本期要事集合');

  const live = liveMorningWindow(scheduledAfterManual.data.agendaReports, '2026-08-04T03:00:00.000Z');
  assert.equal(live.startedAt, firstManualAt, '下一場早會的即時區間必須從最近一次人工切點開始');
  assert.equal(live.endedAt, '2026-08-04T03:00:00.000Z');
  assert.equal(morningWindowIsAccumulatingNextMeeting(live), true, '同一台北日首次保存後的區間必須標示為下一場早會累積');
  const nextBusinessDayWindow = liveMorningWindow(secondManual.data.agendaReports, '2026-08-05T03:00:00.000Z');
  assert.equal(morningWindowIsAccumulatingNextMeeting(nextBusinessDayWindow), false, '跨入下一台北日後，該區間應重新標示為今日早會');
  assert.equal(morningItemChangedInWindow({ createdAt: previousCutoff, updatedAt: '2026-08-04T02:30:00.000Z' }, live), true, '區間內修改的既有項目必須進入今日早會');
  assert.equal(morningItemChangedInWindow({ createdAt: previousCutoff, updatedAt: previousCutoff }, live), false, '區間內未修改的舊項目必須留在歷史未結');
} finally {
  await server.close();
}

console.log('Morning cutoff window, changed-item and internal-control contracts passed.');
