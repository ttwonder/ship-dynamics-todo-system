import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

const db=new PGlite();
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
  const recovery=await server.ssrLoadModule('/src/cloudSaveLockRecovery.ts');
  const patch=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const owner={id:'owner-1',name:'Owner',role:'owner',isActive:true,managedVesselIds:[]};
  const base={
    revision:1,updatedAt:'2026-08-05T00:00:00.000Z',
    settings:{rolePermissions:{owner:{viewAllVessels:true,editBusinessContent:true,createTasks:true,closeTasks:true,deleteTasks:true,manageMeetings:true,exportReports:true,enterManagement:true,manageUsers:true,manageVessels:true,viewAuditLogs:true,manageRolePermissions:true,manageSystemSettings:true}},nonOwnerPasswordResetVersion:1,sitePasswordHash:''},
    users:[owner],
    vessels:[
      {id:'v1',name:'V1',isActive:true,assignedUserIds:[],delegateManagers:[],position:'before-v1'},
      {id:'v2',name:'V2',isActive:true,assignedUserIds:[],delegateManagers:[],position:'before-v2'},
    ],
    tasks:[],internalControlCases:[],meetings:[],agendaReports:[],notifications:[],auditLogs:[],
  };
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['recovery-workspace',JSON.stringify(base),1,'seed']);

  const claim=async request=>{
    const value=(await db.query('select public.claim_ship_dynamics_edit_lock($1,$2,$3,$4,$5) as value',['recovery-workspace',request.sectionKey,request.leaseOwnerId,'Owner',75])).rows[0].value;
    return{ok:Boolean(value.ok),sectionKey:value.section_key||request.sectionKey,lockedByName:value.locked_by_name,expiresAt:value.expires_at};
  };
  const renew=async request=>{
    const value=(await db.query('select public.renew_ship_dynamics_edit_lock($1,$2,$3,$4) as value',['recovery-workspace',request.sectionKey,request.leaseOwnerId,75])).rows[0].value;
    return{ok:Boolean(value.ok),sectionKey:value.section_key||request.sectionKey,lockedByName:value.locked_by_name,expiresAt:value.expires_at};
  };
  const release=async request=>{await db.query('select public.release_ship_dynamics_edit_lock($1,$2,$3)',['recovery-workspace',request.sectionKey,request.leaseOwnerId]);};
  const currentPayload=async()=>structuredClone((await db.query("select payload from public.ship_dynamics_app_state where workspace_key='recovery-workspace'")).rows[0].payload);
  const applyCandidate=async(candidate,leasePrefix,existingGuards=[])=>{
    const remote=await currentPayload();
    const operations=patch.buildCloudBlockPatch(remote,candidate);
    const actorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value',[JSON.stringify(remote),owner.id])).rows[0].value;
    const authorizationChanged=operations.some(operation=>operation.kind==='settings'||operation.kind==='entity'&&operation.collection==='users'||operation.kind==='order'&&operation.collection==='users');
    const authorizationGuard=authorizationChanged?(await db.query('select public.ship_dynamics_authorization_guard($1::jsonb) as value',[JSON.stringify(remote)])).rows[0].value:null;
    return recovery.runWithCloudSaveRecoveryLocks({
      operations,existingGuards,createLeaseOwnerId:sectionKey=>`${leasePrefix}:${sectionKey}`,stillCurrent:()=>true,renew,claim,release,
      run:async guards=>(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
        'recovery-workspace',JSON.stringify(operations),owner.name,owner.id,JSON.stringify(actorGuard),authorizationGuard?JSON.stringify(authorizationGuard):null,JSON.stringify(guards),
      ])).rows[0].value,
    });
  };

  const mixed=structuredClone(base);
  mixed.vessels[0].position='recovered-v1';
  mixed.users.push({id:'user-new',name:'Recovered User',role:'operator',isActive:true,managedVesselIds:[]});
  const mixedResult=await applyCandidate(mixed,'mixed');
  assert.equal(mixedResult.value.ok,true,'a stale exact vessel change must recover without blocking the accompanying management user creation');
  assert.equal(mixedResult.value.payload.vessels.find(vessel=>vessel.id==='v1').position,'recovered-v1');
  assert.ok(mixedResult.value.payload.users.some(user=>user.id==='user-new'));
  assert.equal((await db.query("select count(*)::int as count from public.ship_dynamics_edit_locks where workspace_key='recovery-workspace'")).rows[0].count,0,'temporary recovery locks must be released after saving');

  await db.query("select public.claim_ship_dynamics_edit_lock('recovery-workspace','vessel:v2','other-v2','Other editor',75)");
  const disjointBase=await currentPayload();
  const disjoint=structuredClone(disjointBase);
  disjoint.vessels.find(vessel=>vessel.id==='v1').position='parallel-v1';
  const disjointResult=await applyCandidate(disjoint,'disjoint');
  assert.equal(disjointResult.value.ok,true,'a live lock on another vessel must not block this vessel recovery save');
  await release({sectionKey:'vessel:v2',leaseOwnerId:'other-v2'});

  await db.query("select public.claim_ship_dynamics_edit_lock('recovery-workspace','vessel:v1','other-v1','Other editor',75)");
  const conflictBase=await currentPayload();
  const conflict=structuredClone(conflictBase);
  conflict.vessels.find(vessel=>vessel.id==='v1').position='must-not-save';
  await assert.rejects(
    applyCandidate(conflict,'conflict'),
    error=>error instanceof recovery.CloudSaveRecoveryLockConflictError&&error.sectionKey==='vessel:v1'&&error.lockedByName==='Other editor',
    'a live same-vessel editor must block before the atomic write',
  );
  assert.notEqual((await currentPayload()).vessels.find(vessel=>vessel.id==='v1').position,'must-not-save');
  await release({sectionKey:'vessel:v1',leaseOwnerId:'other-v1'});

  const creationBase=await currentPayload();
  const creation=structuredClone(creationBase);
  creation.tasks.push({id:'draft-db',vesselId:'v1',title:'Recovered creation',status:'open'});
  const creationResult=await applyCandidate(
    creation,
    'creation',
    [{section_key:'task-create:v2:v1:draft-db',locked_by:'expired-creation-owner'}],
  );
  assert.equal(creationResult.value.ok,true,`an expired creation sentinel must be reclaimed by the same attempt key before the atomic create: ${JSON.stringify(creationResult.value)}`);
  assert.ok(creationResult.value.payload.tasks.some(task=>task.id==='draft-db'));
  assert.equal((await db.query("select count(*)::int as count from public.ship_dynamics_edit_locks where workspace_key='recovery-workspace'")).rows[0].count,0,'the recovered creation sentinel must be released after saving');
  console.log('Cloud save lock recovery database integration contracts passed.');
}finally{
  await server.close();
  await db.close();
}
