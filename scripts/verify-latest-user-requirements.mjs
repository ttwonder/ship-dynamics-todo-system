import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
try {
  const categories = await server.ssrLoadModule('/src/taskCategories.ts');
  const names = await server.ssrLoadModule('/src/vesselDisplay.ts');
  const normalizer = await server.ssrLoadModule('/src/normalize.ts');
  const cloud = await server.ssrLoadModule('/src/cloud.ts');

  assert.deepEqual(categories.REQUIRED_TASK_CATEGORIES, [
    '換員操作', '加油加水', '物料配件', '維修', 'Survey', '稽核檢查', 'PSC窗口',
    '證書', '缺失驗證', 'vetting', '貨品', '港口安排', '臨會/專題',
  ]);
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
  assert.ok(normalized.settings.taskCategories.includes('臨會/專題'));
  assert.ok(!normalized.settings.taskCategories.includes('人員'));
  assert.deepEqual(normalized.settings.vesselStatuses, ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar']);
  assert.deepEqual(normalized.vessels[0].note.statusList, ['drydock/repiar']);
  assert.equal(normalized.vessels[0].note.recentDynamics, '近期資訊\n舊後續資訊');
  assert.equal(normalized.vessels[0].note.subsequentDynamics, '');

  const migrationFixture = normalizer.normalizeAppData({
    revision: 7, updatedAt: '2026-07-18T00:00:00.000Z',
    settings: { sitePasswordHash:'x', systemTitle:'x', departments:['管理層'], taskCategories:[], rolePermissions:{}, nonOwnerPasswordResetVersion:0 },
    users: [
      { id:'owner', department:'管理層', name:'朱世毅', username:'owner', role:'owner', passwordHash:'owner-hash', passwordVisible:'', isActive:true, managedVesselIds:[] },
      { id:'user', department:'管理層', name:'一般人員', username:'user', role:'operator', passwordHash:'old', passwordVisible:'old', isActive:true, managedVesselIds:[] },
    ], vessels:[], tasks:[], meetings:[], agendaReports:[], auditLogs:[], notifications:[],
  });
  assert.equal(migrationFixture.users.find(user => user.id === 'owner').passwordHash, 'owner-hash');
  assert.equal(migrationFixture.users.find(user => user.id === 'user').passwordVisible, 'fpmc2026');
  assert.equal(migrationFixture.settings.nonOwnerPasswordResetVersion, 1);
  const cfg = { supabaseUrl:'https://example.supabase.co', supabaseAnonKey:'anon', workspaceKey:'workspace', tableName:'state' };
  const makeClient = saved => {
    const calls = [];
    const chain = {
      update(row) { calls.push(['update', row]); return this; },
      eq(key, value) { calls.push(['eq', key, value]); return this; },
      select(value) { calls.push(['select', value]); return this; },
      async maybeSingle() { return { data:saved ? { revision:8 } : null, error:null }; },
    };
    return { client:{ from(table) { calls.push(['from', table]); return chain; } }, calls };
  };
  const successMock = makeClient(true);
  const persisted = await cloud.persistPasswordMigrationCas(successMock.client, cfg, cfg, structuredClone(migrationFixture), 7, '2026-07-18T01:00:00.000Z');
  assert.equal(persisted.revision, 8);
  assert.ok(successMock.calls.some(call => call[0] === 'eq' && call[1] === 'revision' && call[2] === 7));
  const conflictMock = makeClient(false);
  await assert.rejects(() => cloud.persistPasswordMigrationCas(conflictMock.client, cfg, cfg, structuredClone(migrationFixture), 7), cloud.CloudConflictError);
  const identityMock = makeClient(true);
  await assert.rejects(() => cloud.persistPasswordMigrationCas(identityMock.client, cfg, { ...cfg, workspaceKey:'other' }, structuredClone(migrationFixture), 7), /identity/);
  assert.equal(identityMock.calls.length, 0);

  const dashboard = fs.readFileSync('src/Dashboard.tsx','utf8');
  const app = fs.readFileSync('src/App.tsx','utf8');
  const editor = fs.readFileSync('src/EditModals.tsx','utf8');
  const morning = fs.readFileSync('src/MorningWorkspace.tsx','utf8');
  const meetings = fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
  const styles = fs.readFileSync('src/styles.css','utf8');
  const management = fs.readFileSync('src/Management.tsx','utf8');
  const workCenter = fs.readFileSync('src/WorkCenter.tsx','utf8');
  const analysis = fs.readFileSync('src/DataAnalysis.tsx','utf8');
  const seed = fs.readFileSync('src/data/seed.ts','utf8');
  const normalizeSource = fs.readFileSync('src/normalize.ts','utf8');
  const cloudSource = fs.readFileSync('src/cloud.ts','utf8');
  assert.ok(dashboard.includes('船舶狀態') && dashboard.includes('vessel.note.statusList'), '看板載況旁必須顯示船舶狀態');
  assert.ok(editor.includes('CheckboxMultiPicker label="分類"') && editor.includes('draft.categories'), '新增要事分類必須可多選');
  assert.ok(editor.includes("if (creating && !draft.vesselId) return alert('請選擇船舶')"), '新增要事的船舶必須由保存 handler 验证');
  assert.ok(editor.includes("if (creating && !draft.priority) return alert('請選擇關注程度')"), '新增要事的关注程度必须由保存 handler 验证');
  assert.ok(editor.includes("if (creating && !selectedCategories.length) return alert('請選擇分類')"), '新增要事的分类必须由保存 handler 验证');
  assert.ok(app.includes("category:'', categories:[]"), '新增要事分类必须初始为空并由使用者主动选择');
  assert.ok(editor.includes("if (creating && !draft.departments.length) return alert('請選擇涉及部門')"), '新增要事的涉及部门必须由保存 handler 验证');
  assert.ok(editor.includes('required={creating}') && editor.includes('label="分類" required={creating}') && editor.includes('label="涉及部門" required={creating}'), '新增要事的五个必选／必填字段必须显示原生或语义 required 标记');
  assert.ok(editor.includes('label="涉及部門" required={creating}') && editor.includes('label="涉及人員"'), '新增要事必须使用「涉及人員」标签');
  const vesselEditor = editor.slice(editor.indexOf('export function VesselEditModal'), editor.indexOf('export function TaskEditModal'));
  const taskEditor = editor.slice(editor.indexOf('export function TaskEditModal'));
  assert.ok(!vesselEditor.includes('經管／負責人'), '船舶快速更新不得显示或修改管理页经管／负责人');
  assert.ok(!taskEditor.includes('label="經管／負責人"'), '要事编辑器不得把事项涉及人员标为船舶经管／负责人');
  assert.ok(taskEditor.includes("creating&&currentUser.role!=='vessel'"), '涉及人员只在新增要事界面显示，快速更新既有要事不得显示');
  assert.ok(app.includes('assignedOwnerUserIds') && app.includes('vessel.assignedUserIds'), '新增要事必须自动带入管理页已分配的船舶经管人员');
  assert.ok(!taskEditor.includes('assignedUserIds=') && !taskEditor.includes('managedVesselIds='), '事项涉及人员不得修改管理页船舶／人员分管');
  assert.ok(app.includes('taskReturnVesselId') && app.includes('closeTaskEditor') && app.includes('addTaskForVessel(id,true)'), '从快速更新进入新增要事后，取消或保存必须返回快速更新弹窗');
  assert.ok(app.includes('mergeAttentionFromCategories') && app.includes('saved.categories'), '保存要事必須同步點亮看板狀態');
  assert.ok(app.includes('closedFilters') && app.includes("tasks={closedTasks}"), '已結案頁需使用獨立篩選與已結案資料源');
  assert.ok(morning.includes('onAddTask') && morning.includes('＋ 新增待辦'), '早會討論區需提供新增待辦');
  assert.ok(app.includes('onAddTask={addTaskForVessel}'), 'App 必須把新增待辦动作接入早會');
  assert.ok(editor.includes('<label>近期／後續動態</label>') && !editor.includes('<label>後續動態</label>'), '快速更新只保留合併後的近期／後續動態欄位');
  assert.ok(dashboard.includes('人工備註') && dashboard.includes('近期／後續動態') && dashboard.includes('vessel.position.manualRemark') && dashboard.includes('vessel.note.recentDynamics'), '看板重要摘要需同時呈現人工備註及近期／後續動態');
  assert.ok(app.replace(/\s/g,'').includes('constreportVessels=data.vessels.filter(v=>v.isActive)') && app.replace(/\s/g,'').includes('constvessels=visibleVessels;'), '每日早會報告必須固定使用全部啟用船舶');
  assert.ok(!app.includes("請至少選擇一艘船舶再預覽報告"), '每日早會報告不得依涉會勾選阻擋匯出');
  assert.ok(app.includes('人工備註：') && app.includes('近期／後續動態：'), '早會 PDF 需分別呈現人工備註及近期／後續動態');
  assert.ok(app.includes('本報告依全部啟用船舶'), '早會 PDF 頁腳需說明資料來源為全部啟用船舶');
  assert.ok(meetings.includes('meetingExportSelection') && meetings.includes('匯出所選會議 PDF') && meetings.includes('匯出總清單 PDF'), '臨會總清單需提供多選會議 PDF 與總清單 PDF');
  assert.ok(meetings.includes('meeting-print-page') && meetings.includes('window.print()'), '臨會所選會議需使用獨立列印頁並逐會議分頁');
  assert.ok(styles.includes('.meeting-print-page') && styles.includes('break-after:page'), '臨會列印 CSS 需強制逐會議分頁');
  assert.ok(app.includes("currentUser?.role==='owner'||currentUser?.role==='admin'||hasPermission"), 'Owner／管理員應固定查看全部船舶');
  assert.ok(app.includes('const involvedVesselIds = useMemo') && app.includes('canViewAllVessels||involvedVesselIds.has(t.vesselId)') && app.includes('canViewAllVessels||involvedVesselIds.has(v.id)'), '事项涉及人员的船舶范围应统一用于看板、总表、已结案及统计');
  assert.ok(workCenter.includes('task.ownerUserIds.includes(user.id)') && workCenter.includes('vessel.assignedUserIds.includes(user.id)'), '我的待辦應包含涉及人員及船舶分管人員');
  assert.ok(normalizeSource.includes('managementUserIds.has(user.id)).forEach(user => { user.managedVesselIds = []; })'), '管理層不得保留具體船舶分管');
  assert.ok(app.includes('aria-label="登入部門"') && app.includes('aria-label="登入人員"'), '登入頁應使用部門與人員下拉選擇');
  assert.ok(app.includes('if(user.passwordHash&&await sha256(pw)!==user.passwordHash)'), 'Owner 清除密碼後應允許無密碼登入');
  assert.ok(seed.includes("DEFAULT_USER_PASSWORD='fpmc2026'") && seed.includes('385b870cb91faa4b1cb040d624ab6a7c738352a032ade05cef752de2868f8b10'), '非 Owner 統一密碼及雜湊必須正確');
  assert.ok(normalizeSource.includes('nonOwnerPasswordResetVersion') && normalizeSource.includes("user.passwordVisible = 'fpmc2026'"), '舊雲端資料應只執行一次非 Owner 密碼遷移');
  assert.ok(cloudSource.includes('needsPasswordResetPersistence') && cloudSource.includes('persistPasswordMigrationCas') && app.includes("data.revision === remote.revision && data.updatedAt !== remote.updatedAt"), '一次性密碼遷移應使用經 runtime 驗證的 CAS helper，並阻擋同 revision 的本機分歧');
  assert.ok(management.includes('Owner 可查看、修改或清除此人員密碼') && management.includes('clearPersonPassword'), 'Owner 應能查看、修改及清除其他人員密碼');
  assert.ok(app.includes("['reports','報告中心'],['stats','數據分析'],['closed','已結案']"), '數據分析應位於報告中心與已結案之間');
  for (const label of ['完成率','逾期率','提出率／件數','高風險','需知曉','內控','異常','部門橫向比較與排名','人員橫向比較與排名','船舶優先級／異常／關注度／點亮項目／趨勢']) assert.ok(analysis.includes(label), `數據分析頁缺少 ${label}`);
  assert.ok(analysis.includes("tasks.filter(task => responsibleFor(task, scopedUserIds, scopeMode === 'department' ? selectedDepartment : ''))") && !analysis.includes("responsibleFor(task, scopedUserIds, scopeMode === 'department' ? selectedDepartment : '') || scopedUserIds.has(task.createdBy)"), '責任事項不得混入僅由該人員提出但未負責的事項');
  assert.ok(dashboard.includes('manualAttentionLevel') && dashboard.includes('onAdjustAttention'), '船隊看板應支援手動關注度覆蓋');
  assert.ok(management.includes('關注度判斷方式') && management.includes('不是 AI 或外部黑箱模型'), '管理頁應說明關注度自動規則');

  console.log('Latest user requirement contracts passed.');
} finally {
  await server.close();
}
