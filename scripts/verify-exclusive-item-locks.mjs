import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server:{ middlewareMode:true }, appType:'custom' });
try {
  const lockKeys = await server.ssrLoadModule('/src/exclusiveItemEditLock.ts');
  const taskCreation = await server.ssrLoadModule('/src/taskCreationLock.ts');
  const sessions = await server.ssrLoadModule('/src/itemEditSession.ts');
  const lockCoordinator = await server.ssrLoadModule('/src/editLockCoordinator.ts');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');

  assert.equal(typeof lockCoordinator.classifyVesselLeaseRenewalFailure,'function','vessel renewal failures need an explicit transient-versus-expired decision');
  assert.equal(lockCoordinator.classifyVesselLeaseRenewalFailure(60_000,30_000),'retrying','a transient renewal failure inside the last confirmed lease window must remain retryable');
  assert.equal(lockCoordinator.classifyVesselLeaseRenewalFailure(60_000,60_000),'frozen','a vessel editor must freeze once the last confirmed lease window has ended');

  assert.equal(lockKeys.meetingEditLockKey('m-1'),'meeting:m-1');
  assert.equal(lockKeys.internalControlEditLockKey('ic-1'),'internal-control:ic-1');
  assert.equal(lockKeys.meetingCreationLockKey('draft-m-1'),'meeting-create:draft-m-1');
  assert.equal(lockKeys.internalControlCreationLockKey('batch-1'),'internal-control-create:batch-1');
  assert.equal(lockKeys.isExclusiveItemEditLockKey('meeting:m-1'),true);
  assert.equal(lockKeys.isExclusiveItemEditLockKey('internal-control:ic-1'),true);
  assert.equal(lockKeys.isExclusiveItemEditLockKey('meeting-create:draft-m-1'),true);
  assert.equal(lockKeys.isExclusiveItemEditLockKey('internal-control-create:batch-1'),true);
  assert.equal(lockKeys.isExclusiveItemEditLockKey('workspace-save'),false);

  const createA=taskCreation.taskCreationLockKey('v-1','draft-a');
  const createB=taskCreation.taskCreationLockKey('v-1','draft-b');
  assert.notEqual(createA,createB,'two independent drafts on one vessel must not share one creation lock');
  assert.equal(taskCreation.taskCreationLockMatchesVessel(createA,'v-1'),true);
  assert.equal(taskCreation.taskCreationLockMatchesVessel(createA,'v-2'),false);
  assert.equal(taskCreation.isTaskCreationLockKey(createA),true);

  const base=createInitialData();
  base.revision=4;
  const remote=structuredClone(base);
  remote.revision=5;
  remote.vessels[0].position.location='FRESH-REMOTE';
  const ready=sessions.resolveItemEditSession({
    live:structuredClone(base),
    confirmed:structuredClone(base),
    remote,
    select:snapshot=>snapshot.vessels[0],
    authorize:()=>true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  });
  assert.equal(ready.status,'ready');
  assert.equal(ready.entity.position.location,'FRESH-REMOTE','editor must open from the post-lock remote snapshot');

  const dirty=structuredClone(base);
  dirty.tasks.push({id:'unsaved-local'});
  assert.equal(sessions.resolveItemEditSession({
    live:dirty,
    confirmed:base,
    remote,
    select:snapshot=>snapshot.vessels[0],
    authorize:()=>true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }).status,'local-dirty','an item editor must not replace pending local work while refreshing after a lease');

  assert.equal(sessions.resolveItemEditSession({
    live:base,
    confirmed:base,
    remote:{...structuredClone(remote),revision:3},
    select:snapshot=>snapshot.vessels[0],
    authorize:()=>true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }).status,'remote-rollback','a post-lock refresh must reject a remote snapshot below the confirmed revision');

  assert.equal(sessions.resolveItemEditSession({
    live:base,
    confirmed:base,
    remote,
    select:()=>undefined,
    authorize:()=>true,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }).status,'missing');
  assert.equal(sessions.resolveItemEditSession({
    live:base,
    confirmed:base,
    remote,
    select:snapshot=>snapshot.vessels[0],
    authorize:()=>false,
    equals:(left,right)=>JSON.stringify(left)===JSON.stringify(right),
  }).status,'unauthorized','latest cloud authorization must be checked after acquiring the lease');

  const app=fs.readFileSync('src/App.tsx','utf8');
  const cloud=fs.readFileSync('src/cloud.ts','utf8');
  const meetings=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
  const internal=fs.readFileSync('src/InternalControlPage.tsx','utf8');
  assert.ok(cloud.includes('export async function renewEditLock')&&cloud.includes("supabase.rpc('renew_ship_dynamics_edit_lock'"),'cloud client must expose a non-creating renew RPC for heartbeats');
  const saveHeartbeat=app.slice(app.indexOf('const renewSaveTurn='),app.indexOf('const assertSaveTurnActive='));
  const itemHeartbeatStart=app.indexOf('const renewSingleItemLease=');
  const itemHeartbeat=app.slice(itemHeartbeatStart,app.indexOf('\n  useEffect(()=>{',itemHeartbeatStart));
  const batchHeartbeat=app.slice(app.indexOf("runCloudSaveQueueRpc('批量船舶鎖續期'",app.indexOf('const batchLockHeartbeat')),app.indexOf('const rejected=',app.indexOf('const batchLockHeartbeat')));
  for(const [source,label] of [[saveHeartbeat,'save queue'],[itemHeartbeat,'single item'],[batchHeartbeat,'batch vessel']]){
    assert.ok(source.includes('renewEditLock('),`${label} heartbeat must use non-creating renewal`);
    assert.ok(!source.includes('claimEditLock('),`${label} heartbeat must not recreate a released lease`);
  }
  assert.ok(itemHeartbeat.includes("runCloudSaveQueueRpc('單項協作鎖續期'")&&itemHeartbeat.includes('signal=>renewEditLock('),'single-item renewal must have a hard timeout and abort its underlying request');
  const currentItemRelease=app.slice(app.indexOf('const releaseCurrentEditLock='),app.indexOf('const closeEditorForLock='));
  assert.ok(currentItemRelease.includes("runCloudSaveQueueRpc('釋放多人協作鎖'")&&currentItemRelease.includes('signal=>releaseEditLock('),'single-item release must have a hard timeout and abort its underlying request');
  assert.ok(app.includes('meetingEditLockKey')&&app.includes('internalControlEditLockKey'),'App must authorize exact meeting and internal-control lock keys');
  assert.ok(app.includes('refreshAfterItemLease'),'App must refresh and reauthorize after a cloud lease is acquired');
  assert.ok(app.includes('refreshBatchAfterLeaseBundle'),'batch vessel editing must refresh and reauthorize after all vessel leases are acquired');
  assert.ok(app.includes('runTaskMutationWithLockBundle'),'batch complete/delete must acquire a task lock bundle and persist before release');
  const weeklyAttentionHandler=app.slice(app.indexOf('const toggleDashboardVesselAttention='),app.indexOf('const retryDashboardVesselAttention='));
  const manualAttentionHandler=app.slice(app.indexOf('const adjustDashboardVesselAttention='),app.indexOf('const savePhaseLabel:'));
  assert.ok(weeklyAttentionHandler.includes('vesselAttentionSaveQueue.current?.enqueue')&&!weeklyAttentionHandler.includes('mutateVesselWithLease'),'weekly attention must coalesce clicks before entering the atomic cloud-save lock pipeline');
  assert.ok(manualAttentionHandler.includes('mutateVesselWithLease'),'manual attention-level changes must keep the lock-refresh-save-release lifecycle');
  assert.match(app,/const mutationLeaseIsOwned=\(sectionKey:string\)=>\{\s*const lock=activeEditLockRef\.current;/,'immediate post-claim mutations must read the synchronous lock ref, not a stale React render');
  for(const [source,label] of [[meetings,'meeting'],[internal,'internal control']]){
    assert.ok(source.includes('claimItemLease')&&source.includes('requireItemLease')&&source.includes('releaseItemLease'),`${label} editor must own the complete item-lease lifecycle`);
    assert.ok(source.includes('activeItemLeaseKey'),`${label} editor must become read-only without its exact lease`);
  }
  assert.ok(meetings.includes("const sectionKey=wasCreating?meetingCreationLockKey(id):meetingEditLockKey(id)")&&meetings.includes('requireItemLease(sectionKey)')&&meetings.includes('meetingEditLockKey(meeting.id)'),'meeting creation/save/delete must require their exact creation or existing-item lease');
  assert.ok(internal.includes('internalControlEditLockKey(editing.id)'),'internal-control update and delete must require the exact case lease');

  console.log('Exclusive item lock and fresh-session contracts passed.');
} finally {
  await server.close();
}
