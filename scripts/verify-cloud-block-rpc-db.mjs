import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
try{
  await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
  const ownerActor={id:'guard-owner',name:'Owner',role:'owner',isActive:true,managedVesselIds:[]};
  const guardTarget={id:'guard-target',name:'Target',role:'operator',isActive:true,managedVesselIds:[]};
  const guardPayload={
    revision:1,updatedAt:'2026-08-04T12:00:00.000Z',
    settings:{rolePermissions:{owner:{}},nonOwnerPasswordResetVersion:1,sitePasswordHash:''},
    users:[ownerActor,guardTarget],vessels:[],tasks:[],internalControlCases:[],meetings:[],agendaReports:[],notifications:[],auditLogs:[],
  };
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['guard-workspace',JSON.stringify(guardPayload),1,'seed']);
  const ownerActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(guardPayload),ownerActor.id])).rows[0].value;
  const missingAuthorizationCas=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'guard-workspace',JSON.stringify([{kind:'entity',collection:'users',entityId:guardTarget.id,expected:guardTarget,value:{...guardTarget,name:'Changed'}}]),ownerActor.name,ownerActor.id,JSON.stringify(ownerActorGuard),null,'[]',
  ])).rows[0].value;
  assert.equal(missingAuthorizationCas.code,'authorization-conflict','authorization-domain mutations must require the full server CAS guard');
  const fullAuthorizationGuard=(await db.query('select public.ship_dynamics_authorization_guard($1::jsonb) as value',[JSON.stringify(guardPayload)])).rows[0].value;
  const guardedAuthorizationChange=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'guard-workspace',JSON.stringify([{kind:'entity',collection:'users',entityId:guardTarget.id,expected:guardTarget,value:{...guardTarget,name:'Changed'}}]),ownerActor.name,ownerActor.id,JSON.stringify(ownerActorGuard),JSON.stringify(fullAuthorizationGuard),'[]',
  ])).rows[0].value;
  assert.equal(guardedAuthorizationChange.ok,true,'a current authorization-domain CAS guard may proceed');

  const managementVessel={id:'management-v1',name:'Original',shortName:'ORG',fullName:'ORIGINAL VESSEL',shipType:'tanker',fleetCategory:'tanker fleet',isActive:true,assignedUserIds:[],delegateManagers:[],position:'A'};
  const managementPayload={...structuredClone(guardPayload),vessels:[managementVessel]};
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['management-workspace',JSON.stringify(managementPayload),1,'seed']);
  const managementActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(managementPayload),ownerActor.id])).rows[0].value;
  const managementChange=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'management-workspace',JSON.stringify([{kind:'entity',collection:'vessels',entityId:managementVessel.id,expected:managementVessel,value:{...managementVessel,name:'Renamed'}}]),ownerActor.name,ownerActor.id,JSON.stringify(managementActorGuard),null,'[]',
  ])).rows[0].value;
  assert.equal(managementChange.ok,true,'vessel roster metadata remains outside collaborative edit locks');
  let managementMetadataPayload=managementChange.payload;
  for(const [field,value] of [['shortName','MGT'],['fullName','MANAGEMENT VESSEL'],['fleetCategory','bulk fleet']]){
    const expectedVessel=managementMetadataPayload.vessels[0];
    const metadataActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(managementMetadataPayload),ownerActor.id])).rows[0].value;
    const metadataChange=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
      'management-workspace',JSON.stringify([{kind:'entity',collection:'vessels',entityId:expectedVessel.id,expected:expectedVessel,value:{...expectedVessel,[field]:value}}]),ownerActor.name,ownerActor.id,JSON.stringify(metadataActorGuard),null,'[]',
    ])).rows[0].value;
    assert.equal(metadataChange.ok,true,`Management metadata field ${field} must remain lock-free under server CAS`);
    managementMetadataPayload=metadataChange.payload;
  }
  const renamedVessel=managementMetadataPayload.vessels[0];
  const renamedActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(managementMetadataPayload),ownerActor.id])).rows[0].value;
  const unlockedBusinessChange=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'management-workspace',JSON.stringify([{kind:'entity',collection:'vessels',entityId:renamedVessel.id,expected:renamedVessel,value:{...renamedVessel,position:'B'}}]),ownerActor.name,ownerActor.id,JSON.stringify(renamedActorGuard),null,'[]',
  ])).rows[0].value;
  assert.equal(unlockedBusinessChange.code,'lock-conflict','vessel business fields still require the exact collaborative lease');

  const creationVessel={id:'creation-v1',name:'Creation V1',isActive:true,assignedUserIds:[],delegateManagers:[]};
  const creationPayload={...structuredClone(guardPayload),vessels:[creationVessel]};
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['creation-workspace',JSON.stringify(creationPayload),1,'seed']);
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('creation-workspace','meeting-create:new-meeting','meeting-create-owner','Owner',now()+interval '60 seconds')");
  const creationActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(creationPayload),ownerActor.id])).rows[0].value;
  const newMeeting={id:'new-meeting',subject:'New meeting',vessels:['creation-v1']};
  const meetingChildTask={id:'meeting-child-task',vesselId:'creation-v1',sourceMeetingId:newMeeting.id,status:'open'};
  const meetingCreation=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'creation-workspace',JSON.stringify([
      {kind:'entity',collection:'tasks',entityId:meetingChildTask.id,expected:null,value:meetingChildTask},
      {kind:'entity',collection:'meetings',entityId:newMeeting.id,expected:null,value:newMeeting},
    ]),ownerActor.name,ownerActor.id,JSON.stringify(creationActorGuard),null,JSON.stringify([{section_key:'meeting-create:new-meeting',locked_by:'meeting-create-owner'}]),
  ])).rows[0].value;
  assert.equal(meetingCreation.ok,true,'a meeting creation lease covers its same-block new child task');

  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('creation-workspace','internal-control-create:new-batch','case-create-owner','Owner',now()+interval '60 seconds')");
  const afterMeetingGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(meetingCreation.payload),ownerActor.id])).rows[0].value;
  const newCase={id:'new-case',vesselId:'creation-v1',linkedTaskId:'case-child-task',status:'open'};
  const caseChildTask={id:'case-child-task',vesselId:'creation-v1',internalControlCaseId:newCase.id,status:'open'};
  const caseCreation=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'creation-workspace',JSON.stringify([
      {kind:'entity',collection:'tasks',entityId:caseChildTask.id,expected:null,value:caseChildTask},
      {kind:'entity',collection:'internalControlCases',entityId:newCase.id,expected:null,value:newCase},
    ]),ownerActor.name,ownerActor.id,JSON.stringify(afterMeetingGuard),null,JSON.stringify([{section_key:'internal-control-create:new-batch',locked_by:'case-create-owner'}]),
  ])).rows[0].value;
  assert.equal(caseCreation.ok,true,'an internal-control batch creation lease covers its same-block new child task');

  const permissions={viewAllVessels:false,editBusinessContent:true,createTasks:true,closeTasks:true,deleteTasks:false,manageMeetings:false,exportReports:true,enterManagement:false,manageUsers:false,manageVessels:false,viewAuditLogs:false,manageRolePermissions:false,manageSystemSettings:false};
  const actor={id:'actor-1',name:'Operator',role:'operator',isActive:true,managedVesselIds:['v1','v2']};
  const payload={
    revision:7,updatedAt:'2026-08-04T12:00:00.000Z',
    settings:{rolePermissions:{operator:permissions},nonOwnerPasswordResetVersion:2,sitePasswordHash:''},
    users:[actor,{id:'other',name:'Other',role:'operator',isActive:true,managedVesselIds:[]}],
    vessels:[
      {id:'v1',name:'V1',isActive:true,assignedUserIds:[],delegateManagers:[],position:'A'},
      {id:'v2',name:'V2',isActive:true,assignedUserIds:[],delegateManagers:[],position:'B'},
    ],
    tasks:[],internalControlCases:[],meetings:[],agendaReports:[],notifications:[],auditLogs:[],
  };
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['workspace',JSON.stringify(payload),7,'seed']);
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('workspace','vessel:v1','lease-v1','Operator',now()+interval '60 seconds'),('workspace','vessel:v2','lease-v2','Operator',now()+interval '60 seconds')");

  const actorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value',[JSON.stringify(payload),'actor-1'])).rows[0].value;
  assert.ok(actorGuard,'actor guard helper must produce a guard for an active actor');
  const v1Expected=payload.vessels[0];
  const v1Value={...v1Expected,position:'A-updated'};
  const v1Ops=[{kind:'entity',collection:'vessels',entityId:'v1',expected:v1Expected,value:v1Value}];

  const missingActor=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(v1Ops),'Missing actor','missing-actor',null,null,JSON.stringify([{section_key:'vessel:v1',locked_by:'lease-v1'}]),
  ])).rows[0].value;
  assert.equal(missingActor.code,'authorization-conflict','missing actors and null actor guards must fail closed');

  const applied=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(v1Ops),'Operator','actor-1',JSON.stringify(actorGuard),null,JSON.stringify([{section_key:'vessel:v1',locked_by:'lease-v1'}]),
  ])).rows[0].value;
  assert.equal(applied.ok,true);
  assert.equal(applied.revision,8);
  assert.equal(applied.payload.vessels.find(v=>v.id==='v1').position,'A-updated');
  assert.equal(applied.payload.vessels.find(v=>v.id==='v2').position,'B','unrelated blocks must remain untouched');
  assert.equal(applied.payload.revision,8,'payload revision must be server-owned');
  assert.ok(applied.payload.updatedAt,'payload updatedAt must be server-owned');
  assert.equal(Number((await db.query("select count(*) as count from public.ship_dynamics_app_revisions where workspace_key='workspace' and revision=8")).rows[0].count),1,'history trigger must record the RPC revision');

  const currentAfterV1=applied.payload;
  const guardAfterV1=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value',[JSON.stringify(currentAfterV1),'actor-1'])).rows[0].value;
  const v2Expected=currentAfterV1.vessels.find(v=>v.id==='v2');
  const v2Ops=[{kind:'entity',collection:'vessels',entityId:'v2',expected:v2Expected,value:{...v2Expected,position:'B-updated'}}];
  const disjoint=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(v2Ops),'Operator','actor-1',JSON.stringify(guardAfterV1),null,JSON.stringify([{section_key:'vessel:v2',locked_by:'lease-v2'}]),
  ])).rows[0].value;
  assert.equal(disjoint.ok,true,'an unrelated block update must not conflict on global revision');
  assert.equal(disjoint.revision,9);

  const stale=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(v1Ops),'Operator','actor-1',JSON.stringify(guardAfterV1),null,JSON.stringify([{section_key:'vessel:v1',locked_by:'lease-v1'}]),
  ])).rows[0].value;
  assert.equal(stale.ok,false);
  assert.equal(stale.code,'block-conflict');
  assert.equal(stale.conflict_key,'vessels:v1');

  await db.query("update public.ship_dynamics_app_state set payload=jsonb_set(payload,'{users,0,isActive}','false'::jsonb) where workspace_key='workspace'");
  const revoked=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(v2Ops),'Operator','actor-1',JSON.stringify(guardAfterV1),null,JSON.stringify([{section_key:'vessel:v2',locked_by:'lease-v2'}]),
  ])).rows[0].value;
  assert.equal(revoked.code,'authorization-conflict','server transaction must revalidate the latest actor authorization guard');

  await db.query("update public.ship_dynamics_app_state set payload=jsonb_set(payload,'{users,0,isActive}','true'::jsonb) where workspace_key='workspace'");
  const livePayload=(await db.query("select payload from public.ship_dynamics_app_state where workspace_key='workspace'")).rows[0].payload;
  const fullGuard=(await db.query('select public.ship_dynamics_authorization_guard($1::jsonb) as value',[JSON.stringify(livePayload)])).rows[0].value;
  const liveActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value',[JSON.stringify(livePayload),'actor-1'])).rows[0].value;
  await db.query("update public.ship_dynamics_app_state set payload=jsonb_set(payload,'{users,1,name}',to_jsonb('Changed concurrently'::text)) where workspace_key='workspace'");
  const guarded=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace','[]','Operator','actor-1',JSON.stringify(liveActorGuard),JSON.stringify(fullGuard),'[]',
  ])).rows[0].value;
  assert.equal(guarded.code,'authorization-conflict','authorization-domain writes must be protected against concurrent authorization changes');

  await db.query("update public.ship_dynamics_edit_locks set expires_at=now()-interval '1 second' where workspace_key='workspace' and section_key='vessel:v2'");
  const latestPayload=(await db.query("select payload from public.ship_dynamics_app_state where workspace_key='workspace'")).rows[0].payload;
  const latestActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2) as value',[JSON.stringify(latestPayload),'actor-1'])).rows[0].value;
  const currentV2=latestPayload.vessels.find(v=>v.id==='v2');
  const expiredLock=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify([{kind:'entity',collection:'vessels',entityId:'v2',expected:currentV2,value:{...currentV2,position:'must-not-save'}}]),'Operator','actor-1',JSON.stringify(latestActorGuard),null,JSON.stringify([{section_key:'vessel:v2',locked_by:'lease-v2'}]),
  ])).rows[0].value;
  assert.equal(expiredLock.code,'lock-conflict','expired or fenced item locks must reject the transaction');

  const createBase=(await db.query("select payload from public.ship_dynamics_app_state where workspace_key='workspace'")).rows[0].payload;
  const createGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(createBase),'actor-1'])).rows[0].value;
  const createdTask={id:'created-with-absent-cas',vesselId:'v1',status:'open'};
  const createOps=[
    {kind:'entity',collection:'tasks',entityId:createdTask.id,expected:null,value:createdTask},
    {kind:'order',collection:'tasks',expectedIds:[],valueIds:[createdTask.id]},
  ];
  const locklessCreation=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(createOps),'Operator','actor-1',JSON.stringify(createGuard),null,'[]',
  ])).rows[0].value;
  assert.equal(locklessCreation.code,'lock-conflict','standalone entity creation must not bypass its creation lease');
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('workspace','task-create:v2:v1:created-with-absent-cas','lease-task-create','Operator',now()+interval '60 seconds')");
  const created=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(createOps),'Operator','actor-1',JSON.stringify(createGuard),null,JSON.stringify([{section_key:'task-create:v2:v1:created-with-absent-cas',locked_by:'lease-task-create'}]),
  ])).rows[0].value;
  assert.equal(created.ok,true,'a standalone task creation may proceed with its valid creation lease');

  const createdPayload=created.payload;
  const createdGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(createdPayload),'actor-1'])).rows[0].value;
  const createdExpected=createdPayload.tasks.find(task=>task.id===createdTask.id);
  const taskUpdateOps=[{kind:'entity',collection:'tasks',entityId:createdTask.id,expected:createdExpected,value:{...createdExpected,status:'closed'}}];
  const unrelatedLock=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(taskUpdateOps),'Operator','actor-1',JSON.stringify(createdGuard),null,JSON.stringify([{section_key:'vessel:v1',locked_by:'lease-v1'}]),
  ])).rows[0].value;
  assert.equal(unrelatedLock.code,'lock-conflict','an unrelated valid lock must not fence an existing task update');
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('workspace','task:created-with-absent-cas','lease-task','Operator',now()+interval '60 seconds')");
  const exactTaskLock=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(taskUpdateOps),'Operator','actor-1',JSON.stringify(createdGuard),null,JSON.stringify([{section_key:'task:created-with-absent-cas',locked_by:'lease-task'}]),
  ])).rows[0].value;
  assert.equal(exactTaskLock.ok,true,'the exact task lock must fence the task update');

  const internalTransitionBase=exactTaskLock.payload;
  const internalTransitionGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(internalTransitionBase),'actor-1'])).rows[0].value;
  const internalTransitionTask=internalTransitionBase.tasks.find(task=>task.id===createdTask.id);
  const internalTransitionVessel=internalTransitionBase.vessels.find(vessel=>vessel.id==='v1');
  const internalTransitionCase={id:`internal-${createdTask.id}`,vesselId:'v1',linkedTaskId:createdTask.id,status:'open'};
  const internalTransitionOps=[
    {kind:'entity',collection:'tasks',entityId:createdTask.id,expected:internalTransitionTask,value:{...internalTransitionTask,isInternalControl:true,internalControlCaseId:internalTransitionCase.id}},
    {kind:'entity',collection:'internalControlCases',entityId:internalTransitionCase.id,expected:null,value:internalTransitionCase},
    {kind:'order',collection:'internalControlCases',expectedIds:[],valueIds:[internalTransitionCase.id]},
    {kind:'entity',collection:'vessels',entityId:'v1',expected:internalTransitionVessel,value:{...internalTransitionVessel,weeklyAttention:['內部管控']}},
  ];
  const missingInternalCreationGuard=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(internalTransitionOps),'Operator','actor-1',JSON.stringify(internalTransitionGuard),null,JSON.stringify([
      {section_key:'task:created-with-absent-cas',locked_by:'lease-task'},
      {section_key:'vessel:v1',locked_by:'lease-v1'},
    ]),
  ])).rows[0].value;
  assert.equal(missingInternalCreationGuard.code,'lock-conflict','an existing task transition must not create an internal-control case without its creation guard');
  assert.equal(missingInternalCreationGuard.conflict_key,`internalControlCases:${internalTransitionCase.id}`);
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('workspace','internal-control-create:other-task','lease-unrelated-internal-create','Operator',now()+interval '60 seconds')");
  const unrelatedInternalCreationGuard=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(internalTransitionOps),'Operator','actor-1',JSON.stringify(internalTransitionGuard),null,JSON.stringify([
      {section_key:'task:created-with-absent-cas',locked_by:'lease-task'},
      {section_key:'vessel:v1',locked_by:'lease-v1'},
      {section_key:'internal-control-create:other-task',locked_by:'lease-unrelated-internal-create'},
    ]),
  ])).rows[0].value;
  assert.equal(unrelatedInternalCreationGuard.code,'lock-conflict','an existing task transition must reject another task\'s internal-control creation guard');
  assert.equal(unrelatedInternalCreationGuard.conflict_key,`internalControlCases:${internalTransitionCase.id}`);
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('workspace','internal-control-create:created-with-absent-cas','lease-internal-create','Operator',now()+interval '60 seconds')");
  const guardedInternalTransition=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify(internalTransitionOps),'Operator','actor-1',JSON.stringify(internalTransitionGuard),null,JSON.stringify([
      {section_key:'task:created-with-absent-cas',locked_by:'lease-task'},
      {section_key:'vessel:v1',locked_by:'lease-v1'},
      {section_key:'internal-control-create:created-with-absent-cas',locked_by:'lease-internal-create'},
    ]),
  ])).rows[0].value;
  assert.equal(guardedInternalTransition.ok,true,'the task direct guard, affected vessel guard, and internal-control creation guard must allow the atomic transition');

  await db.query("update public.ship_dynamics_app_state set payload=jsonb_set(payload,'{tasks}',(payload->'tasks') || jsonb_build_array(jsonb_build_object('id','second-task','vesselId','v1','status','open'))) where workspace_key='workspace'");
  const reorderBase=(await db.query("select payload from public.ship_dynamics_app_state where workspace_key='workspace'")).rows[0].payload;
  const reorderGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(reorderBase),'actor-1'])).rows[0].value;
  const duplicateOrder=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'workspace',JSON.stringify([{kind:'order',collection:'tasks',expectedIds:['created-with-absent-cas','second-task'],valueIds:['created-with-absent-cas','created-with-absent-cas']}]),'Operator','actor-1',JSON.stringify(reorderGuard),null,'[]',
  ])).rows[0].value;
  assert.equal(duplicateOrder.code,'invalid-order-result','duplicate order ids must fail closed without dropping an entity');

  const longClaim=(await db.query("select public.claim_ship_dynamics_edit_lock('workspace','ttl-cap','owner','Owner',999999) as value")).rows[0].value;
  assert.equal(longClaim.ok,true);
  const seconds=(new Date(longClaim.expires_at).getTime()-Date.now())/1000;
  assert.ok(seconds<=121&&seconds>=29,'server must clamp edit-lock TTL to a bounded range');

  const raceClaim=(await db.query("select public.claim_ship_dynamics_edit_lock('renew-race-workspace','meeting:race','race-owner','Race owner',75) as value")).rows[0].value;
  assert.equal(raceClaim.ok,true);
  await db.query("select public.release_ship_dynamics_edit_lock('renew-race-workspace','meeting:race','race-owner')");
  const lateRenew=(await db.query("select public.renew_ship_dynamics_edit_lock('renew-race-workspace','meeting:race','race-owner',75) as value")).rows[0].value;
  assert.equal(lateRenew.ok,false,'a heartbeat arriving after release must not recreate the lease');
  assert.equal(Number((await db.query("select count(*) as count from public.ship_dynamics_edit_locks where workspace_key='renew-race-workspace' and section_key='meeting:race'")).rows[0].count),0,'release followed by late renew must leave no lease row');

  const relationTask={id:'relation-task',vesselId:'v1',sourceMeetingId:'relation-meeting',internalControlCaseId:'relation-case',status:'open'};
  const relationMeeting={id:'relation-meeting',subject:'Original meeting',vessels:['v1']};
  const relationCase={id:'relation-case',vesselId:'v1',linkedTaskId:'relation-task',status:'open'};
  const relationPayload={...structuredClone(payload),revision:1,tasks:[relationTask],meetings:[relationMeeting],internalControlCases:[relationCase]};
  relationPayload.settings.rolePermissions.operator.manageMeetings=true;
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['relation-workspace',JSON.stringify(relationPayload),1,'seed']);
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('relation-workspace','task:relation-task','task-owner','Task editor',now()+interval '60 seconds'),('relation-workspace','meeting:relation-meeting','meeting-owner','Meeting editor',now()+interval '60 seconds')");
  const relationActorGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(relationPayload),'actor-1'])).rows[0].value;
  const relationOps=[
    {kind:'entity',collection:'tasks',entityId:relationTask.id,expected:relationTask,value:{...relationTask,status:'closed'}},
    {kind:'entity',collection:'meetings',entityId:relationMeeting.id,expected:relationMeeting,value:{...relationMeeting,subject:'Must not bypass exact meeting lock'}},
  ];
  const relatedLockBypass=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'relation-workspace',JSON.stringify(relationOps),'Operator','actor-1',JSON.stringify(relationActorGuard),null,JSON.stringify([{section_key:'task:relation-task',locked_by:'task-owner'}]),
  ])).rows[0].value;
  assert.equal(relatedLockBypass.code,'lock-conflict','a related task guard must not bypass another owner\'s live exact meeting lock');
  assert.equal(relatedLockBypass.conflict_key,'meetings:relation-meeting');

  const relationWithExactMeeting=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'relation-workspace',JSON.stringify(relationOps),'Operator','actor-1',JSON.stringify(relationActorGuard),null,JSON.stringify([
      {section_key:'task:relation-task',locked_by:'task-owner'},
      {section_key:'meeting:relation-meeting',locked_by:'meeting-owner'},
    ]),
  ])).rows[0].value;
  assert.equal(relationWithExactMeeting.ok,true,'a related mutation may proceed when every live exact lock is supplied');

  await db.query("update public.ship_dynamics_edit_locks set expires_at=now()-interval '1 second' where workspace_key='relation-workspace' and section_key='meeting:relation-meeting'");
  const afterExactRelation=relationWithExactMeeting.payload;
  const afterExactGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(afterExactRelation),'actor-1'])).rows[0].value;
  const afterExactTask=afterExactRelation.tasks.find(item=>item.id==='relation-task');
  const afterExactMeeting=afterExactRelation.meetings.find(item=>item.id==='relation-meeting');
  const expiredRelatedLock=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'relation-workspace',JSON.stringify([
      {kind:'entity',collection:'tasks',entityId:afterExactTask.id,expected:afterExactTask,value:{...afterExactTask,status:'reopened'}},
      {kind:'entity',collection:'meetings',entityId:afterExactMeeting.id,expected:afterExactMeeting,value:{...afterExactMeeting,subject:'Expired exact lock no longer blocks'}},
    ]),'Operator','actor-1',JSON.stringify(afterExactGuard),null,JSON.stringify([{section_key:'task:relation-task',locked_by:'task-owner'}]),
  ])).rows[0].value;
  assert.equal(expiredRelatedLock.code,'lock-conflict','an expired meeting lease must not be replaced by a related task lease');
  assert.equal(expiredRelatedLock.conflict_key,'meetings:relation-meeting');
  const reclaimedMeeting=(await db.query("select public.claim_ship_dynamics_edit_lock('relation-workspace','meeting:relation-meeting','meeting-owner-2','Meeting editor',75) as value")).rows[0].value;
  assert.equal(reclaimedMeeting.ok,true);
  const afterRenewedLocks=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'relation-workspace',JSON.stringify([
      {kind:'entity',collection:'tasks',entityId:afterExactTask.id,expected:afterExactTask,value:{...afterExactTask,status:'reopened'}},
      {kind:'entity',collection:'meetings',entityId:afterExactMeeting.id,expected:afterExactMeeting,value:{...afterExactMeeting,subject:'Reclaimed exact lock'}},
    ]),'Operator','actor-1',JSON.stringify(afterExactGuard),null,JSON.stringify([
      {section_key:'task:relation-task',locked_by:'task-owner'},
      {section_key:'meeting:relation-meeting',locked_by:'meeting-owner-2'},
    ]),
  ])).rows[0].value;
  assert.equal(afterRenewedLocks.ok,true,'reclaiming every direct lease permits the relation mutation');

  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('relation-workspace','internal-control:relation-case','case-owner','Case editor',now()+interval '60 seconds')");
  const beforeCaseConflict=afterRenewedLocks.payload;
  const beforeCaseGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(beforeCaseConflict),'actor-1'])).rows[0].value;
  const caseTask=beforeCaseConflict.tasks.find(item=>item.id==='relation-task');
  const caseEntity=beforeCaseConflict.internalControlCases.find(item=>item.id==='relation-case');
  const relatedCaseBypass=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'relation-workspace',JSON.stringify([
      {kind:'entity',collection:'tasks',entityId:caseTask.id,expected:caseTask,value:{...caseTask,status:'closed-again'}},
      {kind:'entity',collection:'internalControlCases',entityId:caseEntity.id,expected:caseEntity,value:{...caseEntity,status:'closed'}},
    ]),'Operator','actor-1',JSON.stringify(beforeCaseGuard),null,JSON.stringify([{section_key:'task:relation-task',locked_by:'task-owner'}]),
  ])).rows[0].value;
  assert.equal(relatedCaseBypass.code,'lock-conflict','a related task guard must not bypass another owner\'s live exact internal-control lock');
  assert.equal(relatedCaseBypass.conflict_key,'internalControlCases:relation-case');

  const aliasTask={id:'alias-task',vesselId:'v1',sourceMeetingId:'alias-meeting',status:'open'};
  const aliasMeeting={id:'alias-meeting',subject:'Alias',vessels:['v1']};
  const aliasPayload={...structuredClone(relationPayload),revision:1,tasks:[aliasTask],meetings:[aliasMeeting],internalControlCases:[]};
  await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values ($1,$2::jsonb,$3,$4)',['alias-workspace',JSON.stringify(aliasPayload),1,'seed']);
  await db.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values ('alias-workspace','meeting:alias-meeting','alias-meeting-owner','Operator',now()+interval '60 seconds')");
  const aliasGuard=(await db.query('select public.ship_dynamics_actor_guard($1::jsonb,$2::text) as value',[JSON.stringify(aliasPayload),'actor-1'])).rows[0].value;
  const relatedAliasOnly=(await db.query('select public.apply_ship_dynamics_block_patch($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',[
    'alias-workspace',JSON.stringify([{kind:'entity',collection:'tasks',entityId:aliasTask.id,expected:aliasTask,value:{...aliasTask,status:'closed'}}]),'Operator','actor-1',JSON.stringify(aliasGuard),null,JSON.stringify([{section_key:'meeting:alias-meeting',locked_by:'alias-meeting-owner'}]),
  ])).rows[0].value;
  assert.equal(relatedAliasOnly.code,'lock-conflict','a related meeting lease must never substitute for the exact existing task lease');
  assert.equal(relatedAliasOnly.conflict_key,'tasks:alias-task');

  console.log('Cloud block RPC database contracts passed.');
}finally{
  await db.close();
}
