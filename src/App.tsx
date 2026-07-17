import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import WorkCenter from './WorkCenter';
import { hasPermission } from './permissions';
import { buildTaskNotificationsForVessels, canAccessTab, canCancelInternalControl, canDeleteTask, canUseVessel, validateInternalControlTransition } from './taskWorkflow';

type Tab = 'dashboard' | 'morning' | 'total' | 'reports' | 'stats' | 'management' | 'meeting' | 'closed' | 'work';
const SYSTEM_TITLE = '船舶動態與會議管理系統';
const SYSTEM_SUBTITLE = 'Fleet Activities & Office Meeting Manage System';
const emptyFilters: FilterState = { keyword:'', departments:[], vesselIds:[], fleetTags:[], priorities:[], categories:[], ownerMode:'all', fromDate:'', toDate:'', closedMode:'open', overdueOnly:false, internalControlOnly:false };

function clone<T>(v:T):T { return JSON.parse(JSON.stringify(v)); }
function priorityClass(p?: string) { return p === '急' ? 'badge urgent' : p === '高' ? 'badge high' : p === '中' ? 'badge mid' : 'badge low'; }
function fmt(dt?: string) { return dt ? dt.replace('T',' ').slice(0,16) : '-'; }
function savedStatus(label:string, at?:string) { const d=at?new Date(at):new Date(); return `${label}｜最新保存 ${d.toLocaleString('zh-TW',{hour12:false})}`; }
function cloudIdentity(cfg: { supabaseUrl:string; tableName:string; workspaceKey:string }) { return `${cfg.supabaseUrl}|${cfg.tableName}|${cfg.workspaceKey}`; }
function displayVessel(v?: Vessel) { return v ? `${v.shortName || v.name}｜${v.fullName}` : '-'; }
function vesselMatchesUser(v: Vessel, user: UserAccount | null, canViewAll = false) { return !user || canViewAll || v.assignedUserIds.includes(user.id) || user.managedVesselIds.includes(v.id); }

function taskMatchesFilters(t: TaskItem, filters: FilterState, vesselMap: Record<string,Vessel>, currentUser: UserAccount | null, applyClosedMode: boolean, canViewAll = false) {
  const v = vesselMap[t.vesselId]; if (!v || !v.isActive || !vesselMatchesUser(v,currentUser,canViewAll)) return false;
  if (applyClosedMode && filters.closedMode === 'open' && t.isClosed) return false;
  if (applyClosedMode && filters.closedMode === 'closed' && !t.isClosed) return false;
  if (filters.overdueOnly && (t.isClosed || (daysDiff(t.expectedDate) ?? 0) >= 0)) return false;
  const kw=filters.keyword.trim().toLowerCase();
  if(kw&&![t.description,t.status,t.category,v.name,v.shortName,v.fullName,v.shipType,...t.departments].join(' ').toLowerCase().includes(kw))return false;
  if(filters.departments.length&&!t.departments.some(d=>filters.departments.includes(d)))return false;
  if(filters.vesselIds.length&&!filters.vesselIds.includes(t.vesselId))return false;
  if(filters.fleetTags.length&&!v.fleetTags.some(f=>filters.fleetTags.includes(f)))return false;
  if(filters.priorities.length&&!filters.priorities.includes(t.priority))return false;
  if(filters.categories.length&&!filters.categories.includes(t.category))return false;
  if(filters.internalControlOnly&&!t.isInternalControl)return false;
  if(filters.ownerMode==='mine'&&currentUser&&!t.ownerUserIds.includes(currentUser.id)&&!v.assignedUserIds.includes(currentUser.id))return false;
  const date=(t.updatedAt||t.createdAt).slice(0,10);
  return !(filters.fromDate&&date<filters.fromDate)&&!(filters.toDate&&date>filters.toDate);
}

