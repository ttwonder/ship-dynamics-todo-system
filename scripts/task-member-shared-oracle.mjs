import assert from 'node:assert/strict';

// Single-task delete: complete business expectation from original helpers and
// pre-SQL outgoing generated IDs/times, not from the committed SQL projection.
export async function prepareDeleteGraph(qa,before,body){
 const {buildTaskNotificationsForVessels}=await qa.loadModule('/src/taskWorkflow.ts');
 const {resolveMeetingTaskItemIdForDeletion}=await qa.loadModule('/src/meetingTaskWorkflow.ts');
 const expected=structuredClone(before.payload),task=expected.tasks.find(t=>t.id==='qa-member-task'),actor=expected.users.find(u=>u.id===body.p_actor_user_id),meeting=expected.meetings.find(m=>m.id===task.sourceMeetingId);
 assert.equal(task.isInternalControl,false);assert.equal(meeting.isInternalControl,false);assert.equal(expected.internalControlCases.some(c=>c.linkedTaskId===task.id),false,'bounded legal meeting delete fixture');
 const outgoing=collection=>body.p_operations.filter(o=>o.kind==='entity'&&o.collection===collection&&o.value!==null).map(o=>o.value);
 const boundTime=value=>{assert.ok(typeof value==='string'&&Math.abs(Date.now()-Date.parse(value))<10000);return value;};
 const boundId=value=>{assert.match(value,/^[a-zA-Z0-9_-]+$/);return value;};
 expected.tasks=expected.tasks.filter(t=>t.id!==task.id);
 const itemId=resolveMeetingTaskItemIdForDeletion(task,meeting);assert.ok(itemId);meeting.taskItems=meeting.taskItems.filter(i=>i.id!==itemId);meeting.taskDescription=meeting.taskItems[0]?.description||'';meeting.updatedAt=boundTime(outgoing('meetings').find(m=>m.id===meeting.id).updatedAt);
 const notices=buildTaskNotificationsForVessels(expected.users,expected.vessels.filter(v=>task.vesselIds.includes(v.id)),actor.id,task,'task_deleted',actor.name,expected.settings.rolePermissions),wireNotices=outgoing('notifications');assert.equal(wireNotices.length,notices.length);
 notices.forEach((n,i)=>{n.id=boundId(wireNotices[i].id);n.createdAt=boundTime(wireNotices[i].createdAt);});
 // The patch entity order is not the notification collection order.
 const noticeOrder=body.p_operations.find(o=>o.kind==='order'&&o.collection==='notifications')?.valueIds||[];
 notices.sort((a,b)=>noticeOrder.indexOf(a.id)-noticeOrder.indexOf(b.id));
 // Match helper-generated recipient ordering independently of transport order.
 const helperNotices=buildTaskNotificationsForVessels(expected.users,expected.vessels.filter(v=>task.vesselIds.includes(v.id)),actor.id,task,'task_deleted',actor.name,expected.settings.rolePermissions);
 for(let i=0;i<notices.length;i++){helperNotices[i].id=notices[i].id;helperNotices[i].createdAt=notices[i].createdAt;}
 expected.notifications=[...helperNotices,...expected.notifications].slice(0,1000);
 const audits=outgoing('auditLogs');assert.equal(audits.length,1);const a=audits[0];
 expected.auditLogs=[{id:boundId(a.id),at:boundTime(a.at),actorId:actor.id,actorName:actor.name,actorRole:actor.role,action:'刪除事項',entityType:'task',entityId:task.id,detail:task.description||task.id,ipAddress:'192.0.2.30',ipCountryCode:'TW'},...expected.auditLogs].slice(0,500);
 expected.revision=before.revision+1;
 return expected;
}

