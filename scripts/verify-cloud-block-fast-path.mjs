import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const queueSource = readFileSync(new URL('../src/cloudSaveQueue.ts', import.meta.url), 'utf8');
const saveStart = appSource.indexOf('const enqueueCloudSave =');
const saveEnd = appSource.indexOf('const flushCloudBeforeBatchRelease', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'production cloud-save flow must be present');
const saveSource = appSource.slice(saveStart, saveEnd);

const legacyTurnHelper = saveSource.indexOf('const acquireLegacyCloudSaveTurn=async()=>{');
const normalSaveStart = saveSource.indexOf("setCloudStatus('正在以原子區塊安全保存到雲端…')", legacyTurnHelper);
const blockRpc = saveSource.indexOf('applyCloudBlockPatchRpc(', normalSaveStart);
const unavailableFallback = saveSource.indexOf('if(error instanceof CloudBlockPatchUnavailableError){', blockRpc);
const legacyTurn = saveSource.indexOf('await acquireLegacyCloudSaveTurn();', unavailableFallback);
const legacyRefetch = saveSource.indexOf('remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);', legacyTurn);
const legacyRecoveryLocks = saveSource.indexOf('const recovery=await runWithCurrentRecoveryLocks(async()=>{', legacyRefetch);
const legacyTurnConfirmation = saveSource.indexOf('await saveTurnHeartbeat.confirm();', legacyRecoveryLocks);
const legacyCas = saveSource.indexOf('saveCloudData(candidate', legacyTurnConfirmation);

assert.ok(legacyTurnHelper >= 0 && normalSaveStart > legacyTurnHelper, 'legacy workspace-turn helper must be isolated from the normal block-save start');
assert.ok(blockRpc > normalSaveStart, 'normal saves must use the atomic block RPC');
assert.ok(unavailableFallback > blockRpc, 'legacy handling must begin only after a confirmed block-RPC-unavailable response');
assert.ok(legacyTurn > unavailableFallback, 'workspace-save turn must be invoked only inside the confirmed legacy fallback');
assert.ok(legacyRefetch > legacyTurn, 'legacy fallback must refetch the authoritative cloud snapshot after acquiring its workspace turn');
assert.ok(legacyRecoveryLocks > legacyRefetch && legacyTurnConfirmation > legacyRecoveryLocks && legacyCas > legacyTurnConfirmation, 'whole-state CAS must await turn confirmation while recovery/entity locks are held');
assert.ok(saveSource.includes('!legacyWholeStateFallback||(saveTurnOwned&&saveTurnHeartbeat.isActive())'), 'legacy recovery-lock acquisition must stop as soon as the workspace turn heartbeat fails');
assert.equal((saveSource.match(/await acquireLegacyCloudSaveTurn\(\);/g) || []).length, 1, 'only a confirmed unavailable response may invoke the legacy turn');
assert.equal((saveSource.match(/waitForCloudSaveTurn\(\{/g) || []).length, 1, 'normal block saves must have no separate workspace-save wait');
assert.ok(saveSource.slice(legacyTurnHelper, normalSaveStart).includes('waitForCloudSaveTurn({'), 'the remaining workspace turn must belong to the legacy helper');
assert.ok(!saveSource.includes('maxWaitMs:3_000'), 'normal saves must not retain the fixed three-second workspace wait');

for (const contract of [
  'pendingCloudData.current.peek()',
  'pendingCloudData.current.shift()',
  'pendingEntry.resolve()',
  "new CloudRebaseConflictError(['缺少可信的雲端合併基線'])",
  'assertRemoteExtendsDurableHistory',
  'rebaseDisjointAppData',
  'assertActorAuthorizedForAppDataChange',
  'actorStorageAuthorizationGuard',
  'authorizationDomainGuard',
  'runWithCloudSaveRecoveryLocks',
  'CloudBlockPatchConflictError',
  'if(++rebaseAttempts>3)',
]) assert.ok(saveSource.includes(contract), `fast path must retain safety contract: ${contract}`);

assert.ok(queueSource.includes('entries.push({ value, resolve, reject })'), 'each logical save intent must retain its own FIFO receipt');
assert.ok(queueSource.includes('peek: () => entries[0]') && queueSource.includes('shift: () => entries.shift()'), 'the local queue must remain FIFO');
assert.ok(!queueSource.includes('entries.splice(entries.length - 1'), 'phase one must not coalesce queued snapshots');

console.log('Cloud block fast-path boundaries passed.');
