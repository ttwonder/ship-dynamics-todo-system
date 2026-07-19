import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import fpmcLogo from './assets/fpmc-logo.png';
import { createInitialData } from './data/seed';
import type { AppData, FilterState, TaskItem, UserAccount, Vessel } from './types';
import { CLOUD_CACHE_IDENTITY_KEY, CURRENT_USER_KEY, SESSION_SITE_UNLOCK, STORAGE_KEY, daysDiff, loadLocal, nowIso, roleLabel, saveLocal, sha256, todayDate, uid, withAudit } from './utils';
import { CloudConflictError, fetchCloudData, getSupabaseConfig, saveCloudData } from './cloud';
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
import { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications, canAccessTab, canCancelInternalControl, canDeleteTask, canUseVessel, taskSourceLabel, validateInternalControlTransition } from './taskWorkflow';
import { mergeAttentionFromCategories, normalizeTaskCategoryList, taskCategoriesOf, taskCategoryLabel } from './taskCategories';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskShipTypeLabel, taskVesselIds, taskVesselLabel, taskVessels } from './taskVesselScope';
import { deriveVesselAttention, nextManualVesselAttention } from './vesselAttention';
import { completeSelectedTasks, deleteSelectedTasks, sanitizeTaskSelection, validateBatchTaskSelection } from './batchTaskActions';
import { resolveMeetingTaskItemIdForDeletion } from './meetingTaskWorkflow';

type Tab = 'dashboard' | 'morning' | 'total' | 'reports' | 'stats' | 'management' | 'meeting' | 'closed' | 'work';
const SYSTEM_TITLE = '船舶動態與會議管理系統';
const SYSTEM_SUBTITLE = 'Fleet Activities & Office Meeting Manage System';
const emptyFilters: FilterState = { keyword:'', departments:[], vesselIds:[], fleetTags:[], priorities:[], categories:[], ownerMode:'all', fromDate:'', toDate:'', closedMode:'open', overdueOnly:false, internalControlOnly:false };

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

