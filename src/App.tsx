import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import fpmcLogo from './assets/fpmc-logo.png';
import { createInitialData } from './data/seed';
import type { AppData, FilterState, InternalControlCase, StatusLog, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { CLOUD_CACHE_IDENTITY_KEY, CURRENT_USER_KEY, SESSION_SITE_UNLOCK, STORAGE_KEY, daysDiff, loadLocal, nowIso, roleLabel, saveLocal, sha256, todayDate, uid, withAudit } from './utils';
import { CloudConflictError, claimEditLock, fetchCloudData, getSupabaseConfig, releaseEditLock, saveCloudData, type ResolvedSupabaseConfig } from './cloud';
import { CloudRebaseConflictError, rebaseDisjointAppData } from './cloudRebase';
import ManagementView from './Management';
import MorningWorkspaceView from './MorningWorkspace';
import TemporaryMeetingsPage from './TemporaryMeetings';
import { TaskEditModal, VesselEditModal } from './EditModals';
import { normalizeAppData } from './normalize';
import DashboardView from './Dashboard';
import BatchManagedVesselModal from './BatchManagedVesselModal';
import VesselDetailPage from './VesselDetailPage';
import WorkCenter from './WorkCenter';
import DataAnalysisView from './DataAnalysis';
import { canAccessAllVessels, hasPermission, isEligibleTaskOwner } from './permissions';
import { selectUserWorkCenterInternalCases, selectUserWorkCenterTasks } from './workCenterScope';
import InternalControlPage from './InternalControlPage';
import { closeLinkedInternalControlCaseAfterTaskDelete, createInternalControlCases, deleteInternalControlCase, reconcileInternalControlAfterTaskSave, syncLinkedInternalControlCasesFromTasks, updateInternalControlCase, type InternalControlTaskProjection } from './internalControlData';
import { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications, canAccessTab, canAcquireTaskEditLock, canCancelInternalControl, canDeleteTask, canUseVessel, internalControlTransitionRequested, selectInternalControlCasesVisibleToUser, selectTasksVisibleToUser, taskSourceLabel, trustedClosureDate, validateInternalControlTransition } from './taskWorkflow';
import { isMeetingTaskSource, mergeAttentionFromCategories, normalizeMeetingTaskCategoryList, normalizeTaskCategoryList, taskCategoriesOf, taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskReportShipTypeLabel, taskReportVesselLabel, taskShipTypeLabel, taskVesselIds, taskVesselLabel, taskVessels } from './taskVesselScope';
import { buildTaskReadOnlyEditorData, type TaskReadOnlyEditorData } from './taskReadOnlyProjection';
import { deriveVesselAttention, nextManualVesselAttention } from './vesselAttention';
import { dashboardMeetingAlerts, meetingCreatesVesselAbnormalAlert } from './meetingVesselAttention';
import { canEditTemporaryMeetings, meetingAppliesToUser } from './meetingAccess';
import { completeSelectedTasks, sanitizeTaskSelection, validateBatchTaskSelection } from './batchTaskActions';
import { meetingTaskLinkIsValidForMutation, resolveMeetingTaskItemIdForDeletion } from './meetingTaskWorkflow';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { appearsInSingleVesselTasks, canonicalTaskAttentionForSave, isMeetingAttentionTask, isVesselDelegatedMeetingTask, vesselAttentionTasks } from './taskAttention';
import { hasActiveVesselDelegation } from './vesselDelegation';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskIsClosedForScope, taskIsClosedForVessel, taskProgressForVessel, updateTaskVesselProgress, usesPerVesselProgress } from './taskVesselProgress';
import { formatScheduleDisplay } from './scheduleTime';
import RichTextContent from './RichTextContent';
import { richTextToPlainText } from './richText';
import { conservativeLeaseDeadline, createEditLockCoordinator, editLockAllowsMutation } from './editLockCoordinator';
import { acquireEditLockBundle } from './editLockBundle';

