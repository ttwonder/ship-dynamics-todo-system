import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const utils = fs.readFileSync('src/utils.ts', 'utf8');
const meetings = fs.readFileSync('src/TemporaryMeetings.tsx', 'utf8');
const modals = fs.readFileSync('src/EditModals.tsx', 'utf8');
const cloud = fs.readFileSync('src/cloud.ts', 'utf8');
const css = fs.readFileSync('src/styles.css', 'utf8');
const normalizer = fs.readFileSync('src/normalize.ts', 'utf8');
const meetingAccess = fs.readFileSync('src/meetingAccess.ts', 'utf8');
const meetingTasks = fs.readFileSync('src/meetingTaskWorkflow.ts', 'utf8');

const checks = [
  ['登入頁不得公開預設密碼', !app.includes('初始測試密碼') && !app.includes('操作員初始密碼')],
  ['本機資料需正規化', app.includes('normalizeAppData(loadLocal())')],
  ['操作員未指派不得看到全部船舶', !app.includes('v.assignedUserIds.length === 0 || v.assignedUserIds.includes(user.id)')],
  ['新增事項需使用未落庫 draft', app.includes('creatingTask') && !app.includes("d.tasks.unshift({ id, vesselId, priority:'中'" )],
  ['統計需從不受 closedMode 影響的集合計算', app.includes('statsTasks')],
  ['空白報告需阻止開啟', app.includes("請至少選擇一艘船舶再預覽報告")],
  ['查無事項需顯示空狀態', app.includes('目前沒有符合條件的事項')],
  ['管理頁需有 handler/render 雙層防護', app.includes("hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement')") && app.includes("tab==='management' && canEnterManagement")],
  ['Owner 初始化前需先完成個人登入', app.includes('!ownerExists && !currentUser') && app.includes('OwnerSetup currentUser={currentUser}') && !app.includes('Owner 人員</label><select')],
  ['保存需使用雲端 revision CAS', app.includes('saveCloudData(next, lastCloudRevision.current)')],
  ['啟動版本分歧需阻擋雲端寫入', app.includes('data.revision > remote.revision') && app.includes('setCloudWriteBlocked(true)') && app.includes('if (cloudWriteBlocked)')],
  ['工作區 identity 不同或來源未知時不得自動初始化空雲端', app.includes('CLOUD_CACHE_IDENTITY_KEY') && app.includes('localStorage.getItem(STORAGE_KEY) !== null') && app.includes('identityChanged || unknownDirtyCache') && app.includes('為避免跨工作區複製')],
  ['每次保存與同步皆需重新驗證目前 workspace identity', app.includes('currentIdentity !== activeCloudIdentity.current') && (app.match(/hasCurrentCloudIdentity\(\)/g) || []).length >= 2 && app.includes("cloudIdentity(latestConfig)!==syncIdentity") && app.includes('雲端設定在載入期間變更')],
  ['自動、手動保存與同步需共用串行／互斥控制', app.includes('cloudSaveInFlight') && app.includes('pendingCloudData') && app.includes('while (pendingCloudData.current)') && app.includes('enqueueCloudSave(data)') && app.includes('cloudSyncInFlight') && app.includes('cloudSyncing')],
  ['本機保存不得誤報已保存雲端', app.includes('已保存於本機瀏覽器')],
  ['臨時會議需限制授權角色修改', meetings.includes('canEditTemporaryMeetings(data.settings.rolePermissions, currentUser)') && meetingAccess.includes("hasPermission(matrix, user, 'manageMeetings') && hasPermission(matrix, user, 'viewAllVessels')")],
  ['臨時會議不得保存零艘範圍', meetings.includes("if (!resolvedVesselIds.length) return alert('請至少選擇一艘船舶')")],
  ['會議跟進事項需帶來源 meeting id', meetingTasks.includes('sourceMeetingId: meetingId')],
  ['會議跟進事項需避免重複', meetingTasks.includes('canonicalByVessel') && meetingTasks.includes("task.sourceMeetingId === meetingId") && meetingTasks.includes('重複的臨會/專題待辦')],
  ['操作員不可修改船舶經管人', modals.includes('canManage(currentUser)')],
  ['正規化器需存在核心集合驗證', normalizer.includes('normalizeAppData') && normalizer.includes('raw.users')],
  ['正規化器需先過濾 null 物件及非字串陣列元素', normalizer.includes('objects(raw.users)') && normalizer.includes('strings(item.departments)') && normalizer.includes('normalizeStatusLogs')],
  ['雲端保存需偵測衝突', cloud.includes('CloudConflictError') && cloud.includes(".eq('revision', expectedRevision)")],
  ['雲端保存不得保留 force-upsert 旁路', !cloud.includes('.upsert(') && cloud.includes('expectedRevision: number')],
  ['操作員臨時會議表單需原生禁用', meetings.includes('<fieldset disabled={!editable}')],
  ['中窄版臨時會議需改為單欄', css.includes('@media (max-width:900px)') && css.includes('.temporary-meeting-workspace')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n${failed} audit regression checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} audit regression checks passed.`);
