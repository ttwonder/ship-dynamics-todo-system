import assert from 'node:assert/strict';

// These are real mounted-App helpers, assembled in the handler's order. This
// layer proves SQL parity, not React event wiring, hosted roles or live Realtime.
export async function verifyRecordLifecycles(ctx) {
 const {vite,check,current,make,commitBoth,reject,rows,run,db,actor,at,stamp}=ctx;
 const clone=structuredClone;
 const ic=await vite.ssrLoadModule('/src/internalControlData.ts');
 const meeting=await vite.ssrLoadModule('/src/meetingTaskWorkflow.ts');
 const progress=await vite.ssrLoadModule('/src/taskVesselProgress.ts');
 const batch=await vite.ssrLoadModule('/src/batchTaskActions.ts');
 const caseBatch=await vite.ssrLoadModule('/src/batchInternalControlActions.ts');
 const locks=await vite.ssrLoadModule('/src/collaborationLockPlan.ts');
 const {buildTaskScopeChangeNotifications}=await vite.ssrLoadModule('/src/taskWorkflow.ts');
 const time='2026-09-06T01:00:00.000Z';
 const context={actorId:actor,actorName:'QA OWNER',at:time,closedDate:'2026-09-06',closureStatus:'已核對完成'};
 const asCase=id=>({id,vesselId:'v1',reportDate:'2026-09-06',reportSource:'訪船',description:'本機內控 '+id,priority:'高',category:'船舶管理',isAware:true,status:'安排處理',departments:['督導'],syncToTask:true,isClosed:false,createdBy:actor,updatedBy:actor,createdAt:at,updatedAt:at,statusLogs:[]});
 const notices=(draft,previous,next,kind)=>{
  const side=task=>task?{task,vessels:draft.vessels.filter(v=>(task.vesselIds?.length?task.vesselIds:[task.vesselId]).includes(v.id))}:null;
  const generated=buildTaskScopeChangeNotifications(draft.users,side(previous),side(next),actor,kind,'QA OWNER',draft.settings.rolePermissions);
  draft.notifications=[...generated,...draft.notifications].slice(0,1000);
  return generated;
 };
 const caseKeys=item=>[`internal-control:${item.id}`,...(item.linkedTaskId?[`task:${item.linkedTaskId}`]:[])];
 const changedCase=async(id,patch,action)=>{
  let draft=clone(await current());const old=clone(draft.internalControlCases.find(i=>i.id===id));
  ic.updateInternalControlCase(draft,{...old,...patch},old.updatedAt,draft.users[0],time);
  draft=stamp(draft,action,'internal-control',id);
  return commitBoth(await make(draft,caseKeys(old),action+id));
 };
 await check('create internal case and unique reciprocal task, preserving abnormal dimension',async()=>{
  let draft=clone(await current());
  const candidates=['ic-main','ic-withdraw','ic-delete','ic-task-delete','ic-batch'].map(asCase);
  const projections=Object.fromEntries(candidates.map(c=>[c.id,{categories:['船舶管理'],expectedDate:'',ownerUserIds:[actor,'qa-observer'],isAbnormal:false}]));
  const created=ic.createInternalControlCases(draft,candidates,draft.users[0],at,projections);
  assert.equal(created.taskIds.length,5);
  for(const id of created.caseIds){const item=draft.internalControlCases.find(i=>i.id===id);const task=draft.tasks.find(t=>t.id===item.linkedTaskId);assert.equal(task.internalControlCaseId,id);assert.equal(task.isAbnormal,false);}
  draft=stamp(draft,'批量新增內控異常','internal-control',created.caseIds.join(','));
  await commitBoth(await make(draft,['internal-control-create:qa-batch'],'ic-create'));
 });
 await check('source edit synchronizes case and task, stale linked CAS rejects the whole transaction',async()=>{
  let draft=clone(await current());const old=clone(draft.internalControlCases.find(i=>i.id==='ic-main'));
  ic.updateInternalControlCase(draft,{...old,description:'已更新來源'},old.updatedAt,draft.users[0],time);
  draft=stamp(draft,'更新內控異常','internal-control',old.id);
  const request=await make(draft,caseKeys(old),'ic-source-update');
  const bad=clone(request);bad.id+='-stale';bad.operations.find(op=>op.collection==='tasks'&&op.kind==='entity').expected.description='另一人的新版';
  await reject(bad,'block-conflict');
  const saved=await commitBoth(request);
  assert.equal(saved.tasks.find(t=>t.id===old.linkedTaskId).description,'已更新來源');
 });
 await check('case completion closes both endpoints; reopening clears closure without changing content',async()=>{
  const closed=await changedCase('ic-main',{isClosed:true,closedDate:'2026-09-06'},'結案內控異常');
  const item=closed.internalControlCases.find(i=>i.id==='ic-main');assert.equal(closed.tasks.find(t=>t.id===item.linkedTaskId).isClosed,true);
  assert.throws(()=>ic.updateInternalControlCase(clone(closed),{...item,description:'非法同時改內容'},item.updatedAt,closed.users[0],time),/先重新開啟/);
  const reopened=await changedCase('ic-main',{isClosed:false},'重新開啟內控異常');
  const saved=reopened.tasks.find(t=>t.id===item.linkedTaskId);assert.equal(saved.isClosed,false);assert.equal(saved.closedDate,undefined);assert.equal(saved.description,item.description);
 });
 await check('task edit synchronizes back; cancellation preserves ordinary task and closed historical case',async()=>{
  let draft=clone(await current());const item=draft.internalControlCases.find(i=>i.id==='ic-main');
  let task=draft.tasks.find(t=>t.id===item.linkedTaskId);let previous=clone(task);
  task.description='要事反向更新';task.updatedAt=time;task.updatedBy=actor;
  ic.reconcileInternalControlAfterTaskSave(draft,previous,task,draft.users[0],time);
  notices(draft,previous,task,'task_updated');
  const saved=await commitBoth(await make(stamp(draft,'更新事項','task',task.id),caseKeys(item),'ic-reverse'));
  assert.equal(saved.internalControlCases.find(i=>i.id===item.id).description,task.description);
  draft=clone(saved);task=draft.tasks.find(t=>t.id===task.id);previous=clone(task);task.isInternalControl=false;
  ic.reconcileInternalControlAfterTaskSave(draft,previous,task,draft.users[0],time);
  assert.ok(notices(draft,previous,task,'internal_control_cancelled').length>0);
  const cancelled=await commitBoth(await make(stamp(draft,'取消內部管控','task',task.id),caseKeys(item),'ic-cancel'));
  assert.equal(cancelled.internalControlCases.find(i=>i.id===item.id).isClosed,true);
  assert.equal(cancelled.internalControlCases.find(i=>i.id===item.id).syncToTask,false);
  assert.equal(cancelled.tasks.find(t=>t.id===task.id).internalControlCaseId,undefined);
 });
 await check('withdrawal deletes linked task, notices and dismissals but retains the open case',async()=>{
  let draft=clone(await current());const item=draft.internalControlCases.find(i=>i.id==='ic-withdraw');
  const task=draft.tasks.find(t=>t.id===item.linkedTaskId);
  notices(draft,null,task,'task_created');
  draft.taskDismissals.push({id:'qa-dismiss',userId:actor,itemKind:'task',itemId:task.id,dismissedBy:actor,dismissedAt:at});
  draft=await commitBoth(await make(stamp(draft,'從清單移除','task',task.id),[],'dismiss-create'));
  draft=clone(draft);ic.withdrawInternalControlTaskSync(draft,item.id,item.updatedAt,task.updatedAt,draft.users[0],time);
  const request=await make(stamp(draft,'撤回同步要事','internal-control',item.id),caseKeys(item),'ic-withdraw');
  await reject({...request,id:'withdraw-missing-task-lock',locks:request.locks.slice(0,1)},'lock-conflict');
  const saved=await commitBoth(request);const beforeReplay=await rows();assert.equal((await run(db,request)).replayed,true);assert.deepEqual(await rows(),beforeReplay);
  assert.equal(saved.tasks.some(t=>t.id===task.id),false);assert.equal(saved.notifications.some(n=>n.taskId===task.id),false);assert.equal(saved.taskDismissals.some(d=>d.itemId===task.id),false);
  assert.equal(saved.internalControlCases.find(i=>i.id===item.id).isClosed,false);
 });
 await check('case deletion removes both endpoints; task deletion instead retains a closed case',async()=>{
  let draft=clone(await current());let item=clone(draft.internalControlCases.find(i=>i.id==='ic-delete'));
  ic.deleteInternalControlCase(draft,item.id,item.updatedAt);
  let saved=await commitBoth(await make(stamp(draft,'刪除內控異常','internal-control',item.id),caseKeys(item),'ic-delete'));
  assert.equal(saved.tasks.some(t=>t.id===item.linkedTaskId),false);assert.equal(saved.internalControlCases.some(i=>i.id===item.id),false);
  draft=clone(saved);item=clone(draft.internalControlCases.find(i=>i.id==='ic-task-delete'));const task=draft.tasks.find(t=>t.id===item.linkedTaskId);
  ic.closeLinkedInternalControlCaseAfterTaskDelete(draft,task,draft.users[0],time);draft.tasks=draft.tasks.filter(t=>t.id!==task.id);
  notices(draft,task,null,'internal_control_cancelled');
  saved=await commitBoth(await make(stamp(stamp(draft,'取消內部管控','task',task.id),'刪除事項','task',task.id),caseKeys(item),'task-delete'));
  assert.equal(saved.internalControlCases.find(i=>i.id===item.id).isClosed,true);assert.equal(saved.tasks.some(t=>t.id===task.id),false);
 });
 const meetingDraft=()=>({id:'m1',subject:'本機專題',meetingDate:'2026-09-06',reason:'測試來源',participantUserIds:[],taskDescription:'共同事項',vessels:['v1','v2'],vesselScopeMode:'selected',priority:'高',isAbnormal:false,isInternalControl:false,departments:['督導'],trackingUserIds:[],responsibleUserIds:[],expectedDate:'2026-09-10',resolution:'待執行',status:'進行中',statusLogs:[],taskItems:[{id:'item-one',description:'共同事項',categories:[],distributeToVessels:false},{id:'item-distributed',description:'分船事項',categories:[],distributeToVessels:true}],createdBy:actor,createdAt:at,updatedAt:at});
 const reconcile=(draft,previous)=>{
  const m=draft.meetings.find(m=>m.id==='m1');const oldTasks=new Map(draft.tasks.map(t=>[t.id,clone(t)]));
  const result=meeting.reconcileMeetingTasks({tasks:draft.tasks,meetingId:m.id,vesselIds:m.vessels,vesselScopeMode:m.vesselScopeMode,followUps:m.taskItems,priority:m.priority,isAbnormal:m.isAbnormal,isInternalControl:m.isInternalControl,meetingTaskCategories:draft.settings.meetingTaskCategories,expectedDate:m.expectedDate,departments:m.departments,ownerUserIds:m.trackingUserIds,initialStatus:m.resolution,...context,previousMeetingItems:previous?.taskItems,preserveExistingDescriptionItemIds:meeting.unchangedMeetingTaskItemIds(previous,draft.tasks,m.taskItems)});
  meeting.meetingTaskNotificationEvents(draft.tasks,result).forEach(({task,kind})=>notices(draft,oldTasks.get(task.id)||null,task,kind));
  return result;
 };
 await check('two meeting items over two vessels create two tasks and preserve notification recipients',async()=>{
  let draft=clone(await current());draft.meetings.push(meetingDraft());const result=reconcile(draft,null);assert.equal(result.created.length,2);
  const saved=await commitBoth(await make(stamp(draft,'新增臨會/專題','meeting','m1'),['meeting-create:m1'],'meeting-create'));
  assert.equal(saved.tasks.filter(t=>t.sourceMeetingId==='m1').length,2);
  assert.ok(saved.notifications.some(n=>n.kind==='task_created'&&n.userId==='qa-observer'));
 });
 await check('meeting source edit updates canonical tasks; same content reconciliation is a no-op',async()=>{
  let draft=clone(await current());const previous=clone(draft.meetings[0]);draft.meetings[0].taskItems[0].description='來源更新後共同事項';draft.meetings[0].updatedAt=time;
  reconcile(draft,previous);const keys=['meeting:m1',...draft.tasks.filter(t=>t.sourceMeetingId==='m1').map(t=>'task:'+t.id)];
  const saved=await commitBoth(await make(stamp(draft,'更新臨會/專題','meeting','m1'),keys,'meeting-update'));
  const unchanged=clone(saved);const noop=reconcile(unchanged,saved.meetings[0]);assert.deepEqual(noop.updatedIds,[]);assert.deepEqual(unchanged,saved);
 });
 for(const transition of ['complete','reopen'])await check('meeting decision '+transition+' synchronizes parent item but not whole-meeting status',async()=>{
  let draft=clone(await current());const m=draft.meetings[0];const index=draft.tasks.findIndex(t=>t.sourceMeetingItemId==='item-one');const task=draft.tasks[index];
  const result=meeting.transitionLinkedMeetingDecision(m,task,transition,context);draft.meetings[0]=result.meeting;draft.tasks[index]=result.task;
  notices(draft,task,result.task,'task_updated');
  const saved=await commitBoth(await make(stamp(stamp(draft,transition,'task',task.id),transition,'meeting',m.id),locks.taskRelationLockKeys(draft,[task.id]),'decision-'+transition));
  assert.equal(meeting.meetingDecisionLifecycleIsConsistent(saved.meetings[0],saved.tasks,task.id),true);assert.equal(saved.meetings[0].status,m.status);
 });
 for(const [vesselId,closed] of [['v1',true],['v2',true],['v1',false]])await check(`per-vessel progress ${vesselId} ${closed?'complete':'reopen'} preserves the other vessel`,async()=>{
  let draft=clone(await current());const m=draft.meetings[0],index=draft.tasks.findIndex(t=>t.sourceMeetingItemId==='item-distributed');const before=clone(draft.tasks[index]);
  const updated=progress.updateTaskVesselProgress(before,vesselId,p=>({...p,isClosed:closed,status:closed?'已完成':'重新開啟',closedDate:closed?context.closedDate:undefined,closedBy:closed?actor:undefined,statusLogs:[{id:`qa-${vesselId}-${closed}`,at:time,by:'QA OWNER',byUserId:actor,text:closed?'已完成':'重新開啟'},...p.statusLogs]}),context);
  draft.tasks[index]=updated;
  if(!meeting.meetingDecisionLifecycleIsConsistent(m,draft.tasks,updated.id))draft.meetings[0]=meeting.synchronizeLinkedMeetingDecisionLifecycle(m,updated,context);
  const saved=await commitBoth(await make(stamp(draft,'更新單船進度','task',updated.id),['meeting:m1','task:'+updated.id],`progress-${vesselId}-${closed}`));
  const savedTask=saved.tasks.find(t=>t.id===updated.id);
  assert.deepEqual(savedTask.vesselProgress.filter(p=>p.vesselId!==vesselId),before.vesselProgress.filter(p=>p.vesselId!==vesselId));
  assert.equal(meeting.meetingDecisionLifecycleIsConsistent(saved.meetings[0],saved.tasks,updated.id),true);
 });
 await check('mixed batch completion commits tasks, meeting item and linked case once, excluding unselected tasks',async()=>{
  let draft=clone(await current());const caseItem=draft.internalControlCases.find(i=>i.id==='ic-batch');
  const task=draft.tasks.find(t=>t.sourceMeetingItemId==='item-one');const selected=['task-1',task.id,caseItem.linkedTaskId];
  assert.equal(batch.validateBatchTaskSelection(draft.tasks,selected,new Set(['v1','v2']),'complete').ok,true);
  const untouched=draft.tasks.filter(t=>!selected.includes(t.id));
  const completed=batch.completeSelectedTasksWithMeetingSync(draft.tasks,draft.meetings,selected,context);assert.deepEqual(completed.completedIds.slice().sort(),selected.slice().sort());
  draft.tasks=completed.tasks;draft.meetings=completed.meetings;ic.syncLinkedInternalControlCasesFromTasks(draft,selected,draft.users[0],time);
  for(const id of selected){notices(draft,null,draft.tasks.find(t=>t.id===id),'task_updated');draft=stamp(draft,'批量完成事項','task',id);}
  draft=stamp(draft,'批量完成會議決議待辦','meeting','m1');
  const keys=locks.taskRelationLockKeys(draft,selected);
  const request=await make(draft,keys,'mixed-batch');const bad=clone(request);bad.id+='-bad-final-order';bad.operations.findLast(op=>op.kind==='order').valueIds.push('missing');await reject(bad,'invalid-order-result');
  const saved=await commitBoth(request);assert.deepEqual(saved.tasks.filter(t=>!selected.includes(t.id)),untouched);assert.equal(saved.internalControlCases.find(i=>i.id===caseItem.id).isClosed,true);
 });
 await check('removing a meeting item archives its task instead of deleting history',async()=>{
  let draft=clone(await current());const previous=clone(draft.meetings[0]);draft.meetings[0].taskItems=draft.meetings[0].taskItems.filter(i=>i.id!=='item-one');
  const old=draft.tasks.find(t=>t.sourceMeetingItemId==='item-one');reconcile(draft,previous);
  const saved=await commitBoth(await make(stamp(draft,'更新臨會/專題','meeting','m1'),['meeting:m1',...draft.tasks.filter(t=>t.sourceMeetingId==='m1'||t.id===old.id).map(t=>'task:'+t.id)],'meeting-remove-item'));
  const archived=saved.tasks.find(t=>t.id===old.id);assert.equal(archived.isClosed,true);assert.equal(archived.sourceMeetingId,undefined);assert.deepEqual(archived.statusLogs.slice(-old.statusLogs.length),old.statusLogs);
 });
 await check('explicit case batch deletion deletes selected cases only, preserving remaining business state',async()=>{
  let draft=clone(await current());const selected=draft.internalControlCases.filter(i=>['ic-main','ic-withdraw'].includes(i.id));
  const keys=caseBatch.internalControlBatchLockKeys(draft,selected.map(i=>i.id));const untouched=draft.internalControlCases.filter(i=>!selected.some(s=>s.id===i.id));
  const stale=clone(selected);stale[1].updatedAt='stale';assert.throws(()=>caseBatch.deleteInternalControlCaseBatchFromDraft(clone(draft),stale),/已由其他人更新/);
  caseBatch.deleteInternalControlCaseBatchFromDraft(draft,selected);for(const item of selected)draft=stamp(draft,'批量刪除內控異常','internal-control',item.id);
  const saved=await commitBoth(await make(draft,keys,'case-batch-delete'));assert.deepEqual(saved.internalControlCases,untouched);
 });
}
