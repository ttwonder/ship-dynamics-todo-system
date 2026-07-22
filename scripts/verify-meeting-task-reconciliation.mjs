import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { canonicalMeetingTaskItems, reconcileMeetingTasks, meetingTaskClosedLinkConflict, meetingTaskDescription, meetingTaskInternalControlTransitionRequired, meetingTaskLinkIsValidForMutation, meetingTaskNotificationEvents, resolveMeetingTaskItemIdForDeletion, shouldPreserveMeetingTaskDescriptions } = await server.ssrLoadModule('/src/meetingTaskWorkflow.ts');
  const { buildTaskNotifications } = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const { canEditTemporaryMeetings, meetingAppliesToUser } = await server.ssrLoadModule('/src/meetingAccess.ts');
  const { departmentAfterRoleChange } = await server.ssrLoadModule('/src/personWorkflow.ts');
  const { scheduleDateValue, scheduleTimeValue, composeScheduleValue, formatScheduleDisplay } = await server.ssrLoadModule('/src/scheduleTime.ts');
  const { normalizeAppData } = await server.ssrLoadModule('/src/normalize.ts');
  const { taskShipTypeLabel, taskVesselLabel, taskReportShipTypeLabel, taskReportVesselLabel } = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const { usesPerVesselProgress, taskIsClosedForScope, updateTaskVesselProgress } = await server.ssrLoadModule('/src/taskVesselProgress.ts');
  assert.equal(resolveMeetingTaskItemIdForDeletion({sourceMeetingItemId:'stale-item-id',description:'Follow up'},{taskItems:[{id:'actual-item-id',description:'Follow up'}]}),'actual-item-id','單一描述唯一相符時可安全修復失效關聯 ID');
  assert.equal(resolveMeetingTaskItemIdForDeletion({sourceMeetingItemId:'stale-item-id',description:'原始事項'},{taskItems:[{id:'item-1',description:'A'},{id:'item-2',description:'B'}]}),null,'失效關聯 ID 沒有描述匹配時必須拒絕猜測');
  const collisionItems=canonicalMeetingTaskItems([{id:'x',description:'A'},{id:'x-duplicate-3',description:'B'},{id:'x',description:'C'}],'collision-meeting');
  assert.equal(new Set(collisionItems.map(item=>item.id)).size,collisionItems.length,'已帶 duplicate 後綴的 ID 與重複原 ID 仍必須產生全域唯一結果');
  assert.deepEqual(collisionItems.map(item=>item.id),['x','x-duplicate-3','x-duplicate-4'],'碰撞修復需避開全部已保留原始 ID');
  const task = (id, vesselId, meetingId, closed = false) => ({
    id,
    vesselId,
    sourceMeetingId: meetingId,
    sourceType: 'temporary',
    priority: '中',
    isAware: true,
    isAbnormal: false,
    isInternalControl: false,
    category: '臨會/專題',
    description: '舊待辦',
    status: closed ? '已完成' : '待執行',
    expectedDate: '2026-07-20',
    departments: ['航務部'],
    ownerUserIds: [],
    isClosed: closed,
    createdBy: 'owner',
    updatedBy: 'owner',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    statusLogs: [],
  });
  const tasks = [
    task('canonical', 'v1', 'm1'),
    task('duplicate', 'v1', 'm1', true),
    task('removed-scope', 'v2', 'm1'),
    task('unrelated', 'v3', 'm2'),
  ];
  tasks.filter(item=>item.sourceMeetingId==='m1').forEach(item=>{item.sourceMeetingItemId='m1-task-1';});
  const common = {
    tasks,
    meetingId: 'm1',
    priority: '高',
    expectedDate: '2026-07-31',
    departments: ['工務部'],
    initialStatus: '待執行',
    actorId: 'owner',
    actorName: 'Owner',
    at: '2026-07-18T03:00:00.000Z',
  };

  const collisionIds=['fixed-existing','task-a','task-a','task-b'];
  const collisionTasks=[task('fixed-existing','v1','other-meeting')];
  const collisionResult=reconcileMeetingTasks({...common,tasks:collisionTasks,meetingId:'collision-new',vesselIds:['v1'],followUps:[{id:'item-a',description:'A',categories:[]},{id:'item-b',description:'B',categories:[]}],createTaskId:()=>collisionIds.shift()||'exhausted'});
  assert.deepEqual(collisionResult.created.map(item=>item.id),['task-a','task-b'],'新待辦 ID 必須避開既有 ID 與同批次碰撞');
  assert.ok(collisionResult.created.every(item=>item.statusLogs[0].byUserId==='owner'),'系統建立會議待辦歷程必須保存不可變 actor ID');
  const collisionGuardTasks=[task('fixed-existing','v1','collision-guard')];
  Object.assign(collisionGuardTasks[0],{sourceMeetingItemId:'item-a',description:'舊描述'});
  const collisionGuardBefore=structuredClone(collisionGuardTasks);
  assert.throws(()=>reconcileMeetingTasks({...common,tasks:collisionGuardTasks,meetingId:'collision-guard',vesselIds:['v1'],followUps:[{id:'item-a',description:'新描述',categories:[]},{id:'item-b',description:'B',categories:[]}],createTaskId:()=> 'fixed-existing'}),/唯一 ID/,'無法配置唯一待辦 ID 時必須在任何既有待辦變更前整筆拒絕');
  assert.deepEqual(collisionGuardTasks,collisionGuardBefore,'ID 配置失敗不得留下部分 reconciliation 變更');
  const duplicateInput=[task('duplicate-id','v1','dup-a'),task('duplicate-id','v1','dup-b')];
  assert.throws(()=>reconcileMeetingTasks({...common,tasks:duplicateInput,meetingId:'dup-new',vesselIds:['v1'],followUps:[{id:'item-a',description:'A',categories:[]}]}),/重複待辦 ID/,'既有重複待辦 ID 必須 fail closed，不得由 Map 靜默折疊');

  const first = reconcileMeetingTasks({ ...common, vesselIds: ['v1'], followUp: '新待辦內容' });
  const activeLinked = tasks.filter(item => item.sourceMeetingId === 'm1');
  assert.equal(activeLinked.length, 1, '每個目前船舶只能保留一筆會議待辦');
  assert.equal(activeLinked[0].id, 'canonical');
  assert.equal(activeLinked[0].description, '新待辦內容');
  assert.equal(activeLinked[0].priority, '高');
  assert.equal(tasks.find(item => item.id === 'duplicate').isClosed, true, '舊重複項必須封存');
  assert.equal(tasks.find(item => item.id === 'duplicate').status, '已完成', '已結案的歷史狀態不得被對帳覆蓋');
  assert.equal(tasks.find(item => item.id === 'duplicate').sourceMeetingId, undefined, '舊重複項必須解除會議關聯');
  assert.equal(tasks.find(item => item.id === 'duplicate').statusLogs[0].byUserId,'owner','系統封存／解除關聯歷程必須保存不可變 actor ID');
  assert.equal(tasks.find(item => item.id === 'removed-scope').isClosed, true, '移出範圍的待辦必須封存');
  assert.equal(tasks.find(item => item.id === 'removed-scope').sourceMeetingId, undefined, '移出範圍的待辦必須解除會議關聯');
  assert.equal(tasks.find(item => item.id === 'unrelated').sourceMeetingId, 'm2', '不得修改其他會議待辦');
  assert.deepEqual(first.updatedIds, ['canonical']);
  const activeNoOpBefore=structuredClone(activeLinked[0]);
  const activeNoOp=reconcileMeetingTasks({...common,tasks,at:'2026-07-18T04:00:00.000Z',vesselIds:['v1'],followUp:'新待辦內容'});
  assert.deepEqual(activeNoOp.updatedIds,[],'active canonical 對帳內容完全未變時不得誤報更新');
  assert.deepEqual(activeLinked[0],activeNoOpBefore,'active canonical no-op 不得只改 updatedAt/updatedBy');
  assert.deepEqual(meetingTaskNotificationEvents(tasks,activeNoOp),[],'active canonical no-op 不得產生 task_updated 通知');

  const staleLinkedTask=task('stale-linked','v1','stale-meeting');
  staleLinkedTask.sourceMeetingItemId='removed-id';
  staleLinkedTask.description='唯一可修復描述';
  const staleResult=reconcileMeetingTasks({...common,tasks:[staleLinkedTask],meetingId:'stale-meeting',vesselIds:['v1'],followUps:[{id:'actual-id',description:'唯一可修復描述',categories:[],distributeToVessels:false}]});
  assert.equal(staleLinkedTask.id,'stale-linked','唯一描述可修復的失效事項 ID 不得 archive/create 重置身份與歷史');
  assert.equal(staleLinkedTask.sourceMeetingItemId,'actual-id','失效事項 ID 必須依唯一描述修復到現存父事項');
  assert.deepEqual(staleResult.created,[],'失效事項 ID 修復不得另建重複待辦');
  const ambiguousLinkedTask=task('ambiguous-linked','v1','ambiguous-meeting');
  ambiguousLinkedTask.sourceMeetingItemId='corrupt-id';
  ambiguousLinkedTask.description='無法唯一對應';
  const ambiguousBefore=structuredClone(ambiguousLinkedTask);
  assert.throws(()=>reconcileMeetingTasks({...common,tasks:[ambiguousLinkedTask],meetingId:'ambiguous-meeting',vesselIds:['v1'],followUps:[{id:'next-item',description:'其他事項',categories:[],distributeToVessels:false}],previousMeetingItems:[{id:'known-old-item',description:'已知舊事項',categories:[],distributeToVessels:false}]}),/父事項關聯損壞或不明確/,'無法唯一修復且不屬於舊父事項的 stale ID 必須 fail closed');
  assert.deepEqual(ambiguousLinkedTask,ambiguousBefore,'stale ID fail-closed 不得先 archive、改寫或重建待辦');
  const removedLinkedTask=task('removed-linked','v1','removed-meeting');
  removedLinkedTask.sourceMeetingItemId='removed-item';
  const removedResult=reconcileMeetingTasks({...common,tasks:[removedLinkedTask],meetingId:'removed-meeting',vesselIds:['v1'],followUps:[],previousMeetingItems:[{id:'removed-item',description:'舊待辦',categories:[],distributeToVessels:false}]});
  assert.deepEqual(removedResult.archivedIds,['removed-linked'],'使用者明確移除現存父事項時仍需正常封存關聯待辦');

  const replacedSameDescription=task('replaced-same-description','v1','replacement-meeting');
  replacedSameDescription.sourceMeetingItemId='removed-item';
  replacedSameDescription.description='相同描述但不同身份';
  const replacementResult=reconcileMeetingTasks({...common,tasks:[replacedSameDescription],meetingId:'replacement-meeting',vesselIds:['v1'],previousMeetingItems:[{id:'removed-item',description:'相同描述但不同身份',categories:[],distributeToVessels:false}],followUps:[{id:'new-item',description:'相同描述但不同身份',categories:[],distributeToVessels:false}]});
  assert.equal(replacedSameDescription.sourceMeetingId,undefined,'明確移除舊父事項後，即使新事項描述相同，也必須封存舊關聯而非偷換身份');
  assert.equal(replacementResult.created.length,1,'同描述的新父事項必須建立新的待辦身份');
  assert.equal(replacementResult.created[0].sourceMeetingItemId,'new-item');

  const closedReplacedSameDescription=task('closed-replaced-same-description','v1','closed-replacement-meeting',true);
  closedReplacedSameDescription.sourceMeetingItemId='closed-removed-item';
  closedReplacedSameDescription.description='已結案同描述';
  const closedReplacementResult=reconcileMeetingTasks({...common,tasks:[closedReplacedSameDescription],meetingId:'closed-replacement-meeting',vesselIds:['v1'],previousMeetingItems:[{id:'closed-removed-item',description:'已結案同描述',categories:[],distributeToVessels:false}],followUps:[{id:'closed-new-item',description:'已結案同描述',categories:[],distributeToVessels:false}]});
  assert.equal(closedReplacedSameDescription.sourceMeetingId,undefined,'已結案舊事項不得因新事項描述相同而被重新綁定');
  assert.equal(closedReplacedSameDescription.isClosed,true,'解除已結案舊關聯不得重開或改寫歷史');
  assert.equal(closedReplacementResult.created.length,1,'取代已結案事項的新項目必須另建未結案待辦');
  assert.equal(closedReplacementResult.created[0].sourceMeetingItemId,'closed-new-item');

  const mixedProgressTask=task('mixed-progress','v1','mixed-meeting');
  Object.assign(mixedProgressTask,{sourceMeetingItemId:'mixed-item',vesselIds:['v1','v2'],distributeToVessels:true,vesselProgress:[
    {vesselId:'v1',status:'完成',isClosed:true,closedDate:'2026-07-20',closedBy:'u1',statusLogs:[{id:'v1-log',at:'2026-07-20T00:00:00Z',by:'User',text:'v1 完成'}]},
    {vesselId:'v2',status:'處理中',isClosed:false,statusLogs:[{id:'v2-log',at:'2026-07-20T00:00:00Z',by:'User',text:'v2 進行'}]},
  ]});
  reconcileMeetingTasks({...common,tasks:[mixedProgressTask],meetingId:'mixed-meeting',vesselIds:['v2'],followUps:[{id:'mixed-item',description:'舊待辦',categories:[],distributeToVessels:true}]});
  assert.equal(mixedProgressTask.vesselId,'v2');
  assert.equal(mixedProgressTask.isClosed,false,'縮減到未完成船舶時頂層需反映保留範圍的進度');
  assert.deepEqual(mixedProgressTask.vesselProgress?.find(progress=>progress.vesselId==='v1')?.statusLogs?.map(log=>log.id),['v1-log'],'移出範圍的已完成單船進度與歷程必須保留為不可變歷史');
  reconcileMeetingTasks({...common,tasks:[mixedProgressTask],meetingId:'mixed-meeting',vesselIds:['v2','v3'],followUps:[{id:'mixed-item',description:'舊待辦',categories:[],distributeToVessels:true}]});
  assert.deepEqual(mixedProgressTask.vesselProgress?.find(progress=>progress.vesselId==='v1')?.statusLogs?.map(log=>log.id),['v1-log'],'後續重新擴大範圍時仍不得丟失已移出船舶的完成歷程');

  const closedLinkedTask=task('closed-linked','v1','closed-meeting',true);
  Object.assign(closedLinkedTask,{sourceMeetingItemId:'closed-item',sourceType:'temporary',attentionDimension:'meeting',vesselIds:['v1','v2'],vesselScopeMode:'vessels',vesselTypeScopes:[],distributeToVessels:false,isInternalControl:false});
  const closedInput={tasks:[closedLinkedTask],meetingId:'closed-meeting',nextVesselIds:['v1','v2'],nextItems:[{id:'closed-item',description:'舊待辦',categories:[],distributeToVessels:false}],nextVesselScopeMode:'vessels',nextVesselTypeScopes:[],nextIsInternalControl:false};
  assert.equal(meetingTaskClosedLinkConflict(closedInput),false,'父子設定不變時已結案關聯不得誤判衝突');
  assert.equal(meetingTaskClosedLinkConflict({...closedInput,nextVesselIds:['v1']}),true,'已結案關聯縮小範圍時需 fail closed 防止立即失效');
  assert.equal(meetingTaskClosedLinkConflict({...closedInput,nextIsInternalControl:true}),true,'已結案關聯切換內控時需 fail closed 防止父子不一致');
  assert.equal(meetingTaskClosedLinkConflict({...closedInput,nextItems:[{...closedInput.nextItems[0],distributeToVessels:true}]}),true,'已結案關聯切換分船模式時需 fail closed 防止父子不一致');
  reconcileMeetingTasks({...common,tasks:[closedLinkedTask],meetingId:'closed-meeting',vesselIds:['v1','v2','v3'],followUps:closedInput.nextItems});
  assert.equal(meetingTaskLinkIsValidForMutation(closedLinkedTask,[{id:'closed-meeting',vessels:['v1','v2','v3'],vesselScopeMode:'vessels',vesselTypeScopes:[],isInternalControl:false,taskItems:closedInput.nextItems}]),true,'允許的已結案範圍擴大完成後，所有父子權威欄位必須立即通過 mutation validator');

  const noVesselTasks = [task('no-vessel-existing', 'v1', 'no-vessel-meeting')];
  const noVesselResult = reconcileMeetingTasks({
    ...common,
    tasks: noVesselTasks,
    meetingId: 'no-vessel-meeting',
    vesselIds: [],
    followUps: [{ id: 'no-vessel-item', description: '未指定船舶仍可保存會議' }],
  });
  assert.deepEqual(noVesselResult.created, [], '未指定船舶範圍不得建立沒有船舶 ID 的待辦');
  assert.equal(noVesselTasks[0].sourceMeetingId, undefined, '會議改為未指定船舶時既有關聯待辦需解除關聯');
  assert.equal(noVesselTasks[0].isClosed, true, '會議改為未指定船舶時既有關聯待辦需封存');

  const customizedTasks = [task('custom-v1', 'v1', 'legacy-custom'), task('custom-v2', 'v2', 'legacy-custom')];
  customizedTasks[0].description = '船一客製待辦';
  customizedTasks[1].description = '船二客製待辦';
  assert.equal(
    shouldPreserveMeetingTaskDescriptions({ id: 'legacy-custom' }, customizedTasks, '船一客製待辦'),
    true,
    '旧会议待办栏未编辑时必须自动保留逐船客制内容',
  );
  assert.equal(
    shouldPreserveMeetingTaskDescriptions({ id: 'legacy-custom' }, customizedTasks, '用户明确的新统一内容'),
    false,
    '用户明确修改会议待办栏时必须允许统一同步',
  );
  reconcileMeetingTasks({
    ...common,
    tasks: customizedTasks,
    meetingId: 'legacy-custom',
    vesselIds: ['v1', 'v2'],
    followUp: '船一客製待辦',
    preserveExistingDescriptions: true,
  });
  const activeCustomizedTasks = customizedTasks.filter(item => item.sourceMeetingId === 'legacy-custom');
  assert.equal(activeCustomizedTasks.length, 1, '旧逐船待办必须聚合为一笔活动事项');
  assert.equal(activeCustomizedTasks[0].description, '船一客製待辦', '使用者未修改会议内容时应保留 canonical 客制描述');
  assert.deepEqual(activeCustomizedTasks[0].vesselIds, ['v1', 'v2']);
  assert.ok(activeCustomizedTasks[0].priority === '高' && activeCustomizedTasks[0].expectedDate === '2026-07-31', '保留描述时仍需同步其他会议栏位');
  assert.equal(customizedTasks.find(item => item.id === 'custom-v2').sourceMeetingId, undefined, '其余旧逐船记录必须解除关联并封存');

  const expandingTasks = [task('expand-v1', 'v1', 'expand-scope', true)];
  expandingTasks[0].sourceMeetingItemId='expand-scope-task';
  expandingTasks[0].status = 'A船已完成';
  expandingTasks[0].closedDate = '2026-07-17';
  expandingTasks[0].closedBy = 'Owner';
  expandingTasks[0].statusLogs = [{ id:'expand-log', at:'2026-07-17T00:00:00.000Z', by:'Owner', text:'A船已完成' }];
  reconcileMeetingTasks({
    ...common,
    tasks: expandingTasks,
    meetingId: 'expand-scope',
    vesselIds: ['v1','v2'],
    followUps: [{ id: 'expand-scope-task', description: '擴大範圍', distributeToVessels: true }],
  });
  const expanded = expandingTasks.find(item=>item.sourceMeetingId==='expand-scope');
  assert.equal(expanded.vesselProgress.find(item=>item.vesselId==='v1')?.isClosed,true,'單船擴為多船時原船結案狀態必須遷移到逐船進度');
  assert.equal(expanded.vesselProgress.find(item=>item.vesselId==='v1')?.status,'A船已完成','單船擴為多船時原船狀態不得遺失');
  assert.equal(expanded.vesselProgress.some(item=>item.vesselId==='v2'),false,'新增船舶不得錯誤繼承原船狀態');
  assert.equal(expanded.isClosed,false,'已結案單船安全擴為多船後，頂層狀態需反映新增船尚未完成，避免與分船語義矛盾');

  const closedCompanyTasks=[task('closed-company','v1','closed-company-meeting',true)];
  closedCompanyTasks[0].sourceMeetingItemId='closed-company-item';
  closedCompanyTasks[0].status='公司決議已完成';
  closedCompanyTasks[0].closedDate='2026-07-17';
  closedCompanyTasks[0].closedBy='Owner';
  closedCompanyTasks[0].statusLogs=[{id:'company-log',at:'2026-07-17T00:00:00.000Z',by:'Owner',text:'公司決議已完成'}];
  reconcileMeetingTasks({...common,tasks:closedCompanyTasks,meetingId:'closed-company-meeting',vesselIds:['v1','v2'],followUps:[{id:'closed-company-item',description:'公司層決議',distributeToVessels:false}]});
  assert.equal(closedCompanyTasks[0].isClosed,true,'未分派至單船的公司層已結案待辦擴大會議涉船範圍時仍須維持結案');
  assert.equal(closedCompanyTasks[0].status,'公司決議已完成','公司層待辦擴大會議涉船範圍不得清除既有完成狀態');
  assert.equal(closedCompanyTasks[0].closedDate,'2026-07-17','公司層待辦擴大範圍不得清除結案歷史');
  assert.deepEqual(closedCompanyTasks[0].vesselIds,['v1','v2'],'公司層待辦可安全同步新增涉會船舶範圍');

  expanded.vesselProgress.push({ vesselId:'v2', status:'B船執行中', isClosed:false, statusLogs:[{id:'v2-log',at:'2026-07-18T00:00:00.000Z',by:'Owner',text:'B船執行中'}] });
  reconcileMeetingTasks({
    ...common,
    tasks: expandingTasks,
    meetingId: 'expand-scope',
    vesselIds: ['v2'],
    followUps: [{ id: 'expand-scope-task', description: '縮小範圍', distributeToVessels: true }],
  });
  const shrunk = expandingTasks.find(item=>item.sourceMeetingId==='expand-scope');
  assert.equal(shrunk.status,'B船執行中','多船縮為單船時保留船舶狀態必須回填頂層');
  assert.equal(shrunk.isClosed,false,'多船縮為單船時保留船舶結案狀態必須回填頂層');
  assert.equal(shrunk.statusLogs[0]?.text,'B船執行中','多船縮為單船時歷程不得遺失');

  const noSnapshotTasks = [task('no-snapshot', 'v1', 'no-snapshot-meeting')];
  noSnapshotTasks[0].sourceMeetingItemId='no-snapshot-task';
  noSnapshotTasks[0].vesselIds = ['v1','v2'];
  noSnapshotTasks[0].status = '會議總體決議';
  noSnapshotTasks[0].statusLogs = [{ id:'overall-log', at:'2026-07-18T00:00:00.000Z', by:'Owner', text:'會議總體決議' }];
  noSnapshotTasks[0].vesselProgress = [];
  reconcileMeetingTasks({
    ...common,
    tasks: noSnapshotTasks,
    meetingId: 'no-snapshot-meeting',
    vesselIds: ['v1'],
    followUps: [{ id: 'no-snapshot-task', description: '縮小無逐船快照範圍', distributeToVessels: true }],
  });
  assert.equal(noSnapshotTasks[0].status,'會議總體決議','多船縮單船且無逐船快照時不得清空頂層決議');
  assert.equal(noSnapshotTasks[0].statusLogs[0]?.text,'會議總體決議','多船縮單船且無逐船快照時不得清空頂層歷程');

  const mergedLegacyTasks = [task('legacy-v1','v1','merge-progress',true),task('legacy-v2','v2','merge-progress',false)];
  mergedLegacyTasks.forEach(item=>{item.sourceMeetingItemId='migration-item';});
  mergedLegacyTasks[0].status='A船已完成';
  mergedLegacyTasks[1].status='B船執行中';
  reconcileMeetingTasks({
    ...common,
    tasks: mergedLegacyTasks,
    meetingId: 'merge-progress',
    vesselIds: ['v1','v2'],
    followUps: [{ id: 'migration-item', description: '舊逐船聚合', distributeToVessels: true }],
  });
  const mergedLegacy=mergedLegacyTasks.find(item=>item.sourceMeetingId==='merge-progress');
  assert.equal(mergedLegacy.vesselProgress.find(item=>item.vesselId==='v1')?.isClosed,true,'舊逐船聚合時各船結案狀態不得遺失');
  assert.equal(mergedLegacy.vesselProgress.find(item=>item.vesselId==='v2')?.status,'B船執行中','舊逐船聚合時各船狀態不得錯配');

  const eventTasks = [task('event-created', 'v1', 'events'), task('event-updated', 'v2', 'events'), task('event-archived', 'v3', 'events')];
  const events = meetingTaskNotificationEvents(eventTasks, {
    created: [eventTasks[0]],
    updatedIds: ['event-updated'],
    archivedIds: ['event-archived'],
  });
  assert.deepEqual(events.map(event => [event.task.id, event.kind]), [
    ['event-created', 'task_created'],
    ['event-updated', 'task_updated'],
    ['event-archived', 'task_archived'],
  ], '会议 reconcile 的新增、更新、取消必须全部产生通知事件');
  const archivedNotices = buildTaskNotifications(
    [{ id:'supervisor', role:'operator', department:'督導', managedVesselIds:['v3'], isActive:true }],
    { id:'v3', assignedUserIds:[] },
    'owner',
    eventTasks[2],
    'task_archived',
    'Owner',
  );
  assert.equal(archivedNotices.length, 1);
  assert.ok(archivedNotices[0].title.includes('取消待辦'), '自動封存需明确显示取消待辦通知');

  const internalControlTasks = [task('internal-control-task', 'v1', 'internal-control-meeting')];
  internalControlTasks[0].sourceMeetingItemId = 'internal-control-item';
  internalControlTasks[0].isInternalControl = true;
  internalControlTasks[0].isAbnormal = true;
  const internalControlInput = {
    ...common,
    tasks: internalControlTasks,
    meetingId: 'internal-control-meeting',
    vesselIds: ['v1'],
    followUps: [{ id:'internal-control-item', description:'內控待辦', categories:['船員管理'] }],
    isInternalControl: false,
  };
  assert.throws(
    () => reconcileMeetingTasks(internalControlInput),
    /無權取消內部管控/,
    '會議對帳不得在沒有明確授權上下文時取消既有待辦內部管控',
  );
  const authorizedInternalControlTasks = [task('authorized-internal-control-task', 'v1', 'authorized-internal-control-meeting')];
  authorizedInternalControlTasks[0].sourceMeetingItemId = 'internal-control-item';
  authorizedInternalControlTasks[0].isInternalControl = true;
  authorizedInternalControlTasks[0].isAbnormal = true;
  const cancelledResult = reconcileMeetingTasks({
    ...internalControlInput,
    tasks: authorizedInternalControlTasks,
    meetingId: 'authorized-internal-control-meeting',
    internalControlCancellation: { authorized:true, at:'2026-07-18T04:00:00.000Z', by:'supervisor' },
  });
  assert.deepEqual(cancelledResult.internalControlCancelledIds, ['authorized-internal-control-task']);
  assert.equal(authorizedInternalControlTasks[0].internalControlCancelledAt, '2026-07-18T04:00:00.000Z');
  assert.equal(authorizedInternalControlTasks[0].internalControlCancelledBy, 'supervisor');
  assert.equal(meetingTaskNotificationEvents(authorizedInternalControlTasks, cancelledResult)[0]?.kind, 'internal_control_cancelled', '會議取消內控需發送專用通知事件');

  const internalControlTransitionTask = (id, meetingId, vesselIds=['v1','v2']) => {
    const item = task(id, vesselIds[0], meetingId);
    item.sourceMeetingItemId = 'protected-item';
    item.vesselIds = vesselIds;
    item.isInternalControl = true;
    item.isAbnormal = true;
    return item;
  };
  const protectedBase = {
    ...common,
    vesselIds:['v1','v2'],
    followUps:[{id:'protected-item',description:'受保護內控待辦',categories:['船員管理']}],
    isInternalControl:true,
  };
  assert.throws(
    () => reconcileMeetingTasks({...protectedBase,tasks:[internalControlTransitionTask('no-vessel-internal','no-vessel-protected')],meetingId:'no-vessel-protected',vesselIds:[]}),
    /無權取消內部管控/,
    '清空涉船範圍而封存內控待辦時也必須先授權',
  );
  assert.throws(
    () => reconcileMeetingTasks({...protectedBase,tasks:[internalControlTransitionTask('removed-item-internal','removed-item-protected')],meetingId:'removed-item-protected',followUps:[]}),
    /無權取消內部管控/,
    '移除會議待辦項目而解除內控待辦關聯時也必須先授權',
  );
  const legacyInternalReplacement=internalControlTransitionTask('legacy-internal-replacement','legacy-internal-meeting');
  delete legacyInternalReplacement.sourceMeetingItemId;
  legacyInternalReplacement.description='舊版內控事項';
  assert.throws(
    ()=>reconcileMeetingTasks({...protectedBase,tasks:[legacyInternalReplacement],meetingId:'legacy-internal-meeting',followUps:[{id:'replacement-item',description:'替換後事項',categories:['船員管理']}]}),
    /無權取消內部管控/,
    '缺少 sourceMeetingItemId 的舊版內控事項不得被直接配到替換後第一項而繞過取消授權',
  );
  const legacyInternalSameDescription=internalControlTransitionTask('legacy-internal-same','legacy-same-meeting');
  delete legacyInternalSameDescription.sourceMeetingItemId;
  legacyInternalSameDescription.description='相同描述';
  reconcileMeetingTasks({...protectedBase,tasks:[legacyInternalSameDescription],meetingId:'legacy-same-meeting',followUps:[{id:'matched-item',description:'相同描述',categories:['船員管理']} ]});
  assert.equal(legacyInternalSameDescription.sourceMeetingItemId,'matched-item','描述唯一相符時可安全修復舊版關聯 ID');
  const protectedSameDescription=internalControlTransitionTask('protected-same-description','protected-same-description-meeting');
  protectedSameDescription.sourceMeetingItemId='old-protected-item';
  protectedSameDescription.description='內控同描述新身份';
  const protectedPreviousItems=[{id:'old-protected-item',description:'內控同描述新身份',categories:['船員管理']}];
  const protectedNextItems=[{id:'new-protected-item',description:'內控同描述新身份',categories:['船員管理']}];
  assert.equal(meetingTaskInternalControlTransitionRequired({tasks:[protectedSameDescription],meetingId:'protected-same-description-meeting',nextVesselIds:['v1','v2'],nextItemIds:['new-protected-item'],nextItems:protectedNextItems,previousItems:protectedPreviousItems,nextIsInternalControl:true}),true,'內控舊事項換成同描述新身份時，preflight 必須依上一版 ID 要求取消授權');
  assert.throws(()=>reconcileMeetingTasks({...protectedBase,tasks:[structuredClone(protectedSameDescription)],meetingId:'protected-same-description-meeting',followUps:protectedNextItems,previousMeetingItems:protectedPreviousItems}),/無權取消內部管控/,'未授權的內控同描述換身份必須原子拒絕');
  const authorizedSameDescriptionTasks=[structuredClone(protectedSameDescription)];
  const authorizedSameDescriptionResult=reconcileMeetingTasks({...protectedBase,tasks:authorizedSameDescriptionTasks,meetingId:'protected-same-description-meeting',followUps:protectedNextItems,previousMeetingItems:protectedPreviousItems,internalControlCancellation:{authorized:true,at:'2026-07-18T04:30:00.000Z',by:'supervisor'}});
  assert.equal(authorizedSameDescriptionTasks.find(task=>task.id==='protected-same-description')?.sourceMeetingId,undefined,'已授權時必須封存舊內控身份而非偷換父項 ID');
  assert.equal(authorizedSameDescriptionResult.created[0]?.sourceMeetingItemId,'new-protected-item','已授權時同描述新身份必須建立全新關聯待辦');
  assert.deepEqual(authorizedSameDescriptionResult.internalControlCancelledIds,['protected-same-description'],'已授權封存舊內控身份必須保留取消內控稽核事件');
  const unresolvedOrdinary=internalControlTransitionTask('legacy-ordinary-unresolved','legacy-ordinary-meeting');
  unresolvedOrdinary.isInternalControl=false;
  delete unresolvedOrdinary.sourceMeetingItemId;
  unresolvedOrdinary.description='普通舊事項';
  const unresolvedOrdinaryResult=reconcileMeetingTasks({...protectedBase,tasks:[unresolvedOrdinary],meetingId:'legacy-ordinary-meeting',isInternalControl:false,followUps:[{id:'ordinary-replacement',description:'普通替換事項',categories:['船員管理']} ]});
  assert.equal(unresolvedOrdinary.sourceMeetingId,undefined,'非內控舊版待辦缺少來源 ID 且描述不符時也不得盲配第一項');
  assert.equal(unresolvedOrdinaryResult.created[0]?.sourceMeetingItemId,'ordinary-replacement','無法解析的舊項需解除關聯並為替換項建立明確新關聯');
  const semanticallyClosedRemoval=task('semantic-closed-removal','v1','semantic-closed-meeting');
  semanticallyClosedRemoval.vesselIds=['v1','v2'];
  semanticallyClosedRemoval.distributeToVessels=true;
  semanticallyClosedRemoval.isClosed=false;
  semanticallyClosedRemoval.status='全部分船已完成';
  semanticallyClosedRemoval.vesselProgress=[{vesselId:'v1',status:'完成一',isClosed:true,statusLogs:[]},{vesselId:'v2',status:'完成二',isClosed:true,statusLogs:[]}];
  const semanticRemovalResult=reconcileMeetingTasks({...protectedBase,tasks:[semanticallyClosedRemoval],meetingId:'semantic-closed-meeting',isInternalControl:false,followUps:[]});
  assert.equal(semanticallyClosedRemoval.status,'全部分船已完成','分船語義已全部結案時解除關聯不得覆寫完成狀態');
  assert.equal(semanticallyClosedRemoval.sourceMeetingId,undefined,'分船語義已全部結案的移除項仍需解除關聯');
  assert.deepEqual(semanticRemovalResult.archivedIds,[],'語義已結案項不得誤報本次封存通知');
  assert.throws(
    () => reconcileMeetingTasks({...protectedBase,tasks:[internalControlTransitionTask('scope-shrink-internal','scope-shrink-protected')],meetingId:'scope-shrink-protected',vesselIds:['v2']}),
    /無權取消內部管控/,
    '縮小或替換內控涉船範圍必須按舊完整範圍授權',
  );
  const mixedProgressProtected=internalControlTransitionTask('mixed-progress-protected','mixed-progress-meeting');
  mixedProgressProtected.distributeToVessels=true;
  mixedProgressProtected.isClosed=true;
  mixedProgressProtected.vesselProgress=[{vesselId:'v1',status:'已完成',isClosed:true,statusLogs:[]},{vesselId:'v2',status:'執行中',isClosed:false,statusLogs:[]}];
  assert.throws(
    ()=>reconcileMeetingTasks({...protectedBase,tasks:[mixedProgressProtected],meetingId:'mixed-progress-meeting',vesselIds:['v2']}),
    /無權取消內部管控/,
    '分船進度仍有未結案船時，頂層 isClosed 不得繞過內控範圍授權',
  );
  const authorizedScopeTasks=[internalControlTransitionTask('authorized-scope-shrink','authorized-scope-protected')];
  const authorizedScopeResult=reconcileMeetingTasks({
    ...protectedBase,tasks:authorizedScopeTasks,meetingId:'authorized-scope-protected',vesselIds:['v2'],
    internalControlCancellation:{authorized:true,at:'2026-07-18T05:00:00.000Z',by:'supervisor'},
  });
  assert.deepEqual(authorizedScopeResult.internalControlCancelledIds,['authorized-scope-shrink']);
  assert.equal(authorizedScopeTasks[0].isInternalControl,true,'僅移除部分涉船時，剩餘船舶仍維持內部管控');
  assert.equal(authorizedScopeTasks[0].internalControlCancelledBy,'supervisor');
  assert.ok(authorizedScopeTasks[0].statusLogs.some(log=>log.text.includes('取消內部管控')),'部分縮減的取消紀錄需在船舶進度重整後仍保留');
  assert.equal(meetingTaskNotificationEvents(authorizedScopeTasks,authorizedScopeResult)[0]?.kind,'internal_control_cancelled');
  const authorizedArchiveTasks=[internalControlTransitionTask('authorized-archive','authorized-archive-protected')];
  const authorizedArchiveResult=reconcileMeetingTasks({
    ...protectedBase,tasks:authorizedArchiveTasks,meetingId:'authorized-archive-protected',vesselIds:[],
    internalControlCancellation:{authorized:true,at:'2026-07-18T06:00:00.000Z',by:'supervisor'},
  });
  assert.equal(authorizedArchiveTasks[0].isClosed,true);
  assert.equal(authorizedArchiveTasks[0].isInternalControl,false,'封存／解除關聯時需明確結束內部管控');
  assert.equal(authorizedArchiveTasks[0].internalControlCancelledAt,'2026-07-18T06:00:00.000Z');
  assert.equal(meetingTaskNotificationEvents(authorizedArchiveTasks,authorizedArchiveResult)[0]?.kind,'internal_control_cancelled');

  const retainedClosedInternalTasks=[internalControlTransitionTask('closed-internal-retained','internal-transition-meeting')];
  retainedClosedInternalTasks[0].isClosed=true;
  retainedClosedInternalTasks[0].status='已完成';
  const retainedClosedBefore=structuredClone(retainedClosedInternalTasks[0]);
  assert.throws(
    ()=>reconcileMeetingTasks({tasks:retainedClosedInternalTasks,meetingId:'internal-transition-meeting',vesselIds:['v1'],followUps:[{id:'protected-item',description:'仍保留的已結案項',categories:['船員管理']}],priority:'中',isAbnormal:false,isInternalControl:false,expectedDate:'',departments:['管理層'],ownerUserIds:['owner'],initialStatus:'',actorId:'actor',actorName:'Actor',at:'2026-07-22T00:00:00.000Z'}),
    /已結案會議待辦與新的父會議範圍、內部管控或分船設定衝突/,
    '已結案 canonical 待辦若無法與父會議新狀態同步，必須在對帳前 fail closed',
  );
  assert.equal(retainedClosedInternalTasks.find(task=>task.id==='closed-internal-retained')?.isInternalControl,true,'已結案內控歷史不得被會議重存改寫');
  assert.deepEqual(retainedClosedInternalTasks.find(task=>task.id==='closed-internal-retained')?.vesselIds,['v1','v2'],'已結案內控歷史涉船範圍不得被會議重存縮減');
  assert.equal(retainedClosedInternalTasks.find(task=>task.id==='closed-internal-retained')?.description,'舊待辦','已結案內控歷史描述不得被會議重存改寫');
  assert.deepEqual(retainedClosedInternalTasks[0],retainedClosedBefore,'fail-closed 對帳不得先改寫任何已結案歷史');
  const fullyClosedDistributed=internalControlTransitionTask('fully-closed-distributed','fully-closed-meeting');
  fullyClosedDistributed.distributeToVessels=true;
  fullyClosedDistributed.isClosed=false;
  fullyClosedDistributed.vesselProgress=[{vesselId:'v1',status:'完成',isClosed:true,statusLogs:[]},{vesselId:'v2',status:'完成',isClosed:true,statusLogs:[]}];
  assert.throws(
    ()=>reconcileMeetingTasks({...protectedBase,tasks:[fullyClosedDistributed],meetingId:'fully-closed-meeting',vesselIds:['v1'],followUps:[{id:'protected-item',description:'嘗試改寫',categories:['船員管理']}]}),
    /已結案會議待辦與新的父會議範圍、內部管控或分船設定衝突/,
    '分船進度 canonical 全部完成時也不得讓父會議縮小範圍後留下失效關聯',
  );
  assert.deepEqual(fullyClosedDistributed.vesselIds,['v1','v2'],'分船進度全部完成時，即使頂層 isClosed=false 也需保留完整歷史範圍');

  const alreadyClosedDuplicateTasks = [task('active-canonical', 'v1', 'closed-duplicate'), task('already-closed', 'v1', 'closed-duplicate')];
  alreadyClosedDuplicateTasks.forEach(item=>{item.sourceMeetingItemId='closed-duplicate-task-1';});
  alreadyClosedDuplicateTasks[1].isClosed = true;
  alreadyClosedDuplicateTasks[1].status = '已完成';
  const closedDuplicateResult = reconcileMeetingTasks({
    ...common,
    tasks: alreadyClosedDuplicateTasks,
    meetingId: 'closed-duplicate',
    vesselIds: ['v1'],
    followUp: '跟進事項',
  });
  assert.equal(alreadyClosedDuplicateTasks[1].sourceMeetingId, undefined, '已結案重複項仍需解除会议关联');
  assert.equal(alreadyClosedDuplicateTasks[1].status, '已完成', '解除已結案重複項关联不得改写结案状态');
  assert.equal(closedDuplicateResult.archivedIds.includes('already-closed'), false, '原本已結案項目不得被列为本次取消');
  assert.equal(
    meetingTaskNotificationEvents(alreadyClosedDuplicateTasks, closedDuplicateResult).some(event => event.task.id === 'already-closed'),
    false,
    '原本已結案項目单纯解除关联时不得发送取消通知',
  );
  const allClosedDuplicates=[task('closed-duplicate-a','v1','all-closed-duplicates',true),task('closed-duplicate-b','v1','all-closed-duplicates',true)];
  allClosedDuplicates.forEach((item,index)=>{item.sourceMeetingItemId='all-closed-duplicates-task-1';item.status=`已完成 ${index+1}`;});
  const allClosedDuplicateResult=reconcileMeetingTasks({...common,tasks:allClosedDuplicates,meetingId:'all-closed-duplicates',vesselIds:['v1'],followUp:'跟進事項'});
  assert.equal(allClosedDuplicates.filter(item=>item.sourceMeetingId==='all-closed-duplicates').length,1,'全部已結案的重複群組仍只能保留一筆 canonical 關聯');
  assert.equal(allClosedDuplicates.filter(item=>!item.sourceMeetingId).length,1,'非 canonical 已結案重複項需解除會議關聯');
  assert.ok(allClosedDuplicates.every(item=>item.isClosed),'解除重複關聯不得重開或改寫已結案歷史');
  assert.deepEqual(allClosedDuplicateResult.archivedIds,[],'已結案重複項只解除關聯，不應誤報本次取消通知');

  reconcileMeetingTasks({ ...common, vesselIds: ['v1'], followUp: '' });
  assert.equal(tasks.filter(item => item.sourceMeetingId === 'm1').length, 0, '清空待辦欄後不得保留活動關聯待辦');
  assert.equal(tasks.find(item => item.id === 'canonical').isClosed, true, '清空待辦欄需封存舊待辦');

  const restored = reconcileMeetingTasks({ ...common, vesselIds: ['v1'], followUp: '重新建立' });
  assert.equal(restored.created.length, 1, '重新填寫待辦時需建立一筆新關聯待辦');
  assert.equal(tasks.filter(item => item.sourceMeetingId === 'm1' && item.vesselId === 'v1').length, 1);

  const multiTasks = [];
  const multiResult = reconcileMeetingTasks({
    ...common,
    tasks: multiTasks,
    meetingId: 'multi',
    vesselIds: ['v1', 'v2'],
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    followUps: [{ id: 'item-1', description: '待辦一' }, { id: 'item-2', description: '待辦二' }],
  });
  assert.equal(multiResult.created.length, 2, '兩個待辦事項套用兩艘船時只能建立兩筆關聯待辦');
  assert.equal(multiTasks.filter(item => item.sourceMeetingItemId === 'item-1').length, 1);
  assert.equal(multiTasks.filter(item => item.sourceMeetingItemId === 'item-2').length, 1);
  assert.deepEqual(multiTasks.find(item => item.sourceMeetingItemId === 'item-1').vesselIds, ['v1', 'v2'], '每筆會議待辦應保存合併船舶範圍');
  assert.equal(multiTasks.find(item => item.sourceMeetingItemId === 'item-1').distributeToVessels, false, '未勾選分派時，臨會待辦必須維持公司層決議，不得自動成為單船分派');
  assert.equal(usesPerVesselProgress(multiTasks.find(item => item.sourceMeetingItemId === 'item-1')), false, '未勾選分派時不得啟用逐船進度');
  const distributedTasks = [];
  reconcileMeetingTasks({
    ...common,
    tasks: distributedTasks,
    meetingId: 'distributed',
    vesselIds: ['v1', 'v2'],
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    followUps: [{ id: 'distributed-item', description: '分派到各船逐船跟蹤', distributeToVessels: true }],
  });
  let distributed = distributedTasks.find(item => item.sourceMeetingItemId === 'distributed-item');
  assert.equal(distributed.distributeToVessels, true, '勾選分派時，臨會待辦必須保存單船分派旗標');
  assert.equal(usesPerVesselProgress(distributed), true, '勾選分派且涉及多船時必須啟用逐船進度');
  assert.equal(taskIsClosedForScope(distributed, ['v1', 'v2']), false, '分派待辦初始不得因公司層狀態而整項完成');
  distributed = updateTaskVesselProgress(distributed, 'v1', current => ({ ...current, status: 'A船完成', isClosed: true, closedDate: '2026-07-20', closedBy: 'owner', statusLogs: current.statusLogs }), { at: '2026-07-20T01:00:00.000Z', actorId: 'owner' });
  assert.equal(taskIsClosedForScope(distributed, ['v1', 'v2']), false, '只完成部分船舶時，分派待辦整項不得完成');
  distributed = updateTaskVesselProgress(distributed, 'v2', current => ({ ...current, status: 'B船完成', isClosed: true, closedDate: '2026-07-20', closedBy: 'owner', statusLogs: current.statusLogs }), { at: '2026-07-20T02:00:00.000Z', actorId: 'owner' });
  assert.equal(taskIsClosedForScope(distributed, ['v1', 'v2']), true, '全部涉及船舶完成後，分派待辦才可視為完成');
  const scopeVessels = [{ id:'v1', name:'S1', shortName:'S1', fullName:'第一船', shipType:'油輪' }, { id:'v2', name:'S2', shortName:'S2', fullName:'第二船', shipType:'散裝船' }];
  const allScopeTask = { ...multiTasks[0], vesselScopeMode:'all' };
  assert.equal(taskVesselLabel(allScopeTask, scopeVessels), '全部船舶');
  assert.equal(taskShipTypeLabel(allScopeTask, scopeVessels), '全部');
  assert.equal(taskVesselLabel(multiTasks[0], scopeVessels), '第一船、第二船');
  assert.equal(taskShipTypeLabel({ ...multiTasks[0], vesselScopeMode:'types', vesselTypeScopes:['油輪','散裝船'] }, scopeVessels), '油輪、散裝船');
  assert.equal(taskReportVesselLabel(multiTasks[0], [scopeVessels[0]]), '第一船', '單船報告投影不得把未選船舶標成受限船舶');
  assert.equal(taskReportShipTypeLabel(multiTasks[0], [scopeVessels[0]]), '油輪', '單船報告船種只顯示本次報告船舶');
  assert.ok(!taskReportVesselLabel(multiTasks[0], [scopeVessels[0]]).includes('受限'), '報告選擇範圍不是權限範圍，不得出現受限船舶文案');
  const removedItemResult = reconcileMeetingTasks({
    ...common,
    tasks: multiTasks,
    meetingId: 'multi',
    vesselIds: ['v1', 'v2'],
    vesselScopeMode: 'vessels',
    vesselTypeScopes: [],
    followUps: [{ id: 'item-2', description: '待辦二更新' }],
  });
  assert.equal(multiTasks.filter(item => item.sourceMeetingId === 'multi' && item.sourceMeetingItemId === 'item-1').length, 0, '刪除待辦事項格時需解除該事項的單筆船舶範圍關聯');
  assert.equal(multiTasks.filter(item => item.sourceMeetingId === 'multi' && item.sourceMeetingItemId === 'item-2').length, 1, '其他待辦事項不得受刪除影響');
  assert.equal(removedItemResult.archivedIds.length, 1, '刪除一個跨多船事項只應產生一筆取消事件');

  const legacyV1 = task('legacy-v1', 'v1', 'migration-meeting');
  const legacyV2 = task('legacy-v2', 'v2', 'migration-meeting');
  legacyV1.sourceMeetingItemId = 'migration-item';
  legacyV2.sourceMeetingItemId = 'migration-item';
  legacyV1.ownerUserIds = ['u1'];
  legacyV2.ownerUserIds = ['u2'];
  legacyV1.statusLogs = [{ id:'log-1', at:'2026-07-17T01:00:00.000Z', by:'u1', text:'船一更新' }];
  legacyV2.statusLogs = [{ id:'log-2', at:'2026-07-18T01:00:00.000Z', by:'u2', text:'船二更新' }];
  legacyV2.updatedAt = '2026-07-18T01:00:00.000Z';
  const migrated = normalizeAppData({
    revision: 12,
    updatedAt: '2026-07-18T02:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:['航務部'], taskCategories:['臨會/專題'], taskCategorySchemaVersion:2, rolePermissions:{}, nonOwnerPasswordResetVersion:1 },
    users: [],
    vessels: [{ id:'v1', name:'船一', isActive:true }, { id:'v2', name:'船二', isActive:true }],
    tasks: [legacyV1, legacyV2],
    meetings: [{ id:'migration-meeting', subject:'迁移会议', vesselScopeMode:'all', vessels:['v1','v2'], vesselTypeScopes:[], taskItems:[{ id:'migration-item', description:'旧事项' }] }],
    agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.ok(migrated, '旧资料应可安全正規化');
  assert.equal(migrated.tasks.length, 2, '普通 normalize 不得删除旧逐船历史记录');
  assert.equal(migrated.settings.meetingTaskAggregationVersion, 0, '普通读取不得自动标记破坏性迁移完成');
  const explicitMigration = reconcileMeetingTasks({
    tasks: migrated.tasks, meetingId:'migration-meeting', vesselIds:['v1','v2'], vesselScopeMode:'all', vesselTypeScopes:[],
    followUps:[{ id:'migration-item', description:'旧事项' }], priority:'中', expectedDate:'2026-07-31', departments:['航務部'], ownerUserIds:['u1','u2'],
    initialStatus:'待执行', actorId:'admin', actorName:'管理员', at:'2026-07-19T00:00:00.000Z',
  });
  assert.equal(migrated.tasks.filter(item=>item.sourceMeetingId==='migration-meeting').length, 1, '显式 reconciliation 后只保留一笔关联事项');
  assert.equal(explicitMigration.archivedIds.length, 1, '重复旧记录必须封存而非删除');
  assert.equal(migrated.tasks.length, 2, '封存后总记录数不得减少');
  assert.ok(migrated.tasks.find(item=>explicitMigration.archivedIds.includes(item.id))?.isClosed, '重复记录必须可恢复地保留为已结案历史');
  const migratedNormalized = normalizeAppData(structuredClone(migrated));
  const migratedAgain = normalizeAppData(structuredClone(migratedNormalized));
  assert.deepEqual(migratedAgain.tasks, migratedNormalized.tasks, '普通资料正規化必须幂等且不得再次聚合');
  const collisionRaw=structuredClone(migratedNormalized);
  collisionRaw.meetings=[{...collisionRaw.meetings[0],id:'collision-meeting',taskItems:[{id:'x',description:'A'},{id:'x-duplicate-3',description:'B'},{id:'x',description:'C'}]}];
  collisionRaw.tasks=[
    {...migratedNormalized.tasks[0],id:'collision-task-a',sourceMeetingId:'collision-meeting',sourceMeetingItemId:'x',description:'A'},
    {...migratedNormalized.tasks[0],id:'collision-task-b',sourceMeetingId:'collision-meeting',sourceMeetingItemId:'x',description:'B'},
  ];
  const collisionNormalized=normalizeAppData(collisionRaw);
  assert.deepEqual(collisionNormalized.meetings[0].taskItems.map(item=>item.id),collisionItems.map(item=>item.id),'正規化、畫面保存與 reconciliation 必須使用完全相同的碰撞安全 ID');
  assert.equal(collisionNormalized.tasks.find(item=>item.id==='collision-task-a')?.sourceMeetingItemId,'x','碰撞來源需依唯一描述保留第一項歷史');
  assert.equal(collisionNormalized.tasks.find(item=>item.id==='collision-task-b')?.sourceMeetingItemId,'x-duplicate-3','碰撞來源需依唯一描述重映射至正確 canonical 項目，禁止兩筆歷史誤掛同一 ID');
  const unresolvedRaw=structuredClone(migratedNormalized);
  unresolvedRaw.meetings=[{...unresolvedRaw.meetings[0],id:'unresolved-meeting',taskDescription:'替換後事項',taskItems:[{id:'replacement-item',description:'替換後事項',categories:['臨會/專題']}]}];
  unresolvedRaw.tasks=[{...unresolvedRaw.tasks[0],id:'unresolved-internal',sourceMeetingId:'unresolved-meeting',sourceMeetingItemId:undefined,description:'原始內控事項',isInternalControl:true,isClosed:false,vesselId:'v1',vesselIds:['v1']}];
  const unresolvedNormalized=normalizeAppData(unresolvedRaw);
  assert.equal(unresolvedNormalized.tasks[0].sourceMeetingItemId,undefined,'正規化不得把缺少來源 ID 的舊版內控待辦按位置直接連到替換項目');
  const uniquelyMatchedRaw=structuredClone(unresolvedRaw);
  uniquelyMatchedRaw.meetings[0].taskItems[0].description='原始內控事項';
  const uniquelyMatchedNormalized=normalizeAppData(uniquelyMatchedRaw);
  assert.equal(uniquelyMatchedNormalized.tasks[0].sourceMeetingItemId,'replacement-item','描述唯一相符時可安全修復缺少的來源 ID');

  assert.equal(departmentAfterRoleChange('船舶帳戶', 'operator', ['航務部', '工務部']), '航務部');
  assert.equal(departmentAfterRoleChange('工務部', 'admin', ['航務部', '工務部']), '工務部');
  assert.equal(departmentAfterRoleChange('航務部', 'vessel', ['航務部']), '船舶帳戶');
  assert.equal(departmentAfterRoleChange('船舶帳戶', 'operator', ['船舶帳戶', '航務部']), '航務部', '人員角色不得保留船舶帳戶部門');
  assert.equal(departmentAfterRoleChange('船舶帳戶', 'admin', ['船舶帳戶']), '', '沒有有效人員部門時不可回填船舶帳戶');

  const rolePermissions = {
    owner: { viewAllVessels: true, manageMeetings: true },
    admin: { viewAllVessels: true, manageMeetings: true },
    operator: { viewAllVessels: false, manageMeetings: true },
    vessel: { viewAllVessels: false, manageMeetings: false },
  };
  const scopedEditor = { id: 'u1', role: 'operator' };
  const fullEditor = { id: 'admin', role: 'admin' };
  const visibleVessels = [{ id: 'v1', shipType: '油輪' }];
  assert.equal(canEditTemporaryMeetings(rolePermissions, scopedEditor), false, '有 manageMeetings 但無 viewAllVessels 不得全域編輯會議');
  assert.equal(canEditTemporaryMeetings(rolePermissions, fullEditor), true, '具備 viewAllVessels 的會議管理者才可編輯');
  assert.equal(meetingAppliesToUser({ vesselScopeMode: 'vessels', vessels: ['v2'], vesselTypeScopes: [] }, visibleVessels, false), false, '不可見船舶的會議不得對 scoped 使用者曝光');
  assert.equal(meetingAppliesToUser({ vesselScopeMode: 'vessels', vessels: ['v2'], vesselTypeScopes: [], participantUserIds:['u-scope'], responsibleUserIds:[] }, visibleVessels, false, 'u-scope'), true, '臨會與會人員即使無涉船權限也應能檢視該臨會');
  assert.equal(meetingAppliesToUser({ vesselScopeMode: 'vessels', vessels: ['v2'], vesselTypeScopes: [] }, visibleVessels, true), true, '全域編輯者可看到全部會議');

  const legacyMeeting = { id: 'legacy', taskDescription: undefined };
  delete legacyMeeting.taskDescription;
  const legacyTasks = [task('legacy-task', 'v1', 'legacy')];
  legacyTasks[0].description = '既有 legacy 會議待辦';
  assert.equal(meetingTaskDescription(legacyMeeting, legacyTasks), '既有 legacy 會議待辦', 'legacy 會議缺 taskDescription 時需從既有关聯待辦回填');
  assert.equal(meetingTaskDescription({ id: 'explicit-clear', taskDescription: '' }, [task('clear-task', 'v1', 'explicit-clear')]), '', '已存在的空 taskDescription 表示使用者明確清空');

  assert.equal(scheduleDateValue('2026-07-17'), '2026-07-17', 'date-only ETA/ETB/ETD 應保留純日期');
  assert.equal(scheduleTimeValue('2026-07-17'), '', 'date-only ETA/ETB/ETD 不應補 00:00');
  assert.equal(scheduleDateValue('2026-07-17 13:45:00'), '2026-07-17');
  assert.equal(scheduleTimeValue('2026-07-17 13:45:00'), '13:45');
  assert.equal(composeScheduleValue('2026-07-17',''), '2026-07-17');
  assert.equal(composeScheduleValue('2026-07-17','13:45'), '2026-07-17T13:45');
  assert.equal(formatScheduleDisplay('2026-07-17T13:45'), '2026-07-17 13:45');
  assert.equal(formatScheduleDisplay('TBA'), '');

  const meetingsSource = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
  const editModalsSource = fs.readFileSync('src/EditModals.tsx', 'utf8');
  const peoplePickerSource = fs.readFileSync('src/MeetingPeoplePicker.tsx', 'utf8');
  const managementSource = fs.readFileSync('src/Management.tsx', 'utf8');
  assert.ok(meetingsSource.includes('const selected = accessibleMeetings.find'), '目前選取會議必須從 accessibleMeetings 取值，避免切換身份後渲染不可見會議');
  const createPermissionResetIndex = meetingsSource.indexOf('if (creating && !editable)');
  const createReturnIndex = meetingsSource.indexOf('if (creating) return;');
  assert.ok(createPermissionResetIndex >= 0, '喪失編輯權限時不得渲染 create-mode 舊 draft');
  assert.ok(createReturnIndex === -1 || createPermissionResetIndex < createReturnIndex, 'creating 狀態略過重置前必須先處理權限喪失');
  assert.ok(meetingsSource.includes('if (!creating && !selected) return <section'), '不可見 selectedId 必須先回傳空狀態，不得渲染舊 draft');
  const closedConflictPreflight=meetingsSource.slice(meetingsSource.indexOf('meetingTaskClosedLinkConflict({'),meetingsSource.indexOf('const linkedInternalControlTasks='));
  const internalControlPreflight=meetingsSource.slice(meetingsSource.indexOf('meetingTaskInternalControlTransitionRequired({'),meetingsSource.indexOf('if(effectiveDraft.isInternalControl'));
  assert.ok(closedConflictPreflight.includes('previousItems:previousMeetingItems'),'已結案關聯 preflight 必須使用上一版事項身份，避免同描述新項偷換身份');
  assert.ok(internalControlPreflight.includes('previousItems:previousMeetingItems'),'內控轉換 preflight 必須與 reconciliation 使用相同上一版事項身份');
  assert.ok(managementSource.includes("department !== '船舶帳戶'") && managementSource.includes("normalizedDepartment === '船舶帳戶'"), '非船舶角色保存路徑必須拒絕船舶帳戶部門');
  assert.ok(editModalsSource.includes('<MeetingPeoplePicker') && editModalsSource.includes('label="追蹤窗口"') && peoplePickerSource.includes('姓名搜尋') && peoplePickerSource.includes('部門篩選'), '新增要事追蹤窗口必须使用可搜尋、可按部門篩選的下拉多选');
  assert.ok(!editModalsSource.includes('<CheckboxMultiPicker label="追蹤窗口"'), '追蹤窗口不得恢复成全名单平铺');

  console.log('Meeting task reconciliation runtime contracts passed.');
} finally {
  await server.close();
}
