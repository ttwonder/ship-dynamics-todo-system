import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const auth=await server.ssrLoadModule('/src/cloudAuthorization.ts');
  const rebase=await server.ssrLoadModule('/src/cloudRebase.ts');
  const patch=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const base=createInitialData();
  const owner=base.users[0];
  owner.role='owner';
  owner.isActive=true;

  const local=structuredClone(base);
  local.vessels[0].position={...(local.vessels[0].position||{}),location:'local-position'};
  const unrelatedRemote=structuredClone(base);
  const unrelatedUser=unrelatedRemote.users.find(user=>user.id!==owner.id);
  assert.ok(unrelatedUser,'seed must contain another user');
  unrelatedUser.name=`${unrelatedUser.name} remote`;
  unrelatedRemote.revision=base.revision+1;

  const merged=rebase.rebaseDisjointAppData(base,local,unrelatedRemote,'2026-08-04T12:00:00.000Z',owner.id);
  assert.equal(merged.vessels[0].position.location,'local-position','unaffected actor business work must survive an unrelated account update');
  assert.equal(merged.users.find(user=>user.id===unrelatedUser.id).name,unrelatedUser.name,'unrelated remote account update must be retained');

  const legacyStorage=structuredClone(base);
  const legacyStoredActor=legacyStorage.users.find(user=>user.id===owner.id);
  delete legacyStoredActor.managedVesselIds;
  legacyStorage.settings.rolePermissions[owner.role]={viewAllVessels:true};
  const storageGuard=auth.actorStorageAuthorizationGuard(base,legacyStorage,owner.id);
  assert.equal(Object.hasOwn(storageGuard.actor,'managedVesselIds'),false,'storage guard must preserve the raw legacy actor shape for SQL equality');
  assert.deepEqual(storageGuard.effectivePermissions,{viewAllVessels:true},'storage guard must preserve the raw role-permission row for SQL equality');
  assert.ok(storageGuard.visibleVesselIds.length>0,'storage guard must still calculate effective scope from normalized data');

  const revokedRemote=structuredClone(base);
  revokedRemote.users.find(user=>user.id===owner.id).isActive=false;
  assert.throws(
    ()=>rebase.rebaseDisjointAppData(base,local,revokedRemote,'2026-08-04T12:00:01.000Z',owner.id),
    error=>error instanceof rebase.CloudRebaseConflictError&&error.conflicts.includes('authorization-domain'),
    'deactivating the actor must block reapplying business work',
  );

  const operator=base.users.find(user=>user.id!==owner.id);
  assert.ok(operator,'seed must contain a second user');
  operator.role='operator';
  operator.isActive=true;
  const actorBase=structuredClone(base);
  actorBase.vessels[0].assignedUserIds=[...new Set([...(actorBase.vessels[0].assignedUserIds||[]),operator.id])];
  actorBase.settings.rolePermissions.operator.editBusinessContent=true;
  const actorLocal=structuredClone(actorBase);
  actorLocal.vessels[0].position={...(actorLocal.vessels[0].position||{}),location:'operator edit'};
  const actorRevoked=structuredClone(actorBase);
  actorRevoked.settings.rolePermissions.operator.editBusinessContent=false;
  assert.throws(
    ()=>rebase.rebaseDisjointAppData(actorBase,actorLocal,actorRevoked,'2026-08-04T12:00:02.000Z',operator.id),
    error=>error instanceof rebase.CloudRebaseConflictError&&error.conflicts.includes('authorization-domain'),
    'revoking the actor role permission must block reapplication',
  );

  const actorAssignmentRevoked=structuredClone(actorBase);
  actorAssignmentRevoked.vessels[0].assignedUserIds=actorAssignmentRevoked.vessels[0].assignedUserIds.filter(id=>id!==operator.id);
  operator.managedVesselIds=[];
  assert.throws(
    ()=>rebase.rebaseDisjointAppData(actorBase,actorLocal,actorAssignmentRevoked,'2026-08-04T12:00:03.000Z',operator.id),
    error=>error instanceof rebase.CloudRebaseConflictError&&error.conflicts.includes('authorization-domain'),
    'removing the actor vessel scope must block reapplication',
  );

  const remote=structuredClone(actorBase);
  const next=structuredClone(remote);
  next.vessels[0].position={...(next.vessels[0].position||{}),location:'authorized patch'};
  const ops=patch.buildCloudBlockPatch(remote,next);
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(remote,ops,operator.id));
  assert.equal(auth.cloudBlockPatchTouchesAuthorizationDomain(ops),false);
  const guard=auth.authorizationDomainGuard(remote);
  assert.deepEqual(guard.users,remote.users);
  assert.ok(Array.isArray(guard.vesselAuthorization)&&guard.sensitiveSettings.rolePermissions,'full authorization writes require a server CAS guard');

  const permissionRevoked=structuredClone(remote);
  permissionRevoked.settings.rolePermissions.operator.editBusinessContent=false;
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(permissionRevoked,ops,operator.id),auth.CloudPatchAuthorizationError);

  const vesselManagerBase=structuredClone(remote);
  const vesselManager=vesselManagerBase.users.find(user=>user.id===operator.id);
  vesselManager.role='admin';
  vesselManagerBase.settings.rolePermissions.admin={...vesselManagerBase.settings.rolePermissions.admin,manageVessels:true,editBusinessContent:false};
  for(const [field,value] of [['shortName','AUTH-SHORT'],['fullName','AUTH FULL NAME'],['fleetCategory','bulk fleet']]){
    const metadataNext=structuredClone(vesselManagerBase);
    metadataNext.vessels[0][field]=value;
    assert.doesNotThrow(
      ()=>auth.assertActorAuthorizedForCloudBlockPatch(vesselManagerBase,patch.buildCloudBlockPatch(vesselManagerBase,metadataNext),vesselManager.id),
      `manageVessels without editBusinessContent must authorize Management metadata field ${field}`,
    );
  }

  const meetingNext=structuredClone(remote);
  meetingNext.meetings.push({id:'meeting-auth-test',subject:'x',vessels:[remote.vessels[0].id]});
  const meetingOps=patch.buildCloudBlockPatch(remote,meetingNext);
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(remote,meetingOps,operator.id),auth.CloudPatchAuthorizationError,'operator without manageMeetings cannot create meetings');
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(remote,meetingOps,owner.id));

  const meetingLifecycleBase=structuredClone(remote);
  meetingLifecycleBase.settings.rolePermissions.operator={...meetingLifecycleBase.settings.rolePermissions.operator,manageMeetings:true,closeTasks:false};
  meetingLifecycleBase.meetings.push({id:'meeting-lifecycle-auth',subject:'未指定船舶會議',vessels:[],taskItems:[{id:'item-1',description:'決議待辦',categories:[],isClosed:false}],updatedAt:'2026-08-06T01:00:00.000Z'});
  const ordinaryMeetingEdit=structuredClone(meetingLifecycleBase);
  ordinaryMeetingEdit.meetings.find(item=>item.id==='meeting-lifecycle-auth').subject='一般內容修改';
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(meetingLifecycleBase,patch.buildCloudBlockPatch(meetingLifecycleBase,ordinaryMeetingEdit),operator.id),'ordinary meeting edits still require manageMeetings only');
  const meetingLifecycleNext=structuredClone(meetingLifecycleBase);
  const lifecycleItem=meetingLifecycleNext.meetings.find(item=>item.id==='meeting-lifecycle-auth').taskItems[0];
  lifecycleItem.isClosed=true;
  lifecycleItem.closedDate='2026-08-06';
  lifecycleItem.closedBy=operator.id;
  const meetingLifecycleOps=patch.buildCloudBlockPatch(meetingLifecycleBase,meetingLifecycleNext);
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(meetingLifecycleBase,meetingLifecycleOps,operator.id),auth.CloudPatchAuthorizationError,'meeting item lifecycle transitions require closeTasks in addition to manageMeetings');
  const removedClosedMeetingItem=structuredClone(meetingLifecycleNext);
  removedClosedMeetingItem.meetings.find(item=>item.id==='meeting-lifecycle-auth').taskItems=[];
  const removedClosedMeetingItemOps=patch.buildCloudBlockPatch(meetingLifecycleNext,removedClosedMeetingItem);
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(meetingLifecycleNext,removedClosedMeetingItemOps,operator.id),auth.CloudPatchAuthorizationError,'removing a closed meeting item must not bypass closeTasks authorization');
  const meetingLifecycleAuthorized=structuredClone(meetingLifecycleBase);
  meetingLifecycleAuthorized.settings.rolePermissions.operator.closeTasks=true;
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(meetingLifecycleAuthorized,meetingLifecycleOps,operator.id),'meeting managers with closeTasks may persist an unlinked item transition');

  const vesselUser=structuredClone(remote.users.find(user=>user.id!==owner.id));
  vesselUser.id='vessel-user';
  vesselUser.role='vessel';
  vesselUser.isActive=true;
  vesselUser.managedVesselIds=[remote.vessels[0].id];
  const vesselCreateBase=structuredClone(remote);
  vesselCreateBase.users.push(vesselUser);
  vesselCreateBase.settings.rolePermissions.vessel={...vesselCreateBase.settings.rolePermissions.vessel,createTasks:true};
  const vesselCreateNext=structuredClone(vesselCreateBase);
  vesselCreateNext.tasks.push({id:'vessel-created-task',vesselId:remote.vessels[0].id,status:'open'});
  const vesselCreateOps=patch.buildCloudBlockPatch(vesselCreateBase,vesselCreateNext);
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(vesselCreateBase,vesselCreateOps,vesselUser.id),'task order side effect must not require editBusinessContent when createTasks already authorizes the entity creation');

  for(const collection of ['notifications','auditLogs']){
    const sideEffectOrderBase=structuredClone(remote);
    sideEffectOrderBase[collection]=[
      {id:`${collection}-older`,userId:owner.id,at:'2026-08-04T11:00:00.000Z'},
      {id:`${collection}-newer`,userId:owner.id,at:'2026-08-04T12:00:00.000Z'},
    ];
    const sideEffectOrderNext=structuredClone(sideEffectOrderBase);
    sideEffectOrderNext[collection].reverse();
    assert.deepEqual(
      patch.buildCloudBlockPatch(sideEffectOrderBase,sideEffectOrderNext),
      [],
      `pure ${collection} presentation ordering must not create an unaccompanied cloud write`,
    );
  }

  const selfRevoked=structuredClone(remote);
  selfRevoked.users.find(user=>user.id===operator.id).isActive=false;
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(selfRevoked,ops,operator.id),auth.CloudPatchAuthorizationError,'inactive users cannot apply any block patch');

  const selfPasswordNext=structuredClone(remote);
  const selfAccount=selfPasswordNext.users.find(user=>user.id===operator.id);
  selfAccount.passwordHash='new-self-password-hash';
  selfAccount.updatedAt='2026-08-04T12:00:04.000Z';
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(remote,patch.buildCloudBlockPatch(remote,selfPasswordNext),operator.id),'an active account may change only its own password fields without manageUsers');

  const adminBase=structuredClone(remote);
  const adminActor=adminBase.users.find(user=>user.id===operator.id);
  adminActor.role='admin';
  adminBase.settings.rolePermissions.admin={...adminBase.settings.rolePermissions.admin,manageUsers:true};
  const ownerAccount=adminBase.users.find(user=>user.id===owner.id);
  ownerAccount.role='owner';
  const ownerDemoted=structuredClone(adminBase);
  ownerDemoted.users.find(user=>user.id===owner.id).role='operator';
  assert.throws(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(adminBase,patch.buildCloudBlockPatch(adminBase,ownerDemoted),adminActor.id),
    error=>error instanceof auth.CloudPatchAuthorizationError&&error.reason==='owner-account-is-owner-only',
    'a non-owner administrator must not demote an existing owner even when the replacement role is non-owner',
  );

  const authNext=structuredClone(remote);
  authNext.users.find(user=>user.id!==operator.id).isActive=false;
  assert.equal(auth.cloudBlockPatchTouchesAuthorizationDomain(ops),false,'ordinary vessel operational patches must not request full authorization-domain fencing');
  assert.equal(auth.cloudBlockPatchTouchesAuthorizationDomain(patch.buildCloudBlockPatch(remote,authNext)),true,'user changes must request strict authorization-domain fencing');

  const normalizedLegacy=structuredClone(remote);
  const legacyOperationalNext=structuredClone(normalizedLegacy);
  const rawLegacy=structuredClone(normalizedLegacy);
  delete rawLegacy.vessels[0].delegateManagers;
  legacyOperationalNext.vessels[0].position={...(legacyOperationalNext.vessels[0].position||{}),location:'legacy-safe-edit'};
  assert.equal(auth.appDataAuthorizationDomainChanged(normalizedLegacy,legacyOperationalNext),false,'normalized legacy defaults must not turn an operational edit into an authorization-domain change');
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForAppDataChange(normalizedLegacy,legacyOperationalNext,operator.id),'raw CAS defaults must not participate in authorization permission classification');
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(normalizedLegacy,patch.buildCloudBlockPatch(normalizedLegacy,legacyOperationalNext,rawLegacy),operator.id),auth.CloudPatchAuthorizationError,'probe must prove raw expected values would incorrectly require vessel-management permission');
  assert.equal(auth.appDataAuthorizationDomainChanged(remote,authNext),true,'real user changes must still require full authorization-domain fencing');

  const sideEffectBase=structuredClone(remote);
  const ownedTask=remote.tasks.find(task=>task.vesselId===remote.vessels[0].id)||remote.tasks[0];
  assert.ok(ownedTask,'seed must contain a task in the operator vessel scope');
  sideEffectBase.notifications=[
    {id:'notice-existing',userId:operator.id,title:'既有通知',message:'既有',createdAt:'2026-08-04T11:00:00.000Z'},
  ];
  const primaryNoticeNext=structuredClone(sideEffectBase);
  primaryNoticeNext.tasks.find(item=>item.id===ownedTask.id).status='primary-with-notice';
  primaryNoticeNext.notifications.unshift({id:'notice-added',userId:operator.id,title:'新通知',message:'新',createdAt:'2026-08-04T12:00:00.000Z'});
  const primaryNoticeOps=patch.buildCloudBlockPatch(sideEffectBase,primaryNoticeNext);
  assert.ok(primaryNoticeOps.some(operation=>operation.kind==='order'&&operation.collection==='notifications'),'real notification membership changes must retain their order operation');
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(sideEffectBase,primaryNoticeOps,operator.id),'derived order suppression must not bypass ordinary primary authorization');

  const stampedAuditRaceBase=structuredClone(remote);
  const stampedAuditRaceTask=stampedAuditRaceBase.tasks.find(task=>task.id===ownedTask.id);
  const stampedAuditRaceClient=structuredClone(stampedAuditRaceBase);
  stampedAuditRaceClient.tasks.find(task=>task.id===ownedTask.id).status='audit-stamp-race-saved';
  const unstampedAudit={
    id:'audit-stamp-race',at:'2026-08-07T01:20:00.000Z',actorId:operator.id,actorName:operator.name,actorRole:operator.role,
    action:'更新事項',entityType:'task',entityId:stampedAuditRaceTask.id,detail:'保存事項變更',
  };
  stampedAuditRaceClient.auditLogs.unshift(unstampedAudit);
  const stampedAuditRaceFirstOps=patch.buildCloudBlockPatch(stampedAuditRaceBase,stampedAuditRaceClient);
  assert.ok(
    stampedAuditRaceFirstOps.some(operation=>operation.kind==='entity'&&operation.collection==='tasks'&&operation.entityId===stampedAuditRaceTask.id),
    'the first legitimate save must include the primary task entity operation',
  );
  assert.ok(
    stampedAuditRaceFirstOps.some(operation=>operation.kind==='entity'&&operation.collection==='auditLogs'&&operation.entityId===unstampedAudit.id),
    'the first legitimate save must include its accompanying audit entity operation',
  );
  assert.doesNotThrow(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(stampedAuditRaceBase,stampedAuditRaceFirstOps,operator.id),
    'the first task plus audit save must remain an authorized primary business mutation',
  );
  const stampedAuditRaceServer=structuredClone(stampedAuditRaceClient);
  stampedAuditRaceServer.auditLogs[0]={...stampedAuditRaceServer.auditLogs[0],ipAddress:'203.0.113.42',ipCountryCode:'TW'};
  const rebasedStampedAuditRace=rebase.rebaseDisjointAppData(
    stampedAuditRaceBase,
    stampedAuditRaceClient,
    stampedAuditRaceServer,
    '2026-08-07T01:20:01.000Z',
    operator.id,
  );
  assert.deepEqual(
    rebasedStampedAuditRace.auditLogs[0],
    stampedAuditRaceServer.auditLogs[0],
    'three-way rebase must accept the trusted server-enriched copy of the same newly appended audit',
  );
  const tamperedRebaseAudit=structuredClone(stampedAuditRaceServer);
  tamperedRebaseAudit.auditLogs[0].detail='tampered during rebase';
  assert.throws(
    ()=>rebase.rebaseDisjointAppData(stampedAuditRaceBase,stampedAuditRaceClient,tamperedRebaseAudit,'2026-08-07T01:20:02.000Z',operator.id),
    error=>error instanceof rebase.CloudRebaseConflictError&&error.conflicts.includes('auditLogs:audit-stamp-race'),
    'server request-context enrichment must not hide a conflicting immutable audit business value',
  );
  assert.deepEqual(
    patch.buildCloudBlockPatch(stampedAuditRaceServer,stampedAuditRaceClient),
    [],
    'a queued duplicate snapshot must not turn server-stamped audit context into an unaccompanied audit-only write',
  );
  const tamperedStampedAudit=structuredClone(stampedAuditRaceServer);
  tamperedStampedAudit.auditLogs[0].detail='tampered audit detail';
  const tamperedStampedAuditOps=patch.buildCloudBlockPatch(stampedAuditRaceServer,tamperedStampedAudit);
  assert.throws(
    ()=>auth.assertActorAuthorizedForCloudBlockPatch(stampedAuditRaceServer,tamperedStampedAuditOps,operator.id),
    error=>error instanceof auth.CloudPatchAuthorizationError&&error.reason==='unaccompanied-auditLogs',
    'ignoring server-owned request context must not authorize edits to immutable audit business fields',
  );

  const dismissalBase=structuredClone(remote);
  dismissalBase.taskDismissals=[];
  const dismissalNext=structuredClone(dismissalBase);
  dismissalNext.taskDismissals=[{
    id:`work-dismissal:${operator.id}:task:${ownedTask.id}`,
    userId:operator.id,
    itemKind:'task',
    itemId:ownedTask.id,
    dismissedAt:'2026-08-06T04:05:00.000Z',
    dismissedBy:operator.id,
  }];
  const dismissalOps=patch.buildCloudBlockPatch(dismissalBase,dismissalNext);
  assert.ok(dismissalOps.some(operation=>operation.kind==='entity'&&operation.collection==='taskDismissals'),'personal dismissal must persist as an actor-owned entity');
  assert.equal(dismissalOps.some(operation=>operation.kind==='order'&&operation.collection==='taskDismissals'),false,'personal dismissal ordering is derived and must not create a rejected cloud order operation');
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(dismissalBase,dismissalOps,operator.id),'actor-owned visible dismissal must pass cloud authorization');

  const reassignedUser=remote.users.find(user=>user.id!==owner.id&&user.id!==operator.id);
  assert.ok(reassignedUser,'seed must contain a third user for cross-user reassignment');
  reassignedUser.role='operator';
  reassignedUser.isActive=true;
  reassignedUser.managedVesselIds=[];
  const reassignmentBase=structuredClone(remote);
  const reassignedBaseTask=reassignmentBase.tasks.find(task=>task.id===ownedTask.id);
  reassignedBaseTask.ownerUserIds=(reassignedBaseTask.ownerUserIds||[]).filter(id=>id!==reassignedUser.id);
  reassignmentBase.taskDismissals=[{
    id:`work-dismissal:${reassignedUser.id}:task:${ownedTask.id}`,
    userId:reassignedUser.id,itemKind:'task',itemId:ownedTask.id,
    dismissedAt:'2026-08-05T01:00:00.000Z',dismissedBy:reassignedUser.id,
  }];
  const unauthorizedReset=structuredClone(reassignmentBase);
  unauthorizedReset.taskDismissals=[];
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(reassignmentBase,patch.buildCloudBlockPatch(reassignmentBase,unauthorizedReset),operator.id),auth.CloudPatchAuthorizationError,'one actor must not delete another user dismissal without an exact new assignment');
  const reassignmentNext=structuredClone(reassignmentBase);
  reassignmentNext.tasks.find(task=>task.id===ownedTask.id).ownerUserIds.push(reassignedUser.id);
  reassignmentNext.taskDismissals=[];
  const reassignmentOps=patch.buildCloudBlockPatch(reassignmentBase,reassignmentNext);
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(reassignmentBase,reassignmentOps,operator.id),'an authorized task patch may clear exactly the dismissal of a user newly entering that task work-center scope');

  const dailyBase=structuredClone(remote);
  dailyBase.settings.rolePermissions.operator.exportReports=true;
  dailyBase.settings.rolePermissions.operator.viewAllVessels=true;
  const dailyReport={
    id:'daily-morning-2026-08-06',title:'2026/08/06 早會內容',vesselIds:dailyBase.vessels.filter(v=>v.isActive).map(v=>v.id),
    createdBy:owner.id,createdAt:'2026-08-06T01:00:00.000Z',taskCount:0,kind:'daily-morning',businessDate:'2026-08-06',source:'manual',updatedAt:'2026-08-06T01:00:00.000Z',
    snapshot:{capturedAt:'2026-08-06T01:00:00.000Z',vessels:structuredClone(dailyBase.vessels.filter(v=>v.isActive)),tasks:[],meetings:[]},
  };
  const dailyNext=structuredClone(dailyBase);
  dailyNext.agendaReports.unshift(dailyReport);
  const dailyOps=patch.buildCloudBlockPatch(dailyBase,dailyNext);
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(dailyBase,dailyOps,operator.id),auth.CloudPatchAuthorizationError,'exportReports alone must not authorize an official daily-morning snapshot');
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(dailyBase,dailyOps,owner.id),'Owner may save a valid manual daily-morning snapshot');
  const leakingDaily=structuredClone(dailyNext);
  leakingDaily.agendaReports[0].snapshot.tasks=[{id:'hidden-internal',isInternalControl:true,vesselId:dailyBase.vessels[0].id}];
  leakingDaily.agendaReports[0].taskCount=1;
  assert.throws(()=>auth.assertActorAuthorizedForCloudBlockPatch(dailyBase,patch.buildCloudBlockPatch(dailyBase,leakingDaily),owner.id),auth.CloudPatchAuthorizationError,'daily-morning snapshots must never persist internal-control tasks');
  const adHocNext=structuredClone(dailyBase);
  adHocNext.agendaReports.unshift({id:'ad-hoc-report',title:'一般報表',vesselIds:[dailyBase.vessels[0].id],createdBy:operator.id,createdAt:'2026-08-06T01:00:00.000Z',taskCount:0,kind:'ad-hoc',source:'manual'});
  assert.doesNotThrow(()=>auth.assertActorAuthorizedForCloudBlockPatch(dailyBase,patch.buildCloudBlockPatch(dailyBase,adHocNext),operator.id),'ordinary report exports must retain their configured permission path');

  console.log('Actor-scoped authorization revalidation contracts passed.');
}finally{
  await server.close();
}
