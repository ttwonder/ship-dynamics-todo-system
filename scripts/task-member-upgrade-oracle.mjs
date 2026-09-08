import assert from 'node:assert/strict';
export function applyOutgoing(before,ops){
 const sent=structuredClone(before);
 for(const op of ops){assert.equal(op.kind==='entity'||op.kind==='order',true);if(op.kind!=='entity')continue;
  const i=sent[op.collection].findIndex(r=>r.id===op.entityId);assert.deepEqual(i<0?null:sent[op.collection][i],op.expected,'exact outgoing raw CAS');
  if(op.value===null)sent[op.collection].splice(i,1);else if(i<0)sent[op.collection].push(structuredClone(op.value));else sent[op.collection][i]=structuredClone(op.value);
 }
 for(const op of ops.filter(o=>o.kind==='order')){assert.deepEqual(op.expectedIds,before[op.collection].map(r=>r.id));const rows=new Map(sent[op.collection].map(r=>[r.id,r]));assert.equal(new Set(op.valueIds).size,rows.size);sent[op.collection]=op.valueIds.map(id=>{assert.ok(rows.has(id));return rows.get(id);});}return sent;
}
export async function prepareOldMemberGraph(qa,before,body,text){
 const old=before.payload,sent=applyOutgoing(old,body.p_operations),expected=structuredClone(old);
 const {updateTaskVesselProgress}=await qa.loadModule('/src/taskVesselProgress.ts');
 const {buildTaskNotificationsForVessels}=await qa.loadModule('/src/taskWorkflow.ts');
 const {vesselDisplayName}=await qa.loadModule('/src/vesselDisplay.ts');
 const actor=old.users.find(u=>u.id===body.p_actor_user_id),vessel=old.vessels.find(v=>v.id==='qa-v1'),task=expected.tasks.find(t=>t.id==='qa-member-task');
 const progress=task.vesselProgress.find(p=>p.vesselId===vessel.id),out=sent.tasks.find(t=>t.id===task.id).vesselProgress.find(p=>p.vesselId===vessel.id),at=out.updatedAt;
 const opaque=(row,key)=>{assert.ok(typeof row[key]==='string'&&row[key]);if(key==='at'||key==='createdAt')assert.ok(Math.abs(Date.now()-Date.parse(row[key]))<30000);return row[key];};
 const log={id:opaque(out.statusLogs[0],'id'),at,by:actor.name,byUserId:actor.id,text};
 const saved=updateTaskVesselProgress(task,vessel.id,()=>({...progress,status:text,statusLogs:[log,...progress.statusLogs]}),{at,actorId:actor.id});expected.tasks[expected.tasks.indexOf(task)]=saved;
 const notices=buildTaskNotificationsForVessels(expected.users,[vessel],actor.id,saved,'task_updated',actor.name,expected.settings.rolePermissions),fresh=sent.notifications.filter(n=>!old.notifications.some(o=>o.id===n.id));assert.equal(fresh.length,notices.length);
 notices.forEach((n,i)=>{n.id=opaque(fresh[i],'id');n.createdAt=opaque(fresh[i],'createdAt');});expected.notifications=[...notices,...old.notifications].slice(0,1000);
 const audits=sent.auditLogs.filter(n=>!old.auditLogs.some(o=>o.id===n.id));assert.equal(audits.length,1);const audit={id:opaque(audits[0],'id'),at:opaque(audits[0],'at'),actorId:actor.id,actorName:actor.name,actorRole:actor.role,action:'更新單船進度',entityType:'task',entityId:task.id,detail:`${vesselDisplayName(vessel)}｜${text}｜未結`};expected.auditLogs=[audit,...old.auditLogs];
 assert.deepEqual(sent,expected,'old outgoing complete original-helper business graph BEFORE SQL');
 audit.ipAddress='192.0.2.30';audit.ipCountryCode='TW';return expected;
}
