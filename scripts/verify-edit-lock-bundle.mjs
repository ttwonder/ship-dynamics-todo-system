import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { acquireEditLockBundle } = await server.ssrLoadModule('/src/editLockBundle.ts');
  const { createLeaseReleaseState, pendingTrackedLeases, registerTrackedLease, releaseTrackedLeases } = await server.ssrLoadModule('/src/leaseReleaseTracker.ts');
  const requests = [
    { sectionKey: 'vessel:v1', label: 'V1', leaseOwnerId: 'lease-1' },
    { sectionKey: 'vessel:v2', label: 'V2', leaseOwnerId: 'lease-2' },
    { sectionKey: 'vessel:v3', label: 'V3', leaseOwnerId: 'lease-3' },
  ];

  const claimed = [];
  const released = [];
  const success = await acquireEditLockBundle(requests, async request => {
    claimed.push(request.sectionKey);
    return { ok: true, expiresAt: '2099-01-01T00:00:00.000Z' };
  }, async request => { released.push(request.leaseOwnerId); }, () => true);
  assert.equal(success.status, 'owned');
  assert.deepEqual(success.leases.map(item => item.sectionKey), requests.map(item => item.sectionKey));
  assert.deepEqual(claimed, requests.map(item => item.sectionKey));
  assert.deepEqual(released, []);

  const blockedReleases = [];
  const blocked = await acquireEditLockBundle(requests, async request => request.sectionKey === 'vessel:v2'
    ? { ok: false, lockedByName: 'Other User' }
    : { ok: true, expiresAt: '2099-01-01T00:00:00.000Z' }, async request => { blockedReleases.push(request.leaseOwnerId); }, () => true);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.sectionKey, 'vessel:v2');
  assert.equal(blocked.lockedByName, 'Other User');
  assert.deepEqual(blockedReleases, ['lease-2', 'lease-1'], 'blocked acquire must release the attempted token and all earlier owned leases in reverse order');
  assert.deepEqual(blocked.cleanupUnresolved, []);

  const rollbackFailed = await acquireEditLockBundle(requests, async request => request.sectionKey === 'vessel:v2'
    ? { ok: false, lockedByName: 'Other User' }
    : { ok: true, expiresAt: '2099-01-01T00:00:00.000Z' }, async request => {
      if (request.leaseOwnerId === 'lease-1') throw new Error('release unavailable');
    }, () => true);
  assert.equal(rollbackFailed.status, 'blocked');
  assert.equal(rollbackFailed.cleanupFailed, true);
  assert.deepEqual(rollbackFailed.cleanupUnresolved.map(item => item.leaseOwnerId), ['lease-1'], 'rollback failure must preserve the exact opaque token for retry');

  const errorReleases = [];
  const unavailable = await acquireEditLockBundle(requests, async request => {
    if (request.sectionKey === 'vessel:v3') throw new Error('network lost after request');
    return { ok: true, expiresAt: '2099-01-01T00:00:00.000Z' };
  }, async request => { errorReleases.push(request.leaseOwnerId); }, () => true);
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(errorReleases, ['lease-3', 'lease-2', 'lease-1'], 'indeterminate current request must also be released with its opaque token');

  let wanted = true;
  const cancelledReleases = [];
  const cancelled = await acquireEditLockBundle(requests, async request => {
    wanted = false;
    return { ok: true, expiresAt: '2099-01-01T00:00:00.000Z' };
  }, async request => { cancelledReleases.push(request.leaseOwnerId); }, () => wanted);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelledReleases, ['lease-1']);

  const releaseState = createLeaseReleaseState();
  const tracked = { sectionKey:'vessel:v1', leaseOwnerId:'tracked-1' };
  registerTrackedLease(releaseState, tracked, { workspace:'one' });
  let releaseCalls = 0;
  const releaseOnce = async () => { releaseCalls += 1; };
  assert.equal(await releaseTrackedLeases(releaseState, [tracked], releaseOnce), true);
  assert.equal(await releaseTrackedLeases(releaseState, [tracked], releaseOnce), true);
  assert.equal(releaseCalls, 1, 'duplicate close/invalidation release must be idempotent');
  assert.deepEqual(pendingTrackedLeases(releaseState), [], 'duplicate successful release must not become pending');

  const retryState = createLeaseReleaseState();
  const retryLease = { sectionKey:'vessel:v2', leaseOwnerId:'tracked-retry' };
  registerTrackedLease(retryState, retryLease, { workspace:'two' });
  let retryCalls = 0;
  const releaseAfterFailure = async () => { if (++retryCalls === 1) throw new Error('temporary outage'); };
  assert.equal(await releaseTrackedLeases(retryState, [retryLease], releaseAfterFailure), false);
  assert.deepEqual(pendingTrackedLeases(retryState), [retryLease], 'failed release must retain its exact token for next-open retry');
  assert.equal(await releaseTrackedLeases(retryState, pendingTrackedLeases(retryState), releaseAfterFailure), true);
  assert.deepEqual(pendingTrackedLeases(retryState), []);

  const longSessionState = createLeaseReleaseState();
  const longSessionLeases = Array.from({length:2050},(_,index)=>({sectionKey:`vessel:long-${index}`,leaseOwnerId:`long-lease-${index}`}));
  for(const lease of longSessionLeases)registerTrackedLease(longSessionState,lease,{workspace:'long-session'});
  let longSessionReleaseCalls=0;
  const releaseLongSession=async()=>{longSessionReleaseCalls+=1;};
  assert.equal(await releaseTrackedLeases(longSessionState,[...longSessionLeases].reverse(),releaseLongSession),true);
  assert.equal(await releaseTrackedLeases(longSessionState,[longSessionLeases[0]],releaseLongSession),true,'old successful release must remain idempotent after more than 2048 later releases');
  assert.equal(longSessionReleaseCalls,2050,'stale callback must not issue a second RPC for an old successful lease');
  assert.deepEqual(pendingTrackedLeases(longSessionState),[],'old successful lease must never become a false pending release');

  const { createEditLockCoordinator } = await server.ssrLoadModule('/src/editLockCoordinator.ts');
  const { runCloudSaveQueueRpc } = await server.ssrLoadModule('/src/cloudSaveQueue.ts');
  const coordinator = createEditLockCoordinator();
  const timedOutClaim = coordinator.run(() => runCloudSaveQueueRpc('test claim', () => new Promise(() => {}), 10));
  let cleanupRan = false;
  const cleanup = coordinator.run(async () => { cleanupRan = true; });
  await assert.rejects(timedOutClaim, /test claim逾時/);
  await cleanup;
  assert.equal(cleanupRan, true, 'a timed-out lock RPC must not poison the coordinator tail');

  const appPath = new URL('../src/App.tsx', import.meta.url);
  const appSource = readFileSync(appPath, 'utf8');
  const sourceFile = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lockRpcNames = new Set(['claimEditLock','renewEditLock','releaseEditLock']);
  const unbounded = [];
  const isBounded = node => {
    for(let current=node.parent;current;current=current.parent){
      if(ts.isCallExpression(current)&&ts.isIdentifier(current.expression)&&current.expression.text==='runCloudSaveQueueRpc')return true;
      if(ts.isStatement(current))return false;
    }
    return false;
  };
  const visit = node => {
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&lockRpcNames.has(node.expression.text)&&!isBounded(node)){
      const position=sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      unbounded.push(`${node.expression.text}@${position.line+1}`);
    }
    ts.forEachChild(node,visit);
  };
  visit(sourceFile);
  assert.deepEqual(unbounded, [], `all production lock RPCs must be bounded: ${unbounded.join(', ')}`);

  console.log('Edit-lock bundle runtime contracts passed.');
} finally {
  await server.close();
}