function taskMatchesFilters(t: TaskItem, filters: FilterState, vesselMap: Record<string,Vessel>, currentUser: UserAccount | null, applyClosedMode: boolean, canViewAll = false, taskOwnerAccess = false) {
  const vessels = taskVesselIds(t).map(id => vesselMap[id]).filter((vessel): vessel is Vessel => Boolean(vessel?.isActive));
  const visibleVessels = vessels.filter(vessel => vesselMatchesUser(vessel, currentUser, canViewAll));
  if (!visibleVessels.length && !taskOwnerAccess) return false;
  if (applyClosedMode && filters.closedMode === 'open' && t.isClosed) return false;
  if (applyClosedMode && filters.closedMode === 'closed' && !t.isClosed) return false;
  if (filters.overdueOnly && (t.isClosed || (daysDiff(t.expectedDate) ?? 0) >= 0)) return false;
  const kw=filters.keyword.trim().toLowerCase();
  if(kw&&![t.description,t.status,...taskCategoriesOf(t),...visibleVessels.flatMap(v=>[v.name,v.shortName,v.fullName,v.shipType]),...t.departments].join(' ').toLowerCase().includes(kw))return false;
  if(filters.departments.length&&!t.departments.some(d=>filters.departments.includes(d)))return false;
  if(filters.vesselIds.length&&!visibleVessels.some(v=>filters.vesselIds.includes(v.id)))return false;
  if(filters.fleetTags.length&&!visibleVessels.some(v=>v.fleetTags.some(f=>filters.fleetTags.includes(f))))return false;
  if(filters.priorities.length&&!filters.priorities.includes(t.priority))return false;
  if(filters.categories.length&&!taskCategoriesOf(t).some(category=>filters.categories.includes(category)))return false;
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
  const [creatingTask, setCreatingTask] = useState<TaskItem | null>(null);
  const [taskReturnVesselId, setTaskReturnVesselId] = useState<string>('');
  const [cloudStatus, setCloudStatus] = useState('本機模式');
  const [agendaSelection, setAgendaSelection] = useState<string[]>([]);
  const [printTitle, setPrintTitle] = useState('');
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [cloudBootstrapped, setCloudBootstrapped] = useState(false);
  const [cloudWriteBlocked, setCloudWriteBlocked] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const lastCloudRevision = useRef<number>(-1);
  const activeCloudIdentity = useRef('');
  const pendingCloudData = useRef<AppData | null>(null);
  const cloudSaveInFlight = useRef<Promise<void> | null>(null);
  const cloudSyncInFlight = useRef(false);
  const currentUser=data.users.find(u=>u.id===currentUserId && u.isActive) || null;
  const ownerExists = data.users.some(u => u.role === 'owner' && u.isActive);

  useEffect(() => { saveLocal(data); }, [data]);
  useEffect(() => { currentUserId ? localStorage.setItem(CURRENT_USER_KEY, currentUserId) : localStorage.removeItem(CURRENT_USER_KEY); }, [currentUserId]);

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
          await saveCloudData(next, lastCloudRevision.current);
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
  const unreadNotifications = data.notifications.filter(item=>item.userId===currentUser?.id&&!item.readAt).length;
  useEffect(() => { setAgendaSelection(prev => prev.filter(id => activeVessels.some(v=>v.id===id))); }, [activeVessels]);
  useEffect(() => { if (selectedVesselDetailId && !activeVessels.some(vessel=>vessel.id===selectedVesselDetailId)) setSelectedVesselDetailId(''); }, [activeVessels, selectedVesselDetailId]);
  useEffect(() => { if (currentUser && (!canAccessTab(currentUser, tab) || (tab === 'reports' && !canExportReports))) setTab('dashboard'); }, [currentUser, tab, canExportReports]);
  const vesselMap = useMemo(() => Object.fromEntries(data.vessels.map(v => [v.id, v])), [data.vessels]);
  const userMap = useMemo(() => Object.fromEntries(data.users.map(u => [u.id, u])), [data.users]);
  const fleetTags = useMemo(() => Array.from(new Set(data.vessels.flatMap(v => v.fleetTags))).filter(Boolean), [data.vessels]);

  const filteredTasks = useMemo(() => data.tasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,true,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))).sort((a,b)=>Number(a.isClosed)-Number(b.isClosed)||(daysDiff(a.expectedDate)??9999)-(daysDiff(b.expectedDate)??9999)),[data.tasks,vesselMap,currentUser,filters,canViewAllVessels]);
  const statsTasks = useMemo(() => data.tasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,false,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[data.tasks,vesselMap,currentUser,filters,canViewAllVessels]);
  const closedTasks = useMemo(() => data.tasks.filter(t=>t.isClosed&&taskMatchesFilters(t,closedFilters,vesselMap,currentUser,false,canViewAllVessels,Boolean(currentUser&&t.ownerUserIds.includes(currentUser.id)))),[data.tasks,vesselMap,currentUser,closedFilters,canViewAllVessels]);

  if (!cloudBootstrapped) return <div className="login-page"><div className="login-card loading-card"><h2>正在載入雲端主資料</h2><p className="muted">請稍候，完成前不會寫入或覆蓋資料。</p></div></div>;
  if (!siteUnlocked) return <SiteGate data={data} onUnlock={() => { sessionStorage.setItem(SESSION_SITE_UNLOCK,'1'); setSiteUnlocked(true); }} />;
  if (!ownerExists && !currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;
  if (!ownerExists && currentUser) return <OwnerSetup currentUser={currentUser} setData={setData} setCurrentUserId={setCurrentUserId} />;
  if (!currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;

  const openTask = (task: TaskItem) => { if (!task.ownerUserIds.includes(currentUser.id)&&!taskVesselIds(task).some(id=>activeVessels.some(vessel=>vessel.id===id))) return alert('無權查看此待辦'); setEditingTaskId(task.id); };
  const addTaskForVessel = (vesselId: string, returnToVessel = false) => {
    if (!requireLogin()) return false;
    if (!canCreateTasks) { alert('目前角色未獲授權新增要事'); return false; }
    if (!currentUser || !canUseVessel(currentUser, vesselId)) { alert('船舶帳戶只能新增本船待辦'); return false; }
    const vessel = data.vessels.find(item => item.id === vesselId);
    if (!vessel) { alert('找不到對應船舶'); return false; }
    const assignedOwnerUserIds = vessel.assignedUserIds.filter(id => data.users.some(user => user.id === id && user.isActive && user.role !== 'vessel'));
    const id = uid('task');
    setTaskReturnVesselId(returnToVessel ? vesselId : '');
    setCreatingTask({ id, vesselId, priority:'中', isAware:false, isAbnormal:false, isInternalControl:false, sourceType:'morning', category:'', categories:[], description:'', status:'', expectedDate:'', departments:[], ownerUserIds: currentUser.role==='vessel' ? [] : assignedOwnerUserIds, isClosed:false, createdBy:currentUser.id, updatedBy:currentUser.id, createdAt:nowIso(), updatedAt:nowIso(), statusLogs:[] });
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
      const normalizedCategories=normalizeTaskCategoryList(candidate.category,candidate.categories);
      const normalizedCandidate={...candidate,categories:normalizedCategories,category:normalizedCategories[0]||''};
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
  const deleteTask = (task: TaskItem) => {
    if(!currentUser||!canDeleteTasks||!canDeleteTask(currentUser)) return alert('只有 Owner／管理員可以刪除待辦');
    if(!confirm(`確定刪除待辦「${task.description||task.id}」？此動作會留下操作紀錄。`)) return;
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
    if(selectedTasks.some(task=>!task||task.isClosed||!taskVesselIds(task).every(id=>visibleVesselIds.has(id)))) { alert('所選待辦已變更、已結案或未具備完整涉船範圍權限，請重新選擇'); return false; }
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
      completedTasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量完成事項','task',task.id,task.description||task.id); });
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
      liveSelection.tasks.forEach(task=>{ draft=withAudit(draft,liveUser,'批量刪除事項','task',task.id,task.description||task.id); });
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
    setEditingTaskId('');
    setCreatingTask(null);
    setTaskReturnVesselId('');
    if (returnVesselId && activeVessels.some(vessel => vessel.id === returnVesselId)) setEditingVesselId(returnVesselId);
  };

  return <div className="app">
    <header className="topbar no-print"><div className="topbar-inner">
      <div className="brand"><img className="brand-icon" src={fpmcLogo} alt="台塑 LOGO" /><span><b>{SYSTEM_TITLE}</b><small>{SYSTEM_SUBTITLE}</small></span></div>
      <nav className="nav">
        {([['dashboard','船隊看板'],['morning','早會工作台'],['meeting','臨會/專題'],['work',`我的待辦${unreadNotifications?`（${unreadNotifications}）`:''}`],['total',currentUser.role==='vessel'?'本船待辦':'待辦總表'],['closed','已結案'],['reports','報告中心'],['stats','數據分析'],['management','管理']] as [Tab,string][]).filter(([k])=>canAccessTab(currentUser, k)&&(k!=='reports'||canExportReports)&&(k!=='management'||canEnterManagement)).map(([k,label]) => <button key={k} className={tab===k?'active':''} onClick={() => { if (!canAccessTab(currentUser,k)) return; if (k==='reports' && !canExportReports) return alert('目前角色未獲授權預覽或匯出報告'); if (k==='management' && !requireManage()) return; setSelectedVesselDetailId(''); setTab(k); }}>{label}</button>)}
      </nav>
      <div className="user-chip"><span className="cloud-dot"/><span>{currentUser.name}｜{roleLabel(currentUser.role)}</span><button className="btn small ghost" onClick={() => setCurrentUserId('')}>切換/退出</button></div>
    </div></header>
    <main className="container">
      <div className="cloud-strip no-print"><span className={getSupabaseConfig()?'ok-note':'danger-note'}>{cloudStatus}</span><span className="spacer"/><button className="btn ghost small" onClick={syncLatest}>同步最新</button><button className="btn green small" onClick={saveChanges}>保存修改</button></div>
      <div className="print-only app-print-header"><h2>{printTitle || data.settings.systemTitle}</h2><p>列印時間：{new Date().toLocaleString()}｜列印人：{currentUser.name}</p></div>
      {tab==='dashboard' && selectedVesselDetail && <VesselDetailPage vessel={selectedVesselDetail} data={data} currentUser={currentUser} onBack={()=>setSelectedVesselDetailId('')} onEditVessel={()=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');setEditingVesselId(selectedVesselDetail.id);}} onAddTask={()=>addTaskForVessel(selectedVesselDetail.id)} onEditTask={id=>{const task=data.tasks.find(item=>item.id===id);if(task)openTask(task);}} canEditVessel={canEditBusinessContent} canCreateTasks={canCreateTasks} canEditTasks={canEditBusinessContent&&currentUser.role!=='vessel'} />}
      {tab==='dashboard' && !selectedVesselDetail && <DashboardView user={currentUser} vessels={activeVessels} tasks={data.tasks} selected={agendaSelection} setSelected={setAgendaSelection} onOpenVessel={setSelectedVesselDetailId} onEdit={id=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');setEditingVesselId(id);}} onAddTask={addTaskForVessel} onToggleAttention={(vesselId,key)=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改關注燈');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;vessel.weeklyAttention=vessel.weeklyAttention.includes(key)?vessel.weeklyAttention.filter(item=>item!==key):[...vessel.weeklyAttention,key];vessel.updatedAt=nowIso();},'切換一週關注燈','vessel',vesselId,key);}} onAdjustAttention={vesselId=>{if(!canEditBusinessContent)return alert('目前角色未獲授權調整關注度');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;const openVesselTasks=draft.tasks.filter(task=>taskHasVessel(task,vesselId)&&!task.isClosed);const automatic=deriveVesselAttention(vessel,openVesselTasks).automatic;vessel.manualAttentionLevel=nextManualVesselAttention(vessel.manualAttentionLevel||'',automatic);vessel.updatedAt=nowIso();},'調整船舶關注度','vessel',vesselId,'自動／低／中／高／急／特別關注（受自動下限保護）');}} onStartMeeting={() => { if (!agendaSelection.length) { const priority = activeVessels.filter(v => data.tasks.some(t => taskHasVessel(t,v.id) && !t.isClosed && (t.priority==='急'||t.priority==='高'))).slice(0,4).map(v=>v.id); setAgendaSelection(priority.length ? priority : activeVessels.slice(0,4).map(v=>v.id)); } setTab('morning'); }} onOpenReport={openReportPreview} onTaskMetric={jumpToTaskList} canEdit={canEditBusinessContent} canCreateTasks={canCreateTasks} canUseMeetings={currentUser.role!=='vessel'} canUseReports={canExportReports} />}
      {tab==='morning' && <MorningWorkspaceView data={data} user={currentUser} visibleVessels={activeVessels} selected={agendaSelection} setSelected={setAgendaSelection} onEditTask={openTask} onAddTask={addTaskForVessel} onOpenVessel={setEditingVesselId} onOpenTemporaryMeeting={()=>setTab('meeting')} onOpenReport={openReportPreview} commit={commit} />}

      {tab==='total' && <ListPanel title={currentUser.role==='vessel'?'本船待辦清單':'總清單'} tasks={filteredTasks} data={data} visibleVessels={activeVessels} filters={filters} setFilters={setFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('船舶記事總清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='work' && <WorkCenter
        data={data}
        user={currentUser}
        vessels={activeVessels}
        onOpenTask={openTask}
        onBatchComplete={batchCompleteTasks}
        onBatchDelete={batchDeleteTasks}
        canComplete={canCloseTasks&&currentUser.role!=='vessel'}
        canDelete={canDeleteTasks}
        markAllRead={()=>commit(draft=>{const at=nowIso();draft.notifications.forEach(item=>{if(item.userId===currentUser.id&&!item.readAt)item.readAt=at;});},'標記通知已讀','notification',currentUser.id,'全部標記已讀')}
      />}
      {tab==='closed' && <ListPanel title="已結案清單" tasks={closedTasks} data={data} visibleVessels={activeVessels} filters={closedFilters} setFilters={setClosedFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('已結案清單')} onBatchComplete={batchCompleteTasks} onBatchDelete={batchDeleteTasks} canEdit={canEditBusinessContent} canPrint={canExportReports} canComplete={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} />}
      {tab==='stats' && <DataAnalysisView data={data} vessels={canViewAllVessels?reportVessels:activeVessels} />}
      {tab==='meeting' && <TemporaryMeetingsPage data={data} visibleVessels={activeVessels} currentUser={currentUser} canExportReports={canExportReports} setData={setData} commit={commit} />}

      {tab==='reports' && <ReportCenter data={data} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} setSelected={setAgendaSelection} commit={commit} onOpenPreview={openReportPreview} onPrint={() => print('早會船舶動態與議程清單')} />}
      {tab==='management' && canEnterManagement && <ManagementView data={data} currentUser={currentUser} commit={commit} />}
    </main>
    {editingVesselId && <VesselEditModal vessel={data.vessels.find(v=>v.id===editingVesselId)} data={data} currentUser={currentUser} close={()=>setEditingVesselId('')} commit={commit} addTask={id=>{if(addTaskForVessel(id,true))setEditingVesselId('');}} editTask={id=>{setEditingVesselId('');setEditingTaskId(id);}} />}
    {(editingTaskId || creatingTask) && <TaskEditModal task={creatingTask || data.tasks.find(t=>t.id===editingTaskId)} creating={Boolean(creatingTask)} data={data} visibleVessels={activeVessels} currentUser={currentUser} canClose={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} canCancelInternalControl={Boolean((creatingTask||data.tasks.find(t=>t.id===editingTaskId))&&canCancelInternalControl(currentUser,data.vessels.find(v=>v.id===(creatingTask||data.tasks.find(t=>t.id===editingTaskId))?.vesselId)!))} readOnly={!creatingTask&&(!canEditBusinessContent||currentUser.role==='vessel')} close={closeTaskEditor} onSave={saveTask} onDelete={()=>{const original=data.tasks.find(task=>task.id===editingTaskId);if(original)deleteTask(original);}} />}
    {reportPreviewOpen && <ReportPreviewModal data={data} visibleVessels={reportVessels} user={currentUser} selected={agendaSelection} close={()=>setReportPreviewOpen(false)} onPrint={printReport} />}
    {currentUser.role!=='vessel'&&!selectedVesselDetailId&&(['dashboard','morning','reports'] as Tab[]).includes(tab) && <div className="selection-dock no-print">涉會船舶 <b className="selected-vessel-count">{agendaSelection.length}</b> 艘 <button className="btn pink small" onClick={()=>setTab('morning')}>進入早會</button><button className="btn primary small" onClick={openReportPreview}>預覽報告</button></div>}
  </div>;
}