export default function App() {
  const [data, setData] = useState<AppData>(() => normalizeAppData(loadLocal()) || createInitialData());
  const [siteUnlocked, setSiteUnlocked] = useState(() => sessionStorage.getItem(SESSION_SITE_UNLOCK) === '1');
  const [currentUserId, setCurrentUserId] = useState(() => localStorage.getItem(CURRENT_USER_KEY) || '');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [editingVesselId, setEditingVesselId] = useState<string>('');
  const [editingTaskId, setEditingTaskId] = useState<string>('');
  const [creatingTask, setCreatingTask] = useState<TaskItem | null>(null);
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
        } else if (data.revision > remote.revision) {
          setCloudWriteBlocked(true);
          setCloudStatus(`同步衝突：本機版本 ${data.revision} 高於雲端版本 ${remote.revision}，已禁止覆寫；請先同步最新資料`);
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
  const canViewAllVessels = hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const requireManage = () => { if (!currentUser || !hasPermission(data.settings.rolePermissions, currentUser, 'enterManagement')) { alert('您無權訪問管理頁面'); setTab('dashboard'); return false; } return true; };

  const activeVessels = useMemo(()=>data.vessels.filter(v=>v.isActive&&vesselMatchesUser(v,currentUser,canViewAllVessels)),[data.vessels,currentUser,canViewAllVessels]);
  const unreadNotifications = data.notifications.filter(item=>item.userId===currentUser?.id&&!item.readAt).length;
  useEffect(() => { setAgendaSelection(prev => prev.filter(id => activeVessels.some(v => v.id===id))); }, [activeVessels]);
  useEffect(() => { if (currentUser && !canAccessTab(currentUser, tab)) setTab('dashboard'); }, [currentUser, tab]);
  const vesselMap = useMemo(() => Object.fromEntries(data.vessels.map(v => [v.id, v])), [data.vessels]);
  const userMap = useMemo(() => Object.fromEntries(data.users.map(u => [u.id, u])), [data.users]);
  const fleetTags = useMemo(() => Array.from(new Set(data.vessels.flatMap(v => v.fleetTags))).filter(Boolean), [data.vessels]);

  const filteredTasks = useMemo(() => data.tasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,true,canViewAllVessels)).sort((a,b)=>Number(a.isClosed)-Number(b.isClosed)||(daysDiff(a.expectedDate)??9999)-(daysDiff(b.expectedDate)??9999)),[data.tasks,vesselMap,currentUser,filters,canViewAllVessels]);
  const statsTasks = useMemo(() => data.tasks.filter(t=>taskMatchesFilters(t,filters,vesselMap,currentUser,false,canViewAllVessels)),[data.tasks,vesselMap,currentUser,filters,canViewAllVessels]);

  if (!cloudBootstrapped) return <div className="login-page"><div className="login-card loading-card"><h2>正在載入雲端主資料</h2><p className="muted">請稍候，完成前不會寫入或覆蓋資料。</p></div></div>;
  if (!siteUnlocked) return <SiteGate data={data} onUnlock={() => { sessionStorage.setItem(SESSION_SITE_UNLOCK,'1'); setSiteUnlocked(true); }} />;
  if (!ownerExists && !currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;
  if (!ownerExists && currentUser) return <OwnerSetup currentUser={currentUser} setData={setData} setCurrentUserId={setCurrentUserId} />;
  if (!currentUser) return <Login data={data} setCurrentUserId={setCurrentUserId} />;

  const openTask = (task: TaskItem) => { if (!activeVessels.some(vessel=>vessel.id===task.vesselId)) return alert('無權查看此船舶待辦'); setEditingTaskId(task.id); };
  const addTaskForVessel = (vesselId: string) => {
    if (!requireLogin()) return;
    if (!canCreateTasks) return alert('目前角色未獲授權新增要事');
    if (!currentUser || !canUseVessel(currentUser, vesselId)) return alert('船舶帳戶只能新增本船待辦');
    const id = uid('task');
    setCreatingTask({ id, vesselId, priority:'中', isAware:false, isAbnormal:false, isInternalControl:false, category:data.settings.taskCategories[0] || '人員', description:'', status:'', expectedDate:todayDate(), departments:[], ownerUserIds: currentUser.role==='vessel' ? [] : [currentUser.id], isClosed:false, createdBy:currentUser.id, updatedBy:currentUser.id, createdAt:nowIso(), updatedAt:nowIso(), statusLogs:[] });
  };
  const saveTask = (candidate: TaskItem, creating: boolean) => {
    const vessel=data.vessels.find(item=>item.id===candidate.vesselId);
    if(!currentUser||!vessel||!activeVessels.some(item=>item.id===vessel.id)) { alert('無權存取此船舶'); return false; }
    if(creating&&!canCreateTasks) { alert('目前角色未獲授權新增要事'); return false; }
    if(creating&&!canUseVessel(currentUser,candidate.vesselId)) { alert('船舶帳戶只能新增本船待辦'); return false; }
    if(!creating&&(!canEditBusinessContent||currentUser.role==='vessel')) { alert('船舶帳戶新增後不可修改既有待辦'); return false; }
    const previous=creating?{...candidate,isInternalControl:false}:data.tasks.find(item=>item.id===candidate.id);
    if(!previous) { alert('找不到要更新的事項'); return false; }
    let saved:TaskItem;
    try { saved=validateInternalControlTransition(previous,candidate,currentUser,vessel); }
    catch(error:any){ alert(error.message||String(error)); return false; }
    const cancelled=previous.isInternalControl&&!saved.isInternalControl;
    const kind=creating?'task_created':cancelled?'internal_control_cancelled':'task_updated';
    const noticeVessels=[vessel];
    if(!creating&&previous.vesselId!==saved.vesselId){const oldVessel=data.vessels.find(item=>item.id===previous.vesselId);if(oldVessel)noticeVessels.push(oldVessel);}
    const notices=buildTaskNotificationsForVessels(data.users,noticeVessels,currentUser.id,saved,kind,currentUser.name);
    commit(draft=>{
      if(creating) draft.tasks.unshift(saved); else { const index=draft.tasks.findIndex(item=>item.id===saved.id); if(index>=0) draft.tasks[index]=saved; }
      draft.notifications=[...notices,...draft.notifications].slice(0,1000);
    },creating?'新增事項':cancelled?'取消內部管控':'更新事項','task',saved.id,cancelled?'已提醒至 FLOW 系統申報異常':creating?'建立跟進事項':'保存事項變更');
    return true;
  };
  const deleteTask = (task: TaskItem) => {
    if(!currentUser||!canDeleteTasks||!canDeleteTask(currentUser)) return alert('只有 Owner／管理員可以刪除待辦');
    if(!confirm(`確定刪除待辦「${task.description||task.id}」？此動作會留下操作紀錄。`)) return;
    const vessel=data.vessels.find(item=>item.id===task.vesselId);
    if(!vessel) return alert('找不到對應船舶');
    const notices=buildTaskNotificationsForVessels(data.users,[vessel],currentUser.id,task,'task_deleted',currentUser.name);
    commit(draft=>{draft.tasks=draft.tasks.filter(item=>item.id!==task.id);draft.notifications=[...notices,...draft.notifications].slice(0,1000);},'刪除事項','task',task.id,task.description||task.id);
    setEditingTaskId('');setCreatingTask(null);
  };
  const openReportPreview = () => {
    if (!canExportReports) return alert('目前角色未獲授權預覽或匯出報告');
    if (!agendaSelection.some(id => activeVessels.some(v => v.id === id))) return alert('請至少選擇一艘船舶再預覽報告');
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

  return <div className="app">
    <header className="topbar no-print"><div className="topbar-inner">
      <div className="brand"><span className="brand-icon">🚢</span><span><b>{SYSTEM_TITLE}</b><small>{SYSTEM_SUBTITLE}</small></span></div>
      <nav className="nav">
        {([['dashboard','船隊看板'],['morning','早會工作台'],['meeting','臨時會議'],['work',`我的待辦${unreadNotifications?`（${unreadNotifications}）`:''}`],['total',currentUser.role==='vessel'?'本船待辦':'待辦總表'],['closed','已結案'],['reports','報告中心'],['stats','統計'],['management','管理']] as [Tab,string][]).filter(([k])=>canAccessTab(currentUser, k)&&(k!=='management'||canEnterManagement)).map(([k,label]) => <button key={k} className={tab===k?'active':''} onClick={() => { if (!canAccessTab(currentUser,k)) return; if (k==='management' && !requireManage()) return; setTab(k); }}>{label}</button>)}
      </nav>
      <div className="user-chip"><span className="cloud-dot"/><span>{currentUser.name}｜{roleLabel(currentUser.role)}</span><button className="btn small ghost" onClick={() => setCurrentUserId('')}>切換/退出</button></div>
    </div></header>
    <main className="container">
      <div className="cloud-strip no-print"><span className={getSupabaseConfig()?'ok-note':'danger-note'}>{cloudStatus}</span><span className="spacer"/><button className="btn ghost small" onClick={syncLatest}>同步最新</button><button className="btn green small" onClick={saveChanges}>保存修改</button></div>
      <div className="print-only"><h2>{printTitle || data.settings.systemTitle}</h2><p>列印時間：{new Date().toLocaleString()}｜列印人：{currentUser.name}</p></div>
      {tab==='dashboard' && <DashboardView user={currentUser} vessels={activeVessels} tasks={data.tasks} selected={agendaSelection} setSelected={setAgendaSelection} onEdit={id=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改船舶動態');setEditingVesselId(id);}} onAddTask={addTaskForVessel} onToggleAttention={(vesselId,key)=>{if(!canEditBusinessContent)return alert('目前角色未獲授權修改關注燈');commit(draft=>{const vessel=draft.vessels.find(item=>item.id===vesselId);if(!vessel)return;vessel.weeklyAttention=vessel.weeklyAttention.includes(key)?vessel.weeklyAttention.filter(item=>item!==key):[...vessel.weeklyAttention,key];vessel.updatedAt=nowIso();},'切換一週關注燈','vessel',vesselId,key);}} onStartMeeting={() => { if (!agendaSelection.length) { const priority = activeVessels.filter(v => data.tasks.some(t => t.vesselId===v.id && !t.isClosed && (t.priority==='急'||t.priority==='高'))).slice(0,4).map(v=>v.id); setAgendaSelection(priority.length ? priority : activeVessels.slice(0,4).map(v=>v.id)); } setTab('morning'); }} onOpenReport={openReportPreview} onTaskMetric={jumpToTaskList} canEdit={canEditBusinessContent} canCreateTasks={canCreateTasks} canUseMeetings={currentUser.role!=='vessel'} canUseReports={canExportReports} />}
      {tab==='morning' && <MorningWorkspaceView data={data} user={currentUser} visibleVessels={activeVessels} selected={agendaSelection} setSelected={setAgendaSelection} onEditTask={openTask} onOpenVessel={setEditingVesselId} onOpenTemporaryMeeting={()=>setTab('meeting')} onOpenReport={openReportPreview} commit={commit} />}

      {tab==='total' && <ListPanel title={currentUser.role==='vessel'?'本船待辦清單':'總清單'} tasks={filteredTasks} data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('船舶記事總清單')} canEdit={canEditBusinessContent&&currentUser.role!=='vessel'} canPrint={canExportReports} />}
      {tab==='work' && <WorkCenter
        data={data}
        user={currentUser}
        vessels={activeVessels}
        onOpenTask={openTask}
        markAllRead={()=>commit(draft=>{const at=nowIso();draft.notifications.forEach(item=>{if(item.userId===currentUser.id&&!item.readAt)item.readAt=at;});},'標記通知已讀','notification',currentUser.id,'全部標記已讀')}
      />}
      {tab==='closed' && <ListPanel title="已結案清單" tasks={statsTasks.filter(t=>t.isClosed)} data={data} filters={{...filters,closedMode:'closed'}} setFilters={setFilters} fleetTags={fleetTags} userMap={userMap} onEdit={openTask} onPrint={() => print('已結案清單')} canEdit={canEditBusinessContent} canPrint={canExportReports} />}
      {tab==='stats' && <Stats tasks={statsTasks} data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags} />}
      {tab==='meeting' && <TemporaryMeetingsPage data={data} visibleVessels={activeVessels} currentUser={currentUser} commit={commit} />}

      {tab==='reports' && <ReportCenter data={data} visibleVessels={activeVessels} user={currentUser} selected={agendaSelection} setSelected={setAgendaSelection} commit={commit} onOpenPreview={openReportPreview} onPrint={() => print('早會船舶動態與議程清單')} />}
      {tab==='management' && canEnterManagement && <ManagementView data={data} currentUser={currentUser} commit={commit} />}
    </main>
    {editingVesselId && <VesselEditModal vessel={data.vessels.find(v=>v.id===editingVesselId)} data={data} currentUser={currentUser} close={()=>setEditingVesselId('')} commit={commit} addTask={id=>{setEditingVesselId('');addTaskForVessel(id);}} editTask={id=>{setEditingVesselId('');setEditingTaskId(id);}} />}
    {(editingTaskId || creatingTask) && <TaskEditModal task={creatingTask || data.tasks.find(t=>t.id===editingTaskId)} creating={Boolean(creatingTask)} data={data} visibleVessels={activeVessels} currentUser={currentUser} canClose={canCloseTasks&&currentUser.role!=='vessel'} canDelete={canDeleteTasks} canCancelInternalControl={Boolean((creatingTask||data.tasks.find(t=>t.id===editingTaskId))&&canCancelInternalControl(currentUser,data.vessels.find(v=>v.id===(creatingTask||data.tasks.find(t=>t.id===editingTaskId))?.vesselId)!))} readOnly={!creatingTask&&(!canEditBusinessContent||currentUser.role==='vessel')} close={()=>{setEditingTaskId('');setCreatingTask(null);}} onSave={saveTask} onDelete={()=>{const original=data.tasks.find(task=>task.id===editingTaskId);if(original)deleteTask(original);}} />}
    {reportPreviewOpen && <ReportPreviewModal data={data} visibleVessels={activeVessels} user={currentUser} selected={agendaSelection} close={()=>setReportPreviewOpen(false)} onPrint={printReport} />}
    {currentUser.role!=='vessel'&&(['dashboard','morning','reports'] as Tab[]).includes(tab) && <div className="selection-dock no-print">涉會船舶 <b className="selected-vessel-count">{agendaSelection.length}</b> 艘 <button className="btn pink small" onClick={()=>setTab('morning')}>進入早會</button><button className="btn primary small" onClick={openReportPreview}>預覽報告</button></div>}
  </div>;
}

function SiteGate({ data, onUnlock }: { data: AppData; onUnlock:()=>void }) {
  const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const unlock=async()=>{ if(await sha256(pw)===data.settings.sitePasswordHash){onUnlock();} else setErr('進站密碼錯誤'); };
  return <div className="login-page"><div className="login-card"><h2>船舶動態系統進站</h2><p className="muted">請輸入管理者設定的進站密碼。</p><div className="field"><label>進站密碼</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') unlock();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" onClick={unlock}>進入系統</button></div></div>;
}
function OwnerSetup({ currentUser, setData, setCurrentUserId }: { currentUser:UserAccount; setData:React.Dispatch<React.SetStateAction<AppData>>; setCurrentUserId:(id:string)=>void }) {
  const [username,setUsername]=useState(currentUser.username); const [pw,setPw]=useState('');
  const create=async()=>{ if(!username.trim()||!pw) return alert('請輸入 Owner 用戶名與新密碼'); const hash=await sha256(pw); setData(prev=>withAudit({...prev, users:prev.users.map(u=>u.id===currentUser.id?{...u,role:'owner',username:username.trim(),passwordHash:hash,updatedAt:nowIso()}:u)}, currentUser, '建立Owner', 'user', currentUser.id, '已驗證使用者初始化為 Owner')); setCurrentUserId(currentUser.id); };
  return <div className="login-page"><div className="login-card"><h2>首次初始化 Owner</h2><p className="muted">已驗證身分：{currentUser.department}｜{currentUser.name}。只能將目前登入者初始化為第一位 Owner。</p><div className="field"><label>Owner 用戶名</label><input value={username} onChange={e=>setUsername(e.target.value)} /></div><div className="field"><label>Owner 新密碼</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} /></div><button className="btn primary" onClick={create}>將目前帳號設為 Owner</button></div></div>;
}
function Login({ data, setCurrentUserId }: { data: AppData; setCurrentUserId:(id:string)=>void }) {
  const [username,setUsername]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState('');
  const login=async()=>{ const user=data.users.find(u=>u.isActive && (u.username===username || u.name===username)); if(!user) return setErr('找不到用戶'); if(await sha256(pw)!==user.passwordHash) return setErr('密碼錯誤'); setCurrentUserId(user.id); };
  return <div className="login-page"><div className="login-card"><h2>用戶登入 / 切換</h2><p className="muted">請使用個人帳號密碼登入；登入狀態只記錄在此瀏覽器。</p><div className="field"><label>用戶名或姓名</label><input value={username} onChange={e=>setUsername(e.target.value)} /></div><div className="field"><label>密碼</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') login();}} /></div>{err&&<p className="warn">{err}</p>}<button className="btn primary" onClick={login}>登入</button></div></div>;
}

