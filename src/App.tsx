import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import fpmcLogo from './assets/fpmc-logo.png';
import { createInitialData } from './data/seed';
import type { AppData, FilterState, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { CLOUD_CACHE_IDENTITY_KEY, CURRENT_USER_KEY, SESSION_SITE_UNLOCK, STORAGE_KEY, daysDiff, loadLocal, nowIso, roleLabel, saveLocal, sha256, todayDate, uid, withAudit } from './utils';
import { CloudConflictError, claimEditLock, fetchCloudData, getSupabaseConfig, releaseEditLock, saveCloudData } from './cloud';
import ManagementView from './Management';
import MorningWorkspaceView from './MorningWorkspace';
import TemporaryMeetingsPage from './TemporaryMeetings';
import { TaskEditModal, VesselEditModal } from './EditModals';
import { normalizeAppData } from './normalize';
import DashboardView from './Dashboard';
import VesselDetailPage from './VesselDetailPage';
import WorkCenter from './WorkCenter';
import DataAnalysisView from './DataAnalysis';
import { canAccessAllVessels, hasPermission, isEligibleTaskOwner } from './permissions';
import { selectUserWorkCenterTasks } from './workCenterScope';
import { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications, canAccessTab, canCancelInternalControl, canDeleteTask, canUseVessel, taskSourceLabel, validateInternalControlTransition } from './taskWorkflow';
import { isMeetingTaskSource, mergeAttentionFromCategories, normalizeMeetingTaskCategoryList, normalizeTaskCategoryList, taskCategoriesOf, taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskReportShipTypeLabel, taskReportVesselLabel, taskShipTypeLabel, taskVesselIds, taskVesselLabel, taskVessels } from './taskVesselScope';
import { deriveVesselAttention, nextManualVesselAttention } from './vesselAttention';
import { completeSelectedTasks, deleteSelectedTasks, sanitizeTaskSelection, validateBatchTaskSelection } from './batchTaskActions';
import { resolveMeetingTaskItemIdForDeletion } from './meetingTaskWorkflow';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { appearsInSingleVesselTasks, canonicalTaskAttentionForSave, isMeetingAttentionTask, isVesselDelegatedMeetingTask } from './taskAttention';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskIsClosedForScope, taskIsClosedForVessel, taskProgressForVessel, updateTaskVesselProgress, usesPerVesselProgress } from './taskVesselProgress';
import RichTextContent from './RichTextContent';
import { richTextToPlainText } from './richText';

type Tab = 'dashboard' | 'morning' | 'total' | 'reports' | 'stats' | 'management' | 'meeting' | 'closed' | 'work';
type ActiveEditLock = { sectionKey: string; label: string; status: 'owned' | 'blocked' | 'error'; lockedByName?: string };
const SYSTEM_TITLE = '船舶動態與會議管理系統';
const SYSTEM_SUBTITLE = 'Fleet Activities & Office Meeting Manage System';
const emptyFilters: FilterState = { keyword:'', departments:[], vesselIds:[], fleetTags:[], priorities:[], categories:[], meetingCategories:[], ownerMode:'all', fromDate:'', toDate:'', closedMode:'open', overdueOnly:false, internalControlOnly:false };

