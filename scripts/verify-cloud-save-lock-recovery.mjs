import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const recovery=await server.ssrLoadModule('/src/cloudSaveLockRecovery.ts');
  const operations=[
    {kind:'entity',collection:'users',entityId:'user-new',expected:null,value:{id:'user-new',name:'New User'}},
    {kind:'entity',collection:'vessels',entityId:'v1',expected:{id:'v1',position:'before'},value:{id:'v1',position:'after'}},
  ];
  const claimed=[];
  const released=[];
  let receivedGuards=[];
  const result=await recovery.runWithCloudSaveRecoveryLocks({
    operations,
    existingGuards:[],
    createLeaseOwnerId:sectionKey=>`recovery:${sectionKey}`,
    stillCurrent:()=>true,
    renew:async()=>({ok:false}),
    claim:async request=>{claimed.push(request.sectionKey);return{ok:true,sectionKey:request.sectionKey};},
    release:async request=>{released.push(request.sectionKey);},
    run:async guards=>{receivedGuards=guards;return'saved';},
  });
  assert.equal(result.value,'saved');
  assert.deepEqual(claimed,['vessel:v1'],'a mixed management save must reacquire the exact stale vessel lock before writing');
  assert.deepEqual(receivedGuards,[{section_key:'vessel:v1',locked_by:'recovery:vessel:v1'}],'the recovered exact lock must fence the atomic block patch');
  assert.deepEqual(released,['vessel:v1'],'the temporary recovery lock must be released after the durable write');
  assert.equal(result.cleanupFailed,false);

  const renewed=[];
  const existingGuard={section_key:'vessel:v1',locked_by:'active-editor-lease'};
  const reused=await recovery.runWithCloudSaveRecoveryLocks({
    operations,
    existingGuards:[existingGuard],
    createLeaseOwnerId:sectionKey=>`must-not-claim:${sectionKey}`,
    stillCurrent:()=>true,
    renew:async request=>{renewed.push({sectionKey:request.sectionKey,leaseOwnerId:request.leaseOwnerId});return{ok:true,sectionKey:request.sectionKey};},
    claim:async()=>{throw new Error('an already-owned exact lease must be renewed, not claimed again');},
    release:async()=>{throw new Error('the caller-owned exact lease must not be released by recovery');},
    run:async guards=>guards,
  });
  assert.deepEqual(renewed,[{sectionKey:'vessel:v1',leaseOwnerId:'active-editor-lease'}],'an existing exact lease must be renewed immediately before the atomic patch');
  assert.deepEqual(reused.value,[existingGuard],'the renewed caller-owned fencing guard must be reused unchanged');
  assert.equal(reused.cleanupFailed,false);

  let renewalCurrent=true;
  let staleRenewalWriteRan=false;
  await assert.rejects(
    recovery.runWithCloudSaveRecoveryLocks({
      operations,
      existingGuards:[existingGuard],
      createLeaseOwnerId:sectionKey=>`stale:${sectionKey}`,
      stillCurrent:()=>renewalCurrent,
      renew:async request=>{renewalCurrent=false;return{ok:true,sectionKey:request.sectionKey};},
      claim:async()=>{throw new Error('a stale renewal must not claim or write');},
      release:async()=>{},
      run:async()=>{staleRenewalWriteRan=true;return'unsafe';},
    }),
    /雲端保存補鎖已取消/,
    'a session invalidated while renewing an existing guard must fail closed before the atomic write',
  );
  assert.equal(staleRenewalWriteRan,false,'renewal completion after session invalidation must never reach the atomic write');

  let postClaimCurrentChecks=0;
  let postClaimWriteRan=false;
  const postClaimReleased=[];
  await assert.rejects(
    recovery.runWithCloudSaveRecoveryLocks({
      operations,
      existingGuards:[],
      createLeaseOwnerId:sectionKey=>`post-claim:${sectionKey}`,
      stillCurrent:()=>++postClaimCurrentChecks<=2,
      renew:async()=>({ok:false}),
      claim:async request=>({ok:true,sectionKey:request.sectionKey}),
      release:async request=>{postClaimReleased.push(request.sectionKey);},
      run:async()=>{postClaimWriteRan=true;return'unsafe';},
    }),
    /雲端保存補鎖已取消/,
    'a session invalidated after the bundle claim checks must fail closed before the atomic write',
  );
  assert.equal(postClaimWriteRan,false,'post-claim invalidation must never reach the atomic write');
  assert.deepEqual(postClaimReleased,['vessel:v1'],'a freshly acquired recovery lease must be released when the session becomes stale before dispatch');

  let blockedWriteRan=false;
  await assert.rejects(
    recovery.runWithCloudSaveRecoveryLocks({
      operations,
      existingGuards:[],
      createLeaseOwnerId:sectionKey=>`blocked:${sectionKey}`,
      stillCurrent:()=>true,
      renew:async()=>({ok:false}),
      claim:async request=>({ok:false,sectionKey:request.sectionKey,lockedByName:'另一位使用者'}),
      release:async()=>{},
      run:async()=>{blockedWriteRan=true;return'unsafe';},
    }),
    error=>error?.name==='CloudSaveRecoveryLockConflictError'&&error.sectionKey==='vessel:v1'&&error.lockedByName==='另一位使用者',
    'a real same-entity editor must produce a typed collaboration conflict before any write',
  );
  assert.equal(blockedWriteRan,false,'a blocked recovery lease must never reach the atomic write');

  const creationOperations=[{kind:'entity',collection:'tasks',entityId:'draft-1',expected:null,value:{id:'draft-1',vesselId:'v1'}}];
  const creationClaims=[];
  const recoveredCreation=await recovery.runWithCloudSaveRecoveryLocks({
    operations:creationOperations,
    existingGuards:[{section_key:'task-create:v2:v1:draft-1',locked_by:'expired-creation-owner'}],
    createLeaseOwnerId:sectionKey=>`fresh:${sectionKey}`,
    stillCurrent:()=>true,
    renew:async()=>({ok:false}),
    claim:async request=>{creationClaims.push(request.sectionKey);return{ok:true,sectionKey:request.sectionKey};},
    release:async()=>{},
    run:async guards=>guards,
  });
  assert.deepEqual(creationClaims,['task-create:v2:v1:draft-1'],'an expired creation sentinel must be reclaimed by its exact attempt key');
  assert.deepEqual(recoveredCreation.value,[{section_key:'task-create:v2:v1:draft-1',locked_by:'fresh:task-create:v2:v1:draft-1'}],'a recovered creation attempt must fence the atomic create with the fresh lease owner');

  const managementClaims=[];
  const managementOnly=await recovery.runWithCloudSaveRecoveryLocks({
    operations:[
      {kind:'entity',collection:'vessels',entityId:'v1',expected:{id:'v1',shortName:'Old',fullName:'Old full',fleetCategory:'Old fleet'},value:{id:'v1',shortName:'New',fullName:'New full',fleetCategory:'New fleet'}},
      {kind:'entity',collection:'users',entityId:'user-management',expected:null,value:{id:'user-management',name:'Management User'}},
    ],
    existingGuards:[],
    createLeaseOwnerId:sectionKey=>`unexpected:${sectionKey}`,
    stillCurrent:()=>true,
    renew:async()=>({ok:false}),
    claim:async request=>{managementClaims.push(request.sectionKey);return{ok:true,sectionKey:request.sectionKey};},
    release:async()=>{},
    run:async guards=>guards,
  });
  assert.deepEqual(managementClaims,[],'Management-only vessel metadata must not be promoted into a collaborative vessel lease');
  assert.deepEqual(managementOnly.value,[],'Management-only metadata saves must use authorization CAS without a collaboration guard');

  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const saveStart=app.indexOf('const enqueueCloudSave =');
  const saveEnd=app.indexOf('\n  const flushCloudBeforeBatchRelease=',saveStart);
  const saveSource=app.slice(saveStart,saveEnd);
  const failureStart=app.indexOf('const reportCloudSaveFailure=');
  const failureEnd=app.indexOf('\n  const confirmCloudSnapshot=',failureStart);
  const failureSource=app.slice(failureStart,failureEnd);
  assert.ok(app.includes("from './cloudSaveLockRecovery'"),'App must import the common cloud-save recovery lock runner');
  assert.ok(saveSource.includes('runWithCloudSaveRecoveryLocks({')&&saveSource.indexOf('runWithCloudSaveRecoveryLocks({')<saveSource.indexOf('applyCloudBlockPatchRpc('),'every atomic block patch must reacquire missing exact locks in the common save layer before the RPC');
  assert.ok(failureSource.includes('error instanceof CloudSaveRecoveryLockConflictError')&&failureSource.includes('lockedByName')&&failureSource.includes('修改仍保留'),'a real collaboration conflict must identify the lock owner and preserve the draft instead of being reported as a network error');
  console.log('Cloud save lock recovery contracts passed.');
}finally{
  await server.close();
}
