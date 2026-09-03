import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import fpmcLogo from './assets/fpmc-logo.png';
import { createInitialData } from './data/seed';
import type { AgendaReport, AppData, FilterState, InternalControlCase, MorningReportSnapshot, StatusLog, TaskItem, TaskPriority, TemporaryMeeting, UserAccount, Vessel, VesselAttentionLevel, WeeklyAttentionKey } from './types';
import { CLOUD_CACHE_IDENTITY_KEY, CLOUD_CONFIRMED_BASE_KEY, CLOUD_REVISION_FLOORS_KEY, CURRENT_USER_KEY, SESSION_SITE_UNLOCK, STORAGE_KEY, daysDiff, loadLocal, nowIso, roleLabel, sanitizeAppDataForStorage, saveLocal, sha256, todayDate, uid, withAudit } from './utils';
import { CloudBlockPatchUnavailableError, CloudConflictError, applyCloudBlockPatch as applyCloudBlockPatchRpc, claimEditLock, cloudStoragePayloadFor, fetchCloudData, getSupabaseConfig, releaseEditLock, renewEditLock, saveCloudData, saveSupabaseConfig, subscribeToCloudRevision, type ResolvedSupabaseConfig, type SupabaseConfig } from './cloud';
import { appDataContentEqual, CloudRebaseConflictError, prepareCloudSyncSnapshot, rebaseDisjointAppData } from './cloudRebase';
import { mergeConfirmedCloudSnapshot } from './cloudConfirmedMerge';
import { mayOfferFirstRunInitialization, mayPersistLocalSnapshot, trustedMatchingCloudIdentity } from './cloudBootstrapSafety';
import ManagementView from './Management';
import MorningWorkspaceView from './MorningWorkspace';
import TemporaryMeetingsPage from './TemporaryMeetings';
import { TaskEditModal, VesselEditModal } from './EditModals';
import { normalizeAppData } from './normalize';
import DashboardView from './Dashboard';
import { scrollToDashboardVesselCard } from './dashboardVesselReturn';
import BatchManagedVesselModal from './BatchManagedVesselModal';
import VesselDetailPage from './VesselDetailPage';
import WorkCenter from './WorkCenter';
import DataAnalysisView from './DataAnalysis';
import { canAccessAllVessels, hasPermission, isEligibleTaskOwner } from './permissions';
import { selectUserWorkCenterInternalCases, selectUserWorkCenterTasks, taskBelongsToUserWorkCenter } from './workCenterScope';
import { markOwnNotificationsRead } from './notificationReadReceipts';
import { clearDismissalsForNewTaskAssignments, dismissWorkCenterItems, workCenterDismissalId } from './taskDismissals';
import InternalControlPage from './InternalControlPage';
import { closeLinkedInternalControlCaseAfterTaskDelete, createInternalControlCases, deleteInternalControlCase, reconcileInternalControlAfterTaskSave, syncLinkedInternalControlCasesFromTasks, updateInternalControlCase, withdrawInternalControlTaskSync, type InternalControlTaskProjection } from './internalControlData';
import { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications, canAccessTab, canAcquireTaskEditLock, canCancelInternalControl, canDeleteTask, canUseVessel, internalControlTransitionRequested, selectInternalControlCasesVisibleToUser, selectTasksVisibleToUser, taskSourceLabel, trustedClosureDate, validateInternalControlTransition } from './taskWorkflow';
import { repairPendingCompanyLevelNotificationOverflow } from './notificationCompaction';
import { isMeetingTaskSource, mergeAttentionFromCategories, normalizeMeetingTaskCategoryList, normalizeTaskCategoryList, taskCategoriesOf, taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { applyItineraryOperationalWriteMask, applyVesselOperationalDraft, vesselOperationalDraftEquals } from './vesselOperationalDraft';
import { applyItineraryProjectionSnapshot, buildItineraryProjectionSnapshot, resolveVesselWithItineraryProjection, type ItineraryProjectionSnapshot } from './itinerary/itineraryOperationalProjection';
import { useItineraryOperationalProjection } from './itinerary/useItineraryOperationalProjection';
import { taskHasVessel, taskReportShipTypeLabel, taskReportVesselLabel, taskShipTypeLabel, taskVesselIds, taskVesselLabel, taskVessels } from './taskVesselScope';
import { buildTaskReadOnlyEditorData, type TaskReadOnlyEditorData } from './taskReadOnlyProjection';
import { deriveVesselAttention, manualVesselAttentionAllowed } from './vesselAttention';
import { dashboardMeetingAlerts, meetingCreatesVesselAbnormalAlert } from './meetingVesselAttention';
import { canEditTemporaryMeetings, meetingAppliesToUser } from './meetingAccess';
import { completeSelectedTasksWithMeetingSync, sanitizeTaskSelection, validateBatchTaskSelection } from './batchTaskActions';
import { closeInternalControlCaseBatchFromDraft, deleteInternalControlCaseBatchFromDraft, internalControlBatchLockKeys, validateBatchInternalControlSelection } from './batchInternalControlActions';
import { meetingDecisionCompletionSummary, meetingDecisionLifecycleIsConsistent, meetingTaskLinkIsValidForMutation, resolveMeetingTaskItemIdForDeletion, synchronizeLinkedMeetingDecisionLifecycle, transitionLinkedMeetingDecision } from './meetingTaskWorkflow';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { appearsInSingleVesselTasks, canonicalTaskAttentionForSave, isMeetingAttentionTask, isVesselDelegatedMeetingTask, vesselAttentionTasks } from './taskAttention';
import { hasActiveVesselDelegation, userCanManageVesselByAssignmentOrDelegation } from './vesselDelegation';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskIsClosedForScope, taskIsClosedForVessel, taskProgressForVessel, taskProjectedProgressForScope, updateTaskVesselProgress, usesPerVesselProgress } from './taskVesselProgress';
import { formatScheduleDisplay } from './scheduleTime';
import { formatTaipeiDate, formatTaipeiDateTime, taipeiDateKey } from './taipeiTime';
import { dailyMorningReports, liveMorningWindow, morningBaselineSnapshot, upsertDailyMorningReport } from './morningHistory';
import { classifyMorningAgenda } from './morningAgenda';
import { printMorningReportPdf } from './morningReportPdf';
import RichTextContent from './RichTextContent';
import { richTextToPlainText } from './richText';
import { classifyExpiredLeaseRelease, classifyLeaseRenewalAfterAwait, classifyMutationLeaseFailure, classifyVesselLeaseIncidentClose, classifyVesselLeaseRenewalFailure, conservativeLeaseDeadline, createEditLockCoordinator, editLockAllowsMutation, shouldRenderProductionCloudSafetyGate } from './editLockCoordinator';
import { acquireEditLockBundle } from './editLockBundle';
import { batchMutationSessionIsCurrent, createBatchManagedAuthorization, type BatchManagedAuthorization } from './batchManagedAuthorization';
import { createLeaseReleaseState, pendingTrackedLeases, registerTrackedLease, releaseTrackedLeases, type TrackedLeaseToken } from './leaseReleaseTracker';
import { runDurableCreationHandoff, waitForDurableCreationHandoff, type DurableCreationHandoffBarrier } from './durableCreationHandoff';
import { consumeCurrentTaskEditorSession } from './taskEditorSession';
import { isTaskCreationLockKey, taskCreationLockKey, taskCreationLockMatchesVessel } from './taskCreationLock';
import { bootstrapFailureHasUnsavedWork, cloudConfigIdentity, cloudWorkspaceIdentity, creationTaskCommitMatches, normalizeStoredCloudWorkspaceIdentity, parseConfirmedCloudBase, parseDurableRevisionFloors, serializeConfirmedCloudBase, serializeDurableRevisionFloors, trustedPersistedBaseForRemote, updateDurableRevisionFloor, withStableCreationAttemptProvenance } from './cloudRecovery';
import { CLOUD_SAVE_QUEUE_SECTION_KEY, CLOUD_SAVE_QUEUE_TTL_SECONDS, CloudSaveQueueCancelledError, CloudSaveQueueRpcTimeoutError, CloudSaveQueueTimeoutError, createCloudSaveIntentQueue, drainCloudSaveQueueUntilStable, hasUnconfirmedVisibleChanges, runCloudSaveQueueRpc, waitForCloudSaveTurn } from './cloudSaveQueue';
import { internalControlCreationLockKey, internalControlEditLockKey, isInternalControlCreationLockKey, isMeetingCreationLockKey, meetingCreationLockKey, meetingEditLockKey } from './exclusiveItemEditLock';
import { resolveItemEditSession } from './itemEditSession';
import { buildCloudBlockPatch, CloudBlockPatchConflictError } from './cloudBlockPatch';
import { actorStorageAuthorizationGuard, appDataAuthorizationDomainChanged, assertActorAuthorizedForAppDataChange, authorizationDomainGuard } from './cloudAuthorization';
import { classifyCloudSyncFailure, cloudErrorMessage } from './cloudSyncError';
import { shouldOfferStaleBrowserRecovery } from './staleBrowserRecovery';
import { APP_VERSION_CHECK_INTERVAL_MS, appRecoveryReloadUrl, appUpdateBlockReason, appVersionReloadUrl, checkForAppVersion } from './appVersionUpdate';
import BrowserRecoveryModal, { type BrowserRecoveryPhase } from './BrowserRecoveryModal';
import { clearShipDynamicsBrowserStorage, repairShipDynamicsResources, shouldBlockAppBeforeUnload } from './browserRecovery';
import { relatedEntityLockKeysForSection, taskCreationRelatedLockKeys, taskInternalControlCreationLockKeys, taskRelationLockKeys } from './collaborationLockPlan';
import { cloudWakeupAction } from './realtimeSync';
import { CloudSaveRecoveryLockConflictError, runWithCloudSaveRecoveryLocks } from './cloudSaveLockRecovery';
import { sortRecordsNewestCreated } from './recordSorting';
import { createVesselAttentionSaveQueue, type VesselAttentionSaveState } from './vesselAttentionSaveQueue';
import { WEEKLY_ATTENTION_KEYS } from './weeklyAttention';
import VesselListFilter from './VesselListFilter';
import SelectedTaskPrintTable from './SelectedTaskPrintTable';
import { selectedListRecords } from './selectedListExport';
import {
  managedListVesselIds,
  matchesListVesselSelection,
  nextListColumnSort,
  sortListRecords,
  type ListColumnSort,
} from './listVesselControls';
import {
  PENDING_TASK_CREATION_STORAGE_PREFIX,
  acknowledgePendingTaskCreation,
  createPendingTaskCreationIntent,
  markPendingTaskCreationAttention,
  markPendingTaskCreationRetrying,
  markPendingTaskCreationWaiting,
  pendingTaskCreationAppStateIsCurrent,
  pendingTaskCreationMatchesContext,
  pendingTaskCreationMayRetry,
  pendingTaskCreationRetryDelayMs,
  readPendingTaskCreations,
  replacePendingTaskCreationTask,
  taskCreationAlreadyCommitted,
  updatePendingTaskCreationIfPresent,
  upsertPendingTaskCreationForTask,
  withPendingTaskCreationStorageLock,
  type PendingTaskCreationIntent,
} from './pendingTaskCreation';

type BatchManagedOperation = { id: number; session: number; authorization: BatchManagedAuthorization | null; locks: TrackedLeaseToken[] };

type Tab = 'dashboard' | 'morning' | 'total' | 'reports' | 'stats' | 'management' | 'meeting' | 'closed' | 'internalControl' | 'work';
type ActiveEditLock = { sectionKey: string; label: string; status: 'owned' | 'blocked' | 'error'; ownerUserId: string; ownerUserName: string; leaseOwnerId: string; generation: number; authorizationEpoch: string; validatedUntilMs: number; lockedByName?: string };
type VesselLeaseIncident={sectionKey:string;leaseOwnerId:string;ownerUserId:string;authorizationEpoch:string;mode:'retrying'|'frozen';message:string};
type PendingCreationRunContext={creationLock:ActiveEditLock;config:ResolvedSupabaseConfig;isCurrent:()=>boolean;adoptRemoteBase:(snapshot:AppData)=>void;adoptCommittedLive:(snapshot:AppData)=>void;updateSubmittedTask:(task:TaskItem)=>Promise<void>;mutationApplied:boolean};
type EditLockClaimResult = 'owned' | 'blocked' | 'unavailable';
type TaskOpenResult='opened'|'failed'|'cancelled';
type TaskReturnDestination={vesselId:string;batchManaged:boolean};
type CreationDraftRecord={leaseOwnerId:string;task:TaskItem};
type SavePhase='saved'|'dirty'|'queued'|'saving'|'error';
type SaveToast={id:number;kind:'success'|'info'|'warning'|'error';title:string;detail:string};
type CloudBlockLockGuard={section_key:string;locked_by:string};
type PendingCloudSaveIntent={snapshot:AppData;baseSnapshot:AppData|null;token:ReturnType<ReturnType<typeof createAsyncConfigCoordinator>['begin']>;savedBy:string;actorUserId:string;lockGuards:CloudBlockLockGuard[];isCurrent:()=>boolean;renderRebase:boolean;visibleBaseline:AppData|null};

export function selectCreationDraftForQuarantine(input:{ownerUserId:string;leaseOwnerId:string;currentTask:TaskItem|null;latest?:CreationDraftRecord;attempt?:CreationDraftRecord}){
  const retained=input.latest?.leaseOwnerId===input.leaseOwnerId?input.latest.task:input.attempt?.leaseOwnerId===input.leaseOwnerId?input.attempt.task:input.currentTask;
  return retained?{task:retained,ownerUserId:input.ownerUserId,leaseOwnerId:input.leaseOwnerId}:null;
}


export function createTaskOpenRequestCoordinator() {
  let generation=0;
  let destination:TaskReturnDestination|undefined;
  return {
    begin(next:TaskReturnDestination){destination={...next};return ++generation;},
    invalidate(){destination=undefined;return ++generation;},
    isCurrent(token:number){return token===generation;},
    clearIfCurrent(token:number){if(token!==generation)return false;destination=undefined;generation+=1;return true;},
    consumeIfCurrent(token:number){if(token!==generation)return undefined;const result=destination?{...destination}:undefined;destination=undefined;generation+=1;return result;},
    consume(){const result=destination?{...destination}:undefined;destination=undefined;generation+=1;return result;},
    peek(){return destination?{...destination}:undefined;},
  };
}

export class StaleAsyncConfigError extends Error { constructor(){super('非同步作業的雲端設定或 generation 已失效');} }
export function createAsyncConfigCoordinator() {
  let epoch=0;
  let generation=0;
  const same=(left:ResolvedSupabaseConfig|null|undefined,right:ResolvedSupabaseConfig|null|undefined)=>Boolean(left&&right&&left.supabaseUrl===right.supabaseUrl&&left.supabaseAnonKey===right.supabaseAnonKey&&left.workspaceKey===right.workspaceKey&&left.tableName===right.tableName);
  return {
    begin(config:ResolvedSupabaseConfig){const snapshot=Object.freeze({...config});return {generation:++generation,epoch,config:snapshot};},
    invalidate(){return ++epoch;},
    isCurrent(token:{generation:number;epoch:number;config:ResolvedSupabaseConfig},current:ResolvedSupabaseConfig|null|undefined){return token.epoch===epoch&&same(token.config,current);},
    async run<T>(token:{generation:number;epoch:number;config:ResolvedSupabaseConfig},current:()=>ResolvedSupabaseConfig|null|undefined,io:(config:ResolvedSupabaseConfig)=>Promise<T>){
      if(token.epoch!==epoch||!same(token.config,current()))throw new StaleAsyncConfigError();
      const result=await io(token.config);
      if(token.epoch!==epoch||!same(token.config,current()))throw new StaleAsyncConfigError();
      return result;
    },
  };
}

export function scheduleValidatedLeaseExpiry(validatedUntilMs:number,onExpire:()=>void,timers:{now:()=>number;setTimeout:(callback:()=>void,delay:number)=>any;clearTimeout:(id:any)=>void}={now:()=>Date.now(),setTimeout:(callback,delay)=>window.setTimeout(callback,delay),clearTimeout:id=>window.clearTimeout(id)}){
  const id=timers.setTimeout(onExpire,Math.max(0,validatedUntilMs-timers.now()));
  return()=>timers.clearTimeout(id);
}

export async function transitionExpiredTaskLease<RequestToken>(input:{
  leaseIsCurrent:()=>boolean;
  invalidateLease:()=>void;
  closeWritableAndBeginReadOnly:()=>RequestToken;
  openLatestReadOnly:(request:RequestToken)=>Promise<TaskOpenResult>;
  requestIsCurrent:(request:RequestToken)=>boolean;
  closeAfterFailure:(request:RequestToken)=>void;
}):Promise<TaskOpenResult>{
  if(!input.leaseIsCurrent())return 'cancelled';
  input.invalidateLease();
  const request=input.closeWritableAndBeginReadOnly();
  const result=await input.openLatestReadOnly(request);
  if(result==='failed'&&input.requestIsCurrent(request))input.closeAfterFailure(request);
  return result;
}

export function internalControlDeletionAuthorized(input:{deleteTasks:boolean;closeTasks:boolean;scopeCancellationAuthorized:boolean}){
  return input.deleteTasks&&input.closeTasks&&input.scopeCancellationAuthorized;
}

export function deleteTaskBatchFromDraft(draft:AppData,selectedTasks:TaskItem[],user:UserAccount,at:string){
  const selectedIds=selectedTasks.map(task=>task.id);
  if(selectedIds.some(id=>!id)||new Set(selectedIds).size!==selectedIds.length)throw new Error('批量刪除的待辦識別碼空白或重複');
  const tasks=selectedIds.map(id=>{
    const matches=draft.tasks.filter(task=>task.id===id);
    if(matches.length!==1)throw new Error(`批量刪除的待辦不存在或識別碼重複：${id}`);
    return matches[0];
  });
  for(const task of tasks){
    closeLinkedInternalControlCaseAfterTaskDelete(draft,task,user,at);
    draft.tasks=draft.tasks.filter(item=>item.id!==task.id);
  }
}

const SYSTEM_TITLE = '船舶動態與會議管理系統';
const SYSTEM_SUBTITLE = 'Fleet Activities & Office Meeting Manage System';
const emptyFilters: FilterState = { keyword:'', departments:[], vesselIds:[], fleetTags:[], priorities:[], categories:[], meetingCategories:[], ownerMode:'all', fromDate:'', toDate:'', closedMode:'open', overdueOnly:false, internalControlOnly:false };

function clone<T>(v:T):T { return JSON.parse(JSON.stringify(v)); }
function statusLogsAppendOnly(candidate: StatusLog[] = [], previous: StatusLog[] = []) {
  if(candidate.length<previous.length)return false;
  return JSON.stringify(candidate.slice(candidate.length-previous.length))===JSON.stringify(previous);
}
function trustedStatusLogs(candidate: StatusLog[] = [], previous: StatusLog[] = [], actor: Pick<UserAccount,'id'|'name'>, at=nowIso()): StatusLog[] {
  const newCount=Math.max(0,candidate.length-previous.length);
  return [
    ...candidate.slice(0,newCount).map(log=>({id:uid('log'),at,by:actor.name,byUserId:actor.id,text:log.text})),
    ...clone(previous),
  ];
}
function priorityClass(p?: string) { return p === '急' ? 'badge urgent' : p === '高' ? 'badge high' : p === '中' ? 'badge mid' : 'badge low'; }
function fmt(dt?: string) { return formatTaipeiDateTime(dt,false); }
function savedStatus(label:string, at?:string) { return `${label}｜最新保存 ${formatTaipeiDateTime(at||new Date(),false)}`; }
export const cloudIdentity=cloudWorkspaceIdentity;
function sameCloudConfig(left:ResolvedSupabaseConfig|undefined|null,right:ResolvedSupabaseConfig|undefined|null) { return Boolean(left&&right&&left.supabaseUrl===right.supabaseUrl&&left.supabaseAnonKey===right.supabaseAnonKey&&left.workspaceKey===right.workspaceKey&&left.tableName===right.tableName); }
function vesselMatchesUser(v: Vessel, user: UserAccount | null, canViewAll = false) { return !user || canViewAll || v.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(v.id) || hasActiveVesselDelegation(v, user.id); }
function batchVisibleVesselIds(data: AppData, user: UserAccount) {
  const canViewAll = user.role==='owner'||user.role==='admin'||hasPermission(data.settings.rolePermissions,user,'viewAllVessels');
  return new Set(data.vessels.filter(vessel=>vessel.isActive&&vesselMatchesUser(vessel,user,canViewAll)).map(vessel=>vessel.id));
}
export function batchTargetVesselsFor(vessels:Vessel[],_user:UserAccount|null,selectedIds:string[]) {
  const selected=new Set(selectedIds);
  return vessels.filter(vessel=>vessel.isActive&&selected.has(vessel.id));
}
export function batchSessionVesselsFor(vessels:Vessel[],targetIds:ReadonlySet<string>) {
  return vessels.filter(vessel=>vessel.isActive&&targetIds.has(vessel.id));
}
export function batchManagedOperationMatches(operation:BatchManagedOperation,currentOperationId:number,currentSession:number,currentAuthorization:BatchManagedAuthorization|null,isOpen:boolean){
  return isOpen&&operation.id===currentOperationId&&operation.session===currentSession&&operation.authorization===currentAuthorization;
}
export function authorizationEpochFor(data:AppData,user:UserAccount|null){
  const canViewAll=user?.role==='owner'||user?.role==='admin'||hasPermission(data.settings.rolePermissions,user,'viewAllVessels');
  const visibleVesselIds=data.vessels.filter(vessel=>vessel.isActive&&vesselMatchesUser(vessel,user,canViewAll)).map(vessel=>vessel.id).sort();
  const managedVesselIds=data.vessels.filter(vessel=>vessel.isActive&&userCanManageVesselByAssignmentOrDelegation(vessel,user)).map(vessel=>vessel.id).sort();
  return [
    user?.id||'',user?.role||'',visibleVesselIds.join(','),managedVesselIds.join(','),
    hasPermission(data.settings.rolePermissions,user,'enterManagement')?'m1':'m0',
    hasPermission(data.settings.rolePermissions,user,'editBusinessContent')?'e1':'e0',
    hasPermission(data.settings.rolePermissions,user,'createTasks')?'c1':'c0',
    hasPermission(data.settings.rolePermissions,user,'closeTasks')?'x1':'x0',
    hasPermission(data.settings.rolePermissions,user,'deleteTasks')?'d1':'d0',
    hasPermission(data.settings.rolePermissions,user,'exportReports')?'r1':'r0',
    canViewAll?'v1':'v0',
  ].join('|');
}
function ReportTaskStatusBlock({ task, scopeIds }: { task: TaskItem; scopeIds: string[] }) {
  const progress=taskProjectedProgressForScope(task,scopeIds);
  const recentLogs=(progress.statusLogs||[]).slice(0,2);
  return <div className="report-task-status-block"><div><b>目前狀態：</b><RichTextContent compact value={progress.status} fallback="尚無狀態"/></div><div><b>完成情形：</b>{progress.isClosed?'已完成':'未完成'}{progress.closedDate?`｜完成日期：${progress.closedDate}`:''}</div><div><b>部門／期限：</b>{task.departments.join('、')||'未指定部門'}｜{task.expectedDate||'未設定'}</div><div><b>最後更新：</b>{fmt(progress.updatedAt)}</div>{recentLogs.length>0&&<div className="report-status-log"><b>最近狀態：</b>{recentLogs.map(log=><div key={log.id}><span>{fmt(log.at)}｜{log.by}：</span><RichTextContent compact value={log.text} fallback="-"/></div>)}</div>}</div>;
}

function taskMatchesFilters(t: TaskItem, filters: FilterState, vesselMap: Record<string,Vessel>, currentUser: UserAccount | null, applyClosedMode: boolean, canViewAll = false, taskOwnerAccess = false) {
  const vessels = taskVesselIds(t).map(id => vesselMap[id]).filter((vessel): vessel is Vessel => Boolean(vessel?.isActive));
  const visibleVessels = vessels.filter(vessel => vesselMatchesUser(vessel, currentUser, canViewAll));
  if (!visibleVessels.length && !taskOwnerAccess) return false;
  const closedInVisibleScope=visibleVessels.length?taskIsClosedForScope(t,visibleVessels.map(vessel=>vessel.id)):t.isClosed;
  if (applyClosedMode && filters.closedMode === 'open' && closedInVisibleScope) return false;
  if (applyClosedMode && filters.closedMode === 'closed' && !closedInVisibleScope) return false;
  if (filters.overdueOnly && (closedInVisibleScope || (daysDiff(t.expectedDate) ?? 0) >= 0)) return false;
  const kw=filters.keyword.trim().toLowerCase();
  const visibleStatusTexts=usesPerVesselProgress(t)&&visibleVessels.length?visibleVessels.map(v=>taskProgressForVessel(t,v.id).status):[t.status];
  if(kw&&![richTextToPlainText(t.description),...visibleStatusTexts.map(richTextToPlainText),...taskCategoriesOf(t),...visibleVessels.flatMap(v=>[v.name,v.shortName,v.fullName,v.shipType]),...t.departments].join(' ').toLowerCase().includes(kw))return false;
  if(filters.departments.length&&!t.departments.some(d=>filters.departments.includes(d)))return false;
  if(currentUser){
    const selection={mode:filters.ownerMode,vesselIds:filters.vesselIds};
    const managedVesselIds=managedListVesselIds(currentUser,visibleVessels);
    if(!matchesListVesselSelection(visibleVessels.map(vessel=>vessel.id),selection,managedVesselIds,currentUser.id,t.ownerUserIds))return false;
  }else if(filters.ownerMode!=='all'||filters.vesselIds.length&&!visibleVessels.some(v=>filters.vesselIds.includes(v.id)))return false;
  if(filters.fleetTags.length&&!visibleVessels.some(v=>v.fleetTags.some(f=>filters.fleetTags.includes(f))))return false;
  if(filters.priorities.length&&!filters.priorities.includes(t.priority))return false;
  const categoryFiltersActive=filters.categories.length||filters.meetingCategories.length;
  if(categoryFiltersActive){
    const meetingSource=isMeetingTaskSource(t);
    const selected=meetingSource?filters.meetingCategories:filters.categories;
    if(!selected.length||!taskCategoriesOf(t).some(category=>selected.includes(category)))return false;
  }
  if(filters.internalControlOnly&&!t.isInternalControl)return false;
  const date=taipeiDateKey(t.updatedAt||t.createdAt);
  return !(filters.fromDate&&date<filters.fromDate)&&!(filters.toDate&&date>filters.toDate);
}

export default function App() {
  const [data, setData] = useState<AppData>(() => normalizeAppData(loadLocal()) || createInitialData());
  const [siteUnlocked, setSiteUnlocked] = useState(() => sessionStorage.getItem(SESSION_SITE_UNLOCK) === '1');
  const [currentUserId, setCurrentUserIdState] = useState(() => localStorage.getItem(CURRENT_USER_KEY) || '');
  const liveCurrentUserId = useRef(currentUserId);
  const identitySessionGeneration=useRef(0);
  const setCurrentUserId=(nextUserId:string)=>{identitySessionGeneration.current+=1;liveCurrentUserId.current=nextUserId;setCurrentUserIdState(nextUserId);};
  const [tab, setTab] = useState<Tab>('dashboard');
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [closedFilters, setClosedFilters] = useState<FilterState>({...emptyFilters,closedMode:'closed'});
  const [selectedVesselDetailId, setSelectedVesselDetailId] = useState('');
  const dashboardReturnVesselIdRef=useRef('');
  const [editingVesselId, setEditingVesselId] = useState<string>('');
  const [editingTaskId, setEditingTaskId] = useState<string>('');
  const [requestedInternalControlCaseId,setRequestedInternalControlCaseId]=useState('');
  const [taskEditorRequestGeneration,setTaskEditorRequestGeneration]=useState(0);
  const [creationHandoffVersion,setCreationHandoffVersion]=useState(0);
  const [taskEditorAuthorizationEpoch, setTaskEditorAuthorizationEpoch] = useState('');
  const [taskProgressVesselId, setTaskProgressVesselId] = useState<string>('');
  const [taskReadOnlyData, setTaskReadOnlyData] = useState<TaskReadOnlyEditorData | null>(null);
  const [taskReadOnlyReason, setTaskReadOnlyReason] = useState('');
  const [creatingTask, setCreatingTask] = useState<TaskItem | null>(null);
  const [quarantinedCreationDrafts,setQuarantinedCreationDrafts]=useState<Record<string,{task:TaskItem;ownerUserId:string;leaseOwnerId:string}>>({});
  const [batchManagedOpen, setBatchManagedOpen] = useState(false);
  const [batchEditLocks,setBatchEditLocks]=useState<ActiveEditLock[]>([]);
  const [batchManagedClosing,setBatchManagedClosing]=useState(false);
  const [batchManagedWriteSuspended,setBatchManagedWriteSuspended]=useState(false);
  const [cloudStatus, setCloudStatusValue] = useState('本機模式');
  const [cloudStatusAuthorizationEpoch,setCloudStatusAuthorizationEpoch]=useState('');
  const [cloudStatusSectionKey,setCloudStatusSectionKey]=useState('');
  const [agendaSelection, setAgendaSelection] = useState<string[]>([]);
  const [batchSelectedVesselIds, setBatchSelectedVesselIds] = useState<string[]>([]);
  const [printTitle, setPrintTitle] = useState('');
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [reportPreviewHistoryId,setReportPreviewHistoryId]=useState('');
  const [reportPreviewLiveItinerarySnapshot,setReportPreviewLiveItinerarySnapshot]=useState<ItineraryProjectionSnapshot|null>(null);
  useEffect(()=>{setReportPreviewOpen(false);setReportPreviewHistoryId('');setReportPreviewLiveItinerarySnapshot(null);},[currentUserId]);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [cloudBootstrapped, setCloudBootstrapped] = useState(false);
  const [cloudWriteBlocked, setCloudWriteBlocked] = useState(false);
  const [cloudInitializationAllowed, setCloudInitializationAllowed] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [savePhase,setSavePhase]=useState<SavePhase>('saved');
  const [cloudWakeupRevision,setCloudWakeupRevision]=useState(-1);
  const [saveToast,setSaveToast]=useState<SaveToast|null>(null);
  const [vesselAttentionSaveStates,setVesselAttentionSaveStates]=useState<Record<string,VesselAttentionSaveState>>({});
  const [pendingTaskCreations,setPendingTaskCreations]=useState<PendingTaskCreationIntent[]>(()=>{try{return readPendingTaskCreations(window.localStorage);}catch{return [];}});
  const [staleBrowserRecoveryOffered,setStaleBrowserRecoveryOffered]=useState(false);
  const [browserRecoveryOpen,setBrowserRecoveryOpen]=useState(false);
  const [browserRecoveryAdvanced,setBrowserRecoveryAdvanced]=useState(false);
  const [browserRecoveryPhase,setBrowserRecoveryPhase]=useState<BrowserRecoveryPhase>('idle');
  const [browserRecoveryMessage,setBrowserRecoveryMessage]=useState('');
  const [availableAppVersion,setAvailableAppVersion]=useState('');
  const saveToastRef=useRef<SaveToast|null>(null);
  const [activeEditLock, setActiveEditLock] = useState<ActiveEditLock | null>(null);
  const activeEditLockRef=useRef<ActiveEditLock|null>(null);
  const [vesselLeaseIncident,setVesselLeaseIncident]=useState<VesselLeaseIncident|null>(null);
  const vesselLeaseIncidentRef=useRef<VesselLeaseIncident|null>(null);
  const vesselSaveLeaseOwners=useRef(new Set<string>());
  const closeVesselEditorRef=useRef<(lock:ActiveEditLock|null)=>Promise<boolean>>(async()=>false);
  const savePhaseRef=useRef<SavePhase>(savePhase);
  activeEditLockRef.current=activeEditLock;
  vesselLeaseIncidentRef.current=vesselLeaseIncident;
  savePhaseRef.current=savePhase;
  const saveTimer = useRef<number | null>(null);
  const saveToastTimer=useRef<number|null>(null);
  const hasUnsavedWork=useRef(false);
  const browserRecoveryNavigationRef=useRef(false);
  const cloudSaveQueueBypassUntil=useRef(0);
  const lastCloudRevision = useRef<number>(-1);
  const initialDurableRevisionFloorRegistry=typeof localStorage==='undefined'?{valid:true,floors:new Map<string,number>()}:parseDurableRevisionFloors(localStorage.getItem(CLOUD_REVISION_FLOORS_KEY));
  const durableCloudRevisionFloors=useRef(initialDurableRevisionFloorRegistry.floors);
  const durableRevisionFloorRegistryValid=useRef(initialDurableRevisionFloorRegistry.valid);
  const confirmedCloudData = useRef<AppData | null>(null);
  const liveData = useRef(data);
  const vesselAttentionDirectSaveSnapshots=useRef(new WeakSet<AppData>());
  const liveCreatingTaskId=useRef('');
  liveCreatingTaskId.current=creatingTask?.id||'';
  const activeCloudIdentity = useRef('');
  const pendingCloudData = useRef(createCloudSaveIntentQueue<PendingCloudSaveIntent>());
  const cloudSaveInFlight = useRef<Promise<void> | null>(null);
  const vesselAttentionPersistRef=useRef<(vesselId:string,desired:WeeklyAttentionKey[])=>Promise<void>>(async()=>{throw new Error('關注燈保存尚未就緒');});
  const vesselAttentionSaveQueue=useRef<ReturnType<typeof createVesselAttentionSaveQueue>|null>(null);
  if(!vesselAttentionSaveQueue.current){
    vesselAttentionSaveQueue.current=createVesselAttentionSaveQueue({
      persist:(vesselId,desired)=>vesselAttentionPersistRef.current(vesselId,desired),
      onState:(vesselId,state)=>{
        if(state.phase!=='saved')hasUnsavedWork.current=true;
        if(state.phase==='pending')setSavePhase('dirty');
        if(state.phase==='error')setSavePhase('error');
        setVesselAttentionSaveStates(current=>{
          if(state.phase!=='saved')return{...current,[vesselId]:state};
          if(!current[vesselId])return current;
          const next={...current};delete next[vesselId];return next;
        });
        if(state.phase==='saved'){
          const confirmed=confirmedCloudData.current;
          const cloudConfigured=Boolean(getSupabaseConfig());
          if(vesselAttentionSaveQueue.current?.hasPending()||(cloudConfigured&&(!confirmed||!appDataContentEqual(liveData.current,confirmed)))){
            hasUnsavedWork.current=true;
            setSavePhase('dirty');
          }else{
            hasUnsavedWork.current=false;
            setSavePhase('saved');
          }
        }
      },
    });
  }
  const realtimeRefreshInFlight=useRef(false);
  const transientCloudBlockLockGuards=useRef(new Map<string,{guard:CloudBlockLockGuard;config:ResolvedSupabaseConfig}>());
  const cloudSyncInFlight = useRef(false);
  const autoDepartmentFilterKey = useRef('');
  const previousAuthorizationEpoch = useRef('');
  const liveAuthorizationEpoch = useRef('');
  const liveAuthorizedEditLockKeys=useRef(new Set<string>());
  const lockCoordinator=useRef(createEditLockCoordinator());
  const batchLockCoordinator=useRef(createEditLockCoordinator());
  const taskOpenRequests=useRef(createTaskOpenRequestCoordinator());
  const creationHandoffInFlight=useRef<DurableCreationHandoffBarrier|null>(null);
  const creationAttempts=useRef(new Map<string,{leaseOwnerId:string;task:TaskItem}>());
  const latestCreationDrafts=useRef(new Map<string,{leaseOwnerId:string;task:TaskItem}>());
  const confirmedCreationLeases=useRef(new Set<string>());
  const pendingTaskCreationsRef=useRef<PendingTaskCreationIntent[]>(pendingTaskCreations);
  const pendingTaskCreationProcessorRef=useRef<()=>Promise<void>>(async()=>{});
  const pendingTaskCreationRunGeneration=useRef(0);
  const pendingTaskCreationInFlight=useRef(false);
  const configIoCoordinator=useRef(createAsyncConfigCoordinator());
  const observedCloudConfig=useRef(cloudConfigIdentity(getSupabaseConfig()));
  const leaseCloudConfigs=useRef(new Map<string,{sectionKey:string;config:ResolvedSupabaseConfig}>());
  const blockedTaskCloudConfig=useRef<ResolvedSupabaseConfig|null>(null);
  const pendingClaimConfig=useRef<{generation:number;config:ResolvedSupabaseConfig;invalidated:boolean}|null>(null);
  const batchManagedSession=useRef(0);
  const batchManagedOperation=useRef(0);
  const batchManagedRequested=useRef(false);
  const batchLocalMode=useRef(false);
  const batchManagedCloseInFlight=useRef(false);
  const batchManagedWriteSuspendedRef=useRef(false);
  const batchManagedOpenRef=useRef(false);
  const batchEditLocksRef=useRef<ActiveEditLock[]>([]);
  const batchLeaseReleaseState=useRef(createLeaseReleaseState<ResolvedSupabaseConfig>());
  const batchManagedAuthorization=useRef<BatchManagedAuthorization|null>(null);
  const batchTargetVesselIdsRef=useRef<Set<string>>(new Set());
  const currentUser=data.users.find(u=>u.id===currentUserId && u.isActive) || null;
  const quarantinedCreationDraft=currentUser?quarantinedCreationDrafts[currentUser.id]||null:null;
  liveData.current=data;
  batchManagedOpenRef.current=batchManagedOpen;
  batchEditLocksRef.current=batchEditLocks;
  pendingTaskCreationsRef.current=pendingTaskCreations;
  useEffect(()=>{
    vesselAttentionSaveQueue.current?.dispose();
    setVesselAttentionSaveStates({});
    return()=>vesselAttentionSaveQueue.current?.dispose();
  },[currentUserId]);
  const ownerExists = data.users.some(u => u.role === 'owner' && u.isActive);
  const authorizationEpoch = authorizationEpochFor(data,currentUser);
  liveAuthorizationEpoch.current=authorizationEpoch;
  liveCurrentUserId.current=currentUser?.id||'';
  const setCloudStatus=(value:string)=>{setCloudStatusValue(value);setCloudStatusAuthorizationEpoch('');setCloudStatusSectionKey('');};
  const setSensitiveCloudStatus=(value:string,sectionKey:string)=>{setCloudStatusValue(value);setCloudStatusAuthorizationEpoch(authorizationEpoch);setCloudStatusSectionKey(sectionKey);};
  const publishVesselLeaseIncident=(lock:ActiveEditLock,mode:VesselLeaseIncident['mode'],message:string)=>{
    if(!lock.sectionKey.startsWith('vessel:'))return;
    const incident={sectionKey:lock.sectionKey,leaseOwnerId:lock.leaseOwnerId,ownerUserId:lock.ownerUserId,authorizationEpoch:lock.authorizationEpoch,mode,message};
    vesselLeaseIncidentRef.current=incident;
    setVesselLeaseIncident(incident);
  };
  const clearVesselLeaseIncident=(sectionKey?:string,leaseOwnerId?:string)=>{
    const current=vesselLeaseIncidentRef.current;
    if(!current||(sectionKey&&current.sectionKey!==sectionKey)||(leaseOwnerId&&current.leaseOwnerId!==leaseOwnerId))return;
    vesselLeaseIncidentRef.current=null;
    setVesselLeaseIncident(previous=>previous&&previous.sectionKey===current.sectionKey&&previous.leaseOwnerId===current.leaseOwnerId?null:previous);
  };
  const refreshPendingTaskCreations=()=>{try{setPendingTaskCreations(readPendingTaskCreations(window.localStorage));}catch{/* storage unavailable: keep the current in-memory list */}};
  const showSaveToast=(kind:SaveToast['kind'],title:string,detail:string,durationMs=kind==='error'?7000:4200)=>{
    if(saveToastTimer.current)window.clearTimeout(saveToastTimer.current);
    const id=Date.now();
    const next={id,kind,title,detail};
    saveToastRef.current=next;
    setSaveToast(next);
    saveToastTimer.current=window.setTimeout(()=>{
      setSaveToast(current=>{
        if(current?.id!==id)return current;
        saveToastRef.current=null;
        return null;
      });
      saveToastTimer.current=null;
    },durationMs);
  };
  const dismissSaveToast=()=>{
    if(saveToastTimer.current){window.clearTimeout(saveToastTimer.current);saveToastTimer.current=null;}
    saveToastRef.current=null;
    setSaveToast(null);
  };
  const clearStaleSaveSuccessToast=()=>{
    if(saveToastRef.current?.kind==='success')dismissSaveToast();
  };
  useEffect(()=>{
    const handleStorage=(event:StorageEvent)=>{if(event.key?.startsWith(PENDING_TASK_CREATION_STORAGE_PREFIX))refreshPendingTaskCreations();};
    const requestRun=()=>{void pendingTaskCreationProcessorRef.current();};
    window.addEventListener('storage',handleStorage);
    const timer=window.setInterval(requestRun,3_000);
    window.setTimeout(requestRun,0);
    return()=>{window.removeEventListener('storage',handleStorage);window.clearInterval(timer);};
  },[]);
  const reportCloudSaveFailure=(error:unknown)=>{
    const message=cloudErrorMessage(error);
    const failure=classifyCloudSyncFailure(error);
    if(shouldOfferStaleBrowserRecovery(failure.kind))setStaleBrowserRecoveryOffered(true);
    hasUnsavedWork.current=true;
    const contextChanged=error instanceof StaleAsyncConfigError||error instanceof CloudSaveQueueCancelledError||message.includes('雲端工作區 identity 已變更');
    const detail=contextChanged
      ? `${message}；修改仍保留，請不要關閉頁面，先按「同步最新（安全合併）」確認目前工作區後再保存。`
      : error instanceof CloudSaveRecoveryLockConflictError
        ? `其他人（${error.lockedByName}）正在編輯相關內容；修改仍保留在此頁。請等待對方完成後，先點擊「同步最新（安全合併）」；同步完成後，再點擊「重新保存」。直到畫面顯示「已保存到雲端」才算完成。${error.cleanupFailed?'系統會在短時鎖到期後自動重試。':''}`
        : error instanceof CloudSaveQueueTimeoutError
        ? `${message}；修改仍保留，請稍後再按「立即保存」，並先不要關閉頁面。`
      : error instanceof CloudConflictError||error instanceof CloudRebaseConflictError
        ? '雲端已有其他人更新的內容，你的修改仍保留在此頁，尚未保存到雲端。請先點擊「同步最新（安全合併）」；同步完成後，再點擊「重新保存」。直到畫面顯示「已保存到雲端」才算完成，完成前請不要關閉網頁、瀏覽器或電腦。'
        : `${message}；修改仍保留在目前頁面，請檢查網路後重新保存。`;
    setSavePhase('error');
    setCloudStatus(`保存未完成｜${detail}`);
    showSaveToast('error','尚未保存到雲端',detail);
  };
  const confirmCloudSnapshot=(identity:string,snapshot:AppData)=>{
    confirmedCloudData.current=snapshot;
    if(identity){
      durableCloudRevisionFloors.current=updateDurableRevisionFloor(durableCloudRevisionFloors.current,identity,snapshot.revision);
      try{localStorage.setItem(CLOUD_REVISION_FLOORS_KEY,serializeDurableRevisionFloors(durableCloudRevisionFloors.current));}catch{/* in-memory floor remains authoritative for this session */}
    }
    if(identity){try{localStorage.setItem(CLOUD_CONFIRMED_BASE_KEY,serializeConfirmedCloudBase(identity,snapshot));}catch{/* cloud acknowledgement remains authoritative; reload recovery will fail closed */}}
  };
  const releaseBatchEditLockSnapshot=async(locks:TrackedLeaseToken[],announce=true)=>batchLockCoordinator.current.run(async()=>{
    const released=await releaseTrackedLeases(batchLeaseReleaseState.current,locks,(lock,config)=>runCloudSaveQueueRpc('釋放批量船舶協作鎖',signal=>releaseEditLock(lock.sectionKey,lock.leaseOwnerId,config,signal),8_000));
    if(!released&&announce)setCloudStatus('部分批量船舶協作鎖釋放失敗；編輯已關閉，重新開啟前會先重試釋放');
    else if(released&&announce&&locks.length)setCloudStatus('批量船舶協作鎖已全部釋放');
    return released;
  });
  const beginBatchManagedOperation=():BatchManagedOperation=>({id:++batchManagedOperation.current,session:batchManagedSession.current,authorization:batchManagedAuthorization.current,locks:batchEditLocksRef.current.map(({sectionKey,leaseOwnerId})=>({sectionKey,leaseOwnerId}))});
  const batchManagedOperationIsCurrent=(operation:BatchManagedOperation)=>batchManagedOperationMatches(operation,batchManagedOperation.current,batchManagedSession.current,batchManagedAuthorization.current,batchManagedOpenRef.current);
  const detachBatchManagedState=(message:string)=>{
    const locks=batchEditLocksRef.current;
    batchManagedRequested.current=false;
    batchManagedOpenRef.current=false;
    batchManagedSession.current+=1;
    batchManagedOperation.current+=1;
    batchLockCoordinator.current.invalidate();
    batchLocalMode.current=false;
    batchManagedCloseInFlight.current=false;
    batchManagedWriteSuspendedRef.current=false;
    batchManagedAuthorization.current=null;
    batchTargetVesselIdsRef.current=new Set();
    batchEditLocksRef.current=[];
    setBatchEditLocks([]);
    setBatchManagedOpen(false);
    setBatchManagedClosing(false);
    setBatchManagedWriteSuspended(false);
    if(message)setCloudStatus(message);
    return locks;
  };
  const invalidateBatchManagedLocks=(message:string)=>{
    const locks=detachBatchManagedState(message);
    void releaseBatchEditLockSnapshot(locks,false);
  };

  useEffect(() => {
    if (!mayPersistLocalSnapshot({
      cloudConfigured: Boolean(getSupabaseConfig()),
      cloudBootstrapped,
      cloudWriteBlocked,
      activeCloudIdentity: activeCloudIdentity.current,
      currentCloudIdentity: cloudIdentity(getSupabaseConfig()),
      cloudInitializationAllowed,
      localInitializationAllowed: import.meta.env.DEV,
    })) return;
    const localSaved=saveLocal(data);
    if(!getSupabaseConfig()){
      hasUnsavedWork.current=!localSaved;
      if(localSaved){
        setSavePhase('saved');
        setCloudStatus(savedStatus('已自動保存於本機瀏覽器'));
      }else{
        setSavePhase('error');
        setCloudStatus('本機保存失敗：瀏覽器儲存空間不足或不可用');
        showSaveToast('error','本機保存失敗','修改仍保留在目前頁面，請不要關閉。');
      }
    }
  }, [data, cloudBootstrapped, cloudWriteBlocked, cloudInitializationAllowed]);
  useEffect(()=>()=>{if(saveToastTimer.current)window.clearTimeout(saveToastTimer.current);},[]);
  useEffect(() => { currentUserId ? localStorage.setItem(CURRENT_USER_KEY, currentUserId) : localStorage.removeItem(CURRENT_USER_KEY); }, [currentUserId]);
  useEffect(()=>{taskOpenRequests.current.invalidate();},[tab]);
  useEffect(() => {
    const key = currentUser ? `${currentUser.id}|${currentUser.department || ''}` : '';
    if (autoDepartmentFilterKey.current === key) return;
    autoDepartmentFilterKey.current = key;
    if (!currentUser || currentUser.role === 'vessel' || !currentUser.department || !data.settings.departments.includes(currentUser.department)) return;
    setFilters(previous => ({ ...previous, departments: [currentUser.department] }));
    setClosedFilters(previous => ({ ...previous, departments: [currentUser.department] }));
  }, [currentUser?.id, currentUser?.department, currentUser?.role, data.settings.departments]);

  const cachedCloudIdentityFor=(config:ResolvedSupabaseConfig)=>{
    const stored=localStorage.getItem(CLOUD_CACHE_IDENTITY_KEY)||'';
    const normalized=normalizeStoredCloudWorkspaceIdentity(stored,config);
    if(stored&&normalized!==stored){try{localStorage.setItem(CLOUD_CACHE_IDENTITY_KEY,normalized);}catch{/* migration failure remains fail-closed on next reload */}}
    return normalized;
  };
  const rememberCloudIdentity = () => {
    if (activeCloudIdentity.current) localStorage.setItem(CLOUD_CACHE_IDENTITY_KEY, activeCloudIdentity.current);
  };
  const durableRevisionFloorRegistryIsValid=()=>{
    if(!durableRevisionFloorRegistryValid.current)return false;
    const parsed=parseDurableRevisionFloors(localStorage.getItem(CLOUD_REVISION_FLOORS_KEY));
    if(!parsed.valid){durableRevisionFloorRegistryValid.current=false;return false;}
    return true;
  };
  const assertRemoteExtendsDurableHistory=(identity:string,base:AppData|null,remote:AppData)=>{
    if(!durableRevisionFloorRegistryIsValid())throw new CloudRebaseConflictError(['durable revision floor registry損壞，無法證明雲端歷程']);
    const floor=durableCloudRevisionFloors.current.get(identity)??-1;
    if(remote.revision<floor)throw new CloudRebaseConflictError([`雲端revision ${remote.revision}低於已確認的durable floor ${floor}，疑似rollback`]);
    if(base&&(remote.revision<base.revision||(remote.revision===base.revision&&!appDataContentEqual(base,remote))))throw new CloudRebaseConflictError(['缺少可信的雲端合併基線']);
  };
  const hasCurrentCloudIdentity = () => {
    if(!durableRevisionFloorRegistryIsValid()){
      hasUnsavedWork.current=true;
      setCloudWriteBlocked(true);
      setSavePhase('error');
      setCloudStatus('durable revision floor registry損壞，已禁止載入、同步及保存；請先受控恢復本機歷程資料');
      showSaveToast('error','尚未保存到雲端','本機歷程安全記錄損壞，修改仍保留在此頁；請不要關閉頁面。');
      return false;
    }
    const currentConfig = getSupabaseConfig();
    const currentIdentity = currentConfig ? cloudIdentity(currentConfig) : '';
    if (!currentIdentity || currentIdentity !== activeCloudIdentity.current) {
      hasUnsavedWork.current=true;
      setCloudWriteBlocked(true);
      setSavePhase('error');
      setCloudStatus('雲端設定已在其他分頁變更，已禁止沿用舊 revision；請先同步最新資料');
      showSaveToast('error','尚未保存到雲端','雲端設定已變更，修改仍保留在此頁；請不要關閉頁面，先按「同步最新（安全合併）」。');
      return false;
    }
    return true;
  };
  const realtimeWakeupState=(incomingRevision:number)=>({
    incomingRevision,
    confirmedRevision:lastCloudRevision.current,
    hasUnsavedChanges:Boolean(
      cloudWriteBlocked
      ||hasUnsavedWork.current
      ||pendingCloudData.current.size()>0
      ||pendingTaskCreationsRef.current.length>0
      ||!confirmedCloudData.current
      ||!appDataContentEqual(liveData.current,confirmedCloudData.current)
    ),
    hasActiveItemLease:Boolean(activeEditLockRef.current),
    hasBatchLease:batchManagedOpenRef.current,
    saveInFlight:Boolean(cloudSaveInFlight.current),
  });
  const refreshFromCloudWakeup=async(incomingRevision:number,reason:'realtime'|'focus'|'online')=>{
    const initialAction=cloudWakeupAction(realtimeWakeupState(incomingRevision));
    if(initialAction==='ignore'){setCloudWakeupRevision(-1);return;}
    if(initialAction==='defer'){
      setCloudStatus('雲端已有較新資料；目前編輯或保存完成後會自動安全刷新');
      return;
    }
    if(realtimeRefreshInFlight.current)return;
    const config=getSupabaseConfig();
    if(!config||!cloudBootstrapped)return;
    realtimeRefreshInFlight.current=true;
    try{
      const remote=await fetchCloudData(config);
      if(!remote||!sameCloudConfig(config,getSupabaseConfig()))return;
      const finalAction=cloudWakeupAction(realtimeWakeupState(remote.revision));
      if(finalAction==='defer'){
        setCloudWakeupRevision(previous=>Math.max(previous,remote.revision));
        setCloudStatus('雲端已有較新資料；目前編輯或保存完成後會自動安全刷新');
        return;
      }
      if(finalAction==='ignore'){
        setCloudWakeupRevision(previous=>previous===Number.MAX_SAFE_INTEGER||previous<=remote.revision?-1:previous);
        return;
      }
      const identity=cloudIdentity(config);
      if(identity!==activeCloudIdentity.current)return;
      assertRemoteExtendsDurableHistory(identity,confirmedCloudData.current,remote);
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(identity,remote);
      rememberCloudIdentity();
      hasUnsavedWork.current=false;
      liveData.current=remote;
      setData(remote);
      setCloudWriteBlocked(false);
      setSavePhase('saved');
      setCloudStatus(`已${reason==='realtime'?'即時':'自動'}同步雲端 revision ${remote.revision}`);
      setCloudWakeupRevision(previous=>previous===Number.MAX_SAFE_INTEGER||previous<=remote.revision?-1:previous);
    }catch(error:any){
      setCloudStatus(`自動同步未完成：${error.message||error}；目前資料未被覆蓋`);
    }finally{
      realtimeRefreshInFlight.current=false;
    }
  };
  useEffect(()=>{
    const config=getSupabaseConfig();
    if(!cloudBootstrapped||!config)return;
    const queueRevision=(revision:number)=>setCloudWakeupRevision(previous=>Math.max(previous,revision));
    const unsubscribe=subscribeToCloudRevision(queueRevision,undefined,config);
    const onFocus=()=>queueRevision(Number.MAX_SAFE_INTEGER);
    const onOnline=()=>queueRevision(Number.MAX_SAFE_INTEGER);
    window.addEventListener('focus',onFocus);
    window.addEventListener('online',onOnline);
    return()=>{
      unsubscribe();
      window.removeEventListener('focus',onFocus);
      window.removeEventListener('online',onOnline);
    };
  },[cloudBootstrapped,currentUserId]);
  useEffect(()=>{
    if(cloudWakeupRevision<0)return;
    void refreshFromCloudWakeup(cloudWakeupRevision,cloudWakeupRevision===Number.MAX_SAFE_INTEGER?(navigator.onLine?'focus':'online'):'realtime');
  },[cloudWakeupRevision,savePhase,activeEditLock?.status,batchManagedOpen,data.revision]);
  const captureCloudBlockLockGuards=(config:ResolvedSupabaseConfig):CloudBlockLockGuard[]=>{
    const guards:CloudBlockLockGuard[]=[];
    const add=(lock:ActiveEditLock|undefined,record:{sectionKey:string;config:ResolvedSupabaseConfig}|undefined)=>{
      if(!lock||lock.status!=='owned'||!record||record.sectionKey!==lock.sectionKey||!sameCloudConfig(record.config,config))return;
      guards.push({section_key:lock.sectionKey,locked_by:lock.leaseOwnerId});
    };
    const active=activeEditLockRef.current;
    add(active||undefined,active?leaseCloudConfigs.current.get(active.leaseOwnerId):undefined);
    for(const lock of batchEditLocksRef.current)add(lock,batchLeaseReleaseState.current.records.get(lock.leaseOwnerId));
    for(const {guard,config:guardConfig} of transientCloudBlockLockGuards.current.values())if(sameCloudConfig(guardConfig,config))guards.push(guard);
    return[...new Map(guards.map(guard=>[`${guard.section_key}|${guard.locked_by}`,guard])).values()];
  };
  const enqueueCloudSave = (snapshot: AppData,isCurrent:()=>boolean=()=>true,renderRebase=true): Promise<void> => {
    if(!isCurrent())return Promise.reject(new StaleAsyncConfigError());
    const requestConfig=getSupabaseConfig();
    if (!requestConfig||!hasCurrentCloudIdentity()) return Promise.reject(new Error('雲端工作區 identity 已變更'));
    const requestToken=configIoCoordinator.current.begin(requestConfig);
    hasUnsavedWork.current=true;
    const completion=pendingCloudData.current.enqueue({snapshot,baseSnapshot:confirmedCloudData.current?clone(confirmedCloudData.current):null,token:requestToken,savedBy:currentUser?.name||'unknown',actorUserId:currentUser?.id||'',lockGuards:captureCloudBlockLockGuards(requestConfig),renderRebase,visibleBaseline:renderRebase?null:clone(liveData.current),isCurrent});
    const validateCompletion=()=>{if(!isCurrent()||!configIoCoordinator.current.isCurrent(requestToken,getSupabaseConfig()))throw new StaleAsyncConfigError();};
    if (cloudSaveInFlight.current) return completion.then(validateCompletion);
    const task = (async () => {
      let rebaseAttempts=0;
      let lastSavedSnapshot:AppData|null=null;
      let lastSavedRenderRebase=true;
      let lastSavedVisibleBaseline:AppData|null=null;
      let queueLeaseWarning='';
      try {
        // A save request can arrive while the previous queue lock is being released.
        // Keep this task alive and acquire a fresh turn until every pending snapshot is drained.
        await drainCloudSaveQueueUntilStable({
          hasPending:()=>pendingCloudData.current.size()>0,
          processPendingBatch:async()=>{
          const turnEntry=pendingCloudData.current.peek();
          if(!turnEntry)return;
          const turnRequest=turnEntry.value;
          const saveTurnOwnerId=uid('cloud-save-turn');
          const turnToken=turnRequest.token;
          const turnConfig=turnToken.config;
          let saveTurnOwned=false;
          let heartbeatTimer:number|null=null;
          let heartbeatInFlight:Promise<void>|null=null;
          let heartbeatFailure:unknown=null;
          let heartbeatStopped=false;
          const renewSaveTurn=()=>{
            if(heartbeatStopped||heartbeatInFlight||heartbeatFailure)return;
            heartbeatInFlight=runCloudSaveQueueRpc('雲端保存權續租',signal=>renewEditLock(CLOUD_SAVE_QUEUE_SECTION_KEY,saveTurnOwnerId,CLOUD_SAVE_QUEUE_TTL_SECONDS,turnConfig,signal),8_000)
              .then(lock=>{if(!lock.ok)throw new Error(lock.lockedByName?`雲端保存權已轉交給 ${lock.lockedByName}`:'雲端保存權已失效');})
              .catch(error=>{heartbeatFailure=error;})
              .finally(()=>{heartbeatInFlight=null;});
          };
          const assertSaveTurnActive=()=>{if(heartbeatFailure)throw heartbeatFailure;};
          const stopHeartbeat=async()=>{
            heartbeatStopped=true;
            if(heartbeatTimer!==null){window.clearInterval(heartbeatTimer);heartbeatTimer=null;}
            if(heartbeatInFlight)await heartbeatInFlight;
          };
          try{
            setSavePhase('saving');
            setCloudStatus('正在取得雲端保存順序…');
            let saveTurn:{waited:boolean}|null=null;
            if(Date.now()<cloudSaveQueueBypassUntil.current){
              queueLeaseWarning='保存隊列暫停使用，已改用雲端版本檢查安全保存';
              setCloudStatus('保存隊列暫停使用，正在使用雲端版本檢查保存…');
            }else try{
              saveTurn=await waitForCloudSaveTurn({
                claim:()=>runCloudSaveQueueRpc('取得雲端保存權',signal=>claimEditLock(CLOUD_SAVE_QUEUE_SECTION_KEY,saveTurnOwnerId,turnRequest.savedBy,CLOUD_SAVE_QUEUE_TTL_SECONDS,turnConfig,signal),3_000),
                isCurrent:()=>configIoCoordinator.current.isCurrent(turnToken,getSupabaseConfig()),
                onWaiting:lock=>{
                  const who=lock.lockedByName?`（${lock.lockedByName} 正在保存）`:'';
                  setSavePhase('queued');
                  setCloudStatus(`正在等待前一筆雲端保存完成${who}；你的修改仍保留在此頁`);
                  showSaveToast('info','已進入保存隊列',`前一筆保存完成後會自動接續${who}，請先不要關閉頁面。`);
                },
                maxWaitMs:3_000,
              });
              saveTurnOwned=true;
              heartbeatTimer=window.setInterval(renewSaveTurn,Math.max(1_000,Math.floor(CLOUD_SAVE_QUEUE_TTL_SECONDS*1_000/3)));
            }catch(error){
              if(!(error instanceof CloudSaveQueueTimeoutError||error instanceof CloudSaveQueueRpcTimeoutError))throw error;
              if(error instanceof CloudSaveQueueTimeoutError&&error.lockAcquired){
                void runCloudSaveQueueRpc('清理逾時後才取得的雲端保存權',signal=>releaseEditLock(CLOUD_SAVE_QUEUE_SECTION_KEY,saveTurnOwnerId,turnConfig,signal),3_000).catch(()=>undefined);
              }
              cloudSaveQueueBypassUntil.current=Date.now()+60_000;
              queueLeaseWarning='保存隊列暫時無法確認，已改用雲端版本檢查安全保存';
              setCloudStatus('保存隊列暫時無法確認，正在使用雲端版本檢查保存…');
              showSaveToast('warning','保存隊列暫時無法確認','系統會以雲端版本檢查避免覆蓋；保存完成前請不要關閉頁面。');
            }
            setSavePhase('saving');
            if(saveTurn)setCloudStatus(saveTurn.waited?'已輪到你，正在寫入雲端…':'正在寫入雲端…');
            let pendingEntry=pendingCloudData.current.shift();
            while (pendingEntry) {
              const pending=pendingEntry.value;
              try{
              const {snapshot:next,baseSnapshot:base,token,savedBy,actorUserId,lockGuards,isCurrent}=pending;
              if(!isCurrent())throw new StaleAsyncConfigError();
              if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
              assertSaveTurnActive();
              if (!hasCurrentCloudIdentity()) throw new Error('雲端工作區 identity 已變更');
              if(!base)throw new CloudRebaseConflictError(['缺少可信的雲端合併基線']);
              const nextForSave=repairPendingCompanyLevelNotificationOverflow(base,next);
              if(appDataContentEqual(nextForSave,base)){pendingEntry.resolve();pendingEntry=pendingCloudData.current.shift();continue;}
              let remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);
              if(!remote)throw new CloudRebaseConflictError(['雲端工作區不存在']);
              let persisted:AppData|null=null;
              let mergedRemoteChanges=false;
              while(!persisted){
                if(!isCurrent())break;
                if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig())||!hasCurrentCloudIdentity())throw new StaleAsyncConfigError();
                assertSaveTurnActive();
                assertRemoteExtendsDurableHistory(activeCloudIdentity.current,base,remote);
                const candidate=appDataContentEqual(base,remote)
                  ?{...sanitizeAppDataForStorage(nextForSave),revision:remote.revision+1,updatedAt:nowIso()}
                  :sanitizeAppDataForStorage(rebaseDisjointAppData(base,nextForSave,remote,nowIso(),actorUserId));
                mergedRemoteChanges=mergedRemoteChanges||!appDataContentEqual(base,remote);
                const storageRemote=cloudStoragePayloadFor(remote);
                const operations=buildCloudBlockPatch(remote,candidate,storageRemote);
                if(!operations.length){persisted=remote;break;}
                assertActorAuthorizedForAppDataChange(remote,candidate,actorUserId);
                const actorGuard=actorStorageAuthorizationGuard(remote,storageRemote,actorUserId);
                if(!actorGuard)throw new CloudRebaseConflictError(['authorization-domain']);
                const strictAuthorizationGuard=appDataAuthorizationDomainChanged(remote,candidate)?authorizationDomainGuard(storageRemote):null;
                try{
                  const recovery=await runWithCloudSaveRecoveryLocks({
                    operations,
                    existingGuards:lockGuards,
                    createLeaseOwnerId:()=>uid('cloud-save-recovery-lease'),
                    stillCurrent:()=>isCurrent()&&configIoCoordinator.current.isCurrent(token,getSupabaseConfig())&&hasCurrentCloudIdentity(),
                    renew:request=>runCloudSaveQueueRpc('續期原子保存協作鎖',signal=>renewEditLock(request.sectionKey,request.leaseOwnerId,75,turnConfig,signal),8_000),
                    claim:request=>runCloudSaveQueueRpc('取得原子保存恢復鎖',signal=>claimEditLock(request.sectionKey,request.leaseOwnerId,savedBy,75,turnConfig,signal),8_000),
                    release:request=>runCloudSaveQueueRpc('釋放原子保存恢復鎖',signal=>releaseEditLock(request.sectionKey,request.leaseOwnerId,turnConfig,signal),8_000),
                    run:guards=>configIoCoordinator.current.run(token,getSupabaseConfig,config=>runCloudSaveQueueRpc(
                      '原子區塊保存',
                      signal=>applyCloudBlockPatchRpc(operations,savedBy,actorUserId,actorGuard,strictAuthorizationGuard,guards,config,signal),
                      12_000,
                    )),
                  });
                  persisted=recovery.value;
                  if(recovery.cleanupFailed)queueLeaseWarning='內容已保存，但部分短時恢復鎖將於租期屆滿後自動釋放';
                }catch(error){
                  if(!isCurrent())break;
                  if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
                  if(error instanceof CloudBlockPatchUnavailableError){
                    queueLeaseWarning='原子區塊 RPC 尚未部署，本次已使用舊版 revision CAS 相容保存';
                    await configIoCoordinator.current.run(token,getSupabaseConfig,config=>saveCloudData(candidate,remote!.revision,savedBy,config));
                    persisted=candidate;
                    break;
                  }
                  if(!(error instanceof CloudBlockPatchConflictError))throw error;
                  if(error.blockKey==='authorization-domain')throw new CloudRebaseConflictError(['authorization-domain']);
                  if(++rebaseAttempts>3)throw new CloudRebaseConflictError([`區塊 ${error.blockKey} 在短時間內連續變動`]);
                  remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);
                  if(!remote)throw new CloudRebaseConflictError(['雲端工作區不存在']);
                }
              }
              if(!persisted||!isCurrent())throw new StaleAsyncConfigError();
              if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
              rebaseAttempts=0;
              lastCloudRevision.current = persisted.revision;
              confirmCloudSnapshot(activeCloudIdentity.current,persisted);
              setStaleBrowserRecoveryOffered(false);
              rememberCloudIdentity();
              setCloudWriteBlocked(false);
              if(pending.renderRebase&&appDataContentEqual(liveData.current,next)){
                liveData.current=persisted;
                setData(persisted);
              }
              if(mergedRemoteChanges){
                setCloudStatus('已按項目安全合併其他人的修改並完成原子區塊保存');
                showSaveToast('info','已合併其他人的修改','雙方不同項目的內容均已保留，沒有上傳整份工作區覆蓋。');
              }
              lastSavedSnapshot=persisted;
              lastSavedRenderRebase=pending.renderRebase;
              lastSavedVisibleBaseline=pending.visibleBaseline;
              const visibleWriteConfirmed=pending.renderRebase
                ?appDataContentEqual(liveData.current,persisted)
                :Boolean(pending.visibleBaseline&&appDataContentEqual(liveData.current,pending.visibleBaseline));
              if(pendingCloudData.current.size()===0&&visibleWriteConfirmed)hasUnsavedWork.current=false;
              pendingEntry.resolve();
              pendingEntry=pendingCloudData.current.shift();
              }catch(error){pendingEntry.reject(error);throw error;}
            }
          }finally{
            await stopHeartbeat();
            if(heartbeatFailure){
              const detail=heartbeatFailure instanceof Error?heartbeatFailure.message:String(heartbeatFailure);
              queueLeaseWarning=`保存期間隊列續租曾中斷｜${detail}`;
            }
            if(saveTurnOwned){
              try{await runCloudSaveQueueRpc('釋放雲端保存權',signal=>releaseEditLock(CLOUD_SAVE_QUEUE_SECTION_KEY,saveTurnOwnerId,turnConfig,signal),8_000);}
              catch(error){
                const detail=error instanceof Error?error.message:String(error);
                queueLeaseWarning=`保存隊列釋放延遲，系統約 30 秒後會自動恢復｜${detail}`;
              }
            }
          }
          },
        });
        const confirmed=confirmedCloudData.current;
        const newerLocalChanges=hasUnconfirmedVisibleChanges({
          live:liveData.current,
          confirmed,
          lastSaved:lastSavedSnapshot,
          lastSavedWasRendered:lastSavedRenderRebase,
          visibleBaseline:lastSavedVisibleBaseline,
          equals:appDataContentEqual,
          liveRevision:liveData.current.revision,
          confirmedRevision:lastCloudRevision.current,
        });
        hasUnsavedWork.current=newerLocalChanges;
        if(newerLocalChanges){
          setSavePhase('dirty');
          setCloudStatus(lastSavedSnapshot?'雲端已確認前一筆保存，但頁面仍有較新的修改等待自動保存；請先不要關閉頁面':'頁面仍有修改尚未保存；請先不要關閉頁面');
          if(queueLeaseWarning)showSaveToast('warning','前一筆已保存，最新修改仍待保存',`${queueLeaseWarning}；請等待頁首顯示「已安全保存」再關閉頁面。`);
        }else if(queueLeaseWarning){
          setSavePhase('saved');
          setCloudStatus(`已安全保存到雲端；${queueLeaseWarning}`);
          showSaveToast('warning','內容已保存，隊列稍後自動恢復','目前頁面內容已由雲端確認；若其他人暫時等待，約 30 秒後會自動恢復。');
        }else{
          setSavePhase('saved');
          setCloudStatus(savedStatus(lastSavedSnapshot?'已安全保存到雲端':'雲端已是最新版本',lastSavedSnapshot?.updatedAt||confirmed?.updatedAt));
          if(lastSavedSnapshot)showSaveToast('success','已保存到雲端','雲端已確認這次修改，現在可以安全關閉或重新整理頁面。');
        }
      } catch (error) {
        pendingCloudData.current.rejectAll(error);
        if (error instanceof CloudConflictError||error instanceof CloudRebaseConflictError||error instanceof StaleAsyncConfigError) setCloudWriteBlocked(true);
        reportCloudSaveFailure(error);
        throw error;
      } finally {
        cloudSaveInFlight.current = null;
      }
    })();
    cloudSaveInFlight.current = task;
    void task.catch(()=>undefined);
    return completion.then(validateCompletion);
  };
  const flushCloudBeforeBatchRelease=async(operation:BatchManagedOperation)=>{
    if(!batchManagedOperationIsCurrent(operation))return false;
    if(!getSupabaseConfig())return true;
    if(cloudWriteBlocked||cloudSyncing||cloudSyncInFlight.current){setCloudStatus('批量更新尚未釋放：雲端目前不可保存');return false;}
    if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
    const snapshot=liveData.current;
    const confirmedSnapshot=confirmedCloudData.current;
    if(confirmedSnapshot&&appDataContentEqual(snapshot,confirmedSnapshot))return true;
    try{
      await enqueueCloudSave(snapshot,()=>batchManagedOperationIsCurrent(operation));
      if(!batchManagedOperationIsCurrent(operation))return false;
      return true;
    }catch(error:any){if(batchManagedOperationIsCurrent(operation))setCloudStatus(`批量更新尚未釋放：${error.message||error}`);return false;}
  };

  useEffect(() => {
    const cfg = getSupabaseConfig();
    setCloudInitializationAllowed(false);
    if (!cfg) {
      if(import.meta.env.DEV){setCloudInitializationAllowed(true);setCloudWriteBlocked(false);setCloudStatus('開發模式：尚未配置 Supabase，資料保存於本機瀏覽器');}
      else{setCloudInitializationAllowed(false);setCloudWriteBlocked(true);setCloudStatus('正式環境未載入 Supabase 設定，已禁止本機初始化');}
      setCloudBootstrapped(true);
      return;
    }
    if(!durableRevisionFloorRegistryIsValid()){
      setCloudWriteBlocked(true);
      setCloudStatus('durable revision floor registry損壞，已禁止載入、同步及保存；請先受控恢復本機歷程資料');
      setCloudBootstrapped(true);
      return;
    }
    const identity = cloudIdentity(cfg);
    const bootstrapToken=configIoCoordinator.current.begin(cfg);
    const cachedIdentity = cachedCloudIdentityFor(cfg);
    const trustedLocalIdentity=trustedMatchingCloudIdentity(cachedIdentity,identity);
    const hasLocalCache = localStorage.getItem(STORAGE_KEY) !== null;
    const identityChanged = Boolean(cachedIdentity && cachedIdentity !== identity);
    const unknownDirtyCache = !cachedIdentity && hasLocalCache;
    const persistedConfirmedBase=parseConfirmedCloudBase(localStorage.getItem(CLOUD_CONFIRMED_BASE_KEY),identity);
    confirmedCloudData.current=persistedConfirmedBase;
    if(persistedConfirmedBase){
      durableCloudRevisionFloors.current=updateDurableRevisionFloor(durableCloudRevisionFloors.current,identity,persistedConfirmedBase.revision);
      try{localStorage.setItem(CLOUD_REVISION_FLOORS_KEY,serializeDurableRevisionFloors(durableCloudRevisionFloors.current));}catch{/* legacy base still supplies this session floor */}
    }
    const persistedDurableFloor=durableCloudRevisionFloors.current.get(identity)??-1;
    let cancelled=false;
    setSavePhase('saving');
    setCloudStatus('正在載入雲端主資料...');
    configIoCoordinator.current.run(bootstrapToken,getSupabaseConfig,fetchCloudData).then(remote => {
      if(cancelled||!configIoCoordinator.current.isCurrent(bootstrapToken,getSupabaseConfig()))return;
      const latestConfig = getSupabaseConfig();
      if (!latestConfig || cloudIdentity(latestConfig) !== identity) {
        setCloudInitializationAllowed(false);
        setCloudWriteBlocked(true);
        setCloudStatus('雲端設定在載入期間變更，已禁止寫入；請重新載入或同步最新資料');
        setCloudBootstrapped(true);
        return;
      }
      if (remote) {
        lastCloudRevision.current=remote.revision||0;
        const localContentDiverged=hasLocalCache&&!appDataContentEqual(data,remote);
        const persistedRemoteRollback=remote.revision<persistedDurableFloor;
        const recoveredBase=!identityChanged&&!unknownDirtyCache?trustedPersistedBaseForRemote(persistedConfirmedBase,remote,appDataContentEqual):null;
        if (identityChanged || unknownDirtyCache || localContentDiverged || persistedRemoteRollback) {
          hasUnsavedWork.current=identityChanged||unknownDirtyCache||localContentDiverged||persistedRemoteRollback;
          setCloudInitializationAllowed(false);
          if(localContentDiverged&&trustedLocalIdentity)activeCloudIdentity.current=trustedLocalIdentity;
          confirmedCloudData.current=recoveredBase;
          setCloudWriteBlocked(true);
          setCloudStatus(identityChanged?'偵測到不同雲端工作區的本機快取，已禁止寫入；不會自動合併或覆蓋':unknownDirtyCache?'偵測到來源未綁定的本機快取與既有雲端資料，已禁止自動覆蓋；本機內容仍保留':persistedRemoteRollback?`雲端revision ${remote.revision}低於已確認的durable floor ${persistedDurableFloor}，疑似rollback；已拒絕採用並保留本機內容`:recoveredBase?`已恢復此工作區的可信共同基線；本機cache與雲端內容不同，請按「同步最新（安全合併）」完成恢復`:`本機cache與雲端內容不一致（本機 ${data.revision}、雲端 ${remote.revision}），缺少可信共同基線；兩邊內容均不會被覆蓋`);
        } else {
          hasUnsavedWork.current=false;
          setCloudInitializationAllowed(false);
          activeCloudIdentity.current=identity;
          confirmCloudSnapshot(identity,remote);
          setData(remote);
          setCloudWriteBlocked(false);
          rememberCloudIdentity();
          setSavePhase('saved');
          setCloudStatus(savedStatus('已載入雲端主資料',remote.updatedAt));
        }
      }
      else {
        lastCloudRevision.current=-1;
        const persistedRemoteMissing=persistedDurableFloor>=0;
        confirmedCloudData.current=persistedConfirmedBase;
        if (identityChanged || unknownDirtyCache || persistedRemoteMissing) {
          hasUnsavedWork.current=identityChanged||unknownDirtyCache;
          setCloudInitializationAllowed(false);
          setCloudWriteBlocked(true);
          setCloudStatus(persistedRemoteMissing?`雲端主資料遺失，但此工作區已有durable revision ${persistedDurableFloor}；已禁止自動保存、同步及重新初始化`: '目標工作區尚無資料，但本機快取來源未受信任；為避免跨工作區複製，禁止同步或初始化。請先匯出核對，再透過受控匯入處理');
        } else {
          hasUnsavedWork.current=false;
          setCloudInitializationAllowed(false);
          setCloudWriteBlocked(true);
          setCloudStatus('雲端工作區沒有主資料，已禁止從瀏覽器初始化；請由受控備份或管理流程恢復');
        }
      }
      setCloudBootstrapped(true);
    }).catch(e => { if(!cancelled){
      hasUnsavedWork.current=bootstrapFailureHasUnsavedWork({local:data,persistedConfirmedBase,hasLocalCache,equals:appDataContentEqual});
      setCloudInitializationAllowed(false);setCloudWriteBlocked(true);setSavePhase('error');setCloudStatus(`雲端載入失敗，已禁止寫入：${e.message || e}`);setCloudBootstrapped(true);
    } });
    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const directAttentionSave=vesselAttentionDirectSaveSnapshots.current.has(data);
    const config=getSupabaseConfig();
    if(!cloudBootstrapped||!currentUser||!config)return;
    const confirmed=confirmedCloudData.current;
    const hasUnconfirmedContent=confirmed?!appDataContentEqual(data,confirmed):data.revision>lastCloudRevision.current;
    if(!hasUnconfirmedContent)return;
    hasUnsavedWork.current=true;
    clearStaleSaveSuccessToast();
    if(directAttentionSave)return;
    if(cloudWriteBlocked||cloudSyncing||cloudSyncInFlight.current){
      setSavePhase(cloudWriteBlocked?'error':'dirty');
      return;
    }
    if(data.revision<=lastCloudRevision.current)return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSavePhase('dirty');
    setCloudStatus('有修改尚未保存；系統即將自動保存，請先不要關閉頁面');
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current=null;
      enqueueCloudSave(data).catch(()=>{/* enqueueCloudSave 已顯示持續狀態與醒目提醒 */});
    }, 900);
    return () => { if (saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;} };
  }, [data, currentUser, cloudBootstrapped, cloudWriteBlocked, cloudSyncing]);
  useEffect(()=>{
    const shouldWarnBeforeLeaving=()=>shouldBlockAppBeforeUnload({
      recoveryNavigation:browserRecoveryNavigationRef.current,
      hasUnsavedWork:hasUnsavedWork.current||Boolean(vesselAttentionSaveQueue.current?.hasPending())||Boolean(vesselLeaseIncidentRef.current)||Boolean(activeEditLockRef.current?.sectionKey.startsWith('vessel:')),
      savePhaseSaved:savePhaseRef.current==='saved',
      saveTimerPending:Boolean(saveTimer.current),
      pendingCloudDataCount:pendingCloudData.current.size(),
      pendingTaskCreationCount:pendingTaskCreationsRef.current.length,
    });
    const handleBeforeUnload=(event:BeforeUnloadEvent)=>{
      if(!shouldWarnBeforeLeaving())return;
      event.preventDefault();
      event.returnValue='';
    };
    window.addEventListener('beforeunload',handleBeforeUnload);
    return()=>window.removeEventListener('beforeunload',handleBeforeUnload);
  },[]);
  useEffect(()=>{
    let cancelled=false;
    let checking=false;
    const checkVersion=async()=>{
      if(checking)return;
      checking=true;
      try{
        const result=await checkForAppVersion({currentVersion:__SHIP_DYNAMICS_BUILD_VERSION__,baseUrl:import.meta.env.BASE_URL,nonce:Date.now()});
        if(!cancelled&&result.status==='available')setAvailableAppVersion(result.version);
      }finally{checking=false;}
    };
    const handleFocus=()=>{void checkVersion();};
    const handleVisibilityChange=()=>{if(document.visibilityState==='visible')void checkVersion();};
    void checkVersion();
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void checkVersion();},APP_VERSION_CHECK_INTERVAL_MS);
    window.addEventListener('focus',handleFocus);
    document.addEventListener('visibilitychange',handleVisibilityChange);
    return()=>{
      cancelled=true;
      window.clearInterval(interval);
      window.removeEventListener('focus',handleFocus);
      document.removeEventListener('visibilitychange',handleVisibilityChange);
    };
  },[]);
  useEffect(()=>{
    if(cloudBootstrapped&&cloudWriteBlocked&&!cloudSyncing&&!cloudSyncInFlight.current)setSavePhase('error');
  },[cloudBootstrapped,cloudWriteBlocked,cloudSyncing]);

  const creationHandoffMatches=(lock:ActiveEditLock|null|undefined)=>Boolean(lock&&isTaskCreationLockKey(lock.sectionKey)&&creationHandoffInFlight.current?.leaseOwnerId===lock.leaseOwnerId);
  const clearCreationAttempt=(taskId:string|undefined,leaseOwnerId:string|undefined)=>{
    if(!taskId||!leaseOwnerId)return;
    if(creationAttempts.current.get(taskId)?.leaseOwnerId===leaseOwnerId)creationAttempts.current.delete(taskId);
    if(latestCreationDrafts.current.get(taskId)?.leaseOwnerId===leaseOwnerId)latestCreationDrafts.current.delete(taskId);
  };
  const quarantineCreationDraftForLock=(lock:ActiveEditLock)=>{
    if(!isTaskCreationLockKey(lock.sectionKey))return false;
    if(confirmedCreationLeases.current.has(lock.leaseOwnerId))return false;
    const latest=[...latestCreationDrafts.current.values()].find(record=>record.leaseOwnerId===lock.leaseOwnerId);
    const attempt=[...creationAttempts.current.values()].find(record=>record.leaseOwnerId===lock.leaseOwnerId);
    const retained=selectCreationDraftForQuarantine({ownerUserId:lock.ownerUserId,leaseOwnerId:lock.leaseOwnerId,currentTask:creatingTask,latest,attempt});
    if(!retained)return false;
    setQuarantinedCreationDrafts(current=>({...current,[retained.ownerUserId]:{...retained,task:clone(retained.task)}}));
    return true;
  };
  const ensureCloudDurableBeforeLeaseRelease=async(sectionKey:string)=>{
    if(!getSupabaseConfig())return true;
    try{
      if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
      const confirmed=confirmedCloudData.current;
      if(!confirmed||!appDataContentEqual(liveData.current,confirmed))await enqueueCloudSave(liveData.current);
      const durable=confirmedCloudData.current;
      if(!durable||!appDataContentEqual(liveData.current,durable))throw new Error('雲端尚未確認最新修改');
      return true;
    }catch(error:any){
      setSensitiveCloudStatus(`最新修改尚未雲端確認，協作鎖保持不釋放：${error.message||error}`,sectionKey);
      alert('最新修改尚未在雲端確認；協作鎖仍保留，請先處理保存狀態。');
      return false;
    }
  };
  const releaseCurrentEditLock=async () => {
    const lock=activeEditLockRef.current;
    if(!lock)return true;
    const pendingHandoff=creationHandoffInFlight.current;
    await waitForDurableCreationHandoff(pendingHandoff,lock.leaseOwnerId);
    if(lockCoordinator.current.isCurrent(lock.generation))lockCoordinator.current.invalidate();
    if(lock.status==='blocked'){
      leaseCloudConfigs.current.delete(lock.leaseOwnerId);
      activeEditLockRef.current=null;
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      return true;
    }
    const leaseRecord=leaseCloudConfigs.current.get(lock.leaseOwnerId);
    if(!leaseRecord){
      activeEditLockRef.current=null;
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      return true;
    }
    try{
      await lockCoordinator.current.run(()=>runCloudSaveQueueRpc('釋放多人協作鎖',signal=>releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config,signal),8_000));
      leaseCloudConfigs.current.delete(lock.leaseOwnerId);
      activeEditLockRef.current=null;
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      setCloudStatus('多人協作鎖已釋放');
      return true;
    }catch(error:any){
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?(previous.status==='error'?previous:{...previous,status:'error'}):previous);
      setCloudStatus(`協作鎖釋放失敗：${error.message||error}`);
      return false;
    }
  };
  const closeEditorForLock=(lock:ActiveEditLock,preserveCreation=false)=>{
    if(lock.sectionKey.startsWith('task:')||isTaskCreationLockKey(lock.sectionKey)){
      if(isTaskCreationLockKey(lock.sectionKey)){
        if(preserveCreation)quarantineCreationDraftForLock(lock);
        else clearCreationAttempt(creatingTask?.id,lock.leaseOwnerId);
      }
      setEditingTaskId('');setTaskEditorRequestGeneration(0);setTaskEditorAuthorizationEpoch('');setTaskProgressVesselId('');setCreatingTask(null);taskOpenRequests.current.invalidate();
    }
    if(lock.sectionKey.startsWith('vessel:')){vesselSaveLeaseOwners.current.delete(lock.leaseOwnerId);clearVesselLeaseIncident(lock.sectionKey,lock.leaseOwnerId);setEditingVesselId('');if(batchManagedRequested.current)invalidateBatchManagedLocks('船舶協作鎖狀態已變更；已關閉批量更新');}
  };
  const freezeVesselEditorForLock=(lock:ActiveEditLock,message:string,lockedByName?:string)=>{
    if(!lock.sectionKey.startsWith('vessel:'))return false;
    if(lockCoordinator.current.isCurrent(lock.generation))lockCoordinator.current.invalidate();
    setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:lockedByName?'blocked':'error',lockedByName,validatedUntilMs:0}:previous);
    publishVesselLeaseIncident(lock,'frozen',message);
    setSensitiveCloudStatus(message,lock.sectionKey);
    return true;
  };
  const resolveEditLockNotice=()=>{
    const lock=activeEditLock;
    if(!lock)return;
    const vesselIncident=vesselLeaseIncidentRef.current;
    if(lock.sectionKey.startsWith('vessel:')&&vesselIncident?.mode==='frozen'&&vesselIncident.sectionKey===lock.sectionKey&&vesselIncident.leaseOwnerId===lock.leaseOwnerId){void closeVesselEditorRef.current(lock);return;}
    if(lock.status==='blocked'){leaseCloudConfigs.current.delete(lock.leaseOwnerId);setActiveEditLock(null);return;}
    if(isTaskCreationLockKey(lock.sectionKey)&&liveCreatingTaskId.current&&!confirm('新增要事草稿目前以唯讀保留。關閉後請重新取得協作鎖再建立，確定關閉草稿？'))return;
    closeEditorForLock(lock);
    void releaseCurrentEditLock();
  };

  useEffect(()=>{
    const lock=activeEditLock;
    const checkConfig=()=>{
      const configIdentity=cloudConfigIdentity(getSupabaseConfig());
      if(configIdentity!==observedCloudConfig.current){observedCloudConfig.current=configIdentity;configIoCoordinator.current.invalidate();}
      const pending=pendingClaimConfig.current;
      if(pending&&!pending.invalidated&&!sameCloudConfig(getSupabaseConfig(),pending.config)){
        pending.invalidated=true;
        lockCoordinator.current.invalidate();
        setCloudStatus('雲端設定已變更：已取消尚未完成的舊工作區協作鎖檢查');
      }
      if(lock&&lock.status==='blocked'&&(lock.sectionKey.startsWith('task:')||isTaskCreationLockKey(lock.sectionKey))){
        if(sameCloudConfig(getSupabaseConfig(),blockedTaskCloudConfig.current))return;
        taskOpenRequests.current.invalidate();
        blockedTaskCloudConfig.current=null;
        closeEditorForLock(lock);
        setTaskReadOnlyData(null);
        setTaskReadOnlyReason('');
        setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
        setSensitiveCloudStatus('雲端設定已變更：已關閉舊工作區的只讀事項',lock.sectionKey);
        return;
      }
      if(!lock||lock.status!=='owned')return;
      const record=leaseCloudConfigs.current.get(lock.leaseOwnerId);
      if(!getSupabaseConfig()&&!record)return;
      if(record&&sameCloudConfig(getSupabaseConfig(),record.config))return;
      if(creationHandoffMatches(lock)){setSensitiveCloudStatus('雲端設定已變更：正在完成目前新增要事的耐久保存，暫不釋放協作鎖',lock.sectionKey);return;}
      if(lock.sectionKey.startsWith('vessel:')){
        freezeVesselEditorForLock(lock,`雲端設定已變更：已凍結並保留 ${lock.label}；目前內容只保留在這個視窗，不能保存。`);
        return;
      }
      lockCoordinator.current.invalidate();
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
      setSensitiveCloudStatus(`雲端設定已變更：已凍結並保留 ${lock.label}；請恢復原設定後保存或重新載入，未確認內容不會被清除`,lock.sectionKey);
    };
    const onStorage=(event:StorageEvent)=>{if(event.key==='ship-dynamics-supabase-config'){configIoCoordinator.current.invalidate();observedCloudConfig.current=cloudConfigIdentity(getSupabaseConfig());}checkConfig();};
    window.addEventListener('storage',onStorage);
    const timer=window.setInterval(checkConfig,1000);
    checkConfig();
    return()=>{window.removeEventListener('storage',onStorage);window.clearInterval(timer);};
  },[activeEditLock?.sectionKey,activeEditLock?.status,activeEditLock?.leaseOwnerId,activeEditLock?.generation,creationHandoffVersion]);

  useEffect(()=>{
    const lock=activeEditLock;
    if(!lock||lock.status!=='owned')return;
    if(lock.authorizationEpoch!==authorizationEpoch||lock.ownerUserId!==currentUser?.id)return;
    let retryTimer:number|undefined;
    let renewalInFlight=false;
    const clearRetryTimer=()=>{if(retryTimer!==undefined){window.clearTimeout(retryTimer);retryTimer=undefined;}};
    const renewSingleItemLease=()=>{
      if(renewalInFlight)return;
      renewalInFlight=true;
      void lockCoordinator.current.run(async()=>{
        if(!lockCoordinator.current.isCurrent(lock.generation)||liveAuthorizationEpoch.current!==lock.authorizationEpoch||!liveAuthorizedEditLockKeys.current.has(lock.sectionKey))return;
        try{
          const leaseRecord=leaseCloudConfigs.current.get(lock.leaseOwnerId);
          if(!getSupabaseConfig()&&!leaseRecord)return;
          if(!leaseRecord)throw new Error('協作鎖的原始雲端設定已遺失');
          if(!sameCloudConfig(getSupabaseConfig(),leaseRecord.config)){
            if(creationHandoffMatches(lock))setSensitiveCloudStatus('雲端設定已變更：新增要事仍在耐久保存，暫以原工作區設定續期協作鎖',lock.sectionKey);
            else if(lock.sectionKey.startsWith('vessel:')){
              clearRetryTimer();
              freezeVesselEditorForLock(lock,`雲端設定已變更：已凍結並保留 ${lock.label}；目前內容只保留在這個視窗，不能保存。`);
              return;
            }
            else{
              lockCoordinator.current.invalidate();
              closeEditorForLock(lock,true);
              setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
              setSensitiveCloudStatus(`雲端設定已變更：已關閉 ${lock.label} 並停止舊工作區續期`,lock.sectionKey);
              void releaseCurrentEditLock();
              return;
            }
          }
          const renewed=await runCloudSaveQueueRpc('單項協作鎖續期',signal=>renewEditLock(lock.sectionKey,lock.leaseOwnerId,75,leaseRecord.config,signal),8_000);
          const renewalStillCurrent=()=>lockCoordinator.current.isCurrent(lock.generation)&&liveAuthorizationEpoch.current===lock.authorizationEpoch&&liveAuthorizedEditLockKeys.current.has(lock.sectionKey);
          const matchingCreationHandoff=creationHandoffInFlight.current?.leaseOwnerId===lock.leaseOwnerId?creationHandoffInFlight.current:null;
          const renewalAfterAwaitDisposition=classifyLeaseRenewalAfterAwait({
            sectionKey:lock.sectionKey,
            renewalTargetIsCurrent:renewalStillCurrent(),
            cloudConfigStillCurrent:sameCloudConfig(getSupabaseConfig(),leaseRecord.config),
            durableCreationHandoff:Boolean(matchingCreationHandoff),
          });
          if(renewalAfterAwaitDisposition==='freeze-vessel-draft'){
            clearRetryTimer();
            freezeVesselEditorForLock(lock,`雲端設定在協作鎖續期期間發生變更：已凍結並保留 ${lock.label}；目前內容只保留在這個視窗，不能保存。`);
            return;
          }
          if(renewalAfterAwaitDisposition==='close-editor'){
            lockCoordinator.current.invalidate();
            closeEditorForLock(lock,true);
            setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
            setSensitiveCloudStatus(`雲端設定已變更：已關閉 ${lock.label} 並停止舊工作區續期`,lock.sectionKey);
            void releaseCurrentEditLock();
            return;
          }
          if(matchingCreationHandoff&&(!renewed.ok||!renewalStillCurrent())){
            setSensitiveCloudStatus(renewed.ok?'新增要事耐久保存仍在執行；舊續期結果暫不釋放協作鎖':'新增要事耐久保存仍在執行；續期失效處置將等待雲端保存結果',lock.sectionKey);
            await waitForDurableCreationHandoff(matchingCreationHandoff,lock.leaseOwnerId);
          }
          if(!renewalStillCurrent()){
            if(isTaskCreationLockKey(lock.sectionKey))quarantineCreationDraftForLock(lock);
            if(renewed.ok){
              const renewalCleanupDisposition=classifyExpiredLeaseRelease(lock.sectionKey,vesselSaveLeaseOwners.current.has(lock.leaseOwnerId));
              if(renewalCleanupDisposition==='defer-for-durability'){
                setSensitiveCloudStatus('船舶快速更新保存仍在確認；延遲續租結果將等待雲端保存完成後再釋放協作鎖',lock.sectionKey);
                return;
              }
              await runCloudSaveQueueRpc('清理失效單項協作鎖',signal=>releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config,signal),8_000);
              leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            }
            else leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            return;
          }
          if(!renewed.ok){
            const lockedByName=renewed.lockedByName||'其他使用者';
            leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            if(isTaskCreationLockKey(lock.sectionKey)&&liveCreatingTaskId.current){
              setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error',lockedByName,validatedUntilMs:0}:previous);
              setTaskReadOnlyReason(`新增要事協作鎖已失效（目前持有人：${lockedByName}）；草稿已唯讀保留，請複製內容後取消並重新開啟`);
              setSensitiveCloudStatus(`新增要事協作鎖已失效：草稿已唯讀保留，未在雲端確認前不會再次提交`,lock.sectionKey);
              return;
            }
            if(lock.sectionKey.startsWith('vessel:')){
              clearRetryTimer();
              freezeVesselEditorForLock(lock,`協作鎖已失效：${lock.label} 已由 ${lockedByName} 編輯；目前內容已唯讀保留，不能保存。`,lockedByName);
              return;
            }
            setActiveEditLock({...lock,status:'blocked',lockedByName});
            setSensitiveCloudStatus(`協作鎖已失效：${lock.label} 已由 ${lockedByName} 編輯，正在讀取最新只讀資料`,lock.sectionKey);
            if(lock.sectionKey.startsWith('task:')){
              const taskId=lock.sectionKey.slice('task:'.length);
              const requestGeneration=taskOpenRequests.current.begin(taskOpenRequests.current.peek()||{vesselId:'',batchManaged:false});
              setCreatingTask(null);
              void openTaskReadOnly(taskId,`${lockedByName} 已接手編輯此事項`,requestGeneration,taskProgressVesselId,leaseRecord.config).then(result=>{if(result==='failed'&&taskOpenRequests.current.isCurrent(requestGeneration))closeTaskEditor(requestGeneration);});
            }else closeEditorForLock(lock);
          }else{
            clearRetryTimer();
            clearVesselLeaseIncident(lock.sectionKey,lock.leaseOwnerId);
            const latestLock=activeEditLockRef.current;
            if(latestLock?.leaseOwnerId===lock.leaseOwnerId&&latestLock.status==='owned'){
              const renewedLock={...latestLock,validatedUntilMs:conservativeLeaseDeadline(renewed.expiresAt)};
              activeEditLockRef.current=renewedLock;
              setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId&&previous.status==='owned'?renewedLock:previous);
            }
          }
        }catch(error:any){
          if(!lockCoordinator.current.isCurrent(lock.generation))return;
          if(lock.sectionKey.startsWith('vessel:')){
            const message=`協作鎖續期暫時失敗：${error.message||error}`;
            if(classifyVesselLeaseRenewalFailure(lock.validatedUntilMs)==='retrying'){
              publishVesselLeaseIncident(lock,'retrying',`${message}；正在重試，目前內容仍保留，確認成功前不能保存。`);
              setSensitiveCloudStatus(`${message}；正在重試`,lock.sectionKey);
              clearRetryTimer();
              retryTimer=window.setTimeout(renewSingleItemLease,5_000);
              return;
            }
            freezeVesselEditorForLock(lock,`${message}；最後確認的有效期已到，目前內容已唯讀保留，不能保存。`);
            return;
          }
          setActiveEditLock({...lock,status:'error'});
          setSensitiveCloudStatus(`協作鎖續期失敗：${error.message||error}`,lock.sectionKey);
        }
      }).finally(()=>{renewalInFlight=false;});
    };
    const renewVesselLeaseOnResume=()=>{if(lock.sectionKey.startsWith('vessel:')&&document.visibilityState!=='hidden')renewSingleItemLease();};
    const timer=window.setInterval(renewSingleItemLease,30000);
    if(lock.sectionKey.startsWith('vessel:')){
      window.addEventListener('focus',renewVesselLeaseOnResume);
      window.addEventListener('online',renewVesselLeaseOnResume);
      document.addEventListener('visibilitychange',renewVesselLeaseOnResume);
    }
    return()=>{
      window.clearInterval(timer);
      clearRetryTimer();
      window.removeEventListener('focus',renewVesselLeaseOnResume);
      window.removeEventListener('online',renewVesselLeaseOnResume);
      document.removeEventListener('visibilitychange',renewVesselLeaseOnResume);
    };
  },[activeEditLock?.sectionKey,activeEditLock?.status,activeEditLock?.authorizationEpoch,activeEditLock?.ownerUserId,activeEditLock?.leaseOwnerId,activeEditLock?.generation,activeEditLock?.validatedUntilMs,authorizationEpoch,currentUser?.id,creationHandoffVersion]);

  useEffect(()=>{
    const lock=activeEditLock;
    if(!lock||lock.status!=='owned'||!lock.validatedUntilMs)return;
    if(lock.authorizationEpoch!==authorizationEpoch||lock.ownerUserId!==currentUser?.id)return;
    const leaseRecord=leaseCloudConfigs.current.get(lock.leaseOwnerId);
    return scheduleValidatedLeaseExpiry(lock.validatedUntilMs,()=>{
      const latestLock=activeEditLockRef.current;
      if(latestLock?.leaseOwnerId===lock.leaseOwnerId&&latestLock.validatedUntilMs>lock.validatedUntilMs)return;
      if(creationHandoffMatches(lock)){setSensitiveCloudStatus('協作鎖有效期已到：正在等待新增要事耐久保存完成，暫不交出協作鎖',lock.sectionKey);return;}
      const expiredReleaseDisposition=classifyExpiredLeaseRelease(lock.sectionKey,vesselSaveLeaseOwners.current.has(lock.leaseOwnerId));
      const leaseIsCurrent=()=>lockCoordinator.current.isCurrent(lock.generation)
        &&liveAuthorizationEpoch.current===lock.authorizationEpoch
        &&liveCurrentUserId.current===lock.ownerUserId;
      if(!leaseIsCurrent())return;
      if(lock.sectionKey.startsWith('task:')){
        const taskId=lock.sectionKey.slice('task:'.length);
        const returnDestination=taskOpenRequests.current.peek()||{vesselId:'',batchManaged:false};
        const requestedVesselId=taskProgressVesselId;
        void transitionExpiredTaskLease({
          leaseIsCurrent,
          invalidateLease:()=>{
            lockCoordinator.current.invalidate();
            setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
          },
          closeWritableAndBeginReadOnly:()=>{
            taskOpenRequests.current.invalidate();
            const requestGeneration=taskOpenRequests.current.begin(returnDestination);
            setEditingTaskId('');
            setTaskEditorRequestGeneration(0);
            setTaskEditorAuthorizationEpoch('');
            setTaskProgressVesselId('');
            setTaskReadOnlyData(null);
            setTaskReadOnlyReason('');
            setCreatingTask(null);
            setSensitiveCloudStatus(`協作鎖有效期已到：${lock.label} 已停止編輯，正在讀取最新只讀資料`,lock.sectionKey);
            return requestGeneration;
          },
          openLatestReadOnly:requestGeneration=>{
            if(leaseRecord)return openTaskReadOnly(taskId,'協作鎖有效期已到',requestGeneration,requestedVesselId,leaseRecord.config);
            setSensitiveCloudStatus('協作鎖有效期已到且原始雲端設定遺失；已關閉編輯器',lock.sectionKey);
            return Promise.resolve('failed');
          },
          requestIsCurrent:requestGeneration=>taskOpenRequests.current.isCurrent(requestGeneration),
          closeAfterFailure:requestGeneration=>closeTaskEditor(requestGeneration),
        });
      }else if(lock.sectionKey.startsWith('vessel:')){
        freezeVesselEditorForLock(lock,`協作鎖有效期已到：${lock.label} 已停止編輯；目前內容已唯讀保留，不能保存。`);
      }else{
        lockCoordinator.current.invalidate();
        setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
        closeEditorForLock(lock,true);
        setSensitiveCloudStatus(`協作鎖有效期已到：${lock.label} 已停止編輯`,lock.sectionKey);
      }
      if(expiredReleaseDisposition==='release'&&leaseRecord){
        void runCloudSaveQueueRpc('清理已失效協作鎖',signal=>releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config,signal),8_000)
          .catch(error=>setSensitiveCloudStatus(`協作鎖已失效，伺服器清理失敗：${error.message||error}`,lock.sectionKey))
          .finally(()=>{
            leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
          });
      }
    });
  },[activeEditLock?.sectionKey,activeEditLock?.status,activeEditLock?.authorizationEpoch,activeEditLock?.ownerUserId,activeEditLock?.leaseOwnerId,activeEditLock?.generation,activeEditLock?.validatedUntilMs,authorizationEpoch,currentUser?.id,taskProgressVesselId,creationHandoffVersion]);

  useEffect(()=>{
    if(!batchManagedOpen)return;
    const session=batchManagedSession.current;
    const sessionIsCurrent=()=>batchManagedRequested.current&&batchManagedOpenRef.current&&batchManagedSession.current===session;
    const fail=(message:string)=>{if(sessionIsCurrent())invalidateBatchManagedLocks(message);};
    const checkConfig=()=>{
      const authorization=batchManagedAuthorization.current;
      if(!authorization||authorization.session!==session||authorization.cloudIdentity!==cloudConfigIdentity(getSupabaseConfig())){
        fail('雲端設定已變更；已關閉批量更新並停止全部舊工作區鎖續期');
        return;
      }
      if(batchLocalMode.current)return;
      const snapshot=batchEditLocksRef.current;
      if(!snapshot.length){fail('無法確認全部經管船舶的協作鎖；已關閉批量更新');return;}
      const valid=snapshot.every(lock=>{
        const record=batchLeaseReleaseState.current.records.get(lock.leaseOwnerId);
        return Boolean(record&&sameCloudConfig(getSupabaseConfig(),record.config));
      });
      if(!valid)fail('雲端設定已變更；已關閉批量更新並停止全部舊工作區鎖續期');
    };
    const renew=async()=>{
      const snapshot=batchEditLocksRef.current;
      if(!snapshot.length||!sessionIsCurrent())return;
      try{
        const renewed=await batchLockCoordinator.current.run(async()=>{
          const outcomes=await Promise.allSettled(snapshot.map(async lock=>{
            if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(lock.generation)||liveAuthorizationEpoch.current!==lock.authorizationEpoch)throw new Error('批量編輯身份或權限已變更');
            const record=batchLeaseReleaseState.current.records.get(lock.leaseOwnerId);
            if(!record||!sameCloudConfig(getSupabaseConfig(),record.config))throw new Error('批量協作鎖的雲端設定已變更');
            const result=await runCloudSaveQueueRpc('批量船舶鎖續期',signal=>renewEditLock(lock.sectionKey,lock.leaseOwnerId,75,record.config,signal));
            if(!result.ok)throw new Error(`${lock.label} 的協作鎖已由 ${result.lockedByName||'其他使用者'} 取得`);
            return{...lock,validatedUntilMs:conservativeLeaseDeadline(result.expiresAt)};
          }));
          const rejected=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
          if(rejected)throw rejected.reason;
          return outcomes.map(outcome=>(outcome as PromiseFulfilledResult<ActiveEditLock>).value);
        });
        if(!sessionIsCurrent())return;
        batchEditLocksRef.current=renewed;
        setBatchEditLocks(renewed);
      }catch(error:any){fail(`批量船舶協作鎖續期失敗：${error.message||error}；已關閉全部批量編輯`);}
    };
    window.addEventListener('storage',checkConfig);
    const configTimer=window.setInterval(checkConfig,1000);
    const renewTimer=!batchLocalMode.current&&batchEditLocks.length?window.setInterval(()=>{void renew();},30000):undefined;
    checkConfig();
    return()=>{window.removeEventListener('storage',checkConfig);window.clearInterval(configTimer);if(renewTimer!==undefined)window.clearInterval(renewTimer);};
  },[batchManagedOpen,batchEditLocks.map(lock=>lock.leaseOwnerId).join('|'),authorizationEpoch,currentUser?.id]);

  useEffect(() => {
    const previousAuthorizationEpochValue=previousAuthorizationEpoch.current;
    previousAuthorizationEpoch.current=authorizationEpoch;
    const authorizationChanged=Boolean(previousAuthorizationEpochValue&&previousAuthorizationEpochValue!==authorizationEpoch);
    const staleLock=Boolean(activeEditLock&&(activeEditLock.authorizationEpoch!==authorizationEpoch||activeEditLock.ownerUserId!==currentUser?.id));
    if((authorizationChanged||staleLock)&&activeEditLock&&creationHandoffMatches(activeEditLock)){
      setSensitiveCloudStatus('身份或權限已變更：正在完成目前新增要事的耐久保存，暫不釋放協作鎖',activeEditLock.sectionKey);
      return;
    }
    if((authorizationChanged||staleLock)&&activeEditLock&&isTaskCreationLockKey(activeEditLock.sectionKey))quarantineCreationDraftForLock(activeEditLock);
    if(authorizationChanged){
      taskOpenRequests.current.invalidate();
      setSelectedVesselDetailId('');
      setEditingVesselId('');
      setEditingTaskId('');
      setTaskEditorRequestGeneration(0);
      setTaskEditorAuthorizationEpoch('');
      setTaskProgressVesselId('');
      setTaskReadOnlyData(null);
      setTaskReadOnlyReason('');
      setCreatingTask(null);
      invalidateBatchManagedLocks('身份或權限已變更；已關閉批量更新並釋放全部船舶鎖');
      setAgendaSelection([]);
      setBatchSelectedVesselIds([]);
      setReportPreviewOpen(false);
      setPasswordModalOpen(false);
      setPrintTitle('');
      setCloudStatus(getSupabaseConfig()?'身份、權限或船舶範圍已變更，請同步最新資料':'本機模式');
    }
    if(authorizationChanged||staleLock){clearVesselLeaseIncident();releaseCurrentEditLock();}
  }, [authorizationEpoch,activeEditLock?.authorizationEpoch,activeEditLock?.ownerUserId,currentUser?.id,creationHandoffVersion]);

  const claimEditingLock=async(sectionKey:string,label:string,stillWanted?:()=>boolean,announceBlocked=true,liveAuthorized?:()=>boolean):Promise<EditLockClaimResult>=>{
    if(!currentUser)return 'unavailable';
    const previousLock=activeEditLockRef.current;
    if(previousLock?.status==='owned'&&!await ensureCloudDurableBeforeLeaseRelease(previousLock.sectionKey))return 'unavailable';
    if(previousLock&&!(await releaseCurrentEditLock()))return 'unavailable';
    if(stillWanted&&!stillWanted())return 'unavailable';
    const ownerUserId=currentUser.id;
    const ownerUserName=currentUser.name;
    const leaseOwnerId=`${ownerUserId}:${crypto.randomUUID()}`;
    const claimAuthorizationEpoch=authorizationEpoch;
    const generation=lockCoordinator.current.beginGeneration();
    const lockState={sectionKey,label,ownerUserId,ownerUserName,leaseOwnerId,generation,authorizationEpoch:claimAuthorizationEpoch,validatedUntilMs:0};
    const authorizedNow=()=>liveAuthorized?liveAuthorized():liveAuthorizedEditLockKeys.current.has(sectionKey);
    const leaseConfig=getSupabaseConfig();
    if(!leaseConfig){
      if(!authorizedNow())return 'unavailable';
      const ownedLock:ActiveEditLock={...lockState,status:'owned'};
      activeEditLockRef.current=ownedLock;
      setActiveEditLock(ownedLock);
      clearVesselLeaseIncident(sectionKey);
      setSensitiveCloudStatus(`本機編輯：${label}`,sectionKey);
      return 'owned';
    }
    pendingClaimConfig.current={generation,config:leaseConfig,invalidated:false};
    setSensitiveCloudStatus(`正在檢查多人協作鎖：${label}`,sectionKey);
    try{return await lockCoordinator.current.run(async()=>{
      try{
        for(const [pendingOwner,pending] of leaseCloudConfigs.current){
          await runCloudSaveQueueRpc('清理舊協作鎖',signal=>releaseEditLock(pending.sectionKey,pendingOwner,pending.config,signal),8_000);
          leaseCloudConfigs.current.delete(pendingOwner);
        }
      }catch(error:any){
        setCloudStatus(`舊協作鎖仍無法釋放，已停止開啟新的編輯：${error.message||error}`);
        return 'unavailable';
      }
      if(!sameCloudConfig(getSupabaseConfig(),leaseConfig)){if(lockCoordinator.current.isCurrent(generation))lockCoordinator.current.invalidate();return 'unavailable';}
      if((stillWanted&&!stillWanted())||!lockCoordinator.current.isCurrent(generation)||liveAuthorizationEpoch.current!==claimAuthorizationEpoch||!authorizedNow())return 'unavailable';
      leaseCloudConfigs.current.set(leaseOwnerId,{sectionKey,config:leaseConfig});
      try{
        const lock=await runCloudSaveQueueRpc('取得多人協作鎖',signal=>claimEditLock(sectionKey,leaseOwnerId,ownerUserName,75,leaseConfig,signal),8_000);
        const configStillCurrent=sameCloudConfig(getSupabaseConfig(),leaseConfig);
        if(!configStillCurrent&&lockCoordinator.current.isCurrent(generation))lockCoordinator.current.invalidate();
        if(!configStillCurrent||(stillWanted&&!stillWanted())||!lockCoordinator.current.isCurrent(generation)||liveAuthorizationEpoch.current!==claimAuthorizationEpoch||!authorizedNow()){
          if(lock.ok){await runCloudSaveQueueRpc('清理失效多人協作鎖',signal=>releaseEditLock(sectionKey,leaseOwnerId,leaseConfig,signal),8_000);leaseCloudConfigs.current.delete(leaseOwnerId);}
          else leaseCloudConfigs.current.delete(leaseOwnerId);
          return 'unavailable';
        }
        if(!lock.ok){
          leaseCloudConfigs.current.delete(leaseOwnerId);
          const lockedByName=lock.lockedByName||'其他使用者';
          setActiveEditLock({...lockState,status:'blocked',lockedByName});
          setSensitiveCloudStatus(`此項目正在由 ${lockedByName} 編輯，已阻止打開以避免覆蓋對方內容`,sectionKey);
          if(announceBlocked)alert(`此項目正在由 ${lockedByName} 編輯；為避免覆蓋對方內容，請稍後再試或先按「同步最新」。`);
          return 'blocked';
        }
        const ownedLock:ActiveEditLock={...lockState,status:'owned',validatedUntilMs:conservativeLeaseDeadline(lock.expiresAt)};
        activeEditLockRef.current=ownedLock;
        setActiveEditLock(ownedLock);
        clearVesselLeaseIncident(sectionKey);
        setSensitiveCloudStatus(`多人協作安全：已鎖定 ${label}，其他人會看到正在編輯提示`,sectionKey);
        return 'owned';
      }catch(error:any){
        if(!sameCloudConfig(getSupabaseConfig(),leaseConfig)&&lockCoordinator.current.isCurrent(generation))lockCoordinator.current.invalidate();
        let cleanupFailed=false;
        try{await runCloudSaveQueueRpc('回滾未確認多人協作鎖',signal=>releaseEditLock(sectionKey,leaseOwnerId,leaseConfig,signal),8_000);leaseCloudConfigs.current.delete(leaseOwnerId);}catch{cleanupFailed=true;}
        if(!lockCoordinator.current.isCurrent(generation))return 'unavailable';
        setActiveEditLock(cleanupFailed?{...lockState,status:'error'}:null);
        setSensitiveCloudStatus(cleanupFailed?`無法確認或釋放多人協作鎖：${error.message||error}`:`無法取得多人協作鎖，已確認未保留鎖定：${error.message||error}`,sectionKey);
        alert(`無法確認是否有人正在編輯「${label}」，為避免衝突，請先同步最新或稍後再試。`);
        return 'unavailable';
      }
    });}finally{if(pendingClaimConfig.current?.generation===generation)pendingClaimConfig.current=null;}
  };

  const commit = (updater: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => {
    setData(prev => { const d = clone(prev); updater(d); return withAudit(d, currentUser, action, entityType, entityId, detail); });
  };
  const mutationLeaseIsOwned=(sectionKey:string)=>{
    const lock=activeEditLockRef.current;
    if(!getSupabaseConfig())return !lock||Boolean(lock.status==='owned'&&lock.sectionKey===sectionKey&&lock.ownerUserId===currentUser?.id&&lock.authorizationEpoch===authorizationEpoch&&lockCoordinator.current.isCurrent(lock.generation));
    const record=lock?leaseCloudConfigs.current.get(lock.leaseOwnerId):undefined;
    const currentConfig=getSupabaseConfig();
    return editLockAllowsMutation(lock,sectionKey,currentUser?.id,authorizationEpoch,Boolean(lock&&lockCoordinator.current.isCurrent(lock.generation)),Boolean(record&&record.sectionKey===sectionKey&&sameCloudConfig(currentConfig,record.config)));
  };
  const requireMutationLease=(sectionKey:string)=>{
    if(mutationLeaseIsOwned(sectionKey))return true;
    const lock=activeEditLockRef.current;
    if(classifyMutationLeaseFailure(sectionKey)==='freeze-vessel-draft'&&lock?.sectionKey===sectionKey){
      freezeVesselEditorForLock(lock,'協作鎖已失效或無法確認；目前內容已唯讀保留，本次未保存。');
      alert('協作鎖已失效或無法確認；目前內容已唯讀保留，不能保存。');
      return false;
    }
    if(sectionKey.startsWith('task:')||isTaskCreationLockKey(sectionKey)){
      if(isTaskCreationLockKey(sectionKey)&&lock?.sectionKey===sectionKey)quarantineCreationDraftForLock(lock);
      setEditingTaskId('');setTaskEditorAuthorizationEpoch('');setTaskProgressVesselId('');setCreatingTask(null);
    }
    setSensitiveCloudStatus('協作鎖已失效或無法確認；編輯器已關閉，本次未保存',sectionKey);
    if(lock?.sectionKey===sectionKey)void releaseCurrentEditLock();
    alert('協作鎖已失效或無法確認，本次未保存；請重新開啟後再試。');
    return false;
  };
  const requireLogin = () => { if (!currentUser) { alert('請先登入或切換用戶'); return false; } return true; };
  const canEnterManagement = hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement');
  const canEditBusinessContent = hasPermission(data.settings.rolePermissions, currentUser, 'editBusinessContent');
  const canCreateTasks = hasPermission(data.settings.rolePermissions, currentUser, 'createTasks');
  const canCloseTasks = hasPermission(data.settings.rolePermissions, currentUser, 'closeTasks');
  const canDeleteTasks = hasPermission(data.settings.rolePermissions, currentUser, 'deleteTasks') && canDeleteTask(currentUser);
  const canExportReports = hasPermission(data.settings.rolePermissions, currentUser, 'exportReports');
  const canUseMeetingWorkspace = Boolean(currentUser && currentUser.role!=='vessel');
  const canEditMeetings = Boolean(currentUser&&canUseMeetingWorkspace&&canEditTemporaryMeetings(data.settings.rolePermissions,currentUser));
  const canMutateInternalControl = Boolean(currentUser&&currentUser.role!=='vessel'&&(canEditBusinessContent||canCloseTasks||canDeleteTasks));
  const canViewAllVessels = currentUser?.role==='owner'||currentUser?.role==='admin'||hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const requireManage = () => { if (!currentUser || !hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement')) { alert('您無權訪問管理頁面'); navigateToTab('dashboard'); return false; } return true; };

  const activeVessels = useMemo(()=>data.vessels.filter(v=>v.isActive&&vesselMatchesUser(v,currentUser,canViewAllVessels)),[data.vessels,currentUser,canViewAllVessels]);
  const itineraryOperationalFeed=useItineraryOperationalProjection({
    actor:currentUserId&&currentUser?{userId:currentUser.id}:null,
    vesselIds:activeVessels.map(vessel=>vessel.id),
    enabled:Boolean(siteUnlocked&&currentUserId&&cloudBootstrapped&&getSupabaseConfig()),
  });
  const batchTargetVessels = useMemo(()=>batchTargetVesselsFor(activeVessels,currentUser,batchSelectedVesselIds),[activeVessels,currentUser,batchSelectedVesselIds]);
  const batchSessionVessels = useMemo(()=>batchManagedOpen?batchSessionVesselsFor(activeVessels,batchTargetVesselIdsRef.current):[],[activeVessels,batchManagedOpen]);
  const taskVisibilityRelationships = useMemo(()=>({internalControlCases:data.internalControlCases,meetings:data.meetings,visibleVesselIds:activeVessels.map(vessel=>vessel.id)}),[data.internalControlCases,data.meetings,activeVessels]);
  const roleVisibleTasks = useMemo(()=>selectTasksVisibleToUser(data.tasks,currentUser,taskVisibilityRelationships),[data.tasks,currentUser,taskVisibilityRelationships]);
  const roleVisibleMeetings=useMemo(()=>{
    if(!currentUser)return [];
    if(currentUser.role==='owner'||currentUser.role==='admin')return data.meetings;
    return data.meetings.filter(meeting=>currentUser.role!=='vessel'||!meeting.isInternalControl).filter(meeting=>meetingAppliesToUser(meeting,activeVessels,canEditTemporaryMeetings(data.settings.rolePermissions,currentUser),currentUser.id));
  },[data.meetings,data.settings.rolePermissions,currentUser,activeVessels]);
  const roleVisibleInternalControlCases=useMemo(()=>{
    if(!currentUser)return [];
    return selectInternalControlCasesVisibleToUser(data.internalControlCases,data.tasks,currentUser,activeVessels.map(vessel=>vessel.id));
  },[data.internalControlCases,data.tasks,currentUser,activeVessels]);
  const roleVisibleData=useMemo(()=>({...data,tasks:roleVisibleTasks,meetings:roleVisibleMeetings,internalControlCases:roleVisibleInternalControlCases,taskDismissals:currentUser?data.taskDismissals.filter(item=>item.userId===currentUser.id):[]}),[data,roleVisibleTasks,roleVisibleMeetings,roleVisibleInternalControlCases,currentUser?.id]);
  const taskLockIsAuthorized = (task: TaskItem) => canAcquireTaskEditLock(task,currentUser,canEditBusinessContent,activeVessels,data.settings.rolePermissions);
  const authorizedEditLockKeys=useMemo(()=>new Set<string>([
    ...(canEditBusinessContent?activeVessels.map(vessel=>`vessel:${vessel.id}`):[]),
    ...(activeEditLock&&isTaskCreationLockKey(activeEditLock.sectionKey)&&canCreateTasks&&activeVessels.some(vessel=>canUseVessel(currentUser,vessel.id)&&taskCreationLockMatchesVessel(activeEditLock.sectionKey,vessel.id))?[activeEditLock.sectionKey]:[]),
    ...(activeEditLock&&isMeetingCreationLockKey(activeEditLock.sectionKey)&&canEditMeetings?[activeEditLock.sectionKey]:[]),
    ...(activeEditLock&&isInternalControlCreationLockKey(activeEditLock.sectionKey)&&canCreateTasks&&currentUser.role!=='vessel'?[activeEditLock.sectionKey]:[]),
    ...roleVisibleTasks.filter(taskLockIsAuthorized).map(task=>`task:${task.id}`),
    ...(canEditMeetings?roleVisibleMeetings.map(meeting=>meetingEditLockKey(meeting.id)):[]),
    ...(canMutateInternalControl?roleVisibleInternalControlCases.map(item=>internalControlEditLockKey(item.id)):[]),
  ]),[canEditBusinessContent,canCreateTasks,canEditMeetings,canMutateInternalControl,currentUser,activeVessels,roleVisibleTasks,roleVisibleMeetings,roleVisibleInternalControlCases,data.settings.rolePermissions,activeEditLock?.sectionKey]);
  const authorizedEditLockKey=[...authorizedEditLockKeys].sort().join('|');
  liveAuthorizedEditLockKeys.current=authorizedEditLockKeys;
  useEffect(()=>{if(activeEditLock&&!authorizedEditLockKeys.has(activeEditLock.sectionKey)){if(isTaskCreationLockKey(activeEditLock.sectionKey))quarantineCreationDraftForLock(activeEditLock);releaseCurrentEditLock();}},[authorizedEditLockKey,activeEditLock?.sectionKey]);
  const visibleCloudStatus=cloudStatusSectionKey&&(
    cloudStatusAuthorizationEpoch!==authorizationEpoch
    ||!authorizedEditLockKeys.has(cloudStatusSectionKey)
    ||activeEditLock?.sectionKey!==cloudStatusSectionKey
  )?(getSupabaseConfig()?'多人協作狀態已更新':'本機模式'):cloudStatus;

  const itemLeaseIsAuthorizedInSnapshot=(sectionKey:string,snapshot:AppData)=>{
    const actor=snapshot.users.find(user=>user.id===currentUser?.id&&user.isActive);
    if(!actor)return false;
    const actorCanViewAll=actor.role==='owner'||actor.role==='admin'||hasPermission(snapshot.settings.rolePermissions,actor,'viewAllVessels');
    const actorVessels=snapshot.vessels.filter(vessel=>vessel.isActive&&vesselMatchesUser(vessel,actor,actorCanViewAll));
    if(sectionKey.startsWith('vessel:')){
      const vesselId=sectionKey.slice('vessel:'.length);
      return hasPermission(snapshot.settings.rolePermissions,actor,'editBusinessContent')&&actorVessels.some(vessel=>vessel.id===vesselId);
    }
    if(isTaskCreationLockKey(sectionKey))return hasPermission(snapshot.settings.rolePermissions,actor,'createTasks')&&actorVessels.some(vessel=>canUseVessel(actor,vessel.id)&&taskCreationLockMatchesVessel(sectionKey,vessel.id));
    if(isMeetingCreationLockKey(sectionKey))return actor.role!=='vessel'&&canEditTemporaryMeetings(snapshot.settings.rolePermissions,actor);
    if(isInternalControlCreationLockKey(sectionKey))return actor.role!=='vessel'&&hasPermission(snapshot.settings.rolePermissions,actor,'createTasks');
    if(sectionKey.startsWith('task:')){
      const task=snapshot.tasks.find(item=>item.id===sectionKey.slice('task:'.length));
      return Boolean(task&&canAcquireTaskEditLock(task,actor,hasPermission(snapshot.settings.rolePermissions,actor,'editBusinessContent'),actorVessels,snapshot.settings.rolePermissions));
    }
    if(sectionKey.startsWith('meeting:')){
      const meeting=snapshot.meetings.find(item=>meetingEditLockKey(item.id)===sectionKey);
      return Boolean(meeting&&canEditTemporaryMeetings(snapshot.settings.rolePermissions,actor)&&meetingAppliesToUser(meeting,actorVessels,actorCanViewAll,actor.id));
    }
    if(sectionKey.startsWith('internal-control:')){
      if(actor.role==='vessel'||!(hasPermission(snapshot.settings.rolePermissions,actor,'editBusinessContent')||hasPermission(snapshot.settings.rolePermissions,actor,'closeTasks')||hasPermission(snapshot.settings.rolePermissions,actor,'deleteTasks')))return false;
      return selectInternalControlCasesVisibleToUser(snapshot.internalControlCases,snapshot.tasks,actor,actorVessels.map(vessel=>vessel.id)).some(item=>internalControlEditLockKey(item.id)===sectionKey);
    }
    return false;
  };
  const itemLeaseExistsInSnapshot=(sectionKey:string,snapshot:AppData)=>{
    if(isTaskCreationLockKey(sectionKey))return snapshot.vessels.some(vessel=>taskCreationLockMatchesVessel(sectionKey,vessel.id));
    if(isMeetingCreationLockKey(sectionKey)||isInternalControlCreationLockKey(sectionKey))return true;
    if(sectionKey.startsWith('vessel:'))return snapshot.vessels.some(vessel=>`vessel:${vessel.id}`===sectionKey);
    if(sectionKey.startsWith('task:'))return snapshot.tasks.some(task=>`task:${task.id}`===sectionKey);
    if(sectionKey.startsWith('meeting:'))return snapshot.meetings.some(meeting=>meetingEditLockKey(meeting.id)===sectionKey);
    if(sectionKey.startsWith('internal-control:'))return snapshot.internalControlCases.some(item=>internalControlEditLockKey(item.id)===sectionKey);
    return false;
  };
  const refreshAfterItemLease=async(sectionKey:string):Promise<AppData|null>=>{
    const claimedLock=activeEditLockRef.current;
    if(!claimedLock||claimedLock.sectionKey!==sectionKey||claimedLock.status!=='owned')return null;
    const leaseConfig=getSupabaseConfig();
    if(!leaseConfig)return itemLeaseIsAuthorizedInSnapshot(sectionKey,liveData.current)?liveData.current:null;
    const claimStillCurrent=()=>activeEditLockRef.current?.leaseOwnerId===claimedLock.leaseOwnerId&&lockCoordinator.current.isCurrent(claimedLock.generation)&&sameCloudConfig(getSupabaseConfig(),leaseConfig);
    try{
      if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
      const beforeSave=confirmedCloudData.current;
      if(!beforeSave||!appDataContentEqual(liveData.current,beforeSave))await enqueueCloudSave(liveData.current);
      if(!claimStillCurrent())return null;
      const confirmed=confirmedCloudData.current;
      if(!confirmed)throw new Error('沒有可驗證的已保存雲端基線');
      const token=configIoCoordinator.current.begin(leaseConfig);
      const remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);
      if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig())||!claimStillCurrent())return null;
      if(!remote)throw new Error('雲端工作區尚未建立，不能開啟多人單項編輯');
      assertRemoteExtendsDurableHistory(cloudWorkspaceIdentity(leaseConfig),confirmed,remote);
      const resolution=resolveItemEditSession({
        live:liveData.current,confirmed,remote,equals:appDataContentEqual,
        select:snapshot=>itemLeaseExistsInSnapshot(sectionKey,snapshot)?snapshot:undefined,
        authorize:snapshot=>itemLeaseIsAuthorizedInSnapshot(sectionKey,snapshot),
      });
      if(resolution.status==='local-dirty')throw new Error('仍有修改尚未完成雲端保存');
      if(resolution.status==='remote-rollback')throw new Error('雲端 revision 早於已確認基線');
      if(resolution.status==='missing')throw new Error('項目已被刪除');
      if(resolution.status==='unauthorized')throw new Error('最新雲端權限已撤銷此項目的編輯權');
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(cloudIdentity(leaseConfig),remote);
      liveData.current=remote;
      setData(remote);
      setCloudWriteBlocked(false);
      setSensitiveCloudStatus('已取得單項鎖並重新讀取最新雲端內容，可以開始編輯',sectionKey);
      return remote;
    }catch(error:any){
      if(claimStillCurrent())await releaseCurrentEditLock();
      setSensitiveCloudStatus(`取得單項鎖後無法安全刷新：${error.message||error}`,sectionKey);
      alert(`無法安全開啟此項目：${error.message||error}`);
      return null;
    }
  };
  const claimExclusiveItemLease=async(sectionKey:string,label:string):Promise<AppData|null>=>{
    const liveAuthorized=()=>itemLeaseExistsInSnapshot(sectionKey,liveData.current)&&itemLeaseIsAuthorizedInSnapshot(sectionKey,liveData.current);
    if(await claimEditingLock(sectionKey,label,undefined,true,liveAuthorized)!=='owned')return null;
    return refreshAfterItemLease(sectionKey);
  };
  const releaseExclusiveItemLease=async(sectionKey:string)=>{
    const lock=activeEditLockRef.current;
    if(!lock||lock.sectionKey!==sectionKey)return false;
    if(lock.status==='owned'&&!await ensureCloudDurableBeforeLeaseRelease(sectionKey))return false;
    return releaseCurrentEditLock();
  };
  const mutateVesselWithLease=async(vesselId:string,label:string,action:string,detail:string,updater:(vessel:Vessel,draft:AppData)=>string|void)=>{
    const sectionKey=`vessel:${vesselId}`;
    const fresh=await claimExclusiveItemLease(sectionKey,label);
    if(!fresh)return false;
    if(!requireMutationLease(sectionKey)){await releaseCurrentEditLock();return false;}
    let applied=false;
    let rejectionMessage='';
    flushSync(()=>setData(prev=>{
      const actor=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      const vessel=prev.vessels.find(item=>item.id===vesselId&&item.isActive);
      if(prev.revision!==fresh.revision||!actor||!vessel||!hasPermission(prev.settings.rolePermissions,actor,'editBusinessContent')||!batchVisibleVesselIds(prev,actor).has(vesselId))return prev;
      const draft=clone(prev);
      const target=draft.vessels.find(item=>item.id===vesselId)!;
      rejectionMessage=updater(target,draft)||'';
      if(rejectionMessage)return prev;
      applied=true;
      return withAudit(draft,actor,action,'vessel',vesselId,detail);
    }));
    if(!applied){await releaseExclusiveItemLease(sectionKey);alert(rejectionMessage||'船舶資料或權限已變更，本次未保存；請重新操作。');return false;}
    return releaseExclusiveItemLease(sectionKey);
  };
  const persistDashboardVesselAttention=async(vesselId:string,desired:WeeklyAttentionKey[])=>{
    const fail=(message:string):never=>{
      hasUnsavedWork.current=true;
      setSavePhase('error');
      setCloudStatus(`關注燈尚未同步｜${message}`);
      throw new Error(message);
    };
    if(!canEditBusinessContent)fail('目前身份未獲授權修改關注燈');
    const config=getSupabaseConfig();
    if(config&&!cloudBootstrapped)fail('雲端資料仍在載入，請稍後重試');
    if(config&&(cloudSyncing||cloudSyncInFlight.current))fail('正在同步最新雲端資料，完成後請重試');
    if(config&&cloudWriteBlocked)fail('請先使用頁首「同步最新（安全合併）」後再重試');
    const normalized=WEEKLY_ATTENTION_KEYS.filter(key=>desired.includes(key));
    let snapshot=liveData.current;
    let applied=false;
    flushSync(()=>setData(previous=>{
      const actor=previous.users.find(user=>user.id===currentUser.id&&user.isActive);
      const vessel=previous.vessels.find(item=>item.id===vesselId&&item.isActive);
      if(!actor||!vessel||!hasPermission(previous.settings.rolePermissions,actor,'editBusinessContent')||!batchVisibleVesselIds(previous,actor).has(vesselId))return previous;
      applied=true;
      if(vessel.weeklyAttention.length===normalized.length&&vessel.weeklyAttention.every((item,index)=>item===normalized[index])){snapshot=previous;return previous;}
      const draft=clone(previous);
      const target=draft.vessels.find(item=>item.id===vesselId)!;
      target.weeklyAttention=[...normalized];
      target.updatedAt=nowIso();
      snapshot=withAudit(draft,actor,'切換一週關注燈','vessel',vesselId,normalized.join('、')||'清除全部關注燈');
      vesselAttentionDirectSaveSnapshots.current.add(snapshot);
      return snapshot;
    }));
    if(!applied)fail('船舶資料或權限已變更，請重新整理後再操作');
    if(!config){
      if(!saveLocal(snapshot))fail('瀏覽器儲存空間不足或不可用');
      hasUnsavedWork.current=false;
      setSavePhase('saved');
      setCloudStatus(savedStatus('關注燈已保存於本機瀏覽器'));
      return;
    }
    const confirmed=confirmedCloudData.current;
    if(confirmed&&appDataContentEqual(snapshot,confirmed))return;
    if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
    await enqueueCloudSave(snapshot);
  };
  vesselAttentionPersistRef.current=persistDashboardVesselAttention;
  const toggleDashboardVesselAttention=(vesselId:string,key:WeeklyAttentionKey)=>{
    if(!canEditBusinessContent)return alert('目前角色未獲授權修改關注燈');
    const vessel=liveData.current.vessels.find(item=>item.id===vesselId&&item.isActive);
    if(!vessel)return alert('船舶資料已變更，請重新整理後再操作');
    const current=vesselAttentionSaveQueue.current?.desired(vesselId)||vessel.weeklyAttention;
    const selected=new Set(current);
    if(selected.has(key))selected.delete(key);else selected.add(key);
    const desired=WEEKLY_ATTENTION_KEYS.filter(item=>selected.has(item));
    hasUnsavedWork.current=true;
    setSavePhase('dirty');
    setCloudStatus('關注燈已立即更新，正在合併快速操作…');
    vesselAttentionSaveQueue.current?.enqueue(vesselId,desired);
  };
  const retryDashboardVesselAttention=(vesselId:string)=>{
    if(!canEditBusinessContent)return alert('目前角色未獲授權修改關注燈');
    if(!vesselAttentionSaveQueue.current?.retry(vesselId))return;
    hasUnsavedWork.current=true;
    setSavePhase('dirty');
    setCloudStatus('正在重試保存關注燈…');
  };
  const adjustDashboardVesselAttention=(vesselId:string,manualAttentionLevel:VesselAttentionLevel|'')=>{
    if(!canEditBusinessContent)return alert('目前角色未獲授權調整關注度');
    const visibleVessel=liveData.current.vessels.find(item=>item.id===vesselId&&item.isActive);
    if(!visibleVessel)return alert('船舶資料已變更，請重新整理後再操作');
    const visibleOpenTasks=vesselAttentionTasks(liveData.current.tasks.filter(task=>taskHasVessel(task,vesselId))).filter(task=>!taskIsClosedForVessel(task,vesselId));
    const visibleAutomatic=deriveVesselAttention(visibleVessel,visibleOpenTasks,liveData.current.meetings.some(meeting=>meetingCreatesVesselAbnormalAlert(meeting,vesselId)),liveData.current.internalControlCases).automatic;
    if(!manualVesselAttentionAllowed(manualAttentionLevel,visibleAutomatic))return alert(`不能低於目前自動判定：${visibleAutomatic}關注`);
    void mutateVesselWithLease(vesselId,`船舶關注度｜${vesselId}`,'調整船舶關注度','自動／低／中／高／急／特別關注（受自動下限保護）',(vessel,draft)=>{
      const openVesselTasks=vesselAttentionTasks(draft.tasks.filter(task=>taskHasVessel(task,vesselId))).filter(task=>!taskIsClosedForVessel(task,vesselId));
      const automatic=deriveVesselAttention(vessel,openVesselTasks,draft.meetings.some(meeting=>meetingCreatesVesselAbnormalAlert(meeting,vesselId)),draft.internalControlCases).automatic;
      if(!manualVesselAttentionAllowed(manualAttentionLevel,automatic))return `自動判定已更新為${automatic}關注，本次未保存；請重新選擇。`;
      vessel.manualAttentionLevel=manualAttentionLevel;
      vessel.updatedAt=nowIso();
    });
  };
  const savePhaseLabel:Record<SavePhase,string>={saved:'已安全保存',dirty:'尚未保存',queued:'等待保存',saving:'正在保存',error:'保存未完成'};
  const saveButtonLabel=savePhase==='queued'?'等待保存中…':savePhase==='saving'?'正在保存…':savePhase==='error'?'重新保存':'立即保存';
  const isSaveBusy=savePhase==='queued'||savePhase==='saving'||Boolean(cloudSaveInFlight.current);
  const currentAppUpdateBlockReason=()=>appUpdateBlockReason({
    hasUnsavedWork:hasUnsavedWork.current||Boolean(vesselAttentionSaveQueue.current?.hasPending()),
    pendingSaveCount:pendingCloudData.current.size(),
    pendingTaskCreations:pendingTaskCreationsRef.current.length,
    saveInFlight:Boolean(cloudSaveInFlight.current),
    syncInFlight:cloudSyncInFlight.current||cloudSyncing,
    saveTimerScheduled:Boolean(saveTimer.current),
    savePhase,
    hasActiveEditLock:Boolean(activeEditLockRef.current),
    batchEditorActive:batchManagedRequested.current||batchManagedOpenRef.current||batchManagedCloseInFlight.current,
  });
  const versionUpdateBlockReason=availableAppVersion?currentAppUpdateBlockReason():null;
  const applyAppUpdate=()=>{
    if(!availableAppVersion)return;
    if(currentAppUpdateBlockReason())return alert('目前有未保存內容或正在編輯，系統不會重新載入。請先完成並保存。');
    if(document.querySelector('[role="dialog"],.modal-backdrop'))return alert('請先關閉正在填寫或查看的視窗，再更新系統。');
    if(!confirm('系統將重新載入新版。請確認沒有尚未提交的表單內容；確定立即更新嗎？'))return;
    if(currentAppUpdateBlockReason()||document.querySelector('[role="dialog"],.modal-backdrop'))return alert('頁面狀態已變更，為避免遺失內容，本次未重新載入。請完成保存後再試。');
    window.location.assign(appVersionReloadUrl(window.location.href,availableAppVersion));
  };
  const appVersionUpdateNotice=availableAppVersion&&<aside className={`app-version-update no-print ${versionUpdateBlockReason?'blocked':'ready'}`} role="status" aria-live="polite"><div><b>系統已有新版本</b><small>{versionUpdateBlockReason?'目前有未保存內容或正在編輯，系統不會重新載入。請先完成並保存。':'目前未偵測到保存中或未保存修改；更新不會清除雲端或瀏覽器App資料。'}</small></div><button type="button" className="btn primary small" onClick={applyAppUpdate} disabled={Boolean(versionUpdateBlockReason)}>{versionUpdateBlockReason?'完成保存後更新':'立即更新'}</button></aside>;
  const operationalActiveVessels=useMemo(()=>activeVessels.map(vessel=>resolveVesselWithItineraryProjection(vessel,itineraryOperationalFeed.records[vessel.id])),[activeVessels,itineraryOperationalFeed.records]);
  const itineraryOperationalProblem=Object.values(itineraryOperationalFeed.records).find(record=>record.status==='error'||record.status==='stale');
  const dashboardVessels=useMemo(()=>operationalActiveVessels.map(vessel=>{
    const saveState=vesselAttentionSaveStates[vessel.id];
    return saveState?{...vessel,weeklyAttention:[...saveState.desired]}:vessel;
  }),[operationalActiveVessels,vesselAttentionSaveStates]);
  const operationalVesselById=useMemo(()=>new Map(dashboardVessels.map(vessel=>[vessel.id,vessel])),[dashboardVessels]);
  const effectiveBatchSessionVessels=useMemo(()=>batchSessionVessels.map(vessel=>operationalVesselById.get(vessel.id)||vessel),[batchSessionVessels,operationalVesselById]);
  const editingOperationalVessel=editingVesselId?(operationalVesselById.get(editingVesselId)||data.vessels.find(vessel=>vessel.id===editingVesselId)):undefined;
  const requireFreshItineraryProjection=async(vessels:readonly Vessel[]=activeVessels)=>{
    const result=await itineraryOperationalFeed.refresh(vessels.map(vessel=>vessel.id));
    return buildItineraryProjectionSnapshot(vessels,result.records,result.capturedAt);
  };
  const dashboardMeetings = useMemo(()=>dashboardMeetingAlerts(
    roleVisibleMeetings,
    activeVessels.map(vessel=>vessel.id),
    meeting=>Boolean(canUseMeetingWorkspace&&meetingAppliesToUser(meeting,activeVessels,canEditTemporaryMeetings(data.settings.rolePermissions,currentUser),currentUser.id)),
  ),[roleVisibleMeetings,data.settings.rolePermissions,currentUser,activeVessels,canUseMeetingWorkspace]);
  const selectedVesselDetail = operationalVesselById.get(selectedVesselDetailId);
  const reportPreviewHistory=roleVisibleData.agendaReports.find(report=>report.id===reportPreviewHistoryId&&report.kind==='daily-morning');
  const reportPreviewSnapshot=reportPreviewHistory?.snapshot;
  const reportPreviewAuthorizedVessels=data.vessels.filter(vessel=>vesselMatchesUser(vessel,currentUser,canViewAllVessels));
  const reportPreviewAuthorizedVesselIds=new Set(reportPreviewAuthorizedVessels.map(vessel=>vessel.id));
  const reportBaseVessels=reportPreviewSnapshot
    ? reportPreviewSnapshot.vessels.filter(vessel=>reportPreviewAuthorizedVesselIds.has(vessel.id))
    : activeVessels;
  const reportItineraryEntries=reportPreviewSnapshot?.itineraryProjections||reportPreviewLiveItinerarySnapshot?.itineraryProjections;
  const reportVessels=reportPreviewSnapshot||reportPreviewLiveItinerarySnapshot
    ? applyItineraryProjectionSnapshot(reportBaseVessels,reportItineraryEntries)
    : dashboardVessels;
  const reportPreviewSnapshotInternalControlCases=reportPreviewSnapshot?.internalControlCases||[];
  const reportPreviewTasks=reportPreviewSnapshot?selectTasksVisibleToUser(reportPreviewSnapshot.tasks,currentUser,{
    internalControlCases:reportPreviewSnapshotInternalControlCases,
    meetings:reportPreviewSnapshot.meetings,
    visibleVesselIds:reportVessels.map(vessel=>vessel.id),
  }):[];
  const reportPreviewInternalControlCases=reportPreviewSnapshot?selectInternalControlCasesVisibleToUser(
    reportPreviewSnapshotInternalControlCases,
    reportPreviewSnapshot.tasks,
    currentUser,
    reportVessels.map(vessel=>vessel.id),
  ):[];
  const reportPreviewMeetingIds=new Set(reportPreviewTasks.map(task=>task.sourceMeetingId).filter((id):id is string=>Boolean(id)));
  const reportPreviewMeetings=reportPreviewSnapshot?reportPreviewSnapshot.meetings.filter(meeting=>reportPreviewMeetingIds.has(meeting.id)):[];
  const reportPreviewData:AppData={
    ...roleVisibleData,
    vessels:reportVessels,
    ...(reportPreviewSnapshot?{
      meetings:reportPreviewMeetings,
      tasks:reportPreviewTasks,
      internalControlCases:reportPreviewInternalControlCases,
    }:{}),
  };
  const myWorkTaskCount = currentUser ? selectUserWorkCenterTasks(roleVisibleData,currentUser,activeVessels).length + selectUserWorkCenterInternalCases(roleVisibleData,currentUser,activeVessels).length : 0;
  useEffect(() => { setAgendaSelection(prev => prev.filter(id => activeVessels.some(v=>v.id===id))); }, [activeVessels]);
  useEffect(() => { setBatchSelectedVesselIds(prev => prev.filter(id => activeVessels.some(v=>v.id===id))); }, [activeVessels]);
  useEffect(() => { if (selectedVesselDetailId && !activeVessels.some(vessel=>vessel.id===selectedVesselDetailId)) setSelectedVesselDetailId(''); }, [activeVessels, selectedVesselDetailId]);
  useEffect(()=>{
    if(tab!=='dashboard'||selectedVesselDetailId)return;
    const vesselId=dashboardReturnVesselIdRef.current;
    if(!vesselId)return;
    scrollToDashboardVesselCard(vesselId);
    dashboardReturnVesselIdRef.current='';
  },[tab,selectedVesselDetailId,dashboardVessels]);
  useEffect(() => { if (currentUser && (!canAccessTab(currentUser, tab) || (tab === 'reports' && !canExportReports))) setTab('dashboard'); }, [currentUser, tab, canExportReports]);
  useEffect(()=>{
    const quarantined=quarantinedCreationDraft;
    if(!quarantined||!currentUser||quarantined.ownerUserId!==currentUser.id||!canCreateTasks||editingTaskId||creatingTask)return;
    if(creationHandoffInFlight.current?.leaseOwnerId===quarantined.leaseOwnerId)return;
    if(!activeVessels.some(vessel=>vessel.id===quarantined.task.vesselId&&canUseVessel(currentUser,vessel.id)))return;
    const requestGeneration=taskOpenRequests.current.begin({vesselId:quarantined.task.vesselId,batchManaged:false});
    setCreatingTask(clone(quarantined.task));
    setEditingTaskId(quarantined.task.id);
    setTaskEditorRequestGeneration(requestGeneration);
    setTaskEditorAuthorizationEpoch(authorizationEpoch);
    setTaskProgressVesselId('');
    setTaskReadOnlyData(null);
    setTaskReadOnlyReason('此新增草稿在身份退出期間完成雲端結果分類；已隔離並以唯讀方式恢復，請複製內容後關閉，再重新取得新增協作鎖');
  },[quarantinedCreationDraft?.task.id,currentUser?.id,canCreateTasks,editingTaskId,creatingTask?.id,authorizationEpoch,creationHandoffVersion,activeVessels.map(vessel=>vessel.id).join('|')]);
  const vesselMap = useMemo(() => Object.fromEntries(data.vessels.map(v => [v.id, v])), [data.vessels]);
  const userMap = useMemo(() => Object.fromEntries(data.users.map(u => [u.id, u])), [data.users]);
  const fleetTags = useMemo(() => Array.from(new Set(data.vessels.flatMap(v => v.fleetTags))).filter(Boolean), [data.vessels]);

  const filteredTasks = useMemo(() => {
    return sortRecordsNewestCreated(roleVisibleTasks
      .filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))));
  },[roleVisibleTasks,vesselMap,currentUser,filters,canViewAllVessels,activeVessels]);
  const statsTasks = useMemo(() => roleVisibleTasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,false,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[roleVisibleTasks,vesselMap,currentUser,filters,canViewAllVessels]);
  const closedTasks = useMemo(() => sortRecordsNewestCreated(roleVisibleTasks.filter(t=>taskMatchesFilters(t,closedFilters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id))))),[roleVisibleTasks,vesselMap,currentUser,closedFilters,canViewAllVessels]);

  if (!cloudBootstrapped) return <>{appVersionUpdateNotice}<div className="login-page"><div className="login-card loading-card"><h2>正在載入雲端主資料</h2><p className="muted">請稍候，完成前不會寫入或覆蓋資料。</p></div></div></>;
  const firstRunInitializationAllowed=mayOfferFirstRunInitialization({
    cloudConfigured:Boolean(getSupabaseConfig()),
    cloudBootstrapped,
    cloudWriteBlocked,
    activeCloudIdentity:activeCloudIdentity.current,
    currentCloudIdentity:cloudIdentity(getSupabaseConfig()),
    cloudInitializationAllowed,
    localInitializationAllowed:import.meta.env.DEV,
  });
  const productionCloudUnavailable=!getSupabaseConfig()&&!import.meta.env.DEV;
  const productionCloudSafetyGateBlocked=shouldRenderProductionCloudSafetyGate({
    productionCloudUnavailable,
    editingVesselId,
    currentUserId:currentUser?.id||'',
    authorizationEpoch,
    activeVesselIds:activeVessels.map(vessel=>vessel.id),
    incident:vesselLeaseIncidentRef.current,
  });
  if(productionCloudSafetyGateBlocked||((!data.settings.sitePasswordHash||!ownerExists)&&!firstRunInitializationAllowed))return <>{appVersionUpdateNotice}<div className="login-page"><div className="login-card loading-card"><h2>雲端主資料尚未通過首次初始化安全檢查</h2><p className="warn">已阻止設定進站密碼或建立 Owner。</p><p className="muted">{cloudStatus}</p><p className="muted">請確認網路與 Supabase 設定後重新載入；系統不會使用內建初始資料取代正式資料。</p></div></div></>;
  if (!siteUnlocked || !data.settings.sitePasswordHash) return <>{appVersionUpdateNotice}<SiteGate data={data} setData={setData} onUnlock={() => { sessionStorage.setItem(SESSION_SITE_UNLOCK,'1'); setSiteUnlocked(true); }} /></>;
  if (!ownerExists && !currentUser) return <>{appVersionUpdateNotice}<Login data={data} setCurrentUserId={setCurrentUserId} /></>;
  if (!ownerExists && currentUser) return <>{appVersionUpdateNotice}<OwnerSetup currentUser={currentUser} setData={setData} setCurrentUserId={setCurrentUserId} /></>;
  if (!currentUser) return <>{appVersionUpdateNotice}<Login data={data} setCurrentUserId={setCurrentUserId} /></>;

  const clearBlockedTaskLock = (taskId = '') => {
    setActiveEditLock(previous => {
      if (!previous || previous.status !== 'blocked' || !previous.sectionKey.startsWith('task:') || (taskId && previous.sectionKey !== `task:${taskId}`)) return previous;
      leaseCloudConfigs.current.delete(previous.leaseOwnerId);
      blockedTaskCloudConfig.current=null;
      return null;
    });
  };
  const invalidatePendingTaskOpen = () => {
    taskOpenRequests.current.invalidate();
    if (taskReadOnlyData) {
      setEditingTaskId('');
      setTaskEditorAuthorizationEpoch('');
      setTaskProgressVesselId('');
    }
    setTaskReadOnlyData(null);
    setTaskReadOnlyReason('');
    clearBlockedTaskLock();
  };
  const navigateToTab = async (nextTab:Tab) => {
    const incident=vesselLeaseIncidentRef.current;
    if(editingVesselId&&incident&&classifyVesselLeaseIncidentClose(incident.mode)==='confirm-discard'&&incident.sectionKey===`vessel:${editingVesselId}`){
      const incidentLock=activeEditLockRef.current;
      const matchingIncidentLock=incidentLock?.sectionKey===incident.sectionKey&&incidentLock.leaseOwnerId===incident.leaseOwnerId?incidentLock:null;
      if(!await closeVesselEditorRef.current(matchingIncidentLock))return;
    }
    const lock=activeEditLockRef.current;
    if(lock){
      if(lock.status==='owned'&&!await releaseExclusiveItemLease(lock.sectionKey))return;
      else if(lock.status!=='owned'&&!await releaseCurrentEditLock())return;
      closeEditorForLock(lock);
    }
    invalidatePendingTaskOpen();
    setSelectedVesselDetailId('');
    setTab(nextTab);
  };
  const openVesselDetail = (vesselId: string) => {
    invalidatePendingTaskOpen();
    setSelectedVesselDetailId(vesselId);
  };
  const closeVesselDetail = () => {
    invalidatePendingTaskOpen();
    dashboardReturnVesselIdRef.current=selectedVesselDetailId;
    setSelectedVesselDetailId('');
  };

  const openVesselEditor = async (id: string) => {
    invalidatePendingTaskOpen();
    const vessel = data.vessels.find(item => item.id === id);
    if (!vessel) return alert('找不到對應船舶');
    if(!canEditBusinessContent||!activeVessels.some(item=>item.id===vessel.id))return alert('目前身份無權編輯此船舶');
    const sectionKey=`vessel:${id}`;
    if (await claimEditingLock(sectionKey, `船舶｜${vesselDisplayName(vessel)}`)!=='owned')return;
    const snapshot=await refreshAfterItemLease(sectionKey);
    if(snapshot?.vessels.some(item=>item.id===id))setEditingVesselId(id);
  };
  const openTaskReadOnly = async (taskId:string, reason:string, requestGeneration:number, requestedVesselId='', requestConfig:ResolvedSupabaseConfig|null=null):Promise<TaskOpenResult> => {
    if(!currentUser)return 'failed';
    const requestAuthorizationEpoch=authorizationEpoch;
    const configToken=requestConfig?configIoCoordinator.current.begin(requestConfig):null;
    const capturedConfig=configToken?.config||null;
    const requestIsCurrent=()=>taskOpenRequests.current.isCurrent(requestGeneration)&&liveAuthorizationEpoch.current===requestAuthorizationEpoch&&(!configToken||configIoCoordinator.current.isCurrent(configToken,getSupabaseConfig()));
    blockedTaskCloudConfig.current=capturedConfig;
    let sourceData=data;
    if(configToken){
      setSensitiveCloudStatus('正在讀取伺服器上的最新事項資料…',`task:${taskId}`);
      try{
        const remote=await configIoCoordinator.current.run(configToken,getSupabaseConfig,fetchCloudData);
        if(!requestIsCurrent())return 'cancelled';
        if(!remote){clearBlockedTaskLock(taskId);alert('伺服器目前沒有可讀取的資料，無法開啟只讀詳情');return 'failed';}
        sourceData=remote;
      }catch(error:any){
        if(!requestIsCurrent())return 'cancelled';
        clearBlockedTaskLock(taskId);
        setSensitiveCloudStatus(`讀取伺服器最新事項失敗：${error.message||error}`,`task:${taskId}`);
        alert('無法讀取伺服器上的最新事項資料，請稍後再試');
        return 'failed';
      }
    }
    if(!requestIsCurrent())return 'cancelled';
    const snapshotUser=sourceData.users.find(user=>user.id===currentUser.id&&user.isActive);
    if(!snapshotUser){clearBlockedTaskLock(taskId);alert('目前身份已不存在或停用，無法查看此事項');return 'failed';}
    const snapshotCanViewAll=snapshotUser.role==='owner'||snapshotUser.role==='admin'||hasPermission(sourceData.settings.rolePermissions,snapshotUser,'viewAllVessels');
    const snapshotVessels=sourceData.vessels.filter(vessel=>vessel.isActive&&vesselMatchesUser(vessel,snapshotUser,snapshotCanViewAll));
    const snapshotVisibleVesselIds=snapshotVessels.map(vessel=>vessel.id);
    const snapshotTasks=selectTasksVisibleToUser(sourceData.tasks,snapshotUser,{internalControlCases:sourceData.internalControlCases,meetings:sourceData.meetings,visibleVesselIds:snapshotVisibleVesselIds});
    const snapshotTask=snapshotTasks.find(task=>task.id===taskId);
    if(!snapshotTask){clearBlockedTaskLock(taskId);alert('伺服器最新資料中已找不到此事項，或目前身份已無查看權限');return 'failed';}
    const visibleTaskVesselIds=taskVesselIds(snapshotTask).filter(id=>snapshotVisibleVesselIds.includes(id));
    const projectedVesselId=requestedVesselId&&visibleTaskVesselIds.includes(requestedVesselId)?requestedVesselId:visibleTaskVesselIds[0];
    if(!projectedVesselId){clearBlockedTaskLock(taskId);alert('此事項目前沒有可見船舶範圍');return 'failed';}
    let projectedData:TaskReadOnlyEditorData;
    try{projectedData=buildTaskReadOnlyEditorData(sourceData,snapshotTask,projectedVesselId);}
    catch(error:any){if(!requestIsCurrent())return 'cancelled';clearBlockedTaskLock(taskId);alert(error.message||'無法建立安全的只讀事項資料');return 'failed';}
    if(!requestIsCurrent())return 'cancelled';
    setTaskReadOnlyData(projectedData);
    setTaskReadOnlyReason(`${reason}${configToken?'｜已讀取伺服器最新資料':'｜本機只讀資料'}`);
    setTaskProgressVesselId('');
    setTaskEditorRequestGeneration(requestGeneration);
    setTaskEditorAuthorizationEpoch(requestAuthorizationEpoch);
    setEditingTaskId(taskId);
    setSensitiveCloudStatus(`${reason}，已開啟最小化只讀詳情`,`task:${taskId}`);
    return 'opened';
  };
  const openTaskEditor = async (task: TaskItem, vesselId:string, requestGeneration:number):Promise<TaskOpenResult> => {
    const requestIsCurrent=()=>taskOpenRequests.current.isCurrent(requestGeneration);
    const label = richTextToPlainText(task.description) || task.id;
    clearBlockedTaskLock();
    setTaskReadOnlyData(null);
    setTaskReadOnlyReason('');
    if(!taskLockIsAuthorized(task)) {
      if(activeEditLock&&!(await releaseCurrentEditLock())){if(requestIsCurrent())alert('上一個協作鎖尚未成功釋放，暫時無法開啟此事項');return requestIsCurrent()?'failed':'cancelled';}
      if(!requestIsCurrent())return 'cancelled';
      return openTaskReadOnly(task.id,'目前身份僅具只讀權限',requestGeneration,vesselId,null);
    }
    if(!authorizedEditLockKeys.has(`task:${task.id}`)){if(requestIsCurrent())alert('目前身份無權編輯此待辦');return requestIsCurrent()?'failed':'cancelled';}
    const claimResult=await claimEditingLock(`task:${task.id}`, `待辦｜${label.slice(0, 28)}`,requestIsCurrent,false);
    if(claimResult==='blocked'){
      const config=getSupabaseConfig();
      return openTaskReadOnly(task.id,'其他使用者正在編輯此事項',requestGeneration,vesselId,config);
    }
    if(claimResult==='owned'&&requestIsCurrent()) {
      const snapshot=await refreshAfterItemLease(`task:${task.id}`);
      if(!snapshot||!requestIsCurrent())return requestIsCurrent()?'failed':'cancelled';
      const latestTask=snapshot.tasks.find(item=>item.id===task.id);
      if(!latestTask)return 'failed';
      setTaskProgressVesselId(vesselId);
      setTaskEditorRequestGeneration(requestGeneration);
      setTaskEditorAuthorizationEpoch(authorizationEpoch);
      setEditingTaskId(task.id);
      return 'opened';
    }
    return requestIsCurrent()?'failed':'cancelled';
  };
  const openTask = async (task: TaskItem, vesselId = '', returnVesselId = ''):Promise<TaskOpenResult> => {
    const requestGeneration=taskOpenRequests.current.begin({vesselId:returnVesselId,batchManaged:false});
    const requestIsCurrent=()=>taskOpenRequests.current.isCurrent(requestGeneration);
    const visibleTask=roleVisibleTasks.find(item=>item.id===task.id);
    if(!visibleTask){if(requestIsCurrent())taskOpenRequests.current.clearIfCurrent(requestGeneration);alert('無權查看此待辦');return requestIsCurrent()?'failed':'cancelled';}
    if(vesselId&&(!taskVesselIds(visibleTask).includes(vesselId)||!activeVessels.some(vessel=>vessel.id===vesselId))){if(requestIsCurrent())taskOpenRequests.current.clearIfCurrent(requestGeneration);alert('無權更新此船舶進度');return requestIsCurrent()?'failed':'cancelled';}
    const result=await openTaskEditor(visibleTask,vesselId,requestGeneration);
    if(result!=='opened')taskOpenRequests.current.clearIfCurrent(requestGeneration);
    return result;
  };
  const openMeetingTaskFromMeetingPage = async (taskId:string):Promise<TaskOpenResult> => {
    const task=liveData.current.tasks.find(item=>item.id===taskId);
    if(!task){alert('找不到對應的會議待辦');return 'failed';}
    return openTask(task);
  };
  const addTaskForVessel = async (vesselId: string, returnToVessel = false, returnToBatchManaged = false):Promise<boolean> => {
    if (!requireLogin()) return false;
    if(getSupabaseConfig()&&cloudWriteBlocked){alert('雲端寫入已阻擋；請先使用「同步最新（安全合併）」處理本機與雲端差異，再新增要事。');return false;}
    if (!canCreateTasks) { alert('目前角色未獲授權新增要事'); return false; }
    if (!currentUser || !canUseVessel(currentUser, vesselId)) { alert('船舶帳戶只能新增本船待辦'); return false; }
    const vessel = data.vessels.find(item => item.id === vesselId);
    if (!vessel) { alert('找不到對應船舶'); return false; }
    invalidatePendingTaskOpen();
    const requestAuthorizationEpoch=authorizationEpoch;
    const requestGeneration=taskOpenRequests.current.begin({vesselId:returnToVessel?vesselId:'',batchManaged:returnToBatchManaged});
    const requestIsCurrent=()=>taskOpenRequests.current.isCurrent(requestGeneration)&&liveAuthorizationEpoch.current===requestAuthorizationEpoch;
    const id = uid('task');
    const creationLockKey=taskCreationLockKey(vesselId,id);
    const creationAuthorized=()=>{
      const snapshot=liveData.current;
      const actor=snapshot.users.find(user=>user.id===currentUser.id&&user.isActive);
      const target=snapshot.vessels.find(item=>item.id===vesselId&&item.isActive);
      return Boolean(actor&&target&&hasPermission(snapshot.settings.rolePermissions,actor,'createTasks')&&canUseVessel(actor,vesselId));
    };
    const lockResult=await claimEditingLock(creationLockKey,`新增要事｜${vesselDisplayName(vessel)}`,requestIsCurrent,false,creationAuthorized);
    if(lockResult!=='owned'){
      if(requestIsCurrent()){
        taskOpenRequests.current.clearIfCurrent(requestGeneration);
        if(lockResult==='blocked')alert(`此新增要事草稿正在由 ${activeEditLock?.lockedByName||'其他協作者'} 處理；請重新開一份草稿。`);
        else alert('目前無法確認這份新增要事草稿的協作鎖；請重新開啟後再試。');
      }
      return false;
    }
    if(!requestIsCurrent())return false;
    const refreshed=await refreshAfterItemLease(creationLockKey);
    if(!refreshed||!requestIsCurrent())return false;
    const live=refreshed;
    const liveUser=live.users.find(user=>user.id===currentUser.id&&user.isActive);
    const liveVessel=live.vessels.find(item=>item.id===vesselId&&item.isActive);
    if(!liveUser||!liveVessel||!hasPermission(live.settings.rolePermissions,liveUser,'createTasks')||!canUseVessel(liveUser,vesselId)){
      taskOpenRequests.current.clearIfCurrent(requestGeneration);
      await releaseCurrentEditLock();
      alert('身份、權限或船舶範圍已變更，未開啟新增要事。');
      return false;
    }
    setEditingTaskId('');
    setTaskProgressVesselId('');
    const assignedOwnerUserIds = liveVessel.assignedUserIds.filter(id => live.users.some(user => user.id === id && user.isActive && user.role !== 'vessel'));
    setTaskEditorRequestGeneration(requestGeneration);
    setTaskEditorAuthorizationEpoch(requestAuthorizationEpoch);
    setCreatingTask({ id, vesselId, priority:'中', isAware:false, isAbnormal:false, isInternalControl:false, sourceType:'morning', category:'', categories:[], description:'', status:'', expectedDate:'', reportDate:todayDate(), departments:[], ownerUserIds: liveUser.role==='vessel' ? [] : assignedOwnerUserIds, isClosed:false, createdBy:liveUser.id, updatedBy:liveUser.id, createdAt:nowIso(), updatedAt:nowIso(), statusLogs:[] });
    return true;
  };
  const runDurableRelatedMutation=async(sectionKey:string,label:string,apply:()=>boolean,additionalLockKeys:(snapshot:AppData)=>readonly string[]=()=>[]):Promise<boolean>=>{
    if(!requireMutationLease(sectionKey))return false;
    const config=getSupabaseConfig();
    if(!config)return apply();
    const actorId=currentUser.id;
    const actorName=currentUser.name;
    const expectedAuthorizationEpoch=authorizationEpoch;
    const sessionIsCurrent=()=>Boolean(
      liveCurrentUserId.current===actorId
      &&liveAuthorizationEpoch.current===expectedAuthorizationEpoch
      &&sameCloudConfig(getSupabaseConfig(),config)
      &&mutationLeaseIsOwned(sectionKey)
    );
    if(!await ensureCloudDurableBeforeLeaseRelease(sectionKey))return false;
    let planningRemote:AppData;
    let plannedLockKeys:string[];
    try{
      const base=confirmedCloudData.current;
      const remote=await fetchCloudData(config);
      if(!base||!remote)throw new Error('缺少可信雲端基線');
      if(!sessionIsCurrent())throw new StaleAsyncConfigError();
      assertRemoteExtendsDurableHistory(cloudIdentity(config),base,remote);
      if(!itemLeaseExistsInSnapshot(sectionKey,remote)||!itemLeaseIsAuthorizedInSnapshot(sectionKey,remote))throw new Error('主項目已不存在或最新權限已失效');
      planningRemote=remote;
      plannedLockKeys=[...new Set([
        ...relatedEntityLockKeysForSection(planningRemote,sectionKey),
        ...additionalLockKeys(planningRemote),
      ])].sort((left,right)=>left.localeCompare(right));
    }catch(error:any){
      alert(`無法安全規劃${label}的完整關聯鎖：${error.message||error}`);
      return false;
    }
    const requests=plannedLockKeys.filter(key=>key!==sectionKey).map(key=>({sectionKey:key,label:`${label}｜${key}`,leaseOwnerId:uid('related-lease')}));
    const releaseRequest=async(request:{sectionKey:string;leaseOwnerId:string})=>runCloudSaveQueueRpc('釋放關聯鎖',signal=>releaseEditLock(request.sectionKey,request.leaseOwnerId,config,signal),8_000);
    const result=await acquireEditLockBundle(
      requests,
      request=>runCloudSaveQueueRpc('取得關聯鎖',signal=>claimEditLock(request.sectionKey,request.leaseOwnerId,actorName,75,config,signal),8_000),
      releaseRequest,
      sessionIsCurrent,
    );
    if(result.status!=='owned'){
      if(result.status==='blocked')alert(`${result.label} 正在由 ${result.lockedByName} 編輯；${label}未執行。`);
      else alert(`無法安全取得${label}的全部關聯鎖；本次未執行。`);
      return false;
    }
    const guards=result.leases.map(lease=>({section_key:lease.sectionKey,locked_by:lease.leaseOwnerId}));
    guards.forEach(guard=>transientCloudBlockLockGuards.current.set(`${guard.section_key}|${guard.locked_by}`,{guard,config}));
    const clearGuards=()=>guards.forEach(guard=>transientCloudBlockLockGuards.current.delete(`${guard.section_key}|${guard.locked_by}`));
    let heartbeatStopped=false;
    let heartbeatFailure:unknown=null;
    let heartbeatInFlight:Promise<void>|null=null;
    const renewBundle=()=>{
      if(heartbeatStopped||heartbeatFailure||heartbeatInFlight||!result.leases.length)return;
      heartbeatInFlight=(async()=>{
        const outcomes=await Promise.allSettled(result.leases.map(async lease=>{
          if(!sessionIsCurrent())throw new StaleAsyncConfigError();
          const renewed=await runCloudSaveQueueRpc('關聯鎖續期',signal=>renewEditLock(lease.sectionKey,lease.leaseOwnerId,75,config,signal),8_000);
          if(!renewed.ok)throw new Error(`${lease.label} 的協作鎖已失效`);
        }));
        const rejected=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
        if(rejected)throw rejected.reason;
      })().catch(error=>{heartbeatFailure=error;}).finally(()=>{heartbeatInFlight=null;});
    };
    const heartbeatTimer=window.setInterval(renewBundle,25_000);
    const stopHeartbeat=async()=>{
      heartbeatStopped=true;
      window.clearInterval(heartbeatTimer);
      if(heartbeatInFlight)await heartbeatInFlight;
    };
    const assertBundleActive=()=>{
      if(!sessionIsCurrent())throw new StaleAsyncConfigError();
      if(heartbeatFailure)throw heartbeatFailure;
    };
    const releaseRelated=async()=>{
      await stopHeartbeat();
      const settled=await Promise.allSettled(result.leases.map(releaseRequest));
      clearGuards();
      return settled.every(outcome=>outcome.status==='fulfilled');
    };
    let applied=false;
    try{
      const base=confirmedCloudData.current;
      const remote=await fetchCloudData(config);
      if(!base||!remote)throw new Error('缺少可信雲端基線');
      assertBundleActive();
      assertRemoteExtendsDurableHistory(cloudIdentity(config),base,remote);
      const sameLockKeySet=(left:readonly string[],right:readonly string[])=>left.length===right.length&&left.every((key,index)=>key===right[index]);
      const refreshedLockKeys=[...new Set([
        ...relatedEntityLockKeysForSection(remote,sectionKey),
        ...additionalLockKeys(remote),
      ])].sort((left,right)=>left.localeCompare(right));
      if(!sameLockKeySet(refreshedLockKeys,plannedLockKeys))throw new Error('關聯資料在取得鎖期間已變更，請重新執行');
      if(!itemLeaseExistsInSnapshot(sectionKey,remote)||!itemLeaseIsAuthorizedInSnapshot(sectionKey,remote))throw new Error('主項目已不存在或最新權限已失效');
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(cloudIdentity(config),remote);
      liveData.current=remote;
      flushSync(()=>setData(remote));
      applied=apply();
      if(!applied){await releaseRelated();return false;}
      if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
      assertBundleActive();
      await enqueueCloudSave(liveData.current,sessionIsCurrent);
      assertBundleActive();
      if(!confirmedCloudData.current||!appDataContentEqual(liveData.current,confirmedCloudData.current))throw new Error('雲端尚未確認最新關聯修改');
      const released=await releaseRelated();
      if(!released)setCloudStatus(`${label}已保存，但部分關聯鎖將於租期屆滿後自動釋放`);
      return true;
    }catch(error:any){
      if(!applied)await releaseRelated();
      else{
        await stopHeartbeat();
        setSensitiveCloudStatus(`${label}尚未雲端確認；關聯鎖保持至租期屆滿：${error.message||error}`,sectionKey);
        window.setTimeout(clearGuards,80_000);
      }
      alert(`${label}未完成：${error.message||error}`);
      return false;
    }
  };
  const createInternalCases = async (items: InternalControlCase[], expectedRevision: number, projections: Record<string, InternalControlTaskProjection> = {}) => {
    const sectionKey=internalControlCreationLockKey(uid('internal-control-batch'));
    if(!await claimExclusiveItemLease(sectionKey,`批量新增內控異常｜${items.length} 件`))return false;
    let applied=false;
    let attempted=false;
    let failure='內控案件未保存：資料或權限已變更';
    const apply=()=>{
      attempted=true;
      flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'createTasks')){failure='目前身份無權新增內控案件';return prev;}
      if(prev.revision!==expectedRevision){failure='主資料已更新，請保留輸入內容並重新提交';return prev;}
      const caseVessels=items.map(item=>prev.vessels.find(vessel=>vessel.id===item.vesselId&&vessel.isActive));
      if(caseVessels.some(vessel=>!vessel)||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,caseVessels as Vessel[])){failure='必須具備全部所選船舶的權限';return prev;}
      if(items.some(item=>item.isClosed)&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份無權建立已結案案件';return prev;}
      const draft=clone(prev);
      try{createInternalControlCases(draft,items,liveUser,nowIso(),projections);}
      catch(error:any){failure=error.message||String(error);return prev;}
      applied=true;
      return withAudit(draft,liveUser,'批量新增內控異常','internal-control',items.map(item=>item.id).join(','),`新增 ${items.length} 件｜同步要事 ${items.filter(item=>item.syncToTask).length} 件`);
      }));
      return applied;
    };
    const durable=await runDurableRelatedMutation(sectionKey,'批量新增內控異常',apply);
    if(attempted&&!applied)alert(failure);
    if(durable)await releaseExclusiveItemLease(sectionKey);
    else if(!applied)await releaseExclusiveItemLease(sectionKey);
    return durable;
  };
  const saveInternalCase = async (candidate: InternalControlCase, expectedUpdatedAt: string, expectedRevision: number, projection?: InternalControlTaskProjection) => {
    if(!requireMutationLease(internalControlEditLockKey(candidate.id)))return false;
    let applied=false;
    let attempted=false;
    let failure='內控案件未保存：資料或權限已變更';
    const apply=()=>{
      attempted=true;
      flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')){failure='目前身份無權更新內控案件';return prev;}
      const previous=prev.internalControlCases.find(item=>item.id===candidate.id);
      if(!previous||prev.internalControlCases.filter(item=>item.id===candidate.id).length!==1){failure='內控案件不存在或識別碼重複';return prev;}
      if(prev.revision!==expectedRevision||previous.updatedAt!==expectedUpdatedAt){failure='案件已由其他人更新，請重新開啟後再保存';return prev;}
      const scopeVessels=[previous.vesselId,candidate.vesselId].map(id=>prev.vessels.find(vessel=>vessel.id===id&&vessel.isActive));
      if(scopeVessels.some(vessel=>!vessel)||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,scopeVessels as Vessel[])){failure='必須具備原船舶與新船舶的完整權限';return prev;}
      if(!previous.syncToTask&&candidate.syncToTask&&!hasPermission(prev.settings.rolePermissions,liveUser,'createTasks')){failure='目前身份無權建立同步要事';return prev;}
      if(candidate.isClosed!==previous.isClosed&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份無權結案或重新開啟內控案件';return prev;}
      const draft=clone(prev);
      try{updateInternalControlCase(draft,candidate,expectedUpdatedAt,liveUser,nowIso(),projection);}
      catch(error:any){failure=error.message||String(error);return prev;}
      applied=true;
      return withAudit(draft,liveUser,candidate.isClosed&&!previous.isClosed?'結案內控異常':!candidate.isClosed&&previous.isClosed?'重新開啟內控異常':'更新內控異常','internal-control',candidate.id,richTextToPlainText(candidate.description)||candidate.id);
      }));
      return applied;
    };
    const durable=await runDurableRelatedMutation(internalControlEditLockKey(candidate.id),'內控案件保存',apply);
    if(attempted&&!applied)alert(failure);
    return durable;
  };
  const withdrawInternalCaseTaskSync = async (candidate: InternalControlCase, expectedTaskUpdatedAt: string, expectedRevision: number) => {
    if(!requireMutationLease(internalControlEditLockKey(candidate.id)))return false;
    let applied=false;
    let attempted=false;
    let failure='同步要事未撤回：資料、關聯或權限已變更';
    const apply=()=>{
      attempted=true;
      flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')){failure='目前身份無權撤回內控案件的同步要事';return prev;}
      const matchingCases=prev.internalControlCases.filter(item=>item.id===candidate.id);
      if(matchingCases.length!==1){failure='內控案件不存在或識別碼重複';return prev;}
      const previous=matchingCases[0];
      if(previous.linkedTaskId!==candidate.linkedTaskId){failure='同步關聯已變更，請重新開啟後再試';return prev;}
      const matchingTasks=previous.linkedTaskId?prev.tasks.filter(task=>task.id===previous.linkedTaskId):[];
      if(matchingTasks.length!==1){failure='關聯要事不存在或識別碼重複';return prev;}
      const linkedTask=matchingTasks[0];
      if(prev.revision!==expectedRevision||previous.updatedAt!==candidate.updatedAt||linkedTask.updatedAt!==expectedTaskUpdatedAt){failure='案件或關聯要事已由其他人更新，請重新開啟後再試';return prev;}
      const vessel=prev.vessels.find(item=>item.id===previous.vesselId&&item.isActive);
      if(!vessel||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,[vessel])){failure='目前身份無權撤回此船舶的同步要事';return prev;}
      const draft=clone(prev);
      let result:{caseId:string;taskId:string};
      try{result=withdrawInternalControlTaskSync(draft,candidate.id,candidate.updatedAt,expectedTaskUpdatedAt,liveUser,nowIso());}
      catch(error:any){failure=error.message||String(error);return prev;}
      applied=true;
      return withAudit(draft,liveUser,'撤回同步要事','internal-control',result.caseId,`撤回同步要事 ${result.taskId}；內控案件保持未結案`);
      }));
      return applied;
    };
    const durable=await runDurableRelatedMutation(internalControlEditLockKey(candidate.id),'撤回同步要事',apply);
    if(attempted&&!applied)alert(failure);
    else if(durable)alert('同步要事已撤回；內控案件與既有早會歷史已保留。重新同步時會建立新的要事。');
    else if(applied)alert('撤回尚未取得雲端確認，編輯器保持開啟；請勿重複操作，系統會繼續查證。');
    return durable;
  };
  const removeInternalCase = async (candidate: InternalControlCase, expectedRevision: number) => {
    if(!requireMutationLease(internalControlEditLockKey(candidate.id)))return false;
    let applied=false;
    let attempted=false;
    let failure='內控案件未刪除：資料或權限已變更';
    const apply=()=>{
      attempted=true;
      flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)){failure='目前身份無權刪除內控案件';return prev;}
      const previous=prev.internalControlCases.find(item=>item.id===candidate.id);
      const vessel=previous&&prev.vessels.find(item=>item.id===previous.vesselId&&item.isActive);
      if(!previous||prev.internalControlCases.filter(item=>item.id===candidate.id).length!==1||!vessel){failure='內控案件或船舶不存在';return prev;}
      if(prev.revision!==expectedRevision||previous.updatedAt!==candidate.updatedAt){failure='案件已由其他人更新，請重新開啟後再刪除';return prev;}
      if(!canAccessAllVessels(prev.settings.rolePermissions,liveUser,[vessel])){failure='目前身份無權刪除此船舶的內控案件';return prev;}
      if(!internalControlDeletionAuthorized({
        deleteTasks:hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')&&canDeleteTask(liveUser),
        closeTasks:hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks'),
        scopeCancellationAuthorized:canCancelInternalControl(liveUser,vessel),
      })){failure='刪除內控案件需同時具備刪除、結案及此船舶的取消內控權限';return prev;}
      const draft=clone(prev);
      try{deleteInternalControlCase(draft,candidate.id,candidate.updatedAt);}
      catch(error:any){failure=error.message||String(error);return prev;}
      applied=true;
      return withAudit(draft,liveUser,'刪除內控異常','internal-control',candidate.id,richTextToPlainText(candidate.description)||candidate.id);
      }));
      return applied;
    };
    const durable=await runDurableRelatedMutation(internalControlEditLockKey(candidate.id),'內控案件刪除',apply);
    if(attempted&&!applied)alert(failure);
    return durable;
  };
  const captureCreationDraft=(draft:TaskItem)=>{
    const lock=activeEditLock;
    if(!creatingTask||creatingTask.id!==draft.id||editingTask?.id!==draft.id||!taskOpenRequests.current.isCurrent(taskEditorRequestGeneration))return;
    if(!lock||lock.status!=='owned'||lock.ownerUserId!==currentUser.id||lock.authorizationEpoch!==authorizationEpoch||lock.sectionKey!==taskCreationLockKey(draft.vesselId,draft.id))return;
    latestCreationDrafts.current.set(draft.id,{leaseOwnerId:lock.leaseOwnerId,task:clone(draft)});
  };
  const saveTask = async (candidate: TaskItem, creating: boolean, expectedUpdatedAt: string, expectedRevision: number, pendingRun?:PendingCreationRunContext) => {
    if(creating&&!pendingRun&&activeEditLock?.sectionKey===taskCreationLockKey(candidate.vesselId,candidate.id)&&activeEditLock.ownerUserId===currentUser.id)latestCreationDrafts.current.set(candidate.id,{leaseOwnerId:activeEditLock.leaseOwnerId,task:clone(candidate)});
    if(creating&&pendingRun&&!pendingRun.isCurrent())return false;
    if(creating&&!pendingRun&&!requireMutationLease(taskCreationLockKey(candidate.vesselId,candidate.id)))return false;
    if(!creating&&!requireMutationLease(`task:${candidate.id}`))return false;
    let applied=false;
    let failure='事項已變更或權限已更新，請重新整理後再試';
    const applyTaskSave=(prev:AppData):AppData=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser){failure='登入身份已失效，請重新登入';return prev;}
      const scopeIds=taskVesselIds(candidate);
      const scopeVessels=taskVessels(candidate,prev.vessels);
      const vessel=scopeVessels[0];
      if(!vessel||scopeVessels.length!==scopeIds.length||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,scopeVessels)){
        failure='必須具備全部涉船範圍權限才能保存此事項';return prev;
      }
      if(creating&&!hasPermission(prev.settings.rolePermissions,liveUser,'createTasks')){failure='目前角色未獲授權新增要事';return prev;}
      if(creating&&!canUseVessel(liveUser,candidate.vesselId)){failure='船舶帳戶只能新增本船待辦';return prev;}
      if(creating&&candidate.isInternalControl&&liveUser.role==='vessel'){failure='船舶帳戶無權建立內部管控案件';return prev;}
      if(!creating&&(!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')||liveUser.role==='vessel')){failure='船舶帳戶新增後不可修改既有待辦';return prev;}
      const matchingTasks=prev.tasks.filter(item=>item.id===candidate.id);
      if(matchingTasks.length>1){failure='待辦識別碼重複，為避免覆蓋錯誤資料，本次未保存';return prev;}
      if(creating&&matchingTasks.length){failure='事項識別碼已存在，請重新建立';return prev;}
      const previous=creating?{...candidate,isInternalControl:false}:matchingTasks[0];
      if(!previous){failure='事項已被刪除或不存在，未保存任何變更';return prev;}
      if(creating&&(candidate.sourceMeetingId||candidate.sourceMeetingItemId||candidate.sourceType==='temporary'||candidate.attentionDimension==='meeting')){failure='普通待辦保存路徑不得建立或偽造臨會/專題語意或關聯';return prev;}
      if(creating&&candidate.isClosed&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份無權建立已結案待辦';return prev;}
      if(creating&&!candidate.isClosed&&(candidate.closedDate||candidate.closedBy)){failure='未結案的新待辦不得夾帶結案資料';return prev;}
      if(!creating&&(candidate.sourceMeetingId!==previous.sourceMeetingId||candidate.sourceMeetingItemId!==previous.sourceMeetingItemId||candidate.sourceType!==previous.sourceType)){failure='待辦來源關聯不可由普通待辦保存路徑修改';return prev;}
      if(!creating&&(candidate.vesselScopeMode!==previous.vesselScopeMode||JSON.stringify(candidate.vesselTypeScopes||[])!==JSON.stringify(previous.vesselTypeScopes||[]))){failure='待辦涉船範圍模式只能由權威建立或臨會對帳流程更新';return prev;}
      if(!creating&&(candidate.createdBy!==previous.createdBy||candidate.createdAt!==previous.createdAt||candidate.internalControlCancelledAt!==previous.internalControlCancelledAt||candidate.internalControlCancelledBy!==previous.internalControlCancelledBy||candidate.internalControlCaseId!==previous.internalControlCaseId)){failure='待辦建立者、建立時間、內控關聯與內控取消來源資料不可由普通保存改寫';return prev;}
      if(!creating&&!meetingTaskLinkIsValidForMutation(previous,prev.meetings)){failure='會議來源關聯缺失、失效或與父會議狀態不一致，請先由臨會/專題頁安全修復';return prev;}
      const meetingLifecycleChanged=!creating&&Boolean(previous.sourceMeetingId)&&candidate.isClosed!==previous.isClosed;
      if(meetingLifecycleChanged&&(!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')||!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser))){failure='目前身份需同時具備管理會議與結案待辦權限';return prev;}
      const previousScopeIdsForClosure=taskVesselIds(previous);
      const candidateScopeIdsForClosure=taskVesselIds(candidate);
      const previousSemanticallyClosed=!creating&&taskIsClosedForScope(previous,previousScopeIdsForClosure);
      const sameScopeForClosedHistory=previousScopeIdsForClosure.length===candidateScopeIdsForClosure.length&&previousScopeIdsForClosure.every(id=>candidateScopeIdsForClosure.includes(id));
      if(previousSemanticallyClosed&&!sameScopeForClosedHistory){failure='已結案待辦的歷史涉船範圍不可由普通保存改寫；請先以有權限的結案流程重新開啟';return prev;}
      if(!creating&&(candidate.distributeToVessels!==previous.distributeToVessels||JSON.stringify(candidate.vesselProgress||[])!==JSON.stringify(previous.vesselProgress||[]))){failure='分船模式與分船進度只能由臨會對帳或單船進度流程更新，不得由普通待辦保存覆蓋';return prev;}
      if(!creating&&usesPerVesselProgress(previous)&&candidate.isClosed!==previous.isClosed){failure='分船待辦的頂層結案狀態不可由普通待辦保存改寫';return prev;}
      if(!creating&&candidate.isClosed!==previous.isClosed&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份無權結案或重新開啟待辦';return prev;}
      if(!creating&&previous.isInternalControl&&!candidate.isInternalControl&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='取消內部管控會結束同步並結案，需具備結案權限';return prev;}
      if(!creating&&!previous.isInternalControl&&candidate.isInternalControl&&!hasPermission(prev.settings.rolePermissions,liveUser,'createTasks')){failure='將既有待辦轉為內部管控會建立案件，需具備新增要事權限';return prev;}
      if(!creating&&previousSemanticallyClosed&&(usesPerVesselProgress(previous)||candidate.isClosed)&&(candidate.status!==previous.status||candidate.closedDate!==previous.closedDate||candidate.closedBy!==previous.closedBy||JSON.stringify(candidate.statusLogs||[])!==JSON.stringify(previous.statusLogs||[]))){failure='已結案待辦的狀態、結案資料及歷程不可由普通保存改寫';return prev;}
      if(!creating&&!statusLogsAppendOnly(candidate.statusLogs,previous.statusLogs)){failure='待辦狀態歷程只能附加，不得刪除、改寫或偽造既有紀錄';return prev;}
      if(!creating&&!getSupabaseConfig()&&prev.revision!==expectedRevision){failure='主資料版本已更新，為避免覆蓋其他操作，本次未保存；請關閉後重新開啟事項';return prev;}
      if(!creating&&previous.updatedAt!==expectedUpdatedAt){failure='事項已由其他操作更新，為避免覆蓋最新內容，本次未保存';return prev;}
      const previousVessels=creating?[]:taskVessels(previous,prev.vessels);
      if(!creating&&(previousVessels.length!==taskVesselIds(previous).length||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,previousVessels))){failure='必須同時具備原涉船與新涉船範圍權限才能更新事項';return prev;}

      const saveAt=nowIso();
      const boundaryCandidate=clone(candidate);
      boundaryCandidate.updatedBy=liveUser.id;
      boundaryCandidate.updatedAt=saveAt;
      if(creating&&!boundaryCandidate.status.trim())boundaryCandidate.status='待處理';
      let submittedStatusLogs=creating&&!candidate.statusLogs.length?[{id:'',at:'',by:'',text:boundaryCandidate.status}]:candidate.statusLogs;
      if(!creating&&boundaryCandidate.status!==previous.status&&candidate.statusLogs.length===previous.statusLogs.length)submittedStatusLogs=[{id:'',at:'',by:'',text:boundaryCandidate.status},...candidate.statusLogs];
      boundaryCandidate.statusLogs=trustedStatusLogs(submittedStatusLogs,creating?[]:previous.statusLogs,liveUser,saveAt);
      const newStatusLogCount=boundaryCandidate.statusLogs.length-(creating?0:previous.statusLogs.length);
      if(!creating&&boundaryCandidate.status!==previous.status&&newStatusLogCount<1){failure='狀態變更必須新增相符歷程';return prev;}
      if(newStatusLogCount>0&&boundaryCandidate.statusLogs[0]?.text.trim()!==boundaryCandidate.status.trim()){failure='最新狀態必須與新增歷程一致';return prev;}
      if(creating){
        boundaryCandidate.sourceType='morning';
        boundaryCandidate.attentionDimension='task';
        boundaryCandidate.distributeToVessels=false;
        boundaryCandidate.vesselProgress=[];
        boundaryCandidate.vesselScopeMode='vessels';
        boundaryCandidate.vesselTypeScopes=[];
        boundaryCandidate.createdBy=liveUser.id;
        boundaryCandidate.createdAt=saveAt;
        delete boundaryCandidate.sourceMeetingId;
        delete boundaryCandidate.sourceMeetingItemId;
        delete boundaryCandidate.internalControlCaseId;
        delete boundaryCandidate.internalControlCancelledAt;
        delete boundaryCandidate.internalControlCancelledBy;
      }else{
        boundaryCandidate.createdBy=previous.createdBy;
        boundaryCandidate.createdAt=previous.createdAt;
        boundaryCandidate.internalControlCancelledAt=previous.internalControlCancelledAt;
        boundaryCandidate.internalControlCancelledBy=previous.internalControlCancelledBy;
      }
      if(boundaryCandidate.isClosed){
        if(creating||!previous.isClosed){boundaryCandidate.closedDate=trustedClosureDate(boundaryCandidate.closedDate,todayDate());boundaryCandidate.closedBy=liveUser.id;}
      }else if(!creating&&previousSemanticallyClosed&&usesPerVesselProgress(previous)){
        boundaryCandidate.closedDate=previous.closedDate;
        boundaryCandidate.closedBy=previous.closedBy;
      }else{
        delete boundaryCandidate.closedDate;
        delete boundaryCandidate.closedBy;
      }
      const normalizedCategories=isMeetingTaskSource(boundaryCandidate)
        ? normalizeMeetingTaskCategoryList(boundaryCandidate.categories || boundaryCandidate.category, prev.settings.meetingTaskCategories)
        : normalizeTaskCategoryList(boundaryCandidate.category,boundaryCandidate.categories);
      const linkedMeeting=previous.sourceMeetingId?prev.meetings.find(meeting=>meeting.id===previous.sourceMeetingId):undefined;
      const linkedMeetingItem=linkedMeeting?.taskItems.find(item=>item.id===previous.sourceMeetingItemId);
      const linkedMeetingPriority=linkedMeeting?.priority;
      if(meetingLifecycleChanged&&!candidate.isClosed&&linkedMeeting?.status==='已完成'){failure='請先重新開啟整場會議，再重新開啟其中的待辦';return prev;}
      const normalizedCandidate=canonicalTaskAttentionForSave({...boundaryCandidate,categories:normalizedCategories,category:normalizedCategories[0]||''},previous,linkedMeetingPriority);
      if(linkedMeeting){
        if(!linkedMeetingItem||normalizedCandidate.distributeToVessels!==(linkedMeetingItem.distributeToVessels===true)){failure='臨會/專題關聯待辦的分船模式必須從臨會/專題頁統一調整';return prev;}
        const linkedScopeIds=new Set(linkedMeeting.vessels);
        const requestedScopeIds=taskVesselIds(normalizedCandidate);
        const scopeMatchesMeeting=requestedScopeIds.length===linkedScopeIds.size&&requestedScopeIds.every(id=>linkedScopeIds.has(id));
        if(!scopeMatchesMeeting||normalizedCandidate.isInternalControl!==linkedMeeting.isInternalControl){failure='臨會/專題關聯待辦的涉船範圍與內部管控必須從臨會/專題頁統一調整';return prev;}
      }
      const nextScopeIds=new Set(taskVesselIds(normalizedCandidate));
      const taskInternalControlTransition=internalControlTransitionRequested(previous,normalizedCandidate);
      const previousScopeIds=new Set(taskVesselIds(previous));
      const meetingInternalControlTransition=Boolean(linkedMeeting?.isInternalControl&&(
        !normalizedCandidate.isInternalControl||linkedMeeting.vessels.some(id=>previousScopeIds.has(id)&&!nextScopeIds.has(id))
      ));
      const internalControlTransition=taskInternalControlTransition||meetingInternalControlTransition;
      const protectedSources=[
        ...(previous.isInternalControl?[taskVesselIds(previous)]:[]),
        ...(linkedMeeting?.isInternalControl?[linkedMeeting.vessels]:[]),
      ];
      const protectedSourcesInvalid=protectedSources.some(ids=>!ids.length||ids.some(id=>!prev.vessels.some(vessel=>vessel.id===id)));
      const protectedVesselIds=new Set(protectedSources.flat());
      const protectedVessels=prev.vessels.filter(vessel=>protectedVesselIds.has(vessel.id));
      if(internalControlTransition&&(protectedSourcesInvalid||!protectedVessels.length||protectedVessels.length!==protectedVesselIds.size||!protectedVessels.every(item=>canCancelInternalControl(liveUser,item)))){failure='目前帳戶無權取消全部原有涉船範圍的內部管控';return prev;}
      let saved:TaskItem;
      try{saved=validateInternalControlTransition(previous,normalizedCandidate,liveUser,creating?scopeVessels:previousVessels);}
      catch(error:any){failure=error.message||String(error);return prev;}
      const cancelled=internalControlTransition;
      if(cancelled){
        if(!saved.internalControlCancelledAt){saved.internalControlCancelledAt=nowIso();saved.internalControlCancelledBy=liveUser.id;}
        const removedVesselIds=Array.from(protectedVesselIds).filter(id=>!taskVesselIds(saved).includes(id));
        saved.status=saved.isInternalControl?`取消部分涉船內部管控：${removedVesselIds.join('、')}`:'取消內部管控';
        saved.statusLogs=[{id:uid('log'),at:nowIso(),by:liveUser.name,byUserId:liveUser.id,text:saved.status},...saved.statusLogs];
      }
      let syncedMeeting:TemporaryMeeting|undefined;
      if(linkedMeeting&&meetingLifecycleChanged){
        try{syncedMeeting=synchronizeLinkedMeetingDecisionLifecycle(linkedMeeting,saved,{actorId:liveUser.id,actorName:liveUser.name,at:saveAt,closedDate:trustedClosureDate(saved.closedDate,todayDate())});}
        catch(error:any){failure=error.message||String(error);return prev;}
      }
      const savedScopeIds=taskVesselIds(saved);
      const savedScopeVessels=taskVessels(saved,prev.vessels);
      if(!savedScopeVessels.length||savedScopeVessels.length!==savedScopeIds.length||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,savedScopeVessels)){failure='最終涉船範圍不存在或目前身份無權保存';return prev;}
      if(saved.ownerUserIds.some(id=>!isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),savedScopeVessels))){failure='負責人已停用或不具備最終涉船範圍權限，請重新選擇';return prev;}
      const kind=creating?'task_created':cancelled?'internal_control_cancelled':'task_updated';
      const previousNoticeVessels=creating?[]:cancelled?protectedVessels:taskVessels(previous,prev.vessels);
      const previousNoticeTask=creating?null:{
        ...previous,
        ownerUserIds:previous.ownerUserIds.filter(id=>isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),previousNoticeVessels)),
      };
      const notices=buildTaskScopeChangeNotifications(
        prev.users,
        previousNoticeTask?{task:previousNoticeTask,vessels:previousNoticeVessels}:null,
        {task:saved,vessels:savedScopeVessels},
        liveUser.id,kind,liveUser.name,prev.settings.rolePermissions,
      );
      const draft=clone(prev);
      const previousAssigneeIds=creating?[]:prev.users.filter(user=>user.isActive&&taskBelongsToUserWorkCenter(previous,user,prev.vessels,prev.meetings)).map(user=>user.id);
      const nextAssigneeIds=prev.users.filter(user=>user.isActive&&taskBelongsToUserWorkCenter(saved,user,prev.vessels,prev.meetings)).map(user=>user.id);
      if(creating)draft.tasks.unshift(saved);
      else{
        const index=draft.tasks.findIndex(item=>item.id===saved.id);
        if(index<0){failure='事項已被刪除或不存在，未保存任何變更';return prev;}
        draft.tasks[index]=saved;
      }
      if(syncedMeeting){
        const meetingIndex=draft.meetings.findIndex(meeting=>meeting.id===syncedMeeting!.id);
        if(meetingIndex<0){failure='父會議不存在，未保存任何變更';return prev;}
        draft.meetings[meetingIndex]=syncedMeeting;
        if(!meetingDecisionLifecycleIsConsistent(syncedMeeting,draft.tasks,saved.id)){failure='父會議與關聯待辦狀態同步未完成';return prev;}
      }
      draft.taskDismissals=clearDismissalsForNewTaskAssignments(draft.taskDismissals,creating?undefined:previous,saved,previousAssigneeIds,nextAssigneeIds);
      try{reconcileInternalControlAfterTaskSave(draft,creating?undefined:previous,saved,liveUser,saveAt);}
      catch(error:any){failure=error.message||String(error);return prev;}
      draft.vessels.filter(item=>taskHasVessel(saved,item.id)).forEach(targetVessel=>{targetVessel.weeklyAttention=mergeAttentionFromCategories(targetVessel.weeklyAttention,saved.categories);});
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      let audited=withAudit(draft,liveUser,creating?'新增事項':cancelled?'取消內部管控':'更新事項','task',saved.id,cancelled?'已提醒至 FLOW 系統申報異常':creating?'建立跟進事項':'保存事項變更');
      if(syncedMeeting)audited=withAudit(audited,liveUser,saved.isClosed?'同步完成會議決議待辦':'同步重新開啟會議決議待辦','meeting',syncedMeeting.id,richTextToPlainText(saved.description)||saved.id);
      applied=true;
      return audited;
    };
    if(creating&&getSupabaseConfig()){
      const creationSectionKey=taskCreationLockKey(candidate.vesselId,candidate.id);
      const creationLock=pendingRun?.creationLock||activeEditLock;
      if(!creationLock){setCloudStatus('新增要事協作鎖遺失；本次未保存');return false;}
      const capturedCreationLease=leaseCloudConfigs.current.get(creationLock.leaseOwnerId);
      if(!pendingRun&&(!capturedCreationLease||capturedCreationLease.sectionKey!==creationSectionKey)){setCloudStatus('新增要事協作鎖的原始雲端設定遺失；本次未保存');return false;}
      const capturedCreationConfig=pendingRun?.config||capturedCreationLease!.config;
      const capturedIdentitySessionGeneration=identitySessionGeneration.current;
      const capturedCreationRequestGeneration=taskEditorRequestGeneration;
      latestCreationDrafts.current.set(candidate.id,{leaseOwnerId:creationLock.leaseOwnerId,task:clone(candidate)});
      const creationIsCurrent=()=>{
        if(pendingRun)return pendingRun.isCurrent();
        const record=creationLock?leaseCloudConfigs.current.get(creationLock.leaseOwnerId):undefined;
        return Boolean(
          creationLock&&editLockAllowsMutation(
            creationLock,
            creationSectionKey,
            liveCurrentUserId.current,
            liveAuthorizationEpoch.current,
            lockCoordinator.current.isCurrent(creationLock.generation),
            Boolean(record&&record.sectionKey===creationSectionKey&&sameCloudConfig(getSupabaseConfig(),record.config)),
          )&&identitySessionGeneration.current===capturedIdentitySessionGeneration&&taskOpenRequests.current.isCurrent(capturedCreationRequestGeneration)
        );
      };
      const creationFlow=(async()=>{
        let creationMutationApplied=false;
        let releaseCreationVesselLocks=async()=>true;
        let retainCreationVesselLocksUntilExpiry=async()=>{};
        try{
        if(cloudSaveInFlight.current)await cloudSaveInFlight.current;
        if(!creationIsCurrent())throw new StaleAsyncConfigError();
        if(liveData.current.revision>lastCloudRevision.current)await enqueueCloudSave(liveData.current,creationIsCurrent);
        if(!creationIsCurrent())throw new StaleAsyncConfigError();
        const vesselRequests=taskCreationRelatedLockKeys(taskVesselIds(candidate),candidate,isMeetingTaskSource(candidate)).map(sectionKey=>({sectionKey,label:sectionKey.startsWith('vessel:')?`新增要事關聯船舶｜${sectionKey.slice('vessel:'.length)}`:`新增要事關聯內控｜${candidate.id}`,leaseOwnerId:uid('task-create-related-lease')}));
        const releaseVesselRequest=async(request:{sectionKey:string;leaseOwnerId:string})=>runCloudSaveQueueRpc('釋放新增要事關聯船舶鎖',signal=>releaseEditLock(request.sectionKey,request.leaseOwnerId,capturedCreationConfig,signal),8_000);
        const vesselBundle=await acquireEditLockBundle(
          vesselRequests,
          request=>runCloudSaveQueueRpc('取得新增要事關聯船舶鎖',signal=>claimEditLock(request.sectionKey,request.leaseOwnerId,currentUser.name,75,capturedCreationConfig,signal),8_000),
          releaseVesselRequest,
          creationIsCurrent,
        );
        if(vesselBundle.status!=='owned'){
          const waitingDetail=vesselBundle.status==='blocked'
            ? `${vesselBundle.lockedByName||'其他人'} 正在更新相關船舶`
            : '目前無法安全取得新增要事所需的全部船舶鎖';
          if(pendingRun){setCloudStatus(`新增要事仍在等待雲端保存｜${waitingDetail}`);return false;}
          try{
            const queuedAt=nowIso();
            const queuedWorkspaceIdentity=cloudIdentity(capturedCreationConfig);
            const intent=await upsertPendingTaskCreationForTask(window.localStorage,queuedWorkspaceIdentity,currentUser.id,candidate.id,existingIntent=>{
              if(!creationIsCurrent()||localStorage.getItem(CURRENT_USER_KEY)!==currentUser.id||!sameCloudConfig(getSupabaseConfig(),capturedCreationConfig))throw new StaleAsyncConfigError();
              return existingIntent
                ? markPendingTaskCreationWaiting(
                    replacePendingTaskCreationTask(existingIntent,(existingIntent.task.statusLogs||[]).length?existingIntent.task:clone(candidate),queuedAt),
                    waitingDetail,
                    queuedAt,
                    0,
                  )
                : createPendingTaskCreationIntent({
                    intentId:uid('task-create-intent'),
                    workspaceIdentity:queuedWorkspaceIdentity,
                    userId:currentUser.id,
                    task:clone(candidate),
                    primaryVesselId:candidate.vesselId,
                    vesselIds:taskVesselIds(candidate),
                    baseRevision:Math.max(0,lastCloudRevision.current),
                  },queuedAt);
            });
            refreshPendingTaskCreations();
            hasUnsavedWork.current=true;
            setSavePhase('queued');
            setCloudStatus(`新增要事正在等待雲端保存｜${waitingDetail}`);
            showSaveToast('warning','新增要事正在等待雲端保存','草稿已保存在這個瀏覽器。系統會自動重試；看到「已保存到雲端」前請不要關閉頁面。',12_000);
            return true;
          }catch(error:any){
            alert(`無法把新增要事安全保存在這個瀏覽器：${error.message||error}。編輯視窗會保持開啟，請勿關閉頁面。`);
            return false;
          }
        }
        const vesselGuards=vesselBundle.leases.map(lease=>({section_key:lease.sectionKey,locked_by:lease.leaseOwnerId}));
        vesselGuards.forEach(guard=>transientCloudBlockLockGuards.current.set(`${guard.section_key}|${guard.locked_by}`,{guard,config:capturedCreationConfig}));
        const clearVesselGuards=()=>vesselGuards.forEach(guard=>transientCloudBlockLockGuards.current.delete(`${guard.section_key}|${guard.locked_by}`));
        let vesselHeartbeatStopped=false;
        let vesselHeartbeatFailure:unknown=null;
        let vesselHeartbeatInFlight:Promise<void>|null=null;
        const renewVesselBundle=()=>{
          if(vesselHeartbeatStopped||vesselHeartbeatFailure||vesselHeartbeatInFlight||!vesselBundle.leases.length)return;
          vesselHeartbeatInFlight=(async()=>{
            const outcomes=await Promise.allSettled(vesselBundle.leases.map(async lease=>{
              if(!creationIsCurrent())throw new StaleAsyncConfigError();
              const renewed=await runCloudSaveQueueRpc('新增要事關聯船舶鎖續期',signal=>renewEditLock(lease.sectionKey,lease.leaseOwnerId,75,capturedCreationConfig,signal),8_000);
              if(!renewed.ok)throw new Error(`${lease.label} 的協作鎖已失效`);
            }));
            const rejected=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
            if(rejected)throw rejected.reason;
          })().catch(error=>{vesselHeartbeatFailure=error;}).finally(()=>{vesselHeartbeatInFlight=null;});
        };
        const vesselHeartbeatTimer=window.setInterval(renewVesselBundle,25_000);
        const stopVesselHeartbeat=async()=>{
          vesselHeartbeatStopped=true;
          window.clearInterval(vesselHeartbeatTimer);
          if(vesselHeartbeatInFlight)await vesselHeartbeatInFlight;
        };
        const assertVesselBundleActive=()=>{
          if(!creationIsCurrent())throw new StaleAsyncConfigError();
          if(vesselHeartbeatFailure)throw vesselHeartbeatFailure;
        };
        releaseCreationVesselLocks=async()=>{
          await stopVesselHeartbeat();
          const settled=await Promise.allSettled(vesselBundle.leases.map(releaseVesselRequest));
          clearVesselGuards();
          return settled.every(outcome=>outcome.status==='fulfilled');
        };
        retainCreationVesselLocksUntilExpiry=async()=>{
          await stopVesselHeartbeat();
          window.setTimeout(clearVesselGuards,80_000);
        };
        const confirmedBeforeCreation=confirmedCloudData.current;
        const creationBase=await fetchCloudData(capturedCreationConfig);
        if(!confirmedBeforeCreation||!creationBase)throw new CloudRebaseConflictError(['缺少可信的新增要事雲端基線']);
        assertVesselBundleActive();
        assertRemoteExtendsDurableHistory(cloudIdentity(capturedCreationConfig),confirmedBeforeCreation,creationBase);
        lastCloudRevision.current=creationBase.revision;
        confirmCloudSnapshot(cloudIdentity(capturedCreationConfig),creationBase);
        liveData.current=creationBase;
        flushSync(()=>setData(creationBase));
        pendingRun?.adoptRemoteBase(creationBase);
        const snapshot=applyTaskSave(creationBase);
        creationMutationApplied=applied;
        if(pendingRun)pendingRun.mutationApplied=applied;
        if(!applied){await releaseCreationVesselLocks();if(!pendingRun)alert(failure);else setCloudStatus(`待同步新增要事無法保存｜${failure}`);return false;}
        assertVesselBundleActive();
        const submittedCreationTask=snapshot.tasks.find(task=>task.id===candidate.id);
        if(!submittedCreationTask)throw new Error('新增要事snapshot缺少穩定識別');
        const existingAttempt=creationAttempts.current.get(candidate.id);
        if(existingAttempt&&existingAttempt.leaseOwnerId===creationLock.leaseOwnerId)Object.assign(submittedCreationTask,withStableCreationAttemptProvenance(existingAttempt.task,submittedCreationTask));
        creationAttempts.current.set(candidate.id,{leaseOwnerId:creationLock.leaseOwnerId,task:clone(submittedCreationTask)});
        latestCreationDrafts.current.set(candidate.id,{leaseOwnerId:creationLock.leaseOwnerId,task:clone(submittedCreationTask)});
        if(pendingRun)await pendingRun.updateSubmittedTask(clone(submittedCreationTask));
        let recoveredCreation=false;
        let creationCommitHasSuccessorChanges=false;
        const durable=await runDurableCreationHandoff({
          snapshot,
          persist:async snapshot=>{
            const recoverCommittedCreation=async(error:unknown)=>{
              const attempt=creationAttempts.current.get(candidate.id);
              const submittedTask=attempt?.leaseOwnerId===creationLock.leaseOwnerId?attempt.task:undefined;
              if(!submittedTask)throw error;
              let recoveredRemote:AppData|null=null;
              try{recoveredRemote=await fetchCloudData(capturedCreationConfig);}
              catch{throw error;}
              const recoveredTask=recoveredRemote?.tasks.find(task=>task.id===candidate.id);
              if(!recoveredRemote||recoveredRemote.revision<snapshot.revision||!creationTaskCommitMatches(submittedTask,recoveredTask))throw error;
              recoveredCreation=true;
              if(creationIsCurrent()){
                lastCloudRevision.current=recoveredRemote.revision;
                confirmCloudSnapshot(cloudIdentity(capturedCreationConfig),recoveredRemote);
                setCloudWriteBlocked(false);
                setCloudStatus('已在雲端找到先前回應遺失的新增要事，正在恢復畫面…');
              }
              return recoveredRemote;
            };
            try{await enqueueCloudSave(snapshot,creationIsCurrent,false);}
            catch(error){return recoverCommittedCreation(error);}
            const confirmed=confirmedCloudData.current;
            if(!confirmed||!confirmed.tasks.some(task=>task.id===candidate.id))return recoverCommittedCreation(new Error('雲端未確認新要事資料'));
            return confirmed;
          },
          isCurrent:creationIsCurrent,
          resolveCommittedValue:confirmed=>{
            const live=liveData.current;
            if(appDataContentEqual(live,creationBase))return confirmed;
            const merged=rebaseDisjointAppData(creationBase,live,confirmed,nowIso(),currentUser.id);
            creationCommitHasSuccessorChanges=!appDataContentEqual(merged,confirmed);
            return creationCommitHasSuccessorChanges?merged:confirmed;
          },
          onDurable:()=>{
            confirmedCreationLeases.current.add(creationLock.leaseOwnerId);
            clearCreationAttempt(candidate.id,creationLock.leaseOwnerId);
            setQuarantinedCreationDrafts(current=>{
              const previous=current[creationLock.ownerUserId];
              if(previous?.leaseOwnerId!==creationLock.leaseOwnerId)return current;
              const next={...current};delete next[creationLock.ownerUserId];return next;
            });
          },
          commit:confirmed=>flushSync(()=>{
            liveData.current=confirmed;
            pendingRun?.adoptCommittedLive(confirmed);
            setData(confirmed);
            if(creationCommitHasSuccessorChanges){
              clearStaleSaveSuccessToast();
              hasUnsavedWork.current=true;
              setSavePhase('dirty');
              setCloudStatus('新增要事已確認保存；等待期間產生的後續本機修改仍保留，正在排隊保存');
            }else if(recoveredCreation){
              hasUnsavedWork.current=false;
              setSavePhase('saved');
              setCloudStatus(savedStatus('已確認先前回應遺失的新增要事已保存雲端',confirmed.updatedAt));
              showSaveToast('success','新增要事已確認保存','雲端已確認先前回應遺失的保存，現在可以安全關閉或重新整理頁面。');
            }
          }),
        });
        if(durable){
          const released=await releaseCreationVesselLocks();
          if(!released)setCloudStatus('新增要事已確認保存；部分關聯船舶鎖將於租期屆滿後自動釋放');
        }else{
          await retainCreationVesselLocksUntilExpiry();
          if(creationIsCurrent())setCloudStatus('新增要事尚未完成雲端確認；草稿與協作鎖仍保留');
        }
        return durable;
        }catch(error:any){
          if(creationMutationApplied)await retainCreationVesselLocksUntilExpiry();
          else await releaseCreationVesselLocks();
          if(creationIsCurrent()){
            setCloudWriteBlocked(true);
            setCloudStatus(`新增要事尚未完成雲端確認：${error.message||error}；未釋放協作鎖，請重試或取消`);
            if(!pendingRun)alert('雲端尚未確認新增要事；草稿仍保留在編輯器，協作鎖不會先釋放。請重試或取消。');
          }
          return false;
        }
      })();
      const barrier:DurableCreationHandoffBarrier={leaseOwnerId:creationLock!.leaseOwnerId,promise:creationFlow};
      creationHandoffInFlight.current=barrier;
      try{return await creationFlow;}
      finally{
        if(creationHandoffInFlight.current===barrier){
          creationHandoffInFlight.current=null;
          setCreationHandoffVersion(value=>value+1);
        }
      }
    }
    if(!creating){
      const durable=await runDurableRelatedMutation(
        `task:${candidate.id}`,
        '保存要事',
        ()=>{flushSync(()=>setData(applyTaskSave));return applied;},
        snapshot=>[
          ...taskVesselIds(candidate)
            .filter(vesselId=>snapshot.vessels.some(vessel=>vessel.id===vesselId))
            .map(vesselId=>`vessel:${vesselId}`),
          ...taskInternalControlCreationLockKeys(snapshot,candidate,isMeetingTaskSource(candidate)),
        ],
      );
      if(!durable&&!applied)alert(failure);
      return durable;
    }
    flushSync(()=>setData(applyTaskSave));
    if(!applied)alert(failure);
    return applied;
  };
  pendingTaskCreationProcessorRef.current=async()=>{
    if(pendingTaskCreationInFlight.current)return;
    const config=getSupabaseConfig();
    const actor=currentUser;
    if(!cloudBootstrapped||!config||!actor||localStorage.getItem(CURRENT_USER_KEY)!==actor.id||actor.role==='vessel'||activeEditLockRef.current||batchManagedOpenRef.current||batchManagedRequested.current||cloudSaveInFlight.current||cloudSyncInFlight.current||saveTimer.current||pendingCloudData.current.size()>0)return;
    const confirmed=confirmedCloudData.current;
    if(!confirmed||!appDataContentEqual(liveData.current,confirmed))return;
    let stored:PendingTaskCreationIntent[];
    try{stored=readPendingTaskCreations(window.localStorage);}catch{return;}
    pendingTaskCreationsRef.current=stored;
    setPendingTaskCreations(stored);
    const workspaceIdentity=cloudIdentity(config);
    const initial=stored.find(intent=>pendingTaskCreationMatchesContext(intent,workspaceIdentity,actor.id)&&pendingTaskCreationMayRetry(intent));
    if(!initial)return;
    let expectedLiveSnapshot=clone(confirmed);
    let expectedConfirmedSnapshot=clone(confirmed);
    pendingTaskCreationInFlight.current=true;
    const runGeneration=++pendingTaskCreationRunGeneration.current;
    let intent=markPendingTaskCreationRetrying(initial,nowIso());
    let creationLeaseOwnerId='';
    let creationSectionKey='';
    let creationHeartbeatTimer:number|null=null;
    let creationHeartbeatInFlight:Promise<void>|null=null;
    let creationHeartbeatFailure:unknown=null;
    let creationValidatedUntilMs=0;
    let creationGuardKey='';
    let runContext:PendingCreationRunContext|null=null;
    const persist=async(next:PendingTaskCreationIntent,replaceTask=false,expectedTask?:TaskItem)=>{
      const result=await updatePendingTaskCreationIfPresent(window.localStorage,next,{replaceTask,expectedTask});
      if(result.status==='missing')throw new Error('待同步意圖已由其他分頁完成或移除');
      if(result.status==='superseded')throw new Error('待同步草稿已由其他分頁更新，本次舊retry已停止');
      intent=result.intent;
      const refreshed=readPendingTaskCreations(window.localStorage);
      pendingTaskCreationsRef.current=refreshed;
      setPendingTaskCreations(refreshed);
    };
    const waitAgain=(message:string)=>persist(markPendingTaskCreationWaiting(intent,message,nowIso(),pendingTaskCreationRetryDelayMs(intent.attempts)));
    const needsAttention=(message:string)=>persist(markPendingTaskCreationAttention(intent,message,nowIso()));
    const stillStored=()=>{try{return readPendingTaskCreations(window.localStorage).some(item=>item.intentId===intent.intentId);}catch{return false;}};
    const runIsCurrent=()=>Boolean(
      pendingTaskCreationRunGeneration.current===runGeneration
      &&liveCurrentUserId.current===intent.userId
      &&localStorage.getItem(CURRENT_USER_KEY)===intent.userId
      &&sameCloudConfig(getSupabaseConfig(),config)
      &&stillStored()
      &&!creationHeartbeatFailure
      &&(!creationLeaseOwnerId||Date.now()<creationValidatedUntilMs)
      &&pendingTaskCreationAppStateIsCurrent({
        expectedLive:expectedLiveSnapshot,
        expectedConfirmed:expectedConfirmedSnapshot,
        currentLive:liveData.current,
        currentConfirmed:confirmedCloudData.current,
        mutationApplied:Boolean(runContext?.mutationApplied),
        equals:appDataContentEqual,
      })
    );
    const stopCreationHeartbeat=async()=>{
      if(creationHeartbeatTimer!==null){window.clearInterval(creationHeartbeatTimer);creationHeartbeatTimer=null;}
      if(creationHeartbeatInFlight)await creationHeartbeatInFlight;
    };
    const releaseCreationSentinel=async()=>{
      if(!creationLeaseOwnerId||!creationSectionKey)return;
      try{await runCloudSaveQueueRpc('釋放待同步新增要事協作鎖',signal=>releaseEditLock(creationSectionKey,creationLeaseOwnerId,config,signal),8_000);}catch{/* lease will expire */}
    };
    try{
      await persist(intent);
      setSavePhase('queued');
      setCloudStatus('正在重讀最新雲端資料，準備保存待同步新增要事…');
      const remote=await fetchCloudData(config);
      if(!remote||!runIsCurrent()){await waitAgain('工作區或登入身份已變更，暫停自動重試');return;}
      if(remote.revision<intent.baseRevision){await needsAttention('雲端revision早於草稿建立基線，已停止自動保存');return;}
      assertRemoteExtendsDurableHistory(workspaceIdentity,confirmed,remote);
      const remoteTask=remote.tasks.find(task=>task.id===intent.taskId);
      if(remoteTask){
        if(!taskCreationAlreadyCommitted(intent,remoteTask)){await needsAttention('雲端已有相同識別碼但內容來源無法確認，已停止自動保存');return;}
        lastCloudRevision.current=remote.revision;
        confirmCloudSnapshot(workspaceIdentity,remote);
        liveData.current=remote;
        flushSync(()=>setData(remote));
        const acknowledgement=await acknowledgePendingTaskCreation(window.localStorage,intent.intentId,intent.task);
        const remaining=acknowledgement.remaining;
        pendingTaskCreationsRef.current=remaining;setPendingTaskCreations(remaining);
        const newerDraftPending=remaining.some(item=>item.intentId===intent.intentId);
        if(newerDraftPending){
          hasUnsavedWork.current=true;
          setCloudWriteBlocked(false);
          setSavePhase('queued');
          clearStaleSaveSuccessToast();
          setCloudStatus('雲端已確認較早版本；同一要事的較新草稿尚未保存到雲端');
          showSaveToast('warning','較新草稿尚未保存','請保持本頁開啟；系統不會把較早版本誤當成目前草稿已保存。');
          return;
        }
        const otherUnsaved=Boolean(saveTimer.current||pendingCloudData.current.size()>0||cloudSyncInFlight.current||!confirmedCloudData.current||!appDataContentEqual(liveData.current,confirmedCloudData.current));
        hasUnsavedWork.current=remaining.length>0||otherUnsaved;
        setCloudWriteBlocked(false);
        setSavePhase(otherUnsaved?'dirty':remaining.length?'queued':'saved');
        if(otherUnsaved||remaining.length){
          setCloudStatus(otherUnsaved?'這筆新增要事已保存到雲端；等待期間的其他本機修改尚未完成雲端保存':`這筆新增要事已保存到雲端；另有 ${remaining.length} 筆新增要事仍在等待保存`);
          showSaveToast('info','這筆新增要事已保存','其他修改尚未全部保存到雲端，請保持本頁開啟。');
        }else{
          setCloudStatus(savedStatus('新增要事已保存到雲端',remote.updatedAt));
          showSaveToast('success','已保存到雲端','雲端已確認新增要事，現在可以安全關閉或重新整理頁面。');
        }
        return;
      }
      const liveActor=remote.users.find(user=>user.id===intent.userId&&user.isActive);
      const candidateVesselIds=taskVesselIds(intent.task).sort();
      const authorizedVessels=remote.vessels.filter(vessel=>candidateVesselIds.includes(vessel.id)&&vessel.isActive);
      if(!liveActor||liveActor.role==='vessel'||!hasPermission(remote.settings.rolePermissions,liveActor,'createTasks')){await needsAttention('登入身份已失效或新增要事權限已撤銷');return;}
      if(candidateVesselIds.join('\u0000')!==intent.vesselIds.join('\u0000')||authorizedVessels.length!==candidateVesselIds.length||!canAccessAllVessels(remote.settings.rolePermissions,liveActor,authorizedVessels)){await needsAttention('最新雲端權限已無法涵蓋草稿的全部涉船範圍');return;}
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(workspaceIdentity,remote);
      liveData.current=remote;
      flushSync(()=>setData(remote));
      expectedLiveSnapshot=clone(remote);
      expectedConfirmedSnapshot=clone(remote);
      creationSectionKey=taskCreationLockKey(intent.primaryVesselId,intent.taskId);
      creationLeaseOwnerId=uid('pending-task-create-lease');
      const claimed=await runCloudSaveQueueRpc('取得待同步新增要事協作鎖',signal=>claimEditLock(creationSectionKey,creationLeaseOwnerId,liveActor.name,75,config,signal),8_000);
      if(!claimed.ok){await waitAgain(claimed.lockedByName?`${claimed.lockedByName} 正在處理相同新增要事`:'新增要事協作鎖暫時不可用');return;}
      creationValidatedUntilMs=conservativeLeaseDeadline(claimed.expiresAt);
      creationGuardKey=`${creationSectionKey}|${creationLeaseOwnerId}`;
      transientCloudBlockLockGuards.current.set(`${creationSectionKey}|${creationLeaseOwnerId}`,{guard:{section_key:creationSectionKey,locked_by:creationLeaseOwnerId},config});
      const renewCreationSentinel=()=>{
        if(creationHeartbeatInFlight||creationHeartbeatFailure)return;
        creationHeartbeatInFlight=runCloudSaveQueueRpc('待同步新增要事協作鎖續期',signal=>renewEditLock(creationSectionKey,creationLeaseOwnerId,75,config,signal),8_000)
          .then(lock=>{if(!lock.ok)throw new Error('待同步新增要事協作鎖已失效');creationValidatedUntilMs=conservativeLeaseDeadline(lock.expiresAt);})
          .catch(error=>{creationHeartbeatFailure=error;})
          .finally(()=>{creationHeartbeatInFlight=null;});
      };
      creationHeartbeatTimer=window.setInterval(renewCreationSentinel,25_000);
      runContext={
        creationLock:{sectionKey:creationSectionKey,label:'待同步新增要事',status:'owned',ownerUserId:liveActor.id,ownerUserName:liveActor.name,leaseOwnerId:creationLeaseOwnerId,generation:-runGeneration,authorizationEpoch:authorizationEpochFor(remote,liveActor),validatedUntilMs:creationValidatedUntilMs},
        config,
        isCurrent:runIsCurrent,
        adoptRemoteBase:snapshot=>{expectedLiveSnapshot=clone(snapshot);expectedConfirmedSnapshot=clone(snapshot);},
        adoptCommittedLive:snapshot=>{expectedLiveSnapshot=clone(snapshot);},
        mutationApplied:false,
        updateSubmittedTask:task=>persist(replacePendingTaskCreationTask(intent,task,nowIso()),true,clone(intent.task)),
      };
      setSavePhase('saving');
      setCloudStatus('正在把待同步新增要事安全保存到雲端…');
      const durable=await saveTask(intent.task,true,'',remote.revision,runContext);
      await stopCreationHeartbeat();
      if(durable){
        await releaseCreationSentinel();
        const acknowledgement=await acknowledgePendingTaskCreation(window.localStorage,intent.intentId,intent.task);
        const remaining=acknowledgement.remaining;
        pendingTaskCreationsRef.current=remaining;setPendingTaskCreations(remaining);
        const newerDraftPending=remaining.some(item=>item.intentId===intent.intentId);
        if(newerDraftPending){
          hasUnsavedWork.current=true;
          setCloudWriteBlocked(false);
          setSavePhase('queued');
          clearStaleSaveSuccessToast();
          setCloudStatus('雲端已確認較早版本；同一要事的較新草稿尚未保存到雲端');
          showSaveToast('warning','較新草稿尚未保存','請保持本頁開啟；系統不會把較早版本誤當成目前草稿已保存。');
          return;
        }
        const otherUnsaved=Boolean(
          saveTimer.current
          ||pendingCloudData.current.size()>0
          ||cloudSyncInFlight.current
          ||!confirmedCloudData.current
          ||!appDataContentEqual(liveData.current,confirmedCloudData.current)
        );
        hasUnsavedWork.current=remaining.length>0||otherUnsaved;
        setCloudWriteBlocked(false);
        setSavePhase(otherUnsaved?'dirty':remaining.length?'queued':'saved');
        if(otherUnsaved||remaining.length){
          clearStaleSaveSuccessToast();
          setCloudStatus(otherUnsaved
            ? '新增要事已保存到雲端；等待期間的其他本機修改尚未完成雲端保存'
            : `這筆新增要事已保存到雲端；另有 ${remaining.length} 筆新增要事仍在等待保存`);
          showSaveToast('info','這筆新增要事已保存','其他修改尚未全部保存到雲端，請保持本頁開啟。');
        }else{
          setCloudStatus(savedStatus('新增要事已保存到雲端',confirmedCloudData.current?.updatedAt));
          showSaveToast('success','已保存到雲端','雲端已確認新增要事，現在可以安全關閉或重新整理頁面。');
        }
      }else{
        if(!runContext.mutationApplied)await releaseCreationSentinel();
        await waitAgain(runContext.mutationApplied?'雲端確認尚未完成，系統會重新查證':'相關船舶仍由其他人更新，系統會自動重試');
        hasUnsavedWork.current=true;
        setSavePhase('queued');
      }
    }catch(error:any){
      await stopCreationHeartbeat();
      if(!runContext?.mutationApplied)await releaseCreationSentinel();
      try{await waitAgain(error.message||String(error));}catch{/* retain the original durable record */}
      hasUnsavedWork.current=true;
      setSavePhase('queued');
      setCloudStatus(`新增要事仍在等待雲端保存｜${error.message||error}`);
    }finally{
      if(creationGuardKey)transientCloudBlockLockGuards.current.delete(creationGuardKey);
      clearCreationAttempt(intent.taskId,creationLeaseOwnerId);
      pendingTaskCreationInFlight.current=false;
      refreshPendingTaskCreations();
    }
  };
  const saveTaskVesselProgress = async (candidate: TaskItem, vesselId: string, expectedUpdatedAt: string, expectedRevision: number) => {
    if(!requireMutationLease(`task:${candidate.id}`))return false;
    let applied=false;
    let failure='單船進度已變更或權限已更新，請重新開啟後再試';
    const apply=()=>{flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')){failure='目前身份無權更新單船進度';return prev;}
      const matchingTasks=prev.tasks.filter(item=>item.id===candidate.id);
      if(matchingTasks.length!==1){failure=matchingTasks.length?'待辦編號重複，已拒絕不明確的單船進度更新':'待辦不存在或不是多船會議待辦';return prev;}
      const liveTask=matchingTasks[0];
      if(!usesPerVesselProgress(liveTask)){failure='待辦不存在或不是多船會議待辦';return prev;}
      if(!meetingTaskLinkIsValidForMutation(liveTask,prev.meetings)){failure='會議來源關聯缺失、失效或與父會議狀態不一致，請先由臨會/專題頁安全修復';return prev;}
      if((!getSupabaseConfig()&&prev.revision!==expectedRevision)||liveTask.updatedAt!==expectedUpdatedAt){failure='資料已由其他人更新，為避免覆蓋，本次未保存；請重新開啟';return prev;}
      const vessel=prev.vessels.find(item=>item.id===vesselId&&item.isActive);
      if(!vessel||!taskVesselIds(liveTask).includes(vesselId)||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,[vessel])){failure='目前身份無權更新此船舶進度';return prev;}
      const candidateProgress=candidate.vesselProgress?.find(item=>item.vesselId===vesselId);
      if(!candidateProgress){failure='找不到此船舶的進度草稿';return prev;}
      const previousProgress=taskProgressForVessel(liveTask,vesselId);
      const closureChanged=previousProgress.isClosed!==candidateProgress.isClosed;
      if(closureChanged&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份無權結案或重新開啟單船進度';return prev;}
      if(previousProgress.isClosed&&candidateProgress.isClosed&&(candidateProgress.status!==previousProgress.status||candidateProgress.closedDate!==previousProgress.closedDate||candidateProgress.closedBy!==previousProgress.closedBy||JSON.stringify(candidateProgress.statusLogs||[])!==JSON.stringify(previousProgress.statusLogs||[]))){failure='已結案單船進度不可直接改寫；請由有權限者先重新開啟';return prev;}
      if(!statusLogsAppendOnly(candidateProgress.statusLogs,previousProgress.statusLogs)){failure='單船進度歷程只能附加，不得刪除、改寫或偽造既有紀錄';return prev;}
      const at=nowIso();
      const normalizedProgress=clone(candidateProgress);
      let submittedProgressLogs=candidateProgress.statusLogs;
      if(normalizedProgress.status!==previousProgress.status&&candidateProgress.statusLogs.length===previousProgress.statusLogs.length)submittedProgressLogs=[{id:'',at:'',by:'',text:normalizedProgress.status},...candidateProgress.statusLogs];
      normalizedProgress.statusLogs=trustedStatusLogs(submittedProgressLogs,previousProgress.statusLogs,liveUser,at);
      const newProgressLogCount=normalizedProgress.statusLogs.length-previousProgress.statusLogs.length;
      if(normalizedProgress.status!==previousProgress.status&&newProgressLogCount<1){failure='單船狀態變更必須新增相符歷程';return prev;}
      if(newProgressLogCount>0&&normalizedProgress.statusLogs[0]?.text.trim()!==normalizedProgress.status.trim()){failure='單船最新狀態必須與新增歷程一致';return prev;}
      if(normalizedProgress.isClosed){
        if(closureChanged){normalizedProgress.closedDate=trustedClosureDate(normalizedProgress.closedDate,todayDate());normalizedProgress.closedBy=liveUser.id;}
        else{normalizedProgress.closedDate=previousProgress.closedDate;normalizedProgress.closedBy=previousProgress.closedBy;}
      }else{delete normalizedProgress.closedDate;delete normalizedProgress.closedBy;}
      const saved=updateTaskVesselProgress(liveTask,vesselId,()=>normalizedProgress,{at,actorId:liveUser.id});
      const previousOverallClosed=taskIsClosedForScope(liveTask,taskVesselIds(liveTask));
      const nextOverallClosed=taskIsClosedForScope(saved,taskVesselIds(saved));
      const meetingLifecycleChanged=previousOverallClosed!==nextOverallClosed;
      const liveMeeting=liveTask.sourceMeetingId?prev.meetings.find(meeting=>meeting.id===liveTask.sourceMeetingId):undefined;
      if(meetingLifecycleChanged&&(!liveMeeting||!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser))){failure='整體完成狀態變更需同時具備管理會議權限';return prev;}
      if(meetingLifecycleChanged&&!nextOverallClosed&&liveMeeting?.status==='已完成'){failure='請先重新開啟整場會議';return prev;}
      const notices=buildTaskNotificationsForVessels(prev.users,[vessel],liveUser.id,saved,'task_updated',liveUser.name,prev.settings.rolePermissions);
      const draft=clone(prev);
      const index=draft.tasks.findIndex(item=>item.id===saved.id);
      if(index<0){failure='待辦已被刪除';return prev;}
      draft.tasks[index]=saved;
      if(meetingLifecycleChanged&&liveMeeting){
        const meetingIndex=draft.meetings.findIndex(meeting=>meeting.id===liveMeeting.id);
        draft.meetings[meetingIndex]=synchronizeLinkedMeetingDecisionLifecycle(liveMeeting,saved,{actorId:liveUser.id,actorName:liveUser.name,at,closedDate:todayDate()});
      }
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      applied=true;
      let audited=withAudit(draft,liveUser,'更新單船進度','task',saved.id,`${vesselDisplayName(vessel)}｜${normalizedProgress.status||'未填狀態'}｜${normalizedProgress.isClosed?'已結案':'未結'}`);
      if(meetingLifecycleChanged&&liveMeeting)audited=withAudit(audited,liveUser,nextOverallClosed?'同步完成臨會/專題待辦':'同步重新開啟臨會/專題待辦','meeting',liveMeeting.id,richTextToPlainText(saved.description)||saved.id);
      return audited;
    }));return applied;};
    const durable=await runDurableRelatedMutation(`task:${candidate.id}`,'保存單船進度',apply);
    if(!durable&&!applied)alert(failure);
    return durable;
  };
  const deleteTask = async (task: TaskItem):Promise<boolean> => {
    if(!currentUser||!canDeleteTasks||!canDeleteTask(currentUser)){alert('只有 Owner／管理員可以刪除待辦');return false;}
    if(!confirm(`確定刪除待辦「${richTextToPlainText(task.description)||task.id}」？此動作會留下操作紀錄。`))return false;
    if(!requireMutationLease(`task:${task.id}`))return false;
    let applied=false;
    let failure='待辦已變更或權限已更新，未執行刪除';
    const apply=()=>{flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)){failure='只有 Owner／管理員可以刪除待辦';return prev;}
      if(prev.tasks.filter(item=>item.id===task.id).length!==1){failure='待辦識別碼缺失或重複，為避免一次刪除多筆資料，本次未執行';return prev;}
      const liveTask=prev.tasks.find(item=>item.id===task.id);
      if(!liveTask){failure='待辦已被刪除或不存在';return prev;}
      if((!getSupabaseConfig()&&prev.revision!==data.revision)||liveTask.updatedAt!==task.updatedAt){failure='待辦或主資料已由其他人更新，為避免刪除最新變更，本次未執行';return prev;}
      const vessels=taskVessels(liveTask,prev.vessels);
      if(!vessels.length||vessels.length!==taskVesselIds(liveTask).length||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,vessels)){failure='找不到完整對應船舶範圍或權限已變更';return prev;}
      const linkedMeeting=liveTask.sourceMeetingId?prev.meetings.find(item=>item.id===liveTask.sourceMeetingId):undefined;
      if(liveTask.sourceMeetingId&&!linkedMeeting){failure='會議來源關聯已失效，請先由臨會/專題頁修復';return prev;}
      if(linkedMeeting&&!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)){failure='目前身份無權刪除關聯臨會/專題事項';return prev;}
      const linkedOpenInternalCases=prev.internalControlCases.filter(item=>!item.isClosed&&(item.id===liveTask.internalControlCaseId||item.linkedTaskId===liveTask.id));
      const internalControlDeletion=Boolean(linkedOpenInternalCases.length||(!taskIsClosedForScope(liveTask,taskVesselIds(liveTask))&&(liveTask.isInternalControl||linkedMeeting?.isInternalControl)));
      if(internalControlDeletion&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='刪除會結束內部管控，需具備結案權限';return prev;}
      const cancellationScopeSources=[...linkedOpenInternalCases.map(item=>[item.vesselId]),...(liveTask.isInternalControl?[taskVesselIds(liveTask)]:[]),...(linkedMeeting?.isInternalControl?[linkedMeeting.vessels]:[])];
      const cancellationSourceInvalid=cancellationScopeSources.some(ids=>!ids.length||ids.some(id=>!prev.vessels.some(vessel=>vessel.id===id)));
      const cancellationVesselIds=new Set(cancellationScopeSources.flat());
      const cancellationVessels=prev.vessels.filter(vessel=>cancellationVesselIds.has(vessel.id));
      if(internalControlDeletion&&(cancellationSourceInvalid||!cancellationVesselIds.size||cancellationVessels.length!==cancellationVesselIds.size||!cancellationVessels.every(item=>canCancelInternalControl(liveUser,item)))){failure='目前帳戶無權取消全部原有涉船範圍的內部管控';return prev;}
      let resolvedMeetingItemId: string | undefined;
      if(liveTask.sourceMeetingId){
        const meeting=prev.meetings.find(item=>item.id===liveTask.sourceMeetingId);
        if(meeting){
          const resolution=resolveMeetingTaskItemIdForDeletion(liveTask,meeting);
          if(resolution===null){failure='會議事項關聯資料不一致且無法安全判定，未執行刪除';return prev;}
          resolvedMeetingItemId=resolution;
          if(resolution){
            const hasRemainingDuplicate=prev.tasks.some(other=>{
              if(other.id===liveTask.id||other.sourceMeetingId!==liveTask.sourceMeetingId)return false;
              const otherResolution=resolveMeetingTaskItemIdForDeletion(other,meeting);
              return otherResolution===null||otherResolution===resolution;
            });
            if(hasRemainingDuplicate){failure='同一會議事項仍有其他關聯待辦，請從臨會/專題頁統一移除，避免留下失效關聯';return prev;}
          }
        }
      }
      const noticeScopeVessels=internalControlDeletion?cancellationVessels:vessels;
      const noticeTask={...liveTask,isInternalControl:internalControlDeletion?false:liveTask.isInternalControl,ownerUserIds:liveTask.ownerUserIds.filter(id=>isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),noticeScopeVessels))};
      const notices=buildTaskNotificationsForVessels(prev.users,noticeScopeVessels,liveUser.id,noticeTask,internalControlDeletion?'internal_control_cancelled':'task_deleted',liveUser.name,prev.settings.rolePermissions);
      let draft=clone(prev);
      try{closeLinkedInternalControlCaseAfterTaskDelete(draft,liveTask,liveUser,nowIso());}
      catch(error:any){failure=error.message||String(error);return prev;}
      draft.tasks=draft.tasks.filter(item=>item.id!==liveTask.id);
      if(liveTask.sourceMeetingId){
        const meeting=draft.meetings.find(item=>item.id===liveTask.sourceMeetingId);
        if(meeting){
          if(resolvedMeetingItemId)meeting.taskItems=meeting.taskItems.filter(item=>item.id!==resolvedMeetingItemId);
          meeting.taskDescription=meeting.taskItems[0]?.description||'';
          meeting.updatedAt=nowIso();
        }
      }
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      if(internalControlDeletion){
        draft=withAudit(draft,liveUser,'取消內部管控','task',liveTask.id,`${liveTask.description||liveTask.id}｜刪除待辦時同步取消｜取消人 ${liveUser.id}｜${nowIso()}`);
        if(liveTask.sourceMeetingId)draft=withAudit(draft,liveUser,'更新臨會/專題內部管控','meeting',liveTask.sourceMeetingId,`刪除關聯內控待辦 ${liveTask.id}`);
      }
      applied=true;
      return withAudit(draft,liveUser,'刪除事項','task',liveTask.id,liveTask.description||liveTask.id);
    }));return applied;};
    const durable=await runDurableRelatedMutation(`task:${task.id}`,'刪除要事',apply);
    if(!durable&&!applied)alert(failure);
    return durable;
  };
  const runTaskMutationWithLockBundle=async(taskIds:string[],label:string,mutation:(fresh:AppData)=>boolean,additionalLockKeys:(snapshot:AppData)=>readonly string[]=()=>[]):Promise<boolean>=>{
    const uniqueIds=[...new Set(taskIds)].sort((left,right)=>left.localeCompare(right));
    const config=getSupabaseConfig();
    if(!config)return mutation(liveData.current);
    const actorId=currentUser?.id||'';
    const actorName=currentUser?.name||'';
    const expectedAuthorizationEpoch=authorizationEpoch;
    const sessionIsCurrent=()=>Boolean(actorId&&liveCurrentUserId.current===actorId&&liveAuthorizationEpoch.current===expectedAuthorizationEpoch&&sameCloudConfig(getSupabaseConfig(),config));
    try{
      const confirmed=confirmedCloudData.current;
      if(!confirmed||!appDataContentEqual(liveData.current,confirmed))await enqueueCloudSave(liveData.current,sessionIsCurrent);
    }catch(error:any){
      alert(`開啟${label}前無法確認既有修改已保存：${error.message||error}`);
      return false;
    }
    if(!sessionIsCurrent())return false;
    let planningRemote:AppData;
    let plannedLockKeys:string[];
    try{
      const base=confirmedCloudData.current;
      const fetched=await fetchCloudData(config);
      if(!base||!fetched)throw new Error('缺少可信雲端基線');
      if(!sessionIsCurrent())throw new StaleAsyncConfigError();
      assertRemoteExtendsDurableHistory(cloudIdentity(config),base,fetched);
      const remoteActor=fetched.users.find(user=>user.id===actorId&&user.isActive);
      const visibleTaskIds=new Set(remoteActor?selectTasksVisibleToUser(fetched.tasks,remoteActor,{internalControlCases:fetched.internalControlCases,meetings:fetched.meetings,visibleVesselIds:[...batchVisibleVesselIds(fetched,remoteActor)]}).map(task=>task.id):[]);
      if(!remoteActor||uniqueIds.some(id=>!visibleTaskIds.has(id)))throw new Error('最新雲端身份或涉船範圍已無權處理至少一筆要事');
      planningRemote=fetched;
      plannedLockKeys=[...new Set([...taskRelationLockKeys(planningRemote,uniqueIds),...additionalLockKeys(planningRemote)])].sort((left,right)=>left.localeCompare(right));
      if(!plannedLockKeys.length)throw new Error('沒有可鎖定的批量項目');
    }catch(error:any){
      alert(`無法安全規劃${label}的完整關聯鎖：${error.message||error}`);
      return false;
    }
    const requests=plannedLockKeys.map(sectionKey=>({sectionKey,label:`${label}｜${sectionKey}`,leaseOwnerId:uid('task-batch-lease')}));
    const releaseRequest=async(request:{sectionKey:string;leaseOwnerId:string})=>runCloudSaveQueueRpc('釋放批量關聯鎖',signal=>releaseEditLock(request.sectionKey,request.leaseOwnerId,config,signal),8_000);
    const result=await acquireEditLockBundle(
      requests,
      request=>runCloudSaveQueueRpc('取得批量關聯鎖',signal=>claimEditLock(request.sectionKey,request.leaseOwnerId,actorName,75,config,signal),8_000),
      releaseRequest,
      sessionIsCurrent,
    );
    if(result.status!=='owned'){
      if(result.status==='blocked')alert(`${result.label} 正在由 ${result.lockedByName} 編輯；${label}未執行，其他已取得的鎖已回滾。`);
      else alert(`無法安全取得全部要事鎖；${label}未執行。`);
      return false;
    }
    const guards=result.leases.map(lease=>({section_key:lease.sectionKey,locked_by:lease.leaseOwnerId}));
    guards.forEach(guard=>transientCloudBlockLockGuards.current.set(`${guard.section_key}|${guard.locked_by}`,{guard,config}));
    const clearGuards=()=>guards.forEach(guard=>transientCloudBlockLockGuards.current.delete(`${guard.section_key}|${guard.locked_by}`));
    let heartbeatStopped=false;
    let heartbeatFailure:unknown=null;
    let heartbeatInFlight:Promise<void>|null=null;
    const renewBundle=()=>{
      if(heartbeatStopped||heartbeatFailure||heartbeatInFlight)return;
      heartbeatInFlight=(async()=>{
        const outcomes=await Promise.allSettled(result.leases.map(async lease=>{
          if(!sessionIsCurrent())throw new StaleAsyncConfigError();
          const renewed=await runCloudSaveQueueRpc('批量關聯鎖續期',signal=>renewEditLock(lease.sectionKey,lease.leaseOwnerId,75,config,signal),8_000);
          if(!renewed.ok)throw new Error(`${lease.label} 的協作鎖已失效`);
        }));
        const rejected=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected');
        if(rejected)throw rejected.reason;
      })().catch(error=>{heartbeatFailure=error;}).finally(()=>{heartbeatInFlight=null;});
    };
    const heartbeatTimer=window.setInterval(renewBundle,25_000);
    const stopHeartbeat=async()=>{
      heartbeatStopped=true;
      window.clearInterval(heartbeatTimer);
      if(heartbeatInFlight)await heartbeatInFlight;
    };
    const assertBundleActive=()=>{
      if(!sessionIsCurrent())throw new StaleAsyncConfigError();
      if(heartbeatFailure)throw heartbeatFailure;
    };
    const releaseAll=async()=>{
      await stopHeartbeat();
      const settled=await Promise.allSettled(result.leases.map(releaseRequest));
      clearGuards();
      return settled.every(item=>item.status==='fulfilled');
    };
    let mutationApplied=false;
    let durable=false;
    try{
      const base=confirmedCloudData.current;
      const remote=await fetchCloudData(config);
      if(!base||!remote)throw new Error('缺少可信雲端基線');
      assertBundleActive();
      assertRemoteExtendsDurableHistory(cloudIdentity(config),base,remote);
      const sameLockKeySet=(left:readonly string[],right:readonly string[])=>left.length===right.length&&left.every((key,index)=>key===right[index]);
      const refreshedLockKeys=[...new Set([...taskRelationLockKeys(remote,uniqueIds),...additionalLockKeys(remote)])].sort((left,right)=>left.localeCompare(right));
      if(!sameLockKeySet(refreshedLockKeys,plannedLockKeys))throw new Error('關聯資料在取得鎖期間已變更，請重新執行');
      const remoteActor=remote.users.find(user=>user.id===actorId&&user.isActive);
      const visibleTaskIds=new Set(remoteActor?selectTasksVisibleToUser(remote.tasks,remoteActor,{internalControlCases:remote.internalControlCases,meetings:remote.meetings,visibleVesselIds:[...batchVisibleVesselIds(remote,remoteActor)]}).map(task=>task.id):[]);
      if(!remoteActor||uniqueIds.some(id=>!visibleTaskIds.has(id)))throw new Error('最新雲端身份或涉船範圍已無權處理至少一筆要事');
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(cloudIdentity(config),remote);
      liveData.current=remote;
      flushSync(()=>setData(remote));
      mutationApplied=mutation(remote);
      if(!mutationApplied){await releaseAll();return false;}
      assertBundleActive();
      await enqueueCloudSave(liveData.current,sessionIsCurrent);
      assertBundleActive();
      durable=Boolean(confirmedCloudData.current&&appDataContentEqual(liveData.current,confirmedCloudData.current));
      if(!durable)throw new Error('雲端尚未確認批量變更');
      const released=await releaseAll();
      if(!released)setCloudStatus(`${label}已保存，但部分要事鎖將於租期屆滿後自動釋放`);
      return true;
    }catch(error:any){
      if(!mutationApplied)await releaseAll();
      else{
        await stopHeartbeat();
        setSensitiveCloudStatus(`${label}尚未雲端確認；關聯鎖保持至租期屆滿：${error.message||error}`,guards[0]?.section_key||'');
        window.setTimeout(clearGuards,80_000);
      }
      alert(`${label}未完成：${error.message||error}`);
      return false;
    }
  };
  const batchCompleteTasks = async (taskIds: string[], internalControlCaseIds: string[] = []) => {
    if(!currentUser||!canCloseTasks||currentUser.role==='vessel') { alert('目前角色未獲授權批量完成待辦或內控案件'); return false; }
    const uniqueIds=[...new Set(taskIds)];
    const uniqueInternalControlCaseIds=[...new Set(internalControlCaseIds)];
    const visibleVesselIds=new Set(activeVessels.map(vessel=>vessel.id));
    const selectedTasks=uniqueIds.map(id=>data.tasks.find(task=>task.id===id));
    const initialInternalSelection=uniqueInternalControlCaseIds.length?validateBatchInternalControlSelection(data.internalControlCases,uniqueInternalControlCaseIds,visibleVesselIds):null;
    if(!uniqueIds.length&&!uniqueInternalControlCaseIds.length) { alert('請先選擇要完成的待辦或內控案件'); return false; }
    if(selectedTasks.some(task=>!task||task.isClosed||usesPerVesselProgress(task)||!taskVesselIds(task).every(id=>visibleVesselIds.has(id)))) { alert('所選待辦已變更、已結案、多船會議待辦不得批量完成，或未具備完整涉船範圍權限，請重新選擇'); return false; }
    if(initialInternalSelection&&(!initialInternalSelection.ok||initialInternalSelection.cases.some(item=>item.isClosed))) { alert('所選內控案件已變更、已結案或未具備完整涉船範圍權限，請重新選擇'); return false; }
    const tasks=selectedTasks as TaskItem[];
    const selectedInternalCases=initialInternalSelection?.ok?initialInternalSelection.cases:[];
    if(tasks.some(task=>task.sourceMeetingId)&&!canEditMeetings){alert('完成會議來源待辦需同時具備管理會議權限');return false;}
    if(tasks.some(task=>selectedInternalCases.some(item=>item.linkedTaskId===task.id||task.internalControlCaseId===item.id))) { alert('同一組雙向關聯不可同時以待辦與內控案件重複選取'); return false; }
    const expectedUpdatedAtById=new Map(tasks.map(task=>[task.id,task.updatedAt]));
    const expectedInternalUpdatedAtById=new Map(selectedInternalCases.map(item=>[item.id,item.updatedAt]));
    const internalControlLockKeysForClosure=(snapshot:AppData):string[]=>{
      if(!uniqueInternalControlCaseIds.length)return [];
      const actor=snapshot.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!actor||actor.role==='vessel'||!hasPermission(snapshot.settings.rolePermissions,actor,'closeTasks'))throw new Error('最新雲端身份已無內控結案權限');
      const selected=validateBatchInternalControlSelection(snapshot.internalControlCases,uniqueInternalControlCaseIds,batchVisibleVesselIds(snapshot,actor));
      if(!selected.ok||selected.cases.some(item=>item.isClosed||item.updatedAt!==expectedInternalUpdatedAtById.get(item.id)))throw new Error('所選內控案件已變更、已結案或不在目前可管理範圍');
      return internalControlBatchLockKeys(snapshot,uniqueInternalControlCaseIds);
    };
    if(!confirm(`確定批量完成所選 ${tasks.length+selectedInternalCases.length} 筆項目（待辦 ${tasks.length}、內控 ${selectedInternalCases.length}）？`)) return false;
    return runTaskMutationWithLockBundle(uniqueIds,'批量完成',fresh=>{
      const at=nowIso();
      const closedDate=todayDate();
      let applied=false;
      let failure='批量完成未執行：資料或權限已變更，請保留選擇並重新確認';
      flushSync(()=>setData(prev=>{
        const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
        if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')||liveUser.role==='vessel'||prev.revision!==fresh.revision) return prev;
        let liveSelectedTasks:TaskItem[]=[];
        if(uniqueIds.length){
          const selected=validateBatchTaskSelection(prev.tasks,uniqueIds,batchVisibleVesselIds(prev,liveUser),'complete');
          if(!selected.ok||selected.tasks.some(task=>task.updatedAt!==expectedUpdatedAtById.get(task.id)))return prev;
          if(selected.tasks.some(task=>task.sourceMeetingId)&&!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)){failure='目前身份已無管理會議權限';return prev;}
          if(selected.tasks.some(task=>!meetingTaskLinkIsValidForMutation(task,prev.meetings)))return prev;
          liveSelectedTasks=selected.tasks;
        }
        let liveSelectedInternalCases:InternalControlCase[]=[];
        if(uniqueInternalControlCaseIds.length){
          const selected=validateBatchInternalControlSelection(prev.internalControlCases,uniqueInternalControlCaseIds,batchVisibleVesselIds(prev,liveUser));
          if(!selected.ok||selected.cases.some(item=>item.isClosed||item.updatedAt!==expectedInternalUpdatedAtById.get(item.id)))return prev;
          liveSelectedInternalCases=selected.cases;
        }
        if(liveSelectedTasks.some(task=>liveSelectedInternalCases.some(item=>item.linkedTaskId===task.id||task.internalControlCaseId===item.id))){failure='同一組雙向關聯不可同時以待辦與內控案件重複選取';return prev;}
        let draft=clone(prev);
        const notices=liveSelectedTasks.flatMap(task=>{
          const vessels=taskVessels(task,draft.vessels);
          const noticeTask={...task,ownerUserIds:task.ownerUserIds.filter(id=>isEligibleTaskOwner(draft.settings.rolePermissions,draft.users.find(user=>user.id===id),vessels))};
          return buildTaskNotificationsForVessels(draft.users,vessels,liveUser.id,noticeTask,'task_updated',liveUser.name,draft.settings.rolePermissions);
        });
        try{
          if(liveSelectedTasks.length){
            const result=completeSelectedTasksWithMeetingSync(draft.tasks,draft.meetings,uniqueIds,{actorId:liveUser.id,actorName:liveUser.name,at,closedDate});
            if(result.completedIds.length!==uniqueIds.length){failure='待辦或父會議狀態同步未完成';return prev;}
            draft.tasks=result.tasks;
            draft.meetings=result.meetings;
            syncLinkedInternalControlCasesFromTasks(draft,uniqueIds,liveUser,at);
          }
          if(liveSelectedInternalCases.length)closeInternalControlCaseBatchFromDraft(draft,liveSelectedInternalCases,liveUser,at);
        }catch(error:any){failure=error.message||String(error);return prev;}
        draft.notifications=[...notices,...draft.notifications].slice(0,1000);
        liveSelectedTasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量完成事項','task',task.id,richTextToPlainText(task.description)||task.id); });
        liveSelectedTasks.filter(task=>task.sourceMeetingId).forEach(task=>{ draft=withAudit(draft,liveUser,'同步完成會議決議待辦','meeting',task.sourceMeetingId!,richTextToPlainText(task.description)||task.id); });
        liveSelectedInternalCases.forEach(item=>{ draft=withAudit(draft,liveUser,'批量結案內控異常','internal-control',item.id,richTextToPlainText(item.description)||item.id); });
        applied=true;
        return draft;
      }));
      if(!applied)alert(failure);
      return applied;
    },internalControlLockKeysForClosure);
  };
  const transitionMeetingTaskFromMeetingPage = async (taskId: string, transition: 'complete' | 'reopen', requestedClosedDate?: string, requestedClosureStatus?: string) => {
    if(!currentUser||!canCloseTasks||!canEditMeetings||currentUser.role==='vessel'){
      alert('目前角色需同時具備管理會議與完成／重新開啟待辦權限');
      return false;
    }
    const initialSnapshot=liveData.current;
    const initialMatches=initialSnapshot.tasks.filter(task=>task.id===taskId);
    const initialTask=initialMatches.length===1?initialMatches[0]:undefined;
    const initialMeeting=initialTask?.sourceMeetingId?initialSnapshot.meetings.find(meeting=>meeting.id===initialTask.sourceMeetingId):undefined;
    if(!initialTask||!initialMeeting||!meetingTaskLinkIsValidForMutation(initialTask,initialSnapshot.meetings)){
      alert('會議待辦不存在、重複或關聯已失效，請重新整理後再試');
      return false;
    }
    const initialCompletion=meetingDecisionCompletionSummary(initialMeeting,initialSnapshot.tasks).items.find(item=>item.task?.id===taskId);
    if(!initialCompletion){alert('會議待辦關聯重複或不明確，未執行任何變更');return false;}
    const repairingLifecycle=initialCompletion?.lifecycleConflict===true;
    if(usesPerVesselProgress(initialTask)&&!repairingLifecycle){
      alert('此為分船待辦，請依各船進度分別完成；全部船舶完成後會議頁會自動顯示完成');
      return false;
    }
    const initiallyClosed=taskIsClosedForScope(initialTask,taskVesselIds(initialTask));
    if(!repairingLifecycle&&((transition==='complete'&&initiallyClosed)||(transition==='reopen'&&!initiallyClosed))){
      alert(transition==='complete'?'此待辦已完成':'此待辦尚未完成');
      return false;
    }
    if(transition==='reopen'&&initialMeeting.status==='已完成'){
      alert('請先重新開啟整場會議，再重新開啟其中的待辦');
      return false;
    }
    const selectedClosedDate=transition==='complete'&&!repairingLifecycle?trustedClosureDate(requestedClosedDate,''):'';
    const selectedClosureStatus=transition==='complete'&&!repairingLifecycle?requestedClosureStatus?.trim()||'':'';
    if(transition==='complete'&&!repairingLifecycle&&!selectedClosedDate){
      alert('請先選擇有效的待辦完成日期');
      return false;
    }
    if(transition==='complete'&&!repairingLifecycle&&!selectedClosureStatus){
      alert('請填寫結案狀態');
      return false;
    }
    const actionLabel=repairingLifecycle?'同步臨會/專題待辦關聯狀態':transition==='complete'?'完成臨會/專題待辦':'重新開啟臨會/專題待辦';
    const confirmation=repairingLifecycle?`確定同步「${richTextToPlainText(initialTask.description)||'此待辦'}」的父會議狀態？`:`確定重新開啟「${richTextToPlainText(initialTask.description)||'此待辦'}」？`;
    if((repairingLifecycle||transition==='reopen')&&!confirm(confirmation))return false;
    const expectedUpdatedAt=initialTask.updatedAt;
    const expectedMeetingUpdatedAt=initialMeeting.updatedAt;
    return runTaskMutationWithLockBundle([taskId],actionLabel,fresh=>{
      let applied=false;
      let failure='會議待辦已變更或權限已更新，請重新整理後再試';
      flushSync(()=>setData(prev=>{
        const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
        if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')||!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)){failure='目前身份已無權管理會議或完成／重新開啟待辦';return prev;}
        if(prev.revision!==fresh.revision){failure='主資料版本已更新，請重新執行';return prev;}
        const matches=prev.tasks.filter(task=>task.id===taskId);
        const liveTask=matches.length===1?matches[0]:undefined;
        const liveMeeting=liveTask?.sourceMeetingId?prev.meetings.find(meeting=>meeting.id===liveTask.sourceMeetingId):undefined;
        if(!liveTask||!liveMeeting||liveTask.updatedAt!==expectedUpdatedAt||!meetingTaskLinkIsValidForMutation(liveTask,prev.meetings)){failure='會議待辦已變更、重複或關聯失效';return prev;}
        if(liveMeeting.updatedAt!==expectedMeetingUpdatedAt){failure='父會議已由其他人修改，請重新整理後再試';return prev;}
        const liveCompletion=meetingDecisionCompletionSummary(liveMeeting,prev.tasks).items.find(item=>item.task?.id===taskId);
        if(!liveCompletion){failure='會議待辦關聯重複或不明確';return prev;}
        const liveRepairingLifecycle=liveCompletion?.lifecycleConflict===true;
        if(usesPerVesselProgress(liveTask)&&!liveRepairingLifecycle){failure='分船待辦必須依各船進度完成';return prev;}
        const scopeIds=taskVesselIds(liveTask);
        const visibleIds=batchVisibleVesselIds(prev,liveUser);
        if(!scopeIds.length||scopeIds.some(id=>!visibleIds.has(id))){failure='目前身份不具備完整涉船範圍權限';return prev;}
        const isClosed=taskIsClosedForScope(liveTask,scopeIds);
        if(!liveRepairingLifecycle&&((transition==='complete'&&isClosed)||(transition==='reopen'&&!isClosed))){failure=transition==='complete'?'待辦已完成':'待辦已重新開啟';return prev;}
        if(transition==='reopen'&&liveMeeting.status==='已完成'){failure='請先重新開啟整場會議';return prev;}
        if(transition==='complete'&&!liveRepairingLifecycle&&!selectedClosedDate){failure='待辦完成日期無效';return prev;}
        if(transition==='complete'&&!liveRepairingLifecycle&&!selectedClosureStatus){failure='待辦結案狀態無效';return prev;}
        const at=nowIso();
        const closedDate=transition==='complete'&&!liveRepairingLifecycle?selectedClosedDate:trustedClosureDate(liveTask.closedDate,todayDate());
        const draft=clone(prev);
        const taskIndex=draft.tasks.findIndex(task=>task.id===taskId);
        const meetingIndex=draft.meetings.findIndex(meeting=>meeting.id===liveMeeting.id);
        let updatedTask:TaskItem;
        let targetMeeting:TemporaryMeeting;
        let repairedOnly=false;
        try{
          const transitioned=transitionLinkedMeetingDecision(liveMeeting,liveTask,transition,{actorId:liveUser.id,actorName:liveUser.name,at,closedDate,closureStatus:selectedClosureStatus||undefined});
          updatedTask=transitioned.task;
          targetMeeting=transitioned.meeting;
          repairedOnly=transitioned.repairedOnly;
        }
        catch(error:any){failure=error.message||String(error);return prev;}
        draft.tasks[taskIndex]=updatedTask;
        draft.meetings[meetingIndex]=targetMeeting;
        if(!meetingDecisionLifecycleIsConsistent(targetMeeting,draft.tasks,taskId)){failure='父會議與關聯待辦狀態同步未完成';return prev;}
        const vessels=taskVessels(updatedTask,draft.vessels);
        const noticeTask={...updatedTask,ownerUserIds:updatedTask.ownerUserIds.filter(id=>isEligibleTaskOwner(draft.settings.rolePermissions,draft.users.find(user=>user.id===id),vessels))};
        const notices=buildTaskNotificationsForVessels(draft.users,vessels,liveUser.id,noticeTask,'task_updated',liveUser.name,draft.settings.rolePermissions);
        draft.notifications=[...notices,...draft.notifications].slice(0,1000);
        applied=true;
        const auditAction=repairedOnly?'修復臨會/專題待辦關聯狀態':transition==='complete'?'完成臨會/專題待辦':'重新開啟臨會/專題待辦';
        const auditedTask=withAudit(draft,liveUser,auditAction,'task',taskId,richTextToPlainText(updatedTask.description)||taskId);
        return withAudit(auditedTask,liveUser,repairedOnly?'同步父會議決議待辦狀態':transition==='complete'?'同步完成會議決議待辦':'同步重新開啟會議決議待辦','meeting',targetMeeting.id,richTextToPlainText(updatedTask.description)||taskId);
      }));
      if(!applied)alert(failure);
      return applied;
    });
  };
  const saveDailyMorningHistory=async(at:string):Promise<boolean>=>{
    if(currentUser.role!=='owner'&&currentUser.role!=='admin')return alert('只有 Owner／管理員可以保存正式每日早會快照'),false;
    if(cloudSaveInFlight.current||pendingCloudData.current.size()>0)return alert('目前仍有雲端保存作業，請等頁首顯示已保存後再建立早會快照'),false;
    const expectedAuthorizationEpoch=authorizationEpoch;
    let itineraryProjectionSnapshot:ItineraryProjectionSnapshot;
    try{
      itineraryProjectionSnapshot=await requireFreshItineraryProjection(activeVessels);
    }catch(error){
      console.error('Itinerary formal snapshot refresh failed',error);
      return alert('無法確認最新正式 Itinerary；本次未建立早會快照，請稍後重試'),false;
    }
    const baseline=liveData.current;
    const actor=baseline.users.find(user=>user.id===currentUser.id&&user.isActive);
    if(!actor||(actor.role!=='owner'&&actor.role!=='admin')||authorizationEpochFor(baseline,actor)!==expectedAuthorizationEpoch)return alert('讀取 Itinerary 期間身份、權限或可見船舶已變更；本次未建立快照'),false;
    const upserted=upsertDailyMorningReport(baseline,{at,actorUserId:actor.id,source:'manual',itineraryProjectionSnapshot});
    if(upserted.status==='not-business-day')return alert('每日正式早會只在台北工作日（星期一至星期五）建立'),false;
    const candidate=withAudit(upserted.data as AppData,actor,'保存每日早會快照','agenda',upserted.report.id,`${upserted.report.businessDate}｜${upserted.report.vesselIds.length} 艘船｜${upserted.report.taskCount} 件`);

    const cfg=getSupabaseConfig();
    if(!cfg){
      if(!import.meta.env.DEV)return alert('尚未連接雲端，正式每日早會快照未保存'),false;
      flushSync(()=>{liveData.current=candidate;setData(candidate);});
      saveLocal(candidate);showSaveToast('success','本機開發模式已保存','早會快照只寫入隔離fixture，未連接正式雲端');
      return true;
    }
    const expectedIdentity=cloudIdentity(cfg);
    const requestUserId=currentUser.id;
    const isCurrent=()=>{
      const latest=getSupabaseConfig();
      return Boolean(latest&&sameCloudConfig(cfg,latest)&&cloudIdentity(latest)===expectedIdentity&&liveCurrentUserId.current===requestUserId);
    };
    if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}
    try{
      await enqueueCloudSave(candidate,isCurrent,false);
      if(!isCurrent())return false;
      const confirmed=confirmedCloudData.current;
      if(!confirmed)throw new Error('雲端未回傳可確認的最新資料');
      const confirmedReport=confirmed.agendaReports.find(report=>report.id===upserted.report.id&&report.kind==='daily-morning'&&report.businessDate===upserted.report.businessDate&&report.snapshot?.capturedAt===upserted.report.snapshot?.capturedAt);
      if(!confirmedReport)throw new Error('雲端回讀未包含本次每日早會快照');
      const current=liveData.current;
      const next=mergeConfirmedCloudSnapshot({baseline,current,confirmed,actorUserId:actor.id,at:nowIso()});
      flushSync(()=>{liveData.current=next;setData(next);});
      saveLocal(next);showSaveToast('success','每日早會快照已保存','雲端回讀已確認本次工作日快照');
      return true;
    }catch(error){
      if(isCurrent())alert(`每日早會快照未保存：${error instanceof Error?error.message:String(error)}`);
      return false;
    }
  };

  const dismissFromMyWorkCenter = async (taskIds: string[], internalControlCaseIds: string[] = []) => {
    if(!currentUser){alert('目前沒有有效登入身份');return false;}
    const uniqueTaskIds=[...new Set(taskIds)];
    const uniqueCaseIds=[...new Set(internalControlCaseIds)];
    if(!uniqueTaskIds.length&&!uniqueCaseIds.length){alert('請先選擇要從我的待辦移除的項目');return false;}
    const baseline=liveData.current;
    const actor=baseline.users.find(item=>item.id===currentUser.id&&item.isActive);
    if(!actor){alert('目前身份已失效，請重新登入');return false;}
    const visibleIds=batchVisibleVesselIds(baseline,actor);
    const visibleVessels=baseline.vessels.filter(vessel=>visibleIds.has(vessel.id));
    const visibleTaskIds=new Set(selectUserWorkCenterTasks(baseline,actor,visibleVessels).map(item=>item.id));
    const visibleCaseIds=new Set(selectUserWorkCenterInternalCases(baseline,actor,visibleVessels).map(item=>item.id));
    if(uniqueTaskIds.some(id=>!visibleTaskIds.has(id))||uniqueCaseIds.some(id=>!visibleCaseIds.has(id))){
      alert('所選項目已變更或已不在你的待辦範圍，請重新選擇');
      return false;
    }
    let candidate=dismissWorkCenterItems(clone(baseline),{userId:actor.id,taskIds:uniqueTaskIds,internalControlCaseIds:uniqueCaseIds,at:nowIso()});
    const expectedDismissalIds=[
      ...uniqueTaskIds.map(id=>workCenterDismissalId(actor.id,'task',id)),
      ...uniqueCaseIds.map(id=>workCenterDismissalId(actor.id,'internal-control',id)),
    ];
    if(expectedDismissalIds.some(id=>!candidate.taskDismissals.some(item=>item.id===id))){alert('個人移除標記建立失敗，本次未修改');return false;}
    candidate=withAudit(candidate,actor,'從我的待辦移除','user',actor.id,`個人移除待辦 ${uniqueTaskIds.length} 筆、內控 ${uniqueCaseIds.length} 筆；共用資料保留`);
    const requestConfig=getSupabaseConfig();
    if(!requestConfig){
      if(!import.meta.env.DEV){alert('雲端尚未連線，為避免只在本機隱藏，本次未移除');return false;}
      flushSync(()=>{liveData.current=candidate;setData(candidate);});
      saveLocal(candidate);
      showSaveToast('warning','開發模式個人移除','目前只在隔離本機環境保存；正式環境必須由雲端確認。');
      return true;
    }
    const requestUserId=actor.id;
    const isCurrent=()=>liveCurrentUserId.current===requestUserId&&sameCloudConfig(requestConfig,getSupabaseConfig());
    if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
    try{
      await enqueueCloudSave(candidate,isCurrent,false);
      if(!isCurrent())return false;
      const confirmed=confirmedCloudData.current;
      if(!confirmed||expectedDismissalIds.some(id=>!confirmed.taskDismissals.some(item=>item.id===id)))throw new Error('雲端未確認完整的個人移除標記');
      const current=liveData.current;
      const next=mergeConfirmedCloudSnapshot({baseline,current,confirmed,actorUserId:actor.id,at:nowIso()});
      flushSync(()=>{liveData.current=next;setData(next);});
      saveLocal(next);
      return true;
    }catch(error){
      alert(`從我的待辦移除失敗：${error instanceof Error?error.message:String(error)}。共用資料與目前清單均未被刪除。`);
      return false;
    }
  };
  const batchDeleteTasks = async (taskIds: string[], internalControlCaseIds: string[] = [], permanentFromMyWork=false) => {
    if(!currentUser||!canDeleteTasks||!canDeleteTask(currentUser)) { alert('只有 Owner／管理員可以批量刪除待辦'); return false; }
    const uniqueIds=[...new Set(taskIds)];
    const uniqueInternalControlCaseIds=[...new Set(internalControlCaseIds)];
    const visibleVesselIds=new Set(activeVessels.map(vessel=>vessel.id));
    const selectedTasks=uniqueIds.map(id=>data.tasks.find(task=>task.id===id));
    const initialInternalSelection=uniqueInternalControlCaseIds.length?validateBatchInternalControlSelection(data.internalControlCases,uniqueInternalControlCaseIds,visibleVesselIds):null;
    if(!uniqueIds.length&&!uniqueInternalControlCaseIds.length) { alert('請先選擇要刪除的待辦或內控案件'); return false; }
    if(selectedTasks.some(task=>!task||!taskVesselIds(task).every(id=>visibleVesselIds.has(id)))) { alert('所選待辦已變更或未具備完整涉船範圍權限，請重新選擇'); return false; }
    if(initialInternalSelection&&!initialInternalSelection.ok) { alert('所選內控案件已變更或未具備完整涉船範圍權限，請重新選擇'); return false; }
    const tasks=selectedTasks as TaskItem[];
    const selectedInternalCases=initialInternalSelection?.ok?initialInternalSelection.cases:[];
    const expectedUpdatedAtById=new Map(tasks.map(task=>[task.id,task.updatedAt]));
    const expectedInternalUpdatedAtById=new Map(selectedInternalCases.map(item=>[item.id,item.updatedAt]));
    const internalControlLockKeysForActor=(snapshot:AppData):string[]=>{
      if(!uniqueInternalControlCaseIds.length)return [];
      const actor=snapshot.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!actor||!hasPermission(snapshot.settings.rolePermissions,actor,'deleteTasks')||!hasPermission(snapshot.settings.rolePermissions,actor,'closeTasks')||!canDeleteTask(actor))throw new Error('最新雲端身份已無內控刪除權限');
      const selected=validateBatchInternalControlSelection(snapshot.internalControlCases,uniqueInternalControlCaseIds,batchVisibleVesselIds(snapshot,actor));
      if(!selected.ok||selected.cases.some(item=>item.updatedAt!==expectedInternalUpdatedAtById.get(item.id)))throw new Error('所選內控案件已變更或不在目前可管理範圍');
      const selectedVessels=selected.cases.map(item=>snapshot.vessels.find(vessel=>vessel.id===item.vesselId&&vessel.isActive));
      if(selectedVessels.some(vessel=>!vessel)||!(selectedVessels as Vessel[]).every(vessel=>canCancelInternalControl(actor,vessel)))throw new Error('最新雲端涉船範圍已無取消內控權限');
      return internalControlBatchLockKeys(snapshot,uniqueInternalControlCaseIds);
    };
    const totalSelected=tasks.length+selectedInternalCases.length;
    if(!confirm(permanentFromMyWork
      ?`確定永久刪除共用待辦 ${totalSelected} 筆（待辦 ${tasks.length}、內控 ${selectedInternalCases.length}）？所有有權使用者都會失去這些資料及其關聯，此動作無法復原，並會逐筆留下操作紀錄。`
      :`確定批量刪除所選 ${totalSelected} 筆項目（待辦 ${tasks.length}、內控 ${selectedInternalCases.length}）？此動作無法復原，並會逐筆留下操作紀錄。`)) return false;
    return runTaskMutationWithLockBundle(uniqueIds,'批量刪除',fresh=>{
    let applied=false;
    let failure='批量刪除未執行：資料或權限已變更，請保留選擇並重新確認';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)||prev.revision!==fresh.revision) return prev;
      let liveSelectedTasks:TaskItem[]=[];
      if(uniqueIds.length){
        const selected=validateBatchTaskSelection(prev.tasks,uniqueIds,batchVisibleVesselIds(prev,liveUser),'delete');
        if(!selected.ok||selected.tasks.some(task=>task.updatedAt!==expectedUpdatedAtById.get(task.id))) return prev;
        liveSelectedTasks=selected.tasks;
      }
      let liveSelectedInternalCases:InternalControlCase[]=[];
      if(uniqueInternalControlCaseIds.length){
        const selected=validateBatchInternalControlSelection(prev.internalControlCases,uniqueInternalControlCaseIds,batchVisibleVesselIds(prev,liveUser));
        if(!selected.ok||selected.cases.some(item=>item.updatedAt!==expectedInternalUpdatedAtById.get(item.id)))return prev;
        const selectedVessels=selected.cases.map(item=>prev.vessels.find(vessel=>vessel.id===item.vesselId&&vessel.isActive));
        if(selectedVessels.some(vessel=>!vessel)||!(selectedVessels as Vessel[]).every(vessel=>internalControlDeletionAuthorized({
          deleteTasks:hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')&&canDeleteTask(liveUser),
          closeTasks:hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks'),
          scopeCancellationAuthorized:canCancelInternalControl(liveUser,vessel),
        }))){failure='批量刪除內控案件需同時具備刪除、結案及全部涉船範圍的取消內控權限';return prev;}
        liveSelectedInternalCases=selected.cases;
      }
      const liveSelection={taskIds:uniqueIds,tasks:liveSelectedTasks};
      if(liveSelection.tasks.some(task=>liveSelectedInternalCases.some(item=>item.linkedTaskId===task.id||task.internalControlCaseId===item.id))){failure='同一組雙向關聯不可同時以待辦與內控案件重複選取';return prev;}
      const linkedMeetingTasks=liveSelection.tasks.filter(task=>Boolean(task.sourceMeetingId));
      if(linkedMeetingTasks.some(task=>!prev.meetings.some(meeting=>meeting.id===task.sourceMeetingId)))return prev;
      if(linkedMeetingTasks.length&&!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser))return prev;
      const cancellationVesselsByTaskId=new Map<string,Vessel[]>();
      const internalControlTasks=liveSelection.tasks.filter(task=>prev.internalControlCases.some(item=>!item.isClosed&&(item.id===task.internalControlCaseId||item.linkedTaskId===task.id))||(!taskIsClosedForScope(task,taskVesselIds(task))&&Boolean(task.isInternalControl||(task.sourceMeetingId&&prev.meetings.find(meeting=>meeting.id===task.sourceMeetingId)?.isInternalControl))));
      if(internalControlTasks.length&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='批量刪除會結束內部管控，需具備結案權限';return prev;}
      for(const task of internalControlTasks){
        const meeting=task.sourceMeetingId?prev.meetings.find(item=>item.id===task.sourceMeetingId):undefined;
        const linkedOpenCases=prev.internalControlCases.filter(item=>!item.isClosed&&(item.id===task.internalControlCaseId||item.linkedTaskId===task.id));
        const protectedSources=[...linkedOpenCases.map(item=>[item.vesselId]),...(task.isInternalControl?[taskVesselIds(task)]:[]),...(meeting?.isInternalControl?[meeting.vessels]:[])];
        if(protectedSources.some(ids=>!ids.length||ids.some(id=>!prev.vessels.some(vessel=>vessel.id===id))))return prev;
        const protectedIds=new Set(protectedSources.flat());
        const protectedVessels=prev.vessels.filter(vessel=>protectedIds.has(vessel.id));
        if(protectedVessels.length!==protectedIds.size||!protectedVessels.every(vessel=>canCancelInternalControl(liveUser,vessel)))return prev;
        cancellationVesselsByTaskId.set(task.id,protectedVessels);
      }
      const meetingItemTargets=new Map<string,string>();
      for(const task of liveSelection.tasks){
        if(!task.sourceMeetingId)continue;
        const meeting=prev.meetings.find(item=>item.id===task.sourceMeetingId);
        if(!meeting)continue;
        const resolution=resolveMeetingTaskItemIdForDeletion(task,meeting);
        if(resolution===null)return prev;
        if(resolution)meetingItemTargets.set(task.id,resolution);
      }
      for(const [taskId,itemId] of meetingItemTargets){
        const selectedTask=liveSelection.tasks.find(task=>task.id===taskId);
        const meeting=selectedTask?.sourceMeetingId?prev.meetings.find(item=>item.id===selectedTask.sourceMeetingId):undefined;
        if(!selectedTask||!meeting)continue;
        const hasUnselectedDuplicate=prev.tasks.some(other=>{
          if(liveSelection.taskIds.includes(other.id)||other.sourceMeetingId!==selectedTask.sourceMeetingId)return false;
          const otherResolution=resolveMeetingTaskItemIdForDeletion(other,meeting);
          return otherResolution===null||otherResolution===itemId;
        });
        if(hasUnselectedDuplicate)return prev;
      }
      let draft=clone(prev);
      const notices=liveSelection.tasks.flatMap(task=>{
        const defaultVessels=taskVessels(task,draft.vessels);
        const internalControlDeletion=cancellationVesselsByTaskId.has(task.id);
        const noticeVessels=cancellationVesselsByTaskId.get(task.id)||defaultVessels;
        const noticeTask={...task,isInternalControl:internalControlDeletion?false:task.isInternalControl,ownerUserIds:task.ownerUserIds.filter(id=>isEligibleTaskOwner(draft.settings.rolePermissions,draft.users.find(user=>user.id===id),noticeVessels))};
        return buildTaskNotificationsForVessels(draft.users,noticeVessels,liveUser.id,noticeTask,internalControlDeletion?'internal_control_cancelled':'task_deleted',liveUser.name,draft.settings.rolePermissions);
      });
      liveSelection.tasks.forEach(task=>{
        if(!task.sourceMeetingId)return;
        const meeting=draft.meetings.find(item=>item.id===task.sourceMeetingId);
        if(!meeting)return;
        const itemId=meetingItemTargets.get(task.id);
        if(itemId)meeting.taskItems=meeting.taskItems.filter(item=>item.id!==itemId);
        meeting.taskDescription=meeting.taskItems[0]?.description||'';
        meeting.updatedAt=nowIso();
      });
      try{
        deleteTaskBatchFromDraft(draft,liveSelection.tasks,liveUser,nowIso());
        deleteInternalControlCaseBatchFromDraft(draft,liveSelectedInternalCases);
      }
      catch(error:any){failure=error.message||String(error);return prev;}
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      internalControlTasks.forEach(task=>{
        draft=withAudit(draft,liveUser,'取消內部管控','task',task.id,`${richTextToPlainText(task.description)||task.id}｜批量刪除時同步取消｜取消人 ${liveUser.id}｜${nowIso()}`);
        if(task.sourceMeetingId)draft=withAudit(draft,liveUser,'更新臨會/專題內部管控','meeting',task.sourceMeetingId,`批量刪除關聯內控待辦 ${task.id}`);
      });
      liveSelection.tasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量刪除事項','task',task.id,richTextToPlainText(task.description)||task.id); });
      liveSelectedInternalCases.forEach(item=>{ draft=withAudit(draft,liveUser,'批量刪除內控異常','internal-control',item.id,richTextToPlainText(item.description)||item.id); });
      applied=true;
      return draft;
    }));
    if(!applied) alert(failure);
    return applied;
    },internalControlLockKeysForActor);
  };
  const openReportPreview = async () => {
    if (!canExportReports) return alert('目前角色未獲授權預覽或匯出報告');
    let snapshot:ItineraryProjectionSnapshot;
    try{snapshot=await requireFreshItineraryProjection(activeVessels);}
    catch(error){console.error('Itinerary report refresh failed',error);return alert('無法確認最新正式 Itinerary；本次未開啟正式報告，請稍後重試');}
    setReportPreviewLiveItinerarySnapshot(snapshot);
    setReportPreviewHistoryId('');
    setReportPreviewOpen(true);
  };
  const openHistoricalReport=(report:AgendaReport)=>{
    if(!canExportReports||report.kind!=='daily-morning'||!report.snapshot)return alert('此筆早會歷史目前沒有可檢視的快照。');
    const allowed=new Set(activeVessels.map(vessel=>vessel.id));
    setAgendaSelection(report.vesselIds.filter(id=>allowed.has(id)));
    setReportPreviewLiveItinerarySnapshot(null);
    setReportPreviewHistoryId(report.id);
    setReportPreviewOpen(true);
  };
  const openBrowserRecovery=()=>{
    setBrowserRecoveryAdvanced(true);
    setBrowserRecoveryPhase('idle');
    setBrowserRecoveryMessage('');
    setBrowserRecoveryOpen(true);
  };
  const closeBrowserRecovery=()=>{
    if(browserRecoveryPhase!=='idle')return;
    setBrowserRecoveryOpen(false);
    setBrowserRecoveryAdvanced(false);
    setBrowserRecoveryMessage('');
  };
  const repairCurrentAppResources=()=>repairShipDynamicsResources({
    appBaseUrl:import.meta.env.BASE_URL,
    origin:window.location.origin,
    cacheStorage:typeof caches==='undefined'?null:caches,
    serviceWorkerContainer:'serviceWorker' in navigator?navigator.serviceWorker:null,
  });
  const runSafeBrowserRepair=async()=>{
    setBrowserRecoveryPhase('repairing');
    setBrowserRecoveryMessage('正在清理本App具名資源並準備最新版入口…');
    try{
      await repairCurrentAppResources();
      const version=availableAppVersion||__SHIP_DYNAMICS_BUILD_VERSION__;
      browserRecoveryNavigationRef.current=true;
      window.location.assign(appRecoveryReloadUrl(window.location.href,version,`repair-${Date.now().toString(36)}`));
    }catch(error){
      browserRecoveryNavigationRef.current=false;
      setBrowserRecoveryPhase('idle');
      setBrowserRecoveryMessage(`安全修復未完成：${error instanceof Error?error.message:String(error)}。本機storage未刪除，頁面不會自動重新載入。`);
    }
  };
  const runFullBrowserReset=async()=>{
    if(!window.confirm('這會永久刪除本瀏覽器所有Ship Dynamics本機資料，包括AppData、登入、進站狀態、草稿與pending內容；不會先檢查是否已上傳。Supabase雲端資料、GitHub程式及其他專案不受影響。確定完整重設嗎？'))return;
    const version=availableAppVersion||__SHIP_DYNAMICS_BUILD_VERSION__;
    const resetUrl=appRecoveryReloadUrl(window.location.href,version,`reset-${Date.now().toString(36)}`);
    setBrowserRecoveryPhase('resetting');
    setBrowserRecoveryMessage('正在清理Ship Dynamics本機資料與App資源…');
    try{
      await repairCurrentAppResources();
      const result=clearShipDynamicsBrowserStorage({localStorage:window.localStorage,sessionStorage:window.sessionStorage});
      if(result.status==='failed'){
        setBrowserRecoveryPhase('idle');
        setBrowserRecoveryMessage(`本機資料只完成部分刪除，於${result.area}的「${result.failedKey}」停止；頁面不會自動重新載入。`);
        return;
      }
      if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
      hasUnsavedWork.current=false;
      browserRecoveryNavigationRef.current=true;
      window.location.assign(resetUrl);
    }catch(error){
      browserRecoveryNavigationRef.current=false;
      setBrowserRecoveryPhase('idle');
      setBrowserRecoveryMessage(`完整重設未完成：${error instanceof Error?error.message:String(error)}。本機資料可能已部分處理，頁面不會自動重新載入。`);
    }
  };
  const syncLatest = async () => {
    const syncConfig = getSupabaseConfig();
    if (!syncConfig) return setCloudStatus('本機模式：尚未配置 Supabase，無法同步雲端');
    if(!durableRevisionFloorRegistryIsValid())return setCloudStatus('durable revision floor registry損壞，已禁止同步；本機內容仍保留');
    if (!confirm('同步最新會保留本機修改並嘗試與雲端安全合併；只有本機沒有修改時才直接採用雲端資料。確定繼續？')) return;
    if (cloudSyncInFlight.current) return setCloudStatus('正在同步雲端，請稍候');

    const syncStartedWithUnsavedWork=hasUnsavedWork.current;
    const cachedCloudIdentity=cachedCloudIdentityFor(syncConfig);
    const hasUnboundLocalCache=!cachedCloudIdentity&&localStorage.getItem(STORAGE_KEY)!==null;
    const previousCloudIdentity=cachedCloudIdentity||activeCloudIdentity.current;
    cloudSyncInFlight.current = true;
    setCloudSyncing(true);
    setCloudWriteBlocked(true);
    setSavePhase('saving');
    setCloudStatus('正在同步雲端最新資料…');
    configIoCoordinator.current.invalidate();
    const syncToken = configIoCoordinator.current.begin(syncConfig);
    const syncIdentity = cloudIdentity(syncToken.config);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    pendingCloudData.current.rejectAll(new StaleAsyncConfigError());
    if (cloudSaveInFlight.current) await cloudSaveInFlight.current.catch(() => undefined);
    try {
      const remote = await configIoCoordinator.current.run(syncToken, getSupabaseConfig, fetchCloudData);
      if (!configIoCoordinator.current.isCurrent(syncToken, getSupabaseConfig())) throw new StaleAsyncConfigError();
      const localSnapshot=liveData.current;
      const expectedRevision=lastCloudRevision.current;
      const baseSnapshot=confirmedCloudData.current;
      const hasLocalChanges=baseSnapshot?!appDataContentEqual(localSnapshot,baseSnapshot):localSnapshot.revision>expectedRevision;
      const durableRevisionFloor=durableCloudRevisionFloors.current.get(syncIdentity)??-1;
      const workspaceChanged=Boolean(previousCloudIdentity&&previousCloudIdentity!==syncIdentity);
      if(workspaceChanged||hasUnboundLocalCache)throw new CloudRebaseConflictError([workspaceChanged?'雲端工作區已變更，不能把舊工作區的本機資料自動合併、覆蓋或初始化到新工作區':'本機快取來源未綁定，即使目標工作區空白也不能自動綁定、初始化或覆蓋']);
      if (remote) {
        if(remote.revision<durableRevisionFloor)throw new CloudRebaseConflictError([`雲端revision ${remote.revision}低於已確認的durable floor ${durableRevisionFloor}，疑似rollback`]);
        assertRemoteExtendsDurableHistory(syncIdentity,baseSnapshot,remote);
        const prepared=prepareCloudSyncSnapshot(baseSnapshot,localSnapshot,remote,expectedRevision,nowIso(),currentUser.id);
        activeCloudIdentity.current = syncIdentity;
        lastCloudRevision.current = remote.revision;
        confirmCloudSnapshot(syncIdentity,remote);
        setData(prepared);
        setCloudWriteBlocked(false);
        rememberCloudIdentity();
        if(hasLocalChanges){
          await enqueueCloudSave(prepared);
        }else{
          hasUnsavedWork.current=false;
          setSavePhase('saved');
          setCloudStatus(savedStatus('已同步雲端', remote.updatedAt));
          showSaveToast('success','已同步雲端最新資料','本頁沒有未保存修改，現在可以安全關閉或重新整理。');
        }
        setStaleBrowserRecoveryOffered(false);
      } else {
        if(durableRevisionFloor>=0)throw new CloudRebaseConflictError([`雲端主資料遺失，但此工作區已有durable revision ${durableRevisionFloor}，拒絕以本機資料重新初始化`]);
        throw new CloudRebaseConflictError(['雲端工作區沒有主資料，已禁止從瀏覽器初始化']);
      }
    } catch (error: any) {
      hasUnsavedWork.current=syncStartedWithUnsavedWork;
      setCloudWriteBlocked(true);
      setSavePhase('error');
      const failure=classifyCloudSyncFailure(error);
      if(shouldOfferStaleBrowserRecovery(failure.kind))setStaleBrowserRecoveryOffered(true);
      const detail=failure.message;
      setCloudStatus(detail);
      showSaveToast('error','同步未完成',`${detail} 請先不要關閉頁面。請稍後再嘗試保存。`);
    } finally {
      cloudSyncInFlight.current = false;
      setCloudSyncing(false);
    }
  };
  const saveChanges = async () => {
    const failedAttentionVesselIds=Object.entries(vesselAttentionSaveStates).filter(([,state])=>state.phase==='error').map(([vesselId])=>vesselId);
    if(failedAttentionVesselIds.length){
      failedAttentionVesselIds.forEach(vesselId=>vesselAttentionSaveQueue.current?.retry(vesselId));
      hasUnsavedWork.current=true;
      setSavePhase('dirty');
      setCloudStatus('正在重試保存關注燈…');
      return;
    }
    if (!getSupabaseConfig()) {
      if(saveLocal(data)){
        hasUnsavedWork.current=false;
        setSavePhase('saved');
        setCloudStatus(savedStatus('已保存於本機瀏覽器'));
        showSaveToast('success','已保存於本機瀏覽器','目前未連接雲端，資料已保存在這個瀏覽器。');
      }else{
        hasUnsavedWork.current=true;
        setSavePhase('error');
        setCloudStatus('本機保存失敗：瀏覽器儲存空間不足或不可用');
        showSaveToast('error','本機保存失敗','瀏覽器儲存空間不足或不可用，請不要關閉頁面。');
      }
      return;
    }
    if (cloudSyncInFlight.current) { setCloudStatus('正在同步雲端，完成後才能保存');showSaveToast('info','正在同步雲端','同步完成後系統會繼續處理尚未保存的修改。');return; }
    if (cloudWriteBlocked) { hasUnsavedWork.current=true;setSavePhase('error');setCloudStatus('這些修改尚未保存到雲端：請先同步最新，再重新保存');showSaveToast('error','尚未保存到雲端','請先點擊「同步最新（安全合併）」；同步完成後，再點擊「重新保存」。直到畫面顯示「已保存到雲端」前，請不要關閉頁面。');return; }
    if (confirmedCloudData.current&&appDataContentEqual(data,confirmedCloudData.current)) {
      hasUnsavedWork.current=false;
      setSavePhase('saved');
      setCloudStatus(savedStatus('雲端已是最新版本',confirmedCloudData.current.updatedAt));
      showSaveToast('success','雲端已是最新版本','沒有尚未保存的修改，現在可以安全關閉或重新整理頁面。');
      return;
    }
    if (saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
    try { await enqueueCloudSave(data); }
    catch{/* enqueueCloudSave 已顯示持續狀態與醒目提醒 */}
  };
  const print = (title: string,mode:'default'|'work-center'='default') => {
    if (!canExportReports) return alert('目前角色未獲授權匯出或列印報告');
    setPrintTitle(title);
    if(mode==='work-center'){
      document.body.classList.add('printing-work-center');
      window.addEventListener('afterprint',()=>document.body.classList.remove('printing-work-center'),{once:true});
    }
    setTimeout(() => window.print(), 80);
  };
  const printReport = (reportDate:string) => {
    if (!canExportReports) return alert('目前角色未獲授權匯出或列印報告');
    printMorningReportPdf(reportDate);
  };
  const printReportCenter=async()=>{
    if(!canExportReports)return alert('目前角色未獲授權匯出或列印報告');
    let snapshot:ItineraryProjectionSnapshot;
    try{snapshot=await requireFreshItineraryProjection(activeVessels);}
    catch(error){console.error('Itinerary report-center refresh failed',error);return alert('無法確認最新正式 Itinerary；本次未列印，請稍後重試');}
    flushSync(()=>setReportPreviewLiveItinerarySnapshot(snapshot));
    window.addEventListener('afterprint',()=>setReportPreviewLiveItinerarySnapshot(null),{once:true});
    print('報告中心');
  };
  const jumpToTaskList = (mode: 'open' | 'high' | 'overdue') => {
    setFilters({ ...emptyFilters, priorities: mode === 'high' ? ['急','高'] : [], overdueOnly: mode === 'overdue' });
    navigateToTab('total');
  };
  const closeTaskEditor = async (requestGeneration=taskEditorRequestGeneration) => {
    if(!taskOpenRequests.current.isCurrent(requestGeneration))return;
    const closingLock=activeEditLockRef.current;
    const closesCurrentTaskLock=Boolean(closingLock&&(closingLock.sectionKey===`task:${editingTaskId}`||isTaskCreationLockKey(closingLock.sectionKey)));
    const closingLeaseOwnerId=closingLock?.leaseOwnerId||quarantinedCreationDraft?.leaseOwnerId;
    if(closesCurrentTaskLock&&closingLock&&!await releaseExclusiveItemLease(closingLock.sectionKey))return;
    const returnDestination=consumeCurrentTaskEditorSession(taskOpenRequests.current,requestGeneration);
    if(!returnDestination)return;
    clearCreationAttempt(creatingTask?.id,closingLeaseOwnerId);
    setEditingTaskId('');
    setTaskEditorRequestGeneration(0);
    setTaskEditorAuthorizationEpoch('');
    setTaskProgressVesselId('');
    setTaskReadOnlyData(null);
    setTaskReadOnlyReason('');
    setQuarantinedCreationDrafts(current=>{
      const ownerId=currentUser?.id;
      if(!ownerId||current[ownerId]?.task.id!==creatingTask?.id)return current;
      const next={...current};
      delete next[ownerId];
      return next;
    });
    setCreatingTask(null);
    if (returnDestination?.batchManaged) void openBatchManagedVessels();
    else if (returnDestination?.vesselId && activeVessels.some(vessel => vessel.id === returnDestination.vesselId)) void openVesselEditor(returnDestination.vesselId);
  };
  const closeVesselEditor=async(lock:ActiveEditLock|null)=>{
    const leaseIncident=vesselLeaseIncidentRef.current;
    if(editingVesselId&&leaseIncident&&classifyVesselLeaseIncidentClose(leaseIncident.mode)==='confirm-discard'&&leaseIncident.sectionKey===`vessel:${editingVesselId}`){
      const discardMessage=leaseIncident.mode==='frozen'
        ?'協作鎖已失效，目前內容只保留在這個視窗；關閉後無法恢復。確定放棄並關閉？'
        :'協作鎖正在重新確認，目前內容只保留在這個視窗；關閉後無法恢復。確定取消並關閉？';
      if(!confirm(discardMessage))return false;
      if(vesselSaveLeaseOwners.current.has(leaseIncident.leaseOwnerId)&&!await ensureCloudDurableBeforeLeaseRelease(leaseIncident.sectionKey))return false;
      vesselSaveLeaseOwners.current.delete(leaseIncident.leaseOwnerId);
      setEditingVesselId('');
      clearVesselLeaseIncident(leaseIncident.sectionKey,leaseIncident.leaseOwnerId);
      if(lock?.sectionKey===leaseIncident.sectionKey){
        const released=await releaseCurrentEditLock();
        if(!released){
          leaseCloudConfigs.current.delete(lock.leaseOwnerId);
          if(activeEditLockRef.current?.leaseOwnerId===lock.leaseOwnerId)activeEditLockRef.current=null;
          setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
          setSensitiveCloudStatus(`${lock.label} 已關閉；伺服器協作鎖將由有效期自動清理`,lock.sectionKey);
        }
      }
      return true;
    }
    if(!lock||!lock.sectionKey.startsWith('vessel:')||!lockCoordinator.current.isCurrent(lock.generation))return false;
    const releaseFailureIsAfterDurabilityBarrier=lock.status!=='owned'||await ensureCloudDurableBeforeLeaseRelease(lock.sectionKey);
    if(!releaseFailureIsAfterDurabilityBarrier)return false;
    if(!await releaseCurrentEditLock()){
      leaseCloudConfigs.current.delete(lock.leaseOwnerId);
      activeEditLockRef.current=null;
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      setSensitiveCloudStatus(`${lock.label} 已關閉；伺服器協作鎖將由有效期自動清理`,lock.sectionKey);
    }
    vesselSaveLeaseOwners.current.delete(lock.leaseOwnerId);
    setEditingVesselId('');
    clearVesselLeaseIncident(lock.sectionKey,lock.leaseOwnerId);
    return true;
  };
  closeVesselEditorRef.current=closeVesselEditor;
  const saveCloudConfiguration = async (config:SupabaseConfig) => {
    if(vesselLeaseIncidentRef.current){alert('仍有船舶快速更新草稿保留中；請先在該視窗明確放棄並關閉，再更改 Supabase 設定。');return false;}
    if(activeEditLockRef.current||batchManagedOpenRef.current||pendingTaskCreationsRef.current.length>0||vesselAttentionSaveQueue.current?.hasPending()){
      alert('目前仍有編輯中的項目、待同步新增要事或關注燈；請先看到「已保存到雲端」，再更改 Supabase 設定。');
      return false;
    }
    if(!await ensureCloudDurableBeforeLeaseRelease('cloud-config-change'))return false;
    try{
      const changed=await withPendingTaskCreationStorageLock(()=>{
        const durablePending=readPendingTaskCreations(window.localStorage);
        pendingTaskCreationsRef.current=durablePending;
        setPendingTaskCreations(durablePending);
        if(durablePending.length||activeEditLockRef.current||batchManagedOpenRef.current||vesselAttentionSaveQueue.current?.hasPending())return false;
        pendingTaskCreationRunGeneration.current+=1;
        saveSupabaseConfig(config);
        window.location.reload();
        return true;
      });
      if(!changed)alert('等待期間出現新的待同步要事、關注燈或編輯作業；已取消更改 Supabase 設定，請先等待全部保存完成。');
      return changed;
    }catch(error:any){
      alert(`無法安全更改 Supabase 設定：${error.message||error}`);
      return false;
    }
  };
  const leaveCurrentIdentity = async () => {
    if(vesselLeaseIncidentRef.current&&!await closeVesselEditorRef.current(activeEditLockRef.current))return;
    if(activeEditLockRef.current||batchManagedOpenRef.current){
      alert('目前仍有編輯中的項目；請先保存或關閉目前編輯器，再切換或退出身份。');
      return;
    }
    if(pendingTaskCreationsRef.current.length>0){
      alert('仍有新增要事等待保存到雲端；請保持此頁開啟，看到「已保存到雲端」後再切換或退出身份。');
      return;
    }
    if(vesselAttentionSaveQueue.current?.hasPending()){
      alert('仍有關注燈等待保存；請保持此頁開啟，待同步完成後再切換或退出身份。若顯示同步失敗，請先按「重試」。');
      return;
    }
    if(currentUser&&activeEditLock&&creationHandoffMatches(activeEditLock)&&creatingTask){
      const latestDraft=latestCreationDrafts.current.get(creatingTask.id);
      const attempt=creationAttempts.current.get(creatingTask.id);
      const submittedDraft=latestDraft?.leaseOwnerId===activeEditLock.leaseOwnerId?latestDraft.task:attempt?.leaseOwnerId===activeEditLock.leaseOwnerId?attempt.task:creatingTask;
      setQuarantinedCreationDrafts(current=>({...current,[currentUser.id]:{task:clone(submittedDraft),ownerUserId:currentUser.id,leaseOwnerId:activeEditLock.leaseOwnerId}}));
    }
    const leavingLock=activeEditLockRef.current;
    if(leavingLock?.status==='owned'&&!await ensureCloudDurableBeforeLeaseRelease(leavingLock.sectionKey))return;
    if(leavingLock&&!await releaseCurrentEditLock())return;
    const batchAuthorization=batchManagedAuthorization.current;
    if(batchAuthorization&&batchManagedOpenRef.current&&!await closeBatchManaged(batchAuthorization))return;
    if(batchManagedOpenRef.current)invalidateBatchManagedLocks('');
    try{
      const identityMayChange=await withPendingTaskCreationStorageLock(()=>{
        const durablePending=readPendingTaskCreations(window.localStorage);
        pendingTaskCreationsRef.current=durablePending;
        setPendingTaskCreations(durablePending);
        if(durablePending.length||vesselAttentionSaveQueue.current?.hasPending())return false;
        pendingTaskCreationRunGeneration.current+=1;
        taskOpenRequests.current.invalidate();
        setTab('dashboard');
        setSelectedVesselDetailId('');
        setEditingVesselId('');
        setEditingTaskId('');
        setTaskEditorRequestGeneration(0);
        setTaskEditorAuthorizationEpoch('');
        setTaskProgressVesselId('');
        setTaskReadOnlyData(null);
        setTaskReadOnlyReason('');
        setCreatingTask(null);
        setAgendaSelection([]);
        setBatchSelectedVesselIds([]);
        setReportPreviewOpen(false);
        setPasswordModalOpen(false);
        setPrintTitle('');
        localStorage.removeItem(CURRENT_USER_KEY);
        setCurrentUserId('');
        return true;
      });
      if(!identityMayChange){
        alert('等待期間出現新的待同步新增要事或關注燈；已取消切換身份，請先等待雲端保存完成。');
        return;
      }
    }catch(error:any){
      alert(`無法安全切換身份：${error.message||error}`);
      return;
    }
  };
  const readOnlyTask=taskEditorAuthorizationEpoch===authorizationEpoch?taskReadOnlyData?.tasks.find(task=>task.id===editingTaskId):undefined;
  const editingTask=taskEditorAuthorizationEpoch===authorizationEpoch?(readOnlyTask||(creatingTask&&canCreateTasks?selectTasksVisibleToUser([creatingTask],currentUser,taskVisibilityRelationships)[0]:roleVisibleTasks.find(task=>task.id===editingTaskId))):undefined;
  const taskEditorData=taskReadOnlyData?taskReadOnlyData as unknown as AppData:roleVisibleData;
  const taskEditorVisibleVessels=taskReadOnlyData?taskReadOnlyData.vessels as Vessel[]:activeVessels;
  const taskEditorUser=currentUser;
  const editingTaskScopeVessels=editingTask?taskVessels(editingTask,taskEditorData.vessels):[];
  const creatingVisibleTask=Boolean(creatingTask&&editingTask&&editingTask.id===creatingTask.id&&!taskReadOnlyData&&taskEditorAuthorizationEpoch===authorizationEpoch&&canCreateTasks);
  const canEditOverallTask=Boolean(creatingVisibleTask||(
    editingTask&&canEditBusinessContent&&currentUser.role!=='vessel'
    &&editingTaskScopeVessels.length===taskVesselIds(editingTask).length
    &&canAccessAllVessels(data.settings.rolePermissions,currentUser,editingTaskScopeVessels)
  ));
  const editingTaskCanMutate=Boolean(editingTask&&taskLockIsAuthorized(editingTask));
  const quarantinedCreationVisible=Boolean(creatingVisibleTask&&quarantinedCreationDraft&&quarantinedCreationDraft.ownerUserId===currentUser.id&&quarantinedCreationDraft.task.id===creatingTask?.id);
  const preservedCreationDraft=Boolean(creatingVisibleTask&&(quarantinedCreationVisible||(activeEditLock&&isTaskCreationLockKey(activeEditLock.sectionKey)&&activeEditLock.status==='error'&&activeEditLock.ownerUserId===currentUser.id&&activeEditLock.authorizationEpoch===authorizationEpoch)));
  const taskEditorReadOnly=Boolean(preservedCreationDraft||(!creatingVisibleTask&&(taskReadOnlyData||!editingTaskCanMutate)));
  const vesselLeaseIncidentForEditor=editingVesselId&&vesselLeaseIncident?.sectionKey===`vessel:${editingVesselId}`&&vesselLeaseIncident.ownerUserId===currentUser.id&&vesselLeaseIncident.authorizationEpoch===authorizationEpoch?vesselLeaseIncident:null;
  const vesselEditorLeaseAuthorized=Boolean(editingVesselId&&mutationLeaseIsOwned(`vessel:${editingVesselId}`));
  const vesselLeaseMode=vesselLeaseIncidentForEditor?.mode||'editable';
  const taskEditorLeaseAuthorized=Boolean((creatingVisibleTask&&(mutationLeaseIsOwned(taskCreationLockKey(editingTask!.vesselId,editingTask!.id))||preservedCreationDraft))||(editingTask&&!creatingVisibleTask&&(taskEditorReadOnly||mutationLeaseIsOwned(`task:${editingTask.id}`))));
  const saveVesselEditorDraft=async(candidate:Vessel)=>{
    const vesselId=editingVesselId;
    const sectionKey=`vessel:${vesselId}`;
    const expectedLock=activeEditLockRef.current;
    if(!vesselId||candidate.id!==vesselId||!expectedLock||expectedLock.sectionKey!==sectionKey)return false;
    const leaseIncident=vesselLeaseIncidentRef.current;
    if(leaseIncident?.sectionKey===sectionKey&&leaseIncident.leaseOwnerId===expectedLock.leaseOwnerId){setSensitiveCloudStatus(leaseIncident.message,sectionKey);return false;}
    if(!requireMutationLease(sectionKey))return false;
    let accepted=false;
    let changed=false;
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===liveCurrentUserId.current&&user.isActive)||null;
      const target=prev.vessels.find(item=>item.id===vesselId);
      if(!liveUser||!target||activeEditLockRef.current!==expectedLock||expectedLock.authorizationEpoch!==authorizationEpochFor(prev,liveUser)||!itemLeaseIsAuthorizedInSnapshot(sectionKey,prev)||!mutationLeaseIsOwned(sectionKey))return prev;
      accepted=true;
      const safeCandidate=applyItineraryOperationalWriteMask(target,candidate);
      if(vesselOperationalDraftEquals(target,safeCandidate))return prev;
      const draft=clone(prev);
      const draftTarget=draft.vessels.find(item=>item.id===vesselId);
      if(!draftTarget){accepted=false;return prev;}
      applyVesselOperationalDraft(draftTarget,safeCandidate,nowIso());
      changed=true;
      return withAudit(draft,liveUser,'快速更新船舶','vessel',vesselId,'保存快速更新並關閉');
    }));
    if(!accepted){
      requireMutationLease(sectionKey);
      return false;
    }
    if(changed)vesselSaveLeaseOwners.current.add(expectedLock.leaseOwnerId);
    return closeVesselEditor(expectedLock);
  };
  const closeBatchManaged=async(expectedAuthorization:BatchManagedAuthorization|null)=>{
    if(!expectedAuthorization||expectedAuthorization!==batchManagedAuthorization.current||expectedAuthorization.session!==batchManagedSession.current||!batchManagedOpenRef.current)return false;
    if(batchManagedCloseInFlight.current)return false;
    const operation=beginBatchManagedOperation();
    batchManagedCloseInFlight.current=true;
    batchManagedWriteSuspendedRef.current=true;
    setBatchManagedClosing(true);
    setBatchManagedWriteSuspended(true);
    setCloudStatus('正在保存批量更新；雲端確認前不會釋放船舶鎖');
    if(!await flushCloudBeforeBatchRelease(operation)){
      if(batchManagedOperationIsCurrent(operation)){
        batchManagedCloseInFlight.current=false;
        setBatchManagedClosing(false);
      }else await releaseBatchEditLockSnapshot(operation.locks,false);
      return false;
    }
    if(!batchManagedOperationIsCurrent(operation)){
      await releaseBatchEditLockSnapshot(operation.locks,false);
      return false;
    }
    taskOpenRequests.current.invalidate();
    const released=await releaseBatchEditLockSnapshot(operation.locks,false);
    if(!batchManagedOperationIsCurrent(operation))return false;
    detachBatchManagedState(released?'批量更新已保存，全部船舶鎖已釋放':'批量更新已保存，但部分船舶鎖釋放失敗；暫不進入下一個編輯流程');
    return released;
  };
  const cancelBatchManagedDrafts=async(expectedAuthorization:BatchManagedAuthorization|null)=>{
    if(!expectedAuthorization||expectedAuthorization!==batchManagedAuthorization.current||expectedAuthorization.session!==batchManagedSession.current||!batchManagedOpenRef.current)return false;
    if(batchManagedCloseInFlight.current)return false;
    const operation=beginBatchManagedOperation();
    batchManagedCloseInFlight.current=true;
    batchManagedWriteSuspendedRef.current=true;
    setBatchManagedClosing(true);
    setBatchManagedWriteSuspended(true);
    setCloudStatus('正在取消批量更新並釋放船舶鎖');
    taskOpenRequests.current.invalidate();
    const released=await releaseBatchEditLockSnapshot(operation.locks,false);
    if(!batchManagedOperationIsCurrent(operation))return false;
    detachBatchManagedState(released?'已取消本批修改，全部船舶鎖已釋放':'已取消本批修改；部分船舶鎖釋放失敗，重新開啟前會先重試釋放');
    return released;
  };
  const discardBatchManagedChanges=async(expectedAuthorization:BatchManagedAuthorization|null)=>{
    if(!expectedAuthorization||expectedAuthorization!==batchManagedAuthorization.current||expectedAuthorization.session!==batchManagedSession.current||!batchManagedOpenRef.current)return;
    if(batchManagedCloseInFlight.current)return;
    if(!confirm('這會放棄本批尚未保存到雲端的修改，以最新雲端資料取代目前本機畫面，並釋放全部船舶鎖。確定繼續？'))return;
    const config=getSupabaseConfig();
    if(!config)return alert('目前是本機模式，沒有雲端版本可供恢復');
    const sessionAuthorization=batchManagedAuthorization.current;
    const discardConfigIsCurrent=()=>Boolean(sessionAuthorization&&sessionAuthorization===batchManagedAuthorization.current&&sessionAuthorization.cloudIdentity===cloudConfigIdentity(config)&&sameCloudConfig(getSupabaseConfig(),config));
    if(!discardConfigIsCurrent())return alert('雲端設定已變更，為避免跨工作區覆蓋，已拒絕放棄本批修改；船舶鎖與本機內容仍保留');
    const operation=beginBatchManagedOperation();
    batchManagedCloseInFlight.current=true;
    batchManagedWriteSuspendedRef.current=true;
    setBatchManagedClosing(true);
    setBatchManagedWriteSuspended(true);
    setCloudSyncing(true);
    cloudSyncInFlight.current=true;
    configIoCoordinator.current.invalidate();
    const token=configIoCoordinator.current.begin(config);
    if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
    pendingCloudData.current.rejectAll(new StaleAsyncConfigError());
    if(cloudSaveInFlight.current)await cloudSaveInFlight.current.catch(()=>undefined);
    let releasedDuringDiscard=false;
    try{
      if(!batchManagedOperationIsCurrent(operation)){
        await releaseBatchEditLockSnapshot(operation.locks,false);
        return;
      }
      if(!discardConfigIsCurrent())throw new StaleAsyncConfigError();
      const remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);
      if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
      if(!remote)throw new Error('雲端目前沒有可恢復的主資料');
      if(!batchManagedOperationIsCurrent(operation)||!discardConfigIsCurrent())throw new StaleAsyncConfigError();
      assertRemoteExtendsDurableHistory(cloudIdentity(token.config),confirmedCloudData.current,remote);
      const released=await releaseBatchEditLockSnapshot(operation.locks,false);
      releasedDuringDiscard=released;
      if(!batchManagedOperationIsCurrent(operation))return;
      if(!discardConfigIsCurrent())throw new StaleAsyncConfigError();
      detachBatchManagedState('');
      activeCloudIdentity.current=cloudIdentity(token.config);
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(cloudIdentity(token.config),remote);
      setData(remote);
      setCloudWriteBlocked(false);
      rememberCloudIdentity();
      hasUnsavedWork.current=false;
      setSavePhase('saved');
      setCloudStatus(released?savedStatus('已放棄本批修改、同步最新雲端並釋放全部船舶鎖',remote.updatedAt):'已放棄本批修改並同步最新雲端；部分船舶鎖釋放失敗，重新開啟批量更新前會先重試釋放');
      showSaveToast(released?'success':'warning',released?'已恢復雲端版本':'已恢復雲端版本，部分鎖待釋放',released?'本批未保存修改已放棄，現在可以安全關閉或重新整理頁面。':'本批未保存修改已放棄；資料已同步，但重新編輯前會先重試釋放船舶鎖。');
    }catch(error:any){
      if(batchManagedOperationIsCurrent(operation)){
        setCloudWriteBlocked(true);
        if(releasedDuringDiscard)detachBatchManagedState(`雲端設定於釋放船舶鎖期間變更；本機資料未被舊工作區remote取代，已安全關閉失去協作鎖的批量視窗`);
        else{
          batchManagedCloseInFlight.current=false;
          setBatchManagedClosing(false);
          setCloudStatus(`無法放棄本批修改：${error.message||error}；船舶鎖仍保留`);
        }
      }else await releaseBatchEditLockSnapshot(operation.locks,false);
    }finally{
      cloudSyncInFlight.current=false;
      setCloudSyncing(false);
    }
  };
  const refreshBatchAfterLeaseBundle=async(config:ResolvedSupabaseConfig,targetIds:Set<string>,sessionIsCurrent:()=>boolean):Promise<AppData|null>=>{
    try{
      if(saveTimer.current){window.clearTimeout(saveTimer.current);saveTimer.current=null;}
      const beforeSave=confirmedCloudData.current;
      if(!beforeSave||!appDataContentEqual(liveData.current,beforeSave))await enqueueCloudSave(liveData.current,sessionIsCurrent);
      if(!sessionIsCurrent())return null;
      const confirmed=confirmedCloudData.current;
      if(!confirmed)throw new Error('沒有可驗證的已保存雲端基線');
      const token=configIoCoordinator.current.begin(config);
      const remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);
      if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig())||!sessionIsCurrent())return null;
      if(!remote)throw new Error('雲端工作區尚未建立');
      assertRemoteExtendsDurableHistory(cloudIdentity(config),confirmed,remote);
      const resolution=resolveItemEditSession({
        live:liveData.current,confirmed,remote,equals:appDataContentEqual,
        select:snapshot=>[...targetIds].every(id=>snapshot.vessels.some(vessel=>vessel.id===id&&vessel.isActive))?[...targetIds]:undefined,
        authorize:(snapshot,ids)=>{
          const actor=snapshot.users.find(user=>user.id===currentUser.id&&user.isActive);
          return Boolean(actor&&actor.role!=='vessel'&&hasPermission(snapshot.settings.rolePermissions,actor,'editBusinessContent')&&ids.every(id=>batchVisibleVesselIds(snapshot,actor).has(id)));
        },
      });
      if(resolution.status!=='ready')throw new Error(resolution.status==='local-dirty'?'仍有修改尚未完成雲端保存':resolution.status==='missing'?'至少一艘船舶已刪除或停用':resolution.status==='unauthorized'?'最新雲端權限已撤銷至少一艘船舶的編輯權':'雲端 revision 早於已確認基線');
      activeCloudIdentity.current=cloudIdentity(config);
      lastCloudRevision.current=remote.revision;
      confirmCloudSnapshot(cloudIdentity(config),remote);
      liveData.current=remote;
      setData(remote);
      setCloudWriteBlocked(false);
      return remote;
    }catch(error:any){
      setCloudStatus(`批量船舶鎖取得後無法安全刷新：${error.message||error}`);
      return null;
    }
  };
  const openBatchManagedVessels=async()=>{
    if(batchManagedRequested.current||batchManagedOpenRef.current)return;
    if(!canEditBusinessContent||currentUser.role==='vessel')return alert('目前身份無權批量更新船舶');
    if(!batchTargetVessels.length)return alert('請先在船舶看板逐船勾選本次要批量更新的船舶');
    invalidatePendingTaskOpen();
    const pendingReleases=pendingTrackedLeases(batchLeaseReleaseState.current);
    if(pendingReleases.length&&!await releaseBatchEditLockSnapshot(pendingReleases,false))return alert('上一批船舶協作鎖尚未成功釋放，請稍後再試');
    const previousLock=activeEditLockRef.current;
    if(previousLock?.status==='owned'&&!await ensureCloudDurableBeforeLeaseRelease(previousLock.sectionKey))return;
    if(!(await releaseCurrentEditLock()))return alert('上一個協作鎖尚未成功釋放，暫不開啟批量更新');
    batchTargetVesselIdsRef.current=new Set(batchTargetVessels.map(vessel=>vessel.id));
    const session=++batchManagedSession.current;
    batchManagedRequested.current=true;
    batchManagedCloseInFlight.current=false;
    batchManagedWriteSuspendedRef.current=false;
    setBatchManagedClosing(false);
    setBatchManagedWriteSuspended(false);
    batchManagedAuthorization.current=null;
    const sessionIsCurrent=()=>batchManagedRequested.current&&batchManagedSession.current===session&&liveAuthorizationEpoch.current===authorizationEpoch;
    const config=getSupabaseConfig();
    if(!config){
      if(!sessionIsCurrent())return;
      batchLocalMode.current=true;
      batchManagedAuthorization.current=createBatchManagedAuthorization({session,authorizationEpoch,userId:currentUser.id,cloudIdentity:''});
      batchManagedOpenRef.current=true;
      setBatchManagedOpen(true);
      setBatchSelectedVesselIds([]);
      setCloudStatus('本機模式：批量更新不需要雲端協作鎖');
      return;
    }
    batchLocalMode.current=false;
    const generation=batchLockCoordinator.current.beginGeneration();
    const requests=[...batchTargetVessels].sort((a,b)=>a.id.localeCompare(b.id)).map(vessel=>({sectionKey:`vessel:${vessel.id}`,label:vesselDisplayName(vessel),leaseOwnerId:uid('batch-lease')}));
    const result=await batchLockCoordinator.current.run(()=>acquireEditLockBundle(
      requests,
      request=>{registerTrackedLease(batchLeaseReleaseState.current,request,config);return runCloudSaveQueueRpc('取得批量船舶協作鎖',signal=>claimEditLock(request.sectionKey,request.leaseOwnerId,currentUser.name,75,config,signal),8_000);},
      async request=>{if(!await releaseTrackedLeases(batchLeaseReleaseState.current,[request],(lease,releaseConfig)=>runCloudSaveQueueRpc('回滾批量船舶協作鎖',signal=>releaseEditLock(lease.sectionKey,lease.leaseOwnerId,releaseConfig,signal),8_000)))throw new Error('批量協作鎖回滾失敗');},
      ()=>sessionIsCurrent()&&batchLockCoordinator.current.isCurrent(generation)&&sameCloudConfig(getSupabaseConfig(),config),
    ));
    if(result.status!=='owned'){
      if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(generation))return;
      batchManagedRequested.current=false;
      if(result.cleanupUnresolved.length)setCloudStatus('批量協作鎖回滾未完全成功；重新開啟前會先重試釋放');
      if(result.status==='blocked')alert(`${result.label} 正在由 ${result.lockedByName} 編輯；未開啟批量更新，已回滾其他船舶鎖。`);
      else if(result.status==='unavailable')alert('無法確認全部本次選取船舶的協作鎖；未開啟批量更新，請稍後再試。');
      return;
    }
    if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(generation)){
      const staleLocks:ActiveEditLock[]=result.leases.map(lease=>({...lease,status:'owned',ownerUserId:currentUser.id,ownerUserName:currentUser.name,generation,authorizationEpoch,validatedUntilMs:conservativeLeaseDeadline(lease.expiresAt)}));
      void releaseBatchEditLockSnapshot(staleLocks,false);
      return;
    }
    const locks:ActiveEditLock[]=result.leases.map(lease=>({...lease,status:'owned',ownerUserId:currentUser.id,ownerUserName:currentUser.name,generation,authorizationEpoch,validatedUntilMs:conservativeLeaseDeadline(lease.expiresAt)}));
    const refreshed=await refreshBatchAfterLeaseBundle(config,batchTargetVesselIdsRef.current,()=>sessionIsCurrent()&&batchLockCoordinator.current.isCurrent(generation)&&sameCloudConfig(getSupabaseConfig(),config));
    if(!refreshed){
      batchManagedRequested.current=false;
      const released=await releaseBatchEditLockSnapshot(locks,false);
      alert(released?'取得船舶鎖後無法安全讀取最新資料；已回滾全部船舶鎖。':'取得船舶鎖後無法安全讀取最新資料，且部分鎖尚待釋放；請稍後再試。');
      return;
    }
    batchEditLocksRef.current=locks;
    setBatchEditLocks(locks);
    batchManagedAuthorization.current=createBatchManagedAuthorization({session,authorizationEpoch,userId:currentUser.id,cloudIdentity:cloudConfigIdentity(config)});
    batchManagedOpenRef.current=true;
    setBatchManagedOpen(true);
    setBatchSelectedVesselIds([]);
    setCloudStatus(`已鎖定本次手動選取的 ${locks.length} 艘船舶，可安全批量編輯`);
  };
  const renderedBatchManagedAuthorization=batchManagedAuthorization.current;
  const batchMutationLeaseIsOwned=(sectionKey:string,snapshot:AppData=liveData.current,renderedAuthorization:BatchManagedAuthorization|null=renderedBatchManagedAuthorization)=>{
    if(batchManagedWriteSuspendedRef.current)return false;
    const vesselId=sectionKey.startsWith('vessel:')?sectionKey.slice('vessel:'.length):'';
    const liveUser=snapshot.users.find(user=>user.id===liveCurrentUserId.current&&user.isActive)||null;
    const vessel=snapshot.vessels.find(item=>item.id===vesselId&&item.isActive);
    const currentAuthorizationEpoch=authorizationEpochFor(snapshot,liveUser);
    if(!batchManagedRequested.current||!batchManagedOpenRef.current||!batchMutationSessionIsCurrent({renderedAuthorization,currentAuthorization:batchManagedAuthorization.current,currentSession:batchManagedSession.current,liveAuthorizationEpoch:currentAuthorizationEpoch,liveUserId:liveUser?.id||'',currentCloudIdentity:cloudConfigIdentity(getSupabaseConfig())}))return false;
    if(!liveUser||liveUser.role==='vessel'||!hasPermission(snapshot.settings.rolePermissions,liveUser,'editBusinessContent')||!vessel||!batchTargetVesselIdsRef.current.has(vesselId)||!batchVisibleVesselIds(snapshot,liveUser).has(vesselId))return false;
    if(batchLocalMode.current)return true;
    const lock=batchEditLocksRef.current.find(item=>item.sectionKey===sectionKey);
    const record=lock?batchLeaseReleaseState.current.records.get(lock.leaseOwnerId):undefined;
    return editLockAllowsMutation(lock,sectionKey,liveUser.id,currentAuthorizationEpoch,Boolean(lock&&batchLockCoordinator.current.isCurrent(lock.generation)),Boolean(record&&record.sectionKey===sectionKey&&sameCloudConfig(getSupabaseConfig(),record.config)));
  };
  const batchLockedVesselIds=batchSessionVessels.map(vessel=>vessel.id).filter(id=>batchMutationLeaseIsOwned(`vessel:${id}`));
  const saveBatchManagedDrafts=async(candidates:Vessel[])=>{
    const mutationAuthorization=renderedBatchManagedAuthorization;
    if(!mutationAuthorization||mutationAuthorization!==batchManagedAuthorization.current||mutationAuthorization.session!==batchManagedSession.current||!batchManagedOpenRef.current)return false;
    const expectedIds=[...batchTargetVesselIdsRef.current].sort();
    const submittedIds=candidates.map(vessel=>vessel.id).sort();
    if(new Set(submittedIds).size!==submittedIds.length||expectedIds.length!==submittedIds.length||expectedIds.some((id,index)=>id!==submittedIds[index])){
      alert('批量草稿的船舶範圍已變更；為避免更新錯船，本次未保存。');
      return false;
    }
    let accepted=false;
    flushSync(()=>setData(prev=>{
      if(candidates.some(candidate=>!batchMutationLeaseIsOwned(`vessel:${candidate.id}`,prev,mutationAuthorization)))return prev;
      const liveUser=prev.users.find(user=>user.id===liveCurrentUserId.current&&user.isActive);
      if(!liveUser)return prev;
      const candidateById=new Map(candidates.map(candidate=>[candidate.id,candidate]));
      const changed=expectedIds.filter(id=>{
        const target=prev.vessels.find(vessel=>vessel.id===id);
        const candidate=candidateById.get(id);
        const safeCandidate=target&&candidate?applyItineraryOperationalWriteMask(target,candidate):undefined;
        return Boolean(target&&safeCandidate&&!vesselOperationalDraftEquals(target,safeCandidate));
      });
      if(expectedIds.some(id=>!candidateById.has(id)||!prev.vessels.some(vessel=>vessel.id===id)))return prev;
      accepted=true;
      if(!changed.length)return prev;
      let draft=clone(prev);
      const savedAt=nowIso();
      changed.forEach(id=>{
        const target=draft.vessels.find(vessel=>vessel.id===id);
        const candidate=candidateById.get(id);
        if(!target||!candidate)return;
        applyVesselOperationalDraft(target,applyItineraryOperationalWriteMask(target,candidate),savedAt);
        draft=withAudit(draft,liveUser,'批量更新船舶','vessel',id,'保存批量更新並關閉');
      });
      return draft;
    }));
    if(!accepted){
      alert('至少一艘船舶的協作鎖、身份或權限已失效；本次未保存。');
      return false;
    }
    return closeBatchManaged(mutationAuthorization);
  };

  return <div className="app">
    <header className="topbar no-print"><div className="topbar-inner">
      <div className="brand"><img className="brand-icon" src={fpmcLogo} alt="台塑 LOGO" /><span><b>{SYSTEM_TITLE}</b><small>{SYSTEM_SUBTITLE}</small></span></div>
      <nav className="nav topbar-primary-nav">
        {([['dashboard','船隊看板'],['morning','早會工作台'],['meeting','臨會/專題'],['work',`我的待辦${myWorkTaskCount?`（${myWorkTaskCount}）`:''}`],['total',currentUser.role==='vessel'?'本船待辦':'待辦總表'],['closed','已結案'],['internalControl','內控異常'],['reports','報告中心'],['stats','數據分析'],['management','管理']] as [Tab,string][]).filter(([k])=>canAccessTab(currentUser, k)&&(k!=='reports'||canExportReports)&&(k!=='management'||canEnterManagement)).map(([k,label]) => <button key={k} className={`${tab===k?'active':''} ${tab!==k&&['dashboard','work','internalControl'].includes(k)?'gradient-nav-label':''}`.trim()} onClick={() => { if (!canAccessTab(currentUser,k)) return; if (k==='reports' && !canExportReports) return alert('目前角色未獲授權預覽或匯出報告'); if (k==='management' && !requireManage()) return; navigateToTab(k); }}>{label}</button>)}
      </nav>
      <div className="user-chip"><span className="cloud-dot"/><button type="button" className="user-name-btn" onClick={() => setPasswordModalOpen(true)} title="修改個人密碼">{currentUser.name}｜{roleLabel(currentUser.role)}</button><button className="btn small ghost" onClick={() => void leaveCurrentIdentity()}>切換/退出</button></div>
    </div></header>
    {appVersionUpdateNotice}
    {saveToast&&<div className="save-toast-layer no-print" aria-live="assertive" aria-atomic="true"><div className={`save-toast ${saveToast.kind}`} role="status"><span className="save-toast-icon">{saveToast.kind==='success'?'✓':saveToast.kind==='error'?'!':saveToast.kind==='warning'?'⚠':'↻'}</span><span><b>{saveToast.title}</b><small>{saveToast.detail}</small></span><button type="button" aria-label="關閉保存提醒" onClick={dismissSaveToast}>×</button><i /></div></div>}
    <main className="container">
      <div className={`cloud-strip save-status-strip no-print ${savePhase}`} aria-live="polite"><span className="save-phase"><b>{savePhaseLabel[savePhase]}</b><small>{visibleCloudStatus}</small></span><span className="spacer"/>{tab==='dashboard'&&!selectedVesselDetailId&&<button className={`btn small browser-recovery-entry ${staleBrowserRecoveryOffered?'red':'ghost'}`} onClick={()=>openBrowserRecovery()} title={staleBrowserRecoveryOffered?'開啟瀏覽器修復與完整本機重設':'修復此瀏覽器的顯示或載入問題'}>修復此瀏覽器</button>}<button className={`btn small ${cloudWriteBlocked&&savePhase==='error'?'primary guidance-active':'ghost'}`} onClick={syncLatest} disabled={isSaveBusy}>同步最新（安全合併）</button><button className={`btn small ${savePhase==='error'?'red':savePhase==='dirty'?'primary':'green'} ${!cloudWriteBlocked&&savePhase==='error'?'guidance-active':''}`} onClick={saveChanges} disabled={isSaveBusy}>{saveButtonLabel}</button></div>
      {itineraryOperationalProblem&&<aside className="collaboration-banner stale no-print" role="status"><b>Itinerary 營運資訊同步異常</b><span>{itineraryOperationalProblem.error||'目前保留最後確認版本；正式早會及報告會停止，直到能重新確認雲端正式 Itinerary。'}</span></aside>}
      {(savePhase!=='saved'||pendingTaskCreations.length>0)&&<aside className={`unsaved-work-guidance no-print ${cloudWriteBlocked?'conflict':'pending'}`} role="alert"><b>{pendingTaskCreations.length>0?`有 ${pendingTaskCreations.length} 筆新增要事正在等待雲端保存`:cloudWriteBlocked?'這些修改還沒有保存到雲端':'關閉前請先完成上傳保存'}</b>{pendingTaskCreations.length>0?<span>草稿已保存在這個瀏覽器，系統會在其他人完成船舶更新後自動重讀最新雲端資料並重試。請保持本頁開啟。</span>:cloudWriteBlocked?<ol><li>先點擊「同步最新（安全合併）」</li><li>同步完成後，再點擊「重新保存」</li></ol>:<span>請先點擊上方的保存按鈕，並等待雲端確認。</span>}<strong>直到畫面顯示「已保存到雲端」，看到「已保存到雲端」後再關閉網頁、瀏覽器或電腦；否則尚未上傳的修改可能遺失。</strong>{pendingTaskCreations.some(intent=>intent.state==='attention')&&<small>其中有草稿因身份、權限或資料識別異常而暫停自動保存；請勿關閉頁面，並先確認頁首提示。</small>}</aside>}
      {currentUser.role!=='vessel'&&activeEditLock&&authorizedEditLockKeys.has(activeEditLock.sectionKey)&&activeEditLock.authorizationEpoch===authorizationEpoch&&activeEditLock.ownerUserId===currentUser.id && <div className={`collaboration-banner no-print ${activeEditLock.status}`}><b>多人協作安全</b><span>{activeEditLock.status==='owned' ? `你正在編輯：${activeEditLock.label}；系統已建立短時鎖定，保存仍會做 revision 衝突檢查。` : activeEditLock.status==='blocked' ? `此項目正在由 ${activeEditLock.lockedByName || '其他使用者'} 編輯，已阻止打開以避免覆蓋對方內容。` : preservedCreationDraft ? '新增要事協作鎖已失效；草稿仍以唯讀方式保留，請複製內容後關閉並重新取得協作鎖。' : `無法確認 ${activeEditLock.label} 的編輯鎖；編輯器已關閉，請重試釋放。`}</span>{activeEditLock.status!=='owned'&&<button className="btn small ghost" onClick={resolveEditLockNotice}>{activeEditLock.status==='blocked'?'知道了':preservedCreationDraft?'關閉唯讀草稿':'重試釋放並關閉'}</button>}</div>}
      <div className="print-only app-print-header"><h2>{printTitle || data.settings.systemTitle}</h2><p>列印時間：{formatTaipeiDateTime(new Date())}｜列印人：{currentUser.name}</p></div>
      {canAccessTab(currentUser,tab) && <>{tab==='dashboard' && selectedVesselDetail && <VesselDetailPage vessel={selectedVesselDetail} data={roleVisibleData} currentUser={currentUser} itineraryFeedRecord={itineraryOperationalFeed.records[selectedVesselDetail.id]} onBack={closeVesselDetail} onOpenInternalControl={()=>{if(!canAccessTab(currentUser,'internalControl'))return;navigateToTab('internalControl');}} onEditVessel={()=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');void openVesselEditor(selectedVesselDetail.id);}} onAddTask={()=>addTaskForVessel(selectedVesselDetail.id)} onEditTask={id=>{const task=roleVisibleTasks.find(item=>item.id===id);if(task)openTask(task,selectedVesselDetail.id);}} canEditVessel={canEditBusinessContent} canCreateTasks={canCreateTasks} canEditTasks={canEditBusinessContent&&currentUser.role!=='vessel'} canViewInternalControl={canAccessTab(currentUser,'internalControl')} />}
      {tab==='dashboard' && !selectedVesselDetail && <DashboardView user={currentUser} itineraryActor={{userId:currentUser.id}} itineraryOperationalFeed={itineraryOperationalFeed} users={roleVisibleData.users} vessels={dashboardVessels} tasks={roleVisibleTasks} calendarTasks={data.tasks} internalControlCases={roleVisibleData.internalControlCases} meetings={dashboardMeetings} selected={agendaSelection} setSelected={setAgendaSelection} batchSelected={batchSelectedVesselIds} setBatchSelected={setBatchSelectedVesselIds} onOpenVessel={openVesselDetail} onEdit={id=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');void openVesselEditor(id);}} onAddTask={addTaskForVessel} onToggleAttention={toggleDashboardVesselAttention} attentionSaveStates={vesselAttentionSaveStates} onRetryAttentionSave={retryDashboardVesselAttention} onAdjustAttention={adjustDashboardVesselAttention} onStartMeeting={(requestedIds) => { if (requestedIds) { const allowedIds=new Set(activeVessels.map(vessel=>vessel.id)); setAgendaSelection(Array.from(new Set(requestedIds.filter(id=>allowedIds.has(id))))); } else if (!agendaSelection.length) { const priority = activeVessels.filter(v => morningDiscussionTasks(roleVisibleTasks,roleVisibleMeetings).some(t => taskHasVessel(t,v.id) && !taskIsClosedForVessel(t,v.id) && (t.priority==='急'||t.priority==='高'))).slice(0,4).map(v=>v.id); setAgendaSelection(priority.length ? priority : activeVessels.slice(0,4).map(v=>v.id)); } navigateToTab('morning'); }} onOpenReport={openReportPreview} onTaskMetric={jumpToTaskList} onOpenBatchManagedVessels={()=>{void openBatchManagedVessels();}} canEdit={canEditBusinessContent} canCreateTasks={canCreateTasks} canUseMeetings={canUseMeetingWorkspace} canUseReports={canExportReports} />}
      {tab==='morning' && <MorningWorkspaceView data={roleVisibleData} user={currentUser} visibleVessels={dashboardVessels} selected={agendaSelection} setSelected={setAgendaSelection} onEditTask={openTask} onOpenInternalControl={caseId=>{if(caseId)setRequestedInternalControlCaseId(caseId);navigateToTab('internalControl');}} onAddTask={addTaskForVessel} onOpenVessel={openVesselEditor} onOpenTemporaryMeeting={()=>navigateToTab('meeting')} onOpenReport={openReportPreview} canSaveDailyMorning={currentUser.role==='owner'||currentUser.role==='admin'} onSaveDailyMorning={saveDailyMorningHistory} />}

      {tab==='total' && <ListPanel title={currentUser.role==='vessel'?'本船待辦清單':'總清單'} tasks={filteredTasks} data={roleVisibleData} visibleVessels={activeVessels} filters={filters} setFilters={setFilters} fleetTags={fleetTags} userMap={userMap} exportedBy={currentUser.name} onEdit={openTask} onPrint={() => print('船舶記事總清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='work' && <WorkCenter
        data={roleVisibleData}
        user={currentUser}
        vessels={activeVessels}
        onOpenTask={openTask}
        onOpenInternalControl={caseId=>{if(caseId)setRequestedInternalControlCaseId(caseId);navigateToTab('internalControl');}}
        onOpenVessel={openVesselEditor}
        onBatchComplete={batchCompleteTasks}
        onDismiss={dismissFromMyWorkCenter}
        onBatchDelete={(taskIds,caseIds)=>batchDeleteTasks(taskIds,caseIds,true)}
        canComplete={canCloseTasks&&currentUser.role!=='vessel'}
        canDelete={canDeleteTasks}
        canPrint={canExportReports}
        onPrint={()=>print('我的待辦清單','work-center')}
        markAllRead={()=>setData(previous=>markOwnNotificationsRead(previous,currentUser.id,nowIso()))}
      />}
      {tab==='closed' && <ListPanel title="已結案清單" tasks={closedTasks} data={roleVisibleData} visibleVessels={activeVessels} filters={closedFilters} setFilters={setClosedFilters} fleetTags={fleetTags} userMap={userMap} exportedBy={currentUser.name} onEdit={openTask} onPrint={() => print('已結案清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='internalControl' && canAccessTab(currentUser,'internalControl') && <InternalControlPage data={roleVisibleData} user={currentUser} vessels={activeVessels} canCreate={canCreateTasks&&currentUser.role!=='vessel'} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canClose={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} canExport={canExportReports} authorizationEpoch={authorizationEpoch} requestedCaseId={requestedInternalControlCaseId} onRequestedCaseHandled={()=>setRequestedInternalControlCaseId('')} onCreate={createInternalCases} onUpdate={saveInternalCase} onWithdrawTaskSync={withdrawInternalCaseTaskSync} onDelete={removeInternalCase} onBatchClose={caseIds=>batchCompleteTasks([],caseIds)} onBatchDelete={caseIds=>batchDeleteTasks([],caseIds)} onOpenTask={taskId=>{const task=data.tasks.find(item=>item.id===taskId);if(task)void openTask(task);else alert('關聯要事不存在');}} claimItemLease={claimExclusiveItemLease} requireItemLease={requireMutationLease} releaseItemLease={releaseExclusiveItemLease} activeItemLeaseKey={activeEditLock?.status==='owned'?activeEditLock.sectionKey:''} />}
      {tab==='stats' && <DataAnalysisView data={roleVisibleData} vessels={canViewAllVessels?reportVessels:activeVessels} />}
      {tab==='meeting' && <TemporaryMeetingsPage data={roleVisibleData} visibleVessels={activeVessels} currentUser={currentUser} canExportReports={canExportReports} canCloseTasks={canCloseTasks&&currentUser.role!=='vessel'} onOpenDecisionTask={openMeetingTaskFromMeetingPage} onTransitionDecisionTask={transitionMeetingTaskFromMeetingPage} setData={setData} commit={commit} claimItemLease={claimExclusiveItemLease} requireItemLease={requireMutationLease} releaseItemLease={releaseExclusiveItemLease} runDurableRelatedMutation={runDurableRelatedMutation} activeItemLeaseKey={activeEditLock?.status==='owned'?activeEditLock.sectionKey:''} />}

      {tab==='reports' && <ReportCenter
        data={roleVisibleData} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} setSelected={setAgendaSelection}
        canSaveDailyMorning={currentUser.role==='owner'||currentUser.role==='admin'} onSaveDailyMorning={saveDailyMorningHistory} onOpenPreview={openReportPreview} onOpenHistory={openHistoricalReport} onPrint={()=>void printReportCenter()}/>
      }
      {tab==='management' && canEnterManagement && <ManagementView data={data} currentUser={currentUser} commit={commit} onSaveSupabaseConfig={saveCloudConfiguration} />}</>}
    </main>
    {currentUser.role!=='vessel'&&canEditBusinessContent&&(vesselEditorLeaseAuthorized||Boolean(vesselLeaseIncidentForEditor))&&editingVesselId&&activeVessels.some(vessel=>vessel.id===editingVesselId) && <VesselEditModal vessel={editingOperationalVessel} data={roleVisibleData} currentUser={currentUser} leaseMode={vesselLeaseMode} leaseMessage={vesselLeaseIncidentForEditor?.message||''} close={()=>void closeVesselEditor(activeEditLockRef.current)} onSave={saveVesselEditorDraft} addTask={id=>{void addTaskForVessel(id,true).then(opened=>{if(opened)setEditingVesselId('');});}} editTask={id=>{const vesselId=editingVesselId;const task=data.tasks.find(item=>item.id===id);if(!task)return alert('找不到對應待辦');setEditingVesselId('');void (async()=>{const result=await openTask(task,vesselId,vesselId);if(result==='failed')void openVesselEditor(vesselId);})();}} />}
    {currentUser.role!=='vessel'&&canEditBusinessContent&&batchManagedOpen && <BatchManagedVesselModal vessels={effectiveBatchSessionVessels} lockedVesselIds={batchLockedVesselIds} readOnly={batchManagedWriteSuspended} saving={batchManagedClosing} save={saveBatchManagedDrafts} cancel={()=>void cancelBatchManagedDrafts(renderedBatchManagedAuthorization)} close={()=>void closeBatchManaged(renderedBatchManagedAuthorization)} discard={()=>void discardBatchManagedChanges(renderedBatchManagedAuthorization)} onAddTask={id=>{void addTaskForVessel(id,false,true);}} />}
    {editingTask&&taskEditorLeaseAuthorized && <TaskEditModal task={editingTask} creating={creatingVisibleTask} data={taskEditorData} visibleVessels={taskEditorVisibleVessels} currentUser={taskEditorUser} canClose={!taskEditorReadOnly&&editingTaskCanMutate&&canCloseTasks&&currentUser.role!=='vessel'} canDelete={!taskEditorReadOnly&&editingTaskCanMutate&&canDeleteTasks} canCancelInternalControl={Boolean(!taskEditorReadOnly&&editingTaskCanMutate&&editingTask&&editingTaskScopeVessels.length===taskVesselIds(editingTask).length&&editingTaskScopeVessels.every(vessel=>canCancelInternalControl(currentUser,vessel)))} canEditOverall={!taskEditorReadOnly&&editingTaskCanMutate&&canEditOverallTask} initialProgressVesselId={taskProgressVesselId} readOnly={taskEditorReadOnly} readOnlyReason={taskReadOnlyReason} close={()=>void closeTaskEditor(taskEditorRequestGeneration)} onDraftChange={captureCreationDraft} onSave={saveTask} onSaveVesselProgress={saveTaskVesselProgress} onDelete={()=>deleteTask(editingTask)} />}
    {currentUser.role!=='vessel'&&canExportReports&&reportPreviewOpen && <ReportPreviewModal data={reportPreviewData} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} reportDate={reportPreviewHistory?.businessDate} reportSnapshot={reportPreviewSnapshot} close={()=>{setReportPreviewOpen(false);setReportPreviewHistoryId('');setReportPreviewLiveItinerarySnapshot(null);}} onPrint={printReport} />}
    {passwordModalOpen && <PersonalPasswordModal currentUser={currentUser} close={()=>setPasswordModalOpen(false)} commit={commit} />}
    {browserRecoveryOpen&&<BrowserRecoveryModal advanced={browserRecoveryAdvanced} phase={browserRecoveryPhase} message={browserRecoveryMessage} onClose={closeBrowserRecovery} onToggleAdvanced={()=>setBrowserRecoveryAdvanced(value=>!value)} onSafeRepair={()=>void runSafeBrowserRepair()} onFullReset={()=>void runFullBrowserReset()} />}
    {currentUser.role!=='vessel'&&!selectedVesselDetailId&&(['dashboard','morning','reports'] as Tab[]).includes(tab) && <div className="selection-dock no-print">涉會船舶 <b className="selected-vessel-count">{agendaSelection.length}</b> 艘 <button className="btn pink small" onClick={()=>navigateToTab('morning')}>進入早會</button><button className="btn primary small" onClick={openReportPreview}>預覽報告</button></div>}
  </div>;
}

function SiteGate({ data, setData, onUnlock }: { data: AppData; setData:React.Dispatch<React.SetStateAction<AppData>>; onUnlock:()=>void }) {
  const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const needsSetup=!data.settings.sitePasswordHash;
  const unlock=async()=>{ if(!pw) return setErr(needsSetup?'請設定進站密碼':'請輸入進站密碼'); const hash=await sha256(pw); if(needsSetup){setData(prev=>withAudit({...prev,settings:{...prev.settings,sitePasswordHash:hash}},null,'初始化進站密碼','settings','site-password','首次設定進站密碼'));onUnlock();return;} if(hash===data.settings.sitePasswordHash){onUnlock();} else setErr('進站密碼錯誤'); };
  return <div className="login-page"><div className="login-card"><div className="login-card-heading"><img className="login-logo" src={fpmcLogo} alt="台塑 LOGO" /><h2>船舶動態系統進站</h2></div><p className="muted">{needsSetup?'首次使用請先設定進站密碼；系統只保存雜湊，不保存明文。':'請輸入管理者設定的進站密碼。'}</p><div className="field login-password-field"><label>{needsSetup?'設定進站密碼':'進站密碼'}</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') unlock();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" onClick={unlock}>{needsSetup?'設定並進入系統':'進入系統'}</button></div></div>;
}
function OwnerSetup({ currentUser, setData, setCurrentUserId }: { currentUser:UserAccount; setData:React.Dispatch<React.SetStateAction<AppData>>; setCurrentUserId:(id:string)=>void }) {
  const [username,setUsername]=useState(currentUser.username); const [pw,setPw]=useState('');
  const create=async()=>{ if(!username.trim()||!pw) return alert('請輸入 Owner 用戶名與新密碼'); const hash=await sha256(pw); setData(prev=>withAudit({...prev, users:prev.users.map(u=>u.id===currentUser.id?{...u,role:'owner',username:username.trim(),passwordHash:hash,updatedAt:nowIso()}:u)}, currentUser, '建立Owner', 'user', currentUser.id, '已驗證使用者初始化為 Owner')); setCurrentUserId(currentUser.id); };
  return <div className="login-page"><div className="login-card"><h2>首次初始化 Owner</h2><p className="muted">已驗證身分：{currentUser.department}｜{currentUser.name}。只能將目前登入者初始化為第一位 Owner。</p><div className="field"><label>Owner 用戶名</label><input value={username} onChange={e=>setUsername(e.target.value)} /></div><div className="field"><label>Owner 新密碼</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} /></div><button className="btn primary" onClick={create}>將目前帳號設為 Owner</button></div></div>;
}
function PersonalPasswordModal({ currentUser, close, commit }: { currentUser: UserAccount; close:()=>void; commit:(mutate:(draft:AppData)=>void, action:string, entityType:string, entityId:string, detail:string)=>void }) {
  const [oldPassword,setOldPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [err,setErr]=useState('');
  const passwordRequired = currentUser.role === 'owner' || currentUser.role === 'admin';
  const noExistingPassword = !currentUser.passwordHash;
  const updatePassword=async()=>{
    setErr('');
    if(currentUser.passwordHash&&await sha256(oldPassword)!==currentUser.passwordHash)return setErr('舊密碼錯誤');
    if(!newPassword&&!confirmPassword){
      if(passwordRequired)return setErr('Owner／管理員不可解除密碼，請輸入新密碼');
      commit(draft=>{const user=draft.users.find(item=>item.id===currentUser.id);if(user){user.passwordHash='';user.updatedAt=nowIso();}},'解除個人密碼','user',currentUser.id,`${currentUser.name} 解除個人密碼`);
      close();
      alert('個人密碼已解除；下次可無密碼登入。');
      return;
    }
    if(!newPassword||!confirmPassword)return setErr('請完整輸入新密碼與確認密碼；若要解除密碼，請將新密碼留空');
    if(newPassword!==confirmPassword)return setErr('兩次輸入的新密碼不一致');
    const hash=await sha256(newPassword);
    commit(draft=>{const user=draft.users.find(item=>item.id===currentUser.id);if(user){user.passwordHash=hash;user.updatedAt=nowIso();}},'更新個人密碼','user',currentUser.id,`${currentUser.name} 自行修改密碼`);
    close();
    alert('個人密碼已更新；下次登入需使用新密碼。');
  };
  return <div className="modal-backdrop"><div className="modal personal-password-modal" role="dialog" aria-modal="true" aria-labelledby="personal-password-title"><div className="modal-head"><div><h2 id="personal-password-title">修改個人密碼</h2><p>{currentUser.name}｜{roleLabel(currentUser.role)}｜{noExistingPassword?'目前無個人密碼，舊密碼可留空':'已有個人密碼，需先驗證舊密碼'}</p></div><button className="btn ghost" onClick={close}>關閉</button></div><div className="grid cols-3"><div className="field"><label>舊密碼</label><input type="password" value={oldPassword} placeholder={noExistingPassword?'舊密碼可留空':'請輸入目前密碼'} onChange={event=>setOldPassword(event.target.value)} /></div><div className="field"><label>新密碼</label><input type="password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} /></div><div className="field"><label>再次輸入新密碼</label><input type="password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void updatePassword();}} /></div></div>{err&&<p className="warn">{err}</p>}<div className="modal-actions"><button className="btn ghost" onClick={close}>取消</button><button className="btn primary" onClick={updatePassword}>更新密碼</button></div></div></div>;
}

function Login({ data, setCurrentUserId }: { data: AppData; setCurrentUserId:(id:string)=>void }) {
  const activeUsers=data.users.filter(user=>user.isActive);
  const departments=Array.from(new Set(activeUsers.map(user=>user.department || '未指定部門'))).filter(Boolean);
  const [department,setDepartment]=useState(departments[0]||''); const [userId,setUserId]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const people=activeUsers.filter(user=>(user.department || '未指定部門')===department);
  useEffect(()=>{if(!people.some(user=>user.id===userId)){setUserId(people[0]?.id||'');setPw('');setErr('');}},[department,data.revision]);
  const selectedUser=activeUsers.find(user=>user.id===userId);
  const selectedNeedsPassword=Boolean(selectedUser&&(selectedUser.role==='owner'||selectedUser.role==='admin'||selectedUser.passwordHash));
  const login=async()=>{ const user=activeUsers.find(item=>item.id===userId); if(!user) return setErr('請選擇登入人員'); const needsPassword=user.role==='owner'||user.role==='admin'||Boolean(user.passwordHash); if(!needsPassword){setCurrentUserId(user.id);return;} if(!user.passwordHash) return setErr('此 Owner／管理員帳號尚未設定密碼，請由 Owner 先設定密碼'); if(!pw) return setErr(user.role==='owner'||user.role==='admin'?'Owner／管理員請輸入密碼':'此人員已設定個人密碼，請輸入密碼'); if(await sha256(pw)!==user.passwordHash) return setErr('密碼錯誤'); setCurrentUserId(user.id); };
  return <div className="login-page"><div className="login-card"><div className="login-card-heading"><img className="login-logo" src={fpmcLogo} alt="台塑 LOGO" /><h2>人員登入／切換</h2></div><p className="muted">請先選擇部門與人員；Owner／管理員或已設定個人密碼者需輸入密碼，其餘人員可直接登入。</p><div className="field"><label>部門</label><select aria-label="登入部門" value={department} onChange={e=>setDepartment(e.target.value)}>{departments.map(item=><option key={item}>{item}</option>)}</select></div><div className="field"><label>人員</label><select aria-label="登入人員" value={userId} onChange={e=>{setUserId(e.target.value);setPw('');setErr('');}}>{people.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></div><div className="field login-password-field"><label>密碼</label><input type="password" value={pw} placeholder={selectedNeedsPassword?'請輸入密碼':'無密碼帳號可空白直接登入'} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') login();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" disabled={!selectedUser} onClick={login}>登入</button></div></div>;
}

function ReportCenter({ data, visibleVessels, user, selected, setSelected, canSaveDailyMorning, onSaveDailyMorning, onOpenPreview, onOpenHistory, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; setSelected:(ids:string[])=>void; canSaveDailyMorning:boolean; onSaveDailyMorning:(at:string)=>Promise<boolean>; onOpenPreview:()=>void; onOpenHistory:(report:AgendaReport)=>void; onPrint:()=>void }) {
  const [savingDaily,setSavingDaily]=useState(false);
  const active=visibleVessels;
  const allowedIds=new Set(active.map(v=>v.id));
  const canViewAllReports=user.role==='owner'||user.role==='admin'||hasPermission(data.settings.rolePermissions,user,'viewAllVessels');
  const reportHistory=dailyMorningReports(data.agendaReports).filter(report=>canViewAllReports||(report.vesselIds.length>0&&report.vesselIds.every(id=>allowedIds.has(id))));
  const selectedScopeIds=selected.filter(id=>allowedIds.has(id));
  const reportTasks=morningDiscussionTasks(data.tasks,data.meetings).filter(t=>taskVesselIds(t).some(id=>selectedScopeIds.includes(id))&&!taskIsClosedForScope(t,selectedScopeIds));
  const ordinaryReportTasks=reportTasks.filter(appearsInSingleVesselTasks);
  const companyDecisionTasks=reportTasks.filter(task=>isMeetingAttentionTask(task)&&!isVesselDelegatedMeetingTask(task));
  const toggle=(id:string)=>setSelected(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
  const save=async()=>{if(!canSaveDailyMorning||savingDaily)return;setSavingDaily(true);try{if(await onSaveDailyMorning(nowIso()))alert('今日早會快照已完成保存。');}finally{setSavingDaily(false);}};
  return <section><div className="page-heading"><div><h1>報告中心</h1><p>每日早會以台北工作日為唯一日期；平日09:00由雲端排程自動建立，Owner／管理員也可手動更新同一天快照。</p></div><div className="heading-actions no-print">{canSaveDailyMorning&&<button className="btn green" disabled={savingDaily} onClick={()=>void save()}>{savingDaily?'雲端確認中…':'手動保存今日早會'}</button>}<button className="btn ghost" onClick={onPrint}>列印目前頁</button><button className="btn primary" onClick={onOpenPreview}>開啟 PDF 預覽</button></div></div><div className="metric-grid report-metrics"><div className="metric-card pink"><small>已選船舶</small><b>{selected.length}</b><span>艘</span></div><div className="metric-card blue"><small>單船要事</small><b>{ordinaryReportTasks.length}</b><span>件</span></div><div className="metric-card purple"><small>公司層決議</small><b>{companyDecisionTasks.length}</b><span>件</span></div><div className="metric-card yellow"><small>急／高要事</small><b>{ordinaryReportTasks.filter(t=>t.priority==='急'||t.priority==='高').length}</b><span>件</span></div><div className="metric-card mint"><small>每日早會歷史</small><b>{reportHistory.length}</b><span>份</span></div></div><div className="panel no-print"><div className="panel-title"><h2>選擇報告船舶</h2><div><button className="btn small ghost" onClick={()=>setSelected(active.map(v=>v.id))}>全選</button> <button className="btn small ghost" onClick={()=>setSelected([])}>清空</button></div></div><div className="vessel-selector">{active.map(v=><button key={v.id} className={`chip ${selected.includes(v.id)?'on':''}`} onClick={()=>toggle(v.id)}>{vesselDisplayName(v)}</button>)}</div></div><div className="grid cols-2"><div className="panel"><h2>本次報告內容</h2><div className="table-wrap"><table className="compact"><thead><tr><th>船舶</th><th>航線／貨況</th><th>未結事項</th></tr></thead><tbody>{active.filter(v=>selected.includes(v.id)).map(v=><tr key={v.id}><td><b>{vesselDisplayName(v)}</b><br/><span className="muted">{v.shipType || '未填船型'}</span></td><td>{v.position.lastPort} → {v.position.nextPort}<br/>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}</td><td>{ordinaryReportTasks.filter(t=>taskHasVessel(t,v.id)&&!taskIsClosedForVessel(t,v.id)).length}</td></tr>)}</tbody></table></div></div><div className="panel"><h2>每日早會歷史</h2>{reportHistory.length?reportHistory.slice(0,20).map(r=><div className="saved-report" key={r.id}><div><b>{r.title}</b><small>{r.businessDate}｜更新 {formatTaipeiDateTime(r.updatedAt||r.createdAt,false)}｜{r.source==='scheduled'?'09:00自動':'手動'}｜{r.vesselIds.length} 艘｜{r.taskCount} 件</small></div><button className="btn small ghost" onClick={()=>onOpenHistory(r)}>檢視當日快照</button></div>):<div className="empty-state compact">尚無每日早會歷史</div>}</div></div></section>;
}

function valueOrDash(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '-';
}
function vesselReportCargo(v: Vessel) {
  return v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、') || 'TBA';
}
function vesselReportStatus(v: Vessel) {
  return [
    v.note.statusList.map(status => status === 'drydock/repiar' ? 'drydock/repair' : status).join('、'),
    v.note.statusSupplement.trim(),
  ].filter(Boolean).join('｜') || '未設定';
}
function vesselReportNavigation(v: Vessel) {
  return v.position.navigationStatus;
}
function VesselReportNameCell({ v }: { v: Vessel }) {
  return <div className="report-vessel-name-cell"><strong>{vesselDisplayName(v)}</strong><div className="report-vessel-officers">
    <span><b>船長：</b>{valueOrDash(v.note.captain)}</span>
    <span><b>大副：</b>{valueOrDash(v.note.chiefOfficer)}</span>
    <span><b>輪機長：</b>{valueOrDash(v.note.chiefEngineer)}</span>
    <span><b>大管輪：</b>{valueOrDash(v.note.firstEngineer)}</span>
  </div></div>;
}

export function VesselReportInfo({ v }: { v: Vessel }) {
  return <div className="report-vessel-info">
    <div><b>目前位置：</b>{valueOrDash(v.position.location)}</div>
    <div><b>上一港：</b>{valueOrDash(v.position.lastPort)}</div>
    <div><b>下一港：</b>{valueOrDash(v.position.nextPort)}</div>
    <div><b>航行狀態：</b>{valueOrDash(vesselReportNavigation(v))}</div>
    <div><b>載況：</b>{valueOrDash(v.cargo.loadStatus)}</div>
    <div><b>ETA：</b>{formatScheduleDisplay(v.position.eta) || '-'}</div>
    <div><b>ETB：</b>{formatScheduleDisplay(v.position.etb) || '-'}</div>
    <div><b>ETD：</b>{formatScheduleDisplay(v.position.etd) || '-'}</div>
    <div><b>貨名貨量：</b>{vesselReportCargo(v)}</div>
    <div><b>船舶狀態：</b>{vesselReportStatus(v)}</div>
    <div><b>人工備註：</b>{valueOrDash(v.position.manualRemark)}</div>
    <div><b>近期／後續動態：</b>{valueOrDash(v.note.recentDynamics)}</div>
    <div className="report-vessel-maintenance"><b>船舶保養維護概況</b><span>{valueOrDash(v.note.maintenanceOverview)}</span></div>
  </div>;
}

function ReportPreviewModal({ data, visibleVessels, user, selected: _selected, reportDate, reportSnapshot, close, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; reportDate?:string; reportSnapshot?:MorningReportSnapshot; close:()=>void; onPrint:(reportDate:string)=>void }) {
  const shellRef=useRef<HTMLDivElement>(null);
  const closeButtonRef=useRef<HTMLButtonElement>(null);
  const previousFocusRef=useRef<HTMLElement|null>(null);
  const closeRef=useRef(close);
  closeRef.current=close;
  const effectiveReportDate=reportDate||formatTaipeiDate(new Date());
  useEffect(()=>{
    previousFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    closeButtonRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current();return;}
      if(event.key!=='Tab'||!shellRef.current)return;
      const focusable=Array.from(shellRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if(!focusable.length){event.preventDefault();shellRef.current.focus();return;}
      const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
      if(event.shiftKey&&(active===first||!shellRef.current.contains(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKeyDown);
    return()=>{document.removeEventListener('keydown',onKeyDown);previousFocusRef.current?.focus();};
  },[]);
  const allowedIds=new Set(visibleVessels.map(v=>v.id));
  const selectedIds=_selected.filter(id=>allowedIds.has(id));
  const vessels=reportDate?visibleVessels:_selected.length?visibleVessels.filter(v=>selectedIds.includes(v.id)):visibleVessels;
  const reportScopeIds=vessels.map(v=>v.id);
  const reportWindow=reportSnapshot?{
    startedAt:reportSnapshot.windowStartedAt,
    endedAt:reportSnapshot.windowEndedAt||reportSnapshot.capturedAt,
  }:liveMorningWindow(data.agendaReports);
  const reportBaseline=reportSnapshot?undefined:morningBaselineSnapshot(data.agendaReports,reportWindow);
  const reportAgenda=classifyMorningAgenda({
    tasks:data.tasks,
    internalControlCases:data.internalControlCases,
    meetings:data.meetings,
    scopeVesselIds:reportScopeIds,
    window:reportWindow,
    todayTaskIds:reportSnapshot?.todayTaskIds,
    todayInternalControlCaseIds:reportSnapshot?.todayInternalControlCaseIds,
    baselineTasks:reportBaseline?.tasks,
    baselineInternalControlCases:reportBaseline?.internalControlCases,
  });
  const tasks=[...reportAgenda.todayTasks,...reportAgenda.historyTasks];
  const internalCases=[...reportAgenda.todayInternalControlCases,...reportAgenda.historyInternalControlCases];
  const companyDecisionTasks=tasks.filter(task=>isMeetingAttentionTask(task)&&!isVesselDelegatedMeetingTask(task));
  const ordinaryReportTasks=tasks.filter(appearsInSingleVesselTasks);
  const crossVesselTasks=ordinaryReportTasks.filter(task=>task.vesselScopeMode==='all'||task.vesselScopeMode==='types'||taskVesselIds(task).length>1);
  const singleVesselTasks=ordinaryReportTasks.filter(task=>!crossVesselTasks.includes(task));
  return <div className="report-preview-modal" role="dialog" aria-modal="true" aria-labelledby="report-preview-title"><div ref={shellRef} tabIndex={-1} className="report-preview-shell"><div className="report-preview-actions no-print"><h2 id="report-preview-title">PDF 報告預覽</h2><span>A4 橫向</span><div className="spacer"/><button className="btn primary" disabled={!vessels.length} title={!vessels.length?'目前選擇不在授權範圍內':''} onClick={()=>onPrint(effectiveReportDate)}>導出／列印 PDF</button><button ref={closeButtonRef} className="btn ghost" onClick={close}>關閉</button></div><article className="report-paper"><header><h1>船舶早會動態暨待辦報告</h1><p>報告日期：{effectiveReportDate}　製表：{user.name}　資料版本：rev.{data.revision}</p></header><div className="report-kpis"><div>船舶<br/><b>{vessels.length}</b></div><div>單船要事<br/><b>{ordinaryReportTasks.length}</b></div><div>內控議題<br/><b>{internalCases.length}</b></div><div>公司層決議<br/><b>{companyDecisionTasks.length}</b></div><div>逾期要事<br/><b>{ordinaryReportTasks.filter(t=>!taskIsClosedForScope(t,reportScopeIds)&&(daysDiff(t.expectedDate)??0)<0).length}</b></div></div><table className="vessel-report-table"><thead><tr><th>船舶</th><th>動態資料</th><th>要事</th><th>狀態／部門／期限</th></tr></thead><tbody>{vessels.map(v=>{const vt=singleVesselTasks.filter(t=>taskHasVessel(t,v.id));return vt.length?vt.map((t,i)=><tr key={`${v.id}-${t.id}`}>{i===0&&<td rowSpan={vt.length}><VesselReportNameCell v={v}/></td>}{i===0&&<td rowSpan={vt.length}><VesselReportInfo v={v}/></td>}<td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{taskIsClosedForScope(t,reportScopeIds)&&<span className="period-closed-badge">本期已結</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>):<tr key={v.id}><td><VesselReportNameCell v={v}/></td><td><VesselReportInfo v={v}/></td><td colSpan={2}>目前無早會要事</td></tr>})}</tbody></table>{companyDecisionTasks.length>0&&<><h2>公司層決議案（臨會／專題）</h2><table><thead><tr><th>涉及範圍</th><th>船種</th><th>決議事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{companyDecisionTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskReportVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskReportShipTypeLabel(t,vessels)}</td><td><b>會議議題｜{taskCategoryLabel(t)}</b>{taskIsClosedForScope(t,reportScopeIds)&&<span className="period-closed-badge">本期已結</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>)}</tbody></table></>}{crossVesselTasks.length>0&&<><h2>跨船單船要事</h2><table><thead><tr><th>船舶</th><th>船種</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{crossVesselTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskReportVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskReportShipTypeLabel(t,vessels)}</td><td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{taskIsClosedForScope(t,reportScopeIds)&&<span className="period-closed-badge">本期已結</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>)}</tbody></table></>}<footer>{reportDate?'本報告使用當日保存快照，並依目前身份重新套用船舶授權。':'本報告依目前授權範圍、報告選擇及 Supabase／本機最新資料產生。'}</footer></article></div></div>;
}

function FilterBar({ data, visibleVessels, filters, setFilters, fleetTags }: { data:AppData; visibleVessels:Vessel[]; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const toggle=(key:keyof FilterState,val:string)=>{ const arr=[...(filters[key] as string[])]; const next=arr.includes(val)?arr.filter(x=>x!==val):[...arr,val]; setFilters({...filters,[key]:next}); };
  const toggleGroup=(key:'categories'|'meetingCategories', values:string[])=>{ const current=[...filters[key]]; const anySelected=values.some(value=>current.includes(value)); const next=anySelected?current.filter(value=>!values.includes(value)):Array.from(new Set([...current,...values])); setFilters({...filters,[key]:next}); };
  const priorityTone=(priority:TaskPriority)=>priority==='急'?'urgent':priority==='高'?'high':priority==='中'?'medium':'low';
  const chipClass=(active:boolean,...tones:string[])=>['chip','filter-chip',...tones,active?'on':''].filter(Boolean).join(' ');
  const allTaskCategoriesSelected=data.settings.taskCategories.length>0&&data.settings.taskCategories.every(category=>filters.categories.includes(category));
  const allMeetingCategoriesSelected=data.settings.meetingTaskCategories.length>0&&data.settings.meetingTaskCategories.every(category=>filters.meetingCategories.includes(category));
  return <div className="panel no-print"><div className="grid cols-4"><div className="field"><label>關鍵字</label><input value={filters.keyword} onChange={e=>setFilters({...filters,keyword:e.target.value})} placeholder="船名、事項、狀態..." /></div><div className="field"><label>日期起</label><input type="date" value={filters.fromDate} onChange={e=>setFilters({...filters,fromDate:e.target.value})}/></div><div className="field"><label>日期迄</label><input type="date" value={filters.toDate} onChange={e=>setFilters({...filters,toDate:e.target.value})}/></div><div className="field"><label>船舶</label><VesselListFilter vessels={visibleVessels} mode={filters.ownerMode} selectedVesselIds={filters.vesselIds} onChange={selection=>setFilters({...filters,ownerMode:selection.mode,vesselIds:selection.vesselIds})} ariaLabel="待辦清單船舶篩選"/></div></div><div className="filters"><b>部門</b>{data.settings.departments.map(d=><button key={d} className={chipClass(filters.departments.includes(d),'filter-chip-department')} onClick={()=>toggle('departments',d)}>{d}</button>)}</div><div className="filters"><b>船種/船隊</b>{fleetTags.map(f=><button key={f} className={chipClass(filters.fleetTags.includes(f),'filter-chip-fleet')} onClick={()=>toggle('fleetTags',f)}>{f}</button>)}</div><div className="filters"><b>關注</b>{data.settings.priorities.map(p=><button key={p} className={chipClass(filters.priorities.includes(p),`filter-chip-${priorityTone(p)}`)} onClick={()=>toggle('priorities',p)}>{p}</button>)}</div><div className="filters task-category-filter ordinary-category-filter"><button type="button" className={chipClass(allTaskCategoriesSelected,'filter-group-heading','filter-group-task')} onClick={()=>toggleGroup('categories',data.settings.taskCategories)} title="全選／取消全部要事分類">要事分類</button>{data.settings.taskCategories.map((c,index)=><button key={c} className={chipClass(filters.categories.includes(c),`filter-chip-tone-${index%6}`)} onClick={()=>toggle('categories',c)}>{c}</button>)}</div><div className="filters task-category-filter meeting-category-filter"><button type="button" className={chipClass(allMeetingCategoriesSelected,'filter-group-heading','filter-group-meeting')} onClick={()=>toggleGroup('meetingCategories',data.settings.meetingTaskCategories)} title="全選／取消全部臨會/專題分類">臨會/專題分類</button>{data.settings.meetingTaskCategories.map((c,index)=><button key={c} className={chipClass(filters.meetingCategories.includes(c),'filter-chip-meeting',`filter-chip-tone-${(index+3)%6}`)} onClick={()=>toggle('meetingCategories',c)}>{c}</button>)}</div><div className="filters"><b>管控</b><button className={chipClass(filters.internalControlOnly,'filter-chip-internal')} onClick={()=>setFilters({...filters,internalControlOnly:!filters.internalControlOnly})}>內部管控</button>{filters.overdueOnly&&<button className={chipClass(true,'filter-chip-overdue')} onClick={()=>setFilters({...filters,overdueOnly:false})}>只看逾期 ×</button>}</div></div>;
}

function ListPanel({ title, tasks, data, visibleVessels, filters, setFilters, fleetTags, userMap, exportedBy, onEdit, onPrint, onBatchComplete, onBatchDelete, canEdit, canPrint, canComplete, canDelete }: { title:string; tasks:TaskItem[]; data:AppData; visibleVessels:Vessel[]; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[]; userMap:Record<string,UserAccount>; exportedBy:string; onEdit:(t:TaskItem)=>void; onPrint:()=>void; onBatchComplete:(ids:string[])=>boolean|Promise<boolean>; onBatchDelete:(ids:string[])=>boolean|Promise<boolean>; canEdit:boolean; canPrint:boolean; canComplete:boolean; canDelete:boolean }) {
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [page,setPage]=useState(1);
  const [columnSort,setColumnSort]=useState<ListColumnSort>('created-desc');
  const selectAllRef=useRef<HTMLInputElement>(null);
  const topTableScrollRef=useRef<HTMLDivElement>(null);
  const bottomTableScrollRef=useRef<HTMLDivElement>(null);
  const [tableScrollWidth,setTableScrollWidth]=useState(0);
  const sortedTasks=sortListRecords(tasks,columnSort,task=>taskVesselLabel(task,visibleVessels),task=>task.expectedDate);
  const pagedTasks=paginateItems(sortedTasks, page);
  const visibleScopeIds=visibleVessels.map(vessel=>vessel.id);
  useEffect(()=>{setSelectedIds(previous=>sanitizeTaskSelection(previous,tasks));setPage(1);},[tasks]);
  useEffect(()=>setPage(1),[columnSort]);
  const selectedSet=new Set(selectedIds);
  const selectedTasks=selectedListRecords(tasks,selectedIds);
  const selectedOnPage=pagedTasks.items.filter(task=>selectedSet.has(task.id));
  const openSelectedIds=selectedTasks.filter(task=>!taskProjectedProgressForScope(task,visibleScopeIds).isClosed&&!usesPerVesselProgress(task)).map(task=>task.id);
  const allSelected=pagedTasks.items.length>0&&pagedTasks.items.every(task=>selectedSet.has(task.id));
  useEffect(()=>{if(selectAllRef.current)selectAllRef.current.indeterminate=selectedOnPage.length>0&&!allSelected;},[selectedOnPage.length,allSelected]);
  const syncTableScroll=(source:'top'|'bottom')=>{const origin=source==='top'?topTableScrollRef.current:bottomTableScrollRef.current;const target=source==='top'?bottomTableScrollRef.current:topTableScrollRef.current;if(origin&&target&&target.scrollLeft!==origin.scrollLeft)target.scrollLeft=origin.scrollLeft;};
  useEffect(()=>{const bottom=bottomTableScrollRef.current;if(!bottom)return;const updateTableScrollWidth=()=>{setTableScrollWidth(bottom.scrollWidth);if(topTableScrollRef.current)topTableScrollRef.current.scrollLeft=bottom.scrollLeft;};updateTableScrollWidth();const resizeObserver=new ResizeObserver(updateTableScrollWidth);resizeObserver.observe(bottom);const table=bottom.querySelector('table');if(table)resizeObserver.observe(table);window.addEventListener('resize',updateTableScrollWidth);return()=>{resizeObserver.disconnect();window.removeEventListener('resize',updateTableScrollWidth);};},[tasks.length,page]);
  const toggleAll=()=>setSelectedIds(previous=>allSelected?previous.filter(id=>!pagedTasks.items.some(task=>task.id===id)):Array.from(new Set([...previous,...pagedTasks.items.map(task=>task.id)])));
  const toggleOne=(id:string)=>setSelectedIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const completeSelected=async()=>{if(await onBatchComplete(openSelectedIds))setSelectedIds([]);};
  const deleteSelected=async()=>{if(await onBatchDelete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  return <><FilterBar data={data} visibleVessels={visibleVessels} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><section className="panel selected-task-list-panel"><div className="panel-title no-print"><h2>{title} <span className="muted">({tasks.length})</span></h2><div className="heading-actions no-print"><button className="btn small ghost filter-reset-btn" onClick={()=>{setFilters({...emptyFilters,closedMode:filters.closedMode});setColumnSort('created-desc');}}>清除篩選</button><button className="btn small ghost" onClick={toggleAll} disabled={!pagedTasks.items.length}>{allSelected?'取消本頁全選':'全選本頁'}</button><span className="batch-selection-count">已選 {selectedTasks.length}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!openSelectedIds.length} title={!canComplete?'目前角色未獲授權批量完成':openSelectedIds.length?'':'所選事項均已結案'}>批量完成（{openSelectedIds.length}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectedTasks.length} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectedTasks.length}）</button>{canPrint&&<button className="btn small primary" onClick={onPrint} disabled={!selectedTasks.length} title={!selectedTasks.length?'請先勾選要輸出的項目':''}>導出 PDF（{selectedTasks.length}）</button>}</div></div>{tasks.length?<><div className="table-scroll-top no-print" ref={topTableScrollRef} role="region" aria-label="表格上方橫向捲動" tabIndex={0} onScroll={()=>syncTableScroll('top')}><div className="table-scroll-top-spacer" style={{width:tableScrollWidth}} aria-hidden="true"/></div><div className="table-wrap no-print" ref={bottomTableScrollRef} onScroll={()=>syncTableScroll('bottom')}><table className="compact batch-task-table"><thead><tr><th className="no-print batch-select-cell"><input ref={selectAllRef} type="checkbox" aria-label="全選目前結果" checked={allSelected} onChange={toggleAll}/></th><th className="task-vessel-column" aria-sort={columnSort==='vessel-asc'?'ascending':columnSort==='vessel-desc'?'descending':'none'}><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'vessel'))}>船舶 <span>{columnSort==='vessel-asc'?'↑':columnSort==='vessel-desc'?'↓':'↕'}</span></button></th><th>船種</th><th>關注維度／等級</th><th>來源</th><th className="task-item-column">分類/事項</th><th>部門</th><th>追蹤窗口</th><th className="task-list-date-column" aria-sort={columnSort==='created-asc'?'ascending':columnSort==='created-desc'?'descending':'none'}><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'created'))}>發佈日期 <span>{columnSort==='created-asc'?'↑':columnSort==='created-desc'?'↓':'↕'}</span></button></th><th className="task-list-date-column" aria-sort={columnSort==='date-asc'?'ascending':columnSort==='date-desc'?'descending':'none'}><button type="button" className="table-sort-button" onClick={()=>setColumnSort(nextListColumnSort(columnSort,'date'))}>期限 <span>{columnSort==='date-asc'?'↑':columnSort==='date-desc'?'↓':'↕'}</span></button></th><th className="task-status-column">狀態</th><th className="no-print">操作</th></tr></thead><tbody>{pagedTasks.items.map(t=>{ const vessels=taskVessels(t,visibleVessels); const projected=taskProjectedProgressForScope(t,visibleScopeIds); const fleetCategories=Array.from(new Set(vessels.map(v=>v.fleetCategory).filter(Boolean))).join('、'); const diff=daysDiff(t.expectedDate); const managerIds=[...new Set(t.ownerUserIds)]; return <tr key={t.id} className={selectedSet.has(t.id)?'batch-selected-row':''}><td className="no-print batch-select-cell"><input type="checkbox" aria-label={`選取待辦 ${richTextToPlainText(t.description)||t.id}`} checked={selectedSet.has(t.id)} onChange={()=>toggleOne(t.id)}/></td><td className="task-vessel-scope task-vessel-column">{taskVesselLabel(t,visibleVessels)}</td><td>{taskShipTypeLabel(t,visibleVessels)}<br/><span className="muted">{t.vesselScopeMode==='all'?'全部':fleetCategories||'-'}</span></td><td><small className="attention-dimension-label">{isMeetingAttentionTask(t)?'會議議題':'要事'}</small><span className={priorityClass(t.priority)}>{t.priority}</span>{t.isInternalControl&&<span className="internal-control-tag">內部管控</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}{t.isAware&&<span className="badge aware">知曉</span>}</td><td><span className={`task-source-badge source-${t.sourceType}`}>{taskSourceLabel(t)}</span></td><td className="task-item-column"><span className="chip">{taskCategoryLabel(t)}</span><button type="button" className="task-link" onClick={()=>onEdit(t)}><RichTextContent compact value={t.description} fallback="-"/></button></td><td>{t.departments.map(d=><span className="chip" key={d}>{d}</span>)}</td><td>{managerIds.map(id=>userMap[id]?.name).filter(Boolean).join('、') || '-'}</td><td className="task-list-date-column">{taipeiDateKey(t.createdAt)||'-'}</td><td className="task-list-date-column">{t.expectedDate||'-'}<br/>{!projected.isClosed&&diff!==null&&diff<0&&<span className="warn">逾期 {Math.abs(diff)} 天</span>}</td><td className="task-list-status-cell task-status-column">{projected.isClosed?<span className="badge closed">已結案 {projected.closedDate}</span>:<RichTextContent compact className="task-list-status-text" value={projected.status} fallback="-"/>}<br/><span className="muted">更新：{fmt(projected.updatedAt||t.updatedAt)}</span></td><td className="no-print"><button className="btn small primary" onClick={()=>onEdit(t)}>{canEdit?'更新':'查看'}</button></td></tr>;})}</tbody></table></div></>:<div className="empty-state no-print">目前沒有符合條件的事項</div>}<div className="no-print"><PaginationControls ariaLabel="待辦清單分頁" page={pagedTasks.page} pageCount={pagedTasks.pageCount} total={pagedTasks.total} from={pagedTasks.from} to={pagedTasks.to} onPageChange={setPage}/></div><SelectedTaskPrintTable title={title} tasks={selectedTasks} vessels={visibleVessels} users={data.users} exportedBy={exportedBy}/></section></>;
}
