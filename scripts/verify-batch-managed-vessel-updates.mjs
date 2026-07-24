import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const batch = fs.existsSync('src/BatchManagedVesselModal.tsx') ? fs.readFileSync('src/BatchManagedVesselModal.tsx', 'utf8') : '';
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(dashboard.includes('批量更新船舶'), '船舶看板頁首需有「批量更新船舶」按鈕');
assert.ok(dashboard.includes('onOpenBatchManagedVessels'), 'Dashboard 需把批量更新按鈕接到 App 層');
assert.ok(dashboard.includes('batchSelected') && dashboard.includes('setBatchSelected'), '批量更新必須有獨立的人工多選狀態，不得借用涉會船舶選取');
assert.ok(dashboard.includes('批量選取') && dashboard.includes('已選'), '船舶看板需提供清楚的批量選取操作與數量');
assert.ok(app.includes('batchManagedOpen'), 'App 需管理批量更新自管船舶彈窗狀態');
assert.ok(app.includes('<BatchManagedVesselModal'), 'App 需渲染批量更新彈窗');
assert.ok(app.includes('batchManaged:returnToBatchManaged') && app.includes('returnDestination?.batchManaged'), '新增要事關閉／保存後需只依最新 generation 的返回目的地回到批量更新清單');
assert.ok(app.includes('addTaskForVessel(id,false,true)'), '批量清單的新增要事需設定返回批量清單');
assert.ok(app.includes('void openBatchManagedVessels()'), '關閉新增要事後需重新取得全部船舶鎖才可回到批量清單');

