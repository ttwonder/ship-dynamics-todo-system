import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app = fs.readFileSync('src/App.tsx','utf8');
const version = fs.readFileSync('src/appVersionUpdate.ts','utf8');
const queueSource = fs.readFileSync('src/pendingTaskCreation.ts','utf8');

class MemoryStorage {
  map = new Map();
  get length(){ return this.map.size; }
  key(index){ return [...this.map.keys()][index] ?? null; }
  getItem(key){ return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key,value){ this.map.set(key,String(value)); }
  removeItem(key){ this.map.delete(key); }
}

class SerialLockManager {
  tail = Promise.resolve();
  request(_name,_options,callback){
    const run=this.tail.then(()=>callback());
    this.tail=run.catch(()=>undefined);
    return run;
  }
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

  const submittedTask={...task,statusLogs:[{id:'stable-log-1',at:'2026-08-05T08:01:30.000Z',by:'C',byUserId:'user-c',text:'待處理'}]};
  const submittedIntent=queue.createPendingTaskCreationIntent({
    intentId:'intent-submitted-1',workspaceIdentity:'workspace-1',userId:'user-c',task:submittedTask,
    primaryVesselId:'vessel-a',vesselIds:['vessel-a','vessel-b'],baseRevision:17,
  },'2026-08-05T08:01:30.000Z');
  assert.equal(queue.taskCreationAlreadyCommitted(submittedIntent,structuredClone(submittedTask)),true,'完整payload相符才可確認pending新增已提交');
  assert.equal(queue.taskCreationAlreadyCommitted(submittedIntent,{description:submittedTask.description,...submittedTask}),true,'物件欄位順序不同但內容相同時仍應確認為同一payload');
  assert.equal(queue.taskCreationAlreadyCommitted(submittedIntent,{...submittedTask,description:'雲端仍是較舊payload'}),false,'相同task ID／建立來源不得把較舊payload誤認為較新草稿已提交');

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

  await assert.rejects(
    queue.withPendingTaskCreationStorageLock(()=>true,null),
    /跨分頁鎖/,
    '瀏覽器不支援Web Lock時必須fail closed，不能退回不安全的getItem/setItem',
  );
  const lockedStorage = new MemoryStorage();
  const lockManager = new SerialLockManager();
  queue.writePendingTaskCreation(lockedStorage,intent);
  let releaseSlowProcessor;
  let processorHasRead;
  const processorRead = new Promise(resolve=>{ processorHasRead=resolve; });
  const processorMayWrite = new Promise(resolve=>{ releaseSlowProcessor=resolve; });
  const slowProcessor = queue.withPendingTaskCreationStorageLock(async()=>{
    const stale=queue.readPendingTaskCreations(lockedStorage)[0];
    processorHasRead();
    await processorMayWrite;
    queue.writePendingTaskCreation(lockedStorage,queue.markPendingTaskCreationWaiting(stale,'等待','2026-08-05T08:03:00.000Z',3000));
  },lockManager);
  await processorRead;
  const newerTask={...task,description:'另一分頁的較新草稿'};
  const editorWrite=queue.withPendingTaskCreationStorageLock(()=>{
    queue.writePendingTaskCreation(lockedStorage,queue.replacePendingTaskCreationTask(intent,newerTask,'2026-08-05T08:03:01.000Z'));
  },lockManager);
  releaseSlowProcessor();
  await Promise.all([slowProcessor,editorWrite]);
  assert.equal(queue.readPendingTaskCreations(lockedStorage)[0].task.description,'另一分頁的較新草稿','同一把Web Lock必須阻止status write覆蓋較新草稿');

  const acknowledged = await queue.acknowledgePendingTaskCreation(lockedStorage,intent.intentId,intent.task,lockManager);
  assert.equal(acknowledged.removed,false,'舊retry不得刪除另一分頁已更新的payload');
  assert.equal(acknowledged.remaining[0].task.description,'另一分頁的較新草稿');
  await queue.withPendingTaskCreationStorageLock(()=>queue.removePendingTaskCreation(lockedStorage,intent.intentId),lockManager);
  const missingUpdate = await queue.updatePendingTaskCreationIfPresent(lockedStorage,waiting,{},lockManager);
  assert.equal(missingUpdate.status,'missing','已刪除intent的較慢status write不得復活記錄');
  assert.equal(queue.readPendingTaskCreations(lockedStorage).length,0);

  queue.removePendingTaskCreation(storage,intent.intentId);
  assert.equal(queue.readPendingTaskCreations(storage).length,0);