function SiteGate({ data, onUnlock }: { data: AppData; onUnlock:()=>void }) {
  const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const unlock=async()=>{ if(await sha256(pw)===data.settings.sitePasswordHash){onUnlock();} else setErr('進站密碼錯誤'); };
  return <div className="login-page"><div className="login-card"><h2>船舶動態系統進站</h2><p className="muted">請輸入管理者設定的進站密碼。</p><div className="field"><label>進站密碼</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') unlock();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" onClick={unlock}>進入系統</button></div></div>;
}
function OwnerSetup({ currentUser, setData, setCurrentUserId }: { currentUser:UserAccount; setData:React.Dispatch<React.SetStateAction<AppData>>; setCurrentUserId:(id:string)=>void }) {
  const [username,setUsername]=useState(currentUser.username); const [pw,setPw]=useState('');
  const create=async()=>{ if(!username.trim()||!pw) return alert('請輸入 Owner 用戶名與新密碼'); const hash=await sha256(pw); setData(prev=>withAudit({...prev, users:prev.users.map(u=>u.id===currentUser.id?{...u,role:'owner',username:username.trim(),passwordHash:hash,passwordVisible:'',updatedAt:nowIso()}:u)}, currentUser, '建立Owner', 'user', currentUser.id, '已驗證使用者初始化為 Owner')); setCurrentUserId(currentUser.id); };
  return <div className="login-page"><div className="login-card"><h2>首次初始化 Owner</h2><p className="muted">已驗證身分：{currentUser.department}｜{currentUser.name}。只能將目前登入者初始化為第一位 Owner。</p><div className="field"><label>Owner 用戶名</label><input value={username} onChange={e=>setUsername(e.target.value)} /></div><div className="field"><label>Owner 新密碼</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} /></div><button className="btn primary" onClick={create}>將目前帳號設為 Owner</button></div></div>;
}
function Login({ data, setCurrentUserId }: { data: AppData; setCurrentUserId:(id:string)=>void }) {
  const activeUsers=data.users.filter(user=>user.isActive);
  const departments=Array.from(new Set(activeUsers.map(user=>user.department || '未指定部門'))).filter(Boolean);
  const [department,setDepartment]=useState(departments[0]||''); const [userId,setUserId]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const people=activeUsers.filter(user=>(user.department || '未指定部門')===department);
  useEffect(()=>{if(!people.some(user=>user.id===userId)){setUserId(people[0]?.id||'');setPw('');setErr('');}},[department,data.revision]);
  const selectedUser=activeUsers.find(user=>user.id===userId);
  const login=async()=>{ const user=activeUsers.find(item=>item.id===userId); if(!user) return setErr('請選擇登入人員'); if(user.passwordHash&&await sha256(pw)!==user.passwordHash) return setErr('密碼錯誤'); setCurrentUserId(user.id); };
  return <div className="login-page"><div className="login-card"><h2>人員登入／切換</h2><p className="muted">請先選擇部門與人員；登入狀態只記錄在此瀏覽器。</p><div className="field"><label>部門</label><select aria-label="登入部門" value={department} onChange={e=>setDepartment(e.target.value)}>{departments.map(item=><option key={item}>{item}</option>)}</select></div><div className="field"><label>人員</label><select aria-label="登入人員" value={userId} onChange={e=>{setUserId(e.target.value);setPw('');setErr('');}}>{people.map(user=><option key={user.id} value={user.id}>{user.name}｜{roleLabel(user.role)}</option>)}</select></div><div className="field"><label>密碼</label><input type="password" value={pw} disabled={!selectedUser?.passwordHash} placeholder={selectedUser?.passwordHash?'請輸入密碼':'此帳號可無密碼登入'} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') login();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" disabled={!selectedUser} onClick={login}>登入</button></div></div>;
}

