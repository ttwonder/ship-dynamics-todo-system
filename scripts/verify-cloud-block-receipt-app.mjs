import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const saveStart = appSource.indexOf('const enqueueCloudSave =');
const saveEnd = appSource.indexOf('const flushCloudBeforeBatchRelease', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'production cloud-save flow must be present');
const saveSource = appSource.slice(saveStart, saveEnd);

for (const symbol of [
  'applyCloudBlockPatchV2',
  'getCloudBlockPatchReceipt',
  'CloudBlockPatchV2UnavailableError',
  'CloudBlockPatchRejectedError',
  'runCloudBlockPatchWithReceipt',
  'CloudBlockPatchOutcomeUnknownError',
  'CloudBlockPatchConfirmedRefreshError',
]) assert.ok(appSource.includes(symbol), `App must import/use ${symbol}`);

const operationId = saveSource.indexOf("const operationId=uid('cloud-block-operation')");
const protocol = saveSource.indexOf('runCloudBlockPatchWithReceipt({', operationId);
const v2Submit = saveSource.indexOf('applyCloudBlockPatchV2(id,operations', protocol);
const receiptLookup = saveSource.indexOf('getCloudBlockPatchReceipt(id,operations,savedBy,actorUserId,actorGuard,strictAuthorizationGuard,guards,config,signal)', v2Submit);
const authoritativeFetch = saveSource.indexOf("'原子保存後權威資料讀回'", receiptLookup);
const historyCheck = saveSource.indexOf('assertRemoteExtendsDurableHistory(activeCloudIdentity.current,remote,authoritative)', authoritativeFetch);
const v2Fallback = saveSource.indexOf('if(!(error instanceof CloudBlockPatchV2UnavailableError))throw error;', historyCheck);
const v1Fallback = saveSource.indexOf('applyCloudBlockPatchRpc(operations', v2Fallback);
const legacyUnavailable = saveSource.indexOf('if(error instanceof CloudBlockPatchUnavailableError){', v1Fallback);
const legacyTurn = saveSource.indexOf('await acquireLegacyCloudSaveTurn();', legacyUnavailable);

assert.ok(operationId >= 0, 'each concrete block request must get an operation id');
assert.ok(protocol > operationId && v2Submit > protocol && receiptLookup > v2Submit, 'normal path must submit v2 and reconcile the same operation id');
assert.ok(authoritativeFetch > receiptLookup && historyCheck > authoritativeFetch, 'compact ACK must be followed by an out-of-transaction authoritative refetch and durable-history check');
assert.ok(v2Fallback > historyCheck && v1Fallback > v2Fallback, 'only v2-unavailable may fall back to the existing v1 block RPC');
assert.ok(legacyUnavailable > v1Fallback && legacyTurn > legacyUnavailable, 'only v1-unavailable may enter the whole-state workspace-turn fallback');
assert.ok(saveSource.includes("shouldReconcile:error=>!(error instanceof CloudBlockPatchV2UnavailableError||error instanceof CloudBlockPatchRejectedError||error instanceof CloudBlockPatchConflictError||error instanceof StaleAsyncConfigError)"), 'server-declared rejection/conflict/unavailable and stale-context outcomes must never enter transport replay');
assert.ok(saveSource.includes('authoritative.revision<receipt.revision'), 'a refetch older than the committed receipt must fail closed');
assert.ok(saveSource.includes('error instanceof CloudBlockPatchOutcomeUnknownError||error instanceof CloudBlockPatchConfirmedRefreshError'), 'unknown outcome or committed-without-safe-refetch must block subsequent writes');
assert.ok(appSource.includes('identityGeneration:number') && saveSource.includes('const requestIdentityGeneration=identitySessionGeneration.current;') && saveSource.includes('identityGeneration:requestIdentityGeneration'), 'each queued save intent must capture the actor-session generation');
assert.ok(saveSource.includes('liveCurrentUserId.current!==requestActorUserId||identitySessionGeneration.current!==requestIdentityGeneration'), 'save completion must not continue after actor-session replacement');
assert.ok(saveSource.includes('const pendingActorIsCurrent=()=>identitySessionGeneration.current===identityGeneration&&liveCurrentUserId.current===actorUserId;'), 'retry/refetch must fence a switched or logged-out actor');
assert.ok(saveSource.includes('isCurrent()&&pendingActorIsCurrent()&&configIoCoordinator.current.isCurrent'), 'recovery-lock lifetime must share the actor-session fence');
assert.equal((saveSource.match(/uid\('cloud-block-operation'\)/g) || []).length, 1, 'one concrete patch attempt must own one stable operation id');
assert.equal((saveSource.match(/await acquireLegacyCloudSaveTurn\(\);/g) || []).length, 1, 'compact/v1 paths must never acquire the whole-state turn');

console.log('cloud_block_receipt_app_wiring=PASS');