function ReportCenter({ data, visibleVessels, user, selected, setSelected, commit, onOpenPreview, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; setSelected:(ids:string[])=>void; commit:any; onOpenPreview:()=>void; onPrint:()=>void }) {
  const active=visibleVessels;
  const allowedIds=new Set(active.map(v=>v.id));
  const reportTasks=data.tasks.filter(t=>allowedIds.has(t.vesselId)&&selected.includes(t.vesselId)&&!t.isClosed);
  const toggle=(id:string)=>setSelected(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
  const save=()=>{const vesselIds=selected.filter(id=>allowedIds.has(id));if(!vesselIds.length)return alert('請至少選擇一艘船舶');const id=uid('agenda');commit((d:AppData)=>{d.agendaReports.unshift({id,title:'船舶早會動態暨待辦報告',vesselIds,createdBy:user.id,createdAt:nowIso(),taskCount:reportTasks.length});},'保存報告紀錄','agenda',id,`${vesselIds.length} 艘船`);alert('報告紀錄已保存；日後檢視會依目前最新資料重新產生。');};
  return <section><div className="page-heading"><div><h1>報告中心</h1><p>選擇船舶、保存報告紀錄，預覽後輸出 A4 橫向正式材料。舊紀錄檢視時會套用目前最新資料。</p></div><div className="heading-actions no-print"><button className="btn green" onClick={save}>保存報告紀錄</button><button className="btn ghost" onClick={onPrint}>列印目前頁</button><button className="btn primary" onClick={onOpenPreview}>開啟 PDF 預覽</button></div></div><div className="metric-grid report-metrics"><div className="metric-card pink"><small>已選船舶</small><b>{selected.length}</b><span>艘</span></div><div className="metric-card blue"><small>未結事項</small><b>{reportTasks.length}</b><span>件</span></div><div className="metric-card yellow"><small>急／高關注</small><b>{reportTasks.filter(t=>t.priority==='急'||t.priority==='高').length}</b><span>件</span></div><div className="metric-card mint"><small>已保存紀錄</small><b>{data.agendaReports.length}</b><span>份</span></div></div><div className="panel no-print"><div className="panel-title"><h2>選擇報告船舶</h2><div><button className="btn small ghost" onClick={()=>setSelected(active.map(v=>v.id))}>全選</button> <button className="btn small ghost" onClick={()=>setSelected([])}>清空</button></div></div><div className="vessel-selector">{active.map(v=><button key={v.id} className={`chip ${selected.includes(v.id)?'on':''}`} onClick={()=>toggle(v.id)}>{v.shortName}</button>)}</div></div><div className="grid cols-2"><div className="panel"><h2>本次報告內容</h2><div className="table-wrap"><table className="compact"><thead><tr><th>船舶</th><th>航線／貨況</th><th>未結事項</th></tr></thead><tbody>{active.filter(v=>selected.includes(v.id)).map(v=><tr key={v.id}><td><b>{v.shortName}</b><br/><span className="muted">{v.fullName}</span></td><td>{v.position.lastPort} → {v.position.nextPort}<br/>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}</td><td>{data.tasks.filter(t=>t.vesselId===v.id&&!t.isClosed).length}</td></tr>)}</tbody></table></div></div><div className="panel"><h2>歷次報告紀錄</h2>{data.agendaReports.length?data.agendaReports.slice(0,12).map(r=><div className="saved-report" key={r.id}><div><b>{r.title}</b><small>{fmt(r.createdAt)}｜{r.vesselIds.length} 艘｜{r.taskCount} 件</small></div><button className="btn small ghost" onClick={()=>{setSelected(r.vesselIds.filter(id=>allowedIds.has(id)));setTimeout(onOpenPreview,0);}}>以最新資料檢視</button></div>):<div className="empty-state compact">尚無保存紀錄</div>}</div></div></section>;
}

