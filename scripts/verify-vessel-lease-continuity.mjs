import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {VesselEditModal}=await server.ssrLoadModule('/src/EditModals.tsx');
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const {classifyExpiredLeaseRelease,classifyLeaseRenewalAfterAwait,classifyMutationLeaseFailure,classifyVesselLeaseIncidentClose,shouldRenderProductionCloudSafetyGate}=await server.ssrLoadModule('/src/editLockCoordinator.ts');
  const data=createInitialData();
  const vessel=data.vessels.find(item=>item.isActive);
  const currentUser=data.users.find(user=>user.isActive&&user.role!=='vessel');
  assert.ok(vessel&&currentUser,'fixture needs an active vessel and shore-side user');
  assert.equal(classifyMutationLeaseFailure('vessel:v-1'),'freeze-vessel-draft','a save that discovers an expired vessel lease must freeze the mounted draft');
  assert.equal(classifyMutationLeaseFailure('task:t-1'),'close-editor','non-vessel mutation failure behavior must remain unchanged');
  assert.equal(classifyExpiredLeaseRelease('vessel:v-1',true),'defer-for-durability','validated expiry must not release a vessel lease while its accepted save remains cloud-unconfirmed');
  assert.equal(classifyExpiredLeaseRelease('vessel:v-1',false),'release','an expired vessel lease without an accepted save may be released');
  assert.equal(classifyExpiredLeaseRelease('task:t-1',true),'release','the vessel save barrier must not change task expiry behavior');
  assert.equal(classifyVesselLeaseIncidentClose('retrying'),'confirm-discard','closing a component-only draft during transient renewal uncertainty must be an explicit discard');
  assert.equal(classifyVesselLeaseIncidentClose('frozen'),'confirm-discard','closing a frozen component-only draft must be an explicit discard');
  assert.equal(classifyVesselLeaseIncidentClose('editable'),'normal-close','ordinary editable cancel must keep its existing close behavior');
  const postAwaitConfigDrift={sectionKey:'vessel:v-1',renewalTargetIsCurrent:true,cloudConfigStillCurrent:false,durableCreationHandoff:false};
  assert.equal(classifyLeaseRenewalAfterAwait(postAwaitConfigDrift),'freeze-vessel-draft','configuration removed while vessel renewal awaits must freeze the same mounted draft before processing success');
  assert.equal(classifyLeaseRenewalAfterAwait({...postAwaitConfigDrift,renewalTargetIsCurrent:false}),'stale-result','a stale renewal response must not freeze a newer owner or generation');
  assert.equal(classifyLeaseRenewalAfterAwait({...postAwaitConfigDrift,sectionKey:'task:t-1'}),'close-editor','non-vessel configuration drift must retain its existing close behavior');
  assert.equal(classifyLeaseRenewalAfterAwait({...postAwaitConfigDrift,sectionKey:'task-create:v2:v-1:t-1',durableCreationHandoff:true}),'continue','a durable task-creation handoff must retain its existing old-workspace completion behavior');
  assert.equal(classifyLeaseRenewalAfterAwait({...postAwaitConfigDrift,cloudConfigStillCurrent:true}),'continue','a current renewal with unchanged configuration must follow the normal success path');
  const frozenGateIncident={sectionKey:'vessel:v-1',ownerUserId:'user-1',authorizationEpoch:'epoch-1',mode:'frozen'};
  const cloudGateContext={productionCloudUnavailable:true,editingVesselId:'v-1',currentUserId:'user-1',authorizationEpoch:'epoch-1',activeVesselIds:['v-1'],incident:frozenGateIncident};
  assert.equal(shouldRenderProductionCloudSafetyGate(cloudGateContext),false,'removing cloud configuration must not unmount a matching frozen vessel draft before explicit discard');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,incident:{...frozenGateIncident,mode:'retrying'}}),false,'a matching retrying vessel draft must remain mounted until the configuration observer publishes its frozen state');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,incident:null}),true,'production without cloud configuration must stay fail closed when no vessel draft needs preservation');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,editingVesselId:'v-2'}),true,'an incident for another vessel must not bypass the production cloud safety gate');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,currentUserId:'user-2'}),true,'a stale owner incident must not bypass the production cloud safety gate');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,authorizationEpoch:'epoch-2'}),true,'a stale authorization incident must not bypass the production cloud safety gate');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,activeVesselIds:[]}),true,'an incident for a no-longer-authorized vessel must not bypass the production cloud safety gate');
  assert.equal(shouldRenderProductionCloudSafetyGate({...cloudGateContext,productionCloudUnavailable:false}),false,'an available cloud configuration must not render the unavailable-cloud safety gate');

  const retrying=renderToStaticMarkup(createElement(VesselEditModal,{
    vessel,
    data,
    currentUser,
    close:()=>{},
    onSave:()=>true,
    addTask:()=>{},
    editTask:()=>{},
    leaseMode:'retrying',
    leaseMessage:'TEST-RETRYING-LEASE',
  }));
  assert.ok(retrying.includes('TEST-RETRYING-LEASE'),'a transient renewal warning must remain visible inside the vessel editor');
  assert.ok(retrying.includes('正在重新確認編輯鎖…'),'saving must be disabled while the vessel lease is temporarily unconfirmed');
  assert.match(retrying,/<fieldset[^>]*class="vessel-editor-fields"[^>]*>/,'transient renewal failure must keep the vessel draft mounted');
  assert.doesNotMatch(retrying,/<fieldset[^>]*disabled[^>]*class="vessel-editor-fields"/,'transient renewal failure must keep draft fields editable');
  assert.ok(retrying.includes('class="btn ghost">取消並關閉</button>'),'normal cancel must remain available while renewal is retrying');

  const frozen=renderToStaticMarkup(createElement(VesselEditModal,{
    vessel,
    data,
    currentUser,
    close:()=>{},
    onSave:()=>true,
    addTask:()=>{},
    editTask:()=>{},
    leaseMode:'frozen',
    leaseMessage:'TEST-FROZEN-LEASE',
  }));
  assert.ok(frozen.includes('TEST-FROZEN-LEASE'),'a confirmed lease loss must remain visible inside the preserved vessel editor');
  assert.match(frozen,/<fieldset[^>]*disabled=""[^>]*class="vessel-editor-fields"[^>]*>/,'confirmed lease loss must preserve the draft in a read-only fieldset');
  assert.ok(frozen.includes('放棄並關閉'),'the user must be able to explicitly discard and close a frozen draft');
  assert.ok(frozen.includes('編輯鎖已失效，不能保存'),'a frozen draft must never expose an enabled save action');

  const modalSource=fs.readFileSync('src/EditModals.tsx','utf8');
  assert.ok(modalSource.includes('},[vessel?.id]);'),'same-vessel Realtime snapshots must not recreate and overwrite an owned, retrying, or frozen local draft');

  const app=fs.readFileSync('src/App.tsx','utf8');
  const heartbeatStart=app.indexOf('const renewSingleItemLease=');
  const heartbeatEnd=app.indexOf('\n  useEffect(()=>{',heartbeatStart);
  assert.ok(heartbeatStart>=0&&heartbeatEnd>heartbeatStart,'the single-item heartbeat needs an explicit retryable renewal operation');
  const heartbeat=app.slice(heartbeatStart,heartbeatEnd);
  assert.ok(heartbeat.includes('classifyVesselLeaseRenewalFailure(lock.validatedUntilMs)'),'transient errors must be classified against the last confirmed vessel lease deadline');
  assert.ok(heartbeat.includes("publishVesselLeaseIncident(lock,'retrying'"),'a transient vessel renewal error must preserve the mounted editor and publish a retrying state');
  assert.ok(heartbeat.includes('window.setTimeout(renewSingleItemLease,5_000)'),'a transient vessel renewal error must retry before the conservative lease deadline');
  assert.ok(heartbeat.includes('freezeVesselEditorForLock(lock'),'authoritative renewal loss must freeze the vessel draft instead of unmounting it');
  assert.ok(heartbeat.includes('activeEditLockRef.current=renewedLock'),'a successful renewal must update the synchronous lock ref before an already-due old expiry callback can run');
  assert.ok(heartbeat.includes("window.addEventListener('focus',renewVesselLeaseOnResume)")&&heartbeat.includes("window.addEventListener('online',renewVesselLeaseOnResume)")&&heartbeat.includes("document.addEventListener('visibilitychange',renewVesselLeaseOnResume)"),'a vessel lease must be rechecked as soon as a sleeping or offline browser resumes');
  const heartbeatConfigMismatchStart=heartbeat.indexOf('if(!sameCloudConfig(getSupabaseConfig(),leaseRecord.config))');
  const heartbeatConfigMismatchEnd=heartbeat.indexOf('const renewed=',heartbeatConfigMismatchStart);
  const heartbeatConfigMismatch=heartbeat.slice(heartbeatConfigMismatchStart,heartbeatConfigMismatchEnd);
  assert.ok(heartbeatConfigMismatch.includes("lock.sectionKey.startsWith('vessel:')")&&heartbeatConfigMismatch.includes('freezeVesselEditorForLock(lock'),'renewal-side cloud configuration mismatch must freeze and retain a vessel draft rather than call the generic close path');
  const renewedAwaitEnd=heartbeat.indexOf('const renewed=await');
  const postAwaitConfigStart=heartbeat.indexOf('const renewalAfterAwaitDisposition=',renewedAwaitEnd);
  const postAwaitConfigEnd=heartbeat.indexOf('if(!renewalStillCurrent())',postAwaitConfigStart);
  const postAwaitConfig=heartbeat.slice(postAwaitConfigStart,postAwaitConfigEnd);
  const clearRenewalIncident=heartbeat.indexOf('clearVesselLeaseIncident(',postAwaitConfigStart);
  const postAwaitFreezeStart=postAwaitConfig.indexOf("if(renewalAfterAwaitDisposition==='freeze-vessel-draft')");
  const postAwaitCloseStart=postAwaitConfig.indexOf("if(renewalAfterAwaitDisposition==='close-editor')",postAwaitFreezeStart);
  const postAwaitFreezeBranch=postAwaitConfig.slice(postAwaitFreezeStart,postAwaitCloseStart);
  const postAwaitFreezeCall=postAwaitFreezeBranch.indexOf('freezeVesselEditorForLock(lock');
  assert.ok(renewedAwaitEnd>=0&&postAwaitConfigStart>renewedAwaitEnd&&postAwaitConfig.includes('classifyLeaseRenewalAfterAwait({')&&postAwaitConfig.includes('renewalTargetIsCurrent:renewalStillCurrent()')&&postAwaitConfig.includes('cloudConfigStillCurrent:sameCloudConfig(getSupabaseConfig(),leaseRecord.config)')&&postAwaitConfig.includes('durableCreationHandoff:Boolean(matchingCreationHandoff)')&&postAwaitFreezeStart>=0&&postAwaitCloseStart>postAwaitFreezeStart&&postAwaitFreezeCall>=0&&postAwaitFreezeBranch.indexOf('return;',postAwaitFreezeCall)>postAwaitFreezeCall&&clearRenewalIncident>postAwaitConfigStart,'a configuration change during the renewal await must freeze the exact vessel draft and terminate that callback before stale cleanup or successful renewal can clear its incident');
  assert.ok(postAwaitConfig.includes("renewalAfterAwaitDisposition==='close-editor'")&&postAwaitConfig.includes('closeEditorForLock(lock,true)'),'post-await configuration drift must preserve non-vessel close semantics');
  const invalidatedRenewalStart=heartbeat.indexOf('if(!renewalStillCurrent())');
  const invalidatedRenewalEnd=heartbeat.indexOf('if(!renewed.ok)',invalidatedRenewalStart);
  const invalidatedRenewal=heartbeat.slice(invalidatedRenewalStart,invalidatedRenewalEnd);
  assert.ok(invalidatedRenewal.includes('classifyExpiredLeaseRelease(lock.sectionKey,vesselSaveLeaseOwners.current.has(lock.leaseOwnerId))')&&invalidatedRenewal.includes("renewalCleanupDisposition==='defer-for-durability'"),'a successful renewal response invalidated by expiry must not release a vessel lease while an accepted save is still crossing the cloud durability barrier');

  const expiryStart=app.indexOf('return scheduleValidatedLeaseExpiry(');
  const expiryEnd=app.indexOf('\n  useEffect(()=>{',expiryStart);
  const expiry=app.slice(expiryStart,expiryEnd);
  assert.ok(expiry.includes("if(lock.sectionKey.startsWith('vessel:'))")&&expiry.includes('freezeVesselEditorForLock(lock'),'vessel lease expiry must preserve a frozen editor');
  assert.ok(expiry.includes('latestLock.validatedUntilMs>lock.validatedUntilMs'),'an expiry callback for an older validated deadline must not freeze a freshly renewed vessel lock');
  assert.ok(expiry.includes("classifyExpiredLeaseRelease(lock.sectionKey,vesselSaveLeaseOwners.current.has(lock.leaseOwnerId))")&&expiry.includes("expiredReleaseDisposition==='release'&&leaseRecord"),'validated expiry must defer server lease release until an accepted vessel save crosses the cloud durability barrier');

  const mutationLeaseStart=app.indexOf('const requireMutationLease=');
  const mutationLeaseEnd=app.indexOf('\n  const requireLogin',mutationLeaseStart);
  const mutationLease=app.slice(mutationLeaseStart,mutationLeaseEnd);
  assert.ok(mutationLease.includes("classifyMutationLeaseFailure(sectionKey)==='freeze-vessel-draft'")&&mutationLease.includes('freezeVesselEditorForLock(lock'),'a stale save event that discovers vessel lease expiry must freeze the exact draft instead of clearing editingVesselId');

  const saveStart=app.indexOf('const saveVesselEditorDraft=');
  const saveEnd=app.indexOf('\n  const closeBatchManaged',saveStart);
  assert.ok(app.slice(saveStart,saveEnd).includes('vesselLeaseIncidentRef.current'),'the parent save boundary must reject retrying or frozen vessel leases even if a button event is stale');
  assert.ok(app.includes('vesselLeaseIncidentForEditor')&&app.includes('leaseMode={vesselLeaseMode}')&&app.includes('leaseMessage={vesselLeaseIncidentForEditor?.message||\'\'}'),'the App render boundary must keep a matching incident mounted and pass its persistent state into the modal');

  const closeStart=app.indexOf('const closeVesselEditor=');
  const closeEnd=app.indexOf('\n  const saveCloudConfiguration',closeStart);
  const closeEditor=app.slice(closeStart,closeEnd);
  assert.ok(closeEditor.includes('ensureCloudDurableBeforeLeaseRelease(')&&closeEditor.includes('releaseCurrentEditLock('),'normal vessel cancel must retain the existing durability barrier followed by safe release');
  assert.ok(closeEditor.includes('leaseIncident')&&closeEditor.includes('clearVesselLeaseIncident('),'an explicitly discarded retrying or frozen draft must close without depending on an already-invalid lease');
  assert.ok(closeEditor.includes('vesselSaveLeaseOwners.current.has(leaseIncident.leaseOwnerId)&&!await ensureCloudDurableBeforeLeaseRelease(leaseIncident.sectionKey)'),'only a vessel lease that actually entered AppData saving may wait on the durability barrier; an untouched component draft must not be trapped');
  assert.ok(closeEditor.includes("classifyVesselLeaseIncidentClose(leaseIncident.mode)==='confirm-discard'")&&closeEditor.includes('if(!confirm('),'every parent close entry point for a retrying or frozen vessel draft must require one explicit discard confirmation');
  assert.ok(closeEditor.includes('const released=await releaseCurrentEditLock()'),'discarding a frozen draft must attempt bounded server release before falling back to TTL cleanup, so identity switching can safely continue');
  assert.ok(closeEditor.includes('releaseFailureIsAfterDurabilityBarrier')&&closeEditor.includes('伺服器協作鎖將由有效期自動清理'),'a release-RPC failure after the durability barrier must not make an explicitly cancelled vessel modal impossible to close');

  const navigateStart=app.indexOf('const navigateToTab = async');
  const navigateEnd=app.indexOf('\n  const openVesselDetail',navigateStart);
  const navigate=app.slice(navigateStart,navigateEnd);
  assert.ok(navigate.includes("classifyVesselLeaseIncidentClose(incident.mode)==='confirm-discard'")&&navigate.indexOf('await closeVesselEditorRef.current(')>=0&&navigate.indexOf('await closeVesselEditorRef.current(')<navigate.indexOf('if(lock)'),'tab navigation must resolve a retrying or frozen vessel incident before checking the active lock, so an already-cleared expiry handle cannot bypass confirmation or durability');

  const resolveStart=app.indexOf('const resolveEditLockNotice=');
  const resolveEnd=app.indexOf('\n  useEffect(()=>{',resolveStart);
  const resolveNotice=app.slice(resolveStart,resolveEnd);
  assert.ok(resolveNotice.indexOf('closeVesselEditorRef.current(lock)')>=0&&resolveNotice.indexOf('closeVesselEditorRef.current(lock)')<resolveNotice.indexOf("if(lock.status==='blocked')"),'the global lock notice must route a matching frozen vessel draft through the same confirm and durability boundary instead of silently unmounting it');

  const blockedConfigObserverStart=resolveEnd;
  const blockedConfigObserverEnd=app.indexOf('\n  useEffect(()=>{',blockedConfigObserverStart+1);
  const blockedConfigObserver=app.slice(blockedConfigObserverStart,blockedConfigObserverEnd);
  assert.ok(blockedConfigObserver.includes("lock.status==='blocked'&&(lock.sectionKey.startsWith('task:')||isTaskCreationLockKey(lock.sectionKey))"),'the task read-only cloud-config observer must not treat a frozen blocked vessel lease as a task lock and silently close its preserved draft');
  assert.ok(blockedConfigObserver.includes("if(lock.sectionKey.startsWith('vessel:'))")&&blockedConfigObserver.includes('freezeVesselEditorForLock(lock'),'a storage-event cloud configuration mismatch must publish a frozen vessel incident before the render gate can unmount the draft');

  const productionGateStart=app.indexOf('const productionCloudUnavailable=');
  const productionGateEnd=app.indexOf('\n  if (!siteUnlocked',productionGateStart);
  const productionGate=app.slice(productionGateStart,productionGateEnd);
  assert.ok(productionGate.includes('shouldRenderProductionCloudSafetyGate({')&&productionGate.includes('if(productionCloudSafetyGateBlocked||'),'the composed production cloud gate must keep the existing modal tree mounted only for the exact preserved vessel incident');

  const unloadStart=app.indexOf('const shouldWarnBeforeLeaving=');
  const unloadEnd=app.indexOf('\n  useEffect(()=>{',unloadStart);
  const unload=app.slice(unloadStart,unloadEnd);
  assert.ok(unload.includes('vesselLeaseIncidentRef.current')&&unload.includes("activeEditLockRef.current?.sectionKey.startsWith('vessel:')"),'browser unload must warn while a Quick Update component draft or vessel lease incident is still open');

  const cloudConfigStart=app.indexOf('const saveCloudConfiguration = async');
  const cloudConfigEnd=app.indexOf('\n  const leaveCurrentIdentity',cloudConfigStart);
  assert.ok(app.slice(cloudConfigStart,cloudConfigEnd).includes('if(vesselLeaseIncidentRef.current)'),'cloud configuration reload must be blocked while a preserved vessel draft remains after the active lease handle was cleared');
  const leaveStart=app.indexOf('const leaveCurrentIdentity = async');
  const leaveEnd=app.indexOf('\n  const readOnlyTask=',leaveStart);
  const leaveIdentity=app.slice(leaveStart,leaveEnd);
  assert.ok(leaveIdentity.indexOf('await closeVesselEditorRef.current(activeEditLockRef.current)')>=0&&leaveIdentity.indexOf('await closeVesselEditorRef.current(activeEditLockRef.current)')<leaveIdentity.indexOf("setEditingVesselId('')"),'identity switch or logout must confirm and durably resolve a preserved vessel draft before clearing it');

  console.log('Vessel lease continuity contracts passed.');
}finally{
  await server.close();
}
