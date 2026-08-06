import assert from 'node:assert/strict';

const moduleUrl = new URL('../src/vesselAttentionSaveQueue.ts', import.meta.url).href;
const { createVesselAttentionSaveQueue } = await import(moduleUrl);

const createScheduler = () => {
  let nextId = 1;
  const callbacks = new Map();
  return {
    scheduler: {
      setTimeout(callback) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      clearTimeout(id) { callbacks.delete(id); },
    },
    runAll() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback();
    },
    size: () => callbacks.size,
  };
};

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

{
  const clock = createScheduler();
  const writes = [];
  const states = [];
  const queue = createVesselAttentionSaveQueue({
    debounceMs: 400,
    scheduler: clock.scheduler,
    persist: async (vesselId, desired) => { writes.push([vesselId, desired]); },
    onState: (vesselId, state) => states.push([vesselId, state]),
  });

  queue.enqueue('vessel-a', ['maintenance']);
  queue.enqueue('vessel-a', ['maintenance', 'survey']);
  queue.enqueue('vessel-a', ['survey']);
  assert.equal(queue.hasPending(), true, 'debounce期間必須阻止身份或工作區切換');
  assert.equal(clock.size(), 1, '同船快速連點只能保留一個debounce timer');
  assert.equal(writes.length, 0, 'debounce到期前不得上傳中間值');

  clock.runAll();
  await tick();
  assert.deepEqual(writes, [['vessel-a', ['survey']]], '同船快速連點只保存最後狀態');
  assert.equal(states.at(-1)?.[1]?.phase, 'saved', '最後狀態保存成功後必須回報saved');
  assert.equal(queue.hasPending(), false, '真正保存成功後才可解除身份切換阻擋');
}

{
  const clock = createScheduler();
  const writes = [];
  const resolvers = [];
  const queue = createVesselAttentionSaveQueue({
    scheduler: clock.scheduler,
    persist: (vesselId, desired) => {
      writes.push([vesselId, desired]);
      return new Promise((resolve, reject) => resolvers.push({ resolve, reject }));
    },
    onState: () => undefined,
  });

  queue.enqueue('vessel-a', ['maintenance']);
  clock.runAll();
  await tick();
  assert.deepEqual(writes, [['vessel-a', ['maintenance']]], '第一筆保存必須開始');
  assert.equal(queue.hasPending(), true, '保存請求在途時必須阻止身份或工作區切換');

  queue.enqueue('vessel-a', ['survey']);
  queue.enqueue('vessel-a', ['survey', 'psc-window']);
  assert.equal(writes.length, 1, '同船已有請求在途時不得平行上傳');

  resolvers[0].resolve();
  await tick();
  assert.deepEqual(writes, [
    ['vessel-a', ['maintenance']],
    ['vessel-a', ['survey', 'psc-window']],
  ], '在途完成後只能補送最新desired state');
  resolvers[1].resolve();
  await tick();
  assert.equal(queue.hasPending(), false, '在途及補送的最新值都完成後才能解除阻擋');
}

{
  const clock = createScheduler();
  const writes = [];
  const queue = createVesselAttentionSaveQueue({
    scheduler: clock.scheduler,
    persist: async (vesselId, desired) => { writes.push([vesselId, desired]); },
    onState: () => undefined,
  });
  queue.enqueue('vessel-a', ['maintenance']);
  queue.enqueue('vessel-b', ['survey']);
  assert.equal(clock.size(), 2, '不同船必須各有獨立debounce timer');
  clock.runAll();
  await tick();
  assert.deepEqual(writes.map(([id]) => id).sort(), ['vessel-a', 'vessel-b'], '不同船不得共用單一阻塞隊列');
}

{
  const clock = createScheduler();
  let shouldFail = true;
  const writes = [];
  const states = [];
  const queue = createVesselAttentionSaveQueue({
    scheduler: clock.scheduler,
    persist: async (vesselId, desired) => {
      writes.push([vesselId, desired]);
      if (shouldFail) throw new Error('network unavailable');
    },
    onState: (vesselId, state) => states.push([vesselId, state]),
  });

  queue.enqueue('vessel-a', ['maintenance']);
  clock.runAll();
  await tick();
  assert.equal(states.at(-1)?.[1]?.phase, 'error', '失敗必須保留可見error狀態');
  assert.match(states.at(-1)?.[1]?.message || '', /network unavailable/, '失敗狀態必須保留原因');
  assert.equal(queue.hasPending(), true, '保存失敗的意圖必須維持身份切換阻擋直到重試成功');

  shouldFail = false;
  assert.equal(queue.retry('vessel-a'), true, '失敗項目必須可重試');
  clock.runAll();
  await tick();
  assert.equal(writes.length, 2, '重試只能再送一次目前最新值');
  assert.equal(states.at(-1)?.[1]?.phase, 'saved', '重試成功後必須回報saved');
  assert.equal(queue.hasPending(), false, '重試成功後必須解除身份切換阻擋');
}

console.log('Vessel attention latest-value save queue contracts passed.');