function ReportCenter({ data, visibleVessels, user, selected, setSelected, commit, onOpenPreview, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; setSelected:(ids:string[])=>void; commit:any; onOpenPreview:()=>void; onPrint:()=>void }) {
  const active=visibleVessels;
  const allowedIds=new Set(active.map(v=>v.id));
  const canViewAllReports=user.role==='owner'||user.role==='admin'||hasPermission(data.settings.rolePermissions,user,'viewAllVessels');
  const reportHistory=data.agendaReports.filter(report=>canViewAllReports||(report.vesselIds.length>0&&report.vesselIds.every(id=>allowedIds.has(id))));
  const reportTasks=data.tasks.filter(t=>taskVesselIds(t).some(id=>allowedIds.has(id)&&selected.includes(id))&&!t.isClosed);
  const toggle=(id:string)=>setSelected(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
  const save=()=>{const vesselIds=selected.filter(id=>allowedIds.has(id));if(!vesselIds.length)return alert('請至少選擇一艘船舶');const id=uid('agenda');commit((d:AppData)=>{d.agendaReports.unshift({id,title:'船舶早會動態暨待辦報告',vesselIds,createdBy:user.id,createdAt:nowIso(),taskCount:reportTasks.length});},'保存報告紀錄','agenda',id,`${vesselIds.length} 艘船`);alert('報告紀錄已保存；日後檢視會依目前最新資料重新產生。');};
  return <section><div className="page-heading"><div><h1>報告中心</h1><p>選擇船舶、保存報告紀錄，預覽後輸出 A4 橫向正式材料。舊紀錄檢視時會套用目前最新資料。</p></div><div className="heading-actions no-print"><button className="btn green" onClick={save}>保存報告紀錄</button><button className="btn ghost" onClick={onPrint}>列印目前頁</button><button className="btn primary" onClick={onOpenPreview}>開啟 PDF 預覽</button></div></div><div className="metric-grid report-metrics"><div className="metric-card pink"><small>已選船舶</small><b>{selected.length}</b><span>艘</span></div><div className="metric-card blue"><small>未結事項</small><b>{reportTasks.length}</b><span>件</span></div><div className="metric-card yellow"><small>急／高關注</small><b>{reportTasks.filter(t=>t.priority==='急'||t.priority==='高').length}</b><span>件</span></div><div className="metric-card mint"><small>已保存紀錄</small><b>{reportHistory.length}</b><span>份</span></div></div><div className="panel no-print"><div className="panel-title"><h2>選擇報告船舶</h2><div><button className="btn small ghost" onClick={()=>setSelected(active.map(v=>v.id))}>全選</button> <button className="btn small ghost" onClick={()=>setSelected([])}>清空</button></div></div><div className="vessel-selector">{active.map(v=><button key={v.id} className={`chip ${selected.includes(v.id)?'on':''}`} onClick={()=>toggle(v.id)}>{vesselDisplayName(v)}</button>)}</div></div><div className="grid cols-2"><div className="panel"><h2>本次報告內容</h2><div className="table-wrap"><table className="compact"><thead><tr><th>船舶</th><th>航線／貨況</th><th>未結事項</th></tr></thead><tbody>{active.filter(v=>selected.includes(v.id)).map(v=><tr key={v.id}><td><b>{vesselDisplayName(v)}</b><br/><span className="muted">{v.shipType || '未填船型'}</span></td><td>{v.position.lastPort} → {v.position.nextPort}<br/>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}</td><td>{data.tasks.filter(t=>taskHasVessel(t,v.id)&&!t.isClosed).length}</td></tr>)}</tbody></table></div></div><div className="panel"><h2>歷次報告紀錄</h2>{reportHistory.length?reportHistory.slice(0,12).map(r=><div className="saved-report" key={r.id}><div><b>{r.title}</b><small>{fmt(r.createdAt)}｜{r.vesselIds.length} 艘｜{r.taskCount} 件</small></div><button className="btn small ghost" onClick={()=>{setSelected(r.vesselIds.filter(id=>allowedIds.has(id)));setTimeout(onOpenPreview,0);}}>以最新資料檢視</button></div>):<div className="empty-state compact">尚無保存紀錄</div>}</div></div></section>;
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
  const reportVesselIds=new Set(vessels.map(v=>v.id));
  const tasks=data.tasks.filter(t=>taskVesselIds(t).some(id=>reportVesselIds.has(id))&&!t.isClosed);
  const crossVesselTasks=tasks.filter(task=>task.vesselScopeMode==='all'||task.vesselScopeMode==='types'||taskVesselIds(task).length>1);
  const singleVesselTasks=tasks.filter(task=>!crossVesselTasks.includes(task));
  return <div className="report-preview-modal" role="dialog" aria-modal="true" aria-labelledby="report-preview-title"><div ref={shellRef} tabIndex={-1} className="report-preview-shell"><div className="report-preview-actions no-print"><h2 id="report-preview-title">PDF 報告預覽</h2><span>A4 橫向</span><div className="spacer"/><button className="btn primary" disabled={!vessels.length} title={!vessels.length?'目前選擇不在授權範圍內':''} onClick={onPrint}>導出／列印 PDF</button><button ref={closeButtonRef} className="btn ghost" onClick={close}>關閉</button></div><article className="report-paper"><header><h1>船舶早會動態暨待辦報告</h1><p>報告日期：{new Date().toLocaleDateString('zh-TW')}　製表：{user.name}　資料版本：rev.{data.revision}</p></header><div className="report-kpis"><div>船舶<br/><b>{vessels.length}</b></div><div>未結事項<br/><b>{tasks.length}</b></div><div>急／高關注<br/><b>{tasks.filter(t=>t.priority==='急'||t.priority==='高').length}</b></div><div>逾期事項<br/><b>{tasks.filter(t=>(daysDiff(t.expectedDate)??0)<0).length}</b></div></div><table><thead><tr><th>船舶／航線</th><th>動態與貨況</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{vessels.map(v=>{const vt=singleVesselTasks.filter(t=>taskHasVessel(t,v.id));return vt.length?vt.map((t,i)=><tr key={`${v.id}-${t.id}`}>{i===0&&<td rowSpan={vt.length}><b>{vesselDisplayName(v)}</b><br/>{v.position.lastPort} → {v.position.nextPort}<br/>{v.position.speedKnots||0} kn</td>}{i===0&&<td rowSpan={vt.length}>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}<br/><b>人工備註：</b>{v.position.manualRemark||'-'}<br/><b>近期／後續動態：</b>{v.note.recentDynamics||'-'}</td>}<td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<br/>{t.description||'-'}</td><td>{t.status||'-'}<br/>{t.departments.join('、')||'未指定部門'}｜{t.expectedDate||'未設定'}</td></tr>):<tr key={v.id}><td><b>{vesselDisplayName(v)}</b><br/>{v.position.lastPort} → {v.position.nextPort}</td><td>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}<br/><b>人工備註：</b>{v.position.manualRemark||'-'}<br/><b>近期／後續動態：</b>{v.note.recentDynamics||'-'}</td><td colSpan={2}>目前無未結事項</td></tr>})}</tbody></table>{crossVesselTasks.length>0&&<><h2>跨船待辦</h2><table><thead><tr><th>船舶</th><th>船種</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{crossVesselTasks.map(t=><tr key={t.id}><td className="task-vessel-scope"><b>{taskVesselLabel(t,vessels)}</b></td><td className="task-type-scope">{taskShipTypeLabel(t,vessels)}</td><td><b>{t.priority}｜{taskCategoryLabel(t)}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<br/>{t.description||'-'}</td><td>{t.status||'-'}<br/>{t.departments.join('、')||'未指定部門'}｜{t.expectedDate||'未設定'}</td></tr>)}</tbody></table></>}<footer>本報告依目前授權範圍、報告選擇及 Supabase／本機最新資料產生。</footer></article></div></div>;
}

