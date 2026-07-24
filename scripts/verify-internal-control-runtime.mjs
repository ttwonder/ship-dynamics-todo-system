import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const workflow = await server.ssrLoadModule('/src/internalControlWorkflow.ts');
  const dataLayer = await server.ssrLoadModule('/src/internalControlData.ts');
  const normalizeModule = await server.ssrLoadModule('/src/normalize.ts');
  const attention = await server.ssrLoadModule('/src/vesselAttention.ts');
  const scope = await server.ssrLoadModule('/src/workCenterScope.ts');
  const taskScope = await server.ssrLoadModule('/src/taskVesselScope.ts');
  const batchActions = await server.ssrLoadModule('/src/batchTaskActions.ts');
  const taskWorkflow = await server.ssrLoadModule('/src/taskWorkflow.ts');
  const editLockCoordinator = await server.ssrLoadModule('/src/editLockCoordinator.ts');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const vesselDetailSource = await readFile(new URL('../src/VesselDetailPage.tsx', import.meta.url), 'utf8');
  const dataAnalysisSource = await readFile(new URL('../src/DataAnalysis.tsx', import.meta.url), 'utf8');
  const workCenterSource = await readFile(new URL('../src/WorkCenter.tsx', import.meta.url), 'utf8');
  const internalControlPageSource = await readFile(new URL('../src/InternalControlPage.tsx', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const cloudSource = await readFile(new URL('../src/cloud.ts', import.meta.url), 'utf8');
  const editModalsSource = await readFile(new URL('../src/EditModals.tsx', import.meta.url), 'utf8');

  assert.ok(
    styles.includes('.internal-control-page{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}'),
    'internal-control page grid must allow wide tables to scroll inside their wrapper instead of widening the mobile document',
  );
  assert.ok(vesselDetailSource.includes('deriveVesselAttention(vessel, attentionTaskItems, hasMeetingAbnormal, data.internalControlCases)'), 'vessel detail must apply meeting-abnormal and internal-control attention signals consistently');
  assert.ok(vesselDetailSource.includes('filteredStandaloneInternalCases.map') && vesselDetailSource.includes('tasks.length+filteredStandaloneInternalCases.length'), 'vessel detail counts and visible rows must both include standalone internal-control cases');
  assert.ok(dataAnalysisSource.includes('deriveVesselAttention(vessel, open, hasMeetingAbnormal, data.internalControlCases)'), 'data analysis must apply the same internal-control attention floor as the dashboard');
  assert.ok(workCenterSource.includes("...filteredInternalCases.map(item=>({kind:'internal' as const,item}))"), 'work-center pagination must include standalone internal-control cases');
  assert.ok(workCenterSource.includes('目前篩選 {filteredTasks.length+filteredInternalCases.length} / 全部 {allTasks.length+allInternalCases.length} 件'), 'work-center print total must include standalone internal-control cases');
  assert.ok(workCenterSource.includes('<tbody>{filteredInternalCases.map(item=>'), 'work-center print rows must include standalone internal-control cases');
  assert.ok(!internalControlPageSource.includes('vesselDisplayName(vessels.find(vessel => vessel.id === id)!)'), 'internal-control filter summary must not dereference stale vessel IDs');
  assert.ok(internalControlPageSource.includes("useState<InternalControlFilters>(() => emptyFilters(defaultInternalControlVesselIds(user, vessels)))") && internalControlPageSource.includes("const reset = () => setFilters(emptyFilters(defaultInternalControlVesselIds(user, vessels)))"), '內控船舶篩選初始值與重設都必須使用全部個人經管船舶的default helper');
  assert.ok(internalControlPageSource.includes('重設（全部經管船）') && !internalControlPageSource.includes('第一艘自管船'), '內控篩選文案不得再暗示只選第一艘船');
  assert.ok(appSource.includes("previous.isInternalControl&&!candidate.isInternalControl&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')"), 'ordinary task saves must require close permission before cancelling internal control');
  assert.ok(appSource.includes("!previous.isInternalControl&&candidate.isInternalControl&&!hasPermission(prev.settings.rolePermissions,liveUser,'createTasks')"), 'turning an existing task into internal control must require create permission');
  assert.ok(appSource.includes("creating&&candidate.isInternalControl&&liveUser.role==='vessel'"), 'vessel accounts must not create internal control indirectly through ordinary task creation');
  assert.ok(appSource.includes('const taskVisibilityRelationships = useMemo(()=>({internalControlCases:data.internalControlCases,meetings:data.meetings,visibleVesselIds:activeVessels.map(vessel=>vessel.id)})'), 'App must build role visibility from authoritative relationships and the current vessel scope');
  assert.ok(appSource.includes('const roleVisibleTasks = useMemo(()=>selectTasksVisibleToUser(data.tasks,currentUser,taskVisibilityRelationships)'), 'App must derive a centralized role-visible task collection');
  assert.ok(appSource.includes("data.meetings.filter(meeting=>currentUser.role!=='vessel'||!meeting.isInternalControl).filter(meeting=>meetingAppliesToUser"), 'meeting projection must exclude vessel internal-control meetings and enforce operator responsibility-or-vessel scope');
  assert.ok(appSource.includes('internalControlCases:roleVisibleInternalControlCases') && appSource.includes('selectInternalControlCasesVisibleToUser(data.internalControlCases,data.tasks,currentUser,activeVessels.map(vessel=>vessel.id))'), 'role-visible backing data must project internal-control cases through reciprocal linkage and exact live vessel scope');
  assert.match(appSource, /dashboardMeetingAlerts\(\s*roleVisibleMeetings,/, 'dashboard alert projection must not preserve the existence of internal-control meetings for vessel users');
  assert.ok(appSource.includes('tasks={roleVisibleTasks} internalControlCases={roleVisibleData.internalControlCases}'), 'vessel dashboard metrics, attention, and summaries must consume only role-visible task and internal-control data');
  assert.ok(appSource.includes("tab==='total' && <ListPanel") && appSource.includes('tasks={filteredTasks} data={roleVisibleData}'), 'vessel total-list props must not retain hidden internal-control records in the backing data object');
  assert.ok(appSource.includes('const readOnlyTask=taskEditorAuthorizationEpoch===authorizationEpoch?taskReadOnlyData?.tasks.find') && appSource.includes('const editingTask=taskEditorAuthorizationEpoch===authorizationEpoch?(readOnlyTask||') && appSource.includes('setTaskReadOnlyData(null);'), 'identity, permission, and vessel-scope changes must synchronously suppress stale writable and read-only task editors and drafts');
  assert.ok(appSource.includes("activeEditLock.authorizationEpoch===authorizationEpoch&&activeEditLock.ownerUserId===currentUser.id"), 'collaboration-lock labels must be bound to the exact live authorization epoch and owner');
  assert.ok(appSource.includes("if(lock.status==='blocked')") && appSource.includes('releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config)') && appSource.includes('try{await releaseEditLock(sectionKey,leaseOwnerId,leaseConfig)') && appSource.includes('leaseCloudConfigs.current'), 'owned and possibly-owned error leases must retain their opaque owner and immutable cloud config until serialized release succeeds');
  assert.ok(cloudSource.includes('config?: ResolvedSupabaseConfig|null') && cloudSource.includes('getSupabaseClient(cfg)'), 'lock RPCs must accept and use the immutable cloud configuration captured at claim time');
  assert.ok(appSource.includes('previousAuthorizationEpochValue&&previousAuthorizationEpochValue!==authorizationEpoch') && appSource.includes('setTaskEditorAuthorizationEpoch(\'\');'), 'authorization epoch changes must clear stale editors, drafts, previews, and locks');
  assert.ok(appSource.includes('const leaveCurrentIdentity = () => {') && appSource.includes('setCreatingTask(null);') && appSource.includes('setEditingTaskId(\'\');') && appSource.includes('releaseCurrentEditLock();') && appSource.includes('onClick={leaveCurrentIdentity}'), 'identity switching must synchronously clear sensitive UI state and release collaboration locks');
  assert.ok(appSource.includes("canEditBusinessContent&&vesselEditorLeaseAuthorized&&editingVesselId") && appSource.includes('editingTask&&taskEditorLeaseAuthorized && <TaskEditModal') && appSource.includes('onClick={resolveEditLockNotice}'), 'identity, permission, vessel-scope, or lease loss must synchronously suppress writable editors and route error dismissal through release');
  assert.ok(appSource.includes("canExportReports&&reportPreviewOpen && <ReportPreviewModal data={roleVisibleData}"), 'permission changes must synchronously suppress stale report previews and keep their backing data redacted');
  assert.ok(appSource.includes("canEditBusinessContent&&batchManagedOpen && <BatchManagedVesselModal"), 'permission changes must synchronously suppress stale batch-managed editors');
  assert.match(appSource, /<WorkCenter\s+data=\{roleVisibleData\}/, 'work center must receive centralized role-visible task data');
  assert.ok(appSource.includes('<TemporaryMeetingsPage data={roleVisibleData}'), 'meeting consumers must receive centralized role-visible task data');
  assert.ok(workCenterSource.includes('const visibleTaskIds=new Set(allTasks.map(task=>task.id))') && workCenterSource.includes('data.notifications.filter(notice=>Boolean(notice.taskId&&visibleTaskIds.has(notice.taskId)))'), 'work-center unread counts must reauthorize every task notification');
  assert.ok(appSource.includes('authorizationEpoch={authorizationEpoch}') && internalControlPageSource.includes('editorAuthorizationEpoch===authorizationEpoch') && internalControlPageSource.includes('scopedCases.some(item=>item.id===editing.id)'), 'internal-control nested modals must be bound to the current authorization epoch and live case scope');
  assert.ok(appSource.includes('const lockCoordinator=useRef(createEditLockCoordinator())') && appSource.includes('leaseOwnerId'), 'edit locks must use a serialized generation coordinator and opaque per-lease owner');
  assert.ok(appSource.includes("if(!creating&&!requireMutationLease(`task:${candidate.id}`))return false") && appSource.includes("if(!requireMutationLease(`task:${candidate.id}`))return false") && appSource.includes("if(!requireMutationLease(`task:${task.id}`))return"), 'task save, per-vessel save, and delete mutation boundaries must require the exact live lease');
  assert.ok(appSource.includes('commit={vesselEditorCommit}') && appSource.includes("requireMutationLease(`vessel:${editingVesselId}`)"), 'immediate vessel commits must pass through the same live lease boundary');
  assert.ok(appSource.includes('validatedUntilMs:conservativeLeaseDeadline(') && appSource.includes('editLockAllowsMutation('), 'claim and renew must maintain a conservative server-expiry-bounded lease validity window enforced at mutation time');
  assert.ok(appSource.includes('editingTask&&(taskEditorReadOnly||mutationLeaseIsOwned') && appSource.includes('readOnly={taskEditorReadOnly}') && appSource.includes("if(claimResult==='blocked'){") && appSource.includes("return openTaskReadOnly(task.id,'其他使用者正在編輯此事項'"), 'cloud read-only viewers and lock-blocked users must retain projected task detail access without receiving writable controls or a lease');
  assert.ok(appSource.includes('const invalidatePendingTaskOpen = () => {') && appSource.includes('taskOpenRequests.current.invalidate();') && appSource.includes('clearBlockedTaskLock();'), 'every synchronous navigation boundary must invalidate the generation-aware task-open coordinator and clear blocked records');
  const invalidateStart=appSource.indexOf('const invalidatePendingTaskOpen = () => {');
  const invalidateEnd=appSource.indexOf('\n  };',invalidateStart);
  const invalidateBranch=appSource.slice(invalidateStart,invalidateEnd);
  assert.ok(invalidateBranch.includes('taskOpenRequests.current.invalidate();'), 'explicit navigation must atomically clear stale task return destinations through the coordinator');
  assert.ok(appSource.includes("if(lock&&lock.status==='blocked')") && appSource.includes('雲端設定已變更：已關閉舊工作區的只讀事項'), 'cloud configuration transitions must close an already-open blocked read-only task');
  assert.ok(/const openTaskEditor[\s\S]*?clearBlockedTaskLock\(\);[\s\S]*?if\(!taskLockIsAuthorized\(task\)\)/.test(appSource), 'every new task open, including ordinary role-based read-only opens, must clear the previous blocked task record before branching');
  const renewalBlockedStart=appSource.indexOf('if(!renewed.ok){');
  const renewalBlockedEnd=appSource.indexOf('}else{',renewalBlockedStart);
  const renewalBlockedBranch=appSource.slice(renewalBlockedStart,renewalBlockedEnd);
  assert.ok(renewalBlockedStart>=0 && renewalBlockedBranch.includes("sectionKey.startsWith('task:')") && renewalBlockedBranch.includes('openTaskReadOnly('), 'an owned task lease that becomes blocked during renewal must reopen from the latest projected cloud snapshot');
  assert.ok(renewalBlockedBranch.includes("result==='failed'&&taskOpenRequests.current.isCurrent(requestGeneration)") && renewalBlockedBranch.includes('closeTaskEditor();'), 'a failed renewal-to-read-only transition may consume and restore only the still-current return destination');
  assert.ok(appSource.includes('editingTask.id===creatingTask.id&&!taskReadOnlyData') && /const addTaskForVessel[\s\S]*?invalidatePendingTaskOpen\(\);[\s\S]*?setEditingTaskId\(''\);[\s\S]*?setCreatingTask\(/.test(appSource), 'task creation must invalidate pending blocked reads and can only enter creation mode for the exact draft identity');
  assert.ok(appSource.includes('navigateToTab(k);') && appSource.includes('onBack={closeVesselDetail}') && appSource.includes('onOpenVessel={openVesselDetail}') && appSource.includes("onOpenInternalControl={()=>navigateToTab('internalControl')}"), 'tab and vessel-detail navigation handlers must synchronously invalidate pending task opens');
  assert.ok(appSource.includes('openTask(task,vesselId,vesselId)') && appSource.includes('const returnDestination=taskOpenRequests.current.consume()') && appSource.includes('returnDestination?.vesselId') && appSource.includes('openVesselEditor(returnDestination.vesselId)'), 'existing tasks opened from a vessel editor must consume the current destination and return to that vessel editor');
  const deleteTaskStart=appSource.indexOf('const deleteTask =');
  const deleteTaskEnd=appSource.indexOf('\n  const batchCompleteTasks',deleteTaskStart);
  assert.ok(appSource.slice(deleteTaskStart,deleteTaskEnd).includes('closeTaskEditor();'), 'successful deletion must consume and restore task return context through the shared close path');
  assert.ok(appSource.includes("type TaskOpenResult='opened'|'failed'|'cancelled'") && appSource.includes("if(result==='failed')void openVesselEditor(vesselId)") && appSource.includes("if(result!=='opened')taskOpenRequests.current.clearIfCurrent(requestGeneration)") , 'failed vessel-origin task opens must restore the vessel while cancelled or failed opens clear only their own stale return context');
  assert.ok(styles.includes('.batch-task-table .task-link,.batch-task-table .task-link .rich-text-content{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere}'), 'print media must expand clickable rich task content instead of clipping it to one line');
  assert.ok(appSource.includes("${cfg.workspaceKey}|${cfg.supabaseAnonKey}") && appSource.includes('sameCloudConfig(currentConfig,record.config)'), 'cloud identity and mutation boundaries must exactly include anon key, URL, workspace, and table snapshot equality');
  assert.ok(appSource.includes("window.addEventListener('storage',onStorage)") && appSource.includes('window.setInterval(checkConfig,1000)') && appSource.includes('停止舊工作區續期'), 'cross-tab and same-tab cloud configuration changes must close editors and stop old-workspace renewal promptly');
  assert.ok(appSource.includes('if(!sameCloudConfig(getSupabaseConfig(),leaseRecord.config))') && appSource.includes('releaseCurrentEditLock();'), 'renewal must recheck the captured cloud configuration and serialize release through the old snapshot on mismatch');
  assert.ok(appSource.includes('pendingClaimConfig.current={generation,config:leaseConfig,invalidated:false}') && appSource.includes('pending&&!pending.invalidated&&!sameCloudConfig(getSupabaseConfig(),pending.config)'), 'pending claims must be invalidated when cloud configuration changes before a result arrives');
  assert.ok(appSource.includes('const configStillCurrent=sameCloudConfig(getSupabaseConfig(),leaseConfig)') && appSource.includes('else leaseCloudConfigs.current.delete(leaseOwnerId)'), 'claim results must revalidate configuration and discard definitive stale blocked records without release');
  assert.ok(appSource.includes('if(renewed.ok){await releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config);leaseCloudConfigs.current.delete(lock.leaseOwnerId);}') && appSource.includes('else leaseCloudConfigs.current.delete(lock.leaseOwnerId)'), 'stale definitive blocked renewals must discard non-owner records while stale successes compensate with release');
  assert.ok(appSource.includes('const matchingTasks=prev.tasks.filter(item=>item.id===candidate.id)') && appSource.includes("matchingTasks.length!==1"), 'per-vessel progress mutations must reject missing or duplicate task IDs atomically');
  assert.ok(appSource.includes("if(!canEditBusinessContent||!activeVessels.some(item=>item.id===vessel.id))") && appSource.includes('const taskLockIsAuthorized = (task: TaskItem) => canAcquireTaskEditLock(task,currentUser,canEditBusinessContent,activeVessels,data.settings.rolePermissions)') && appSource.includes('roleVisibleTasks.filter(taskLockIsAuthorized)'), 'read-only or out-of-scope handlers must not acquire collaboration locks');
  assert.ok(appSource.includes('cloudStatusSectionKey') && appSource.includes('authorizedEditLockKeys.has(cloudStatusSectionKey)'), 'sensitive cloud lock labels must be synchronously tied to a still-authorized live section');
  assert.ok(appSource.includes("if(!canAccessTab(currentUser,'internalControl'))return"), 'vessel detail must not navigate to a forbidden internal-control tab');
  assert.ok(appSource.includes("tab==='internalControl' && canAccessTab(currentUser,'internalControl')"), 'internal-control page must enforce authorization synchronously at render time during role transitions');
  assert.ok(appSource.includes("canAccessTab(currentUser,tab) && <>{tab==='dashboard'"), 'all forbidden tab content must be synchronously suppressed before the redirect effect runs');
  assert.ok(vesselDetailSource.includes('canViewInternalControl ? data.internalControlCases.filter'), 'vessel detail rows and metrics must fail closed when internal-control access is denied');
  assert.ok(editModalsSource.includes("currentUser.role!=='vessel'&&<label className=\"aware-toggle internal-control-toggle\""), 'vessel task editor must not expose the internal-control creation toggle');
  assert.ok(appSource.includes("internalControlDeletion&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')"), 'deletion-driven internal-control closure must require close permission');
  const removeInternalCaseStart=appSource.indexOf('const removeInternalCase =');
  const removeInternalCaseEnd=appSource.indexOf('\n  const saveTask =',removeInternalCaseStart);
  const removeInternalCaseBranch=appSource.slice(removeInternalCaseStart,removeInternalCaseEnd);
  assert.ok(removeInternalCaseBranch.includes('if(!internalControlDeletionAuthorized({') && !removeInternalCaseBranch.includes('if(!previous.isClosed&&!internalControlDeletionAuthorized'), 'open and already-closed internal-control case deletion must both require delete, close, and scope-cancellation authorization');
  assert.ok(appSource.includes('try{deleteTaskBatchFromDraft(draft,liveSelection.tasks,liveUser,nowIso());}') && !appSource.includes('liveSelection.tasks.forEach(task=>closeLinkedInternalControlCaseAfterTaskDelete'), 'batch deletion must remove each linked task before checking the next global linkage invariant');
  assert.ok(appSource.includes("normalizedProgress.status!==previousProgress.status&&newProgressLogCount<1") && appSource.includes("newProgressLogCount>0&&normalizedProgress.statusLogs[0]?.text.trim()!==normalizedProgress.status.trim()"), 'per-vessel status changes must require matching newest history');

  const ordinaryVisibleTask = { id: 'ordinary', isInternalControl: false, vesselId: 'vessel-a', sourceType: 'morning', attentionDimension: 'task', ownerUserIds: [] };
  const otherVesselTask = { id: 'other-vessel', isInternalControl: false, vesselId: 'vessel-b', sourceType: 'morning', attentionDimension: 'task', ownerUserIds: [] };
  const unscopedTask = { id: 'unscoped', isInternalControl: false, sourceType: 'morning', attentionDimension: 'task', ownerUserIds: [] };
  const linkedInternalTask = { id: 'linked-internal', isInternalControl: true, internalControlCaseId: 'case-1', vesselId: 'vessel-a', sourceType: 'morning', attentionDimension: 'task', ownerUserIds: [] };
  const malformedLinkClaim = { id: 'link-claim-only', isInternalControl: false, internalControlCaseId: 'case-2', vesselId: 'vessel-a', sourceType: 'morning', attentionDimension: 'task', ownerUserIds: [] };
  const reciprocalCaseClaim = { id: 'reciprocal-case-only', isInternalControl: false, vesselId: 'vessel-a', sourceType: 'morning', attentionDimension: 'task', ownerUserIds: [] };
  const meetingTask = (id, sourceMeetingId, sourceMeetingItemId, overrides = {}) => ({ id, isInternalControl: false, vesselId: 'vessel-a', vesselIds: ['vessel-a'], vesselScopeMode: 'vessels', vesselTypeScopes: [], sourceType: 'temporary', attentionDimension: 'meeting', sourceMeetingId, sourceMeetingItemId, distributeToVessels: true, ownerUserIds: [], ...overrides });
  const meeting = (id, isInternalControl, itemId, overrides = {}) => ({ id, isInternalControl, vessels: ['vessel-a'], vesselScopeMode: 'vessels', vesselTypeScopes: [], taskItems: [{ id: itemId, description: id, categories: [], distributeToVessels: true }], ...overrides });
  const internalMeetingClaim = meetingTask('internal-meeting-only', 'meeting-internal', 'item-internal');
  const ordinaryMeetingTask = meetingTask('ordinary-meeting', 'meeting-ordinary', 'item-ordinary');
  const missingMeetingTask = meetingTask('missing-meeting', 'meeting-missing', 'item-missing');
  const orphanMeetingSemanticsTask = meetingTask('orphan-meeting-semantics', undefined, undefined);
  const duplicateMeetingTask = meetingTask('duplicate-meeting', 'meeting-duplicate', 'item-duplicate');
  const unclassifiedMeetingTask = meetingTask('unclassified-meeting', 'meeting-unclassified', 'item-unclassified');
  const missingMeetingItemTask = meetingTask('missing-meeting-item', 'meeting-missing-item', 'item-not-present');
  const duplicateMeetingItemTask = meetingTask('duplicate-meeting-item', 'meeting-duplicate-item', 'item-duplicate-item');
  const mismatchedMeetingScopeTask = meetingTask('mismatched-meeting-scope', 'meeting-other-vessel', 'item-other-vessel');
  const visibilityFixture = [ordinaryVisibleTask, otherVesselTask, unscopedTask, linkedInternalTask, malformedLinkClaim, reciprocalCaseClaim, internalMeetingClaim, ordinaryMeetingTask, missingMeetingTask, orphanMeetingSemanticsTask, duplicateMeetingTask, unclassifiedMeetingTask, missingMeetingItemTask, duplicateMeetingItemTask, mismatchedMeetingScopeTask];
  const visibilityRelationships = {
    internalControlCases: [{ linkedTaskId: 'reciprocal-case-only' }],
    meetings: [meeting('meeting-internal', true, 'item-internal'), meeting('meeting-ordinary', false, 'item-ordinary'), meeting('meeting-duplicate', false, 'item-duplicate'), meeting('meeting-duplicate', false, 'item-duplicate'), meeting('meeting-unclassified', undefined, 'item-unclassified'), meeting('meeting-missing-item', false, 'different-item'), meeting('meeting-duplicate-item', false, 'item-duplicate-item', { taskItems: [{ id: 'item-duplicate-item', description: 'one', categories: [], distributeToVessels: true }, { id: 'item-duplicate-item', description: 'two', categories: [], distributeToVessels: true }] }), meeting('meeting-other-vessel', false, 'item-other-vessel', { vessels: ['vessel-b'] })],
    visibleVesselIds: ['vessel-a'],
  };
  const vesselVisibilityUser = { id: 'vessel-user', role: 'vessel' };
  const ownerVisibilityUser = { id: 'owner-user', role: 'owner' };
  const operatorVisibilityUser = { id: 'operator-user', role: 'operator' };
  assert.deepEqual(
    taskWorkflow.selectTasksVisibleToUser(visibilityFixture, vesselVisibilityUser, visibilityRelationships).map(task => task.id),
    ['ordinary', 'ordinary-meeting'],
    'vessel-facing selectors must fail closed for vessel scope, task flags, either side of canonical links, and incomplete or internal-control meeting lineage',
  );
  assert.deepEqual(
    taskWorkflow.selectTasksVisibleToUser(visibilityFixture, ownerVisibilityUser, visibilityRelationships).map(task => task.id),
    visibilityFixture.map(task => task.id),
    'authorized internal users must retain the complete task collection',
  );
  assert.deepEqual(taskWorkflow.selectTasksVisibleToUser([ordinaryVisibleTask, otherVesselTask], operatorVisibilityUser, visibilityRelationships).map(task => task.id), ['ordinary'], 'non-admin internal users must fail closed when vessel scope is revoked');
  const validOperatorInternalTask={id:'operator-internal-valid',isInternalControl:true,internalControlCaseId:'operator-case-valid',vesselId:'vessel-a',vesselIds:['vessel-a'],sourceType:'morning',attentionDimension:'task',ownerUserIds:[]};
  const orphanOperatorInternalTask={...validOperatorInternalTask,id:'operator-internal-orphan',internalControlCaseId:'missing-case'};
  const crossScopeOperatorInternalTask={...validOperatorInternalTask,id:'operator-internal-cross',internalControlCaseId:'operator-case-cross'};
  const reverseOnlyTask={id:'operator-reverse-only',isInternalControl:false,vesselId:'vessel-a',vesselIds:['vessel-a'],sourceType:'morning',attentionDimension:'task',ownerUserIds:[]};
  const duplicateOperatorInternalTask={...validOperatorInternalTask,id:'operator-internal-duplicate',internalControlCaseId:'operator-case-duplicate-a'};
  const validOperatorInternalMeetingTask=meetingTask('operator-internal-meeting','operator-meeting-internal','operator-item-internal',{isInternalControl:true});
  const operatorInternalCases=[
    {id:'operator-case-valid',vesselId:'vessel-a',syncToTask:true,linkedTaskId:'operator-internal-valid'},
    {id:'operator-case-cross',vesselId:'vessel-b',syncToTask:true,linkedTaskId:'operator-internal-cross'},
    {id:'operator-case-reverse',vesselId:'vessel-a',syncToTask:true,linkedTaskId:'operator-reverse-only'},
    {id:'operator-case-duplicate-a',vesselId:'vessel-a',syncToTask:true,linkedTaskId:'operator-internal-duplicate'},
    {id:'operator-case-duplicate-b',vesselId:'vessel-a',syncToTask:true,linkedTaskId:'operator-internal-duplicate'},
    {id:'operator-case-standalone',vesselId:'vessel-a',syncToTask:false},
  ];
  const operatorInternalTasks=[validOperatorInternalTask,orphanOperatorInternalTask,crossScopeOperatorInternalTask,reverseOnlyTask,duplicateOperatorInternalTask,validOperatorInternalMeetingTask];
  const operatorInternalRelationships={internalControlCases:operatorInternalCases,meetings:[meeting('operator-meeting-internal',true,'operator-item-internal')],visibleVesselIds:['vessel-a']};
  assert.deepEqual(taskWorkflow.selectTasksVisibleToUser(operatorInternalTasks,operatorVisibilityUser,operatorInternalRelationships).map(task=>task.id),['operator-internal-valid','operator-internal-meeting'],'non-admin operators must see only reciprocal scoped ordinary internal links and valid scoped internal meetings');
  assert.deepEqual(taskWorkflow.selectInternalControlCasesVisibleToUser(operatorInternalCases,operatorInternalTasks,operatorVisibilityUser,['vessel-a']).map(item=>item.id),['operator-case-valid','operator-case-standalone'],'operator internal-case projection must retain valid reciprocal and legitimate standalone cases while rejecting cross-scope, reverse-only, and duplicate links');
  const duplicatedForwardClaim={...validOperatorInternalTask,id:'operator-internal-duplicate-forward'};
  const validOperatorCase=operatorInternalCases[0];
  assert.deepEqual(taskWorkflow.selectTasksVisibleToUser([validOperatorInternalTask,duplicatedForwardClaim],operatorVisibilityUser,{internalControlCases:[validOperatorCase],meetings:[],visibleVesselIds:['vessel-a']}).map(task=>task.id),[],'every task claiming a multiply-claimed internal-control case must fail closed');
  assert.deepEqual(taskWorkflow.selectInternalControlCasesVisibleToUser([validOperatorCase],[validOperatorInternalTask,duplicatedForwardClaim],operatorVisibilityUser,['vessel-a']).map(item=>item.id),[],'a case claimed by more than one task must fail closed even when it reciprocates one task id');
  const falselyClaimedStandaloneCase={id:'operator-case-falsely-standalone',vesselId:'vessel-a',syncToTask:false};
  const oneSidedForwardTask={...validOperatorInternalTask,id:'operator-internal-one-sided-forward',internalControlCaseId:falselyClaimedStandaloneCase.id};
  assert.deepEqual(taskWorkflow.selectInternalControlCasesVisibleToUser([falselyClaimedStandaloneCase],[oneSidedForwardTask],operatorVisibilityUser,['vessel-a']),[],'a nominally standalone case that is claimed by a task must fail closed instead of taking the standalone early return');
  const lockVessel={id:'vessel-a',assignedUserIds:['operator-user'],delegateManagers:[]};
  const lockOperator={id:'operator-user',role:'operator',managedVesselIds:[]};
  const lockOwner={id:'owner-user',role:'owner',managedVesselIds:[]};
  const lockVesselUser={id:'vessel-user',role:'vessel',managedVesselIds:['vessel-a']};
  assert.equal(taskWorkflow.canAcquireTaskEditLock(ordinaryVisibleTask,lockOperator,false,[lockVessel],undefined),false,'close/delete-only or read-only identities must not acquire task locks');
  assert.equal(taskWorkflow.canAcquireTaskEditLock(ordinaryVisibleTask,lockOperator,true,[],undefined),false,'responsibility-only viewers without live vessel scope must not acquire task locks');
  assert.equal(taskWorkflow.canAcquireTaskEditLock(ordinaryVisibleTask,lockOperator,true,[lockVessel],undefined),true,'an operator with business-edit and exact vessel scope must acquire the task lock');
  assert.equal(taskWorkflow.canAcquireTaskEditLock(ordinaryVisibleTask,lockOwner,true,[lockVessel],undefined),true,'owner edit flow must retain task locking');
  assert.equal(taskWorkflow.canAcquireTaskEditLock(ordinaryVisibleTask,lockVesselUser,true,[lockVessel],undefined),false,'vessel identities must remain lock-free read-only viewers');
  assert.deepEqual(taskWorkflow.selectTasksVisibleToUser(visibilityFixture, vesselVisibilityUser), [], 'missing relationship context must fail closed for vessel identities');
  assert.deepEqual(taskWorkflow.selectTasksVisibleToUser(visibilityFixture, null, visibilityRelationships), [], 'missing identity must fail closed');
  assert.deepEqual(visibilityFixture, [ordinaryVisibleTask, otherVesselTask, unscopedTask, linkedInternalTask, malformedLinkClaim, reciprocalCaseClaim, internalMeetingClaim, ordinaryMeetingTask, missingMeetingTask, orphanMeetingSemanticsTask, duplicateMeetingTask, unclassifiedMeetingTask, missingMeetingItemTask, duplicateMeetingItemTask, mismatchedMeetingScopeTask], 'visibility projection must not mutate source tasks');

  const coordinator = editLockCoordinator.createEditLockCoordinator();
  const generationOne = coordinator.beginGeneration();
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const order = [];
  const first = coordinator.run(async () => { order.push('claim-1-start'); await firstGate; order.push('claim-1-end'); });
  coordinator.invalidate();
  const release = coordinator.run(async () => { order.push('release-1'); });
  const generationTwo = coordinator.beginGeneration();
  const second = coordinator.run(async () => { order.push('claim-2'); });
  await Promise.resolve();
  assert.deepEqual(order, ['claim-1-start'], 'serialized lock queue must not start release or successor claim before the first claim settles');
  assert.equal(coordinator.isCurrent(generationOne), false, 'invalidated lock generation must fail closed synchronously');
  assert.equal(coordinator.isCurrent(generationTwo), true, 'latest lock generation must remain current');
  releaseFirst();
  await Promise.all([first, release, second]);
  assert.deepEqual(order, ['claim-1-start', 'claim-1-end', 'release-1', 'claim-2'], 'release must finish before a successor same-section claim can start');
  const mutationLock={sectionKey:'task:one',status:'owned',ownerUserId:'operator-user',authorizationEpoch:'epoch-one',generation:7,validatedUntilMs:2000};
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:one','operator-user','epoch-one',true,true,1000),true,'an exact current owned lease with retained record and conservative validity must allow mutation');
  assert.equal(editLockCoordinator.editLockAllowsMutation({...mutationLock,status:'error'},'task:one','operator-user','epoch-one',true,true,1000),false,'error leases must fail closed at mutation boundary');
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:other','operator-user','epoch-one',true,true,1000),false,'a lease for another section must not authorize mutation');
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:one','other-user','epoch-one',true,true,1000),false,'a lease from another user must not authorize mutation');
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:one','operator-user','epoch-two',true,true,1000),false,'a lease from a stale auth epoch must not authorize mutation');
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:one','operator-user','epoch-one',false,true,1000),false,'an invalidated generation must not authorize a stale callback');
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:one','operator-user','epoch-one',true,false,1000),false,'a missing opaque lease record must fail closed');
  assert.equal(editLockCoordinator.editLockAllowsMutation(mutationLock,'task:one','operator-user','epoch-one',true,true,2000),false,'an expired conservative validity window must fail closed even before React rerenders');
  const deadlineNow=Date.parse('2026-07-23T00:00:00.000Z');
  assert.equal(editLockCoordinator.conservativeLeaseDeadline('2026-07-23T00:01:15.000Z',deadlineNow),deadlineNow+60_000,'mutation window must stay shorter than the requested server TTL');
  assert.equal(editLockCoordinator.conservativeLeaseDeadline('2026-07-23T00:00:10.000Z',deadlineNow),deadlineNow+5_000,'a delayed response must use server expiry minus safety margin');
  assert.equal(editLockCoordinator.conservativeLeaseDeadline(undefined,deadlineNow),deadlineNow,'missing server expiry must fail closed immediately');

  assert.deepEqual(workflow.DEFAULT_EQUIPMENT_FAILURE_SUBCATEGORIES, [
    '机舱设备',
    '救生、消防、应急及安全设备',
    '驾驶台设备',
    '系泊和锚泊设备',
    '动力与推进',
    '防污染设备',
    '货物操作设备',
    '甲板机械',
    '船体/结构',
    '生活区/MLC设备',
    '保安/保全设备',
    '个人防护/作业安全设备',
    '医疗/急救设备',
    '测试/测量/校验工具',
    '电子管理平台/数据系统',
  ]);
  assert.deepEqual(workflow.sanitizeEquipmentFailureSubcategories(['驾驶台设备', ' 驾驶台设备 ', '', '机舱设备']), ['驾驶台设备', '机舱设备']);
  assert.equal(workflow.isValidInternalControlDate('2024-02-29'), true);
  assert.equal(workflow.isValidInternalControlDate('2026-02-29'), false);
  assert.equal(workflow.isValidInternalControlDate('2026-99-99'), false);

  const migrated = normalizeModule.normalizeAppData({
    revision: 1,
    updatedAt: '2026-07-23T00:00:00.000Z',
    settings: { sitePasswordHash: 'x', departments: [], taskCategories: ['設備故障'], meetingTaskCategories: [], rolePermissions: {}, nonOwnerPasswordResetVersion: 2 },
    users: [],
    vessels: [{ id: 'v1', name: '一號', isActive: true }],
    tasks: [{ id: 'legacy-task', vesselId: 'v1', isInternalControl: true, category: '設備故障', categories: ['設備故障'], description: '舊內控要事', status: '處理中', reportDate: '2026-07-22', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z', statusLogs: [] }],
    meetings: [], agendaReports: [], auditLogs: [], notifications: [],
  });
  assert.ok(migrated);
  assert.equal(migrated.internalControlCases.length, 1, 'legacy internal-control tasks must be backfilled into the new canonical collection');
  assert.equal(migrated.tasks[0].internalControlCaseId, migrated.internalControlCases[0].id);
  assert.equal(migrated.internalControlCases[0].linkedTaskId, 'legacy-task');
  assert.deepEqual(migrated.settings.equipmentFailureSubcategories, workflow.DEFAULT_EQUIPMENT_FAILURE_SUBCATEGORIES);

  const invalidDateMigration = normalizeModule.normalizeAppData({
    ...structuredClone(migrated),
    tasks: [],
    internalControlCases: [{ ...structuredClone(migrated.internalControlCases[0]), linkedTaskId: undefined, syncToTask: false, reportDate: '2026-99-99', isClosed: true, closedDate: '2026-02-30', equipmentSubcategory: undefined, status: 'canonical', statusLogs: [{ id: 'legacy-mismatch', at: '2026-07-22T00:00:00.000Z', by: 'legacy', text: 'different' }] }],
  });
  assert.ok(invalidDateMigration);
  assert.equal(invalidDateMigration.internalControlCases[0].reportDate, invalidDateMigration.internalControlCases[0].createdAt.slice(0, 10));
  assert.equal(invalidDateMigration.internalControlCases[0].closedDate, invalidDateMigration.internalControlCases[0].reportDate, 'invalid closure dates must be repaired to a real non-pre-report date');
  assert.equal(invalidDateMigration.internalControlCases[0].statusLogs[0].text, invalidDateMigration.internalControlCases[0].status, 'normalization must repair canonical status/history projection');
  assert.equal(invalidDateMigration.internalControlCases[0].equipmentSubcategory, workflow.DEFAULT_EQUIPMENT_FAILURE_SUBCATEGORIES[0], 'equipment-failure normalization must repair the required subcategory');
  assert.equal(normalizeModule.normalizeAppData({ ...structuredClone(migrated), tasks: [], internalControlCases: [{ vesselId: 'v1', description: '' }] }), null, 'malformed internal-control cases must fail closed instead of disappearing');

  const legacyScopeRepair = normalizeModule.normalizeAppData({
    ...structuredClone(migrated),
    vessels: [
      ...structuredClone(migrated.vessels),
      { ...structuredClone(migrated.vessels[0]), id: 'v2', name: '二號' },
    ],
    tasks: [{ ...structuredClone(migrated.tasks[0]), vesselIds: ['v2'], ownerUserIds: ['stale-owner'] }],
  });
  assert.ok(legacyScopeRepair);
  assert.deepEqual(taskScope.taskVesselIds(legacyScopeRepair.tasks[0]), ['v1'], 'legacy ordinary internal-control tasks must be repaired to their canonical single vessel');
  assert.deepEqual(legacyScopeRepair.tasks[0].ownerUserIds, [], 'legacy stale owners must not survive canonical scope repair');

  const duplicateLegacyLink = normalizeModule.normalizeAppData({
    ...structuredClone(migrated),
    tasks: [
      { ...structuredClone(migrated.tasks[0]), id: 'legacy-task-a', internalControlCaseId: migrated.internalControlCases[0].id },
      { ...structuredClone(migrated.tasks[0]), id: 'legacy-task-b', internalControlCaseId: migrated.internalControlCases[0].id },
    ],
    internalControlCases: [{ ...structuredClone(migrated.internalControlCases[0]), linkedTaskId: 'legacy-task-a' }],
  });
  assert.ok(duplicateLegacyLink);
  assert.equal(duplicateLegacyLink.internalControlCases.length, 2, 'each legacy internal-control task must receive a distinct canonical case');
  assert.equal(new Set(duplicateLegacyLink.tasks.map(item => item.internalControlCaseId)).size, 2, 'duplicate legacy case links must be repaired one-to-one');
  duplicateLegacyLink.tasks.forEach(task => {
    const linked = duplicateLegacyLink.internalControlCases.find(item => item.id === task.internalControlCaseId);
    assert.equal(linked?.linkedTaskId, task.id, 'repaired task/case links must agree in both directions');
  });

  const duplicateCaseLinks = normalizeModule.normalizeAppData({
    ...structuredClone(migrated),
    tasks: [{ ...structuredClone(migrated.tasks[0]), internalControlCaseId: 'case-a' }],
    internalControlCases: [
      { ...structuredClone(migrated.internalControlCases[0]), id: 'case-a', linkedTaskId: 'legacy-task' },
      { ...structuredClone(migrated.internalControlCases[0]), id: 'case-b', linkedTaskId: 'legacy-task', description: '須保留的重複歷史案件' },
    ],
  });
  assert.ok(duplicateCaseLinks);
  const reciprocalCases = duplicateCaseLinks.internalControlCases.filter(item => item.linkedTaskId === 'legacy-task');
  assert.deepEqual(reciprocalCases.map(item => item.id), ['case-a'], 'only the task-declared canonical case may retain the reciprocal link');
  const preservedDuplicate = duplicateCaseLinks.internalControlCases.find(item => item.id === 'case-b');
  assert.equal(preservedDuplicate?.description, '須保留的重複歷史案件');
  assert.equal(preservedDuplicate?.syncToTask, false, 'non-canonical duplicate cases must be preserved as unlinked history');
  assert.equal(preservedDuplicate?.linkedTaskId, undefined);

  const vessels = [
    { id: 'v1', name: '一號', fullName: 'ONE', shortName: '1', shipType: '散貨船', assignedUserIds: ['u1'], delegateManagers: [], isActive: true },
    { id: 'v2', name: '二號', fullName: 'TWO', shortName: '2', shipType: '油輪', assignedUserIds: ['u1'], delegateManagers: [], isActive: true },
    { id: 'v3', name: '三號', fullName: 'THREE', shortName: '3', shipType: '散貨船', assignedUserIds: [], delegateManagers: [], isActive: true },
  ];
  const user = { id: 'u1', role: 'operator', managedVesselIds: ['v2', 'v1'], isActive: true };
  assert.deepEqual(workflow.defaultInternalControlVesselIds(user, vessels), ['v1', 'v2']);
  assert.deepEqual(workflow.managedInternalControlVesselIds(user, vessels), ['v1', 'v2']);
  assert.deepEqual(workflow.defaultInternalControlVesselIds({ id: 'u2', role: 'operator', managedVesselIds: [], isActive: true }, vessels), [], '沒有經管船舶時預設不得退回第一艘可見船，空陣列代表不限條件');
  assert.deepEqual(workflow.defaultInternalControlVesselIds({ id: 'owner', role: 'owner', managedVesselIds: ['v3'], isActive: true }, vessels), ['v3'], 'Owner仍只預選個人明確經管船舶，不得因角色而預選全部可見船舶');

  const baseCase = {
    id: 'ic1', vesselId: 'v1', reportDate: '2026-07-23', reportSource: '訪船', description: '主機異常', priority: '高', category: '設備故障', equipmentSubcategory: '机舱设备', isAware: true, status: '安排檢修', departments: ['輪機'], syncToTask: false, isClosed: false, createdBy: 'u1', updatedBy: 'u1', createdAt: '2026-07-23T01:00:00.000Z', updatedAt: '2026-07-23T01:00:00.000Z', statusLogs: [],
  };
  assert.ok(workflow.validateInternalControlCase({ ...baseCase, isClosed: true, closedDate: '2026-07-01' }).includes('結案日期'), 'closure date may not precede report date');
  const cases = [
    baseCase,
    { ...baseCase, id: 'ic2', vesselId: 'v2', reportSource: '日常', priority: '低', category: '船舶管理', departments: ['海務'], reportDate: '2026-06-01', isClosed: true, closedDate: '2026-06-10' },
  ];
  const filtered = workflow.filterInternalControlCases(cases, vessels, { keyword: '主機', vesselIds: ['v1'], shipTypes: ['散貨船'], priorities: ['高'], categories: ['設備故障'], departments: ['輪機'], reportSources: ['訪船'], fromDate: '2026-07-01', toDate: '2026-07-31' });
  assert.deepEqual(filtered.map(item => item.id), ['ic1']);
  const stats = workflow.buildInternalControlStats(cases);
  assert.equal(stats.total, 2);
  assert.equal(stats.open, 1);
  assert.equal(stats.closed, 1);
  assert.equal(stats.byPriority.find(item => item.label === '高')?.count, 1);
  assert.equal(stats.monthlyTrend.find(item => item.label === '2026-07')?.count, 1);

  const task = workflow.internalControlCaseToTask(baseCase, { id: 'task1', ownerUserIds: ['u1'], actorId: 'u1', at: '2026-07-23T02:00:00.000Z' });
  assert.equal(task.internalControlCaseId, 'ic1');
  assert.equal(task.isInternalControl, true);
  assert.equal(task.isAbnormal, true);
  assert.deepEqual(task.categories, ['設備故障']);
  const batchResult = batchActions.completeSelectedTasks([task], [task.id], {
    actorId: 'u1', actorName: '甲', at: '2026-07-23T02:20:00.000Z', closedDate: '2026-07-23',
  });
  assert.equal(batchResult.tasks[0].status, '批量完成待辦');
  assert.equal(batchResult.tasks[0].statusLogs[0].text, batchResult.tasks[0].status, 'batch completion must keep canonical status and newest history aligned');
  const multiVesselTask = { ...structuredClone(task), id: 'multi-vessel-internal', vesselIds: ['v1', 'v2'] };
  const multiVesselDraft = { users: [], vessels: structuredClone(vessels), tasks: [multiVesselTask], internalControlCases: [] };
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(multiVesselDraft, undefined, multiVesselTask, { id: 'u1', name: '甲' }, '2026-07-23T02:30:00.000Z'),
    /內控要事僅能關聯單一船舶/,
  );
  assert.equal(multiVesselDraft.internalControlCases.length, 0, 'rejected multi-vessel internal tasks must not create a partial case');
  const taskStatusDraft = {
    users: [], vessels: structuredClone(vessels),
    tasks: [structuredClone(task)],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  taskStatusDraft.tasks[0].status = 'changed-without-log';
  const taskStatusBefore = structuredClone(taskStatusDraft);
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(taskStatusDraft, task, taskStatusDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:40:00.000Z'),
    /狀態變更必須新增歷程/,
  );
  assert.deepEqual(taskStatusDraft, taskStatusBefore, 'rejected task-to-case status changes must be atomic');
  const emptyDepartmentSaved = { ...structuredClone(task), departments: [] };
  const emptyDepartmentDraft = {
    users: [], vessels: structuredClone(vessels), tasks: [emptyDepartmentSaved],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const emptyDepartmentBefore = structuredClone(emptyDepartmentDraft);
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(emptyDepartmentDraft,task,emptyDepartmentSaved,{ id:'u1',name:'甲' },'2026-07-23T02:42:00.000Z'),
    /至少需要一個涉及部門/,
    'editing an existing linked internal-control task may not clear every department',
  );
  assert.deepEqual(emptyDepartmentDraft,emptyDepartmentBefore,'rejected reverse department synchronization must be atomic');
  const equipmentRepairPrevious = structuredClone(task);
  const equipmentRepairSaved = structuredClone(task);
  delete equipmentRepairSaved.equipmentSubcategory;
  const equipmentRepairDraft = {
    users: [], vessels: structuredClone(vessels), tasks: [equipmentRepairSaved],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const repairedEquipmentCase = dataLayer.reconcileInternalControlAfterTaskSave(equipmentRepairDraft, equipmentRepairPrevious, equipmentRepairSaved, { id: 'u1', name: '甲' }, '2026-07-23T02:45:00.000Z');
  assert.equal(equipmentRepairSaved.equipmentSubcategory, '机舱设备', 'existing linked case subcategory repair must project back to the task');
  assert.equal(repairedEquipmentCase.equipmentSubcategory, equipmentRepairSaved.equipmentSubcategory, 'reciprocal equipment subcategories must remain identical');
  const categoryChangeSaved = { ...structuredClone(task), category: '船舶管理', categories: ['船舶管理'] };
  delete categoryChangeSaved.equipmentSubcategory;
  const categoryChangeDraft = {
    users: [], vessels: structuredClone(vessels), tasks: [categoryChangeSaved],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const categoryChangedCase = dataLayer.reconcileInternalControlAfterTaskSave(categoryChangeDraft, structuredClone(task), categoryChangeSaved, { id: 'u1', name: '甲' }, '2026-07-23T02:45:30.000Z');
  assert.equal(categoryChangedCase.category, '船舶管理');
  assert.equal(categoryChangedCase.equipmentSubcategory, undefined, 'changing a linked task away from equipment failure must clear stale case equipment metadata');
  assert.equal(categoryChangeSaved.equipmentSubcategory, undefined, 'non-equipment task must not retain equipment metadata');
  const vesselMismatchDraft = {
    users: [], vessels: structuredClone(vessels), tasks: [structuredClone(task)],
    internalControlCases: [{ ...structuredClone(baseCase), vesselId: 'v2', syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const vesselMismatchBefore = structuredClone(vesselMismatchDraft);
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(vesselMismatchDraft, task, vesselMismatchDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:46:00.000Z'),
    /船舶範圍不一致/,
  );
  assert.deepEqual(vesselMismatchDraft, vesselMismatchBefore, 'mismatched live task/case vessel scope must fail atomically');
  const directVesselMismatchDraft = {
    users: [], vessels: structuredClone(vessels), tasks: [structuredClone(task)],
    internalControlCases: [{ ...structuredClone(baseCase), vesselId: 'v2', syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const directVesselMismatchBefore = structuredClone(directVesselMismatchDraft);
  assert.throws(
    () => dataLayer.updateInternalControlCase(
      directVesselMismatchDraft,
      structuredClone(directVesselMismatchDraft.internalControlCases[0]),
      directVesselMismatchDraft.internalControlCases[0].updatedAt,
      { id: 'u1', name: '甲' },
      '2026-07-23T02:46:30.000Z',
    ),
    /船舶範圍不一致/,
  );
  assert.deepEqual(directVesselMismatchDraft, directVesselMismatchBefore, 'direct case updates must reject a pre-existing task/case vessel mismatch atomically');
  const taskMovePrevious = structuredClone(task);
  const taskMoveSaved = { ...structuredClone(task), vesselId: 'v2' };
  const taskMoveDraft = {
    users: [], vessels: structuredClone(vessels), tasks: [taskMoveSaved],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const taskMovedCase = dataLayer.reconcileInternalControlAfterTaskSave(taskMoveDraft, taskMovePrevious, taskMoveSaved, { id: 'u1', name: '甲' }, '2026-07-23T02:47:00.000Z');
  assert.equal(taskMovedCase.vesselId, 'v2', 'authorized task-origin vessel moves must still synchronize the linked case');
  const closedTask = {
    ...structuredClone(task), description: '<p>closed original</p>', status: 'done', isClosed: true,
    closedDate: '2026-07-23', closedBy: 'u1',
    statusLogs: [{ id: 'closed-log', at: '2026-07-23T02:00:00.000Z', by: '甲', byUserId: 'u1', text: 'done' }],
  };
  const closedCase = workflow.taskToInternalControlCase(closedTask, { ...structuredClone(baseCase), statusLogs: structuredClone(closedTask.statusLogs) }, { actorId: 'u1', at: '2026-07-23T02:00:00.000Z' });
  const closedTaskDraft = { users: [], vessels: structuredClone(vessels), tasks: [structuredClone(closedTask)], internalControlCases: [closedCase] };
  closedTaskDraft.tasks[0].description = '<p>closed changed through task</p>';
  const closedTaskBefore = structuredClone(closedTaskDraft);
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(closedTaskDraft, closedTask, closedTaskDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:50:00.000Z'),
    /已結案案件須先重新開啟/,
  );
  assert.deepEqual(closedTaskDraft, closedTaskBefore, 'rejected closed task-to-case edits must be atomic');
  const reopenChangedDraft = { users: [], vessels: structuredClone(vessels), tasks: [structuredClone(closedTask)], internalControlCases: [structuredClone(closedCase)] };
  Object.assign(reopenChangedDraft.tasks[0], { isClosed: false, description: '<p>same-call reopen mutation</p>' });
  delete reopenChangedDraft.tasks[0].closedDate;
  delete reopenChangedDraft.tasks[0].closedBy;
  const reopenChangedBefore = structuredClone(reopenChangedDraft);
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(reopenChangedDraft, closedTask, reopenChangedDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:51:00.000Z'),
    /須先重新開啟/,
  );
  assert.deepEqual(reopenChangedDraft, reopenChangedBefore, 'same-call task reopen plus content mutation must be atomic');
  const taskReopenOnlyDraft = { users: [], vessels: structuredClone(vessels), tasks: [structuredClone(closedTask)], internalControlCases: [structuredClone(closedCase)] };
  taskReopenOnlyDraft.tasks[0].isClosed = false;
  delete taskReopenOnlyDraft.tasks[0].closedDate;
  delete taskReopenOnlyDraft.tasks[0].closedBy;
  const taskReopened = dataLayer.reconcileInternalControlAfterTaskSave(taskReopenOnlyDraft, closedTask, taskReopenOnlyDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:51:30.000Z');
  assert.equal(taskReopened.isClosed, false, 'a dedicated task-origin reopen-only transaction must remain valid');
  const directReopenDraft = { users: [{ id:'u1', name:'甲', isActive:true, role:'operator' }], vessels: structuredClone(vessels), tasks: [structuredClone(closedTask)], internalControlCases: [structuredClone(closedCase)] };
  const directReopenChanged = { ...structuredClone(closedCase), isClosed: false, description: '<p>same-call direct reopen mutation</p>' };
  delete directReopenChanged.closedDate;
  delete directReopenChanged.closedBy;
  assert.throws(
    () => dataLayer.updateInternalControlCase(directReopenDraft, directReopenChanged, closedCase.updatedAt, { id: 'u1', name: '甲' }, '2026-07-23T02:52:00.000Z'),
    /須先重新開啟/,
  );
  const directReopenOnly = { ...structuredClone(closedCase), isClosed: false };
  delete directReopenOnly.closedDate;
  delete directReopenOnly.closedBy;
  const reopened = dataLayer.updateInternalControlCase(directReopenDraft, directReopenOnly, closedCase.updatedAt, { id: 'u1', name: '甲' }, '2026-07-23T02:53:00.000Z');
  assert.equal(reopened.isClosed, false, 'a dedicated reopen-only transaction must remain valid');
  assert.equal(directReopenDraft.tasks[0].isClosed, false, 'reopen-only must synchronize to the reciprocal task');
  const duplicateLiveDraft = {
    users: [], vessels: structuredClone(vessels),
    tasks: [structuredClone(task)],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  duplicateLiveDraft.internalControlCases.push({
    ...structuredClone(duplicateLiveDraft.internalControlCases[0]),
    id: 'duplicate-live-case',
    linkedTaskId: duplicateLiveDraft.tasks[0].id,
  });
  const duplicateLiveBefore = structuredClone(duplicateLiveDraft);
  assert.throws(
    () => dataLayer.reconcileInternalControlAfterTaskSave(duplicateLiveDraft, task, duplicateLiveDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:55:00.000Z'),
    /同步關聯不是唯一雙向關係/,
  );
  assert.deepEqual(duplicateLiveDraft, duplicateLiveBefore, 'ambiguous live links must be rejected atomically');
  assert.throws(
    () => dataLayer.closeLinkedInternalControlCaseAfterTaskDelete(duplicateLiveDraft, duplicateLiveDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:56:00.000Z'),
    /同步關聯不是唯一雙向關係/,
  );
  assert.deepEqual(duplicateLiveDraft, duplicateLiveBefore, 'ambiguous deletion links must be rejected atomically');
  const duplicateTaskClaimDraft = {
    users: [], vessels: structuredClone(vessels),
    tasks: [structuredClone(task), { ...structuredClone(task), id: 'duplicate-task-claim' }],
    internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
  };
  const duplicateTaskClaimBefore = structuredClone(duplicateTaskClaimDraft);
  assert.throws(
    () => dataLayer.updateInternalControlCase(duplicateTaskClaimDraft, structuredClone(duplicateTaskClaimDraft.internalControlCases[0]), baseCase.updatedAt, { id: 'u1', name: '甲' }, '2026-07-23T02:57:00.000Z'),
    /同步關聯不是唯一雙向關係/,
  );
  assert.deepEqual(duplicateTaskClaimDraft, duplicateTaskClaimBefore, 'duplicate task claims must be rejected atomically');
  for (const [name, patch, expected] of [
    ['missing report date', { reportDate: '' }, /報告日期/],
    ['invalid report date', { reportDate: '2026-02-30' }, /報告日期/],
    ['missing status', { status: '' }, /狀態變更必須新增歷程|案件狀態/],
    ['missing category', { category: '', categories: [] }, /事項分類/],
    ['missing equipment subcategory', { category: '設備故障', categories: ['設備故障'], equipmentSubcategory: undefined }, /設備故障細項/],
    ['invalid closure date', { isClosed: true, closedDate: '2026-02-30', closedBy: 'u1' }, /結案日期/],
  ]) {
    const invalidDraft = {
      users: [], vessels: structuredClone(vessels),
      tasks: [{ ...structuredClone(task), ...patch }],
      internalControlCases: [{ ...structuredClone(baseCase), syncToTask: true, linkedTaskId: task.id, statusLogs: structuredClone(task.statusLogs) }],
    };
    if (name === 'missing equipment subcategory') {
      invalidDraft.internalControlCases[0].category = '其他';
      delete invalidDraft.internalControlCases[0].equipmentSubcategory;
    }
    const invalidBefore = structuredClone(invalidDraft);
    assert.throws(
      () => dataLayer.reconcileInternalControlAfterTaskSave(invalidDraft, task, invalidDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-23T02:57:00.000Z'),
      expected,
      name,
    );
    assert.deepEqual(invalidDraft, invalidBefore, `${name} must be rejected atomically`);
  }
  const linkedCase = workflow.taskToInternalControlCase({ ...task, status: '已確認備件', isClosed: true, closedDate: '2026-07-25' }, baseCase, { actorId: 'u1', at: '2026-07-25T02:00:00.000Z' });
  assert.equal(linkedCase.linkedTaskId, 'task1');
  assert.equal(linkedCase.status, '已確認備件');
  assert.equal(linkedCase.isClosed, true);
  assert.equal(linkedCase.closedDate, '2026-07-25');

  const workCases = scope.selectUserWorkCenterInternalCases({ internalControlCases: cases }, user, vessels);
  assert.deepEqual(workCases.map(item => item.id), ['ic1']);
  assert.deepEqual(
    scope.selectUserWorkCenterInternalCases({ internalControlCases: cases }, { ...user, role: 'vessel' }, vessels),
    [],
    'work-center internal-case selector must fail closed for vessel role even if invoked during a stale role-transition render',
  );

  const vessel = { ...vessels[0], weeklyAttention: [], manualAttentionLevel: '', position: {}, cargo: {}, note: {}, createdAt: '', updatedAt: '' };
  assert.equal(attention.deriveVesselAttention(vessel, [], false, [baseCase]).effective, '高');
  const twoHighInternal = attention.deriveVesselAttention(vessel, [], false, [baseCase, { ...baseCase, id: 'ic-high-2' }]);
  assert.equal(attention.vesselAttentionLabel(twoHighInternal, []), '高關注 2', 'attention labels must report real standalone internal-control counts');
  assert.equal(attention.deriveVesselAttention(vessel, [], false, [{ ...baseCase, priority: '急' }]).effective, '急');
  assert.equal(attention.deriveVesselAttention(vessel, [], false, [{ ...baseCase, priority: '低' }]).effective, '低');
  assert.equal(attention.deriveVesselAttention(vessel, [], false, [{ ...baseCase, priority: '中' }]).effective, '中');
  assert.equal(attention.deriveVesselAttention(vessel, [{ ...task, priority: '高' }], false, [{ ...baseCase, linkedTaskId: 'task1', syncToTask: true }]).internalControlUnlinkedCount, 0);

  const draft = {
    users: [{ ...user, name: '督導甲', department: '督導', passwordHash: '', username: 'u1', createdAt: '', updatedAt: '' }],
    vessels: [{ ...vessel, assignedUserIds: ['u1'] }],
    tasks: [],
    internalControlCases: [],
  };
  const created = dataLayer.createInternalControlCases(draft, [{ ...baseCase, id: 'batch-1', syncToTask: true }], draft.users[0], '2026-07-23T03:00:00.000Z');
  assert.deepEqual(created.caseIds, ['batch-1']);
  assert.equal(draft.internalControlCases.length, 1);
  assert.equal(draft.tasks.length, 1);
  assert.equal(draft.internalControlCases[0].linkedTaskId, draft.tasks[0].id);
  assert.equal(draft.tasks[0].internalControlCaseId, 'batch-1');
  assert.equal(draft.internalControlCases[0].statusLogs.length, 1, 'required initial status should become an immutable history entry');
  const canonicalEquipmentDraft = {
    users: structuredClone(draft.users), vessels: structuredClone(draft.vessels), tasks: [], internalControlCases: [],
  };
  dataLayer.createInternalControlCases(canonicalEquipmentDraft, [{ ...baseCase, id: 'canonical-non-equipment', category: '船舶管理', equipmentSubcategory: '机舱设备', syncToTask: false }], canonicalEquipmentDraft.users[0], '2026-07-23T03:05:00.000Z');
  assert.equal(canonicalEquipmentDraft.internalControlCases[0].equipmentSubcategory, undefined, 'direct create must clear equipment metadata for non-equipment categories');
  const canonicalPrevious = structuredClone(canonicalEquipmentDraft.internalControlCases[0]);
  dataLayer.updateInternalControlCase(canonicalEquipmentDraft, { ...canonicalPrevious, equipmentSubcategory: '驾驶台设备' }, canonicalPrevious.updatedAt, canonicalEquipmentDraft.users[0], '2026-07-23T03:06:00.000Z');
  assert.equal(canonicalEquipmentDraft.internalControlCases[0].equipmentSubcategory, undefined, 'direct update must clear smuggled equipment metadata for non-equipment categories');
  const divergentCreateBefore = structuredClone(draft);
  assert.throws(
    () => dataLayer.createInternalControlCases(draft, [{ ...baseCase, id: 'divergent-create', status: 'canonical', statusLogs: [{ id: 'bad', at: '', by: '', text: 'different' }] }], draft.users[0], '2026-07-23T03:10:00.000Z'),
    /最新狀態必須與新增歷程一致/,
  );
  assert.deepEqual(draft, divergentCreateBefore, 'divergent initial status/history must be rejected atomically');

  const movedDraft = structuredClone(draft);
  movedDraft.users.push({ ...movedDraft.users[0], id: 'u2', name: '新船督導', username: 'u2' });
  movedDraft.vessels.push({ ...movedDraft.vessels[0], id: 'v2', name: '二號', assignedUserIds: ['u2'] });
  movedDraft.tasks[0].vesselIds = ['v1'];
  movedDraft.tasks[0].ownerUserIds = ['u1'];
  const movedPrevious = structuredClone(movedDraft.internalControlCases[0]);
  dataLayer.updateInternalControlCase(movedDraft, { ...structuredClone(movedPrevious), vesselId: 'v2' }, movedPrevious.updatedAt, movedDraft.users[0], '2026-07-24T01:00:00.000Z');
  assert.equal(movedDraft.tasks[0].vesselId, 'v2');
  assert.deepEqual(taskScope.taskVesselIds(movedDraft.tasks[0]), ['v2'], 'linked task scope must be canonicalized to the case vessel');
  assert.deepEqual(movedDraft.tasks[0].ownerUserIds, ['u2'], 'moving a linked case must remove owners who are not assigned to the destination vessel');
  assert.throws(
    () => dataLayer.updateInternalControlCase(movedDraft, { ...structuredClone(movedDraft.internalControlCases[0]), status: '未記錄的狀態變更' }, movedDraft.internalControlCases[0].updatedAt, movedDraft.users[0], '2026-07-24T01:30:00.000Z'),
    /狀態變更必須新增歷程/,
  );
  assert.throws(() => dataLayer.updateInternalControlCase(movedDraft, { ...movedDraft.internalControlCases[0], statusLogs: [] }, movedDraft.internalControlCases[0].updatedAt, movedDraft.users[0], '2026-07-24T02:00:00.000Z'), /歷程只能附加/);

  const cancellationDraft = structuredClone(draft);
  const cancellationPrevious = structuredClone(cancellationDraft.tasks[0]);
  const cancelledTask = { ...structuredClone(cancellationPrevious), isInternalControl: false };
  cancellationDraft.tasks[0] = cancelledTask;
  const cancelledCase = dataLayer.reconcileInternalControlAfterTaskSave(cancellationDraft, cancellationPrevious, cancelledTask, cancellationDraft.users[0], '2026-07-25T01:00:00.000Z');
  assert.equal(cancelledCase?.isClosed, true);
  assert.equal(cancelledCase?.linkedTaskId, undefined);
  assert.equal(cancelledCase?.statusLogs[0].text, cancelledCase?.status, 'cancellation event status and newest history must match');
  assert.equal(cancelledTask.statusLogs[0].text, cancelledTask.status, 'surviving cancelled task status and newest history must match');
  assert.equal(cancelledTask.internalControlCaseId, undefined);

  const openDeletionDraft = structuredClone(draft);
  const previousCase = structuredClone(draft.internalControlCases[0]);
  const candidateCase = { ...structuredClone(previousCase), status: '修理完成', isClosed: true, closedDate: '2026-07-26', statusLogs: [{ id: 'client-new', at: '', by: '', text: '修理完成' }, ...structuredClone(previousCase.statusLogs)] };
  dataLayer.updateInternalControlCase(draft, candidateCase, previousCase.updatedAt, draft.users[0], '2026-07-26T02:00:00.000Z');
  assert.equal(draft.internalControlCases[0].isClosed, true);
  assert.equal(draft.internalControlCases[0].closedDate, '2026-07-26');
  assert.equal(draft.internalControlCases[0].closedBy, 'u1');
  assert.equal(draft.tasks[0].isClosed, true);
  assert.equal(draft.tasks[0].status, '修理完成');
  assert.equal(draft.tasks[0].statusLogs[0].byUserId, 'u1');
  assert.throws(
    () => dataLayer.updateInternalControlCase(draft, { ...structuredClone(draft.internalControlCases[0]), description: '不得直接改寫已結案內容' }, draft.internalControlCases[0].updatedAt, draft.users[0], '2026-07-26T02:30:00.000Z'),
    /已結案案件須先重新開啟/,
  );
  const closedDeletionDraft = structuredClone(draft);
  const closedDeletionBefore = structuredClone(closedDeletionDraft);
  assert.throws(
    () => dataLayer.closeLinkedInternalControlCaseAfterTaskDelete(closedDeletionDraft, closedDeletionDraft.tasks[0], closedDeletionDraft.users[0], '2026-07-26T03:00:00.000Z'),
    /先單獨重新開啟/,
  );
  assert.deepEqual(closedDeletionDraft, closedDeletionBefore, 'deleting a task linked to a closed case must be rejected atomically');
  const brokenLinkDraft = structuredClone(draft);
  brokenLinkDraft.tasks = [];
  const brokenLinkBefore = structuredClone(brokenLinkDraft);
  assert.throws(() => dataLayer.updateInternalControlCase(brokenLinkDraft, structuredClone(brokenLinkDraft.internalControlCases[0]), brokenLinkDraft.internalControlCases[0].updatedAt, brokenLinkDraft.users[0], '2026-07-26T04:00:00.000Z'), /關聯要事不存在|同步關聯不是唯一雙向關係/);
  assert.deepEqual(brokenLinkDraft, brokenLinkBefore, 'failed linked updates must leave both collections untouched');
  const orphanClaimDraft = { users: [], vessels: structuredClone(vessels), tasks: [{ ...structuredClone(task), internalControlCaseId: 'missing-case' }], internalControlCases: [] };
  assert.throws(() => dataLayer.closeLinkedInternalControlCaseAfterTaskDelete(orphanClaimDraft, orphanClaimDraft.tasks[0], { id: 'u1', name: '甲' }, '2026-07-26T04:10:00.000Z'), /同步關聯不是唯一雙向關係/);

  const syncTask = (id, caseId, status) => ({ ...structuredClone(task), id, internalControlCaseId: caseId, status, statusLogs: [{ id: `${id}-new`, at: '', by: '', text: status }, ...structuredClone(task.statusLogs)] });
  const syncCase = (id, taskId) => ({ ...structuredClone(baseCase), id, linkedTaskId: taskId, syncToTask: true, statusLogs: structuredClone(task.statusLogs) });
  const atomicSyncDraft = {
    users: structuredClone(draft.users), vessels: structuredClone(draft.vessels),
    tasks: [syncTask('sync-task-1', 'sync-case-1', '第一筆完成'), syncTask('sync-task-2', 'sync-case-2', '第二筆完成')],
    internalControlCases: [syncCase('sync-case-1', 'sync-task-1'), syncCase('sync-case-2', 'sync-task-2'), syncCase('sync-case-2-duplicate', 'sync-task-2')],
  };
  const atomicSyncBefore = structuredClone(atomicSyncDraft);
  assert.throws(() => dataLayer.syncLinkedInternalControlCasesFromTasks(atomicSyncDraft, atomicSyncDraft.tasks.map(item => item.id), atomicSyncDraft.users[0], '2026-07-27T00:00:00.000Z'), /同步關聯不是唯一雙向關係/);
  assert.deepEqual(atomicSyncDraft, atomicSyncBefore, 'multi-item synchronization must commit all-or-nothing');

  const filterModes = workflow.filterInternalControlCases(cases, vessels, { ...workflow.emptyInternalControlFilters(), equipmentSubcategories: ['机舱设备'], awareMode: 'aware', closureMode: 'open' });
  assert.deepEqual(filterModes.map(item => item.id), ['ic1']);
  const vesselStats = workflow.buildInternalControlStats(cases, vessels);
  assert.equal(vesselStats.byVessel.find(item => item.label.includes('一號'))?.count, 1);
  assert.equal(vesselStats.byShipType.find(item => item.label === '散貨船')?.count, 1);
  assert.equal(vesselStats.monthlyTrend.find(item => item.month === '2026-06')?.closed, 1);

  const deletionDraft = openDeletionDraft;
  const linkedTaskForDeletion = deletionDraft.tasks[0];
  dataLayer.closeLinkedInternalControlCaseAfterTaskDelete(deletionDraft, linkedTaskForDeletion, deletionDraft.users[0], '2026-07-27T01:00:00.000Z');
  deletionDraft.tasks = deletionDraft.tasks.filter(item => item.id !== linkedTaskForDeletion.id);
  assert.equal(deletionDraft.internalControlCases[0].isClosed, true);
  assert.equal(deletionDraft.internalControlCases[0].linkedTaskId, undefined);
  assert.equal(deletionDraft.internalControlCases[0].syncToTask, false);
  assert.equal(deletionDraft.internalControlCases[0].statusLogs[0].text, deletionDraft.internalControlCases[0].status, 'deletion event status and newest history must match');

  console.log('internal-control runtime verification passed');
} finally {
  await server.close();
}