for (const label of ['目前位置','上一港','下一港','航行狀態','速度','載況','ETA','ETB','ETD','貨名貨量','近期動態']) {
  assert.ok(batch.includes(label), `批量更新清單缺少欄位：${label}`);
}
for (const status of ['航行','拋錨','進港中','出港中','停泊','漂航']) {
  assert.ok(batch.includes(`<option>${status}</option>`), `批量更新航行狀態需提供「${status}」`);
}
assert.ok(app.includes('batchTargetVesselsFor(activeVessels,currentUser,batchSelectedVesselIds)'), 'App 必須先解析正式經管／有效代管與人工選取的exact target聯集');
assert.ok(!batch.includes("currentUser.role === 'owner' || currentUser.role === 'admin' ? vessels"), 'Owner／管理員不得因全船可見權限而把所有船舶誤納入自管批量清單');
assert.ok(batch.includes('ScheduleDateTimeField'), '批量清單需沿用 ETA／ETB／ETD 日期＋可選時間欄位');
assert.ok(batch.includes('composeScheduleValue'), '批量清單需保存純日期或日期時間');
assert.ok(batch.includes('parseCargoLines') && batch.includes('cargoLines'), '批量清單需支援貨名貨量多行編輯');
assert.ok(batch.includes('onAddTask(vessel.id)'), '每艘船最後需提供新增要事按鈕');
assert.ok(batch.includes("commit(draft =>") && batch.includes("'批量更新自管船舶'"), '批量清單每次修改需透過正式 commit 保存並留痕');
assert.ok(batch.includes('lockedVesselIds') && batch.includes('已鎖定') && !batch.includes('開始編輯'), '批量清單開啟時全部船舶應已鎖定，不應再逐船開始編輯');
assert.ok(batch.includes('<fieldset disabled={readOnly||!lockedVesselIds.includes(vessel.id)}') && batch.includes('if(readOnly||!lockedVesselIds.includes(vesselId))return'), '未持有該船bundle lease或雲端尚未確認時，欄位與mutation callback都必須fail closed');
assert.ok(app.includes('acquireEditLockBundle(') && app.includes("result.status!=='owned'"), 'App 必須以bundle原子取得全部目標船舶協作鎖，任一失敗不得開啟');
assert.ok(app.includes('batchSelectedVesselIds') && app.includes('batchTargetVesselIds'), '批量目標需由正式經管／有效代管與人工選取船舶組成');
assert.ok(app.includes("alert('未有經管船舶或未選中船舶')"), '兩種批量來源皆為空時必須顯示指定提示');
assert.ok(app.includes('batchTargetVesselIdsRef.current=new Set') && app.includes('batchTargetVesselIdsRef.current.has(vesselId)'), '開啟時必須凍結exact target IDs，mutation不得擴到未選船舶');
assert.ok(app.includes('requests=[...batchTargetVessels]'), '雲端bundle只能claim本次exact target船舶');
assert.ok(app.includes('commit={batchVesselCommit}') && app.includes("batchMutationLeaseIsOwned(`vessel:${entityId}`,prev,mutationAuthorization)"), 'App 必須在每次批量mutation boundary以最新AppData及原render session token驗證exact vessel bundle lease');
assert.ok(app.includes('setData(prev=>{') && app.includes('authorizationEpochFor(snapshot,liveUser)') && app.includes('const renderedBatchManagedAuthorization=batchManagedAuthorization.current'), '批量mutation必須在render時捕獲不可變session token，並在setData updater內以最新身份、權限及經管範圍原子重驗');
assert.ok(app.includes('batchMutationSessionIsCurrent({renderedAuthorization') && app.includes("cloudIdentity(getSupabaseConfig())"), '批量mutation必須執行session行為guard，且本機開啟後出現雲端配置時立即fail closed');
assert.ok(!app.includes('if(!batchManagedOpen||batchLocalMode.current||!batchEditLocks.length)return'), '本機批量session也必須監聽雲端配置變更，不得跳過生命週期guard');
assert.ok(app.includes('batchLockCoordinator.current.isCurrent') && app.includes('batchManagedSession.current===session') && app.includes('sameCloudConfig(getSupabaseConfig(),config)'), 'bundle claim必須重驗generation、modal session、authorization及immutable cloud config');
assert.ok(app.includes('批量船舶協作鎖續期失敗') && app.includes('releaseBatchEditLockSnapshot') && app.includes('invalidateBatchManagedLocks'), '全部船舶鎖必須整組續期、失效與釋放');
assert.ok(app.includes('if(await closeBatchManaged())addTaskForVessel(id,false,true)'), '從批量清單轉入新增要事前必須先完成雲端保存及整組釋放，才可建立返回上下文');
const closeStart=app.indexOf('const closeBatchManaged=async()=>');
const closeEnd=app.indexOf('\n  const discardBatchManagedChanges=',closeStart);
const closeBranch=app.slice(closeStart,closeEnd);
assert.ok(closeBranch.includes('const operation=beginBatchManagedOperation()')&&closeBranch.indexOf('await flushCloudBeforeBatchRelease()')<closeBranch.indexOf('await releaseBatchEditLockSnapshot(operation.locks,false)')&&closeBranch.indexOf('await releaseBatchEditLockSnapshot(operation.locks,false)')<closeBranch.lastIndexOf('batchManagedOperationIsCurrent(operation)')&&closeBranch.lastIndexOf('batchManagedOperationIsCurrent(operation)')<closeBranch.indexOf('detachBatchManagedState(')&&closeBranch.includes('return released'), 'close必須捕獲own session/locks，等雲端ack及釋鎖後重驗，stale操作不得detach新session');
assert.ok(app.includes('batchManagedWriteSuspendedRef.current=true') && app.includes('if(batchManagedWriteSuspendedRef.current)return false'), 'close開始後必須以同步ref立即阻擋最後一個stale render mutation callback');
assert.ok(batch.includes("saving?'雲端確認中…':readOnly?'重試保存並關閉':'完成並關閉'"), '雲端保存失敗時modal需保持鎖定且提供重試關閉，不得假裝已完成');
assert.ok(batch.includes('放棄本批修改並釋鎖')&&batch.includes('onClick={discard}'), '雲端衝突後modal需提供明確放棄並釋鎖的恢復動作');
const discardStart=app.indexOf('const discardBatchManagedChanges=async()=>');
const discardEnd=app.indexOf('\n  const openBatchManagedVessels=',discardStart);
const discardBranch=app.slice(discardStart,discardEnd);
const discardRelease=discardBranch.indexOf('const released=await releaseBatchEditLockSnapshot(operation.locks,false)');
const discardPostReleaseGuard=discardBranch.indexOf('if(!batchManagedOperationIsCurrent(operation))return;',discardRelease);
assert.ok(discardStart>=0&&discardBranch.includes('const operation=beginBatchManagedOperation()')&&discardBranch.indexOf('fetchCloudData')<discardRelease&&discardRelease<discardPostReleaseGuard&&discardPostReleaseGuard<discardBranch.indexOf("detachBatchManagedState('')")&&discardBranch.indexOf("detachBatchManagedState('')")<discardBranch.indexOf('setData(remote)'), '放棄流程必須捕獲own session/locks，先取得可信remote，再釋鎖重驗、關閉自己的modal並替換本機');
const discardCatch=discardBranch.slice(discardBranch.indexOf('}catch(error:any){'));
assert.ok(discardCatch.includes('船舶鎖仍保留')&&!discardCatch.includes('detachBatchManagedState('), '放棄流程抓取remote失敗時不得關閉modal或假裝已釋鎖');
const openBranch=app.slice(discardEnd);
const nonOwnedBranch=openBranch.slice(openBranch.indexOf("if(result.status!=='owned')"),openBranch.indexOf("if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(generation)){"));
assert.ok(nonOwnedBranch.indexOf('if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(generation))return')<nonOwnedBranch.indexOf('batchManagedRequested.current=false'), '舊bundle claim完成不得清除新session requested狀態');
assert.ok(app.includes('registerTrackedLease(batchLeaseReleaseState.current,request,config)')&&app.includes('result.cleanupUnresolved.length')&&app.includes('pendingTrackedLeases(batchLeaseReleaseState.current)'), 'claim前需保存immutable config，rollback unresolved token需進入下次開啟前重試流程');
assert.ok(styles.includes('.batch-managed-modal') && styles.includes('.batch-managed-list'), '批量更新清單需有專用樣式');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const { userCanManageVesselByAssignmentOrDelegation } = await server.ssrLoadModule('/src/vesselDelegation.ts');
  const { createBatchManagedAuthorization, batchMutationSessionIsCurrent } = await server.ssrLoadModule('/src/batchManagedAuthorization.ts');
  const { authorizationEpochFor, batchTargetVesselsFor, batchSessionVesselsFor, batchManagedOperationMatches } = await server.ssrLoadModule('/src/App.tsx');
  const { createInitialData } = await server.ssrLoadModule('/src/data/seed.ts');
  const { default: BatchManagedVesselModal } = await server.ssrLoadModule('/src/BatchManagedVesselModal.tsx');
  const supervisor = { id:'supervisor', role:'admin', managedVesselIds:['managed-by-user'] };
  const vessel = (id, assignedUserIds=[], delegateManagers=[]) => ({ id, assignedUserIds, delegateManagers });
  const vessels = [
    vessel('managed-by-user'),
    vessel('managed-by-vessel', ['supervisor']),
    vessel('active-delegation', [], [{ userId:'supervisor', isActive:true }]),
    vessel('inactive-delegation', [], [{ userId:'supervisor', isActive:false }]),
    vessel('visible-only'),
  ];
  assert.deepEqual(
    vessels.filter(item => userCanManageVesselByAssignmentOrDelegation(item, supervisor)).map(item => item.id),
    ['managed-by-user', 'managed-by-vessel', 'active-delegation'],
    '管理員／督導的自管批量範圍只能包含正式經管與有效代管船舶，不得因可看全船而鎖定其他船舶',
  );

  const initial = createInitialData();
  const manualUser = { ...initial.users[0], id:'manual-supervisor', role:'admin', isActive:true, managedVesselIds:[] };
  const manualCandidates = initial.vessels.slice(0,4).map((item,index) => ({ ...item, isActive:index!==3, assignedUserIds:[], delegateManagers:[] }));
  assert.deepEqual(batchTargetVesselsFor(manualCandidates,manualUser,[]).map(item=>item.id), [], '沒有經管／有效代管且沒有人工選取時，批量目標必須為空');
  assert.deepEqual(batchTargetVesselsFor(manualCandidates,manualUser,[manualCandidates[0].id,manualCandidates[1].id]).map(item=>item.id), manualCandidates.slice(0,2).map(item=>item.id), '沒有經管關係時，人工多選需成為exact target');
  const openingTargetIds = new Set(batchTargetVesselsFor(manualCandidates,manualUser,[manualCandidates[0].id,manualCandidates[1].id]).map(item=>item.id));
  assert.deepEqual(batchSessionVesselsFor(manualCandidates,openingTargetIds).map(item=>item.id), manualCandidates.slice(0,2).map(item=>item.id), '開啟後即使checkbox準備了下一次選取，當前modal membership仍須使用凍結opening IDs');
  manualCandidates[0].assignedUserIds=[manualUser.id];
  manualCandidates[1].delegateManagers=[{ userId:manualUser.id, isActive:true }];
  assert.deepEqual(batchTargetVesselsFor(manualCandidates,manualUser,manualCandidates.map(item=>item.id)).map(item=>item.id), manualCandidates.slice(0,3).map(item=>item.id), '批量目標必須是經管、有效代管與人工選取的去重聯集，inactive人工選取需排除');
  const operationAuthorization = { session:1, authorizationEpoch:'epoch-1', userId:manualUser.id, cloudIdentity:'workspace-1' };
  const operation = { id:1, session:1, authorization:operationAuthorization, locks:[{sectionKey:'vessel:old',leaseOwnerId:'old-lease'}] };
  assert.equal(batchManagedOperationMatches(operation,1,1,operationAuthorization,true), true);
  assert.equal(batchManagedOperationMatches(operation,2,2,{...operationAuthorization,session:2},true), false, '舊close/discard operation不得通過新session重驗');
  assert.equal(batchManagedOperationMatches(operation,1,1,operationAuthorization,false), false, 'modal失效後舊operation必須fail closed');
  const newSessionLocks=[{sectionKey:'vessel:new',leaseOwnerId:'new-lease'}];
  assert.deepEqual(operation.locks,[{sectionKey:'vessel:old',leaseOwnerId:'old-lease'}]);
  assert.notDeepEqual(operation.locks,newSessionLocks,'舊operation必須保留own lock snapshot，不得讀取新session全局locks');
  const pagingUser = { ...initial.users[0], id:'paging-owner', role:'owner', isActive:true };
  const pagingVessels = initial.vessels.map(item => ({ ...item, assignedUserIds:[pagingUser.id] }));
  const pagingHtml = renderToStaticMarkup(React.createElement(BatchManagedVesselModal, {
    vessels:pagingVessels,
    currentUser:pagingUser,
    lockedVesselIds:pagingVessels.map(item=>item.id),
    readOnly:false,
    saving:false,
    commit:()=>{},
    close:()=>{},
    onAddTask:()=>{},
  }));
  const renderedCards = (pagingHtml.match(/class="batch-managed-card"/g)||[]).length;
  assert.ok(renderedCards > 0 && renderedCards <= 8, `40船批量modal每頁最多只應渲染8張完整表單，實際 ${renderedCards}`);
  assert.match(pagingHtml, /40 艘/, '分頁後仍須明示全部已鎖定／可更新的總船數');
  assert.match(pagingHtml, /第 1 \/ 5 頁/, '40船批量modal需提供頁次，避免一次掛載全部表單');
  const assignedVesselId = initial.vessels[0].id;
  const epochUser = { ...initial.users[0], id:'epoch-supervisor', role:'admin', isActive:true, managedVesselIds:[assignedVesselId] };
  const epochData = {
    ...initial,
    users:[epochUser],
    vessels:initial.vessels.map(item => item.id===assignedVesselId ? { ...item, assignedUserIds:['epoch-supervisor'] } : item),
  };
  const openingEpoch = authorizationEpochFor(epochData, epochUser);
  const revokedData = structuredClone(epochData);
  revokedData.users[0].managedVesselIds=[];
  revokedData.vessels[0].assignedUserIds=[];
  assert.notEqual(authorizationEpochFor(revokedData, revokedData.users[0]), openingEpoch, '正式經管範圍撤銷後授權epoch必須立即改變，舊批量callback不得提交');
  const permissionRevokedData = structuredClone(epochData);
  permissionRevokedData.settings.rolePermissions.admin.editBusinessContent=false;
  assert.notEqual(authorizationEpochFor(permissionRevokedData, permissionRevokedData.users[0]), openingEpoch, '批量編輯權限撤銷後授權epoch必須立即改變，舊批量callback不得提交');

  let currentAuthorization = createBatchManagedAuthorization({ session:1, authorizationEpoch:'epoch-a', userId:'user-a', cloudIdentity:'' });
  let currentSession = 1;
  let liveEpoch = 'epoch-a';
  let liveUserId = 'user-a';
  let currentCloudIdentity = '';
  const committed = [];
  const callbackFromSession = renderedAuthorization => () => {
    if(batchMutationSessionIsCurrent({ renderedAuthorization, currentAuthorization, currentSession, liveAuthorizationEpoch:liveEpoch, liveUserId, currentCloudIdentity }))committed.push(renderedAuthorization.session);
  };
  const staleSessionACallback = callbackFromSession(currentAuthorization);
  currentAuthorization = createBatchManagedAuthorization({ session:2, authorizationEpoch:'epoch-a', userId:'user-a', cloudIdentity:'' });
  currentSession = 2;
  staleSessionACallback();
  assert.deepEqual(committed, [], 'session A 舊 callback 不得搭便車 session B 的新 authorization 或 lease');
  callbackFromSession(currentAuthorization)();
  assert.deepEqual(committed, [2], '目前 session 的 callback 應通過不可變 token 驗證');

  const localAuthorization = currentAuthorization;
  currentCloudIdentity = 'https://cloud.example|app_state|workspace|anon';
  assert.equal(batchMutationSessionIsCurrent({ renderedAuthorization:localAuthorization, currentAuthorization, currentSession, liveAuthorizationEpoch:liveEpoch, liveUserId, currentCloudIdentity }), false, '本機 session 開啟後若雲端配置出現，mutation 必須立即 fail closed');
  assert.equal(Object.isFrozen(localAuthorization), true, '批量 session authorization token 必須不可變');
} finally {
  await server.close();
}

console.log('Batch managed vessel update contracts passed.');