function FilterBar({ data, filters, setFilters, fleetTags }: { data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const toggle=(key:keyof FilterState,val:string)=>{ const arr=[...(filters[key] as string[])]; const next=arr.includes(val)?arr.filter(x=>x!==val):[...arr,val]; setFilters({...filters,[key]:next}); };
  return <div className="panel no-print"><div className="grid cols-4"><div className="field"><label>關鍵字</label><input value={filters.keyword} onChange={e=>setFilters({...filters,keyword:e.target.value})} placeholder="船名、事項、狀態..." /></div><div className="field"><label>日期起</label><input type="date" value={filters.fromDate} onChange={e=>setFilters({...filters,fromDate:e.target.value})}/></div><div className="field"><label>日期迄</label><input type="date" value={filters.toDate} onChange={e=>setFilters({...filters,toDate:e.target.value})}/></div><div className="field"><label>經管船舶</label><select value={filters.ownerMode} onChange={e=>setFilters({...filters,ownerMode:e.target.value as any})}><option value="all">全部</option><option value="mine">只看我的經管船舶/事項</option></select></div></div><div className="filters"><b>部門</b>{data.settings.departments.map(d=><button key={d} className={`chip ${filters.departments.includes(d)?'on':''}`} onClick={()=>toggle('departments',d)}>{d}</button>)}</div><div className="filters"><b>船種/船隊</b>{fleetTags.map(f=><button key={f} className={`chip ${filters.fleetTags.includes(f)?'on':''}`} onClick={()=>toggle('fleetTags',f)}>{f}</button>)}</div><div className="filters"><b>關注/分類</b>{data.settings.priorities.map(p=><button key={p} className={`chip ${filters.priorities.includes(p)?'on':''}`} onClick={()=>toggle('priorities',p)}>{p}</button>)}{data.settings.taskCategories.map(c=><button key={c} className={`chip ${filters.categories.includes(c)?'on':''}`} onClick={()=>toggle('categories',c)}>{c}</button>)}<button className={`chip ${filters.internalControlOnly?'on':''}`} onClick={()=>setFilters({...filters,internalControlOnly:!filters.internalControlOnly})}>內部管控</button>{filters.overdueOnly&&<button className="chip on" onClick={()=>setFilters({...filters,overdueOnly:false})}>只看逾期 ×</button>}<button className="btn small ghost" onClick={()=>setFilters(emptyFilters)}>清除篩選</button></div></div>;
}
function ListPanel({ title, tasks, data, visibleVessels, filters, setFilters, fleetTags, userMap, onEdit, onPrint, onBatchComplete, onBatchDelete, canEdit, canPrint, canComplete, canDelete }: { title:string; tasks:TaskItem[]; data:AppData; visibleVessels:Vessel[]; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[]; userMap:Record<string,UserAccount>; onEdit:(t:TaskItem)=>void; onPrint:()=>void; onBatchComplete:(ids:string[])=>boolean; onBatchDelete:(ids:string[])=>boolean; canEdit:boolean; canPrint:boolean; canComplete:boolean; canDelete:boolean }) {
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const selectAllRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{setSelectedIds(previous=>sanitizeTaskSelection(previous,tasks));},[tasks]);
  const selectedSet=new Set(selectedIds);
  const selectedTasks=tasks.filter(task=>selectedSet.has(task.id));
  const openSelectedIds=selectedTasks.filter(task=>!task.isClosed).map(task=>task.id);
  const allSelected=tasks.length>0&&tasks.every(task=>selectedSet.has(task.id));
  useEffect(()=>{if(selectAllRef.current)selectAllRef.current.indeterminate=selectedTasks.length>0&&!allSelected;},[selectedTasks.length,allSelected]);
  const toggleAll=()=>setSelectedIds(allSelected?[]:tasks.map(task=>task.id));
  const toggleOne=(id:string)=>setSelectedIds(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const completeSelected=()=>{if(onBatchComplete(openSelectedIds))setSelectedIds([]);};
  const deleteSelected=()=>{if(onBatchDelete(selectedTasks.map(task=>task.id)))setSelectedIds([]);};
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><section className="panel"><div className="panel-title"><h2>{title} <span className="muted">({tasks.length})</span></h2><div className="heading-actions no-print"><button className="btn small ghost" onClick={toggleAll} disabled={!tasks.length}>{allSelected?'取消全選':'全選目前結果'}</button><span className="batch-selection-count">已選 {selectedTasks.length}</span><button className="btn small green" onClick={completeSelected} disabled={!canComplete||!openSelectedIds.length} title={!canComplete?'目前角色未獲授權批量完成':openSelectedIds.length?'':'所選事項均已結案'}>批量完成（{openSelectedIds.length}）</button><button className="btn small red" onClick={deleteSelected} disabled={!canDelete||!selectedTasks.length} title={!canDelete?'只有 Owner／管理員可以批量刪除':''}>批量刪除（{selectedTasks.length}）</button>{canPrint&&<button className="btn primary" onClick={onPrint}>導出 PDF</button>}</div></div>{tasks.length?<div className="table-wrap"><table className="compact batch-task-table"><thead><tr><th className="no-print batch-select-cell"><input ref={selectAllRef} type="checkbox" aria-label="全選目前結果" checked={allSelected} onChange={toggleAll}/></th><th>船舶</th><th>船種</th><th>關注</th><th>來源</th><th>分類/事項</th><th>部門</th><th>經管人</th><th>期限</th><th>狀態</th><th className="no-print">操作</th></tr></thead><tbody>{tasks.map(t=>{ const vessels=taskVessels(t,visibleVessels); const fleetCategories=Array.from(new Set(vessels.map(v=>v.fleetCategory).filter(Boolean))).join('、'); const diff=daysDiff(t.expectedDate); const managerIds=[...new Set([...t.ownerUserIds,...vessels.flatMap(v=>v.assignedUserIds)])]; return <tr key={t.id} className={selectedSet.has(t.id)?'batch-selected-row':''}><td className="no-print batch-select-cell"><input type="checkbox" aria-label={`選取待辦 ${t.description||t.id}`} checked={selectedSet.has(t.id)} onChange={()=>toggleOne(t.id)}/></td><td className="task-vessel-scope">{taskVesselLabel(t,visibleVessels)}</td><td>{taskShipTypeLabel(t,visibleVessels)}<br/><span className="muted">{t.vesselScopeMode==='all'?'全部':fleetCategories||'-'}</span></td><td><span className={priorityClass(t.priority)}>{t.priority}</span>{t.isInternalControl&&<span className="internal-control-tag">內部管控</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}{t.isAware&&<span className="badge aware">知曉</span>}</td><td><span className={`task-source-badge source-${t.sourceType}`}>{taskSourceLabel(t)}</span></td><td><span className="chip">{taskCategoryLabel(t)}</span><br/>{t.description||'-'}</td><td>{t.departments.map(d=><span className="chip" key={d}>{d}</span>)}</td><td>{managerIds.map(id=>userMap[id]?.name).filter(Boolean).join('、') || '-'}</td><td>{t.expectedDate||'-'}<br/>{!t.isClosed&&diff!==null&&diff<0&&<span className="warn">逾期 {Math.abs(diff)} 天</span>}</td><td>{t.isClosed?<span className="badge closed">已結案 {t.closedDate}</span>:t.status||'-'}<br/><span className="muted">更新：{fmt(t.updatedAt)}</span></td><td className="no-print"><button className="btn small primary" onClick={()=>onEdit(t)}>{canEdit?'更新':'查看'}</button></td></tr>;})}</tbody></table></div>:<div className="empty-state">目前沒有符合條件的事項</div>}</section></>;
}
function Stats({ tasks, data, filters, setFilters, fleetTags }: { tasks:TaskItem[]; data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const total=tasks.length, closed=tasks.filter(t=>t.isClosed).length, open=total-closed, overdue=tasks.filter(t=>!t.isClosed&&(daysDiff(t.expectedDate)??0)<0).length, abnormal=tasks.filter(t=>!t.isClosed&&t.isAbnormal).length;
  const group=(items:string[])=>items.reduce<Record<string,number>>((a,x)=>{a[x]=(a[x]||0)+1;return a;},{});
  const cat=group(tasks.flatMap(t=>taskCategoriesOf(t).length?taskCategoriesOf(t):['未分類'])); const pri=group(tasks.map(t=>t.priority)); const dep=group(tasks.flatMap(t=>t.departments.length?t.departments:['未指定']));
  const Block=({title,obj}:{title:string;obj:Record<string,number>})=><div className="panel"><h3>{title}</h3>{Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v])=><div key={k}><div className="toolbar"><span style={{width:120}}>{k}</span><b>{v}</b></div><div className="bar"><span style={{width:`${Math.max(4,v/Math.max(1,total)*100)}%`}} /></div></div>)}</div>;
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><div className="cards"><div className="stat-card"><span>總事項</span><br/><b>{total}</b></div><div className="stat-card"><span>未結</span><br/><b>{open}</b></div><div className="stat-card"><span>已結案</span><br/><b>{closed}</b></div><div className="stat-card"><span>完成率</span><br/><b>{total?Math.round(closed/total*100):0}%</b></div><div className="stat-card"><span>逾期</span><br/><b>{overdue}</b></div><div className="stat-card"><span>異常存在</span><br/><b>{abnormal}</b></div></div><div className="grid cols-3"><Block title="分類比例" obj={cat}/><Block title="關注程度" obj={pri}/><Block title="部門歸屬" obj={dep}/></div></>;
}
