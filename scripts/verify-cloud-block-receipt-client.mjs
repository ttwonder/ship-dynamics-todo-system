import assert from 'node:assert/strict';
import { loadReceiptTestModule } from './receipt-test-module-loader.mjs';

{
  const receiptModule = loadReceiptTestModule('src/cloudBlockReceipt.ts');
  const operationId = 'block-op-client-1';
  let now = 0;
  const submitted = [];
  const lookedUp = [];
  const sleeps = [];

  const committed = await receiptModule.runCloudBlockPatchWithReceipt({
    operationId,
    submit: async id => {
      submitted.push(id);
      now = 1_000;
      throw Object.assign(new Error('response lost'), { code: 'NETWORK' });
    },
    lookup: async id => {
      lookedUp.push(id);
      return { ok: true, status: 'committed', operationId: id, revision: 12, updatedAt: '2026-09-04T08:00:00.000Z', replayed: true };
    },
    shouldReconcile: () => true,
    assertCurrent: () => undefined,
    now: () => now,
    sleep: async delayMs => { sleeps.push(delayMs); now += delayMs; },
  });

  assert.equal(committed.operationId, operationId);
  assert.equal(committed.revision, 12);
  assert.deepEqual(submitted, [operationId], 'a committed receipt must prevent a duplicate submit');
  assert.deepEqual(lookedUp, [operationId]);
  assert.deepEqual(sleeps, [7_500], 'receipt lookup must wait until the 8.5 second server-outcome boundary');

  now = 0;
  const retriedOperationIds = [];
  let lookupCount = 0;
  const retried = await receiptModule.runCloudBlockPatchWithReceipt({
    operationId,
    submit: async id => {
      retriedOperationIds.push(id);
      if (retriedOperationIds.length === 1) {
        now = 2_000;
        throw Object.assign(new Error('statement timeout'), { code: '57014' });
      }
      return { ok: true, status: 'committed', operationId: id, revision: 13, updatedAt: '2026-09-04T08:01:00.000Z', replayed: false };
    },
    lookup: async () => { lookupCount += 1; return { status: 'missing' }; },
    shouldReconcile: () => true,
    assertCurrent: () => undefined,
    now: () => now,
    sleep: async delayMs => { now += delayMs; },
  });

  assert.equal(retried.revision, 13);
  assert.deepEqual(retriedOperationIds, [operationId, operationId], 'one retry must replay the exact operation identity');
  assert.equal(lookupCount, 1, 'a missing receipt permits one retry, not a new operation');

  now = 0;
  let unknownSubmitCount = 0;
  let unknownLookupCount = 0;
  await assert.rejects(
    receiptModule.runCloudBlockPatchWithReceipt({
      operationId,
      submit: async () => { unknownSubmitCount += 1; now = 8_000; throw new Error('response unavailable'); },
      lookup: async () => { unknownLookupCount += 1; throw new Error('receipt endpoint unavailable'); },
      shouldReconcile: () => true,
      assertCurrent: () => undefined,
      now: () => now,
      sleep: async delayMs => { now += delayMs; },
    }),
    error => error instanceof receiptModule.CloudBlockPatchOutcomeUnknownError && error.operationId === operationId,
  );
  assert.equal(unknownSubmitCount, 1, 'failed receipt lookup must never trigger a blind replay');
  assert.equal(unknownLookupCount, 1);

  // A failed save plus failed read-only receipt lookup must retain both actual
  // causes. Otherwise the UI cannot distinguish a database timeout from a
  // network failure, and the incident is impossible to diagnose afterwards.
  const submitCause = { code: '57014', message: 'canceling statement due to statement timeout' };
  const receiptCause = new Error('receipt network unavailable');
  let causeSubmitCount = 0;
  await assert.rejects(receiptModule.runCloudBlockPatchWithReceipt({
    operationId,
    submit: async () => { causeSubmitCount += 1; throw submitCause; },
    lookup: async () => { throw receiptCause; },
    shouldReconcile: () => true,
    assertCurrent: () => undefined,
    now: () => 0,
    sleep: async () => undefined,
  }), error => {
    assert.ok(error instanceof receiptModule.CloudBlockPatchOutcomeUnknownError);
    assert.equal(error.cause, submitCause, 'unknown outcome must preserve the original save error');
    assert.equal(error.receiptCause, receiptCause, 'receipt error must remain separate from the save error');
    assert.match(error.message, /57014/, 'the original database error must reach the UI');
    assert.match(error.message, /receipt network unavailable/);
    return true;
  });
  assert.equal(causeSubmitCount, 1, 'diagnostic preservation must not add a replay');

  const deterministic = new Error('lock-conflict');
  let deterministicLookupCount = 0;
  await assert.rejects(
    receiptModule.runCloudBlockPatchWithReceipt({
      operationId,
      submit: async () => { throw deterministic; },
      lookup: async () => { deterministicLookupCount += 1; return { status: 'missing' }; },
      shouldReconcile: error => error !== deterministic,
      assertCurrent: () => undefined,
      now: () => 0,
      sleep: async () => undefined,
    }),
    error => error === deterministic,
  );
  assert.equal(deterministicLookupCount, 0, 'server-declared rejection must not be reconciled or retried');

  now = 0;
  let boundedSubmitCount = 0;
  let boundedLookupCount = 0;
  await assert.rejects(receiptModule.runCloudBlockPatchWithReceipt({
    operationId,
    submit: async () => { boundedSubmitCount += 1; throw new Error(`transport-${boundedSubmitCount}`); },
    lookup: async () => { boundedLookupCount += 1; return { status: 'missing' }; },
    shouldReconcile: () => true,
    assertCurrent: () => undefined,
    now: () => now,
    sleep: async delayMs => { now += delayMs; },
  }), /transport-2/);
  assert.equal(boundedSubmitCount, 2, 'coordinator must permit at most one exact replay');
  assert.equal(boundedLookupCount, 2);

  now = 0;
  let stillCurrent = true;
  let staleLookupCount = 0;
  await assert.rejects(receiptModule.runCloudBlockPatchWithReceipt({
    operationId,
    submit: async () => { throw new Error('transport-before-switch'); },
    lookup: async () => { staleLookupCount += 1; return { status: 'missing' }; },
    shouldReconcile: () => true,
    assertCurrent: () => { if (!stillCurrent) throw new Error('stale-actor-generation'); },
    now: () => now,
    sleep: async delayMs => { now += delayMs; stillCurrent = false; },
  }), /stale-actor-generation/);
  assert.equal(staleLookupCount, 0, 'a stale actor/session must not query or replay an old operation');

  console.log('cloud_block_receipt_client_lost_ack=PASS');
}