  assert.ok(app.includes('pendingTaskCreationMatchesContext'), 'App重試前必須核對workspace及使用者');
  assert.ok(app.includes('taskCreationAlreadyCommitted'), '重試必須以固定task ID識別已成功的新增，避免重複');
  const creationSaveSource=app.slice(app.indexOf('if(creating&&getSupabaseConfig())'),app.indexOf('if(!creating){'));
  assert.ok(
    creationSaveSource.includes('taskCreationRelatedLockKeys(taskVesselIds(candidate),candidate,isMeetingTaskSource(candidate))')
      && creationSaveSource.indexOf('taskCreationRelatedLockKeys(')<creationSaveSource.indexOf('acquireEditLockBundle('),
    '首次新增與pending共用的建立流程必須在取得bundle前規劃船舶鎖及精確內控建立鎖',
  );
  assert.ok(app.includes("const durable=await saveTask(intent.task,true,'',remote.revision,runContext);"), 'pending重試必須回到同一個已補齊建立關聯鎖的saveTask流程');
  assert.ok(app.includes('creationSectionKey=taskCreationLockKey(intent.primaryVesselId,intent.taskId)'), '重試必須重新取得完全相符的creation sentinel');
  assert.ok(app.includes("transientCloudBlockLockGuards.current.set(`${creationSectionKey}|${creationLeaseOwnerId}`"), 'pending重試必須把creation sentinel提交為原子雲端保存guard');
  assert.ok(app.includes('Date.now()<creationValidatedUntilMs'), 'pending重試不得在creation lease保守到期後繼續本機mutation');
  assert.ok(app.includes('pendingTaskCreationsRef.current.length>0'), '待同步要事必須納入離頁及版本更新阻擋');
  assert.ok(app.includes('await upsertPendingTaskCreationForTask(window.localStorage'), '被船舶鎖阻擋時必須在跨分頁交易內耐久寫入獨立本機意圖');
  assert.ok(queueSource.includes('findPendingTaskCreationForTask(readPendingTaskCreations(storage)'), '同一workspace／使用者／task重複點保存時必須在鎖內重用既有intent');
  assert.ok(app.includes('updatePendingTaskCreationIfPresent')&&queueSource.includes("task:options.replaceTask ? structuredClone(next.task) : structuredClone(current.task)"), 'retry／waiting狀態回寫不得覆蓋另一分頁剛保存的較新草稿payload');
  assert.ok(app.includes('withPendingTaskCreationStorageLock'), 'pending新增、更新、刪除及context transition必須共用瀏覽器跨分頁鎖');
  assert.ok(!app.includes('writePendingTaskCreation(window.localStorage'), 'App不得在跨分頁鎖外直接寫入pending intent');
  assert.ok(!app.includes('removePendingTaskCreation(window.localStorage'), 'App不得在跨分頁鎖外直接刪除pending intent');
  const configTransition=app.slice(app.indexOf('const saveCloudConfiguration = async'),app.indexOf('const leaveCurrentIdentity = async'));
  assert.ok(configTransition.includes('await withPendingTaskCreationStorageLock')&&configTransition.includes('readPendingTaskCreations(window.localStorage)'), 'Supabase設定切換必須在最後提交點鎖定並重讀durable pending queue');
  const identityTransition=app.slice(app.indexOf('const leaveCurrentIdentity = async'),app.indexOf('const readOnlyTask='));
  assert.ok(identityTransition.includes('await withPendingTaskCreationStorageLock')&&identityTransition.includes('readPendingTaskCreations(window.localStorage)'), '身份切換必須在最後提交點鎖定並重讀durable pending queue');
  assert.ok(app.includes('pendingTaskCreationAppStateIsCurrent'), 'pending重試每個remote套用／ack邊界必須核對精確AppData基線');
  assert.ok(app.includes('pendingRun?.adoptRemoteBase(creationBase)'), 'saveTask接受更新的remote建立基線後必須同步更新pending guard');
  assert.ok(app.includes("const otherUnsaved=Boolean("), '新增要事durable後仍須獨立判斷是否有其他未保存修改');
  assert.ok(app.includes("setSavePhase(otherUnsaved?'dirty':remaining.length?'queued':'saved')"), '存在其他本機修改時不得宣稱整頁已保存');
  assert.ok(app.includes('await acknowledgePendingTaskCreation(window.localStorage'), '只有雲端確認且durable payload仍相符時才可移除待同步意圖');
  assert.ok(app.match(/const newerDraftPending=remaining\.some\(item=>item\.intentId===intent\.intentId\);/g)?.length===2, 'remote-match與CAS-success都必須辨識同一intent的較新durable草稿');
  assert.ok(app.match(/雲端已確認較早版本；同一要事的較新草稿尚未保存到雲端/g)?.length===2, '較新草稿仍pending時不得把舊payload成功誤報成整筆已保存');
  assert.ok(version.includes("pendingTaskCreations?: number"), '版本更新原因必須明確理解待同步要事數量');
} finally {
  await server.close();
}
console.log('Pending task creation queue contracts passed.');
