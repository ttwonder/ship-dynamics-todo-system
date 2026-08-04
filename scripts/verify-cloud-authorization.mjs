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

  console.log('Actor-scoped authorization revalidation contracts passed.');
}finally{
  await server.close();
}