function ReportPreviewModal({ data, visibleVessels, user, selected, close, onPrint }: { data:AppData; visibleVessels:Vessel[]; user:UserAccount; selected:string[]; close:()=>void; onPrint:()=>void }) {
  const vessels=visibleVessels.filter(v=>selected.includes(v.id));
  const allowedIds=new Set(vessels.map(v=>v.id));
  const tasks=data.tasks.filter(t=>allowedIds.has(t.vesselId)&&!t.isClosed);
  return <div className="report-preview-modal"><div className="report-preview-shell"><div className="report-preview-actions no-print"><h2>PDF 報告預覽</h2><span>A4 橫向</span><div className="spacer"/><button className="btn primary" onClick={onPrint}>導出／列印 PDF</button><button className="btn ghost" onClick={close}>關閉</button></div><article className="report-paper"><header><h1>船舶早會動態暨待辦報告</h1><p>報告日期：{new Date().toLocaleDateString('zh-TW')}　製表：{user.name}　資料版本：rev.{data.revision}</p></header><div className="report-kpis"><div>船舶<br/><b>{vessels.length}</b></div><div>未結事項<br/><b>{tasks.length}</b></div><div>急／高關注<br/><b>{tasks.filter(t=>t.priority==='急'||t.priority==='高').length}</b></div><div>逾期事項<br/><b>{tasks.filter(t=>(daysDiff(t.expectedDate)??0)<0).length}</b></div></div><table><thead><tr><th>船舶／航線</th><th>動態與貨況</th><th>未結事項</th><th>狀態／部門／期限</th></tr></thead><tbody>{vessels.map(v=>{const vt=tasks.filter(t=>t.vesselId===v.id);return vt.length?vt.map((t,i)=><tr key={t.id}>{i===0&&<td rowSpan={vt.length}><b>{v.shortName}</b><br/>{v.position.lastPort} → {v.position.nextPort}<br/>{v.position.speedKnots||0} kn</td>}{i===0&&<td rowSpan={vt.length}>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}<br/>{v.note.recentDynamics||v.position.manualRemark||'-'}</td>}<td><b>{t.priority}｜{t.category}</b>{t.isAbnormal&&<span className="badge urgent">異常</span>}<br/>{t.description||'-'}</td><td>{t.status||'-'}<br/>{t.departments.join('、')||'未指定部門'}｜{t.expectedDate||'未設定'}</td></tr>):<tr key={v.id}><td><b>{v.shortName}</b><br/>{v.position.lastPort} → {v.position.nextPort}</td><td>{v.cargo.loadStatus}｜{v.cargo.items.map(item=>`${item.name} ${item.quantity}`.trim()).filter(Boolean).join('、')||'TBA'}<br/>{v.note.recentDynamics||'-'}</td><td colSpan={2}>目前無未結事項</td></tr>})}</tbody></table><footer>本報告依所選船舶及 Supabase／本機最新資料產生。</footer></article></div></div>;
}

