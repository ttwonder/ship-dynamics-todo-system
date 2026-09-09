import assert from 'node:assert/strict';
// Complete raw BEFORE + declared UI intent, captured generated fields BEFORE SQL.
export async function expectedGraph(qa,before,request,intent,window){
 const options=typeof intent==='object'?intent:{type:intent,actorId:'qa-owner',vesselId:'qa-v2',description:'QA ROUNDTRIP ORDINARY TASK'};intent=options.type;
 const old=before.payload,sent=structuredClone(old),expected=structuredClone(old),ops=request.p_operations,actor=old.users.find(u=>u.id===options.actorId);assert.ok(actor);
 assert.equal(request.p_actor_user_id,actor.id);
 for(const op of ops){assert.notEqual(op.kind,'settings');if(op.kind!=='entity')continue;const i=sent[op.collection].findIndex(v=>v.id===op.entityId);assert.deepEqual(i<0?null:sent[op.collection][i],op.expected,'exact complete raw CAS');assert.ok(op.value,'no deletion');if(i<0)sent[op.collection].push(structuredClone(op.value));else sent[op.collection][i]=structuredClone(op.value);}
 for(const op of ops.filter(o=>o.kind==='order')){assert.deepEqual(op.expectedIds,old[op.collection].map(r=>r.id));const map=new Map(sent[op.collection].map(r=>[r.id,r]));assert.equal(new Set(op.valueIds).size,map.size);sent[op.collection]=op.valueIds.map(id=>{assert.ok(map.has(id));return map.get(id);});}
 const stamp=t=>{assert.ok(Date.parse(t)>=window.started-1000&&Date.parse(t)<=window.captured+1000);return t;};
 const freshId=(id,rows)=>{assert.equal(typeof id,'string');assert.ok(id.length>10&&!rows.some(r=>r.id===id));return id;};
 let auditIntents;
 if(intent==='batch'){
  const {applyVesselOperationalDraft}=await qa.loadModule('/src/vesselOperationalDraft.ts');
  for(let i=0;i<2;i++){const v=expected.vessels.find(v=>v.id==='qa-v'+(i+1)),out=sent.vessels.find(t=>t.id===v.id),draft=structuredClone(v);draft.note.recentDynamics='BC SAVED '+(i+1);draft.note.subsequentDynamics='';draft.note.updatedAt=stamp(out.note.updatedAt);draft.position.manualRemark='BC REMARK '+(i+1);draft.position.source='manual';draft.position.updatedAt=stamp(out.position.updatedAt);applyVesselOperationalDraft(v,draft,stamp(out.updatedAt));}
  auditIntents=[['批量更新船舶','vessel','qa-v2','保存批量更新並關閉'],['批量更新船舶','vessel','qa-v1','保存批量更新並關閉']];
 }else{
  const rows=sent.tasks.filter(t=>!old.tasks.some(o=>o.id===t.id));assert.equal(rows.length,1);const t=rows[0],at=stamp(t.updatedAt);assert.equal(t.statusLogs.length,1);
  const log={id:freshId(t.statusLogs[0].id,[]),at,by:actor.name,byUserId:actor.id,text:'待處理'};
  const task={id:freshId(t.id,old.tasks),vesselId:options.vesselId,priority:'中',isAware:false,isAbnormal:false,isInternalControl:false,sourceType:'morning',category:'維修',categories:['維修'],description:options.description,status:'待處理',expectedDate:'',reportDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),departments:['管理組'],ownerUserIds:actor.role==='vessel'?[]:old.vessels.find(v=>v.id===options.vesselId).assignedUserIds.filter(id=>old.users.some(u=>u.id===id&&u.isActive&&u.role!=='vessel')),isClosed:false,createdBy:actor.id,updatedBy:actor.id,createdAt:at,updatedAt:at,statusLogs:[log],attentionDimension:'task',distributeToVessels:false,vesselProgress:[],vesselScopeMode:'vessels',vesselTypeScopes:[]};
  assert.deepEqual(t,task,'complete original creation defaults and intent');expected.tasks.unshift(task);const vessel=expected.vessels.find(v=>v.id===options.vesselId),attentionChanged=!vessel.weeklyAttention.includes('maintenance');vessel.weeklyAttention=[...vessel.weeklyAttention.filter(x=>x!=='maintenance'),'maintenance'];
  auditIntents=[...(attentionChanged?[['切換一週關注燈','vessel',vessel.id,'要事分類同步｜'+t.id]]:[]),['新增事項','task',t.id,'建立跟進事項']];
  const {buildTaskScopeChangeNotifications}=await qa.loadModule('/src/taskWorkflow.ts');const notices=buildTaskScopeChangeNotifications(old.users,null,{task,vessels:[vessel]},actor.id,'task_created',actor.name,old.settings.rolePermissions);const outgoing=sent.notifications.filter(n=>!old.notifications.some(o=>o.id===n.id));assert.equal(outgoing.length,notices.length);expected.notifications=[...notices.map((n,i)=>({...n,id:freshId(outgoing[i].id,old.notifications),createdAt:stamp(outgoing[i].createdAt)})),...old.notifications].slice(0,1000);
 }
 const fresh=sent.auditLogs.filter(a=>!old.auditLogs.some(b=>b.id===a.id));assert.equal(fresh.length,auditIntents.length);
 const audits=auditIntents.map(([action,entityType,entityId,detail],i)=>({id:freshId(fresh[i].id,old.auditLogs),at:stamp(fresh[i].at),actorId:actor.id,actorName:actor.name,actorRole:actor.role,action,entityType,entityId,detail}));expected.auditLogs=[...audits,...old.auditLogs].slice(0,500);
 assert.deepEqual(sent,expected,'all business values/notices/order/unknown histories expected BEFORE SQL');
 for(const a of audits){a.ipAddress='192.0.2.30';a.ipCountryCode='TW';}return expected;
}
