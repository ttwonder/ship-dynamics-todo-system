import assert from 'node:assert/strict';
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

  console.log('Edit-lock bundle runtime contracts passed.');
} finally {
  await server.close();
}
