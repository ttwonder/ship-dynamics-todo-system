import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const queue = await server.ssrLoadModule('/src/cloudSaveQueue.ts');

  let immediateClaims = 0;
  const immediate = await queue.waitForCloudSaveTurn({
    claim: async () => { immediateClaims += 1; return { ok:true, sectionKey:queue.CLOUD_SAVE_QUEUE_SECTION_KEY }; },
    isCurrent: () => true,
  });
  assert.equal(immediateClaims, 1);
  assert.equal(immediate.waited, false);

  let queuedClaims = 0;
  let waitingNotice = '';
  let clock = 0;
  const queued = await queue.waitForCloudSaveTurn({
    claim: async () => {
      queuedClaims += 1;
      return queuedClaims < 3
        ? { ok:false, sectionKey:queue.CLOUD_SAVE_QUEUE_SECTION_KEY, lockedByName:'協作者甲' }
        : { ok:true, sectionKey:queue.CLOUD_SAVE_QUEUE_SECTION_KEY };
    },
    isCurrent: () => true,
    onWaiting: lock => { waitingNotice = lock.lockedByName || ''; },
    now: () => clock,
    sleep: async delay => { clock += delay; },
    retryDelayMs: 5,
    maxWaitMs: 30,
  });
  assert.equal(queued.waited, true);
  assert.equal(waitingNotice, '協作者甲');
  assert.equal(queuedClaims, 3);

  let lateClock = 0;
  await assert.rejects(
    queue.waitForCloudSaveTurn({
      claim: async () => {
        lateClock += 3_500;
        return { ok:true, sectionKey:queue.CLOUD_SAVE_QUEUE_SECTION_KEY };
      },
      isCurrent: () => true,
      now: () => lateClock,
      maxWaitMs:3_000,
    }),
    error => error instanceof queue.CloudSaveQueueTimeoutError && error.lockAcquired === true,
    'claim 在 deadline 後才回覆時不得再接受保存權',
  );

  let pendingRevision = 1;
  const processedRevisions = [];
  const processedBatches = await queue.drainCloudSaveQueueUntilStable({
    hasPending: () => pendingRevision !== 0,
    processPendingBatch: async () => {
      const processing = pendingRevision;
      pendingRevision = 0;
      processedRevisions.push(processing);
      await Promise.resolve();
      if (processing === 1) pendingRevision = 2;
    },
  });
  assert.equal(processedBatches, 2, '釋放保存權期間加入的較新修改必須啟動下一批保存');
  assert.deepEqual(processedRevisions, [1, 2], '較新修改不得停留在 pending queue');
  assert.equal(pendingRevision, 0, '保存任務完成前必須排空較新修改');

  const equals = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const visibleBaseline = { revision:1, tasks:[] };
  const durableSnapshot = { revision:2, tasks:[{ id:'new-task' }] };
  assert.equal(queue.hasUnconfirmedVisibleChanges({
    live:visibleBaseline,
    confirmed:durableSnapshot,
    lastSaved:durableSnapshot,
    lastSavedWasRendered:false,
    visibleBaseline,
    equals,
    liveRevision:1,
    confirmedRevision:2,
  }), false, 'durable handoff 尚未 commit 畫面時，不得把預期的畫面差異誤判為新修改');
  assert.equal(queue.hasUnconfirmedVisibleChanges({
    live:{ revision:2, tasks:[{ id:'other-change' }] },
    confirmed:durableSnapshot,
    lastSaved:durableSnapshot,
    lastSavedWasRendered:false,
    visibleBaseline,
    equals,
    liveRevision:2,
    confirmedRevision:2,
  }), true, 'durable handoff 等待期間的真正新修改仍須保持未保存狀態');

  let queueRpcAborted = false;
  await assert.rejects(
    queue.runCloudSaveQueueRpc('測試保存權 RPC', signal => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { queueRpcAborted = true; reject(new Error('aborted')); }, { once:true });
    }), 1),
    error => error instanceof queue.CloudSaveQueueRpcTimeoutError,
  );
  assert.equal(queueRpcAborted, true, '保存權 RPC 逾時時必須中止底層請求');
  await assert.rejects(
    queue.runCloudSaveQueueRpc('忽略取消的測試 RPC', () => new Promise(() => {}), 1),
    error => error instanceof queue.CloudSaveQueueRpcTimeoutError,
    '即使底層忽略 AbortSignal，保存流程也不得永久等待',
  );

  clock = 0;
  await assert.rejects(
    queue.waitForCloudSaveTurn({
      claim: async () => ({ ok:false, sectionKey:queue.CLOUD_SAVE_QUEUE_SECTION_KEY, lockedByName:'協作者乙' }),
      isCurrent: () => true,
      now: () => clock,
      sleep: async delay => { clock += delay; },
      retryDelayMs: 2,
      maxWaitMs: 3,
    }),
    error => error instanceof queue.CloudSaveQueueTimeoutError && error.lockedByName === '協作者乙',
  );

  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const cloud = fs.readFileSync('src/cloud.ts', 'utf8');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert.ok(app.includes('waitForCloudSaveTurn') && app.includes('CLOUD_SAVE_QUEUE_SECTION_KEY'));
  assert.ok(app.includes('buildCloudBlockPatch'), 'cloud save path must build operation-level block patches');
  assert.ok(app.includes('applyCloudBlockPatchRpc'), 'cloud save path must use the atomic block RPC');
  assert.ok(app.includes('assertActorAuthorizedForAppDataChange'), 'cloud save path must revalidate normalized before/after intent against the latest remote snapshot');
  assert.ok(app.includes('drainCloudSaveQueueUntilStable') && app.includes('heartbeatTimer=window.setInterval(renewSaveTurn'));
  assert.ok(!app.includes('heartbeatMayStillComplete') && app.includes('if(saveTurnOwned){'), '續租已是 update-only 時，逾時後仍必須嘗試 release，讓舊續租無論先後完成都不能留下保存鎖');
  assert.ok(app.includes('visibleBaseline:renderRebase?null:clone(liveData.current)'), '未 render 的 durable handoff 必須記住畫面基線');
  assert.ok(app.includes("runCloudSaveQueueRpc('取得雲端保存權'") && app.includes('maxWaitMs:3_000'));
  assert.ok(app.includes('cloudSaveQueueBypassUntil.current=Date.now()+60_000'), '隊列逾時後必須暫時改用 CAS/rebase，避免共享鎖持續阻斷');
  assert.ok(app.includes("runCloudSaveQueueRpc('清理逾時後才取得的雲端保存權'"), 'deadline 後才取得的保存權必須非阻塞清理');
  assert.ok(app.includes('CloudSaveQueueRpcTimeoutError') && app.includes('已改用雲端版本檢查安全保存'));
  assert.ok(cloud.includes('request.abortSignal(signal)'), '保存權與釋放 RPC 必須可被逾時中止');
  assert.ok(app.includes("addEventListener('beforeunload'") && app.includes('event.returnValue'));
  assert.ok(app.includes('hasUnsavedWork.current||saveTimer.current||pendingCloudData.current'));
  assert.ok(!app.includes('hasUnsavedWork.current||saveTimer.current||cloudSaveInFlight.current||pendingCloudData.current'), '已確認寫入而只剩 release 時不得誤擋離頁');
  assert.ok(app.includes('clearStaleSaveSuccessToast()') && app.includes("saveToastRef.current?.kind==='success'"), '新修改必須立即撤銷舊的成功提示');
  assert.ok(app.includes('visibleWriteConfirmed') && app.includes('hasUnsavedWork.current=false'), '寫入確認後應在 release 前更新 durability truth');
  assert.ok(app.includes('recoveredCreation') && app.includes("showSaveToast('success','新增要事已確認保存'"), '回應遺失但已確認新增成功時必須清除錯誤狀態');
  assert.ok(app.includes("showSaveToast(released?'success':'warning'") && app.includes("setCloudStatus(released?savedStatus('已放棄本批修改"), '放棄本批並採用雲端版本後必須同步保存狀態');
  assert.ok(app.includes('error instanceof StaleAsyncConfigError||error instanceof CloudSaveQueueCancelledError'), '工作區或非同步階段變更不得誤導成單純網路錯誤');
  const dirtyGuard=app.indexOf('const hasUnconfirmedContent=');
  assert.ok(dirtyGuard>=0&&app.indexOf('hasUnsavedWork.current=true;',dirtyGuard)<app.indexOf('if(cloudWriteBlocked||cloudSyncing||cloudSyncInFlight.current)',dirtyGuard), '被阻擋或同步期間的新修改也必須先標記未保存');
  assert.ok(app.includes('save-toast-layer') && app.includes('save-status-strip') && app.includes('已保存到雲端'));
  assert.ok(css.includes('.save-toast-layer') && css.includes('.save-status-strip') && css.includes('@keyframes save-toast-life'));

  console.log('Save queue and visible feedback contracts passed.');
} finally {
  await server.close();
}
