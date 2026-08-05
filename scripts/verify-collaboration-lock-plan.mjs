import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const plan=await server.ssrLoadModule('/src/collaborationLockPlan.ts');
  const operations=[
    {kind:'entity',collection:'tasks',entityId:'task-b',expected:{id:'task-b'},value:{id:'task-b',status:'closed'}},
    {kind:'entity',collection:'meetings',entityId:'meeting-a',expected:{id:'meeting-a'},value:{id:'meeting-a',subject:'updated'}},
    {kind:'entity',collection:'internalControlCases',entityId:'case-c',expected:{id:'case-c'},value:null},
    {kind:'entity',collection:'vessels',entityId:'vessel-z',expected:{id:'vessel-z',position:'before'},value:{id:'vessel-z',position:'after'}},
    {kind:'entity',collection:'tasks',entityId:'new-task',expected:null,value:{id:'new-task'}},
    {kind:'entity',collection:'meetings',entityId:'new-meeting',expected:null,value:{id:'new-meeting'}},
    {kind:'entity',collection:'auditLogs',entityId:'audit-1',expected:null,value:{id:'audit-1'}},
    {kind:'order',collection:'tasks',expectedIds:['task-b'],valueIds:['task-b','new-task']},
    {kind:'entity',collection:'tasks',entityId:'task-b',expected:{id:'task-b'},value:{id:'task-b',status:'closed'}},
  ];
  assert.deepEqual(plan.existingEntityLockKeysForPatch(operations),[
    'internal-control:case-c',
    'meeting:meeting-a',
    'task:task-b',
    'vessel:vessel-z',
  ],'the lock plan must contain every distinct existing entity touched by a coupled patch, in deterministic order');
  assert.deepEqual(plan.existingEntityLockKeysForPatch([
    {kind:'entity',collection:'meetings',entityId:'created-only',expected:null,value:{id:'created-only'}},
  ]),[],'absent-value creates use their creation session and must not masquerade as an existing-item lock');
  assert.deepEqual(plan.existingEntityLockKeysForPatch([
    {kind:'entity',collection:'vessels',entityId:'metadata-only',expected:{id:'metadata-only',shortName:'Old'},value:{id:'metadata-only',shortName:'New'}},
  ]),[],'Management-only vessel metadata stays on authorization CAS and must not acquire a collaboration lease');
  assert.equal(plan.lockKeyForExistingEntity('tasks','t-1'),'task:t-1');
  assert.equal(plan.lockKeyForExistingEntity('internalControlCases','ic-1'),'internal-control:ic-1');
  assert.equal(plan.lockKeyForExistingEntity('users','u-1'),null);
  const relationSnapshot={
    tasks:[
      {id:'task-a',sourceMeetingId:'meeting-a',internalControlCaseId:'case-a'},
      {id:'task-b'},
      {id:'task-unselected',sourceMeetingId:'meeting-z'},
    ],
    meetings:[{id:'meeting-a'},{id:'meeting-z'}],
    internalControlCases:[
      {id:'case-a',linkedTaskId:'task-a'},
      {id:'case-b',linkedTaskId:'task-b'},
      {id:'case-unrelated',linkedTaskId:'task-unselected'},
    ],
  };
  assert.deepEqual(plan.taskRelationLockKeys(relationSnapshot,['task-b','task-a']),[
    'internal-control:case-a',
    'internal-control:case-b',
    'meeting:meeting-a',
    'task:task-a',
    'task:task-b',
  ],'batch task mutations must lock every selected task and every existing meeting/internal-control relation they may update');
  assert.deepEqual(plan.taskRelationLockKeys(relationSnapshot,['missing']),['task:missing'],'missing selected ids retain their exact task key so the post-lock refresh can fail closed');
  assert.deepEqual(plan.relatedEntityLockKeysForSection(relationSnapshot,'meeting:meeting-a'),[
    'internal-control:case-a',
    'meeting:meeting-a',
    'task:task-a',
  ],'a meeting mutation must include every existing generated task and its linked internal-control case');
  assert.deepEqual(plan.relatedEntityLockKeysForSection(relationSnapshot,'internal-control:case-b'),[
    'internal-control:case-b',
    'task:task-b',
  ],'an internal-control mutation must include its exact case and every linked task');
  assert.deepEqual(plan.relatedEntityLockKeysForSection(relationSnapshot,'task:task-a'),[
    'internal-control:case-a',
    'meeting:meeting-a',
    'task:task-a',
  ],'an individual task mutation must include its exact task and every existing meeting/internal-control relation');
  assert.deepEqual(plan.relatedEntityLockKeysForSection(relationSnapshot,'meeting:missing'),['meeting:missing']);
  const ordinaryTaskSnapshot={tasks:[{id:'task-new-internal',isInternalControl:false}],internalControlCases:[]};
  assert.deepEqual(
    plan.taskInternalControlCreationLockKeys(ordinaryTaskSnapshot,{id:'task-new-internal',isInternalControl:true},false),
    ['internal-control-create:task-new-internal'],
    'an existing ordinary task that will create an internal-control case must claim a deterministic internal-control creation guard',
  );
  assert.deepEqual(
    plan.taskInternalControlCreationLockKeys({...ordinaryTaskSnapshot,internalControlCases:[{id:'internal-task-new-internal',linkedTaskId:'task-new-internal'}]},{id:'task-new-internal',isInternalControl:true},false),
    [],
    'an existing linked internal-control case must use its direct relation lock rather than an extra creation guard',
  );
  assert.deepEqual(plan.taskInternalControlCreationLockKeys(ordinaryTaskSnapshot,{id:'task-new-internal',isInternalControl:false},false),[],'a task that remains ordinary must not claim an internal-control creation guard');
  assert.deepEqual(plan.taskInternalControlCreationLockKeys(ordinaryTaskSnapshot,{id:'task-new-internal',isInternalControl:true},true),[],'meeting-source task reconciliation must remain under the parent meeting lock path');
  console.log('Collaboration lock planning contracts passed.');
}finally{
  await server.close();
}