function clone<T>(v:T):T { return JSON.parse(JSON.stringify(v)); }
function priorityClass(p?: string) { return p === '急' ? 'badge urgent' : p === '高' ? 'badge high' : p === '中' ? 'badge mid' : 'badge low'; }
function fmt(dt?: string) { return dt ? dt.replace('T',' ').slice(0,16) : '-'; }
function savedStatus(label:string, at?:string) { const d=at?new Date(at):new Date(); return `${label}｜最新保存 ${d.toLocaleString('zh-TW',{hour12:false})}`; }
function cloudIdentity(cfg: { supabaseUrl:string; tableName:string; workspaceKey:string }) { return `${cfg.supabaseUrl}|${cfg.tableName}|${cfg.workspaceKey}`; }
function vesselMatchesUser(v: Vessel, user: UserAccount | null, canViewAll = false) { return !user || canViewAll || v.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(v.id); }
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
  const [taskProgressVesselId, setTaskProgressVesselId] = useState<string>('');
  const [creatingTask, setCreatingTask] = useState<TaskItem | null>(null);
  const [taskReturnVesselId, setTaskReturnVesselId] = useState<string>('');
  const [cloudStatus, setCloudStatus] = useState('本機模式');
  const [agendaSelection, setAgendaSelection] = useState<string[]>([]);
  const [printTitle, setPrintTitle] = useState('');
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [cloudBootstrapped, setCloudBootstrapped] = useState(false);
  const [cloudWriteBlocked, setCloudWriteBlocked] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [activeEditLock, setActiveEditLock] = useState<ActiveEditLock | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastCloudRevision = useRef<number>(-1);
  const activeCloudIdentity = useRef('');
  const pendingCloudData = useRef<AppData | null>(null);
  const cloudSaveInFlight = useRef<Promise<void> | null>(null);
  const cloudSyncInFlight = useRef(false);
  const autoDepartmentFilterKey = useRef('');
  const currentUser=data.users.find(u=>u.id===currentUserId && u.isActive) || null;
  const ownerExists = data.users.some(u => u.role === 'owner' && u.isActive);

  useEffect(() => { saveLocal(data); }, [data]);
  useEffect(() => { currentUserId ? localStorage.setItem(CURRENT_USER_KEY, currentUserId) : localStorage.removeItem(CURRENT_USER_KEY); }, [currentUserId]);
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
    if (!hasCurrentCloudIdentity()) return Promise.reject(new Error('雲端工作區 identity 已變更'));
    pendingCloudData.current = snapshot;
    if (cloudSaveInFlight.current) return cloudSaveInFlight.current;
    const task = (async () => {
      try {
        while (pendingCloudData.current) {
          const next = pendingCloudData.current;
          pendingCloudData.current = null;
          if (next.revision <= lastCloudRevision.current) continue;
          if (!hasCurrentCloudIdentity()) throw new Error('雲端工作區 identity 已變更');
          await saveCloudData(next, lastCloudRevision.current, currentUser?.name || 'unknown');
          lastCloudRevision.current = next.revision;
          rememberCloudIdentity();
          setCloudWriteBlocked(false);
          setCloudStatus(savedStatus('已保存雲端'));
        }
      } catch (error) {
        pendingCloudData.current = null;
        if (error instanceof CloudConflictError) setCloudWriteBlocked(true);
        throw error;
      } finally {
        cloudSaveInFlight.current = null;
      }
    })();
    cloudSaveInFlight.current = task;
    return task;
  };

  useEffect(() => {
    const cfg = getSupabaseConfig();
    if (!cfg) { setCloudStatus('本機模式：尚未配置 Supabase，資料保存於本機瀏覽器'); setCloudBootstrapped(true); return; }
    const identity = cloudIdentity(cfg);
    activeCloudIdentity.current = identity;
    const cachedIdentity = localStorage.getItem(CLOUD_CACHE_IDENTITY_KEY) || '';
    const identityChanged = Boolean(cachedIdentity && cachedIdentity !== identity);
    const unknownDirtyCache = !cachedIdentity && localStorage.getItem(STORAGE_KEY) !== null;
    let cancelled=false;
    setCloudStatus('正在載入雲端主資料...');
    fetchCloudData().then(remote => {
      if(cancelled)return;
      const latestConfig = getSupabaseConfig();
      if (!latestConfig || cloudIdentity(latestConfig) !== identity) {
        setCloudWriteBlocked(true);
        setCloudStatus('雲端設定在載入期間變更，已禁止寫入；請重新載入或同步最新資料');
        setCloudBootstrapped(true);
        return;
      }
      if (remote) {
        lastCloudRevision.current=remote.revision||0;
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

  useEffect(() => {
    if (!activeEditLock || activeEditLock.status !== 'owned' || !currentUser || !getSupabaseConfig()) return;
    const timer = window.setInterval(() => {
      claimEditLock(activeEditLock.sectionKey, currentUser.id, currentUser.name).then(lock => {
        if (!lock.ok) {
          setActiveEditLock({ ...activeEditLock, status: 'blocked', lockedByName: lock.lockedByName || '其他使用者' });
          setCloudStatus(`協作鎖已失效：${activeEditLock.label} 已由 ${lock.lockedByName || '其他使用者'} 編輯，請先同步最新`);
        }
      }).catch(error => {
        setActiveEditLock({ ...activeEditLock, status: 'error' });
        setCloudStatus(`協作鎖續期失敗：${error.message || error}`);
      });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeEditLock?.sectionKey, activeEditLock?.status, currentUser?.id]);

  const releaseCurrentEditLock = () => {
    const lock = activeEditLock;
    setActiveEditLock(null);
    if (lock?.status === 'owned' && currentUser && getSupabaseConfig()) {
      releaseEditLock(lock.sectionKey, currentUser.id).catch(error => setCloudStatus(`協作鎖釋放失敗：${error.message || error}`));
    }
  };
  const claimEditingLock = async (sectionKey: string, label: string) => {
    if (!currentUser) return false;
    if (!getSupabaseConfig()) {
      setActiveEditLock({ sectionKey, label, status: 'owned' });
      return true;
    }
    setCloudStatus(`正在檢查多人協作鎖：${label}`);
    try {
      const lock = await claimEditLock(sectionKey, currentUser.id, currentUser.name);
      if (!lock.ok) {
        const lockedByName = lock.lockedByName || '其他使用者';
        setActiveEditLock({ sectionKey, label, status: 'blocked', lockedByName });
        setCloudStatus(`此項目正在由 ${lockedByName} 編輯，已阻止打開以避免覆蓋對方內容`);
        alert(`此項目正在由 ${lockedByName} 編輯；為避免覆蓋對方內容，請稍後再試或先按「同步最新」。`);
        return false;
      }
      setActiveEditLock({ sectionKey, label, status: 'owned' });
      setCloudStatus(`多人協作安全：已鎖定 ${label}，其他人會看到正在編輯提示`);
      return true;
    } catch (error: any) {
      setActiveEditLock({ sectionKey, label, status: 'error' });
      setCloudStatus(`無法確認多人協作鎖：${error.message || error}`);
      alert(`無法確認是否有人正在編輯「${label}」，為避免衝突，請先同步最新或稍後再試。`);
      return false;
    }
  };

  const commit = (updater: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => {
    setData(prev => { const d = clone(prev); updater(d); return withAudit(d, currentUser, action, entityType, entityId, detail); });
  };
  const requireLogin = () => { if (!currentUser) { alert('請先登入或切換用戶'); return false; } return true; };
  const canEnterManagement = hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement');
  const canEditBusinessContent = hasPermission(data.settings.rolePermissions, currentUser, 'editBusinessContent');
  const canCreateTasks = hasPermission(data.settings.rolePermissions, currentUser, 'createTasks');
  const canCloseTasks = hasPermission(data.settings.rolePermissions, currentUser, 'closeTasks');
  const canDeleteTasks = hasPermission(data.settings.rolePermissions, currentUser, 'deleteTasks') && canDeleteTask(currentUser);
  const canExportReports = hasPermission(data.settings.rolePermissions, currentUser, 'exportReports');
  const canViewAllVessels = currentUser?.role==='owner'||currentUser?.role==='admin'||hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const requireManage = () => { if (!currentUser || !hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement')) { alert('您無權訪問管理頁面'); setTab('dashboard'); return false; } return true; };

  const activeVessels = useMemo(()=>data.vessels.filter(v=>v.isActive&&vesselMatchesUser(v,currentUser,canViewAllVessels)),[data.vessels,currentUser,canViewAllVessels]);
  const selectedVesselDetail = activeVessels.find(vessel=>vessel.id===selectedVesselDetailId);
  const reportVessels = activeVessels;
  const myWorkTaskCount = currentUser ? selectUserWorkCenterTasks(data,currentUser,activeVessels).length : 0;
  useEffect(() => { setAgendaSelection(prev => prev.filter(id => activeVessels.some(v=>v.id===id))); }, [activeVessels]);
  useEffect(() => { if (selectedVesselDetailId && !activeVessels.some(vessel=>vessel.id===selectedVesselDetailId)) setSelectedVesselDetailId(''); }, [activeVessels, selectedVesselDetailId]);
  useEffect(() => { if (currentUser && (!canAccessTab(currentUser, tab) || (tab === 'reports' && !canExportReports))) setTab('dashboard'); }, [currentUser, tab, canExportReports]);
  const vesselMap = useMemo(() => Object.fromEntries(data.vessels.map(v => [v.id, v])), [data.vessels]);
  const userMap = useMemo(() => Object.fromEntries(data.users.map(u => [u.id, u])), [data.users]);
  const fleetTags = useMemo(() => Array.from(new Set(data.vessels.flatMap(v => v.fleetTags))).filter(Boolean), [data.vessels]);

  const filteredTasks = useMemo(() => {
    const visibleIds=activeVessels.map(vessel=>vessel.id);
    return data.tasks
      .filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id))))
      .sort((a,b)=>Number(taskProjectedProgressForScope(a,visibleIds).isClosed)-Number(taskProjectedProgressForScope(b,visibleIds).isClosed)||(daysDiff(a.expectedDate)??9999)-(daysDiff(b.expectedDate)??9999));
  },[data.tasks,vesselMap,currentUser,filters,canViewAllVessels,activeVessels]);
  const statsTasks = useMemo(() => data.tasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,false,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[data.tasks,vesselMap,currentUser,filters,canViewAllVessels]);
  const closedTasks = useMemo(() => data.tasks.filter(t=>taskMatchesFilters(t,closedFilters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[data.tasks,vesselMap,currentUser,closedFilters,canViewAllVessels]);

  if (!cloudBootstrapped) return <div className="login-page"><div className="login-card loading-card"><h2>正在載入雲端主資料</h2><p className="muted">請稍候，完成前不會寫入或覆蓋資料。</p></div></div>;
  if (!siteUnlocked || !data.settings.sitePasswordHash) return <SiteGate data={data} setData={setData} onUnlock={() => { sessionStorage.setItem(SESSION_SITE_UNLOCK,'1'); setSiteUnlocked(true); }} />;
  if (!ownerExists && !currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;
  if (!ownerExists && currentUser) return <OwnerSetup currentUser={currentUser} setData={setData} setCurrentUserId={setCurrentUserId} />;
  if (!currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;

  const openVesselEditor = async (id: string) => {
    const vessel = data.vessels.find(item => item.id === id);
    if (!vessel) return alert('找不到對應船舶');
    if (await claimEditingLock(`vessel:${id}`, `船舶｜${vesselDisplayName(vessel)}`)) setEditingVesselId(id);
  };
  const openTaskEditor = async (task: TaskItem, vesselId = '') => {
    const label = richTextToPlainText(task.description) || task.id;
    if (await claimEditingLock(`task:${task.id}`, `待辦｜${label.slice(0, 28)}`)) {
      setTaskProgressVesselId(vesselId);
      setEditingTaskId(task.id);
    }
  };
  const openTask = async (task: TaskItem, vesselId = '') => {
    if (!task.ownerUserIds.includes(currentUser.id)&&!taskVesselIds(task).some(id=>activeVessels.some(vessel=>vessel.id===id))) return alert('無權查看此待辦');
    if(vesselId&&(!taskVesselIds(task).includes(vesselId)||!activeVessels.some(vessel=>vessel.id===vesselId)))return alert('無權更新此船舶進度');
    if(data.notifications.some(item=>item.userId===currentUser.id&&item.taskId===task.id&&!item.readAt)){
      commit(draft=>{const at=nowIso();draft.notifications.forEach(item=>{if(item.userId===currentUser.id&&item.taskId===task.id&&!item.readAt)item.readAt=at;});},'查看待辦更新','notification',task.id,'標記此待辦未讀變動');
    }
    await openTaskEditor(task, vesselId);
  };
  const addTaskForVessel = (vesselId: string, returnToVessel = false) => {
    if (!requireLogin()) return false;
    if (!canCreateTasks) { alert('目前角色未獲授權新增要事'); return false; }
    if (!currentUser || !canUseVessel(currentUser, vesselId)) { alert('船舶帳戶只能新增本船待辦'); return false; }
    const vessel = data.vessels.find(item => item.id === vesselId);
    if (!vessel) { alert('找不到對應船舶'); return false; }
    const assignedOwnerUserIds = vessel.assignedUserIds.filter(id => data.users.some(user => user.id === id && user.isActive && user.role !== 'vessel'));
    const id = uid('task');
    setTaskReturnVesselId(returnToVessel ? vesselId : '');
    setCreatingTask({ id, vesselId, priority:'中', isAware:false, isAbnormal:false, isInternalControl:false, sourceType:'morning', category:'', categories:[], description:'', status:'', expectedDate:'', reportDate:todayDate(), departments:[], ownerUserIds: currentUser.role==='vessel' ? [] : assignedOwnerUserIds, isClosed:false, createdBy:currentUser.id, updatedBy:currentUser.id, createdAt:nowIso(), updatedAt:nowIso(), statusLogs:[] });
    return true;
  };
  const saveTask = (candidate: TaskItem, creating: boolean, expectedUpdatedAt: string, expectedRevision: number) => {
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
      if(!creating&&(!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')||liveUser.role==='vessel')){failure='船舶帳戶新增後不可修改既有待辦';return prev;}
      if(creating&&prev.tasks.some(item=>item.id===candidate.id)){failure='事項識別碼已存在，請重新建立';return prev;}
      const previous=creating?{...candidate,isInternalControl:false}:prev.tasks.find(item=>item.id===candidate.id);
      if(!previous){failure='事項已被刪除或不存在，未保存任何變更';return prev;}
      if(!creating&&prev.revision!==expectedRevision){failure='主資料版本已更新，為避免覆蓋其他操作，本次未保存；請關閉後重新開啟事項';return prev;}
      if(!creating&&previous.updatedAt!==expectedUpdatedAt){failure='事項已由其他操作更新，為避免覆蓋最新內容，本次未保存';return prev;}
      const previousVessels=creating?[]:taskVessels(previous,prev.vessels);
      if(!creating&&(previousVessels.length!==taskVesselIds(previous).length||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,previousVessels))){failure='必須同時具備原涉船與新涉船範圍權限才能更新事項';return prev;}
      const invalidOwner=candidate.ownerUserIds.some(id=>!isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),scopeVessels));
      if(invalidOwner){failure='负责人已停用或不具备全部涉船范围权限，请重新选择';return prev;}
      const normalizedCategories=isMeetingTaskSource(candidate)
        ? normalizeMeetingTaskCategoryList(candidate.categories || candidate.category, prev.settings.meetingTaskCategories)
        : normalizeTaskCategoryList(candidate.category,candidate.categories);
      const linkedMeetingPriority=previous.sourceMeetingId?prev.meetings.find(meeting=>meeting.id===previous.sourceMeetingId)?.priority:undefined;
      const normalizedCandidate=canonicalTaskAttentionForSave({...candidate,categories:normalizedCategories,category:normalizedCategories[0]||''},previous,linkedMeetingPriority);
      if(previous.isInternalControl&&!normalizedCandidate.isInternalControl&&!scopeVessels.every(item=>canCancelInternalControl(liveUser,item))){failure='目前帳戶無權取消全部涉船範圍的內部管控';return prev;}
      let saved:TaskItem;
      try{saved=validateInternalControlTransition(previous,normalizedCandidate,liveUser,vessel);}
      catch(error:any){failure=error.message||String(error);return prev;}
      const cancelled=previous.isInternalControl&&!saved.isInternalControl;
      const kind=creating?'task_created':cancelled?'internal_control_cancelled':'task_updated';
      const previousNoticeVessels=creating?[]:taskVessels(previous,prev.vessels);
      const previousNoticeTask=creating?null:{
        ...previous,
        ownerUserIds:previous.ownerUserIds.filter(id=>isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),previousNoticeVessels)),
      };
      const notices=buildTaskScopeChangeNotifications(
        prev.users,
        previousNoticeTask?{task:previousNoticeTask,vessels:previousNoticeVessels}:null,
        {task:saved,vessels:scopeVessels},
        liveUser.id,kind,liveUser.name,prev.settings.rolePermissions,
      );
      const draft=clone(prev);
      if(creating)draft.tasks.unshift(saved);
      else{
        const index=draft.tasks.findIndex(item=>item.id===saved.id);
        if(index<0){failure='事項已被刪除或不存在，未保存任何變更';return prev;}
        draft.tasks[index]=saved;
      }
      draft.vessels.filter(item=>taskHasVessel(saved,item.id)).forEach(targetVessel=>{targetVessel.weeklyAttention=mergeAttentionFromCategories(targetVessel.weeklyAttention,saved.categories);});
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      applied=true;
      return withAudit(draft,liveUser,creating?'新增事項':cancelled?'取消內部管控':'更新事項','task',saved.id,cancelled?'已提醒至 FLOW 系統申報異常':creating?'建立跟進事項':'保存事項變更');
    }));
    if(!applied)alert(failure);
    return applied;
  };
  const saveTaskVesselProgress = (candidate: TaskItem, vesselId: string, expectedUpdatedAt: string, expectedRevision: number) => {
    let applied=false;
    let failure='單船進度已變更或權限已更新，請重新開啟後再試';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||liveUser.role==='vessel'||!hasPermission(prev.settings.rolePermissions,liveUser,'editBusinessContent')){failure='目前身份無權更新單船進度';return prev;}
      const liveTask=prev.tasks.find(item=>item.id===candidate.id);
      if(!liveTask||!usesPerVesselProgress(liveTask)){failure='待辦不存在或不是多船會議待辦';return prev;}
      if(prev.revision!==expectedRevision||liveTask.updatedAt!==expectedUpdatedAt){failure='資料已由其他人更新，為避免覆蓋，本次未保存；請重新開啟';return prev;}
      const vessel=prev.vessels.find(item=>item.id===vesselId&&item.isActive);
      if(!vessel||!taskVesselIds(liveTask).includes(vesselId)||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,[vessel])){failure='目前身份無權更新此船舶進度';return prev;}
      const candidateProgress=candidate.vesselProgress?.find(item=>item.vesselId===vesselId);
      if(!candidateProgress){failure='找不到此船舶的進度草稿';return prev;}
      const previousProgress=liveTask.vesselProgress?.find(item=>item.vesselId===vesselId);
      if(Boolean(previousProgress?.isClosed)!==candidateProgress.isClosed&&!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份無權結案或重新開啟單船進度';return prev;}
      const at=nowIso();
      const normalizedProgress=clone(candidateProgress);
      if(normalizedProgress.isClosed){normalizedProgress.closedDate ||= todayDate();normalizedProgress.closedBy ||= liveUser.id;}
      else{delete normalizedProgress.closedDate;delete normalizedProgress.closedBy;}
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
    let applied=false;
    let failure='待辦已變更或權限已更新，未執行刪除';
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)){failure='只有 Owner／管理員可以刪除待辦';return prev;}
      const liveTask=prev.tasks.find(item=>item.id===task.id);
      if(!liveTask){failure='待辦已被刪除或不存在';return prev;}
      const vessels=taskVessels(liveTask,prev.vessels);
      if(!vessels.length||!canAccessAllVessels(prev.settings.rolePermissions,liveUser,vessels)){failure='找不到對應船舶範圍或權限已變更';return prev;}
      let resolvedMeetingItemId: string | undefined;
      if(liveTask.sourceMeetingId){
        const meeting=prev.meetings.find(item=>item.id===liveTask.sourceMeetingId);
        if(meeting){
          const resolution=resolveMeetingTaskItemIdForDeletion(liveTask,meeting);
          if(resolution===null){failure='會議事項關聯資料不一致且無法安全判定，未執行刪除';return prev;}
          resolvedMeetingItemId=resolution;
        }
      }
      const noticeTask={...liveTask,ownerUserIds:liveTask.ownerUserIds.filter(id=>isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),vessels))};
      const notices=buildTaskNotificationsForVessels(prev.users,vessels,liveUser.id,noticeTask,'task_deleted',liveUser.name,prev.settings.rolePermissions);
      const draft=clone(prev);
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
      applied=true;
      return withAudit(draft,liveUser,'刪除事項','task',liveTask.id,liveTask.description||liveTask.id);
    }));
    if(!applied)return alert(failure);
    setEditingTaskId('');setCreatingTask(null);
  };
  const batchCompleteTasks = (taskIds: string[]) => {
    if(!currentUser||!canCloseTasks||currentUser.role==='vessel') { alert('目前角色未獲授權批量完成待辦'); return false; }
    const uniqueIds=[...new Set(taskIds)];
    const visibleVesselIds=new Set(activeVessels.map(vessel=>vessel.id));
    const selectedTasks=uniqueIds.map(id=>data.tasks.find(task=>task.id===id));
    if(!uniqueIds.length) { alert('請先選擇要完成的待辦'); return false; }
    if(selectedTasks.some(task=>!task||task.isClosed||usesPerVesselProgress(task)||!taskVesselIds(task).every(id=>visibleVesselIds.has(id)))) { alert('所選待辦已變更、已結案、多船會議待辦不得批量完成，或未具備完整涉船範圍權限，請重新選擇'); return false; }
    const tasks=selectedTasks as TaskItem[];
    if(!confirm(`確定批量完成所選 ${tasks.length} 筆待辦？`)) return false;
    const at=nowIso();
    const closedDate=todayDate();
    let applied=false;
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')||liveUser.role==='vessel') return prev;
      const liveSelection=validateBatchTaskSelection(prev.tasks,uniqueIds,batchVisibleVesselIds(prev,liveUser),'complete');
      if(!liveSelection.ok) return prev;
      let draft=clone(prev);
      const result=completeSelectedTasks(draft.tasks,liveSelection.taskIds,{actorId:liveUser.id,actorName:liveUser.name,at,closedDate});
      const completedTasks=liveSelection.tasks;
      const notices=completedTasks.flatMap(task=>{
        const vessels=taskVessels(task,draft.vessels);
        const noticeTask={...task,ownerUserIds:task.ownerUserIds.filter(id=>isEligibleTaskOwner(draft.settings.rolePermissions,draft.users.find(user=>user.id===id),vessels))};
        return buildTaskNotificationsForVessels(draft.users,vessels,liveUser.id,noticeTask,'task_updated',liveUser.name,draft.settings.rolePermissions);
      });
      draft.tasks=result.tasks;
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      completedTasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量完成事項','task',task.id,richTextToPlainText(task.description)||task.id); });
      applied=true;
      return draft;
    }));
    if(!applied) alert('批量完成未执行：资料或权限已变更，请保留选择并重新确认');
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
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser||!hasPermission(prev.settings.rolePermissions,liveUser,'deleteTasks')||!canDeleteTask(liveUser)) return prev;
      const liveSelection=validateBatchTaskSelection(prev.tasks,uniqueIds,batchVisibleVesselIds(prev,liveUser),'delete');
      if(!liveSelection.ok) return prev;
      const meetingItemTargets=new Map<string,string>();
      for(const task of liveSelection.tasks){
        if(!task.sourceMeetingId)continue;
        const meeting=prev.meetings.find(item=>item.id===task.sourceMeetingId);
        if(!meeting)continue;
        const resolution=resolveMeetingTaskItemIdForDeletion(task,meeting);
        if(resolution===null)return prev;
        if(resolution)meetingItemTargets.set(task.id,resolution);
      }
      let draft=clone(prev);
      const notices=liveSelection.tasks.flatMap(task=>{
        const vessels=taskVessels(task,draft.vessels);
        const noticeTask={...task,ownerUserIds:task.ownerUserIds.filter(id=>isEligibleTaskOwner(draft.settings.rolePermissions,draft.users.find(user=>user.id===id),vessels))};
        return buildTaskNotificationsForVessels(draft.users,vessels,liveUser.id,noticeTask,'task_deleted',liveUser.name,draft.settings.rolePermissions);
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
      draft.tasks=deleteSelectedTasks(draft.tasks,liveSelection.taskIds).tasks;
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
      liveSelection.tasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量刪除事項','task',task.id,richTextToPlainText(task.description)||task.id); });
      applied=true;
      return draft;
    }));
    if(!applied) alert('批量删除未执行：资料或权限已变更，请保留选择并重新确认');
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
    const syncIdentity = cloudIdentity(syncConfig);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    pendingCloudData.current = null;
    if (cloudSaveInFlight.current) await cloudSaveInFlight.current.catch(() => undefined);
    activeCloudIdentity.current = syncIdentity;
    try { const remote=await fetchCloudData(); const latestConfig=getSupabaseConfig(); if(!latestConfig || cloudIdentity(latestConfig)!==syncIdentity) throw new Error('同步期間雲端工作區 identity 已變更，請重試'); if(remote){lastCloudRevision.current=remote.revision;setData(remote);setCloudWriteBlocked(false);rememberCloudIdentity();setCloudStatus(savedStatus('已同步雲端',remote.updatedAt));}else {lastCloudRevision.current=-1;setCloudWriteBlocked(false);rememberCloudIdentity();setCloudStatus('雲端尚無資料；已允許以目前本機資料初始化');} }
    catch(e:any){setCloudWriteBlocked(true);setCloudStatus(`同步失敗：${e.message||e}`);}
    finally { cloudSyncInFlight.current=false; setCloudSyncing(false); }
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
    setTab('total');
  };
  const closeTaskEditor = () => {
    const returnVesselId = taskReturnVesselId;
    releaseCurrentEditLock();
    setEditingTaskId('');
    setTaskProgressVesselId('');
    setCreatingTask(null);
    setTaskReturnVesselId('');
    if (returnVesselId && activeVessels.some(vessel => vessel.id === returnVesselId)) void openVesselEditor(returnVesselId);
  };
  const editingTask=creatingTask||data.tasks.find(task=>task.id===editingTaskId);
  const editingTaskScopeVessels=editingTask?taskVessels(editingTask,data.vessels):[];
  const canEditOverallTask=Boolean(creatingTask||(
    editingTask&&canEditBusinessContent&&currentUser.role!=='vessel'
    &&editingTaskScopeVessels.length===taskVesselIds(editingTask).length
    &&canAccessAllVessels(data.settings.rolePermissions,currentUser,editingTaskScopeVessels)
  ));

  return <div className="app">
    <header className="topbar no-print"><div className="topbar-inner">
      <div className="brand"><img className="brand-icon" src={fpmcLogo} alt="台塑 LOGO" /><span><b>{SYSTEM_TITLE}</b><small>{SYSTEM_SUBTITLE}</small></span></div>
      <nav className="nav">
        {([['dashboard','船隊看板'],['morning','早會工作台'],['meeting','臨會/專題'],['work',`我的待辦${myWorkTaskCount?`（${myWorkTaskCount}）`:''}`],['total',currentUser.role==='vessel'?'本船待辦':'待辦總表'],['closed','已結案'],['reports','報告中心'],['stats','數據分析'],['management','管理']] as [Tab,string][]).filter(([k])=>canAccessTab(currentUser, k)&&(k!=='reports'||canExportReports)&&(k!=='management'||canEnterManagement)).map(([k,label]) => <button key={k} className={tab===k?'active':''} onClick={() => { if (!canAccessTab(currentUser,k)) return; if (k==='reports' && !canExportReports) return alert('目前角色未獲授權預覽或匯出報告'); if (k==='management' && !requireManage()) return; setSelectedVesselDetailId(''); setTab(k); }}>{label}</button>)}
      </nav>
      <div className="user-chip"><span className="cloud-dot"/><span>{currentUser.name}｜{roleLabel(currentUser.role)}</span><button className="btn small ghost" onClick={() => setCurrentUserId('')}>切換/退出</button></div>
    </div></header>
    <main className="container">
      <div className="cloud-strip no-print"><span className={getSupabaseConfig()?'ok-note':'danger-note'}>{cloudStatus}</span><span className="spacer"/><button className="btn ghost small" onClick={syncLatest}>同步最新</button><button className="btn green small" onClick={saveChanges}>保存修改</button></div>
      {activeEditLock && <div className={`collaboration-banner no-print ${activeEditLock.status}`}><b>多人協作安全</b><span>{activeEditLock.status==='owned' ? `你正在編輯：${activeEditLock.label}；系統已建立短時鎖定，保存仍會做 revision 衝突檢查。` : activeEditLock.status==='blocked' ? `此項目正在由 ${activeEditLock.lockedByName || '其他使用者'} 編輯，已阻止打開以避免覆蓋對方內容。` : `無法確認 ${activeEditLock.label} 的編輯鎖，請同步最新後再試。`}</span>{activeEditLock.status!=='owned'&&<button className="btn small ghost" onClick={()=>setActiveEditLock(null)}>知道了</button>}</div>}
      <div className="print-only app-print-header"><h2>{printTitle || data.settings.systemTitle}</h2><p>列印時間：{new Date().toLocaleString()}｜列印人：{currentUser.name}</p></div>
      {tab==='dashboard' && selectedVesselDetail && <VesselDetailPage vessel={selectedVesselDetail} data={data} currentUser={currentUser} onBack={()=>setSelectedVesselDetailId('')} onEditVessel={()=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');void openVesselEditor(selectedVesselDetail.id);}} onAddTask={()=>addTaskForVessel(selectedVesselDetail.id)} onEditTask={id=>{const task=data.tasks.find(item=>item.id===id);if(task)openTask(task,selectedVesselDetail.id);}} canEditVessel={canEditBusinessContent} canCreateTasks={canCreateTasks} canEditTasks={canEditBusinessContent&&currentUser.role!=='vessel'} />}
      {tab==='dashboard' && !selectedVesselDetail && <DashboardView user={currentUser} vessels={activeVessels} tasks={data.tasks} selected={agendaSelection} setSelected={setAgendaSelection} onOpenVessel={setSelectedVesselDetailId} onEdit={id=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');void openVesselEditor(id);}} onAddTask={addTaskForVessel} onToggleAttention={(vesselId,key)=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改關注燈');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;vessel.weeklyAttention=vessel.weeklyAttention.includes(key)?vessel.weeklyAttention.filter(item=>item!==key):[...vessel.weeklyAttention,key];vessel.updatedAt=nowIso();},'切換一週關注燈','vessel',vesselId,key);}} onAdjustAttention={vesselId=>{if(!canEditBusinessContent)return alert('目前角色未獲授權調整關注度');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;const openVesselTasks=draft.tasks.filter(task=>taskHasVessel(task,vesselId)&&!task.isClosed);const automatic=deriveVesselAttention(vessel,openVesselTasks).automatic;vessel.manualAttentionLevel=nextManualVesselAttention(vessel.manualAttentionLevel||'',automatic);vessel.updatedAt=nowIso();},'調整船舶關注度','vessel',vesselId,'自動／低／中／高／急／特別關注（受自動下限保護）');}} onStartMeeting={(requestedIds) => { if (requestedIds) { const allowedIds=new Set(activeVessels.map(vessel=>vessel.id)); setAgendaSelection(Array.from(new Set(requestedIds.filter(id=>allowedIds.has(id))))); } else if (!agendaSelection.length) { const priority = activeVessels.filter(v => morningDiscussionTasks(data.tasks,data.meetings).some(t => taskHasVessel(t,v.id) && !taskIsClosedForVessel(t,v.id) && (t.priority==='急'||t.priority==='高'))).slice(0,4).map(v=>v.id); setAgendaSelection(priority.length ? priority : activeVessels.slice(0,4).map(v=>v.id)); } setTab('morning'); }} onOpenReport={openReportPreview} onTaskMetric={jumpToTaskList} canEdit={canEditBusinessContent} canCreateTasks={canCreateTasks} canUseMeetings={currentUser.role!=='vessel'} canUseReports={canExportReports} />}
      {tab==='morning' && <MorningWorkspaceView data={data} user={currentUser} visibleVessels={activeVessels} selected={agendaSelection} setSelected={setAgendaSelection} onEditTask={openTask} onAddTask={addTaskForVessel} onOpenVessel={openVesselEditor} onOpenTemporaryMeeting={()=>setTab('meeting')} onOpenReport={openReportPreview} commit={commit} />}

      {tab==='total' && <ListPanel title={currentUser.role==='vessel'?'本船待辦清單':'總清單'} tasks={filteredTasks} data={data} visibleVessels={activeVessels} filters={filters} setFilters={setFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('船舶記事總清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='work' && <WorkCenter
        data={data}
        user={currentUser}
        vessels={activeVessels}
        onOpenTask={openTask}
        onOpenVessel={openVesselEditor}
        onBatchComplete={batchCompleteTasks}
        onBatchDelete={batchDeleteTasks}
        canComplete={canCloseTasks&&currentUser.role!=='vessel'}
        canDelete={canDeleteTasks}
        canPrint={canExportReports}
        onPrint={() => print('我的待辦清單')}
        markAllRead={()=>commit(draft=>{const at=nowIso();draft.notifications.forEach(item=>{if(item.userId===currentUser.id&&!item.readAt)item.readAt=at;});},'標記通知已讀','notification',currentUser.id,'全部標記已讀')}
      />}
      {tab==='closed' && <ListPanel title="已結案清單" tasks={closedTasks} data={data} visibleVessels={activeVessels} filters={closedFilters} setFilters={setClosedFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('已結案清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='stats' && <DataAnalysisView data={data} vessels={canViewAllVessels?reportVessels:activeVessels} />}
      {tab==='meeting' && <TemporaryMeetingsPage data={data} visibleVessels={activeVessels} currentUser={currentUser} canExportReports={canExportReports} setData={setData} commit={commit} />}

      {tab==='reports' && <ReportCenter data={data} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} setSelected={setAgendaSelection} commit={commit} onOpenPreview={openReportPreview} onPrint={() => print('早會船舶動態與議程清單')} />}
      {tab==='management' && canEnterManagement && <ManagementView data={data} currentUser={currentUser} commit={commit} />}
    </main>
    {editingVesselId && <VesselEditModal vessel={data.vessels.find(v=>v.id===editingVesselId)} data={data} currentUser={currentUser} close={()=>{setEditingVesselId('');releaseCurrentEditLock();}} commit={commit} addTask={id=>{if(addTaskForVessel(id,true)){setEditingVesselId('');releaseCurrentEditLock();}}} editTask={id=>{const vesselId=editingVesselId;const task=data.tasks.find(item=>item.id===id);setEditingVesselId('');releaseCurrentEditLock();if(task)openTask(task,vesselId);}} />}
    {(editingTaskId || creatingTask) && <TaskEditModal task={editingTask} creating={Boolean(creatingTask)} data={data} visibleVessels={activeVessels} currentUser={currentUser} canClose={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} canCancelInternalControl={Boolean(editingTask&&editingTaskScopeVessels.length===taskVesselIds(editingTask).length&&editingTaskScopeVessels.every(vessel=>canCancelInternalControl(currentUser,vessel)))} canEditOverall={canEditOverallTask} initialProgressVesselId={taskProgressVesselId} readOnly={!creatingTask&&(!canEditBusinessContent||currentUser.role==='vessel')} close={closeTaskEditor} onSave={saveTask} onSaveVesselProgress={saveTaskVesselProgress} onDelete={()=>{const original=data.tasks.find(task=>task.id===editingTaskId);if(original)deleteTask(original);}} />}
    {reportPreviewOpen && <ReportPreviewModal data={data} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} close={()=>setReportPreviewOpen(false)} onPrint={printReport} />}
    {currentUser.role!=='vessel'&&!selectedVesselDetailId&&(['dashboard','morning','reports'] as Tab[]).includes(tab) && <div className="selection-dock no-print">涉會船舶 <b className="selected-vessel-count">{agendaSelection.length}</b> 艘 <button className="btn pink small" onClick={()=>setTab('morning')}>進入早會</button><button className="btn primary small" onClick={openReportPreview}>預覽報告</button></div>}
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
function Login({ data, setCurrentUserId }: { data: AppData; setCurrentUserId:(id:string)=>void }) {
  const activeUsers=data.users.filter(user=>user.isActive);
  const departments=Array.from(new Set(activeUsers.map(user=>user.department || '未指定部門'))).filter(Boolean);
  const [department,setDepartment]=useState(departments[0]||''); const [userId,setUserId]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const people=activeUsers.filter(user=>(user.department || '未指定部門')===department);
  useEffect(()=>{if(!people.some(user=>user.id===userId)){setUserId(people[0]?.id||'');setPw('');setErr('');}},[department,data.revision]);
  const selectedUser=activeUsers.find(user=>user.id===userId);
  const selectedNeedsPassword=selectedUser?.role==='owner'||selectedUser?.role==='admin';
  const login=async()=>{ const user=activeUsers.find(item=>item.id===userId); if(!user) return setErr('請選擇登入人員'); const needsPassword=user.role==='owner'||user.role==='admin'; if(!needsPassword){setCurrentUserId(user.id);return;} if(!user.passwordHash) return setErr('此 Owner／管理員帳號尚未設定密碼，請由 Owner 先設定密碼'); if(!pw) return setErr('Owner／管理員請輸入密碼'); if(await sha256(pw)!==user.passwordHash) return setErr('密碼錯誤'); setCurrentUserId(user.id); };
  return <div className="login-page"><div className="login-card"><h2>人員登入／切換</h2><p className="muted">請先選擇部門與人員；Owner／管理員需輸入密碼，其餘人員可直接登入。</p><div className="field"><label>部門</label><select aria-label="登入部門" value={department} onChange={e=>setDepartment(e.target.value)}>{departments.map(item=><option key={item}>{item}</option>)}</select></div><div className="field"><label>人員</label><select aria-label="登入人員" value={userId} onChange={e=>{setUserId(e.target.value);setPw('');setErr('');}}>{people.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></div><div className="field"><label>密碼</label><input type="password" value={pw} placeholder={selectedNeedsPassword?'Owner／管理員請輸入密碼':'非管理角色可空白直接登入'} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') login();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" disabled={!selectedUser} onClick={login}>登入</button></div></div>;
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
  return <div className="report-preview-modal" role="dialog" aria-modal="true" aria-labelledby="report-preview-title"><div ref={shellRef} tabIndex={-1} className="report-preview-shell"><div className="report-preview-actions no-print"><h2 id="report-preview-title">PDF 報告預覽</h2><span>A4 橫向</span><div className="spacer"/><button className="btn primary" disabled={!vessels.length} title={!vessels.length?'目前選擇不在授權範圍內':''} onClick={onPrint}>導出／列印 PDF</button><button ref={closeButtonRef} className="btn ghost" onClick={close}>關閉</button></div><article className="report-paper"><header><h1>船舶早會動態暨待辦報告</h1><p>報告日期：{new Date().toLocaleDateString('zh-TW')}　製表：{user.name}　資料版本：rev.{data.revision}</p></header><div className="report-kpis"><div>船舶<br/><b>{vessels.length}</b></div><div>單船要事<br/><b>{ordinaryReportTasks.length}</b></div><div>公司層決議<br/><b>{companyDecisionTasks.length}</b></div><div>逾期要事<br/><b>{ordinaryReportTasks.filter(t=>(daysDiff(t.expectedDate)??0)<0).length}</b></div></div><table><thead><tr><th>船舶／航線</th><th>動態與貨況</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{vessels.map(v=>{const vt=singleVesselTasks.filter(t=>taskHasVessel(t,v.id));return vt.length?vt.map((t,i)=><tr key={`${v.id}-${t.id}`}>{i===0&&<td rowSpan={vt.length}><b>{vesselDisplayName(v)}</b><br/>{v.position.lastPort} → {v.position.nextPort}<br/>{v.position.speedKnots||0} kn</td>}{i===0&&<td rowSpan={vt.length}>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}<br/><b>人工備註：</b>{v.position.manualRemark||'-'}<br/><b>近期／後續動態：</b>{v.note.recentDynamics||'-'}</td>}<td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>):<tr key={v.id}><td><b>{vesselDisplayName(v)}</b><br/>{v.position.lastPort} → {v.position.nextPort}</td><td>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}<br/><b>人工備註：</b>{v.position.manualRemark||'-'}<br/><b>近期／後續動態：</b>{v.note.recentDynamics||'-'}</td><td colSpan={2}>目前無未結事項</td></tr>})}</tbody></table>{companyDecisionTasks.length>0&&<><h2>公司層決議案（臨會／專題）</h2><table><thead><tr><th>涉及範圍</th><th>船種</th><th>決議事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{companyDecisionTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskReportVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskReportShipTypeLabel(t,vessels)}</td><td><b>會議議題｜{taskCategoryLabel(t)}</b><RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>)}</tbody></table></>}{crossVesselTasks.length>0&&<><h2>跨船單船要事</h2><table><thead><tr><th>船舶</th><th>船種</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{crossVesselTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskReportVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskReportShipTypeLabel(t,vessels)}</td><td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<RichTextContent compact value={t.description} fallback="-"/></td><td><ReportTaskStatusBlock task={t} scopeIds={reportScopeIds}/></td></tr>)}</tbody></table></>}<footer>本報告依目前授權範圍、報告選擇及 Supabase／本機最新資料產生。</footer></article></div></div>;
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
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><section className="panel"><div className="panel-title"><h2>{title} <span className="muted">({tasks.length})</span></h2><div className="heading-actions no-print"><button className="btn small ghost filter-reset-btn" onClick={()=>setFilters({...emptyFilters,closedMode:filters.closedMode})}>清除篩選</button><button className="btn small ghost" onClick={toggleAll} disabled={!pagedTasks.items.length}>{allSelected?'取消本頁全選':'全選本頁'}</button><span className="batch-selection-count">已選 {selectedTasks.length}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!openSelectedIds.length} title={!canComplete?'目前角色未獲授權批量完成':openSelectedIds.length?'':'所選事項均已結案'}>批量完成（{openSelectedIds.length}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectedTasks.length} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectedTasks.length}）</button>{canPrint&&<button className="btn primary" onClick={onPrint}>導出 PDF</button>}</div></div>{tasks.length?<div className="table-wrap"><table className="compact batch-task-table"><thead><tr><th className="no-print batch-select-cell"><input ref={selectAllRef} type="checkbox" aria-label="全選目前結果" checked={allSelected} onChange={toggleAll}/></th><th>船舶</th><th>船種</th><th>關注維度／等級</th><th>來源</th><th>分類/事項</th><th>部門</th><th>追蹤窗口</th><th>期限</th><th>狀態</th><th className="no-print">操作</th></tr></thead><tbody>{pagedTasks.items.map(t=>{ const vessels=taskVessels(t,visibleVessels); const projected=taskProjectedProgressForScope(t,visibleScopeIds); const fleetCategories=Array.from(new Set(vessels.map(v=>v.fleetCategory).filter(Boolean))).join('、'); const diff=daysDiff(t.expectedDate); const managerIds=[...new Set(t.ownerUserIds)]; return <tr key={t.id} className={selectedSet.has(t.id)?'batch-selected-row':''}><td className="no-print batch-select-cell"><input type="checkbox" aria-label={`選取待辦 ${richTextToPlainText(t.description)||t.id}`} checked={selectedSet.has(t.id)} onChange={()=>toggleOne(t.id)}/></td><td className="task-vessel-scope">{taskVesselLabel(t,visibleVessels)}</td><td>{taskShipTypeLabel(t,visibleVessels)}<br/><span className="muted">{t.vesselScopeMode==='all'?'全部':fleetCategories||'-'}</span></td><td><small className="attention-dimension-label">{isMeetingAttentionTask(t)?'會議議題':'要事'}</small><span className={priorityClass(t.priority)}>{t.priority}</span>{t.isInternalControl&&<span className="internal-control-tag">內部管控</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}{t.isAware&&<span className="badge aware">知曉</span>}</td><td><span className={`task-source-badge source-${t.sourceType}`}>{taskSourceLabel(t)}</span></td><td><span className="chip">{taskCategoryLabel(t)}</span><RichTextContent compact value={t.description} fallback="-"/></td><td>{t.departments.map(d=><span className="chip" key={d}>{d}</span>)}</td><td>{managerIds.map(id=>userMap[id]?.name).filter(Boolean).join('、') || '-'}</td><td>{t.expectedDate||'-'}<br/>{!projected.isClosed&&diff!==null&&diff<0&&<span className="warn">逾期 {Math.abs(diff)} 天</span>}</td><td className="task-list-status-cell">{projected.isClosed?<span className="badge closed">已結案 {projected.closedDate}</span>:<RichTextContent compact className="task-list-status-text" value={projected.status} fallback="-"/>}<br/><span className="muted">更新：{fmt(projected.updatedAt||t.updatedAt)}</span></td><td className="no-print"><button className="btn small primary" onClick={()=>onEdit(t)}>{canEdit?'更新':'查看'}</button></td></tr>;})}</tbody></table></div>:<div className="empty-state">目前沒有符合條件的事項</div>}<PaginationControls ariaLabel="待辦清單分頁" page={pagedTasks.page} pageCount={pagedTasks.pageCount} total={pagedTasks.total} from={pagedTasks.from} to={pagedTasks.to} onPageChange={setPage}/></section></>;
}
function Stats({ tasks, data, filters, setFilters, fleetTags }: { tasks:TaskItem[]; data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const total=tasks.length, closed=tasks.filter(t=>t.isClosed).length, open=total-closed, overdue=tasks.filter(t=>!t.isClosed&&(daysDiff(t.expectedDate)??0)<0).length, abnormal=tasks.filter(t=>!t.isClosed&&t.isAbnormal).length;
  const group=(items:string[])=>items.reduce<Record<string,number>>((a,x)=>{a[x]=(a[x]||0)+1;return a;},{});
  const ordinaryTasks=tasks.filter(t=>!isMeetingTaskSource(t));
  const meetingTasks=tasks.filter(t=>isMeetingTaskSource(t));
  const ordinaryCat=group(ordinaryTasks.flatMap(t=>taskCategoriesOf(t).length?taskCategoriesOf(t):['未分類']));
  const meetingCat=group(meetingTasks.flatMap(t=>taskCategoriesOf(t).length?taskCategoriesOf(t):['未分類']));
  const pri=group(tasks.map(t=>t.priority)); const dep=group(tasks.flatMap(t=>t.departments.length?t.departments:['未指定']));
  const Block=({title,obj}:{title:string;obj:Record<string,number>})=><div className="panel"><h3>{title}</h3>{Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v])=><div key={k}><div className="toolbar"><span style={{width:120}}>{k}</span><b>{v}</b></div><div className="bar"><span style={{width:`${Math.max(4,v/Math.max(1,total)*100)}%`}} /></div></div>)}</div>;
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><div className="cards"><div className="stat-card"><span>總事項</span><br/><b>{total}</b></div><div className="stat-card"><span>未結</span><br/><b>{open}</b></div><div className="stat-card"><span>已結案</span><br/><b>{closed}</b></div><div className="stat-card"><span>完成率</span><br/><b>{total?Math.round(closed/total*100):0}%</b></div><div className="stat-card"><span>逾期</span><br/><b>{overdue}</b></div><div className="stat-card"><span>異常存在</span><br/><b>{abnormal}</b></div></div><div className="grid cols-3"><Block title="要事分類比例" obj={ordinaryCat}/><Block title="臨會/專題分類比例" obj={meetingCat}/><Block title="關注程度" obj={pri}/><Block title="部門歸屬" obj={dep}/></div></>;
}
