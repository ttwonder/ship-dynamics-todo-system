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
assert.ok(app.includes('taskReturnBatchManaged'), '新增要事關閉／保存後需可回到批量更新清單');
assert.ok(app.includes('addTaskForVessel(id,false,true)'), '批量清單的新增要事需設定返回批量清單');
assert.ok(app.includes('setBatchManagedOpen(true)'), '關閉新增要事後需重新打開批量更新清單');

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
assert.ok(batch.includes('onBeginEdit(vessel)') && batch.includes("editableVesselId===vessel.id?'正在編輯':'開始編輯'"), '每艘船必須先明確取得編輯鎖才可開始修改');
assert.ok(batch.includes('<fieldset disabled={editableVesselId!==vessel.id}') && batch.includes('if(editableVesselId!==vesselId)return'), '未持有該船鎖時欄位與mutation callback都必須fail closed');
assert.ok(app.includes('commit={batchVesselCommit}') && app.includes("requireMutationLease(`vessel:${batchEditingVesselId}`)") && app.includes("entityId!==batchEditingVesselId"), 'App 必須在批次船舶正式mutation boundary驗證exact vessel lease與entity id');
assert.ok(app.includes("claimEditingLock(`vessel:${vessel.id}`") && app.includes('close={closeBatchManaged}'), '開始、切換與關閉批次船舶編輯必須沿用serialized claim/release lifecycle');
assert.ok(app.includes('const session=batchManagedSession.current') && app.includes('sessionIsCurrent') && app.includes('stillWanted?:()=>boolean'), 'batch modal session token must be revalidated across every awaited release and claim');
assert.ok(app.includes('batchManagedOpenRef.current=false;batchManagedSession.current+=1;lockCoordinator.current.invalidate()') && app.includes('if(addTaskForVessel(id,false,true))closeBatchManaged()'), 'close and add-task navigation must synchronously invalidate pending batch claims');
assert.ok(styles.includes('.batch-managed-modal') && styles.includes('.batch-managed-list'), '批量更新清單需有專用樣式');
console.log('Batch managed vessel update contracts passed.');
