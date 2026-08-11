import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const workflow = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  assert.equal(typeof workflow.meetingDecisionCompletionSummary, 'function', '臨會待辦需提供唯一關聯、完成與衝突的領域摘要');
  assert.equal(typeof workflow.planUnlinkedMeetingDecisionTransition, 'function', '編輯中保存後的未連結決議需由fresh snapshot規劃續接');

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
  assert.equal(workflow.meetingTaskItems({ ...meeting, taskItems: [{ ...meeting.taskItems[0], isClosed: false }] },[task({ id: 'task-divergent', itemId: 'item-open', isClosed: true })])[0].isClosed,false,'一般UI與PDF不得由Task反向投影覆蓋父item生命週期');
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

  const beforeSaveUnlinkedMeeting = {
    ...meeting,
    id: 'meeting-unlinked',
    vessels: [],
    updatedAt: '2026-08-06T00:00:00.000Z',
    taskItems: [{ id: 'item-unlinked', description: '無涉船待辦', categories: [], distributeToVessels: false }],
  };
  const afterSaveUnlinkedMeeting = {
    ...beforeSaveUnlinkedMeeting,
    updatedAt: '2026-08-06T00:01:00.000Z',
  };
  const unlinkedSectionKey = 'meeting:meeting-unlinked';
  const postSaveContinuation = workflow.planUnlinkedMeetingDecisionTransition({
    meetings: [afterSaveUnlinkedMeeting],
    tasks: [],
    meetingId: afterSaveUnlinkedMeeting.id,
    itemId: 'item-unlinked',
    transition: 'complete',
    sectionKey: unlinkedSectionKey,
    activeItemLeaseKey: unlinkedSectionKey,
    savedBeforeTransition: true,
  });
  assert.equal(postSaveContinuation.ok, true, '保存後應以fresh meeting續接未連結待辦完成');
  assert.equal(postSaveContinuation.expectedUpdatedAt, afterSaveUnlinkedMeeting.updatedAt, 'CAS不得沿用保存前updatedAt');
  assert.equal(postSaveContinuation.mustClaimLease, true, 'save已釋放鎖時，即使閉包仍看見舊key也必須重新claim');
  assert.notEqual(postSaveContinuation.expectedUpdatedAt, beforeSaveUnlinkedMeeting.updatedAt);
  const relationshipChangedAfterSave = workflow.planUnlinkedMeetingDecisionTransition({
    meetings: [afterSaveUnlinkedMeeting],
    tasks: [{ ...task({ id: 'newly-linked', itemId: 'item-unlinked', vesselIds: [] }), sourceMeetingId: afterSaveUnlinkedMeeting.id }],
    meetingId: afterSaveUnlinkedMeeting.id,
    itemId: 'item-unlinked',
    transition: 'complete',
    sectionKey: unlinkedSectionKey,
    activeItemLeaseKey: '',
    savedBeforeTransition: true,
  });
  assert.deepEqual(relationshipChangedAfterSave, { ok: false, reason: 'relationship-changed' }, '保存若建立或改變Task關聯，不得沿用保存前unlinked關係執行');

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
  assert.equal(normalizedHistoricalLinked.meetings[0].taskItems[0].isClosed, false, '歷史item缺欄位即使linked Task已完成仍需預設未完成');
  assert.equal(workflow.meetingDecisionCompletionSummary(normalizedHistoricalLinked.meetings[0],normalizedHistoricalLinked.tasks).items[0].state,'invalid','歷史缺欄位與已完成Task的差異需明示為關聯異常');
  const explicitOpenMeeting=structuredClone(linkedCompleted.meeting);
  explicitOpenMeeting.taskItems[0].isClosed=false;
  delete explicitOpenMeeting.taskItems[0].closedDate;
  delete explicitOpenMeeting.taskItems[0].closedBy;
  const normalizedExplicitMismatch=normalizeAppData({...createInitialData(),meetings:[explicitOpenMeeting],tasks:[linkedCompleted.task]});
  assert.equal(normalizedExplicitMismatch.meetings[0].taskItems[0].isClosed,false,'明確保存的未完成狀態不得被normalize靜默覆寫');
  assert.equal(workflow.meetingDecisionCompletionSummary(normalizedExplicitMismatch.meetings[0],normalizedExplicitMismatch.tasks).items[0].state,'invalid');
  const repairedLifecycle=workflow.transitionLinkedMeetingDecision(explicitOpenMeeting,linkedCompleted.task,'complete',{actorId:'owner-1',actorName:'Owner',at:'2026-08-06T05:00:00.000Z',closedDate:'2026-08-06'});
  assert.equal(repairedLifecycle.task.isClosed,true,'明確修復父item時不得重做或反轉已完成Task');
  assert.equal(repairedLifecycle.meeting.taskItems[0].isClosed,true,'明確授權修復需把父item同步為Task狀態');
  assert.equal(repairedLifecycle.repairedOnly,true);
  const closedTaskWithoutMetadata=structuredClone(linkedCompleted.task);
  delete closedTaskWithoutMetadata.closedDate;
  delete closedTaskWithoutMetadata.closedBy;
  const repairedWithoutInventedMetadata=workflow.transitionLinkedMeetingDecision(explicitOpenMeeting,closedTaskWithoutMetadata,'complete',{actorId:'owner-1',actorName:'Owner',at:'2026-08-06T05:02:00.000Z',closedDate:'2026-08-06'});
  const repairedWithoutMetadataSummary=workflow.meetingDecisionCompletionSummary(repairedWithoutInventedMetadata.meeting,[repairedWithoutInventedMetadata.task]);
  assert.equal(repairedWithoutInventedMetadata.task.closedDate,undefined,'修復不得捏造歷史Task完成日期');
  assert.equal(repairedWithoutInventedMetadata.meeting.taskItems[0].closedDate,undefined,'父item需精確鏡像Task現有metadata');
  assert.equal(repairedWithoutMetadataSummary.items[0].state,'closed','缺少歷史metadata但父子一致時修復後需解除invalid');
  assert.equal(repairedWithoutMetadataSummary.hasLinkConflict,false);
  assert.equal(repairedWithoutMetadataSummary.allCompleted,true,'修復成功後摘要後置條件必須成立');
  assert.equal(typeof workflow.meetingDecisionLifecycleIsConsistent,'function','父子durable mutation需共用明確後置條件');
  assert.equal(workflow.meetingDecisionLifecycleIsConsistent(repairedWithoutInventedMetadata.meeting,[repairedWithoutInventedMetadata.task],repairedWithoutInventedMetadata.task.id),true);
  assert.equal(workflow.meetingDecisionLifecycleIsConsistent(repairedWithoutInventedMetadata.meeting,[repairedWithoutInventedMetadata.task,{...repairedWithoutInventedMetadata.task,id:'duplicate-linked-task'}],repairedWithoutInventedMetadata.task.id),false,'同一父item有重複linked Tasks時不得通過後置條件');
  const repairedReopenLifecycle=workflow.transitionLinkedMeetingDecision(linkedCompleted.meeting,linkedReopened.task,'reopen',{actorId:'owner-1',actorName:'Owner',at:'2026-08-06T05:05:00.000Z',closedDate:'2026-08-06'});
  assert.equal(repairedReopenLifecycle.task.isClosed,false);
  assert.equal(repairedReopenLifecycle.meeting.taskItems[0].isClosed,false,'父item已完成但Task未完成時需明確同步為未完成');
  assert.equal(repairedReopenLifecycle.repairedOnly,true);

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
  const workflowSource = fs.readFileSync('src/meetingTaskWorkflow.ts', 'utf8');
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
  assert.ok(appTransition.includes('meetingDecisionLifecycleIsConsistent(targetMeeting,draft.tasks,taskId)'), 'durable snapshot寫入前需重驗父子生命週期後置條件');
  assert.ok(appTransition.includes('if(!initialCompletion)')&&appTransition.includes('if(!liveCompletion)'), '重複linked Tasks等無唯一completion的情況需在initial與fresh snapshot提前拒絕');
  assert.ok(appTransition.includes('requestedClosedDate?: string')&&appTransition.includes("trustedClosureDate(requestedClosedDate,'')"), 'linked會議待辦完成需接收並驗證使用者在日期視窗選定的完成日期');
  const linkedTransitionSource=workflowSource.slice(workflowSource.indexOf('export function transitionLinkedMeetingDecision'),workflowSource.indexOf('export const meetingTaskDescription'));
  assert.ok(linkedTransitionSource.includes('meetingDecisionLifecycleIsConsistent'), '純domain父子轉換本身也需fail closed驗證後置條件');
  const taskSaveSource=appSource.slice(appSource.indexOf('const saveTask = async'),appSource.indexOf('pendingTaskCreationProcessorRef.current='));
  assert.ok(!taskSaveSource.includes('會議來源待辦的完成或重新開啟請至臨會/專題頁操作'), '總待辦單項編輯保存不得再把會議來源待辦導回會議頁');
  assert.ok(taskSaveSource.includes('meetingLifecycleChanged')&&taskSaveSource.includes('synchronizeLinkedMeetingDecisionLifecycle(linkedMeeting,saved')&&taskSaveSource.includes('draft.meetings[meetingIndex]=syncedMeeting'), '總待辦單項編輯完成時需在同一保存交易同步父會議item');
  assert.ok(taskSaveSource.includes("canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)")&&taskSaveSource.includes("hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')"), '總待辦單項編輯完成會議待辦時需fresh重驗會議管理與結案權限');
  const batchCompleteSource=appSource.slice(appSource.indexOf('const batchCompleteTasks = async'),appSource.indexOf('const transitionMeetingTaskFromMeetingPage = async'));
  assert.ok(batchCompleteSource.includes('completeSelectedTasksWithMeetingSync'), '總待辦單項勾選或批量完成需共用父會議同步交易');
  assert.ok(!batchCompleteSource.includes('會議來源待辦請至臨會/專題頁逐筆完成'), '批量完成不得再拒絕有效的公司層會議來源待辦');
  assert.ok(appSource.includes('synchronizeLinkedMeetingDecisionLifecycle(liveMeeting,saved')&&appSource.includes('meetingLifecycleChanged&&(!liveMeeting||!canEditTemporaryMeetings'), '分船整體完成狀態翻轉需fresh重驗管理會議權限並同步父item');
  assert.ok(appSource.includes('onTransitionDecisionTask={transitionMeetingTaskFromMeetingPage}') && appSource.includes('canCloseTasks={canCloseTasks'), 'App需把權限與可信callback傳入會議頁');

  for (const label of ['完成此待辦', '完結此待辦', '重新開啟此待辦', '結案會議', '重新開啟會議', '待辦進度']) {
    assert.ok(meetingSource.includes(label), `會議頁缺少「${label}」入口或狀態`);
  }
  assert.ok(meetingSource.includes('meeting-inline-decision-transition')&&meetingSource.includes('editorWritable&&selected'), '取得編輯權後，每筆可整體完成的待辦需在編輯卡片標題列提供inline完結操作');
  assert.ok(meetingSource.includes('aria-label="待辦完成日期"')&&meetingSource.includes('type="date"')&&meetingSource.includes('確認完結'), '完成會議待辦時需顯示真實日期輸入視窗並由使用者確認');
  assert.ok(meetingSource.includes('requestDecisionCompletion')&&meetingSource.includes("kind:'linked'")&&meetingSource.includes("kind:'unlinked'"), 'inline與右側按鈕需共用日期視窗並涵蓋linked與unlinked待辦');
  assert.ok(meetingSource.includes('同步關聯狀態'),'父子生命週期分歧時UI需提供明確修復操作，不能靜默投影');
  assert.ok(meetingSource.includes('completion?.task?.id===task.id'),'只有唯一綁定目前Task的completion才可顯示生命週期操作');
  assert.ok(meetingSource.includes('meetingDecisionCompletionSummary'), '會議頁與保存邊界需共用領域完成摘要');
  assert.ok(meetingSource.includes('if(!editable||!canCloseTasks)'), '會議頁的決議待辦生命週期按鈕需同時要求管理會議與結案權限');
  const meetingTransitionSource=meetingSource.slice(meetingSource.indexOf('const transitionDecisionTask = async'),meetingSource.indexOf('const transitionUnlinkedDecisionItem = async'));
  assert.ok(meetingTransitionSource.includes('if(editorWritable){const saved=await save();if(!saved)return;}'), '取得會議編輯權後按完成需先保存目前草稿，再執行父子同步轉換');
  const unlinkedTransitionSource=meetingSource.slice(meetingSource.indexOf('const transitionUnlinkedDecisionItem = async'),meetingSource.indexOf('const transitionMeetingLifecycle = async'));
  assert.ok(unlinkedTransitionSource.includes('if(editorWritable){const saved=await save();if(!saved)return;savedBeforeTransition=true;}'), '未指定船舶的父會議待辦在編輯中需先保存草稿，並記錄lease已釋放');
  assert.ok(meetingSource.includes('const liveDataRef=useRef(data);')&&meetingSource.includes('liveDataRef.current=data;'), '保存後續接需讀取重新render後的fresh AppData');
  assert.ok(unlinkedTransitionSource.includes('savedBeforeTransition=true')&&unlinkedTransitionSource.includes('planUnlinkedMeetingDecisionTransition'), '未連結決議完成需明確標記save已釋放鎖並以fresh snapshot重規劃');
  assert.ok(unlinkedTransitionSource.includes('if(plan.mustClaimLease)')&&unlinkedTransitionSource.includes('claimItemLease'), '保存後即使閉包仍持有舊lease key也必須重新claim');
  assert.ok(unlinkedTransitionSource.includes("trustedClosureDate(requestedClosedDate,'')")&&unlinkedTransitionSource.includes('targetItem.closedDate=selectedClosedDate'), '未連結待辦需驗證並保存日期視窗選定的完成日期，不得固定寫今天');
  assert.ok(meetingSource.includes("&&editable&&canCloseTasks&&selected&&statusOf(selected)!=='已完成'&&<button"), 'linked會議待辦完成控制需在編輯中保持顯示');
  assert.ok(meetingSource.includes("&&canCloseTasks&&editable&&selected&&statusOf(selected)!=='已完成'&&<button"), '未指定船舶的父會議待辦完成控制需在編輯中保持顯示');
  assert.ok(!meetingSource.includes("&&editable&&canCloseTasks&&!editorWritable&&selected")&&!meetingSource.includes("&&canCloseTasks&&editable&&!editorWritable&&selected"), '取得會議編輯權後不得隱藏完成／重新開啟待辦控制');
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