// Build every business value BEFORE SQL using outgoing intent and original helpers.
// AFTER supplies only independently validated opaque IDs and bounded server time.
export async function prepareMemberGraph(qa,before,body){
 const {updateTaskVesselProgress,taskIsClosedForScope}=await qa.loadModule('/src/taskVesselProgress.ts');
 const {buildTaskNotificationsForVessels}=await qa.loadModule('/src/taskWorkflow.ts');
 const {synchronizeLinkedMeetingDecisionLifecycle}=await qa.loadModule('/src/meetingTaskWorkflow.ts');
 const {vesselDisplayName}=await qa.loadModule('/src/vesselDisplay.ts');
 const {richTextToPlainText}=await qa.loadModule('/src/richText.ts');
 const expected=structuredClone(before.payload),at=new Date().toISOString(),ids=[];
 const id=()=>{const s='@id-'+ids.length;ids.push(s);return s;};
 const actor=expected.users.find(u=>u.id===body.p_actor_user_id),vessel=expected.vessels.find(v=>v.id===body.p_vessel_id),task=expected.tasks.find(t=>t.id===body.p_task_id),c=body.p_command;
 const old=task.vesselProgress.find(p=>p.vesselId===vessel.id),texts=c.newStatusLogs?.length?c.newStatusLogs:old.status!==c.status?[{text:c.status}]:[];
 const progress={...old,status:c.status,isClosed:c.isClosed,statusLogs:[...texts.map(l=>({id:id(),at,by:actor.name,byUserId:actor.id,text:l.text})),...old.statusLogs]};
 if(c.isClosed&&!old.isClosed){progress.closedDate=c.closedDate;progress.closedBy=actor.id;}else if(!c.isClosed){delete progress.closedDate;delete progress.closedBy;}
 const saved=updateTaskVesselProgress(task,vessel.id,()=>progress,{at,actorId:actor.id});expected.tasks[expected.tasks.indexOf(task)]=saved;
 const changed=taskIsClosedForScope(task,task.vesselIds)!==taskIsClosedForScope(saved,saved.vesselIds),closed=taskIsClosedForScope(saved,saved.vesselIds);
 if(changed){const index=expected.meetings.findIndex(m=>m.id===task.sourceMeetingId);expected.meetings[index]=synchronizeLinkedMeetingDecisionLifecycle(expected.meetings[index],saved,{actorId:actor.id,actorName:actor.name,at,closedDate:c.closedDate});expected.meetings[index].statusLogs[0].id=id();}
 const notices=buildTaskNotificationsForVessels(expected.users,[vessel],actor.id,saved,'task_updated',actor.name,expected.settings.rolePermissions);for(const n of notices){n.id=id();n.createdAt=at;}expected.notifications=[...notices,...expected.notifications].slice(0,1000);
 const audit={id:id(),at,actorId:actor.id,actorName:actor.name,actorRole:actor.role,action:'更新單船進度',entityType:'task',entityId:task.id,detail:`${vesselDisplayName(vessel)}｜${c.status||'未填狀態'}｜${c.isClosed?'已結案':'未結'}`,ipAddress:'192.0.2.30',ipCountryCode:'TW'};
 expected.auditLogs=[...(changed?[{...audit,id:id(),action:closed?'同步完成臨會/專題待辦':'同步重新開啟臨會/專題待辦',entityType:'meeting',entityId:task.sourceMeetingId,detail:richTextToPlainText(task.description)||task.id}]:[]),audit,...expected.auditLogs].slice(0,500);
 expected.revision=before.revision+1;expected.updatedAt='@metadata-time';
 const started=Date.now();
 return {expected,verify(after){
  const seen=new Set();let time;
  const bind=(want,actual)=>{
   if(want==='@metadata-time'){assert.ok(typeof actual==='string'&&Date.parse(actual)>=started-10&&Date.parse(actual)<=Date.now());return actual;}
   if(want===at){assert.ok(typeof actual==='string'&&Date.parse(actual)>=started-10&&Date.parse(actual)<=Date.now());if(time)assert.equal(actual,time);time=actual;return actual;}
   if(typeof want==='string'&&ids.includes(want)){assert.match(actual,/^[a-f0-9-]{36}$/);assert.ok(!seen.has(actual));seen.add(actual);return actual;}
   if(Array.isArray(want))return want.map((v,i)=>bind(v,actual?.[i]));
   if(want&&typeof want==='object')return Object.fromEntries(Object.entries(want).map(([k,v])=>[k,bind(v,actual?.[k])]));
   return want;
  };
  const resolved=bind(expected,after.payload);assert.equal(after.revision,before.revision+1);assert.deepEqual(after.payload,resolved,'complete intent-derived member/shared graph');return resolved;
 }};
}
