import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const dashboard = fs.readFileSync('src/Dashboard.tsx', 'utf8');
const batch = fs.existsSync('src/BatchManagedVesselModal.tsx') ? fs.readFileSync('src/BatchManagedVesselModal.tsx', 'utf8') : '';
const styles = fs.readFileSync('src/styles.css', 'utf8');

assert.ok(dashboard.includes('批量更新自管船舶'), '船舶看板頁首需有「批量更新自管船舶」按鈕');
assert.ok(dashboard.includes('onOpenBatchManagedVessels'), 'Dashboard 需把批量更新按鈕接到 App 層');
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
assert.ok(batch.includes('managedVessels') && batch.includes("currentUser.role === 'owner' || currentUser.role === 'admin' ? vessels") && batch.includes('vessel.assignedUserIds.includes(currentUser.id)') && batch.includes('currentUser.managedVesselIds.includes(vessel.id)'), '批量清單必須讓 Owner／管理員使用可見船舶，其他人員只列自管船舶');
assert.ok(batch.includes('ScheduleDateTimeField'), '批量清單需沿用 ETA／ETB／ETD 日期＋可選時間欄位');
assert.ok(batch.includes('composeScheduleValue'), '批量清單需保存純日期或日期時間');
assert.ok(batch.includes('parseCargoLines') && batch.includes('cargoLines'), '批量清單需支援貨名貨量多行編輯');
assert.ok(batch.includes('onAddTask(vessel.id)'), '每艘船最後需提供新增要事按鈕');
assert.ok(batch.includes("commit(draft =>") && batch.includes("'批量更新自管船舶'"), '批量清單每次修改需透過正式 commit 保存並留痕');
assert.ok(batch.includes('lockedVesselIds') && batch.includes('已鎖定') && !batch.includes('開始編輯'), '批量清單開啟時全部船舶應已鎖定，不應再逐船開始編輯');
assert.ok(batch.includes('<fieldset disabled={!lockedVesselIds.includes(vessel.id)}') && batch.includes('if(!lockedVesselIds.includes(vesselId))return'), '未持有該船bundle lease時欄位與mutation callback都必須fail closed');
assert.ok(app.includes('acquireEditLockBundle(') && app.includes('requests=[...activeVessels]') && app.includes("result.status!=='owned'"), 'App 必須在開啟modal前取得全部可見經管船舶鎖，任一失敗不得開啟');
assert.ok(app.includes('commit={batchVesselCommit}') && app.includes("batchMutationLeaseIsOwned(`vessel:${entityId}`)"), 'App 必須在每次批量mutation boundary驗證exact vessel bundle lease');
assert.ok(app.includes('batchLockCoordinator.current.isCurrent') && app.includes('batchManagedSession.current===session') && app.includes('sameCloudConfig(getSupabaseConfig(),config)'), 'bundle claim必須重驗generation、modal session、authorization及immutable cloud config');
assert.ok(app.includes('批量船舶協作鎖續期失敗') && app.includes('releaseBatchEditLockSnapshot') && app.includes('invalidateBatchManagedLocks'), '全部船舶鎖必須整組續期、失效與釋放');
assert.ok(app.includes('if(addTaskForVessel(id,false,true))closeBatchManaged()'), '從批量清單轉入新增要事前必須先關閉並釋放整組鎖');
assert.ok(styles.includes('.batch-managed-modal') && styles.includes('.batch-managed-list'), '批量更新清單需有專用樣式');
console.log('Batch managed vessel update contracts passed.');
