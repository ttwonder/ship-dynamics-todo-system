import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const categories = await server.ssrLoadModule('/src/taskCategories.ts');
  const names = await server.ssrLoadModule('/src/vesselDisplay.ts');
  const normalizer = await server.ssrLoadModule('/src/normalize.ts');
  const utils = await server.ssrLoadModule('/src/utils.ts');
  const editModals = await server.ssrLoadModule('/src/EditModals.tsx');

  assert.deepEqual(categories.REQUIRED_TASK_CATEGORIES, [
    '換員操作', '加油加水', '物料配件', '維修', 'Survey', '稽核檢查', 'PSC窗口', '事故',
    '證書', '缺失驗證', 'vetting', '貨品', '港口安排',
  ]);
  assert.deepEqual(categories.REQUIRED_MEETING_TASK_CATEGORIES, ['船員管理','船員培訓','稽核認證','船舶維護管理','岸基培訓','岸基人員管理']);
  assert.deepEqual(categories.attentionKeysForCategories(['換員操作', 'Survey', '證書']), ['crew-operation', 'survey']);
  assert.deepEqual(categories.mergeAttentionFromCategories(['psc-window'], ['維修', '證書']), ['psc-window', 'maintenance']);
  assert.deepEqual(categories.normalizeTaskCategoryList('臨時會議決議', []), ['臨會/專題']);
  assert.deepEqual(categories.normalizeTaskCategoryList('證書', ['證書', '貨品', '證書']), ['證書', '貨品']);
  assert.equal(names.vesselDisplayName({ id:'v1', name:'SA', shortName:'SA', fullName:'FPMC AURORA' }), 'FPMC AURORA');

  const normalized = normalizer.normalizeAppData({
    revision: 1, updatedAt: '2026-07-18T00:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:[], taskCategories:['人員','證書','臨時會議決議'], vesselStatuses:['裝載'], priorities:['急'], rolePermissions:{}, lastCloudSyncAt:'' },
    users: [],
    vessels: [{ id:'v1', name:'SA', shortName:'SA', fullName:'FPMC AURORA', isActive:true, position:{ manualRemark:'人工資訊' }, cargo:{}, note:{ statusList:['塢修/航修'], recentDynamics:'近期資訊', subsequentDynamics:'舊後續資訊' } }],
    tasks: [{ id:'t1', vesselId:'v1', category:'證書', description:'closed', isClosed:true }],
    meetings: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.tasks[0].categories, ['證書']);
  assert.equal(normalized.tasks[0].category, '證書');
  assert.ok(normalized.settings.taskCategories.includes('換員操作'));
  assert.ok(!normalized.settings.taskCategories.includes('臨會/專題'));
  assert.deepEqual(normalized.settings.meetingTaskCategories, categories.REQUIRED_MEETING_TASK_CATEGORIES);
  assert.ok(!normalized.settings.taskCategories.includes('人員'));
  assert.deepEqual(normalized.settings.vesselStatuses, ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar']);
  assert.deepEqual(normalized.vessels[0].note.statusList, ['drydock/repiar']);
  assert.equal(normalized.vessels[0].note.recentDynamics, '近期資訊\n舊後續資訊');
  assert.equal(normalized.vessels[0].note.subsequentDynamics, '');
  const readOnlyModalHtml=renderToStaticMarkup(React.createElement(editModals.TaskEditModal,{
    task:normalized.tasks[0], data:normalized, visibleVessels:normalized.vessels,
    currentUser:{id:'reviewer',department:'管理層',name:'檢視者',username:'reviewer',role:'admin',passwordHash:'',isActive:true,managedVesselIds:[]},
    canClose:false,canDelete:false,canCancelInternalControl:false,canEditOverall:false,readOnly:true,
    readOnlyReason:'其他使用者正在編輯此事項｜已讀取伺服器最新資料',close:()=>{},onSave:()=>false,onSaveVesselProgress:()=>false,onDelete:()=>{},
  }));
  assert.ok(readOnlyModalHtml.includes('只讀詳情')&&readOnlyModalHtml.includes('已讀取伺服器最新資料')&&readOnlyModalHtml.includes('aria-readonly="true"'),'被鎖事項詳情需清楚標示伺服器最新只讀狀態');
  assert.ok(!readOnlyModalHtml.includes('>保存變更</button>')&&!readOnlyModalHtml.includes('>刪除待辦</button>')&&!readOnlyModalHtml.includes('>標記結案</button>'),'只讀詳情不得渲染任何寫入操作按鈕');

  const ownerHash='b'.repeat(64);
  const userHash='c'.repeat(64);
  const migrationFixture = normalizer.normalizeAppData({
    revision: 7, updatedAt: '2026-07-18T00:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:['管理層'], taskCategories:[], rolePermissions:{}, nonOwnerPasswordResetVersion:1 },
    users: [
      { id:'owner', department:'管理層', name:'朱世毅', username:'owner', role:'owner', passwordHash:ownerHash, passwordVisible:'', isActive:true, managedVesselIds:[] },
      { id:'user', department:'管理層', name:'一般人員', username:'user', role:'operator', passwordHash:userHash, passwordVisible:'old', isActive:true, managedVesselIds:[] },
    ], vessels:[], tasks:[], meetings:[], agendaReports:[], auditLogs:[], notifications:[],
  });
  assert.equal(migrationFixture.users.find(user => user.id === 'owner').passwordHash, ownerHash);
  assert.equal(migrationFixture.users.find(user => user.id === 'user').passwordHash, '', '本次一律清除既有操作員密碼，讓目前操作員可無密碼登入');
  assert.equal(migrationFixture.settings.nonOwnerPasswordResetVersion, 2, '操作員密碼清除遷移需標記已完成，避免日後個人密碼被再次清除');
  const futurePersonalPassword = normalizer.normalizeAppData({ ...migrationFixture, settings: { ...migrationFixture.settings, nonOwnerPasswordResetVersion: 2 }, users: migrationFixture.users.map(user => user.id === 'user' ? { ...user, passwordHash: userHash } : user) });
  assert.equal(futurePersonalPassword.users.find(user => user.id === 'user').passwordHash, userHash, '完成本次清除後，操作員日後自行設定的個人密碼需保留');
  assert.equal('passwordVisible' in migrationFixture.users.find(user => user.id === 'user'), false, 'normalize 必須丟棄舊 plaintext passwordVisible');
  assert.equal('passwordVisible' in utils.sanitizeAppDataForStorage({ ...migrationFixture, users: [{ ...migrationFixture.users[1], passwordVisible:'old' }] }).users[0], false, '本機與雲端保存前必須以 UserAccount 白名單序列化，丟棄舊 plaintext password 欄位');
  const dashboard = fs.readFileSync('src/Dashboard.tsx','utf8');
  const app = fs.readFileSync('src/App.tsx','utf8');
  const editor = fs.readFileSync('src/EditModals.tsx','utf8');
  const morning = fs.readFileSync('src/MorningWorkspace.tsx','utf8');
  const meetings = fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
  const styles = fs.readFileSync('src/styles.css','utf8');
  const management = fs.readFileSync('src/Management.tsx','utf8');
  const workCenter = fs.readFileSync('src/WorkCenter.tsx','utf8');
  const workCenterScope = fs.readFileSync('src/workCenterScope.ts','utf8');
  const analysis = fs.readFileSync('src/DataAnalysis.tsx','utf8');
  const seed = fs.readFileSync('src/data/seed.ts','utf8');
  const normalizeSource = fs.readFileSync('src/normalize.ts','utf8');
  const cloudSource = fs.readFileSync('src/cloud.ts','utf8');
  const attentionSource = fs.readFileSync('src/vesselAttention.ts','utf8');
  assert.ok(dashboard.includes('船舶狀態') && dashboard.includes('vessel.note.statusList'), '看板載況旁必須顯示船舶狀態');
  assert.ok(editor.includes('categoryChoicesForTask') && editor.includes('draft.categories'), '新增要事／臨會待辦分類必須依來源使用各自分類並可多選');
  assert.ok(editor.includes("if (creating && !draft.vesselId) return alert('請選擇船舶')"), '新增要事的船舶必須由保存 handler 验证');
  assert.ok(editor.includes("if (creating && !draft.priority) return alert('請選擇關注程度')"), '新增要事的关注程度必须由保存 handler 验证');
  assert.ok(editor.includes("if (creating && !selectedCategories.length) return alert('請選擇分類')"), '新增要事的分类必须由保存 handler 验证');
  assert.ok(app.includes("category:'', categories:[]"), '新增要事分类必须初始为空并由使用者主动选择');
  assert.ok(editor.includes("if (creating && !draft.departments.length) return alert('請選擇涉及部門')"), '新增要事的涉及部门必须由保存 handler 验证');
  assert.ok(editor.includes('required={creating}') && editor.includes("label={hasMeetingScope?'臨會/專題待辦分類':'要事分類'} required={creating}") && editor.includes('label="涉及部門" required={creating}'), '新增要事的五个必选／必填字段必须显示原生或语义 required 标记');
  assert.ok(editor.includes('label="涉及部門" required={creating}') && editor.includes('label="追蹤窗口"'), '新增要事必须使用「追蹤窗口」标签');
  const vesselEditor = editor.slice(editor.indexOf('export function VesselEditModal'), editor.indexOf('export function TaskEditModal'));
  const taskEditor = editor.slice(editor.indexOf('export function TaskEditModal'));
  assert.ok(!vesselEditor.includes('經管／負責人'), '船舶快速更新不得显示或修改管理页经管／负责人');
  assert.ok(!taskEditor.includes('label="經管／負責人"'), '要事编辑器不得把事项涉及人员标为船舶经管／负责人');
  assert.ok(taskEditor.includes("currentUser.role!=='vessel'&&<MeetingPeoplePicker") && taskEditor.includes('disabled={globalReadOnly}'), '追蹤窗口需在新增與更新要事显示，并在只读模式明确禁用');
  assert.ok(app.includes('assignedOwnerUserIds') && app.includes('vessel.assignedUserIds'), '新增要事必须自动带入管理页已分配的船舶经管人员');
  assert.ok(!taskEditor.includes('assignedUserIds=') && !taskEditor.includes('managedVesselIds='), '事项涉及人员不得修改管理页船舶／人员分管');
  assert.ok(app.includes('createTaskOpenRequestCoordinator') && app.includes("taskOpenRequests.current.begin({vesselId:returnToVessel?vesselId:'',batchManaged:returnToBatchManaged})") && app.includes('const returnDestination=taskOpenRequests.current.consume()') && app.includes('returnDestination?.batchManaged') && app.includes('openVesselEditor(returnDestination.vesselId)') && app.includes('addTaskForVessel(id,true)'), '從快速更新進入新增要事後，取消或保存必須只消耗最新返回目的地並返回快速更新彈窗');
  assert.ok(app.includes('mergeAttentionFromCategories') && app.includes('saved.categories'), '保存要事必須同步點亮看板狀態');
  assert.ok(app.includes('closedFilters') && app.includes("tasks={closedTasks}"), '已結案頁需使用獨立篩選與已結案資料源');
  assert.ok(morning.includes('onAddTask') && morning.includes('＋ 新增待辦'), '早會討論區需提供新增待辦');
  assert.ok(app.includes('onAddTask={addTaskForVessel}'), 'App 必須把新增待辦动作接入早會');
  assert.ok(editor.includes('<label>近期／後續動態</label>') && !editor.includes('<label>後續動態</label>'), '快速更新只保留合併後的近期／後續動態欄位');
  assert.ok(dashboard.includes('人工備註') && dashboard.includes('近期／後續動態') && dashboard.includes('vessel.position.manualRemark') && dashboard.includes('vessel.note.recentDynamics'), '看板重要摘要需同時呈現人工備註及近期／後續動態');
  assert.ok(app.replace(/\s/g,'').includes('constreportVessels=activeVessels') && app.includes('const selectedIds=_selected.filter(id=>allowedIds.has(id))'), '每日早會報告只能使用授權船舶，且有選擇時需套用授權交集');
  assert.ok(!app.includes("請至少選擇一艘船舶再預覽報告"), '每日早會報告不得依涉會勾選阻擋匯出');
  assert.ok(app.includes('人工備註：') && app.includes('近期／後續動態：'), '早會 PDF 需分別呈現人工備註及近期／後續動態');
  assert.ok(app.includes('本報告依目前授權範圍、報告選擇'), '早會 PDF 頁腳需說明資料来源为授权范围与当前选择');
  assert.ok(meetings.includes('meetingExportSelection') && meetings.includes('匯出所選會議 PDF') && meetings.includes('匯出總清單 PDF'), '臨會總清單需提供多選會議 PDF 與總清單 PDF');
  assert.ok(meetings.includes('meeting-print-page') && meetings.includes('window.print()'), '臨會所選會議需使用獨立列印頁並逐會議分頁');
  assert.ok(styles.includes('.meeting-print-page') && styles.includes('break-after:page'), '臨會列印 CSS 需強制逐會議分頁');
  assert.ok(app.includes("currentUser?.role==='owner'||currentUser?.role==='admin'||hasPermission"), 'Owner／管理員應固定查看全部船舶');
  assert.ok(app.includes('vesselMatchesUser(v,currentUser,canViewAllVessels)') && !app.includes('involvedVesselIds') && workCenterScope.includes('explicitlyResponsible'), '负责人可在我的待办查看事项，但不得因此扩大看板、总表、已结案或统计的船舶资料范围');
  assert.ok(workCenter.includes('selectUserWorkCenterTasks(data,user,vessels)') && app.includes('selectUserWorkCenterTasks(roleVisibleData,currentUser,activeVessels)') && app.includes('data={roleVisibleData}') && workCenterScope.includes('meetingInvolvesUser') && workCenterScope.includes('isVesselDelegatedMeetingTask'), '我的待辦清單與導航數量必須共用同一歸屬 selector 與授權投影，並只包含分管督導、事項追蹤窗口、臨會追蹤窗口/負責人或已分派到單船跟蹤的待辦');
  assert.ok(normalizeSource.includes("user.role === 'admin' || user.role === 'operator'") && normalizeSource.includes('ownerUserIds.has(user.id)') && !normalizeSource.includes('managementUserIds'), 'Owner 不分管具體船舶；管理員與操作員可保留船舶經管關係');
  assert.ok(app.includes('aria-label="登入部門"') && app.includes('aria-label="登入人員"'), '登入頁應使用部門與人員下拉選擇');
  assert.ok(app.includes("const needsPassword=user.role==='owner'||user.role==='admin'||Boolean(user.passwordHash)") && app.includes('if(!needsPassword){setCurrentUserId(user.id);return;}') && app.includes('if(await sha256(pw)!==user.passwordHash)'), '登入密碼驗證需套用 Owner／管理員或已設定個人密碼者；沒有密碼的非管理角色可直接登入');
  assert.ok(app.includes("placeholder={selectedNeedsPassword?'請輸入密碼':'無密碼帳號可空白直接登入'}") && !app.includes('disabled={!selectedUser?.passwordHash}'), '登入頁需保留密碼輸入框，無密碼角色可空白直接登入');
  const plaintextPasswordSources = [app, management, seed, normalizeSource, fs.readFileSync('src/types.ts','utf8')].join('\n');
  assert.ok(!plaintextPasswordSources.includes('passwordVisible') && !plaintextPasswordSources.includes('DEFAULT_USER_PASSWORD') && !plaintextPasswordSources.includes('DEFAULT_SITE_PASSWORD') && !plaintextPasswordSources.includes('fpmc2026') && !plaintextPasswordSources.includes('ship2026'), '共享 AppData/localStorage/Supabase payload 不得保存或暴露可回復明文密碼');
  assert.ok(!seed.includes('DEFAULT_PASSWORD_HASH') && !seed.includes('OWNER_INITIAL_PASSWORD_HASH') && !seed.includes('SITE_PASSWORD_HASH') && seed.includes("passwordHash: ''") && seed.includes("sitePasswordHash: ''"), 'production seed 不得保存舊預設密碼 hash；首次使用需由使用者設定進站與 Owner 密碼');
  assert.ok(app.includes('needsSetup') && app.includes('首次使用請先設定進站密碼') && app.includes('初始化進站密碼') && app.includes('!siteUnlocked || !data.settings.sitePasswordHash'), '進站密碼需走首次設定流程；即使 sessionStorage unlock flag 殘留，未設定 hash 也必須進入 SiteGate');
  assert.ok(normalizeSource.includes('nonOwnerPasswordResetVersion') && !normalizeSource.includes('passwordVisible') && !normalizeSource.includes("user.passwordHash = '385b870"), '通用 normalize 不得重置或保留任何帳號明文憑據');
  assert.ok(!cloudSource.includes('needsPasswordResetPersistence') && !cloudSource.includes('persistPasswordMigrationCas') && app.includes("data.revision === remote.revision && data.updatedAt !== remote.updatedAt"), '读取／normalize 不得自动匿名写回密码迁移；同步仍须阻挡同 revision 的本机分歧');
  assert.ok(management.includes('Owner／管理員登入必須使用密碼') && management.includes('個人密碼選填；未設定時可無密碼登入') && management.includes('canClearPassword') && management.includes('Owner／管理員不可清除密碼') && management.includes('clearPersonPassword') && !management.includes('Owner 可查看'), 'Owner／管理員必須有密碼；非管理人員可選填個人密碼；管理頁不得查看既有明文');
  assert.ok(app.includes("['total',currentUser.role==='vessel'?'本船待辦':'待辦總表'],['closed','已結案'],['internalControl','內控異常'],['reports','報告中心'],['stats','數據分析']"), '主導航應依序為待辦總表、已結案、內控異常、報告中心、數據分析');
  assert.ok(app.includes('priorityTone') && app.includes('filter-chip-meeting') && app.includes('filter-chip-internal') && app.includes('filter-reset-btn'), '待辦總清單篩選 chip 必須依關注/分類/內控提供語義色 class');
  assert.ok(app.includes('<th>追蹤窗口</th>') && app.includes('const managerIds=[...new Set(t.ownerUserIds)]') && !app.includes('<th>經管人</th>'), '待辦總表需將經管人欄改為追蹤窗口，且只顯示待辦追蹤窗口 ownerUserIds');
  assert.ok(app.includes('className="task-vessel-column"') && app.includes('className="task-item-column"') && app.includes('className="task-status-column"'), '報告總清單需以語義 class 控制船名、分類事項與狀態列寬');
  assert.ok(styles.includes('.task-vessel-column{width:9%;min-width:0!important') && styles.includes('.task-item-column{width:22%;min-width:0!important') && styles.includes('.task-status-column{width:17%;min-width:0!important'), '列印報告需縮小船名與狀態欄、把主要空間給分類／事項，並解除三欄舊最小寬度干擾');
  assert.ok(app.includes('openTaskReadOnly') && app.includes("claimResult==='blocked'") && app.includes('configIoCoordinator.current.run(configToken,getSupabaseConfig,fetchCloudData)') && app.includes('taskOpenRequests.current.isCurrent(requestGeneration)') && app.includes('selectTasksVisibleToUser(sourceData.tasks,snapshotUser') && app.includes('buildTaskReadOnlyEditorData(sourceData,snapshotTask,projectedVesselId)') && app.includes('setTaskReadOnlyReason'), '被其他人鎖定的事項需以 immutable config 讀取伺服器最新資料、重新套用角色與最小化投影，且只有目前仍有效的請求可開啟只讀詳情');
  assert.ok(app.includes('const taskEditorReadOnly=') && app.includes('const taskEditorData=taskReadOnlyData?') && app.includes('const taskEditorUser=currentUser') && app.includes('currentUser={taskEditorUser}') && app.includes('readOnly={taskEditorReadOnly}'), '只讀詳情必須使用最小化資料狀態並強制禁用保存與修改，不得把完整伺服器 users 帶入 editor');
  assert.ok(styles.includes('.batch-task-table th:nth-child(7)') && styles.includes('.batch-task-table th:nth-child(8)') && styles.includes('.batch-task-table th:nth-child(10)') && styles.includes('min-width:260px'), '待辦總表部門/追蹤窗口/狀態欄寬需明確調整');
  assert.ok(app.includes('autoDepartmentFilterKey') && app.includes('setFilters(previous => ({ ...previous, departments: [currentUser.department] }))') && app.includes('setClosedFilters(previous => ({ ...previous, departments: [currentUser.department] }))'), '待辦清單需依登入用戶部門自動預選部門篩選，且只在用戶切換時套用');
  assert.ok(app.includes("toggleGroup=(key:'categories'|'meetingCategories'") && app.includes('filter-group-task') && app.includes('filter-group-meeting') && app.includes('全選／取消全部要事分類') && app.includes('全選／取消全部臨會/專題分類'), '要事分類與臨會/專題分類標題需可點擊全選/取消整組分類');
  assert.ok(app.includes('filter-reset-btn" onClick={()=>setFilters({...emptyFilters,closedMode:filters.closedMode})}>清除篩選</button><button className="btn small ghost" onClick={toggleAll}'), '清除篩選按鈕需移到全選本頁前面');
  assert.ok(styles.includes('.filter-chip-urgent{') && styles.includes('.filter-chip-high{') && styles.includes('.filter-chip-medium{') && styles.includes('.filter-chip-low{') && styles.includes('.filter-group-task') && styles.includes('.filter-group-meeting'), '關注等級與分類標題篩選需有明顯顏色區分');
  assert.ok(meetings.includes('label="與會人員"') && meetings.includes('label="追蹤窗口"') && meetings.includes('同與會人員') && meetings.includes('ownerUserIds:effectiveDraft.trackingUserIds'), '臨會需區分與會人員、追蹤窗口與負責人，且只有追蹤窗口同步待辦');
  assert.ok(editor.includes('askCompletionDate') && editor.includes("window.prompt('請選擇完成日期（YYYY-MM-DD）'") && editor.includes('task-completion-date-row') && editor.includes('setCompletionDate(event.target.value)'), '要事標記結案需跳出完成日期，且詳情內需有同步完成日期選擇框');
  assert.ok(meetings.includes('completedDate') && meetings.includes('askMeetingCompletionDate') && meetings.includes('setMeetingStatus(event.target.value as TemporaryMeetingStatus)') && meetings.includes('setMeetingCompletedDate(event.target.value)'), '臨會/專題切到已完成需跳出完成日期，且詳情內需有同步完成日期選擇框');
  assert.ok(fs.readFileSync('src/types.ts','utf8').includes('completedDate?: string') && normalizeSource.includes('completedDate: text(item.completedDate) || undefined'), '臨會/專題完成日期需寫入正式資料型別並經 normalize 保留');
  for (const cls of ['.filter-chip-urgent.on','.filter-chip-high.on','.filter-chip-medium.on','.filter-chip-low.on','.filter-chip-meeting.on','.filter-chip-internal.on','.filter-reset-btn']) assert.ok(styles.includes(cls), `篩選 chip 缺少明顯顏色樣式 ${cls}`);
  for (const label of ['完成率','逾期率','提出率／件數','高風險','需知曉','內控','異常','部門橫向比較與排名','人員橫向比較與排名','船舶優先級／異常／關注度／點亮項目／趨勢']) assert.ok(analysis.includes(label), `數據分析頁缺少 ${label}`);
  assert.ok(analysis.includes("tasks.filter(task => responsibleFor(task, scopedUserIds, scopeMode === 'department' ? selectedDepartment : ''))") && !analysis.includes("responsibleFor(task, scopedUserIds, scopeMode === 'department' ? selectedDepartment : '') || scopedUserIds.has(task.createdBy)"), '責任事項不得混入僅由該人員提出但未負責的事項');
  assert.ok(dashboard.includes('onAdjustAttention') && dashboard.includes('deriveVesselAttention') && attentionSource.includes('manualAttentionLevel') && attentionSource.includes("'特別關注'"), '船隊看板應支援受自動下限保護的手動關注度與特別關注');
  assert.ok(management.includes('關注度判斷方式') && management.includes('不是 AI 或外部黑箱模型'), '管理頁應說明關注度自動規則');

  console.log('Latest user requirement contracts passed.');
} finally {
  await server.close();
}
