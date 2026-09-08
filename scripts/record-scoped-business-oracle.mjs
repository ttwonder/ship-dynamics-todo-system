import assert from 'node:assert/strict';

// QA oracle for the two explicitly selected original-UI fixture intents.
// Baseline is raw SQL BEFORE; all generated IDs/times come from the immutable
// outgoing HTTP request captured BEFORE SQL, never from the result under test.
export function scopedTaskExpected(before, request, intent, window) {
  assert.equal(request.p_actor_user_id,'qa-owner');
  const old=before.payload, sent=structuredClone(old), ops=request.p_operations;
  assert.ok(Array.isArray(ops)&&ops.length);
  for(const op of ops){
    assert.notEqual(op.kind,'settings','these intents do not edit settings');
    if(op.kind==='entity'){
      const index=sent[op.collection].findIndex(r=>r.id===op.entityId);
      assert.deepEqual(index<0?null:sent[op.collection][index],op.expected,'outgoing exact raw CAS');
      if(op.value===null){assert.ok(index>=0);sent[op.collection].splice(index,1);}
      else if(index<0)sent[op.collection].push(structuredClone(op.value));
      else sent[op.collection][index]=structuredClone(op.value);
    }
  }
  for(const op of ops.filter(o=>o.kind==='order')){
    assert.deepEqual(op.expectedIds,old[op.collection].map(r=>r.id));
    const rows=new Map(sent[op.collection].map(r=>[r.id,r]));
    assert.equal(new Set(op.valueIds).size,rows.size);
    sent[op.collection]=op.valueIds.map(id=>{assert.ok(rows.has(id));return rows.get(id);});
  }
  const timestamp=value=>{assert.equal(typeof value,'string');const n=Date.parse(value);assert.ok(n>=window.started-1000&&n<=window.captured+1000,'request generated time in operation window');return value;};
  const generatedId=(id,existing)=>{assert.equal(typeof id,'string');assert.ok(id.length>10&&!existing.some(r=>r.id===id),'fresh generated id');return id;};
  const expected=structuredClone(old), ids=intent==='task'?['internal-task-qa-withdraw']:['internal-task-qa-case-delete','internal-task-qa-task-delete'];
  const status=intent==='task'?'SCOPED TARGET SAVED':'批量完成待辦';
  const closed=intent==='bulk';
  for(const id of ids){
    const original=old.tasks.find(t=>t.id===id);assert.ok(original&&!original.isClosed);
    assert.deepEqual(original.ownerUserIds,['qa-operator']);assert.equal(original.vesselId,'qa-v1');
    assert.ok(old.users.some(u=>u.id==='qa-operator'&&u.isActive));
    for(const [col,key] of [['tasks',id],['internalControlCases',original.internalControlCaseId]]){
      const target=expected[col].find(r=>r.id===key), outgoing=sent[col].find(r=>r.id===key);
      const log=outgoing.statusLogs[0], at=timestamp(outgoing.updatedAt);
      const newLog={id:generatedId(log.id,target.statusLogs),at,by:'QA OWNER',byUserId:'qa-owner',text:status};
      target.status=status;target.updatedAt=at;target.updatedBy='qa-owner';target.statusLogs=[newLog,...target.statusLogs];
      if(closed){target.isClosed=true;target.closedBy='qa-owner';target.closedDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
      assert.deepEqual(outgoing,target,'entire target: requested status/actor/closure plus ordered raw unknown history');
    }
    assert.deepEqual(sent.tasks.find(t=>t.id===id).statusLogs[0],sent.internalControlCases.find(c=>c.id===original.internalControlCaseId).statusLogs[0]);
  }
  // Original App.saveTask -> mergeAttentionFromCategories(['維修']) -> maintenance.
  if(intent==='task')expected.vessels.find(v=>v.id==='qa-v1').weeklyAttention=['maintenance'];
  const auditIntents=intent==='task'?
    [['切換一週關注燈','vessel','qa-v1','要事分類同步｜'+ids[0]],['更新事項','task',ids[0],'保存事項變更']]:
    [...ids].reverse().map(id=>['批量完成事項','task',id,old.tasks.find(t=>t.id===id).description]);
  const freshAudits=sent.auditLogs.filter(r=>!old.auditLogs.some(o=>o.id===r.id));
  assert.equal(freshAudits.length,auditIntents.length,'all and only original action audits');
  const audits=auditIntents.map(([action,entityType,entityId,detail],i)=>({id:generatedId(freshAudits[i].id,old.auditLogs),at:timestamp(freshAudits[i].at),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action,entityType,entityId,detail}));
  expected.auditLogs=[...audits,...old.auditLogs].slice(0,500);
  const freshNotices=sent.notifications.filter(r=>!old.notifications.some(o=>o.id===r.id));
  assert.equal(freshNotices.length,ids.length,'one eligible operator recipient per changed task');
  const notices=ids.map((taskId,i)=>{
    const task=old.tasks.find(t=>t.id===taskId), n=freshNotices[i];
    // buildTask[ScopeChange]Notifications[ForVessels]: same owner/scope,
    // actor excluded, active operator is the sole eligible fixture recipient.
    return {id:generatedId(n.id,old.notifications),createdAt:timestamp(n.createdAt),kind:'task_updated',title:'更新待辦｜內部管控｜'+task.description,taskId,userId:'qa-operator',actorId:'qa-owner',message:'QA OWNER 更新待辦：'+task.description,vesselId:'qa-v1'};
  });
  expected.notifications=[...notices,...old.notifications].slice(0,1000);
  assert.deepEqual(sent,expected,'complete outgoing business graph derived from baseline and explicit original intent');
  // The QA HTTP adapter supplies these exact trusted server headers. SQL stamps
  // only new audit IP fields; existing rows retain their original exact values.
  for(const a of expected.auditLogs.filter(r=>audits.some(n=>n.id===r.id))){a.ipAddress='192.0.2.30';a.ipCountryCode='TW';}
  return expected;
}

export function assertScopedSqlResult(before,after,expected,window){
  assert.equal(after.revision,before.revision+1);
  assert.equal(after.payload.revision,after.revision);
  assert.ok(Date.parse(after.payload.updatedAt)>=window.started-1000&&Date.parse(after.payload.updatedAt)<=Date.now()+1000,'server metadata timestamp bounded');
  const result={...expected,revision:after.payload.revision,updatedAt:after.payload.updatedAt};
  assert.deepEqual(after.payload,result,'complete SQL business graph; no SQL actual-to-expected side-effect copying');
  return result;
}

export function proveOracleRejectsTampering(before,after,expected,window){
  const mutations=[['audit-action',x=>x.auditLogs[0].action='WRONG'],['audit-omission',x=>x.auditLogs.shift()],['recipient',x=>x.notifications[0].userId='WRONG'],['notice-omission',x=>x.notifications.shift()],['audit-order',x=>x.auditLogs.reverse()],['history-unknown',x=>{const t=x.tasks.find(t=>t.statusLogs.some(l=>l.qaUnknown||l.qaRaw));const l=t.statusLogs.find(l=>l.qaUnknown||l.qaRaw);delete l.qaUnknown;delete l.qaRaw;}]];
  for(const [label,mutate] of mutations){const bad=structuredClone(after);mutate(bad.payload);assert.throws(()=>assertScopedSqlResult(before,bad,expected,window),assert.AssertionError,label);}
  return mutations.map(([label])=>label);
}
