import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const patch=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const cloud=await server.ssrLoadModule('/src/cloud.ts');
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const base=structuredClone(createInitialData());
  base.vessels=[{id:'v1',name:'V1',position:'A'},{id:'v2',name:'V2',position:'B'}];
  base.tasks=[{id:'t1',vesselId:'v1',status:'open'}];
  base.meetings=[{id:'m1',subject:'before'}];
  base.internalControlCases=[{id:'i1',status:'open'}];
  base.notifications=[{id:'n1',readAt:''}];
  base.auditLogs=[{id:'a1',action:'before'}];
  base.revision=7;
  base.updatedAt='2026-01-01T00:00:00.000Z';

  const next=structuredClone(base);
  next.vessels[0].position='C';
  next.tasks[0].status='closed';
  next.meetings[0].subject='after';
  next.internalControlCases[0].status='closed';
  next.notifications.push({id:'n2',readAt:''});
  next.auditLogs=[];
  next.settings={...next.settings,departments:[...next.settings.departments,'Patch Test']};
  next.revision=99;
  next.updatedAt='2099-01-01T00:00:00.000Z';

  const operations=patch.buildCloudBlockPatch(base,next);
  assert.ok(operations.length>0,'changed blocks must produce operations');
  assert.ok(operations.some(op=>op.kind==='entity'&&op.collection==='vessels'&&op.entityId==='v1'));
  assert.ok(operations.some(op=>op.kind==='entity'&&op.collection==='tasks'&&op.entityId==='t1'));
  assert.ok(operations.some(op=>op.kind==='entity'&&op.collection==='meetings'&&op.entityId==='m1'));
  assert.ok(operations.some(op=>op.kind==='entity'&&op.collection==='internalControlCases'&&op.entityId==='i1'));
  assert.ok(operations.some(op=>op.kind==='settings'));
  assert.ok(!operations.some(op=>op.kind==='entity'&&op.collection==='vessels'&&op.entityId==='v2'),'unchanged entities must not be uploaded');

  const applied=patch.applyCloudBlockPatch(base,operations);
  for(const key of ['settings','users','vessels','tasks','internalControlCases','meetings','agendaReports','notifications','auditLogs']){
    assert.deepEqual(applied[key],next[key],`${key} must be reconstructed exactly from block operations`);
  }
  assert.equal(applied.revision,base.revision,'the RPC owns revision changes');
  assert.equal(applied.updatedAt,base.updatedAt,'the RPC owns updatedAt changes');

  const tampered=structuredClone(base);
  tampered.vessels[0].position='concurrent';
  assert.throws(()=>patch.applyCloudBlockPatch(tampered,operations),patch.CloudBlockPatchConflictError,'same-item concurrent edits must fail CAS');

  const createdDeleted=structuredClone(base);
  createdDeleted.vessels=[structuredClone(base.vessels[1]),{id:'v3',name:'V3',position:'D'}];
  const createDeleteOps=patch.buildCloudBlockPatch(base,createdDeleted);
  assert.ok(createDeleteOps.some(op=>op.kind==='entity'&&op.entityId==='v1'&&op.value===null));
  assert.ok(createDeleteOps.some(op=>op.kind==='entity'&&op.entityId==='v3'&&op.expected===null));
  assert.deepEqual(patch.applyCloudBlockPatch(base,createDeleteOps).vessels,createdDeleted.vessels,'create/delete/order must be exact');

  const reordered=structuredClone(base);
  reordered.vessels=[structuredClone(base.vessels[1]),structuredClone(base.vessels[0])];
  const reorderOps=patch.buildCloudBlockPatch(base,reordered);
  assert.ok(reorderOps.some(op=>op.kind==='order'&&op.collection==='vessels'));
  assert.deepEqual(patch.applyCloudBlockPatch(base,reorderOps).vessels,reordered.vessels);

  const remote=structuredClone(base);
  remote.users[0]={...remote.users[0],name:'remote unrelated user'};
  remote.revision=8;
  const merged=structuredClone(remote);
  merged.vessels[0].position='local vessel update';
  const disjointOps=patch.buildCloudBlockPatch(remote,merged);
  assert.deepEqual(disjointOps.filter(op=>op.kind==='entity').map(op=>`${op.collection}:${op.entityId}`),['vessels:v1'],'unrelated authorization data must not be carried in a vessel update');

  const duplicate=structuredClone(base);
  duplicate.vessels.push(structuredClone(duplicate.vessels[0]));
  assert.throws(()=>patch.buildCloudBlockPatch(duplicate,next),/duplicate/i,'duplicate entity ids must fail closed');

  assert.deepEqual(patch.buildCloudBlockPatch(base,{...structuredClone(base),revision:8,updatedAt:'later'}),[],'metadata-only changes are server-owned and must not become operations');

  const optionalBase=structuredClone(base);
  optionalBase.vessels[0].legacyOptionalField=undefined;
  const optionalNext=structuredClone(optionalBase);
  optionalNext.vessels[0].position='json-normalized-update';
  const optionalOps=patch.buildCloudBlockPatch(optionalBase,optionalNext);
  assert.equal(optionalOps.find(op=>op.kind==='entity'&&op.entityId==='v1').expected.legacyOptionalField,undefined,'undefined object fields must be omitted exactly as JSON transport omits them');

  const legacyStorageBase=structuredClone(base);
  const normalizedLegacyBase=structuredClone(legacyStorageBase);
  normalizedLegacyBase.vessels[0].manualAttentionLevel='';
  const legacyNext=structuredClone(normalizedLegacyBase);
  legacyNext.vessels[0].position='legacy-compatible-update';
  const legacyOps=patch.buildCloudBlockPatch(normalizedLegacyBase,legacyNext,legacyStorageBase);
  const legacyVesselOp=legacyOps.find(op=>op.kind==='entity'&&op.entityId==='v1');
  assert.equal(legacyOps.filter(op=>op.kind==='entity').length,1,'normalizer-added defaults must not dirty every legacy entity');
  assert.equal(Object.hasOwn(legacyVesselOp.expected,'manualAttentionLevel'),false,'CAS expected value must preserve the raw stored legacy entity');

  const requestLog=[];
  const originalFetch=globalThis.fetch;
  const rpcPayload=createInitialData();
  delete rpcPayload.vessels[0].manualAttentionLevel;
  rpcPayload.revision=8;
  rpcPayload.updatedAt='2026-08-04T12:20:00.000Z';
  globalThis.fetch=async(url,init)=>{
    requestLog.push({url:String(url),init,body:JSON.parse(String(init?.body||'{}'))});
    return new Response(JSON.stringify({ok:true,revision:8,updated_at:rpcPayload.updatedAt,payload:rpcPayload}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const config={supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'test-anon-key',workspaceKey:'workspace',tableName:'ship_dynamics_app_state'};
    const lockGuards=[{section_key:'vessel:v1',locked_by:'lease-v1'}];
    const rpcResult=await cloud.applyCloudBlockPatch(operations,'Operator','actor-1',{actor:{id:'actor-1'},effectivePermissions:{editBusinessContent:true},visibleVesselIds:['v1'],nonOwnerPasswordResetVersion:2},null,lockGuards,config);
    assert.equal(rpcResult.revision,8);
    const storedRpcPayload=cloud.cloudStoragePayloadFor(rpcResult);
    assert.equal(Object.hasOwn(storedRpcPayload.vessels[0],'manualAttentionLevel'),false,'RPC responses must retain their raw storage payload beside normalized AppData');
    assert.equal(requestLog.length,1);
    assert.match(requestLog[0].url,/\/rest\/v1\/rpc\/apply_ship_dynamics_block_patch$/);
    assert.deepEqual(requestLog[0].body.p_operations,operations);
    assert.equal(requestLog[0].body.p_actor_user_id,'actor-1');
    assert.equal(requestLog[0].body.p_saved_by,'Operator');
    assert.ok(requestLog[0].body.p_actor_guard,'RPC must carry a server-checked actor authorization guard');
    assert.deepEqual(requestLog[0].body.p_lock_guards,lockGuards,'RPC must carry lock-owner fencing guards');
  }finally{
    globalThis.fetch=originalFetch;
  }

  const config={supabaseUrl:'https://conflict.supabase.co',supabaseAnonKey:'test-anon-key-2',workspaceKey:'workspace',tableName:'ship_dynamics_app_state'};
  const conflictLockGuards=[{section_key:'vessel:v1',locked_by:'lease-v1'}];
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,code:'block-conflict',conflict_key:'vessels:v1'}),{status:200,headers:{'content-type':'application/json'}});
  try{
    await assert.rejects(()=>cloud.applyCloudBlockPatch(operations,'Operator','actor-1',{actor:{id:'actor-1'}},null,conflictLockGuards,config),error=>error instanceof patch.CloudBlockPatchConflictError&&error.blockKey==='vessels:v1');

    globalThis.fetch=async()=>new Response(JSON.stringify({code:'P0001',message:'runtime failure inside apply_ship_dynamics_block_patch'}),{status:400,headers:{'content-type':'application/json'}});
    await assert.rejects(
      ()=>cloud.applyCloudBlockPatch(operations,'Operator','actor-1',{actor:{id:'actor-1'}},null,conflictLockGuards,config),
      error=>!(error instanceof cloud.CloudBlockPatchUnavailableError),
      'runtime RPC failures must fail closed instead of silently falling back to whole-state CAS',
    );

    globalThis.fetch=async()=>new Response(JSON.stringify({code:'PGRST202',message:'Could not find the function public.apply_ship_dynamics_block_patch in the schema cache'}),{status:404,headers:{'content-type':'application/json'}});
    await assert.rejects(
      ()=>cloud.applyCloudBlockPatch(operations,'Operator','actor-1',{actor:{id:'actor-1'}},null,conflictLockGuards,config),
      cloud.CloudBlockPatchUnavailableError,
      'only a confirmed missing-function response may enable legacy CAS fallback',
    );
  }finally{
    globalThis.fetch=originalFetch;
  }
  console.log('Cloud block patch runtime contracts passed.');
}finally{
  await server.close();
}
