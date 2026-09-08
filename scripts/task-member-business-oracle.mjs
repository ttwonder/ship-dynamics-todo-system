import assert from 'node:assert/strict';
// Expected business values come from pre-SQL intent and original workflow helpers.
// Only opaque generated IDs and timestamps may be captured from the result.
export async function assertMemberPair(qa,before,after,requests,window){
 const {updateTaskVesselProgress}=await qa.loadModule('/src/taskVesselProgress.ts');
 const {buildTaskNotificationsForVessels}=await qa.loadModule('/src/taskWorkflow.ts');
 const {vesselDisplayName}=await qa.loadModule('/src/vesselDisplay.ts');
 const expected=structuredClone(before.payload),allIds=[];
 const stamp=(actual,key)=>{assert.ok(typeof actual[key]==='string'&&actual[key]);if(key==='id'){assert.match(actual[key],/^[a-f0-9-]{36}$/);allIds.push(actual[key]);}else assert.ok(Date.parse(actual[key])>=window.started&&Date.parse(actual[key])<=window.ended,'server timestamp inside save window');return actual[key];};
 const ordered=requests.slice().sort((a,b)=>a.revision-b.revision);
 for(const {body,revision} of ordered){
  assert.equal(revision,before.revision+ordered.indexOf(ordered.find(x=>x.body===body))+1);
  assert.deepEqual(Object.keys(body.p_command).sort(),['isClosed','mode','newStatusLogs','status']);
  const actor=expected.users.find(u=>u.id===body.p_actor_user_id),vessel=expected.vessels.find(v=>v.id===body.p_vessel_id),task=expected.tasks.find(t=>t.id===body.p_task_id),actualTask=after.payload.tasks.find(t=>t.id===task.id),actual=actualTask.vesselProgress.find(p=>p.vesselId===vessel.id);
  const at=stamp(actual,'updatedAt'),old=task.vesselProgress.find(p=>p.vesselId===vessel.id),texts=body.p_command.newStatusLogs;
  const logs=texts.map((l,i)=>({id:stamp(actual.statusLogs[i],'id'),at,by:actor.name,byUserId:actor.id,text:l.text}));
  const saved=updateTaskVesselProgress(task,vessel.id,()=>({...old,status:body.p_command.status,isClosed:false,statusLogs:[...logs,...old.statusLogs]}),{at,actorId:actor.id});
  expected.tasks[expected.tasks.indexOf(task)]=saved;
  const notices=buildTaskNotificationsForVessels(expected.users,[vessel],actor.id,saved,'task_updated',actor.name,expected.settings.rolePermissions);
  const actualNotices=after.payload.notifications.filter(n=>n.actorId===actor.id);
  assert.equal(actualNotices.length,notices.length);
  notices.forEach((n,i)=>{n.id=stamp(actualNotices[i],'id');n.createdAt=at;});
  expected.notifications=[...notices,...expected.notifications].slice(0,1000);
  const a=after.payload.auditLogs.find(a=>a.actorId===actor.id);
  expected.auditLogs=[{id:stamp(a,'id'),at,actorId:actor.id,actorName:actor.name,actorRole:actor.role,action:'更新單船進度',entityType:'task',entityId:task.id,detail:`${vesselDisplayName(vessel)}｜${body.p_command.status||'未填狀態'}｜未結`,ipAddress:'192.0.2.30',ipCountryCode:'TW'},...expected.auditLogs].slice(0,500);
 }
 expected.revision=after.revision;expected.updatedAt=after.payload.updatedAt;
 assert.equal(new Set(allIds).size,allIds.length);
 assert.deepEqual(after.payload,expected,'complete original task/source/raw history/notification/audit graph');
 const canary=expected.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v3');assert.deepEqual(canary,before.payload.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v3'));
 for(const mutate of [x=>x.meetings[0].qaUnknown=null,x=>x.auditLogs[0].action='forged',x=>x.notifications.reverse(),x=>x.tasks[0].vesselProgress.at(-1).qaUnknown=null]){const bad=structuredClone(after.payload);mutate(bad);assert.throws(()=>assert.deepEqual(bad,expected));}
 return expected;
}