function FilterBar({ data, filters, setFilters, fleetTags }: { data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const toggle=(key:keyof FilterState,val:string)=>{ const arr=[...(filters[key] as string[])]; const next=arr.includes(val)?arr.filter(x=>x!==val):[...arr,val]; setFilters({...filters,[key]:next}); };
  return <div className="panel no-print"><div className="grid cols-4"><div className="field"><label>關鍵字</label><input value={filters.keyword} onChange={e=>setFilters({...filters,keyword:e.target.value})} placeholder="船名、事項、狀態..." /></div><div className="field"><label>日期起</label><input type="date" value={filters.fromDate} onChange={e=>setFilters({...filters,fromDate:e.target.value})}/></div><div className="field"><label>日期迄</label><input type="date" value={filters.toDate} onChange={e=>setFilters({...filters,toDate:e.target.value})}/></div><div className="field"><label>經管船舶</label><select value={filters.ownerMode} onChange={e=>setFilters({...filters,ownerMode:e.target.value as any})}><option value="all">全部</option><option value="mine">只看我的經管船舶/事項</option></select></div></div><div className="filters"><b>部門</b>{data.settings.departments.map(d=><button key={d} className={`chip ${filters.departments.includes(d)?'on':''}`} onClick={()=>toggle('departments',d)}>{d}</button>)}</div><div className="filters"><b>船種/船隊</b>{fleetTags.map(f=><button key={f} className={`chip ${filters.fleetTags.includes(f)?'on':''}`} onClick={()=>toggle('fleetTags',f)}>{f}</button>)}</div><div className="filters"><b>關注/分類</b>{data.settings.priorities.map(p=><button key={p} className={`chip ${filters.priorities.includes(p)?'on':''}`} onClick={()=>toggle('priorities',p)}>{p}</button>)}{data.settings.taskCategories.map(c=><button key={c} className={`chip ${filters.categories.includes(c)?'on':''}`} onClick={()=>toggle('categories',c)}>{c}</button>)}<button className={`chip ${filters.internalControlOnly?'on':''}`} onClick={()=>setFilters({...filters,internalControlOnly:!filters.internalControlOnly})}>內部管控</button>{filters.overdueOnly&&<button className="chip on" onClick={()=>setFilters({...filters,overdueOnly:false})}>只看逾期 ×</button>}<button className="btn small ghost" onClick={()=>setFilters(emptyFilters)}>清除篩選</button></div></div>;
}
function ListPanel({ title, tasks, data, filters, setFilters, fleetTags, userMap, onEdit, onPrint, canEdit, canPrint }: { title:string; tasks:TaskItem[]; data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[]; userMap:Record<string,UserAccount>; onEdit:(t:TaskItem)=>void; onPrint:()=>void; canEdit:boolean; canPrint:boolean }) {
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><section className="panel"><div className="panel-title"><h2>{title} <span className="muted">({tasks.length})</span></h2>{canPrint&&<button className="btn primary no-print" onClick={onPrint}>導出 PDF</button>}</div>{tasks.length?<div className="table-wrap"><table className="compact"><thead><tr><th>船舶</th><th>船種</th><th>關注</th><th>分類/事項</th><th>部門</th><th>經管人</th><th>期限</th><th>狀態</th><th className="no-print">操作</th></tr></thead><tbody>{tasks.map(t=>{ const v=data.vessels.find(x=>x.id===t.vesselId); const diff=daysDiff(t.expectedDate); return <tr key={t.id}><td>{displayVessel(v)}</td><td>{v?.shipType}<br/><span className="muted">{v?.fleetCategory}</span></td><td><span className={priorityClass(t.priority)}>{t.priority}</span>{t.isInternalControl&&<span className="internal-control-tag">內部管控</span>}{t.isAbnormal&&<span className="badge urgent">異常</span>}{t.isAware&&<span className="badge aware">知曉</span>}</td><td><span className="chip">{t.category}</span><br/>{t.description||'-'}</td><td>{t.departments.map(d=><span className="chip" key={d}>{d}</span>)}</td><td>{[...new Set([...t.ownerUserIds, ...(v?.assignedUserIds||[])])].map(id=>userMap[id]?.name).filter(Boolean).join('、') || '-'}</td><td>{t.expectedDate||'-'}<br/>{!t.isClosed&&diff!==null&&diff<0&&<span className="warn">逾期 {Math.abs(diff)} 天</span>}</td><td>{t.isClosed?<span className="badge closed">已結案 {t.closedDate}</span>:t.status||'-'}<br/><span className="muted">更新：{fmt(t.updatedAt)}</span></td><td className="no-print"><button className="btn small primary" onClick={()=>onEdit(t)}>{canEdit?'更新':'查看'}</button></td></tr>;})}</tbody></table></div>:<div className="empty-state">目前沒有符合條件的事項</div>}</section></>;
}
function Stats({ tasks, data, filters, setFilters, fleetTags }: { tasks:TaskItem[]; data:AppData; filters:FilterState; setFilters:(f:FilterState)=>void; fleetTags:string[] }) {
  const total=tasks.length, closed=tasks.filter(t=>t.isClosed).length, open=total-closed, overdue=tasks.filter(t=>!t.isClosed&&(daysDiff(t.expectedDate)??0)<0).length, abnormal=tasks.filter(t=>!t.isClosed&&t.isAbnormal).length;
  const group=(items:string[])=>items.reduce<Record<string,number>>((a,x)=>{a[x]=(a[x]||0)+1;return a;},{});
  const cat=group(tasks.map(t=>t.category||'未分類')); const pri=group(tasks.map(t=>t.priority)); const dep=group(tasks.flatMap(t=>t.departments.length?t.departments:['未指定']));
  const Block=({title,obj}:{title:string;obj:Record<string,number>})=><div className="panel"><h3>{title}</h3>{Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v])=><div key={k}><div className="toolbar"><span style={{width:120}}>{k}</span><b>{v}</b></div><div className="bar"><span style={{width:`${Math.max(4,v/Math.max(1,total)*100)}%`}} /></div></div>)}</div>;
  return <><FilterBar data={data} filters={filters} setFilters={setFilters} fleetTags={fleetTags}/><div className="cards"><div className="stat-card"><span>總事項</span><br/><b>{total}</b></div><div className="stat-card"><span>未結</span><br/><b>{open}</b></div><div className="stat-card"><span>已結案</span><br/><b>{closed}</b></div><div className="stat-card"><span>完成率</span><br/><b>{total?Math.round(closed/total*100):0}%</b></div><div className="stat-card"><span>逾期</span><br/><b>{overdue}</b></div><div className="stat-card"><span>異常存在</span><br/><b>{abnormal}</b></div></div><div className="grid cols-3"><Block title="分類比例" obj={cat}/><Block title="關注程度" obj={pri}/><Block title="部門歸屬" obj={dep}/></div></>;
}
