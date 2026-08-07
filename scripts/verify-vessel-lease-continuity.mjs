import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {VesselEditModal}=await server.ssrLoadModule('/src/EditModals.tsx');
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const data=createInitialData();
  const vessel=data.vessels.find(item=>item.isActive);
  const currentUser=data.users.find(user=>user.isActive&&user.role!=='vessel');
  assert.ok(vessel&&currentUser,'fixture needs an active vessel and shore-side user');

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

  const expiryStart=app.indexOf('return scheduleValidatedLeaseExpiry(');
  const expiryEnd=app.indexOf('\n  useEffect(()=>{',expiryStart);
  const expiry=app.slice(expiryStart,expiryEnd);
  assert.ok(expiry.includes("if(lock.sectionKey.startsWith('vessel:'))")&&expiry.includes('freezeVesselEditorForLock(lock'),'vessel lease expiry must preserve a frozen editor');
  assert.ok(expiry.includes('latestLock.validatedUntilMs>lock.validatedUntilMs'),'an expiry callback for an older validated deadline must not freeze a freshly renewed vessel lock');

  const saveStart=app.indexOf('const saveVesselEditorDraft=');
  const saveEnd=app.indexOf('\n  const closeBatchManaged',saveStart);
  assert.ok(app.slice(saveStart,saveEnd).includes('vesselLeaseIncidentRef.current'),'the parent save boundary must reject retrying or frozen vessel leases even if a button event is stale');
  assert.ok(app.includes('vesselLeaseIncidentForEditor')&&app.includes('leaseMode={vesselLeaseMode}')&&app.includes('leaseMessage={vesselLeaseIncidentForEditor?.message||\'\'}'),'the App render boundary must keep a matching incident mounted and pass its persistent state into the modal');

  const closeStart=app.indexOf('const closeVesselEditor=');
  const closeEnd=app.indexOf('\n  const saveCloudConfiguration',closeStart);
  const closeEditor=app.slice(closeStart,closeEnd);
  assert.ok(closeEditor.includes('ensureCloudDurableBeforeLeaseRelease(')&&closeEditor.includes('releaseCurrentEditLock('),'normal vessel cancel must retain the existing durability barrier followed by safe release');
  assert.ok(closeEditor.includes('frozenIncident')&&closeEditor.includes('clearVesselLeaseIncident('),'an explicitly discarded frozen draft must close without depending on an already-invalid lease');
  assert.ok(closeEditor.includes('vesselSaveLeaseOwners.current.has(frozenIncident.leaseOwnerId)&&!await ensureCloudDurableBeforeLeaseRelease(frozenIncident.sectionKey)'),'only a frozen vessel lease that actually entered AppData saving may wait on the durability barrier; unrelated saves must not trap an untouched local draft');
  assert.ok(closeEditor.includes("if(!confirm('協作鎖已失效"),'every close entry point for a frozen vessel draft must require explicit discard confirmation at the parent safety boundary');
  assert.ok(closeEditor.includes('const released=await releaseCurrentEditLock()'),'discarding a frozen draft must attempt bounded server release before falling back to TTL cleanup, so identity switching can safely continue');
  assert.ok(closeEditor.includes('releaseFailureIsAfterDurabilityBarrier')&&closeEditor.includes('伺服器協作鎖將由有效期自動清理'),'a release-RPC failure after the durability barrier must not make an explicitly cancelled vessel modal impossible to close');

  const resolveStart=app.indexOf('const resolveEditLockNotice=');
  const resolveEnd=app.indexOf('\n  useEffect(()=>{',resolveStart);
  const resolveNotice=app.slice(resolveStart,resolveEnd);
  assert.ok(resolveNotice.indexOf('closeVesselEditorRef.current(lock)')>=0&&resolveNotice.indexOf('closeVesselEditorRef.current(lock)')<resolveNotice.indexOf("if(lock.status==='blocked')"),'the global lock notice must route a matching frozen vessel draft through the same confirm and durability boundary instead of silently unmounting it');

  const blockedConfigObserverStart=resolveEnd;
  const blockedConfigObserverEnd=app.indexOf('\n  useEffect(()=>{',blockedConfigObserverStart+1);
  const blockedConfigObserver=app.slice(blockedConfigObserverStart,blockedConfigObserverEnd);
  assert.ok(blockedConfigObserver.includes("lock.status==='blocked'&&(lock.sectionKey.startsWith('task:')||isTaskCreationLockKey(lock.sectionKey))"),'the task read-only cloud-config observer must not treat a frozen blocked vessel lease as a task lock and silently close its preserved draft');

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
