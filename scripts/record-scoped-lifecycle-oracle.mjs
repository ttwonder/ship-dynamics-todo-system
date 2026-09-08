import assert from 'node:assert/strict';

// Bounded original case/meeting intent ledger. The complete persistence oracle
// is the immutable pre-SQL request applied over raw BEFORE, not SQL AFTER.
// This proves transport/SQL equality; field-level business derivation is separately
// asserted for the requested status/closure/history/actor and original audit names.
export function assertLifecycleReadback(before,after,capture,{entities,audits,noticeTaskId}){
  const body=capture.body, expected=structuredClone(before.payload);
  assert.equal(body.p_actor_user_id,'qa-owner');
  const operations=body.p_operations;
  for(const op of operations.filter(o=>o.kind==='entity')){
    const rows=expected[op.collection], index=rows.findIndex(r=>r.id===op.entityId);
    assert.deepEqual(index<0?null:rows[index],op.expected,'complete raw outgoing CAS');
    assert.ok(['auditLogs','notifications'].includes(op.collection)||entities.includes(op.collection+':'+op.entityId),'no unrelated entity mutation');
    if(op.value===null){assert.ok(index>=0);rows.splice(index,1);}
    else if(index<0)rows.push(structuredClone(op.value));
    else rows[index]=structuredClone(op.value);
  }
  for(const op of operations){
    assert.notEqual(op.kind,'settings');
    if(op.kind!=='order')continue;
    assert.deepEqual(op.expectedIds,before.payload[op.collection].map(r=>r.id));
    const rows=new Map(expected[op.collection].map(r=>[r.id,r]));
    assert.equal(new Set(op.valueIds).size,rows.size);
    expected[op.collection]=op.valueIds.map(id=>{assert.ok(rows.has(id));return rows.get(id);});
  }
  const addedAudits=expected.auditLogs.filter(r=>!before.payload.auditLogs.some(old=>old.id===r.id));
  assert.deepEqual(addedAudits.map(r=>[r.action,r.entityType,r.entityId]),audits,'original action names and ordering');
  for(const a of addedAudits){
    assert.equal(a.actorId,'qa-owner');assert.equal(a.actorName,'QA OWNER');assert.equal(a.actorRole,'owner');
    assert.ok(Math.abs(Date.parse(a.at)-capture.captured)<10000,'client audit time captured before SQL');
    a.ipAddress='192.0.2.30';a.ipCountryCode='TW';
  }
  const addedNotices=expected.notifications.filter(r=>!before.payload.notifications.some(old=>old.id===r.id));
  assert.deepEqual(addedNotices.map(r=>[r.taskId,r.userId,r.actorId,r.kind]),noticeTaskId?[[noticeTaskId,'qa-operator','qa-owner','task_updated']]:[],'source workflow eligible recipient and no invented notices');
  // These lifecycle intents do not prune, reorder or modify previous notices/audits.
  assert.deepEqual(expected.auditLogs.slice(addedAudits.length),before.payload.auditLogs);
  assert.deepEqual(expected.notifications.slice(addedNotices.length),before.payload.notifications);
  assert.equal(after.revision,before.revision+1);assert.equal(after.payload.revision,after.revision);
  assert.ok(Math.abs(Date.parse(after.payload.updatedAt)-capture.captured)<10000,'SQL metadata time separately bounded');
  expected.revision=after.revision;expected.updatedAt=after.payload.updatedAt;
  assert.deepEqual(after.payload,expected,'entire SQL payload matches original request, bystanders/unknown fields included');
  return expected;
}