type Tab = 'dashboard' | 'morning' | 'total' | 'reports' | 'stats' | 'management' | 'meeting' | 'closed' | 'internalControl' | 'work';
type ActiveEditLock = { sectionKey: string; label: string; status: 'owned' | 'blocked' | 'error'; ownerUserId: string; ownerUserName: string; leaseOwnerId: string; generation: number; authorizationEpoch: string; validatedUntilMs: number; lockedByName?: string };
type EditLockClaimResult = 'owned' | 'blocked' | 'unavailable';
type TaskOpenResult='opened'|'failed'|'cancelled';
type TaskReturnDestination={vesselId:string;batchManaged:boolean};

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
  closeAfterFailure:()=>void;
}):Promise<TaskOpenResult>{
  if(!input.leaseIsCurrent())return 'cancelled';
  input.invalidateLease();
  const request=input.closeWritableAndBeginReadOnly();
  const result=await input.openLatestReadOnly(request);
  if(result==='failed'&&input.requestIsCurrent(request))input.closeAfterFailure();
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
function fmt(dt?: string) { return dt ? dt.replace('T',' ').slice(0,16) : '-'; }
function savedStatus(label:string, at?:string) { const d=at?new Date(at):new Date(); return `${label}｜最新保存 ${d.toLocaleString('zh-TW',{hour12:false})}`; }
export function cloudIdentity(cfg: ResolvedSupabaseConfig|null|undefined) { return cfg?`${cfg.supabaseUrl}|${cfg.tableName}|${cfg.workspaceKey}|${cfg.supabaseAnonKey}`:''; }
function sameCloudConfig(left:ResolvedSupabaseConfig|undefined|null,right:ResolvedSupabaseConfig|undefined|null) { return Boolean(left&&right&&left.supabaseUrl===right.supabaseUrl&&left.supabaseAnonKey===right.supabaseAnonKey&&left.workspaceKey===right.workspaceKey&&left.tableName===right.tableName); }
function vesselMatchesUser(v: Vessel, user: UserAccount | null, canViewAll = false) { return !user || canViewAll || v.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(v.id) || hasActiveVesselDelegation(v, user.id); }
function batchVisibleVesselIds(data: AppData, user: UserAccount) {
  const canViewAll = user.role==='owner'||user.role==='admin'||hasPermission(data.settings.rolePermissions,user,'viewAllVessels');
  return new Set(data.vessels.filter(vessel=>vessel.isActive&&vesselMatchesUser(vessel,user,canViewAll)).map(vessel=>vessel.id));
}
function taskProjectedProgressForScope(task: TaskItem, scopeVesselIds: string[]) {
  const scopedIds=taskVesselIds(task).filter(id=>scopeVesselIds.includes(id));
  if(scopedIds.length===1)return taskProgressForVessel(task,scopedIds[0]);
  const visibleStatuses=usesPerVesselProgress(task)?scopedIds.map(id=>taskProgressForVessel(task,id).status).filter(status=>richTextToPlainText(status).trim()):[];
  const visibleUpdates=usesPerVesselProgress(task)?scopedIds.map(id=>taskProgressForVessel(task,id).updatedAt).filter(Boolean).sort():[];
  const projectedStatus=usesPerVesselProgress(task)&&scopedIds.length>1?(visibleStatuses.join('<br/>')||'尚無單船狀態'):task.status;
  return { vesselId: scopedIds[0]||task.vesselId, status: projectedStatus, isClosed: scopedIds.length?taskIsClosedForScope(task,scopedIds):task.isClosed, closedDate: task.closedDate, closedBy: task.closedBy, updatedAt: visibleUpdates[visibleUpdates.length-1]||task.updatedAt, updatedBy: task.updatedBy, statusLogs: task.statusLogs };
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
  if(filters.vesselIds.length&&!visibleVessels.some(v=>filters.vesselIds.includes(v.id)))return false;
  if(filters.fleetTags.length&&!visibleVessels.some(v=>v.fleetTags.some(f=>filters.fleetTags.includes(f))))return false;
  if(filters.priorities.length&&!filters.priorities.includes(t.priority))return false;
  const categoryFiltersActive=filters.categories.length||filters.meetingCategories.length;
  if(categoryFiltersActive){
    const meetingSource=isMeetingTaskSource(t);
    const selected=meetingSource?filters.meetingCategories:filters.categories;
    if(!selected.length||!taskCategoriesOf(t).some(category=>selected.includes(category)))return false;
  }
  if(filters.internalControlOnly&&!t.isInternalControl)return false;
  if(filters.ownerMode==='mine'&&currentUser&&!t.ownerUserIds.includes(currentUser.id)&&!vessels.some(v=>v.assignedUserIds.includes(currentUser.id)))return false;
  const date=(t.updatedAt||t.createdAt).slice(0,10);
  return !(filters.fromDate&&date<filters.fromDate)&&!(filters.toDate&&date>filters.toDate);
}

export default function App() {
  const [data, setData] = useState<AppData>(() => normalizeAppData(loadLocal()) || createInitialData());
  const [siteUnlocked, setSiteUnlocked] = useState(() => sessionStorage.getItem(SESSION_SITE_UNLOCK) === '1');
  const [currentUserId, setCurrentUserId] = useState(() => localStorage.getItem(CURRENT_USER_KEY) || '');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [closedFilters, setClosedFilters] = useState<FilterState>({...emptyFilters,closedMode:'closed'});
  const [selectedVesselDetailId, setSelectedVesselDetailId] = useState('');
  const [editingVesselId, setEditingVesselId] = useState<string>('');
  const [editingTaskId, setEditingTaskId] = useState<string>('');
  const [taskEditorAuthorizationEpoch, setTaskEditorAuthorizationEpoch] = useState('');
  const [taskProgressVesselId, setTaskProgressVesselId] = useState<string>('');
  const [taskReadOnlyData, setTaskReadOnlyData] = useState<TaskReadOnlyEditorData | null>(null);
  const [taskReadOnlyReason, setTaskReadOnlyReason] = useState('');
  const [creatingTask, setCreatingTask] = useState<TaskItem | null>(null);
  const [batchManagedOpen, setBatchManagedOpen] = useState(false);
  const [batchEditLocks,setBatchEditLocks]=useState<ActiveEditLock[]>([]);
  const [cloudStatus, setCloudStatusValue] = useState('本機模式');
  const [cloudStatusAuthorizationEpoch,setCloudStatusAuthorizationEpoch]=useState('');
  const [cloudStatusSectionKey,setCloudStatusSectionKey]=useState('');
  const [agendaSelection, setAgendaSelection] = useState<string[]>([]);
  const [printTitle, setPrintTitle] = useState('');
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [cloudBootstrapped, setCloudBootstrapped] = useState(false);
  const [cloudWriteBlocked, setCloudWriteBlocked] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [activeEditLock, setActiveEditLock] = useState<ActiveEditLock | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastCloudRevision = useRef<number>(-1);
  const confirmedCloudData = useRef<AppData | null>(null);
  const liveData = useRef(data);
  const activeCloudIdentity = useRef('');
  const pendingCloudData = useRef<{snapshot:AppData;token:ReturnType<ReturnType<typeof createAsyncConfigCoordinator>['begin']>;savedBy:string} | null>(null);
  const cloudSaveInFlight = useRef<Promise<void> | null>(null);
  const cloudSyncInFlight = useRef(false);
  const autoDepartmentFilterKey = useRef('');
  const previousAuthorizationEpoch = useRef('');
  const liveAuthorizationEpoch = useRef('');
  const liveCurrentUserId = useRef('');
  const liveAuthorizedEditLockKeys=useRef(new Set<string>());
  const lockCoordinator=useRef(createEditLockCoordinator());
  const batchLockCoordinator=useRef(createEditLockCoordinator());
  const taskOpenRequests=useRef(createTaskOpenRequestCoordinator());
  const configIoCoordinator=useRef(createAsyncConfigCoordinator());
  const observedCloudConfig=useRef(cloudIdentity(getSupabaseConfig()));
  const leaseCloudConfigs=useRef(new Map<string,{sectionKey:string;config:ResolvedSupabaseConfig}>());
  const blockedTaskCloudConfig=useRef<ResolvedSupabaseConfig|null>(null);
  const pendingClaimConfig=useRef<{generation:number;config:ResolvedSupabaseConfig;invalidated:boolean}|null>(null);
  const batchManagedSession=useRef(0);
  const batchManagedRequested=useRef(false);
  const batchLocalMode=useRef(false);
  const batchManagedOpenRef=useRef(false);
  const batchEditLocksRef=useRef<ActiveEditLock[]>([]);
  const batchLeaseCloudConfigs=useRef(new Map<string,{sectionKey:string;config:ResolvedSupabaseConfig}>());
  const currentUser=data.users.find(u=>u.id===currentUserId && u.isActive) || null;
  liveData.current=data;
  batchManagedOpenRef.current=batchManagedOpen;
  batchEditLocksRef.current=batchEditLocks;
  const ownerExists = data.users.some(u => u.role === 'owner' && u.isActive);
  const authorizationCanViewAll = currentUser?.role==='owner'||currentUser?.role==='admin'||hasPermission(data.settings.rolePermissions,currentUser,'viewAllVessels');
  const authorizationVesselIds = data.vessels.filter(vessel=>vessel.isActive&&vesselMatchesUser(vessel,currentUser,authorizationCanViewAll)).map(vessel=>vessel.id).sort();
  const authorizationEpoch = [
    currentUser?.id||'', currentUser?.role||'', authorizationVesselIds.join(','),
    hasPermission(data.settings.rolePermissions,currentUser,'enterManagement')?'m1':'m0',
    hasPermission(data.settings.rolePermissions,currentUser,'editBusinessContent')?'e1':'e0',
    hasPermission(data.settings.rolePermissions,currentUser,'createTasks')?'c1':'c0',
    hasPermission(data.settings.rolePermissions,currentUser,'closeTasks')?'x1':'x0',
    hasPermission(data.settings.rolePermissions,currentUser,'deleteTasks')?'d1':'d0',
    hasPermission(data.settings.rolePermissions,currentUser,'exportReports')?'r1':'r0',
    authorizationCanViewAll?'v1':'v0',
  ].join('|');
  liveAuthorizationEpoch.current=authorizationEpoch;
  liveCurrentUserId.current=currentUser?.id||'';
  const setCloudStatus=(value:string)=>{setCloudStatusValue(value);setCloudStatusAuthorizationEpoch('');setCloudStatusSectionKey('');};
  const setSensitiveCloudStatus=(value:string,sectionKey:string)=>{setCloudStatusValue(value);setCloudStatusAuthorizationEpoch(authorizationEpoch);setCloudStatusSectionKey(sectionKey);};
  const releaseBatchEditLockSnapshot=async(locks:ActiveEditLock[],announce=true)=>batchLockCoordinator.current.run(async()=>{
    let failed=false;
    for(const lock of [...locks].reverse()){
      const record=batchLeaseCloudConfigs.current.get(lock.leaseOwnerId);
      if(!record)continue;
      try{await releaseEditLock(record.sectionKey,lock.leaseOwnerId,record.config);batchLeaseCloudConfigs.current.delete(lock.leaseOwnerId);}
      catch{failed=true;}
    }
    if(failed)setCloudStatus('部分批量船舶協作鎖釋放失敗；編輯已關閉，剩餘鎖將由短時效自動過期');
    else if(announce&&locks.length)setCloudStatus('批量船舶協作鎖已全部釋放');
    return !failed;
  });
  const invalidateBatchManagedLocks=(message:string)=>{
    const locks=batchEditLocksRef.current;
    batchManagedRequested.current=false;
    batchManagedOpenRef.current=false;
    batchManagedSession.current+=1;
    batchLockCoordinator.current.invalidate();
    batchLocalMode.current=false;
    batchEditLocksRef.current=[];
    setBatchEditLocks([]);
    setBatchManagedOpen(false);
    if(message)setCloudStatus(message);
    void releaseBatchEditLockSnapshot(locks,false);
  };

  useEffect(() => { saveLocal(data); }, [data]);
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

  const rememberCloudIdentity = () => {
    if (activeCloudIdentity.current) localStorage.setItem(CLOUD_CACHE_IDENTITY_KEY, activeCloudIdentity.current);
  };
  const hasCurrentCloudIdentity = () => {
    const currentConfig = getSupabaseConfig();
    const currentIdentity = currentConfig ? cloudIdentity(currentConfig) : '';
    if (!currentIdentity || currentIdentity !== activeCloudIdentity.current) {
      setCloudWriteBlocked(true);
      setCloudStatus('雲端設定已在其他分頁變更，已禁止沿用舊 revision；請先同步最新資料');
      return false;
    }
    return true;
  };
  const enqueueCloudSave = (snapshot: AppData): Promise<void> => {
    const requestConfig=getSupabaseConfig();
    if (!requestConfig||!hasCurrentCloudIdentity()) return Promise.reject(new Error('雲端工作區 identity 已變更'));
    const requestToken=configIoCoordinator.current.begin(requestConfig);
    pendingCloudData.current = {snapshot,token:requestToken,savedBy:currentUser?.name||'unknown'};
    const validateCompletion=()=>{if(!configIoCoordinator.current.isCurrent(requestToken,getSupabaseConfig()))throw new StaleAsyncConfigError();};
    if (cloudSaveInFlight.current) return cloudSaveInFlight.current.then(validateCompletion);
    const task = (async () => {
      let rebaseAttempts=0;
      try {
        while (pendingCloudData.current) {
          const pending=pendingCloudData.current;
          pendingCloudData.current = null;
          const {snapshot:next,token,savedBy}=pending;
          if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
          if (next.revision <= lastCloudRevision.current) continue;
          if (!hasCurrentCloudIdentity()) throw new Error('雲端工作區 identity 已變更');
          try {
            await configIoCoordinator.current.run(token,getSupabaseConfig,config=>saveCloudData(next,lastCloudRevision.current,savedBy,config));
          } catch(error) {
            if(!(error instanceof CloudConflictError))throw error;
            if(++rebaseAttempts>3)throw new CloudRebaseConflictError(['雲端版本在短時間內連續變動']);
            const base=confirmedCloudData.current;
            const remote=await configIoCoordinator.current.run(token,getSupabaseConfig,fetchCloudData);
            if(!base||!remote||base.revision!==lastCloudRevision.current)throw new CloudRebaseConflictError(['缺少可信的雲端合併基線']);
            if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig())||!hasCurrentCloudIdentity())throw new StaleAsyncConfigError();
            const rebased=rebaseDisjointAppData(base,liveData.current,remote,nowIso());
            if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
            lastCloudRevision.current=remote.revision;
            confirmedCloudData.current=remote;
            pendingCloudData.current={snapshot:rebased,token,savedBy};
            setData(rebased);
            setCloudWriteBlocked(false);
            setCloudStatus('偵測到其他人保存了不同資料，已安全合併並重新保存');
            continue;
          }
          if(!configIoCoordinator.current.isCurrent(token,getSupabaseConfig()))throw new StaleAsyncConfigError();
          rebaseAttempts=0;
          lastCloudRevision.current = next.revision;
          confirmedCloudData.current=next;
          rememberCloudIdentity();
          setCloudWriteBlocked(false);
          setCloudStatus(savedStatus('已保存雲端'));
        }
      } catch (error) {
        pendingCloudData.current = null;
        if (error instanceof CloudConflictError||error instanceof CloudRebaseConflictError||error instanceof StaleAsyncConfigError) setCloudWriteBlocked(true);
        throw error;
      } finally {
        cloudSaveInFlight.current = null;
      }
    })();
    cloudSaveInFlight.current = task;
    return task.then(validateCompletion);
  };

  useEffect(() => {
    const cfg = getSupabaseConfig();
    if (!cfg) { setCloudStatus('本機模式：尚未配置 Supabase，資料保存於本機瀏覽器'); setCloudBootstrapped(true); return; }
    const identity = cloudIdentity(cfg);
    const bootstrapToken=configIoCoordinator.current.begin(cfg);
    activeCloudIdentity.current = identity;
    const cachedIdentity = localStorage.getItem(CLOUD_CACHE_IDENTITY_KEY) || '';
    const identityChanged = Boolean(cachedIdentity && cachedIdentity !== identity);
    const unknownDirtyCache = !cachedIdentity && localStorage.getItem(STORAGE_KEY) !== null;
    let cancelled=false;
    setCloudStatus('正在載入雲端主資料...');
    configIoCoordinator.current.run(bootstrapToken,getSupabaseConfig,fetchCloudData).then(remote => {
      if(cancelled||!configIoCoordinator.current.isCurrent(bootstrapToken,getSupabaseConfig()))return;
      const latestConfig = getSupabaseConfig();
      if (!latestConfig || cloudIdentity(latestConfig) !== identity) {
        setCloudWriteBlocked(true);
        setCloudStatus('雲端設定在載入期間變更，已禁止寫入；請重新載入或同步最新資料');
        setCloudBootstrapped(true);
        return;
      }
      if (remote) {
        lastCloudRevision.current=remote.revision||0;
        confirmedCloudData.current=remote;
        if (identityChanged) {
          setCloudWriteBlocked(true);
          setCloudStatus('偵測到不同雲端工作區的本機快取，已禁止寫入；請先同步最新資料');
        } else if (data.revision > remote.revision || (data.revision === remote.revision && data.updatedAt !== remote.updatedAt)) {
          setCloudWriteBlocked(true);
          setCloudStatus(`同步衝突：本機版本／時間與雲端不一致（本機 ${data.revision}、雲端 ${remote.revision}），已禁止覆寫；請先同步最新資料`);
        } else {
          setData(remote);
          setCloudWriteBlocked(false);
          rememberCloudIdentity();
          setCloudStatus(savedStatus('已載入雲端主資料',remote.updatedAt));
        }
      }
      else {
        lastCloudRevision.current=-1;
        confirmedCloudData.current=null;
        if (identityChanged || unknownDirtyCache) {
          setCloudWriteBlocked(true);
          setCloudStatus('目標工作區尚無資料；為避免跨工作區複製，已禁止自動初始化。請按「同步最新」明確確認');
        } else {
          setCloudWriteBlocked(false);
          rememberCloudIdentity();
          setCloudStatus('雲端已連線，目前尚無主資料');
        }
      }
      setCloudBootstrapped(true);
    }).catch(e => { if(!cancelled){setCloudWriteBlocked(true);setCloudStatus(`雲端載入失敗，已禁止寫入：${e.message || e}`);setCloudBootstrapped(true);} });
    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!cloudBootstrapped || cloudWriteBlocked || cloudSyncing || cloudSyncInFlight.current || !currentUser || !getSupabaseConfig() || data.revision<=lastCloudRevision.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      enqueueCloudSave(data).catch(e => setCloudStatus(`雲端保存失敗：${e.message || e}`));
    }, 900);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [data, currentUser, cloudBootstrapped, cloudWriteBlocked, cloudSyncing]);

  const releaseCurrentEditLock=async () => {
    const lock=activeEditLock;
    lockCoordinator.current.invalidate();
    if(!lock)return true;
    if(lock.status==='blocked'){
      leaseCloudConfigs.current.delete(lock.leaseOwnerId);
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      return true;
    }
    const leaseRecord=leaseCloudConfigs.current.get(lock.leaseOwnerId);
    if(!leaseRecord){
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      return true;
    }
    try{
      await lockCoordinator.current.run(()=>releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config));
      leaseCloudConfigs.current.delete(lock.leaseOwnerId);
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
      setCloudStatus('多人協作鎖已釋放');
      return true;
    }catch(error:any){
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?(previous.status==='error'?previous:{...previous,status:'error'}):previous);
      setCloudStatus(`協作鎖釋放失敗：${error.message||error}`);
      return false;
    }
  };
  const closeEditorForLock=(lock:ActiveEditLock)=>{
    if(lock.sectionKey.startsWith('task:')){
      setEditingTaskId('');setTaskEditorAuthorizationEpoch('');setTaskProgressVesselId('');setCreatingTask(null);taskOpenRequests.current.invalidate();
    }
    if(lock.sectionKey.startsWith('vessel:')){setEditingVesselId('');if(batchManagedRequested.current)invalidateBatchManagedLocks('船舶協作鎖狀態已變更；已關閉批量更新');}
  };
  const resolveEditLockNotice=()=>{
    const lock=activeEditLock;
    if(!lock)return;
    if(lock.status==='blocked'){leaseCloudConfigs.current.delete(lock.leaseOwnerId);setActiveEditLock(null);return;}
    closeEditorForLock(lock);
    void releaseCurrentEditLock();
  };

  useEffect(()=>{
    const lock=activeEditLock;
    const checkConfig=()=>{
      const configIdentity=cloudIdentity(getSupabaseConfig());
      if(configIdentity!==observedCloudConfig.current){observedCloudConfig.current=configIdentity;configIoCoordinator.current.invalidate();}
      const pending=pendingClaimConfig.current;
      if(pending&&!pending.invalidated&&!sameCloudConfig(getSupabaseConfig(),pending.config)){
        pending.invalidated=true;
        lockCoordinator.current.invalidate();
        setCloudStatus('雲端設定已變更：已取消尚未完成的舊工作區協作鎖檢查');
      }
      if(lock&&lock.status==='blocked'){
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
      if(record&&sameCloudConfig(getSupabaseConfig(),record.config))return;
      lockCoordinator.current.invalidate();
      closeEditorForLock(lock);
      setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
      setSensitiveCloudStatus(`雲端設定已變更：已關閉 ${lock.label} 並停止舊工作區續期`,lock.sectionKey);
      void releaseCurrentEditLock();
    };
    const onStorage=(event:StorageEvent)=>{if(event.key==='ship-dynamics-supabase-config'){configIoCoordinator.current.invalidate();observedCloudConfig.current=cloudIdentity(getSupabaseConfig());}checkConfig();};
    window.addEventListener('storage',onStorage);
    const timer=window.setInterval(checkConfig,1000);
    checkConfig();
    return()=>{window.removeEventListener('storage',onStorage);window.clearInterval(timer);};
  },[activeEditLock?.sectionKey,activeEditLock?.status,activeEditLock?.leaseOwnerId,activeEditLock?.generation]);

  useEffect(()=>{
    const lock=activeEditLock;
    if(!lock||lock.status!=='owned')return;
    if(lock.authorizationEpoch!==authorizationEpoch||lock.ownerUserId!==currentUser?.id)return;
    const timer=window.setInterval(()=>{
      void lockCoordinator.current.run(async()=>{
        if(!lockCoordinator.current.isCurrent(lock.generation)||liveAuthorizationEpoch.current!==lock.authorizationEpoch||!liveAuthorizedEditLockKeys.current.has(lock.sectionKey))return;
        try{
          const leaseRecord=leaseCloudConfigs.current.get(lock.leaseOwnerId);
          if(!leaseRecord)throw new Error('協作鎖的原始雲端設定已遺失');
          if(!sameCloudConfig(getSupabaseConfig(),leaseRecord.config)){
            lockCoordinator.current.invalidate();
            closeEditorForLock(lock);
            setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
            setSensitiveCloudStatus(`雲端設定已變更：已關閉 ${lock.label} 並停止舊工作區續期`,lock.sectionKey);
            void releaseCurrentEditLock();
            return;
          }
          const renewed=await claimEditLock(lock.sectionKey,lock.leaseOwnerId,lock.ownerUserName,75,leaseRecord.config);
          if(!lockCoordinator.current.isCurrent(lock.generation)||liveAuthorizationEpoch.current!==lock.authorizationEpoch||!liveAuthorizedEditLockKeys.current.has(lock.sectionKey)){
            if(renewed.ok){await releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config);leaseCloudConfigs.current.delete(lock.leaseOwnerId);}
            else leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            return;
          }
          if(!renewed.ok){
            const lockedByName=renewed.lockedByName||'其他使用者';
            leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            setActiveEditLock({...lock,status:'blocked',lockedByName});
            setSensitiveCloudStatus(`協作鎖已失效：${lock.label} 已由 ${lockedByName} 編輯，正在讀取最新只讀資料`,lock.sectionKey);
            if(lock.sectionKey.startsWith('task:')){
              const taskId=lock.sectionKey.slice('task:'.length);
              const requestGeneration=taskOpenRequests.current.begin(taskOpenRequests.current.peek()||{vesselId:'',batchManaged:false});
              setCreatingTask(null);
              void openTaskReadOnly(taskId,`${lockedByName} 已接手編輯此事項`,requestGeneration,taskProgressVesselId,leaseRecord.config).then(result=>{if(result==='failed'&&taskOpenRequests.current.isCurrent(requestGeneration))closeTaskEditor();});
            }else closeEditorForLock(lock);
          }else{
            setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId&&previous.status==='owned'?{...previous,validatedUntilMs:conservativeLeaseDeadline(renewed.expiresAt)}:previous);
          }
        }catch(error:any){
          if(!lockCoordinator.current.isCurrent(lock.generation))return;
          setActiveEditLock({...lock,status:'error'});
          setSensitiveCloudStatus(`協作鎖續期失敗：${error.message||error}`,lock.sectionKey);
        }
      });
    },30000);
    return()=>window.clearInterval(timer);
  },[activeEditLock?.sectionKey,activeEditLock?.status,activeEditLock?.authorizationEpoch,activeEditLock?.ownerUserId,activeEditLock?.leaseOwnerId,activeEditLock?.generation,authorizationEpoch,currentUser?.id]);

  useEffect(()=>{
    const lock=activeEditLock;
    if(!lock||lock.status!=='owned'||!lock.validatedUntilMs)return;
    if(lock.authorizationEpoch!==authorizationEpoch||lock.ownerUserId!==currentUser?.id)return;
    const leaseRecord=leaseCloudConfigs.current.get(lock.leaseOwnerId);
    return scheduleValidatedLeaseExpiry(lock.validatedUntilMs,()=>{
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
          closeAfterFailure:closeTaskEditor,
        });
      }else{
        lockCoordinator.current.invalidate();
        setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?{...previous,status:'error'}:previous);
        closeEditorForLock(lock);
        setSensitiveCloudStatus(`協作鎖有效期已到：${lock.label} 已停止編輯`,lock.sectionKey);
      }
      if(leaseRecord){
        void releaseEditLock(leaseRecord.sectionKey,lock.leaseOwnerId,leaseRecord.config)
          .catch(error=>setSensitiveCloudStatus(`協作鎖已失效，伺服器清理失敗：${error.message||error}`,lock.sectionKey))
          .finally(()=>{
            leaseCloudConfigs.current.delete(lock.leaseOwnerId);
            setActiveEditLock(previous=>previous?.leaseOwnerId===lock.leaseOwnerId?null:previous);
          });
      }
    });
  },[activeEditLock?.sectionKey,activeEditLock?.status,activeEditLock?.authorizationEpoch,activeEditLock?.ownerUserId,activeEditLock?.leaseOwnerId,activeEditLock?.generation,activeEditLock?.validatedUntilMs,authorizationEpoch,currentUser?.id,taskProgressVesselId]);

  useEffect(()=>{
    if(!batchManagedOpen||batchLocalMode.current||!batchEditLocks.length)return;
    const session=batchManagedSession.current;
    const sessionIsCurrent=()=>batchManagedRequested.current&&batchManagedOpenRef.current&&batchManagedSession.current===session;
    const fail=(message:string)=>{if(sessionIsCurrent())invalidateBatchManagedLocks(message);};
    const checkConfig=()=>{
      const snapshot=batchEditLocksRef.current;
      if(!snapshot.length)return;
      const valid=snapshot.every(lock=>{
        const record=batchLeaseCloudConfigs.current.get(lock.leaseOwnerId);
        return Boolean(record&&sameCloudConfig(getSupabaseConfig(),record.config));
      });
      if(!valid)fail('雲端設定已變更；已關閉批量更新並停止全部舊工作區鎖續期');
    };
    const renew=async()=>{
      const snapshot=batchEditLocksRef.current;
      if(!snapshot.length||!sessionIsCurrent())return;
      try{
        const renewed=await batchLockCoordinator.current.run(async()=>{
          const next:ActiveEditLock[]=[];
          for(const lock of snapshot){
            if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(lock.generation)||liveAuthorizationEpoch.current!==lock.authorizationEpoch)throw new Error('批量編輯身份或權限已變更');
            const record=batchLeaseCloudConfigs.current.get(lock.leaseOwnerId);
            if(!record||!sameCloudConfig(getSupabaseConfig(),record.config))throw new Error('批量協作鎖的雲端設定已變更');
            const result=await claimEditLock(lock.sectionKey,lock.leaseOwnerId,lock.ownerUserName,75,record.config);
            if(!result.ok)throw new Error(`${lock.label} 的協作鎖已由 ${result.lockedByName||'其他使用者'} 取得`);
            next.push({...lock,validatedUntilMs:conservativeLeaseDeadline(result.expiresAt)});
          }
          return next;
        });
        if(!sessionIsCurrent())return;
        batchEditLocksRef.current=renewed;
        setBatchEditLocks(renewed);
      }catch(error:any){fail(`批量船舶協作鎖續期失敗：${error.message||error}；已關閉全部批量編輯`);}
    };
    window.addEventListener('storage',checkConfig);
    const configTimer=window.setInterval(checkConfig,1000);
    const renewTimer=window.setInterval(()=>{void renew();},30000);
    checkConfig();
    return()=>{window.removeEventListener('storage',checkConfig);window.clearInterval(configTimer);window.clearInterval(renewTimer);};
  },[batchManagedOpen,batchEditLocks.map(lock=>lock.leaseOwnerId).join('|'),authorizationEpoch,currentUser?.id]);

  useEffect(() => {
    const previousAuthorizationEpochValue=previousAuthorizationEpoch.current;
    previousAuthorizationEpoch.current=authorizationEpoch;
    const authorizationChanged=Boolean(previousAuthorizationEpochValue&&previousAuthorizationEpochValue!==authorizationEpoch);
    const staleLock=Boolean(activeEditLock&&(activeEditLock.authorizationEpoch!==authorizationEpoch||activeEditLock.ownerUserId!==currentUser?.id));
    if(authorizationChanged){
      taskOpenRequests.current.invalidate();
      setSelectedVesselDetailId('');
      setEditingVesselId('');
      setEditingTaskId('');
      setTaskEditorAuthorizationEpoch('');
      setTaskProgressVesselId('');
      setTaskReadOnlyData(null);
      setTaskReadOnlyReason('');
      setCreatingTask(null);
      invalidateBatchManagedLocks('身份或權限已變更；已關閉批量更新並釋放全部船舶鎖');
      setAgendaSelection([]);
      setReportPreviewOpen(false);
      setPasswordModalOpen(false);
      setPrintTitle('');
      setCloudStatus(getSupabaseConfig()?'身份、權限或船舶範圍已變更，請同步最新資料':'本機模式');
    }
    if(authorizationChanged||staleLock)releaseCurrentEditLock();
  }, [authorizationEpoch,activeEditLock?.authorizationEpoch,activeEditLock?.ownerUserId,currentUser?.id]);

  const claimEditingLock=async(sectionKey:string,label:string,stillWanted?:()=>boolean,announceBlocked=true):Promise<EditLockClaimResult>=>{
    if(!currentUser)return 'unavailable';
    if(activeEditLock&&!(await releaseCurrentEditLock()))return 'unavailable';
    if(stillWanted&&!stillWanted())return 'unavailable';
    const leaseConfig=getSupabaseConfig();
    if(!leaseConfig){setSensitiveCloudStatus(`本機編輯：${label}`,sectionKey);return 'owned';}
    const ownerUserId=currentUser.id;
    const ownerUserName=currentUser.name;
    const leaseOwnerId=`${ownerUserId}:${crypto.randomUUID()}`;
    const claimAuthorizationEpoch=authorizationEpoch;
    const generation=lockCoordinator.current.beginGeneration();
    pendingClaimConfig.current={generation,config:leaseConfig,invalidated:false};
    const lockState={sectionKey,label,ownerUserId,ownerUserName,leaseOwnerId,generation,authorizationEpoch:claimAuthorizationEpoch,validatedUntilMs:0};
    setSensitiveCloudStatus(`正在檢查多人協作鎖：${label}`,sectionKey);
    try{return await lockCoordinator.current.run(async()=>{
      try{
        for(const [pendingOwner,pending] of leaseCloudConfigs.current){
          await releaseEditLock(pending.sectionKey,pendingOwner,pending.config);
          leaseCloudConfigs.current.delete(pendingOwner);
        }
      }catch(error:any){
        setCloudStatus(`舊協作鎖仍無法釋放，已停止開啟新的編輯：${error.message||error}`);
        return 'unavailable';
      }
      if(!sameCloudConfig(getSupabaseConfig(),leaseConfig)){if(lockCoordinator.current.isCurrent(generation))lockCoordinator.current.invalidate();return 'unavailable';}
      if((stillWanted&&!stillWanted())||!lockCoordinator.current.isCurrent(generation)||liveAuthorizationEpoch.current!==claimAuthorizationEpoch||!liveAuthorizedEditLockKeys.current.has(sectionKey))return 'unavailable';
      leaseCloudConfigs.current.set(leaseOwnerId,{sectionKey,config:leaseConfig});
      try{
        const lock=await claimEditLock(sectionKey,leaseOwnerId,ownerUserName,75,leaseConfig);
        const configStillCurrent=sameCloudConfig(getSupabaseConfig(),leaseConfig);
        if(!configStillCurrent&&lockCoordinator.current.isCurrent(generation))lockCoordinator.current.invalidate();
        if(!configStillCurrent||(stillWanted&&!stillWanted())||!lockCoordinator.current.isCurrent(generation)||liveAuthorizationEpoch.current!==claimAuthorizationEpoch||!liveAuthorizedEditLockKeys.current.has(sectionKey)){
          if(lock.ok){await releaseEditLock(sectionKey,leaseOwnerId,leaseConfig);leaseCloudConfigs.current.delete(leaseOwnerId);}
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
        setActiveEditLock({...lockState,status:'owned',validatedUntilMs:conservativeLeaseDeadline(lock.expiresAt)});
        setSensitiveCloudStatus(`多人協作安全：已鎖定 ${label}，其他人會看到正在編輯提示`,sectionKey);
        return 'owned';
      }catch(error:any){
        if(!sameCloudConfig(getSupabaseConfig(),leaseConfig)&&lockCoordinator.current.isCurrent(generation))lockCoordinator.current.invalidate();
        let cleanupFailed=false;
        try{await releaseEditLock(sectionKey,leaseOwnerId,leaseConfig);leaseCloudConfigs.current.delete(leaseOwnerId);}catch{cleanupFailed=true;}
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
    const lock=activeEditLock;
    if(!lock&&!getSupabaseConfig())return true;
    const record=lock?leaseCloudConfigs.current.get(lock.leaseOwnerId):undefined;
    const currentConfig=getSupabaseConfig();
    return editLockAllowsMutation(lock,sectionKey,currentUser?.id,authorizationEpoch,Boolean(lock&&lockCoordinator.current.isCurrent(lock.generation)),Boolean(record&&record.sectionKey===sectionKey&&sameCloudConfig(currentConfig,record.config)));
  };
  const requireMutationLease=(sectionKey:string)=>{
    if(mutationLeaseIsOwned(sectionKey))return true;
    if(sectionKey.startsWith('task:')){setEditingTaskId('');setTaskEditorAuthorizationEpoch('');setTaskProgressVesselId('');setCreatingTask(null);}
    if(sectionKey.startsWith('vessel:'))setEditingVesselId('');
    setSensitiveCloudStatus('協作鎖已失效或無法確認；編輯器已關閉，本次未保存',sectionKey);
    if(activeEditLock?.sectionKey===sectionKey)void releaseCurrentEditLock();
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
  const canViewAllVessels = currentUser?.role==='owner'||currentUser?.role==='admin'||hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const requireManage = () => { if (!currentUser || !hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement')) { alert('您無權訪問管理頁面'); navigateToTab('dashboard'); return false; } return true; };

  const activeVessels = useMemo(()=>data.vessels.filter(v=>v.isActive&&vesselMatchesUser(v,currentUser,canViewAllVessels)),[data.vessels,currentUser,canViewAllVessels]);
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
  const roleVisibleData=useMemo(()=>({...data,tasks:roleVisibleTasks,meetings:roleVisibleMeetings,internalControlCases:roleVisibleInternalControlCases}),[data,roleVisibleTasks,roleVisibleMeetings,roleVisibleInternalControlCases]);
  const taskLockIsAuthorized = (task: TaskItem) => canAcquireTaskEditLock(task,currentUser,canEditBusinessContent,activeVessels,data.settings.rolePermissions);
  const authorizedEditLockKeys=useMemo(()=>new Set<string>([
    ...(canEditBusinessContent?activeVessels.map(vessel=>`vessel:${vessel.id}`):[]),
    ...roleVisibleTasks.filter(taskLockIsAuthorized).map(task=>`task:${task.id}`),
  ]),[canEditBusinessContent,currentUser,activeVessels,roleVisibleTasks,data.settings.rolePermissions]);
  const authorizedEditLockKey=[...authorizedEditLockKeys].sort().join('|');
  liveAuthorizedEditLockKeys.current=authorizedEditLockKeys;
  useEffect(()=>{if(activeEditLock&&!authorizedEditLockKeys.has(activeEditLock.sectionKey))releaseCurrentEditLock();},[authorizedEditLockKey,activeEditLock?.sectionKey]);
  const visibleCloudStatus=cloudStatusSectionKey&&(
    cloudStatusAuthorizationEpoch!==authorizationEpoch
    ||!authorizedEditLockKeys.has(cloudStatusSectionKey)
    ||activeEditLock?.sectionKey!==cloudStatusSectionKey
  )?(getSupabaseConfig()?'多人協作狀態已更新':'本機模式'):cloudStatus;
  const dashboardMeetings = useMemo(()=>dashboardMeetingAlerts(
    roleVisibleMeetings,
    activeVessels.map(vessel=>vessel.id),
    meeting=>Boolean(canUseMeetingWorkspace&&meetingAppliesToUser(meeting,activeVessels,canEditTemporaryMeetings(data.settings.rolePermissions,currentUser),currentUser.id)),
  ),[roleVisibleMeetings,data.settings.rolePermissions,currentUser,activeVessels,canUseMeetingWorkspace]);
  const selectedVesselDetail = activeVessels.find(vessel=>vessel.id===selectedVesselDetailId);
  const reportVessels = activeVessels;
  const myWorkTaskCount = currentUser ? selectUserWorkCenterTasks(roleVisibleData,currentUser,activeVessels).length + selectUserWorkCenterInternalCases(roleVisibleData,currentUser,activeVessels).length : 0;
  useEffect(() => { setAgendaSelection(prev => prev.filter(id => activeVessels.some(v=>v.id===id))); }, [activeVessels]);
  useEffect(() => { if (selectedVesselDetailId && !activeVessels.some(vessel=>vessel.id===selectedVesselDetailId)) setSelectedVesselDetailId(''); }, [activeVessels, selectedVesselDetailId]);
  useEffect(() => { if (currentUser && (!canAccessTab(currentUser, tab) || (tab === 'reports' && !canExportReports))) setTab('dashboard'); }, [currentUser, tab, canExportReports]);
  const vesselMap = useMemo(() => Object.fromEntries(data.vessels.map(v => [v.id, v])), [data.vessels]);
  const userMap = useMemo(() => Object.fromEntries(data.users.map(u => [u.id, u])), [data.users]);
  const fleetTags = useMemo(() => Array.from(new Set(data.vessels.flatMap(v => v.fleetTags))).filter(Boolean), [data.vessels]);

  const filteredTasks = useMemo(() => {
    const visibleIds=activeVessels.map(vessel=>vessel.id);
    return roleVisibleTasks
      .filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id))))
      .sort((a,b)=>Number(taskProjectedProgressForScope(a,visibleIds).isClosed)-Number(taskProjectedProgressForScope(b,visibleIds).isClosed)||(daysDiff(a.expectedDate)??9999)-(daysDiff(b.expectedDate)??9999));
  },[roleVisibleTasks,vesselMap,currentUser,filters,canViewAllVessels,activeVessels]);
  const statsTasks = useMemo(() => roleVisibleTasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,false,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[roleVisibleTasks,vesselMap,currentUser,filters,canViewAllVessels]);
  const closedTasks = useMemo(() => roleVisibleTasks.filter(t=>taskMatchesFilters(t,closedFilters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[roleVisibleTasks,vesselMap,currentUser,closedFilters,canViewAllVessels]);

  if (!cloudBootstrapped) return <div className="login-page"><div className="login-card loading-card"><h2>正在載入雲端主資料</h2><p className="muted">請稍候，完成前不會寫入或覆蓋資料。</p></div></div>;
  if (!siteUnlocked || !data.settings.sitePasswordHash) return <SiteGate data={data} setData={setData} onUnlock={() => { sessionStorage.setItem(SESSION_SITE_UNLOCK,'1'); setSiteUnlocked(true); }} />;
  if (!ownerExists && !currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;
  if (!ownerExists && currentUser) return <OwnerSetup currentUser={currentUser} setData={setData} setCurrentUserId={setCurrentUserId} />;
  if (!currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;

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
  const navigateToTab = (nextTab: Tab) => {
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
    setSelectedVesselDetailId('');
  };

  const openVesselEditor = async (id: string) => {
    invalidatePendingTaskOpen();
    const vessel = data.vessels.find(item => item.id === id);
    if (!vessel) return alert('找不到對應船舶');
    if(!canEditBusinessContent||!activeVessels.some(item=>item.id===vessel.id))return alert('目前身份無權編輯此船舶');
    if (await claimEditingLock(`vessel:${id}`, `船舶｜${vesselDisplayName(vessel)}`)==='owned') setEditingVesselId(id);
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
      setTaskProgressVesselId(vesselId);
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
    if(data.notifications.some(item=>item.userId===currentUser.id&&item.taskId===visibleTask.id&&!item.readAt)){
      commit(draft=>{const at=nowIso();draft.notifications.forEach(item=>{if(item.userId===currentUser.id&&item.taskId===task.id&&!item.readAt)item.readAt=at;});},'查看待辦更新','notification',task.id,'標記此待辦未讀變動');
    }
    const result=await openTaskEditor(visibleTask,vesselId,requestGeneration);
    if(result!=='opened')taskOpenRequests.current.clearIfCurrent(requestGeneration);
    return result;
  };
  const addTaskForVessel = (vesselId: string, returnToVessel = false, returnToBatchManaged = false) => {
    if (!requireLogin()) return false;
    if (!canCreateTasks) { alert('目前角色未獲授權新增要事'); return false; }
    if (!currentUser || !canUseVessel(currentUser, vesselId)) { alert('船舶帳戶只能新增本船待辦'); return false; }
    const vessel = data.vessels.find(item => item.id === vesselId);
    if (!vessel) { alert('找不到對應船舶'); return false; }
    invalidatePendingTaskOpen();
    setEditingTaskId('');
    setTaskProgressVesselId('');
    const assignedOwnerUserIds = vessel.assignedUserIds.filter(id => data.users.some(user => user.id === id && user.isActive && user.role !== 'vessel'));
    const id = uid('task');
    taskOpenRequests.current.begin({vesselId:returnToVessel?vesselId:'',batchManaged:returnToBatchManaged});
    setTaskEditorAuthorizationEpoch(authorizationEpoch);
    setCreatingTask({ id, vesselId, priority:'中', isAware:false, isAbnormal:false, isInternalControl:false, sourceType:'morning', category:'', categories:[], description:'', status:'', expectedDate:'', reportDate:todayDate(), departments:[], ownerUserIds: currentUser.role==='vessel' ? [] : assignedOwnerUserIds, isClosed:false, createdBy:currentUser.id, updatedBy:currentUser.id, createdAt:nowIso(), updatedAt:nowIso(), statusLogs:[] });
    return true;
  };
  const createInternalCases = (items: InternalControlCase[], expectedRevision: number, projections: Record<string, InternalControlTaskProjection> = {}) => {
    let applied=false;
    let failure='內控案件未保存：資料或權限已變更';
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
    if(!applied)alert(failure);
    return applied;
  };
  const saveInternalCase = (candidate: InternalControlCase, expectedUpdatedAt: string, expectedRevision: number, projection?: InternalControlTaskProjection) => {
    let applied=false;
    let failure='內控案件未保存：資料或權限已變更';
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
    if(!applied)alert(failure);
    return applied;
  };
  const removeInternalCase = (candidate: InternalControlCase, expectedRevision: number) => {
    let applied=false;
    let failure='內控案件未刪除：資料或權限已變更';
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
      })){failure='刪除內控案件及關聯待辦，需同時具備刪除、結案及此船舶的取消內控權限';return prev;}
      const draft=clone(prev);
      try{deleteInternalControlCase(draft,candidate.id,candidate.updatedAt);}
      catch(error:any){failure=error.message||String(error);return prev;}
      applied=true;
      return withAudit(draft,liveUser,'刪除內控異常','internal-control',candidate.id,richTextToPlainText(candidate.description)||candidate.id);
    }));
    if(!applied)alert(failure);
    return applied;
  };
  const saveTask = (candidate: TaskItem, creating: boolean, expectedUpdatedAt: string, expectedRevision: number) => {
    if(!creating&&!requireMutationLease(`task:${candidate.id}`))return false;
    let applied=false;
    let failure='事項已變更或權限已更新，請重新整理後再試';
    flushSync(()=>setData(prev=>{
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
      if(!creating&&prev.revision!==expectedRevision){failure='主資料版本已更新，為避免覆蓋其他操作，本次未保存；請關閉後重新開啟事項';return prev;}
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
      if(creating)draft.tasks.unshift(saved);
      else{
        const index=draft.tasks.findIndex(item=>item.id===saved.id);
        if(index<0){failure='事項已被刪除或不存在，未保存任何變更';return prev;}
        draft.tasks[index]=saved;
      }
      try{reconcileInternalControlAfterTaskSave(draft,creating?undefined:previous,saved,liveUser,saveAt);}
      catch(error:any){failure=error.message||String(error);return prev;}
      draft.vessels.filter(item=>taskHasVessel(saved,item.id)).forEach(targetVessel=>{targetVessel.weeklyAttention=mergeAttentionFromCategories(targetVessel.weeklyAttention,saved.categories);});
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      applied=true;
      return withAudit(draft,liveUser,creating?'新增事項':cancelled?'取消內部管控':'更新事項','task',saved.id,cancelled?'已提醒至 FLOW 系統申報異常':creating?'建立跟進事項':'保存事項變更');
    }));
    if(!applied)alert(failure);
    return applied;
  };
  const saveTaskVesselProgress = (candidate: TaskItem, vesselId: string, expectedUpdatedAt: string, expectedRevision: number) => {
    if(!requireMutationLease(`task:${candidate.id}`))return false;
    let applied=false;
    let failure='單船進度已變更或權限已更新，請重新開啟後再試';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')){failure='目前身份無權更新單船進度';return prev;}
      const matchingTasks=prev.tasks.filter(item=>item.id===candidate.id);
      if(matchingTasks.length!==1){failure=matchingTasks.length?'待辦編號重複，已拒絕不明確的單船進度更新':'待辦不存在或不是多船會議待辦';return prev;}
      const liveTask=matchingTasks[0];
      if(!usesPerVesselProgress(liveTask)){failure='待辦不存在或不是多船會議待辦';return prev;}
      if(!meetingTaskLinkIsValidForMutation(liveTask,prev.meetings)){failure='會議來源關聯缺失、失效或與父會議狀態不一致，請先由臨會/專題頁安全修復';return prev;}
      if(prev.revision!==expectedRevision||liveTask.updatedAt!==expectedUpdatedAt){failure='資料已由其他人更新，為避免覆蓋，本次未保存；請重新開啟';return prev;}
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
      const notices=buildTaskNotificationsForVessels(prev.users,[vessel],liveUser.id,saved,'task_updated',liveUser.name,prev.settings.rolePermissions);
      const draft=clone(prev);
      const index=draft.tasks.findIndex(item=>item.id===saved.id);
      if(index<0){failure='待辦已被刪除';return prev;}
      draft.tasks[index]=saved;
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      applied=true;
      return withAudit(draft,liveUser,'更新單船進度','task',saved.id,`${vesselDisplayName(vessel)}｜${normalizedProgress.status||'未填狀態'}｜${normalizedProgress.isClosed?'已結案':'未結'}`);
    }));
    if(!applied)alert(failure);
    return applied;
  };
  const deleteTask = (task: TaskItem) => {
    if(!currentUser||!canDeleteTasks||!canDeleteTask(currentUser)) return alert('只有 Owner／管理員可以刪除待辦');
    if(!confirm(`確定刪除待辦「${richTextToPlainText(task.description)||task.id}」？此動作會留下操作紀錄。`)) return;
    if(!requireMutationLease(`task:${task.id}`))return;
    let applied=false;
    let failure='待辦已變更或權限已更新，未執行刪除';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)){failure='只有 Owner／管理員可以刪除待辦';return prev;}
      if(prev.tasks.filter(item=>item.id===task.id).length!==1){failure='待辦識別碼缺失或重複，為避免一次刪除多筆資料，本次未執行';return prev;}
      const liveTask=prev.tasks.find(item=>item.id===task.id);
      if(!liveTask){failure='待辦已被刪除或不存在';return prev;}
      if(prev.revision!==data.revision||liveTask.updatedAt!==task.updatedAt){failure='待辦或主資料已由其他人更新，為避免刪除最新變更，本次未執行';return prev;}
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
    }));
    if(!applied)return alert(failure);
    closeTaskEditor();
  };
  const batchCompleteTasks = (taskIds: string[]) => {
    if(!currentUser||!canCloseTasks||currentUser.role==='vessel') { alert('目前角色未獲授權批量完成待辦'); return false; }
    const uniqueIds=[...new Set(taskIds)];
    const visibleVesselIds=new Set(activeVessels.map(vessel=>vessel.id));
    const selectedTasks=uniqueIds.map(id=>data.tasks.find(task=>task.id===id));
    if(!uniqueIds.length) { alert('請先選擇要完成的待辦'); return false; }
    if(selectedTasks.some(task=>!task||task.isClosed||usesPerVesselProgress(task)||!taskVesselIds(task).every(id=>visibleVesselIds.has(id)))) { alert('所選待辦已變更、已結案、多船會議待辦不得批量完成，或未具備完整涉船範圍權限，請重新選擇'); return false; }
    const tasks=selectedTasks as TaskItem[];
    const expectedRevision=data.revision;
    const expectedUpdatedAtById=new Map(tasks.map(task=>[task.id,task.updatedAt]));
    if(!confirm(`確定批量完成所選 ${tasks.length} 筆待辦？`)) return false;
    const at=nowIso();
    const closedDate=todayDate();
    let applied=false;
    let failure='批量完成未執行：資料或權限已變更，請保留選擇並重新確認';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')||liveUser.role==='vessel') return prev;
      const liveSelection=validateBatchTaskSelection(prev.tasks,uniqueIds,batchVisibleVesselIds(prev,liveUser),'complete');
      if(!liveSelection.ok||prev.revision!==expectedRevision||liveSelection.tasks.some(task=>task.updatedAt!==expectedUpdatedAtById.get(task.id))) return prev;
      if(liveSelection.tasks.some(task=>!meetingTaskLinkIsValidForMutation(task,prev.meetings))) return prev;
      let draft=clone(prev);
      const result=completeSelectedTasks(draft.tasks,liveSelection.taskIds,{actorId:liveUser.id,actorName:liveUser.name,at,closedDate});
      const completedTasks=liveSelection.tasks;
      const notices=completedTasks.flatMap(task=>{
        const vessels=taskVessels(task,draft.vessels);
        const noticeTask={...task,ownerUserIds:task.ownerUserIds.filter(id=>isEligibleTaskOwner(draft.settings.rolePermissions,draft.users.find(user=>user.id===id),vessels))};
        return buildTaskNotificationsForVessels(draft.users,vessels,liveUser.id,noticeTask,'task_updated',liveUser.name,draft.settings.rolePermissions);
      });
      draft.tasks=result.tasks;
      try{syncLinkedInternalControlCasesFromTasks(draft,liveSelection.taskIds,liveUser,at);}
      catch(error:any){failure=error.message||String(error);return prev;}
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      completedTasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量完成事項','task',task.id,richTextToPlainText(task.description)||task.id); });
      applied=true;
      return draft;
    }));
    if(!applied) alert(failure);
    return applied;
  };
  const batchDeleteTasks = (taskIds: string[]) => {
    if(!currentUser||!canDeleteTasks||!canDeleteTask(currentUser)) { alert('只有 Owner／管理員可以批量刪除待辦'); return false; }
    const uniqueIds=[...new Set(taskIds)];
    const visibleVesselIds=new Set(activeVessels.map(vessel=>vessel.id));
    const selectedTasks=uniqueIds.map(id=>data.tasks.find(task=>task.id===id));
    if(!uniqueIds.length) { alert('請先選擇要刪除的待辦'); return false; }
    if(selectedTasks.some(task=>!task||!taskVesselIds(task).every(id=>visibleVesselIds.has(id)))) { alert('所選待辦已變更或未具備完整涉船範圍權限，請重新選擇'); return false; }
    const tasks=selectedTasks as TaskItem[];
    if(!confirm(`確定批量刪除所選 ${tasks.length} 筆待辦？此動作無法復原，並會逐筆留下操作紀錄。`)) return false;
    let applied=false;
    let failure='批量刪除未執行：資料或權限已變更，請保留選擇並重新確認';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)||prev.revision!==data.revision) return prev;
      const liveSelection=validateBatchTaskSelection(prev.tasks,uniqueIds,batchVisibleVesselIds(prev,liveUser),'delete');
      if(!liveSelection.ok||liveSelection.tasks.some(task=>task.updatedAt!==(selectedTasks.find(selected=>selected?.id===task.id)?.updatedAt))) return prev;
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
      try{deleteTaskBatchFromDraft(draft,liveSelection.tasks,liveUser,nowIso());}
      catch(error:any){failure=error.message||String(error);return prev;}
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      internalControlTasks.forEach(task=>{
        draft=withAudit(draft,liveUser,'取消內部管控','task',task.id,`${richTextToPlainText(task.description)||task.id}｜批量刪除時同步取消｜取消人 ${liveUser.id}｜${nowIso()}`);
        if(task.sourceMeetingId)draft=withAudit(draft,liveUser,'更新臨會/專題內部管控','meeting',task.sourceMeetingId,`批量刪除關聯內控待辦 ${task.id}`);
      });
      liveSelection.tasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量刪除事項','task',task.id,richTextToPlainText(task.description)||task.id); });
      applied=true;
      return draft;
    }));
    if(!applied) alert(failure);
    return applied;
  };
  const openReportPreview = () => {
    if (!canExportReports) return alert('目前角色未獲授權預覽或匯出報告');
    setReportPreviewOpen(true);
  };
  const syncLatest = async () => {
    const syncConfig = getSupabaseConfig();
    if (!syncConfig) return setCloudStatus('本機模式：尚未配置 Supabase，無法同步雲端');
    if (!confirm('同步最新會以雲端資料取代目前本機畫面，確定繼續？')) return;
    if (cloudSyncInFlight.current) return setCloudStatus('正在同步雲端，請稍候');

    cloudSyncInFlight.current = true;
    setCloudSyncing(true);
    setCloudWriteBlocked(true);
    configIoCoordinator.current.invalidate();
    const syncToken = configIoCoordinator.current.begin(syncConfig);
    const syncIdentity = cloudIdentity(syncToken.config);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    pendingCloudData.current = null;
    if (cloudSaveInFlight.current) await cloudSaveInFlight.current.catch(() => undefined);
    activeCloudIdentity.current = syncIdentity;
    try {
      const remote = await configIoCoordinator.current.run(syncToken, getSupabaseConfig, fetchCloudData);
      if (!configIoCoordinator.current.isCurrent(syncToken, getSupabaseConfig())) throw new StaleAsyncConfigError();
      if (remote) {
        lastCloudRevision.current = remote.revision;
        confirmedCloudData.current = remote;
        setData(remote);
        setCloudWriteBlocked(false);
        rememberCloudIdentity();
        setCloudStatus(savedStatus('已同步雲端', remote.updatedAt));
      } else {
        lastCloudRevision.current = -1;
        confirmedCloudData.current = null;
        setCloudWriteBlocked(false);
        rememberCloudIdentity();
        setCloudStatus('雲端尚無資料；已允許以目前本機資料初始化');
      }
    } catch (error: any) {
      setCloudWriteBlocked(true);
      setCloudStatus(`同步失敗：${error.message || error}`);
    } finally {
      cloudSyncInFlight.current = false;
      setCloudSyncing(false);
    }
  };
  const saveChanges = async () => {
    if (!getSupabaseConfig()) { setCloudStatus(saveLocal(data) ? savedStatus('已保存於本機瀏覽器') : '本機保存失敗：瀏覽器儲存空間不足或不可用'); return; }
    if (cloudSyncInFlight.current) { setCloudStatus('正在同步雲端，請稍候'); return; }
    if (cloudWriteBlocked) { setCloudStatus('雲端寫入已阻擋：請先同步最新資料，確認採用雲端版本後再修改'); return; }
    if (data.revision<=lastCloudRevision.current) { setCloudStatus(savedStatus('雲端已是最新版本')); return; }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    try { await enqueueCloudSave(data); }
    catch(e:any){setCloudStatus(`保存失敗：${e.message||e}`);}
  };
  const print = (title: string) => { if (!canExportReports) return alert('目前角色未獲授權匯出或列印報告'); setPrintTitle(title); setTimeout(() => window.print(), 80); };
  const printReport = () => { if (!canExportReports) return alert('目前角色未獲授權匯出或列印報告'); document.body.classList.add('printing-report'); window.addEventListener('afterprint', () => document.body.classList.remove('printing-report'), { once:true }); setTimeout(() => window.print(), 80); };
  const jumpToTaskList = (mode: 'open' | 'high' | 'overdue') => {
    setFilters({ ...emptyFilters, priorities: mode === 'high' ? ['急','高'] : [], overdueOnly: mode === 'overdue' });
    navigateToTab('total');
  };
  const closeTaskEditor = () => {
    const returnDestination=taskOpenRequests.current.consume();
    releaseCurrentEditLock();
    setEditingTaskId('');
    setTaskEditorAuthorizationEpoch('');
    setTaskProgressVesselId('');
    setTaskReadOnlyData(null);
    setTaskReadOnlyReason('');
    setCreatingTask(null);
    if (returnDestination?.batchManaged) void openBatchManagedVessels();
    else if (returnDestination?.vesselId && activeVessels.some(vessel => vessel.id === returnDestination.vesselId)) void openVesselEditor(returnDestination.vesselId);
  };
  const leaveCurrentIdentity = () => {
    taskOpenRequests.current.invalidate();
    releaseCurrentEditLock();
    setTab('dashboard');
    setSelectedVesselDetailId('');
    setEditingVesselId('');
    setEditingTaskId('');
    setTaskEditorAuthorizationEpoch('');
    setTaskProgressVesselId('');
    setTaskReadOnlyData(null);
    setTaskReadOnlyReason('');
    setCreatingTask(null);
    invalidateBatchManagedLocks('');
    setAgendaSelection([]);
    setReportPreviewOpen(false);
    setPasswordModalOpen(false);
    setPrintTitle('');
    setCurrentUserId('');
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
  const taskEditorReadOnly=Boolean(!creatingVisibleTask&&(taskReadOnlyData||!editingTaskCanMutate));
  const vesselEditorLeaseAuthorized=Boolean(editingVesselId&&mutationLeaseIsOwned(`vessel:${editingVesselId}`));
  const taskEditorLeaseAuthorized=Boolean(creatingVisibleTask||(editingTask&&(taskEditorReadOnly||mutationLeaseIsOwned(`task:${editingTask.id}`))));
  const vesselEditorCommit:typeof commit=(updater,action,entityType,entityId,detail)=>{
    if(!editingVesselId||entityType!=='vessel'||entityId!==editingVesselId||!requireMutationLease(`vessel:${editingVesselId}`))return;
    commit(updater,action,entityType,entityId,detail);
  };
  const closeBatchManaged=()=>{
    taskOpenRequests.current.invalidate();
    invalidateBatchManagedLocks('');
  };
  const openBatchManagedVessels=async()=>{
    if(batchManagedRequested.current||batchManagedOpenRef.current)return;
    if(!canEditBusinessContent||currentUser.role==='vessel')return alert('目前身份無權批量更新船舶');
    invalidatePendingTaskOpen();
    if(!(await releaseCurrentEditLock()))return alert('上一個協作鎖尚未成功釋放，暫不開啟批量更新');
    const session=++batchManagedSession.current;
    batchManagedRequested.current=true;
    const sessionIsCurrent=()=>batchManagedRequested.current&&batchManagedSession.current===session&&liveAuthorizationEpoch.current===authorizationEpoch;
    const config=getSupabaseConfig();
    if(!config){
      if(!sessionIsCurrent())return;
      batchLocalMode.current=true;
      batchManagedOpenRef.current=true;
      setBatchManagedOpen(true);
      setCloudStatus('本機模式：批量更新不需要雲端協作鎖');
      return;
    }
    batchLocalMode.current=false;
    const generation=batchLockCoordinator.current.beginGeneration();
    const requests=[...activeVessels].sort((a,b)=>a.id.localeCompare(b.id)).map(vessel=>({sectionKey:`vessel:${vessel.id}`,label:vesselDisplayName(vessel),leaseOwnerId:uid('batch-lease')}));
    const result=await batchLockCoordinator.current.run(()=>acquireEditLockBundle(
      requests,
      request=>claimEditLock(request.sectionKey,request.leaseOwnerId,currentUser.name,75,config),
      request=>releaseEditLock(request.sectionKey,request.leaseOwnerId,config),
      ()=>sessionIsCurrent()&&batchLockCoordinator.current.isCurrent(generation)&&sameCloudConfig(getSupabaseConfig(),config),
    ));
    if(result.status!=='owned'){
      batchManagedRequested.current=false;
      if(result.cleanupFailed)setCloudStatus('批量協作鎖回滾未完全成功；請稍候鎖自動過期後再試');
      if(result.status==='blocked')alert(`${result.label} 正在由 ${result.lockedByName} 編輯；未開啟批量更新，已回滾其他船舶鎖。`);
      else if(result.status==='unavailable')alert('無法確認全部經管船舶的協作鎖；未開啟批量更新，請稍後再試。');
      return;
    }
    if(!sessionIsCurrent()||!batchLockCoordinator.current.isCurrent(generation)){
      const staleLocks:ActiveEditLock[]=result.leases.map(lease=>({...lease,status:'owned',ownerUserId:currentUser.id,ownerUserName:currentUser.name,generation,authorizationEpoch,validatedUntilMs:conservativeLeaseDeadline(lease.expiresAt)}));
      staleLocks.forEach(lock=>batchLeaseCloudConfigs.current.set(lock.leaseOwnerId,{sectionKey:lock.sectionKey,config}));
      void releaseBatchEditLockSnapshot(staleLocks,false);
      return;
    }
    const locks:ActiveEditLock[]=result.leases.map(lease=>({...lease,status:'owned',ownerUserId:currentUser.id,ownerUserName:currentUser.name,generation,authorizationEpoch,validatedUntilMs:conservativeLeaseDeadline(lease.expiresAt)}));
    locks.forEach(lock=>batchLeaseCloudConfigs.current.set(lock.leaseOwnerId,{sectionKey:lock.sectionKey,config}));
    batchEditLocksRef.current=locks;
    setBatchEditLocks(locks);
    batchManagedOpenRef.current=true;
    setBatchManagedOpen(true);
    setCloudStatus(`已鎖定全部 ${locks.length} 艘經管船舶，可安全批量編輯`);
  };
  const batchMutationLeaseIsOwned=(sectionKey:string)=>{
    if(batchLocalMode.current)return batchManagedOpenRef.current&&authorizedEditLockKeys.has(sectionKey);
    const lock=batchEditLocks.find(item=>item.sectionKey===sectionKey);
    const record=lock?batchLeaseCloudConfigs.current.get(lock.leaseOwnerId):undefined;
    return editLockAllowsMutation(lock,sectionKey,currentUser.id,authorizationEpoch,Boolean(lock&&batchLockCoordinator.current.isCurrent(lock.generation)),Boolean(record&&record.sectionKey===sectionKey&&sameCloudConfig(getSupabaseConfig(),record.config)));
  };
  const batchLockedVesselIds=activeVessels.map(vessel=>vessel.id).filter(id=>batchMutationLeaseIsOwned(`vessel:${id}`));
  const batchVesselCommit:typeof commit=(updater,action,entityType,entityId,detail)=>{
    if(entityType!=='vessel'||!batchMutationLeaseIsOwned(`vessel:${entityId}`)){
      closeBatchManaged();
      alert('至少一艘船舶的協作鎖已失效；批量編輯已關閉，本次未保存。');
      return;
    }
    commit(updater,action,entityType,entityId,detail);
  };

  return <div className="app">
    <header className="topbar no-print"><div className="topbar-inner">
      <div className="brand"><img className="brand-icon" src={fpmcLogo} alt="台塑 LOGO" /><span><b>{SYSTEM_TITLE}</b><small>{SYSTEM_SUBTITLE}</small></span></div>
      <nav className="nav">
        {([['dashboard','船隊看板'],['morning','早會工作台'],['meeting','臨會/專題'],['work',`我的待辦${myWorkTaskCount?`（${myWorkTaskCount}）`:''}`],['total',currentUser.role==='vessel'?'本船待辦':'待辦總表'],['closed','已結案'],['internalControl','內控異常'],['reports','報告中心'],['stats','數據分析'],['management','管理']] as [Tab,string][]).filter(([k])=>canAccessTab(currentUser, k)&&(k!=='reports'||canExportReports)&&(k!=='management'||canEnterManagement)).map(([k,label]) => <button key={k} className={tab===k?'active':''} onClick={() => { if (!canAccessTab(currentUser,k)) return; if (k==='reports' && !canExportReports) return alert('目前角色未獲授權預覽或匯出報告'); if (k==='management' && !requireManage()) return; navigateToTab(k); }}>{label}</button>)}
      </nav>
      <div className="user-chip"><span className="cloud-dot"/><button type="button" className="user-name-btn" onClick={() => setPasswordModalOpen(true)} title="修改個人密碼">{currentUser.name}｜{roleLabel(currentUser.role)}</button><button className="btn small ghost" onClick={leaveCurrentIdentity}>切換/退出</button></div>
    </div></header>
    <main className="container">
      <div className="cloud-strip no-print"><span className={getSupabaseConfig()?'ok-note':'danger-note'}>{visibleCloudStatus}</span><span className="spacer"/><button className="btn ghost small" onClick={syncLatest}>同步最新</button><button className="btn green small" onClick={saveChanges}>保存修改</button></div>
      {currentUser.role!=='vessel'&&activeEditLock&&authorizedEditLockKeys.has(activeEditLock.sectionKey)&&activeEditLock.authorizationEpoch===authorizationEpoch&&activeEditLock.ownerUserId===currentUser.id && <div className={`collaboration-banner no-print ${activeEditLock.status}`}><b>多人協作安全</b><span>{activeEditLock.status==='owned' ? `你正在編輯：${activeEditLock.label}；系統已建立短時鎖定，保存仍會做 revision 衝突檢查。` : activeEditLock.status==='blocked' ? `此項目正在由 ${activeEditLock.lockedByName || '其他使用者'} 編輯，已阻止打開以避免覆蓋對方內容。` : `無法確認 ${activeEditLock.label} 的編輯鎖；編輯器已關閉，請重試釋放。`}</span>{activeEditLock.status!=='owned'&&<button className="btn small ghost" onClick={resolveEditLockNotice}>{activeEditLock.status==='blocked'?'知道了':'重試釋放並關閉'}</button>}</div>}
      <div className="print-only app-print-header"><h2>{printTitle || data.settings.systemTitle}</h2><p>列印時間：{new Date().toLocaleString()}｜列印人：{currentUser.name}</p></div>
      {canAccessTab(currentUser,tab) && <>{tab==='dashboard' && selectedVesselDetail && <VesselDetailPage vessel={selectedVesselDetail} data={roleVisibleData} currentUser={currentUser} onBack={closeVesselDetail} onOpenInternalControl={()=>{if(!canAccessTab(currentUser,'internalControl'))return;navigateToTab('internalControl');}} onEditVessel={()=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');void openVesselEditor(selectedVesselDetail.id);}} onAddTask={()=>addTaskForVessel(selectedVesselDetail.id)} onEditTask={id=>{const task=roleVisibleTasks.find(item=>item.id===id);if(task)openTask(task,selectedVesselDetail.id);}} canEditVessel={canEditBusinessContent} canCreateTasks={canCreateTasks} canEditTasks={canEditBusinessContent&&currentUser.role!=='vessel'} canViewInternalControl={canAccessTab(currentUser,'internalControl')} />}
      {tab==='dashboard' && !selectedVesselDetail && <DashboardView user={currentUser} vessels={activeVessels} tasks={roleVisibleTasks} internalControlCases={roleVisibleData.internalControlCases} meetings={dashboardMeetings} selected={agendaSelection} setSelected={setAgendaSelection} onOpenVessel={openVesselDetail} onEdit={id=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');void openVesselEditor(id);}} onAddTask={addTaskForVessel} onToggleAttention={(vesselId,key)=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改關注燈');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;vessel.weeklyAttention=vessel.weeklyAttention.includes(key)?vessel.weeklyAttention.filter(item=>item!==key):[...vessel.weeklyAttention,key];vessel.updatedAt=nowIso();},'切換一週關注燈','vessel',vesselId,key);}} onAdjustAttention={vesselId=>{if(!canEditBusinessContent)return alert('目前角色未獲授權調整關注度');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;const openVesselTasks=vesselAttentionTasks(draft.tasks.filter(task=>taskHasVessel(task,vesselId))).filter(task=>!taskIsClosedForVessel(task,vesselId));const automatic=deriveVesselAttention(vessel,openVesselTasks,draft.meetings.some(meeting=>meetingCreatesVesselAbnormalAlert(meeting,vesselId)),draft.internalControlCases).automatic;vessel.manualAttentionLevel=nextManualVesselAttention(vessel.manualAttentionLevel||'',automatic);vessel.updatedAt=nowIso();},'調整船舶關注度','vessel',vesselId,'自動／低／中／高／急／特別關注（受自動下限保護）');}} onStartMeeting={(requestedIds) => { if (requestedIds) { const allowedIds=new Set(activeVessels.map(vessel=>vessel.id)); setAgendaSelection(Array.from(new Set(requestedIds.filter(id=>allowedIds.has(id))))); } else if (!agendaSelection.length) { const priority = activeVessels.filter(v => morningDiscussionTasks(roleVisibleTasks,roleVisibleMeetings).some(t => taskHasVessel(t,v.id) && !taskIsClosedForVessel(t,v.id) && (t.priority==='急'||t.priority==='高'))).slice(0,4).map(v=>v.id); setAgendaSelection(priority.length ? priority : activeVessels.slice(0,4).map(v=>v.id)); } navigateToTab('morning'); }} onOpenReport={openReportPreview} onTaskMetric={jumpToTaskList} onOpenBatchManagedVessels={()=>{void openBatchManagedVessels();}} canEdit={canEditBusinessContent} canCreateTasks={canCreateTasks} canUseMeetings={canUseMeetingWorkspace} canUseReports={canExportReports} />}
      {tab==='morning' && <MorningWorkspaceView data={roleVisibleData} user={currentUser} visibleVessels={activeVessels} selected={agendaSelection} setSelected={setAgendaSelection} onEditTask={openTask} onAddTask={addTaskForVessel} onOpenVessel={openVesselEditor} onOpenTemporaryMeeting={()=>navigateToTab('meeting')} onOpenReport={openReportPreview} commit={commit} />}

      {tab==='total' && <ListPanel title={currentUser.role==='vessel'?'本船待辦清單':'總清單'} tasks={filteredTasks} data={roleVisibleData} visibleVessels={activeVessels} filters={filters} setFilters={setFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('船舶記事總清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='work' && <WorkCenter
        data={roleVisibleData}
        user={currentUser}
        vessels={activeVessels}
        onOpenTask={openTask}
        onOpenInternalControl={()=>navigateToTab('internalControl')}
        onOpenVessel={openVesselEditor}
        onBatchComplete={batchCompleteTasks}
        onBatchDelete={batchDeleteTasks}
        canComplete={canCloseTasks&&currentUser.role!=='vessel'}
        canDelete={canDeleteTasks}
        canPrint={canExportReports}
        onPrint={() => print('我的待辦清單')}
        markAllRead={()=>commit(draft=>{const at=nowIso();draft.notifications.forEach(item=>{if(item.userId===currentUser.id&&!item.readAt)item.readAt=at;});},'標記通知已讀','notification',currentUser.id,'全部標記已讀')}
      />}
      {tab==='closed' && <ListPanel title="已結案清單" tasks={closedTasks} data={roleVisibleData} visibleVessels={activeVessels} filters={closedFilters} setFilters={setClosedFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('已結案清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='internalControl' && canAccessTab(currentUser,'internalControl') && <InternalControlPage data={roleVisibleData} user={currentUser} vessels={activeVessels} canCreate={canCreateTasks&&currentUser.role!=='vessel'} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canClose={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} canExport={canExportReports} authorizationEpoch={authorizationEpoch} onCreate={createInternalCases} onUpdate={saveInternalCase} onDelete={removeInternalCase} onOpenTask={taskId=>{const task=data.tasks.find(item=>item.id===taskId);if(task)void openTask(task);else alert('關聯要事不存在');}} />}
      {tab==='stats' && <DataAnalysisView data={roleVisibleData} vessels={canViewAllVessels?reportVessels:activeVessels} />}
      {tab==='meeting' && <TemporaryMeetingsPage data={roleVisibleData} visibleVessels={activeVessels} currentUser={currentUser} canExportReports={canExportReports} setData={setData} commit={commit} />}

      {tab==='reports' && <ReportCenter data={roleVisibleData} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} setSelected={setAgendaSelection} commit={commit} onOpenPreview={openReportPreview} onPrint={() => print('早會船舶動態與議程清單')} />}
      {tab==='management' && canEnterManagement && <ManagementView data={data} currentUser={currentUser} commit={commit} />}</>}
    </main>
    {currentUser.role!=='vessel'&&canEditBusinessContent&&vesselEditorLeaseAuthorized&&editingVesselId&&activeVessels.some(vessel=>vessel.id===editingVesselId) && <VesselEditModal vessel={data.vessels.find(v=>v.id===editingVesselId)} data={roleVisibleData} currentUser={currentUser} close={()=>{setEditingVesselId('');releaseCurrentEditLock();}} commit={vesselEditorCommit} addTask={id=>{if(addTaskForVessel(id,true)){setEditingVesselId('');releaseCurrentEditLock();}}} editTask={id=>{const vesselId=editingVesselId;const task=data.tasks.find(item=>item.id===id);if(!task)return alert('找不到對應待辦');setEditingVesselId('');void (async()=>{const result=await openTask(task,vesselId,vesselId);if(result==='failed')void openVesselEditor(vesselId);})();}} />}
    {currentUser.role!=='vessel'&&canEditBusinessContent&&batchManagedOpen && <BatchManagedVesselModal vessels={activeVessels} currentUser={currentUser} lockedVesselIds={batchLockedVesselIds} commit={batchVesselCommit} close={closeBatchManaged} onAddTask={id=>{if(addTaskForVessel(id,false,true))closeBatchManaged();}} />}
    {editingTask&&taskEditorLeaseAuthorized && <TaskEditModal task={editingTask} creating={creatingVisibleTask} data={taskEditorData} visibleVessels={taskEditorVisibleVessels} currentUser={taskEditorUser} canClose={!taskEditorReadOnly&&editingTaskCanMutate&&canCloseTasks&&currentUser.role!=='vessel'} canDelete={!taskEditorReadOnly&&editingTaskCanMutate&&canDeleteTasks} canCancelInternalControl={Boolean(!taskEditorReadOnly&&editingTaskCanMutate&&editingTask&&editingTaskScopeVessels.length===taskVesselIds(editingTask).length&&editingTaskScopeVessels.every(vessel=>canCancelInternalControl(currentUser,vessel)))} canEditOverall={!taskEditorReadOnly&&editingTaskCanMutate&&canEditOverallTask} initialProgressVesselId={taskProgressVesselId} readOnly={taskEditorReadOnly} readOnlyReason={taskReadOnlyReason} close={closeTaskEditor} onSave={saveTask} onSaveVesselProgress={saveTaskVesselProgress} onDelete={()=>{const original=data.tasks.find(task=>task.id===editingTaskId);if(original)deleteTask(original);}} />}
    {currentUser.role!=='vessel'&&canExportReports&&reportPreviewOpen && <ReportPreviewModal data={roleVisibleData} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} close={()=>setReportPreviewOpen(false)} onPrint={printReport} />}
    {passwordModalOpen && <PersonalPasswordModal currentUser={currentUser} close={()=>setPasswordModalOpen(false)} commit={commit} />}
    {currentUser.role!=='vessel'&&!selectedVesselDetailId&&(['dashboard','morning','reports'] as Tab[]).includes(tab) && <div className="selection-dock no-print">涉會船舶 <b className="selected-vessel-count">{agendaSelection.length}</b> 艘 <button className="btn pink small" onClick={()=>navigateToTab('morning')}>進入早會</button><button className="btn primary small" onClick={openReportPreview}>預覽報告</button></div>}
  </div>;
}

function SiteGate({ data, setData, onUnlock }: { data: AppData; setData:React.Dispatch<React.SetStateAction<AppData>>; onUnlock:()=>void }) {
  const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const needsSetup=!data.settings.sitePasswordHash;
  const unlock=async()=>{ if(!pw) return setErr(needsSetup?'請設定進站密碼':'請輸入進站密碼'); const hash=await sha256(pw); if(needsSetup){setData(prev=>withAudit({...prev,settings:{...prev.settings,sitePasswordHash:hash}},null,'初始化進站密碼','settings','site-password','首次設定進站密碼'));onUnlock();return;} if(hash===data.settings.sitePasswordHash){onUnlock();} else setErr('進站密碼錯誤'); };
  return <div className="login-page"><div className="login-card"><h2>船舶動態系統進站</h2><p className="muted">{needsSetup?'首次使用請先設定進站密碼；系統只保存雜湊，不保存明文。':'請輸入管理者設定的進站密碼。'}</p><div className="field"><label>{needsSetup?'設定進站密碼':'進站密碼'}</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') unlock();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" onClick={unlock}>{needsSetup?'設定並進入系統':'進入系統'}</button></div></div>;
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
  return <div className="login-page"><div className="login-card"><h2>人員登入／切換</h2><p className="muted">請先選擇部門與人員；Owner／管理員或已設定個人密碼者需輸入密碼，其餘人員可直接登入。</p><div className="field"><label>部門</label><select aria-label="登入部門" value={department} onChange={e=>setDepartment(e.target.value)}>{departments.map(item=><option key={item}>{item}</option>)}</select></div><div className="field"><label>人員</label><select aria-label="登入人員" value={userId} onChange={e=>{setUserId(e.target.value);setPw('');setErr('');}}>{people.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></div><div className="field"><label>密碼</label><input type="password" value={pw} placeholder={selectedNeedsPassword?'請輸入密碼':'無密碼帳號可空白直接登入'} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') login();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" disabled={!selectedUser} onClick={login}>登入</button></div></div>;
}

function ReportCenter({ data, visibleVessels, user, selected, setSelected, commit, onOpenPreview, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; setSelected:(ids:string[])=>void; commit:any; onOpenPreview:()=>void; onPrint:()=>void }) {
  const active=visibleVessels;
  const allowedIds=new Set(active.map(v=>v.id));
  const canViewAllReports=user.role==='owner'||user.role==='admin'||hasPermission(data.settings.rolePermissions,user,'viewAllVessels');
  const reportHistory=data.agendaReports.filter(report=>canViewAllReports||(report.vesselIds.length>0&&report.vesselIds.every(id=>allowedIds.has(id))));
  const selectedScopeIds=selected.filter(id=>allowedIds.has(id));
  const reportTasks=morningDiscussionTasks(data.tasks,data.meetings).filter(t=>taskVesselIds(t).some(id=>selectedScopeIds.includes(id))&&!taskIsClosedForScope(t,selectedScopeIds));
  const ordinaryReportTasks=reportTasks.filter(appearsInSingleVesselTasks);
  const companyDecisionTasks=reportTasks.filter(task=>isMeetingAttentionTask(task)&&!isVesselDelegatedMeetingTask(task));
  const toggle=(id:string)=>setSelected(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
  const save=()=>{const vesselIds=selected.filter(id=>allowedIds.has(id));if(!vesselIds.length)return alert('請至少選擇一艘船舶');const id=uid('agenda');commit((d:AppData)=>{d.agendaReports.unshift({id,title:'船舶早會動態暨待辦報告',vesselIds,createdBy:user.id,createdAt:nowIso(),taskCount:ordinaryReportTasks.length+companyDecisionTasks.length});},'保存報告紀錄','agenda',id,`${vesselIds.length} 艘船`);alert('報告紀錄已保存；日後檢視會依目前最新資料重新產生。');};
  return <section><div className="page-heading"><div><h1>報告中心</h1><p>選擇船舶、保存報告紀錄，預覽後輸出 A4 橫向正式材料。舊紀錄檢視時會套用目前最新資料。</p></div><div className="heading-actions no-print"><button className="btn green" onClick={save}>保存報告紀錄</button><button className="btn ghost" onClick={onPrint}>列印目前頁</button><button className="btn primary" onClick={onOpenPreview}>開啟 PDF 預覽</button></div></div><div className="metric-grid report-metrics"><div className="metric-card pink"><small>已選船舶</small><b>{selected.length}</b><span>艘</span></div><div className="metric-card blue"><small>單船要事</small><b>{ordinaryReportTasks.length}</b><span>件</span></div><div className="metric-card purple"><small>公司層決議</small><b>{companyDecisionTasks.length}</b><span>件</span></div><div className="metric-card yellow"><small>急／高要事</small><b>{ordinaryReportTasks.filter(t=>t.priority==='急'||t.priority==='高').length}</b><span>件</span></div><div className="metric-card mint"><small>已保存紀錄</small><b>{reportHistory.length}</b><span>份</span></div></div><div className="panel no-print"><div className="panel-title"><h2>選擇報告船舶</h2><div><button className="btn small ghost" onClick={()=>setSelected(active.map(v=>v.id))}>全選</button> <button className="btn small ghost" onClick={()=>setSelected([])}>清空</button></div></div><div className="vessel-selector">{active.map(v=><button key={v.id} className={`chip ${selected.includes(v.id)?'on':''}`} onClick={()=>toggle(v.id)}>{vesselDisplayName(v)}</button>)}</div></div><div className="grid cols-2"><div className="panel"><h2>本次報告內容</h2><div className="table-wrap"><table className="compact"><thead><tr><th>船舶</th><th>航線／貨況</th><th>未結事項</th></tr></thead><tbody>{active.filter(v=>selected.includes(v.id)).map(v=><tr key={v.id}><td><b>{vesselDisplayName(v)}</b><br/><span className="muted">{v.shipType || '未填船型'}</span></td><td>{v.position.lastPort} → {v.position.nextPort}<br/>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}</td><td>{ordinaryReportTasks.filter(t=>taskHasVessel(t,v.id)&&!taskIsClosedForVessel(t,v.id)).length}</td></tr>)}</tbody></table></div></div><div className="panel"><h2>歷次報告紀錄</h2>{reportHistory.length?reportHistory.slice(0,12).map(r=><div className="saved-report" key={r.id}><div><b>{r.title}</b><small>{fmt(r.createdAt)}｜{r.vesselIds.length} 艘｜{r.taskCount} 件</small></div><button className="btn small ghost" onClick={()=>{setSelected(r.vesselIds.filter(id=>allowedIds.has(id)));setTimeout(onOpenPreview,0);}}>以最新資料檢視</button></div>):<div className="empty-state compact">尚無保存紀錄</div>}</div></div></section>;
}

function valueOrDash(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '-';
}
function vesselReportCargo(v: Vessel) {
  return v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、') || 'TBA';
}
function vesselReportStatus(v: Vessel) {
  return v.note.statusList.join('、') || '未設定';
}
function vesselReportNavigation(v: Vessel) {
  return v.position.navigationStatus === '航行' ? `${v.position.navigationStatus}（${v.position.speedKnots || 0} kn）` : v.position.navigationStatus;
}
function VesselReportInfo({ v }: { v: Vessel }) {
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
  </div>;
}

function ReportPreviewModal({ data, visibleVessels, user, selected: _selected, close, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; close:()=>void; onPrint:()=>void }) {
  const shellRef=useRef<HTMLDivElement>(null);
  const closeButtonRef=useRef<HTMLButtonElement>(null);
  const previousFocusRef=useRef<HTMLElement|null>(null);
  const closeRef=useRef(close);
  closeRef.current=close;
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
  const vessels=_selected.length?visibleVessels.filter(v=>selectedIds.includes(v.id)):visibleVessels;
  const reportScopeIds=vessels.map(v=>v.id);
  const reportVesselIds=new Set(reportScopeIds);
  const tasks=morningDiscussionTasks(data.tasks,data.meetings).filter(t=>taskVesselIds(t).some(id=>reportVesselIds.has(id))&&!taskIsClosedForScope(t,reportScopeIds));
  const companyDecisionTasks=tasks.filter(task=>isMeetingAttentionTask(task)&&!isVesselDelegatedMeetingTask(task));
  const ordinaryReportTasks=tasks.filter(appearsInSingleVesselTasks);
  const crossVesselTasks=ordinaryReportTasks.filter(task=>task.vesselScopeMode==='all'||task.vesselScopeMode==='types'||taskVesselIds(task).length>1);
  const singleVesselTasks=ordinaryReportTasks.filter(task=>!crossVesselTasks.includes(task));
  return <div className="report-preview-modal" role="dialog" aria-modal="true" aria-labelledby="report-preview-title"><div ref={shellRef} tabIndex={-1} className="report-preview-shell"><div className="report-preview-actions no-print"><h2 id="report-preview-title">PDF 報告預覽</h2><span>A4 橫向</span><div className="spacer"/><button className="btn primary" disabled={!vessels.length} title={!vessels.length?'目前選擇不在授權範圍內':''} onClick={onPrint}>導出／列印 PDF</button><button ref={closeButtonRef} className="btn ghost" onClick={close}>關閉</button></div><article className="report-paper"><header><h1>船舶早會動態暨待辦報告</h1><p>報告日期：{new Date().toLocaleDateString('zh-TW')}　製表：{user.name}　資料版本：rev.{data.revision}</p></header><div className="report-kpis"><div>船舶<br/><b>{vessels.length}</b></div><div>單船要事<br/><b>{ordinaryReportTasks.length}</b></div><div>公司層決議<br/><b>{companyDecisionTasks.length}</b></div><div>逾期要事<br/><b>{ordinaryReportTasks.filter(t=>(daysDiff(t.expectedDate)??0)<0).length}</b></div></div><table><thead><tr><th>船舶</th><th>動態資料</th><th>要事</th><th>狀態／部門／期限</th></tr></thead><tbody>{vessels.map(v=>{const vt=singleVesselTasks.filter(t=>taskHasVessel(t,v.id));return vt.length?vt.map((t,i)=><tr key={`${v.id}-${t.id}`}>{i===0&&<td rowSpan={vt.length}><b>{vesselDisplayName(v)}</b></td>}{i===0&&<td rowSpan={vt.length}><VesselReportInfo v={v}/></td>}<td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>):<tr key={v.id}><td><b>{vesselDisplayName(v)}</b></td><td><VesselReportInfo v={v}/></td><td colSpan={2}>目前無未結要事</td></tr>})}</tbody></table>{companyDecisionTasks.length>0&&<><h2>公司層決議案（臨會／專題）</h2><table><thead><tr><th>涉及範圍</th><th>船種</th><th>決議事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{companyDecisionTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskReportVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskReportShipTypeLabel(t,vessels)}</td><td><b>會議議題｜{taskCategoryLabel(t)}</b><RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>)}</tbody></table></>}{crossVesselTasks.length>0&&<><h2>跨船單船要事</h2><table><thead><tr><th>船舶</th><th>船種</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{crossVesselTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskReportVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskReportShipTypeLabel(t,vessels)}</td><td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>)}</tbody></table></>}<footer>本報告依目前授權範圍、報告選擇及 Supabase／本機最新資料產生。</footer></article></div></div>;
}

