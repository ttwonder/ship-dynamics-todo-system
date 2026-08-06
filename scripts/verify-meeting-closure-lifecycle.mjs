import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const workflow = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  assert.equal(typeof workflow.meetingDecisionCompletionSummary, 'function', '臨會待辦需提供唯一關聯、完成與衝突的領域摘要');

  const meeting = {
    id: 'meeting-1',
    status: '追蹤中',
    vessels: ['v1'],
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    isInternalControl: false,
    taskItems: [
      { id: 'item-open', description: '尚未完成', categories: [], distributeToVessels: false },
      { id: 'item-closed', description: '已完成', categories: [], distributeToVessels: false, isClosed: true },
    ],
  };
  const task = ({ id, itemId, isClosed = false, vesselIds = ['v1'], vesselProgress = [], distributeToVessels = false }) => ({
    id,
    sourceType: 'temporary',
    attentionDimension: 'meeting',
    sourceMeetingId: meeting.id,
    sourceMeetingItemId: itemId,
    vesselId: vesselIds[0] || '',
    vesselIds,
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    distributeToVessels,
    isInternalControl: false,
    vesselProgress,
    isClosed,
  });

  const mixed = workflow.meetingDecisionCompletionSummary(meeting, [
    task({ id: 'task-open', itemId: 'item-open' }),
    task({ id: 'task-closed', itemId: 'item-closed', isClosed: true }),
  ]);
  assert.equal(mixed.totalCount, 2);
  assert.equal(mixed.completedCount, 1);
  assert.equal(mixed.allCompleted, false, '仍有未完成決議時不可結案會議');
  assert.deepEqual(mixed.items.map(item => item.state), ['open', 'closed']);

  const missing = workflow.meetingDecisionCompletionSummary(meeting, [
    task({ id: 'task-closed', itemId: 'item-closed', isClosed: true }),
  ]);
  assert.equal(missing.items[0].state, 'missing');
  assert.equal(missing.hasLinkConflict, true, '缺少關聯Task必須fail closed');
  assert.equal(missing.allCompleted, false);

  const duplicate = workflow.meetingDecisionCompletionSummary(meeting, [
    task({ id: 'task-a', itemId: 'item-open', isClosed: true }),
    task({ id: 'task-b', itemId: 'item-open', isClosed: true }),
    task({ id: 'task-closed', itemId: 'item-closed', isClosed: true }),
  ]);
  assert.equal(duplicate.items[0].state, 'duplicate');
  assert.equal(duplicate.allCompleted, false, '重複關聯不可因全部Task已完成而誤結案');

  const invalidSource = workflow.meetingDecisionCompletionSummary(
    { ...meeting, taskItems: [meeting.taskItems[0]] },
    [{ ...task({ id: 'task-invalid-source', itemId: 'item-open', isClosed: true }), sourceType: 'morning', attentionDimension: 'task' }],
  );
  assert.equal(invalidSource.items[0].state, 'invalid');
  assert.equal(invalidSource.hasLinkConflict, true, '偽造來源語意不得只靠相同IDs被視為有效關聯');
  assert.equal(invalidSource.allCompleted, false, '無效來源Task即使已完成也不得讓整場會議結案');
  const invalidScope = workflow.meetingDecisionCompletionSummary(
    { ...meeting, taskItems: [meeting.taskItems[0]] },
    [task({ id: 'task-invalid-scope', itemId: 'item-open', isClosed: true, vesselIds: ['v2'] })],
  );
  assert.equal(invalidScope.items[0].state, 'invalid');
  assert.equal(invalidScope.allCompleted, false, '父子涉船範圍不一致時必須fail closed');
  const divergentLifecycle = workflow.meetingDecisionCompletionSummary(
    { ...meeting, taskItems: [{ ...meeting.taskItems[0], isClosed: false }] },
    [task({ id: 'task-divergent', itemId: 'item-open', isClosed: true })],
  );
  assert.equal(divergentLifecycle.items[0].state, 'invalid');
  assert.equal(divergentLifecycle.allCompleted, false, '父item與有效Task完成狀態分歧時不得以Task投影掩蓋並誤結案');
  const validTypeScope = workflow.meetingDecisionCompletionSummary(
    { ...meeting, vesselScopeMode: 'types', vesselTypeScopes: ['Bulk'], taskItems: [{ ...meeting.taskItems[0], isClosed: true }] },
    [{ ...task({ id: 'task-valid-type', itemId: 'item-open', isClosed: true }), vesselScopeMode: 'types', vesselTypeScopes: ['Bulk'] }],
  );
  assert.equal(validTypeScope.items[0].state, 'closed', '父子type scope一致時不可誤報關聯異常');
  const validInternalControl = workflow.meetingDecisionCompletionSummary(
    { ...meeting, isInternalControl: true, taskItems: [{ ...meeting.taskItems[0], isClosed: true }] },
    [{ ...task({ id: 'task-valid-internal', itemId: 'item-open', isClosed: true }), isInternalControl: true }],
  );
  assert.equal(validInternalControl.items[0].state, 'closed', '父子內控狀態一致時不可誤報關聯異常');

  const distributedMeeting = {
    ...meeting,
    vessels: ['v1', 'v2'],
    taskItems: [{ id: 'item-open', description: '分船決議', categories: [], distributeToVessels: true }],
  };
  const partial = workflow.meetingDecisionCompletionSummary(distributedMeeting, [
    task({
      id: 'task-distributed',
      itemId: 'item-open',
      vesselIds: ['v1', 'v2'],
      distributeToVessels: true,
      vesselProgress: [
        { vesselId: 'v1', status: '', isClosed: true, closedDate: '2026-08-06', closedBy: 'u1', updatedAt: '2026-08-06T00:00:00.000Z', updatedBy: 'u1', statusLogs: [] },
        { vesselId: 'v2', status: '', isClosed: false, updatedAt: '2026-08-06T00:00:00.000Z', updatedBy: 'u1', statusLogs: [] },
      ],
    }),
  ]);
  assert.equal(partial.items[0].completedVesselCount, 1);
  assert.equal(partial.items[0].vesselCount, 2);
  assert.equal(partial.items[0].state, 'open');
  assert.equal(partial.allCompleted, false);

  const distributedClosed = workflow.meetingDecisionCompletionSummary({
    ...distributedMeeting,
    taskItems:[{...distributedMeeting.taskItems[0],isClosed:true,closedDate:'2026-08-06',closedBy:'u1'}],
  }, [
    task({
      id: 'task-distributed',
      itemId: 'item-open',
      vesselIds: ['v1', 'v2'],
      distributeToVessels: true,
      vesselProgress: [
        { vesselId: 'v1', status: '', isClosed: true, closedDate: '2026-08-06', closedBy: 'u1', updatedAt: '2026-08-06T00:00:00.000Z', updatedBy: 'u1', statusLogs: [] },
        { vesselId: 'v2', status: '', isClosed: true, closedDate: '2026-08-06', closedBy: 'u1', updatedAt: '2026-08-06T00:00:00.000Z', updatedBy: 'u1', statusLogs: [] },
      ],
    }),
  ]);
  assert.equal(distributedClosed.items[0].state, 'closed');
  assert.equal(distributedClosed.allCompleted, true);
  const distributedCompletedTask=task({
    id:'task-distributed-sync',itemId:'item-open',vesselIds:['v1','v2'],distributeToVessels:true,
    vesselProgress:[
      {vesselId:'v1',status:'',isClosed:true,closedDate:'2026-08-05',closedBy:'u1',updatedAt:'2026-08-05T00:00:00.000Z',updatedBy:'u1',statusLogs:[]},
      {vesselId:'v2',status:'',isClosed:true,closedDate:'2026-08-06',closedBy:'u2',updatedAt:'2026-08-06T00:00:00.000Z',updatedBy:'u2',statusLogs:[]},
    ],
  });
  const synchronizedDistributed=workflow.synchronizeLinkedMeetingDecisionLifecycle(distributedMeeting,distributedCompletedTask,{actorId:'u2',actorName:'User 2',at:'2026-08-06T00:00:00.000Z',closedDate:'2026-08-06'});
  assert.equal(synchronizedDistributed.taskItems[0].isClosed,true);
  assert.equal(synchronizedDistributed.taskItems[0].closedDate,'2026-08-06');
  assert.equal(synchronizedDistributed.taskItems[0].closedBy,'u2');
  assert.equal(synchronizedDistributed.status,'追蹤中','分船全部完成不得順帶結案整場會議');
  const distributedReopenedTask={...distributedCompletedTask,vesselProgress:distributedCompletedTask.vesselProgress.map(progress=>progress.vesselId==='v1'?{...progress,isClosed:false,closedDate:undefined,closedBy:undefined}:progress)};
  const synchronizedReopened=workflow.synchronizeLinkedMeetingDecisionLifecycle(synchronizedDistributed,distributedReopenedTask,{actorId:'u1',actorName:'User 1',at:'2026-08-06T01:00:00.000Z',closedDate:'2026-08-06'});
  assert.equal(synchronizedReopened.taskItems[0].isClosed,false);
  assert.equal('closedDate' in synchronizedReopened.taskItems[0],false);

  const orphan = workflow.meetingDecisionCompletionSummary(
    { ...meeting, taskItems: [] },
    [task({ id: 'orphan-task', itemId: 'removed-item', isClosed: true })],
  );
  assert.equal(orphan.totalCount, 0);
  assert.deepEqual(orphan.orphanTaskIds, ['orphan-task']);
  assert.equal(orphan.allCompleted, false, '孤立Task存在時不可把空會議誤判為可結案');

  const empty = workflow.meetingDecisionCompletionSummary({ ...meeting, taskItems: [] }, []);
  assert.equal(empty.allCompleted, true, '真正沒有決議待辦的會議可明確結案');

  const noVesselOpen = workflow.meetingDecisionCompletionSummary({ ...meeting, vessels: [], taskItems: [meeting.taskItems[0]] }, []);
  assert.equal(noVesselOpen.items[0].state, 'open', '未指定船舶時，會議item需有自己的fallback生命週期');
  assert.equal(noVesselOpen.hasLinkConflict, false, '未指定船舶本來就不建立Task，不應誤報關聯損壞');
  const noVesselClosed = workflow.meetingDecisionCompletionSummary({
    ...meeting,
    vessels: [],
    taskItems: [{ ...meeting.taskItems[0], isClosed: true, closedDate: '2026-08-06', closedBy: 'u1' }],
  }, []);
  assert.equal(noVesselClosed.items[0].state, 'closed');
  assert.equal(noVesselClosed.allCompleted, true);

  const scopedMissing = workflow.meetingDecisionCompletionSummary({ ...meeting, vessels: ['v1'], taskItems: [meeting.taskItems[0]] }, []);
  assert.equal(scopedMissing.items[0].state, 'missing', '有船舶範圍卻缺Task時仍須fail closed');
  assert.equal(scopedMissing.hasLinkConflict, true);

  const inheritClosed = [];
  workflow.reconcileMeetingTasks({
    tasks: inheritClosed,
    meetingId: meeting.id,
    vesselIds: ['v1'],
    followUps: [{ ...meeting.taskItems[0], isClosed: true, closedDate: '2026-08-06', closedBy: 'u1' }],
    priority: '中', expectedDate: '', departments: ['安全部'], ownerUserIds: ['u1'], initialStatus: '待執行',
    actorId: 'u1', actorName: '測試者', at: '2026-08-06T08:00:00.000Z', createTaskId: () => 'task-inherited-closed',
  });
  assert.equal(inheritClosed[0].isClosed, true, '新增船舶範圍後Task需繼承item完成狀態');
  assert.equal(inheritClosed[0].closedDate, '2026-08-06');

  const inheritDistributed = [];
  workflow.reconcileMeetingTasks({
    tasks: inheritDistributed,
    meetingId: 'meeting-distributed-inherit',
    vesselIds: ['v1', 'v2'],
    followUps: [{ id: 'item-1', description: '已完成的分船決議', categories: [], distributeToVessels: true, isClosed: true, closedDate: '2026-08-06', closedBy: 'u1' }],
    priority: '中', expectedDate: '', departments: ['安全部'], ownerUserIds: ['u1'], initialStatus: '待執行',
    actorId: 'u1', actorName: '測試者', at: '2026-08-06T08:00:00.000Z', createTaskId: () => 'task-inherited-distributed',
  });
  assert.equal(inheritDistributed[0].vesselProgress.length, 2);
  assert.ok(inheritDistributed[0].vesselProgress.every(progress => progress.isClosed), '分船Task的每艘進度都需繼承完成');

  assert.equal(typeof workflow.transitionMeetingDecisionTask, 'function', '臨會頁需用專用領域轉換完成或重新開啟唯一關聯Task');
  const transitionSource = {
    ...task({ id: 'task-transition', itemId: 'item-open' }),
    attentionDimension: 'meeting',
    status: '處理中',
    closedDate: undefined,
    closedBy: undefined,
    updatedAt: '2026-08-05T00:00:00.000Z',
    updatedBy: 'old-user',
    statusLogs: [],
  };
  const completed = workflow.transitionMeetingDecisionTask(transitionSource, 'complete', {
    actorId: 'owner-1',
    actorName: 'Owner',
    at: '2026-08-06T03:04:05.000Z',
    closedDate: '2026-08-06',
  });
  assert.equal(transitionSource.isClosed, false, '領域轉換不得原地修改舊snapshot');
  assert.equal(completed.isClosed, true);
  assert.equal(completed.closedDate, '2026-08-06');
  assert.equal(completed.closedBy, 'owner-1');
  assert.equal(completed.status, '由臨會/專題標記完成');
  assert.equal(completed.statusLogs[0].text, '由臨會/專題標記完成');
  assert.equal(completed.updatedAt, '2026-08-06T03:04:05.000Z');
  assert.equal(completed.updatedBy, 'owner-1');

  const reopened = workflow.transitionMeetingDecisionTask(completed, 'reopen', {
    actorId: 'owner-1',
    actorName: 'Owner',
    at: '2026-08-06T04:05:06.000Z',
    closedDate: '2026-08-06',
  });
  assert.equal(reopened.isClosed, false);
  assert.equal('closedDate' in reopened, false);
  assert.equal('closedBy' in reopened, false);
  assert.equal(reopened.status, '由臨會/專題重新開啟');
  assert.equal(reopened.statusLogs[0].text, '由臨會/專題重新開啟');

  assert.equal(typeof workflow.transitionLinkedMeetingDecision, 'function', '父會議item與來源Task需由同一純領域轉換原子產生');
  const linkedMeeting = {
    ...meeting,
    status: '追蹤中',
    taskItems: [{ ...meeting.taskItems[0], isClosed: false }],
    latestStatus: '原狀態',
    statusLogs: [],
    updatedAt: '2026-08-05T00:00:00.000Z',
  };
  const linkedCompleted = workflow.transitionLinkedMeetingDecision(
    linkedMeeting,
    transitionSource,
    'complete',
    { actorId: 'owner-1', actorName: 'Owner', at: '2026-08-06T03:04:05.000Z', closedDate: '2026-08-06' },
  );
  assert.equal(transitionSource.isClosed, false, '父子領域轉換不得修改舊Task snapshot');
  assert.equal(linkedMeeting.taskItems[0].isClosed, false, '父子領域轉換不得修改舊Meeting snapshot');
  assert.equal(linkedCompleted.task.isClosed, true);
  assert.equal(linkedCompleted.meeting.taskItems[0].isClosed, true);
  assert.equal(linkedCompleted.meeting.taskItems[0].closedDate, '2026-08-06');
  assert.equal(linkedCompleted.meeting.status, '追蹤中', '完成單項待辦不得自動結案整場會議');
  assert.equal(linkedCompleted.meeting.completedDate, undefined);
  const linkedReopened = workflow.transitionLinkedMeetingDecision(
    linkedCompleted.meeting,
    linkedCompleted.task,
    'reopen',
    { actorId: 'owner-1', actorName: 'Owner', at: '2026-08-06T04:05:06.000Z', closedDate: '2026-08-06' },
  );
  assert.equal(linkedReopened.task.isClosed, false);
  assert.equal(linkedReopened.meeting.taskItems[0].isClosed, false);
  assert.equal('closedDate' in linkedReopened.meeting.taskItems[0], false);
  assert.equal('closedBy' in linkedReopened.meeting.taskItems[0], false);
  assert.equal(linkedReopened.meeting.status, '追蹤中', '重新開啟單項待辦不得改變整場會議狀態');

  const normalizedClosed = normalizeAppData({ ...createInitialData(), meetings: [linkedCompleted.meeting] });
  assert.equal(normalizedClosed.meetings[0].taskItems[0].isClosed, true, 'normalization需保留決議item完成狀態');
  assert.equal(normalizedClosed.meetings[0].taskItems[0].closedDate, '2026-08-06', 'normalization需保留決議item完成日期');
  assert.equal(normalizedClosed.meetings[0].taskItems[0].closedBy, 'owner-1', 'normalization需保留決議item完成者');
  const historicalMeeting = structuredClone(linkedCompleted.meeting);
  delete historicalMeeting.taskItems[0].isClosed;
  delete historicalMeeting.taskItems[0].closedDate;
  delete historicalMeeting.taskItems[0].closedBy;
  const normalizedHistorical = normalizeAppData({ ...createInitialData(), meetings: [historicalMeeting] });
  assert.equal(normalizedHistorical.meetings[0].taskItems[0].isClosed, false, '歷史資料缺少結案欄位時需安全預設未完成');
  const normalizedHistoricalLinked = normalizeAppData({ ...createInitialData(), meetings: [historicalMeeting], tasks: [linkedCompleted.task] });
  assert.equal(normalizedHistoricalLinked.meetings[0].taskItems[0].isClosed, true, '歷史item缺欄位但有效linked Task已完成時需一次性回填');
  assert.equal(normalizedHistoricalLinked.meetings[0].taskItems[0].closedDate, '2026-08-06');
  assert.equal(normalizedHistoricalLinked.meetings[0].taskItems[0].closedBy, 'owner-1');
  const explicitOpenMeeting=structuredClone(linkedCompleted.meeting);
  explicitOpenMeeting.taskItems[0].isClosed=false;
  delete explicitOpenMeeting.taskItems[0].closedDate;
  delete explicitOpenMeeting.taskItems[0].closedBy;
  const normalizedExplicitMismatch=normalizeAppData({...createInitialData(),meetings:[explicitOpenMeeting],tasks:[linkedCompleted.task]});
  assert.equal(normalizedExplicitMismatch.meetings[0].taskItems[0].isClosed,false,'明確保存的未完成狀態不得被normalize靜默覆寫');
  assert.equal(workflow.meetingDecisionCompletionSummary(normalizedExplicitMismatch.meetings[0],normalizedExplicitMismatch.tasks).items[0].state,'invalid');

  assert.throws(
    () => workflow.transitionMeetingDecisionTask(
      { ...transitionSource, distributeToVessels: true, vesselIds: ['v1', 'v2'] },
      'complete',
      { actorId: 'owner-1', actorName: 'Owner', at: '2026-08-06T03:04:05.000Z', closedDate: '2026-08-06' },
    ),
    /分船待辦/,
    '分船待辦不得被粗粒度按鈕覆寫各船進度',
  );
  assert.throws(
    () => workflow.transitionMeetingDecisionTask(
      { ...transitionSource, sourceMeetingItemId: undefined },
      'complete',
      { actorId: 'owner-1', actorName: 'Owner', at: '2026-08-06T03:04:05.000Z', closedDate: '2026-08-06' },
    ),
    /會議來源關聯/,
    '缺少meeting item關聯不得進入快捷結案',
  );

  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  const meetingSource = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
  const normalizeSource = fs.readFileSync('src/normalize.ts', 'utf8');
  assert.match(appSource, /const transitionMeetingTaskFromMeetingPage = async/, 'App需提供會議來源Task的專用完成／重新開啟入口');
  const appTransition = appSource.slice(
    appSource.indexOf('const transitionMeetingTaskFromMeetingPage = async'),
    appSource.indexOf('const saveDailyMorningHistory=', appSource.indexOf('const transitionMeetingTaskFromMeetingPage = async')),
  );
  assert.ok(appTransition.includes('runTaskMutationWithLockBundle') && appTransition.includes('transitionLinkedMeetingDecision'), '單項完成必須沿用Task＋父會議關聯鎖bundle與父子領域轉換');
  assert.ok(appTransition.includes("hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')") && appTransition.includes('meetingTaskLinkIsValidForMutation'), '單項完成需在fresh snapshot重驗權限與會議關聯');
  assert.ok(appTransition.includes('canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)'), '單項完成需在fresh snapshot重驗管理會議權限');
  assert.ok(appTransition.includes('liveMeeting.updatedAt!==expectedMeetingUpdatedAt'), '單項完成需同時CAS父會議版本，不能只鎖Task後覆寫較新的會議item');
  assert.ok(appTransition.includes('draft.meetings[meetingIndex]=targetMeeting'), '單項完成需把父子領域轉換結果放入同一durable snapshot');
  assert.ok(appSource.includes('會議來源待辦的完成或重新開啟請至臨會/專題頁操作'), '一般Task保存不得繞過會議生命週期入口');
  assert.ok(appSource.includes('會議來源待辦請至臨會/專題頁逐筆完成，不得由批量完成繞過父會議'), '批量完成不得繞過父會議生命週期');
  assert.ok(appSource.includes('synchronizeLinkedMeetingDecisionLifecycle(liveMeeting,saved')&&appSource.includes('meetingLifecycleChanged&&(!liveMeeting||!canEditTemporaryMeetings'), '分船整體完成狀態翻轉需fresh重驗管理會議權限並同步父item');
  assert.ok(appSource.includes('onTransitionDecisionTask={transitionMeetingTaskFromMeetingPage}') && appSource.includes('canCloseTasks={canCloseTasks'), 'App需把權限與可信callback傳入會議頁');

  for (const label of ['完成此待辦', '重新開啟此待辦', '結案會議', '重新開啟會議', '待辦進度']) {
    assert.ok(meetingSource.includes(label), `會議頁缺少「${label}」入口或狀態`);
  }
  assert.ok(meetingSource.includes('meetingDecisionCompletionSummary'), '會議頁與保存邊界需共用領域完成摘要');
  assert.ok(meetingSource.includes('if(!editable||!canCloseTasks)'), '會議頁的決議待辦生命週期按鈕需同時要求管理會議與結案權限');
  assert.match(meetingSource, /effectiveDraft\.status==='已完成'&&![a-zA-Z]+\.allCompleted/, '保存邊界需阻止仍有未完成或關聯衝突的會議結案');
  assert.ok(meetingSource.includes('vesselScopeMode:draft.vesselScopeMode')&&meetingSource.includes('vesselTypeScopes:[...draft.vesselTypeScopes]')&&meetingSource.includes('isInternalControl:draft.isInternalControl'), 'draft結案preflight需帶完整父會議scope metadata');
  assert.ok(meetingSource.includes('vesselScopeMode:effectiveDraft.vesselScopeMode')&&meetingSource.includes('vesselTypeScopes:effectiveDraft.vesselTypeScopes')&&meetingSource.includes('isInternalControl:effectiveDraft.isInternalControl'), 'fresh保存端結案重驗需帶完整父會議scope metadata');
  assert.ok(meetingSource.includes("runDurableRelatedMutation(meetingEditLockKey(meeting.id),'臨會/專題結案'") && meetingSource.includes("runDurableRelatedMutation(meetingEditLockKey(meeting.id),'臨會/專題重新開啟'"), '整場結案與重新開啟必須走meeting relation locks及durable save');
  assert.ok(meetingSource.includes('決議待辦進度'), '會議PDF需輸出決議待辦完成進度');
  assert.ok(normalizeSource.includes('closedDate:isClosed?(normalizeDateText(taskItem.closedDate)||undefined):undefined'), 'normalize需保留未指定船舶item的完成日期');

  console.log('Meeting closure lifecycle contracts passed.');
} finally {
  await server.close();
}
