import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createCloudSaveIntentQueue } = await server.ssrLoadModule('/src/cloudSaveQueue.ts');
  assert.equal(typeof createCloudSaveIntentQueue, 'function', 'cloud save queue must expose per-intent receipts');

  const queue = createCloudSaveIntentQueue();
  const completionA = queue.enqueue({ id: 'intent-A' });
  const completionB = queue.enqueue({ id: 'intent-B' });

  assert.equal(queue.peek()?.value.id, 'intent-A', 'selecting a save turn must not remove the active intent before claim succeeds');
  assert.equal(queue.size(), 2, 'peek must leave all receipts rejectable while a queue turn is being claimed');
  const first = queue.shift();
  assert.equal(first?.value.id, 'intent-A', 'the first save intent must not be overwritten');
  assert.equal(queue.size(), 1, 'the second save intent must remain queued');

  let aSettled = false;
  let bSettled = false;
  completionA.then(() => { aSettled = true; });
  completionB.then(() => { bSettled = true; });
  first.resolve();
  await Promise.resolve();
  assert.equal(aSettled, true, 'intent A resolves only after its own durable receipt');
  assert.equal(bSettled, false, 'intent B must not share intent A completion');

  const second = queue.shift();
  assert.equal(second?.value.id, 'intent-B');
  second.resolve();
  await Promise.resolve();
  assert.equal(bSettled, true, 'intent B resolves only after its own durable receipt');
  assert.equal(queue.size(), 0);

  const rejected = queue.enqueue({ id: 'intent-C' });
  const reason = new Error('identity changed');
  queue.rejectAll(reason);
  await assert.rejects(rejected, error => error === reason);
  assert.equal(queue.size(), 0);

  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /createCloudSaveIntentQueue/, 'production App must compose the per-intent queue');
  assert.match(appSource, /pendingCloudData\.current\.enqueue\(/, 'each production save must enqueue its own receipt');
  assert.match(appSource, /pendingCloudData\.current\.shift\(\)/, 'the production drain must process FIFO intents');
  assert.match(appSource, /pendingEntry\.resolve\(\)/, 'a production intent must resolve only at its own durable boundary');

  console.log('Per-intent cloud save queue receipts passed.');
} finally {
  await server.close();
}