function FilterBar({ data, filters, setFilters, fleetTags }: { data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const toggle=(key:keyof FilterState,val:string)=>{ const arr=[...(filters[key] as string[])]; const next=arr.includes(val)?arr.filter(x=>x!==val):[...arr,val]; setFilters({...filters,[key]:next}); };
  const toggleGroup=(key:'categories'|'meetingCategories', values:string[])=>{ const current=[...filters[key]]; const anySelected=values.some(value=>current.includes(value)); const next=anySelected?current.filter(value=>!values.includes(value)):Array.from(new Set([...current,...values])); setFilters({...filters,[key]:next}); };
  const priorityTone=(priority:TaskPriority)=>priority==='急'?'urgent':priority==='高'?'high':priority==='中'?'medium':'low';
  const chipClass=(active:boolean,...tones:string[])=>['chip','filter-chip',...tones,active?'on':''].filter(Boolean).join(' ');
  const allTaskCategoriesSelected=data.settings.taskCategories.length>0&&data.settings.taskCategories.every(category=>filters.categories.includes(category));
  const allMeetingCategoriesSelected=data.settings.meetingTaskCategories.length>0&&data.settings.meetingTaskCategories.every(category=>filters.meetingCategories.includes(category));
  return <div className="panel no-print"><div className="grid cols-4"><div className="field"><label>關鍵字</label><input value={filters.keyword} onChange={e=>setFilters({...filters,keyword:e.target.value})} placeholder="船名、事項、狀態..." /></div><div className="field"><label>日期起</label><input type="date" value={filters.fromDate} onChange={e=>setFilters({...filters,fromDate:e.target.value})}/></div><div className="field"><label>日期迄</label><input type="date" value={filters.toDate} onChange={e=>setFilters({...filters,toDate:e.target.value})}/></div><div className="field"><label>經管船舶</label><select value={filters.ownerMode} onChange={e=>setFilters({...filters,ownerMode:e.target.value as any})}><option value="all">全部</option><option value="mine">只看我的經管船舶/事項</option></select></div></div><div className="filters"><b>部門</b>{data.settings.departments.map(d=><button key={d} className={chipClass(filters.departments.includes(d),'filter-chip-department')} onClick={()=>toggle('departments',d)}>{d}</button>)}</div><div className="filters"><b>船種/船隊</b>{fleetTags.map(f=><button key={f} className={chipClass(filters.fleetTags.includes(f),'filter-chip-fleet')} onClick={()=>toggle('fleetTags',f)}>{f}</button>)}</div><div className="filters"><b>關注</b>{data.settings.priorities.map(p=><button key={p} className={chipClass(filters.priorities.includes(p),`filter-chip-${priorityTone(p)}`)} onClick={()=>toggle('priorities',p)}>{p}</button>)}</div><div className="filters task-category-filter ordinary-category-filter"><button type="button" className={chipClass(allTaskCategoriesSelected,'filter-group-heading','filter-group-task')} onClick={()=>toggleGroup('categories',data.settings.taskCategories)} title="全選／取消全部要事分類">要事分類</button>{data.settings.taskCategories.map((c,index)=><button key={c} className={chipClass(filters.categories.includes(c),`filter-chip-tone-${index%6}`)} onClick={()=>toggle('categories',c)}>{c}</button>)}</div><div className="filters task-category-filter meeting-category-filter"><button type="button" className={chipClass(allMeetingCategoriesSelected,'filter-group-heading','filter-group-meeting')} onClick={()=>toggleGroup('meetingCategories',data.settings.meetingTaskCategories)} title="全選／取消全部臨會/專題分類">臨會/專題分類</button>{data.settings.meetingTaskCategories.map((c,index)=><button key={c} className={chipClass(filters.meetingCategories.includes(c),'filter-chip-meeting',`filter-chip-tone-${(index+3)%6}`)} onClick={()=>toggle('meetingCategories',c)}>{c}</button>)}</div><div className="filters"><b>管控</b><button className={chipClass(filters.internalControlOnly,'filter-chip-internal')} onClick={()=>setFilters({...filters,internalControlOnly:!filters.internalControlOnly})}>內部管控</button>{filters.overdueOnly&&<button className={chipClass(true,'filter-chip-overdue')} onClick={()=>setFilters({...filters,overdueOnly:false})}>只看逾期 ×</button>}</div></div>;
}

function ListPanel({ title, tasks, data, visibleVessels, filters, setFilters, fleetTags, userMap, onEdit, onPrint, onBatchComplete, onBatchDelete, canEdit, canPrint, canComplete, canDelete }: { title:string; tasks:TaskItem[]; data:AppData; visibleVessels:Vessel[]; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[]; userMap:Record<string,UserAccount>; onEdit:(t:TaskItem)=>void; onPrint:()=>void; onBatchComplete:(ids:string[])=>boolean; onBatchDelete:(ids:string[])=>boolean; canEdit:boolean; canPrint:boolean; canComplete:boolean; canDelete:boolean }) {
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [page,setPage]=useState(1);
  const selectAllRef=useRef<HTMLInputElement>(null);
  const pagedTasks=paginateItems(tasks, page);
  const visibleScopeIds=visibleVessels.map(vessel=>vessel.id);
  useEffect(()=>{setSelectedIds(previous=>sanitizeTaskSelection(previous,tasks));setPage(1);},[tasks]);
  const selectedSet=new Set(selectedIds);
  const selectedTasks=tasks.filter(task=>selectedSet.has(task.id));
  const selectedOnPage=pagedTasks.items.filter(task=>selectedSet.has(task.id));
  const openSelectedIds=selectedTasks.filter(task=>!taskProjectedProgressForScope(task,visibleScopeIds).isClosed&&!usesPerVesselProgress(task)).map(task=>task.id);
  const allSelected=pagedTasks.items.length>0&&pagedTasks.items.every(task=>selectedSet.has(task.id));
  useEffect(()=>{if(selectAllRef.current)selectAllRef.current.indeterminate=selectedOnPage.length>0&&!allSelected;},[selectedOnPage.length,allSelected]);
  const toggleAll=()=>setSelectedIds(previous=>allSelected?previous.filter(id=>!pagedTasks.items.some(task=>task.id===id)):Array.from(new Set([...previous,...pagedTasks.items.map(task=>task.id)])));
  const toggleOne=(id:string)=>setSelectedIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const completeSelected=()=>{if(onBatchComplete(openSelectedIds))setSelectedIds([]);};
  const deleteSelected=()=>{if(onBatchDelete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><section className="panel"><div className="panel-title"><h2>{title} <span className="muted">({tasks.length})</span></h2><div className="heading-actions no-print"><button className="btn small ghost filter-reset-btn" onClick={()=>setFilters({...emptyFilters,closedMode:filters.closedMode})}>清除篩選</button><button className="btn small ghost" onClick={toggleAll} disabled={!pagedTasks.items.length}>{allSelected?'取消本頁全選':'全選本頁'}</button><span className="batch-selection-count">已選 {selectedTasks.length}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!openSelectedIds.length} title={!canComplete?'目前角色未獲授權批量完成':openSelectedIds.length?'':'所選事項均已結案'}>批量完成（{openSelectedIds.length}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectedTasks.length} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectedTasks.length}）</button>{canPrint&&<button className="btn primary" onClick={onPrint}>導出 PDF</button>}</div></div>{tasks.length?<div className="table-wrap"><table className="compact batch-task-table"><thead><tr><th className="no-print batch-select-cell"><input ref={selectAllRef} type="checkbox" aria-label="全選目前結果" checked={allSelected} onChange={toggleAll}/></th><th className="task-vessel-column">船舶</th><th>船種</th><th>關注維度／等級</th><th>來源</th><th className="task-item-column">分類/事項</th><th>部門</th><th>追蹤窗口</th><th>期限</th><th className="task-status-column">狀態</th><th className="no-print">操作</th></tr></thead><tbody>{pagedTasks.items.map(t=>{ const vessels=taskVessels(t,visibleVessels); const projected=taskProjectedProgressForScope(t,visibleScopeIds); const fleetCategories=Array.from(new Set(vessels.map(v=>v.fleetCategory).filter(Boolean))).join('、'); const diff=daysDiff(t.expectedDate); const managerIds=[...new Set(t.ownerUserIds)]; return <tr key={t.id} className={selectedSet.has(t.id)?'batch-selected-row':''}><td className="no-print batch-select-cell"><input type="checkbox" aria-label={`選取待辦 ${richTextToPlainText(t.description)||t.id}`} checked={selectedSet.has(t.id)} onChange={()=>toggleOne(t.id)}/></td><td className="task-vessel-scope task-vessel-column">{taskVesselLabel(t,visibleVessels)}</td><td>{taskShipTypeLabel(t,visibleVessels)}<br/><span className="muted">{t.vesselScopeMode==='all'?'全部':fleetCategories||'-'}</span></td><td><small className="attention-dimension-label">{isMeetingAttentionTask(t)?'會議議題':'要事'}</small><span className={priorityClass(t.priority)}>{t.priority}</span>{t.isInternalControl&&<span className="internal-control-tag">內部管控</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}{t.isAware&&<span className="badge aware">知曉</span>}</td><td><span className={`task-source-badge source-${t.sourceType}`}>{taskSourceLabel(t)}</span></td><td className="task-item-column"><span className="chip">{taskCategoryLabel(t)}</span><button type="button" className="task-link" onClick={()=>onEdit(t)}><RichTextContent compact value={t.description} fallback="-"/></button></td><td>{t.departments.map(d=><span className="chip" key={d}>{d}</span>)}</td><td>{managerIds.map(id=>userMap[id]?.name).filter(Boolean).join('、') || '-'}</td><td>{t.expectedDate||'-'}<br/>{!projected.isClosed&&diff!==null&&diff<0&&<span className="warn">逾期 {Math.abs(diff)} 天</span>}</td><td className="task-list-status-cell task-status-column">{projected.isClosed?<span className="badge closed">已結案 {projected.closedDate}</span>:<RichTextContent compact className="task-list-status-text" value={projected.status} fallback="-"/>}<br/><span className="muted">更新：{fmt(projected.updatedAt||t.updatedAt)}</span></td><td className="no-print"><button className="btn small primary" onClick={()=>onEdit(t)}>{canEdit?'更新':'查看'}</button></td></tr>;})}</tbody></table></div>:<div className="empty-state">目前沒有符合條件的事項</div>}<PaginationControls ariaLabel="待辦清單分頁" page={pagedTasks.page} pageCount={pagedTasks.pageCount} total={pagedTasks.total} from={pagedTasks.from} to={pagedTasks.to} onPageChange={setPage}/></section></>;
}
