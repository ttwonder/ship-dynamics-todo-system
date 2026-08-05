import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app = fs.readFileSync('src/App.tsx','utf8');
const version = fs.readFileSync('src/appVersionUpdate.ts','utf8');

class MemoryStorage {
  map = new Map();
  get length(){ return this.map.size; }
  key(index){ return [...this.map.keys()][index] ?? null; }
  getItem(key){ return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key,value){ this.map.set(key,String(value)); }
  removeItem(key){ this.map.delete(key); }
}

const server = await createServer({ server:{middlewareMode:true}, appType:'custom', logLevel:'silent' });
try {
  const queue = await server.ssrLoadModule('/src/pendingTaskCreation.ts');
  const task = {
    id:'task-stable-1', vesselId:'vessel-a', vesselIds:['vessel-a','vessel-b'],
    description:'A船新增要事', status:'待處理', statusLogs:[], priority:'中', categories:[], departments:[], ownerUserIds:[],
    isClosed:false, closedDate:'', closedBy:'', isInternalControl:false, isAbnormal:false,
    createdAt:'2026-08-05T08:00:00.000Z', updatedAt:'2026-08-05T08:00:00.000Z', createdBy:'user-c', updatedBy:'user-c',
    sourceType:'morning', attentionDimension:'task', sourceMeetingId:'', sourceMeetingItemId:'', distributeToVessels:false,
    vesselProgress:[], vesselScopeMode:'vessels', vesselTypeScopes:[], expectedDate:'', vesselCount:2,
  };
  const intent = queue.createPendingTaskCreationIntent({
    intentId:'intent-fixed-1', workspaceIdentity:'workspace-1', userId:'user-c', task,
    primaryVesselId:'vessel-a', vesselIds:['vessel-b','vessel-a','vessel-a'], baseRevision:17,
  }, '2026-08-05T08:01:00.000Z');
  assert.equal(intent.intentId,'intent-fixed-1');
  assert.equal(intent.taskId,'task-stable-1');
  assert.deepEqual(intent.vesselIds,['vessel-a','vessel-b']);
  assert.equal(intent.baseRevision,17);
  assert.equal(intent.state,'pending');

  const storage = new MemoryStorage();
  queue.writePendingTaskCreation(storage,intent);
  storage.setItem(`${queue.PENDING_TASK_CREATION_STORAGE_PREFIX}broken`,'{"bad":true}');
  const restored = queue.readPendingTaskCreations(storage);
  assert.equal(restored.length,1,'損壞或不完整的待同步記錄不得執行');
  assert.equal(restored[0].task.description,'A船新增要事');
  assert.equal(queue.pendingTaskCreationMatchesContext(intent,'workspace-1','user-c'),true);
  assert.equal(queue.pendingTaskCreationMatchesContext(intent,'workspace-2','user-c'),false);
  assert.equal(queue.findPendingTaskCreationForTask(restored,'workspace-1','user-c',task.id)?.intentId,'intent-fixed-1');
  assert.equal(queue.findPendingTaskCreationForTask(restored,'workspace-2','user-c',task.id),undefined);
  assert.equal(queue.pendingTaskCreationMatchesContext(intent,'workspace-1','other-user'),false);

  const retrying = queue.markPendingTaskCreationRetrying(intent,'2026-08-05T08:02:00.000Z');
  assert.equal(retrying.attempts,1);
  assert.equal(retrying.state,'retrying');
  const waiting = queue.markPendingTaskCreationWaiting(retrying,'其他人正在編輯A船','2026-08-05T08:02:01.000Z',5000);
  assert.equal(waiting.state,'pending');
  assert.equal(queue.pendingTaskCreationMayRetry(waiting,Date.parse('2026-08-05T08:02:05.999Z')),false);
  assert.equal(queue.pendingTaskCreationMayRetry(waiting,Date.parse('2026-08-05T08:02:06.000Z')),true);

  const equalVersion = (left, right) => left.version === right.version;
  const exactState = {
    expectedLive:{version:1},
    expectedConfirmed:{version:1},
    currentLive:{version:1},
    currentConfirmed:{version:1},
    mutationApplied:false,
    equals:equalVersion,
  };
  assert.equal(queue.pendingTaskCreationAppStateIsCurrent(exactState),true,'未變更的精確基線應允許重試');
  assert.equal(queue.pendingTaskCreationAppStateIsCurrent({...exactState,currentLive:{version:2}}),false,'fetch等待期間的本機修改必須使remote套用失效');
  assert.equal(queue.pendingTaskCreationAppStateIsCurrent({...exactState,currentConfirmed:{version:2}}),false,'自身mutation前的confirmed基線漂移必須使重試失效');
  assert.equal(queue.pendingTaskCreationAppStateIsCurrent({...exactState,currentConfirmed:{version:2},mutationApplied:true}),true,'自身mutation後可接受自身cloud confirmation，但live仍須精確匹配');
  assert.equal(queue.pendingTaskCreationAppStateIsCurrent({...exactState,currentLive:{version:2},currentConfirmed:{version:2},mutationApplied:true}),false,'自身mutation後仍不得忽略其他本機修改');

  queue.removePendingTaskCreation(storage,intent.intentId);
  assert.equal(queue.readPendingTaskCreations(storage).length,0);

  assert.ok(app.includes('pendingTaskCreationMatchesContext'), 'App重試前必須核對workspace及使用者');
  assert.ok(app.includes('taskCreationAlreadyCommitted'), '重試必須以固定task ID識別已成功的新增，避免重複');
  assert.ok(app.includes('creationSectionKey=taskCreationLockKey(intent.primaryVesselId,intent.taskId)'), '重試必須重新取得完全相符的creation sentinel');
  assert.ok(app.includes("transientCloudBlockLockGuards.current.set(`${creationSectionKey}|${creationLeaseOwnerId}`"), 'pending重試必須把creation sentinel提交為原子雲端保存guard');
  assert.ok(app.includes('Date.now()<creationValidatedUntilMs'), 'pending重試不得在creation lease保守到期後繼續本機mutation');
  assert.ok(app.includes('pendingTaskCreationsRef.current.length>0'), '待同步要事必須納入離頁及版本更新阻擋');
  assert.ok(app.includes('writePendingTaskCreation(window.localStorage'), '被船舶鎖阻擋時必須先耐久寫入獨立本機意圖');
  assert.ok(app.includes('findPendingTaskCreationForTask'), '同一workspace／使用者／task重複點保存時必須重用既有intent');
  assert.ok(app.includes('if(!replaceTask)next={...next,task:durableCurrent.task}'), 'retry／waiting狀態回寫不得覆蓋另一分頁剛保存的較新草稿payload');
  assert.ok(app.includes('pendingTaskCreationAppStateIsCurrent'), 'pending重試每個remote套用／ack邊界必須核對精確AppData基線');
  assert.ok(app.includes('pendingRun?.adoptRemoteBase(creationBase)'), 'saveTask接受更新的remote建立基線後必須同步更新pending guard');
  assert.ok(app.includes("const otherUnsaved=Boolean("), '新增要事durable後仍須獨立判斷是否有其他未保存修改');
  assert.ok(app.includes("setSavePhase(otherUnsaved?'dirty':remaining.length?'queued':'saved')"), '存在其他本機修改時不得宣稱整頁已保存');
  assert.ok(app.includes('removePendingTaskCreation(window.localStorage'), '只有雲端確認或確認已存在後才可移除待同步意圖');
  assert.ok(version.includes("pendingTaskCreations?: number"), '版本更新原因必須明確理解待同步要事數量');
} finally {
  await server.close();
}
console.log('Pending task creation queue contracts passed.');
