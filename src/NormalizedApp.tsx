import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import fpmcLogo from './assets/fpmc-logo.png';
import type {
  AppData,
  InternalControlCase,
  TaskItem,
  UserAccount,
  Vessel,
  WeeklyAttentionKey,
} from './types';
import type { LoginDirectoryPerson } from './normalizedAuth';
import {
  NormalizedApplicationRuntime,
  type NormalizedRuntimeView,
} from './normalizedRuntime';
import {
  NormalizedUiController,
  reconcileNormalizedDraftEnvelopes,
} from './normalizedUiController';
import DashboardView from './Dashboard';
import MorningWorkspaceView from './MorningWorkspace';
import WorkCenter from './WorkCenter';
import DataAnalysisView from './DataAnalysis';
import VesselDetailPage from './VesselDetailPage';
import InternalControlPage from './InternalControlPage';
import NormalizedMeetings from './NormalizedMeetings';
import NormalizedManagement from './NormalizedManagement';
import { TaskEditModal } from './EditModals';
import { canAccessAllVessels, hasPermission } from './permissions';
import { taskHasVessel, taskVesselIds } from './taskVesselScope';
import { hasActiveVesselDelegation } from './vesselDelegation';
import { dashboardMeetingAlerts } from './meetingVesselAttention';
import { todayDate } from './runtimeUtils';
import RichTextContent from './RichTextContent';
import { vesselPositionCommandValue } from './normalizedAdapters';
import type { NormalizedApplicationProjection } from './normalizedProjection';
import {
  cleanupNormalizedTaskEditorDraft,
  createNormalizedAuthorizationEpoch,
  openNormalizedTaskEditor,
  resolveAuthorizedTaskEditor,
  type NormalizedTaskEditorSession,
} from './normalizedAuthorizationUi';

type Tab = 'dashboard' | 'morning' | 'work' | 'tasks' | 'closed'
  | 'internal' | 'meetings' | 'reports' | 'stats' | 'management';

const EMPTY_RUNTIME_VIEW: NormalizedRuntimeView = Object.freeze({
  projection: null,
  authorizationGeneration: 0,
  projectionGeneration: 0,
});
const subscribeToNothing = () => () => undefined;
const emptyRuntimeView = () => EMPTY_RUNTIME_VIEW;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '伺服器拒絕此操作。';
}

function taskEditorAuthorization(
  projection: NormalizedApplicationProjection | null,
  authorizationGeneration: number,
) {
  if (!projection) return null;
  const { data, actor: user } = projection;
  const permission = (key: Parameters<typeof hasPermission>[2]) => (
    hasPermission(data.settings.rolePermissions, user, key)
  );
  const viewAll = canAccessAllVessels(data.settings.rolePermissions, user, data.vessels);
  const visibleVessels = data.vessels.filter(vessel => vessel.isActive && (
    projection.vesselAccount
    || viewAll
    || vessel.assignedUserIds.includes(user.id)
    || user.managedVesselIds.includes(vessel.id)
    || hasActiveVesselDelegation(vessel, user.id)
  ));
  const visibleVesselIds = new Set(visibleVessels.map(vessel => vessel.id));
  const visibleTasks = data.tasks.filter(task => (
    taskVesselIds(task).some(id => visibleVesselIds.has(id))
    || task.ownerUserIds.includes(user.id)
  ));
  const permissionBits = (['editBusinessContent', 'createTasks', 'closeTasks', 'deleteTasks'] as const)
    .map(key => permission(key) ? '1' : '0')
    .join('');
  return {
    authorizationEpoch: createNormalizedAuthorizationEpoch({
      authorizationGeneration,
      actorId: user.id,
      role: user.role,
      permissionBits,
      vesselIds: visibleVessels.map(vessel => vessel.id),
    }),
    visibleTasks,
    visibleVesselIds,
    canCreate: !projection.vesselAccount && permission('createTasks'),
  };
}

function newTask(user: UserAccount, vesselId: string): TaskItem {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    vesselId,
    vesselIds: [vesselId],
    priority: '中',
    isAware: false,
    isAbnormal: false,
    isInternalControl: false,
    sourceType: 'morning',
    category: '',
    categories: [],
    description: '',
    status: '',
    expectedDate: '',
    reportDate: todayDate(),
    departments: [],
    ownerUserIds: user.role === 'vessel' ? [] : [user.id],
    isClosed: false,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: at,
    updatedAt: at,
    statusLogs: [],
  };
}

function ActivationLock({
  runtime,
  onActivated,
  onSignOut,
}: {
  runtime: NormalizedApplicationRuntime;
  onActivated: () => void;
  onSignOut: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <main className="auth-shell">
    <section className="auth-card">
      <img src={fpmcLogo} alt="FPMC"/>
      <h1>啟用個人密碼</h1>
      <p>完成前，系統功能已鎖定。新密碼會由 Supabase Auth 管理，不會保存於瀏覽器資料。</p>
      <label>新密碼
        <input type="password" autoComplete="new-password" value={password}
          onChange={event => setPassword(event.target.value)}/>
      </label>
      <label>再次輸入
        <input type="password" autoComplete="new-password" value={confirmPassword}
          onChange={event => setConfirmPassword(event.target.value)}/>
      </label>
      {error && <div className="error-banner">{error}</div>}
      <button className="btn primary" disabled={busy} onClick={async () => {
        if (password.length < 12) return setError('密碼至少需要 12 個字元。');
        if (password !== confirmPassword) return setError('兩次輸入的密碼不一致。');
        setBusy(true);
        setError('');
        try {
          await runtime.activatePersonalPassword(password);
          onActivated();
        } catch (caught) {
          setError(messageOf(caught));
        } finally {
          setBusy(false);
        }
      }}>{busy ? '啟用中…' : '啟用並進入系統'}</button>
      <button className="btn ghost" disabled={busy} onClick={onSignOut}>登出</button>
    </section>
  </main>;
}

function GateAndLogin({
  runtime,
  directory,
  onDirectory,
  onSignedIn,
}: {
  runtime: NormalizedApplicationRuntime;
  directory: LoginDirectoryPerson[] | null;
  onDirectory: (people: LoginDirectoryPerson[]) => void;
  onSignedIn: () => void;
}) {
  const [sitePassword, setSitePassword] = useState('');
  const [department, setDepartment] = useState('');
  const [personAlias, setPersonAlias] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const departments = Array.from(new Set((directory || []).map(person => person.department)));
  const people = (directory || []).filter(person => !department || person.department === department);
  const selected = people.find(person => person.authAlias === personAlias);
  const passwordRequired = selected?.loginMode !== 'passwordless';
  if (!directory) {
    return <main className="auth-shell"><section className="auth-card">
      <img src={fpmcLogo} alt="FPMC"/>
      <h1>船舶動態與會議管理系統</h1>
      <p>請先通過網站入口驗證。</p>
      <label>網站入口密碼
        <input type="password" autoFocus value={sitePassword}
          onChange={event => setSitePassword(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && event.currentTarget.form?.requestSubmit()}/>
      </label>
      {error && <div className="error-banner">{error}</div>}
      <button className="btn primary" disabled={busy || !sitePassword} onClick={async () => {
        setBusy(true);
        setError('');
        try {
          await runtime.unlockSite(sitePassword);
          onDirectory(await runtime.getLoginDirectory());
        } catch (caught) {
          setError(messageOf(caught));
        } finally {
          setBusy(false);
        }
      }}>{busy ? '驗證中…' : '進入人員目錄'}</button>
    </section></main>;
  }
  return <main className="auth-shell"><section className="auth-card">
    <img src={fpmcLogo} alt="FPMC"/>
    <h1>人員登入</h1>
    <p>Owner使用Supabase個人密碼；其他人維持原有密碼或免密碼登入方式。</p>
    <label>部門
      <select value={department} onChange={event => {
        setDepartment(event.target.value);
        setPersonAlias('');
      }}><option value="">請選擇部門</option>{departments.map(value =>
        <option key={value}>{value}</option>)}</select>
    </label>
    <label>人員
      <select value={personAlias} disabled={!department}
        onChange={event => {
          setPersonAlias(event.target.value);
          setPassword('');
        }}>
        <option value="">請選擇人員</option>
        {people.map(person => <option key={person.authAlias} value={person.authAlias}>
          {person.displayName}｜{person.usernameLabel}
        </option>)}
      </select>
    </label>
    <label>{selected?.loginMode === 'passwordless' ? '免密碼登入' : '個人密碼'}
      <input type="password" autoComplete="current-password" value={password}
        disabled={selected?.loginMode === 'passwordless'}
        placeholder={selected?.loginMode === 'passwordless' ? '此帳號不需要個人密碼' : '請輸入密碼'}
        onChange={event => setPassword(event.target.value)}/>
    </label>
    {error && <div className="error-banner">{error}</div>}
    <button className="btn primary" disabled={busy || !selected || (passwordRequired && !password)}
      onClick={async () => {
        if (!selected) return;
        setBusy(true);
        setError('');
        try {
          await runtime.signIn(selected, password);
          onSignedIn();
        } catch (caught) {
          setError(messageOf(caught));
        } finally {
          setBusy(false);
        }
      }}>{busy ? '登入中…' : selected?.loginMode === 'passwordless' ? '免密碼登入' : '登入'}</button>
    <button className="btn ghost" disabled={busy} onClick={() => {
      runtime.auth.clearGateToken();
      onDirectory([]);
      location.reload();
    }}>返回入口驗證</button>
  </section></main>;
}

function VesselEditor({
  vessel,
  data,
  close,
  save,
}: {
  vessel: Vessel;
  data: AppData;
  close: () => void;
  save: (candidate: Vessel) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(vessel));
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<Vessel>) => setDraft(previous => ({ ...previous, ...patch }));
  return <div className="modal-backdrop"><section className="modal large" role="dialog" aria-modal="true">
    <div className="modal-head"><div><h2>快速更新｜{draft.shortName || draft.name}</h2>
      <p>在本視窗完成編輯後一次提交；離線時只保存個人草稿。</p></div>
      <button className="icon-btn" onClick={close}>×</button></div>
    <div className="form-grid">
      <label>目前位置<input value={draft.position.location}
        onChange={event => change({ position: { ...draft.position, source: 'manual', location: event.target.value } })}/></label>
      <label>航行狀態<select value={draft.position.navigationStatus}
        onChange={event => change({ position: { ...draft.position, source: 'manual', navigationStatus: event.target.value as Vessel['position']['navigationStatus'] } })}>
        {['航行', '拋錨', '進港中', '出港中', '停泊', '漂航'].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>上一港<input value={draft.position.lastPort}
        onChange={event => change({ position: { ...draft.position, source: 'manual', lastPort: event.target.value } })}/></label>
      <label>下一港<input value={draft.position.nextPort}
        onChange={event => change({ position: { ...draft.position, source: 'manual', nextPort: event.target.value } })}/></label>
      <label>航速（kn）<input type="number" min="0" step="0.1" value={draft.position.speedKnots}
        onChange={event => change({ position: { ...draft.position, source: 'manual', speedKnots: Number(event.target.value) } })}/></label>
      {(['eta', 'etb', 'etd'] as const).map(field => <label key={field}>{field.toUpperCase()}
        <input type="datetime-local" value={draft.position[field]?.slice(0, 16) || ''}
          onChange={event => change({ position: { ...draft.position, source: 'manual', [field]: event.target.value } })}/>
      </label>)}
      <label>載況<select value={draft.cargo.loadStatus}
        onChange={event => change({ cargo: { ...draft.cargo, source: 'manual', loadStatus: event.target.value as Vessel['cargo']['loadStatus'] } })}>
        {['空載', '非空載', '滿載'].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>貨名<input value={draft.cargo.name}
        onChange={event => change({ cargo: { ...draft.cargo, source: 'manual', name: event.target.value } })}/></label>
      <label>貨量<input value={draft.cargo.quantity}
        onChange={event => change({ cargo: { ...draft.cargo, source: 'manual', quantity: event.target.value } })}/></label>
      <label className="span-2">人工備註<textarea value={draft.position.manualRemark}
        onChange={event => change({ position: { ...draft.position, source: 'manual', manualRemark: event.target.value } })}/></label>
      <label className="span-2">近期／後續動態<textarea value={draft.note.recentDynamics}
        onChange={event => change({ note: { ...draft.note, recentDynamics: event.target.value } })}/></label>
      <fieldset className="span-2"><legend>船舶狀態</legend><div className="checkbox-grid">
        {data.settings.vesselStatuses.map(status => <label key={status}><input type="checkbox"
          checked={draft.note.statusList.includes(status)}
          onChange={() => change({ note: {
            ...draft.note,
            statusList: draft.note.statusList.includes(status)
              ? draft.note.statusList.filter(value => value !== status)
              : [...draft.note.statusList, status],
          } })}/>{status}</label>)}
      </div></fieldset>
    </div>
    <div className="modal-actions"><button className="btn ghost" onClick={close}>取消</button>
      <button className="btn primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { if (await save(draft)) close(); } finally { setBusy(false); }
      }}>{busy ? '提交中…' : '儲存'}</button></div>
  </section></div>;
}

function TaskList({
  data,
  vessels,
  closed,
  onOpen,
}: {
  data: AppData;
  vessels: Vessel[];
  closed: boolean;
  onOpen: (task: TaskItem) => void;
}) {
  const vesselIds = new Set(vessels.map(vessel => vessel.id));
  const tasks = data.tasks.filter(task =>
    task.isClosed === closed && taskVesselIds(task).some(id => vesselIds.has(id)));
  return <section>
    <div className="page-heading"><div><h1>{closed ? '已結案待辦' : '全部未結待辦'}</h1>
      <p>資料由歸一化實體投影即時讀取。</p></div></div>
    <section className="panel"><div className="table-wrap"><table className="compact"><thead><tr>
      <th>關注</th><th>船舶</th><th>內容</th><th>部門／期限</th><th>最新狀態</th><th>操作</th>
    </tr></thead><tbody>{tasks.map(task => <tr key={task.id}>
      <td><span className="badge">{task.priority}</span></td>
      <td>{taskVesselIds(task).map(id => vessels.find(vessel => vessel.id === id)?.shortName || id).join('、')}</td>
      <td><RichTextContent compact value={task.description}/></td>
      <td>{task.departments.join('、')}<small>{task.expectedDate || '未設定'}</small></td>
      <td><RichTextContent compact value={task.status} fallback="尚未更新"/></td>
      <td><button className="btn small primary" onClick={() => onOpen(task)}>查看／編輯</button></td>
    </tr>)}</tbody></table></div>{!tasks.length && <div className="empty-state">目前沒有資料</div>}</section>
  </section>;
}

function ReportsView({ data, vessels }: { data: AppData; vessels: Vessel[] }) {
  return <section><div className="page-heading"><div><h1>報表與保存紀錄</h1>
    <p>報表內容只從目前授權的伺服器投影產生。</p></div>
    <button className="btn primary" onClick={() => window.print()}>列印目前報表</button></div>
    <section className="panel"><h2>船舶摘要</h2>
      <div className="table-wrap"><table><thead><tr><th>船舶</th><th>位置</th><th>動態</th><th>未結待辦</th></tr></thead>
        <tbody>{vessels.map(vessel => <tr key={vessel.id}><td>{vessel.shortName || vessel.name}</td>
          <td>{vessel.position.location}</td><td>{vessel.note.recentDynamics}</td>
          <td>{data.tasks.filter(task => !task.isClosed && taskHasVessel(task, vessel.id)).length}</td></tr>)}</tbody>
      </table></div></section>
    <section className="panel"><h2>已保存報表</h2>
      {data.agendaReports.map(report => <div className="report-history-row" key={report.id}>
        <b>{report.title}</b><span>{report.createdAt.replace('T', ' ').slice(0, 16)}｜{report.taskCount} 項</span>
      </div>)}
      {!data.agendaReports.length && <div className="empty-state">尚未保存報表</div>}
    </section>
  </section>;
}

export default function NormalizedApp() {
  const runtimeRef = useRef<NormalizedApplicationRuntime | null>(null);
  const controllerRef = useRef<NormalizedUiController | null>(null);
  const [configurationError, setConfigurationError] = useState('');
  if (!runtimeRef.current && !configurationError) {
    try {
      runtimeRef.current = new NormalizedApplicationRuntime();
      controllerRef.current = new NormalizedUiController(runtimeRef.current);
    } catch (error) {
      setConfigurationError(messageOf(error));
    }
  }
  const runtime = runtimeRef.current;
  const controller = controllerRef.current;
  const [loading, setLoading] = useState(true);
  const [directory, setDirectory] = useState<LoginDirectoryPerson[] | null>(null);
  const [activationLocked, setActivationLocked] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [selectedVessels, setSelectedVessels] = useState<string[]>([]);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [detailVesselId, setDetailVesselId] = useState('');
  const [editingVesselId, setEditingVesselId] = useState('');
  const [taskEditor, setTaskEditorState] = useState<NormalizedTaskEditorSession | null>(null);
  const taskEditorRef = useRef<NormalizedTaskEditorSession | null>(null);
  const recoveringDrafts = useRef(false);
  const runtimeView = useSyncExternalStore(
    runtime?.subscribeView || subscribeToNothing,
    runtime?.getViewSnapshot || emptyRuntimeView,
    runtime?.getViewSnapshot || emptyRuntimeView,
  );
  const projection = runtimeView.projection;
  const editorAuthorization = taskEditorAuthorization(
    projection,
    runtimeView.authorizationGeneration,
  );
  const authorizedEditingTask = editorAuthorization
    ? resolveAuthorizedTaskEditor(taskEditor, editorAuthorization)
    : null;

  const setTaskEditor = (next: NormalizedTaskEditorSession | null) => {
    taskEditorRef.current = next;
    setTaskEditorState(next);
  };

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    const authorizationGeneration = runtime?.authorizationGeneration;
    setGlobalError('');
    try {
      const result = await action();
      if (runtime?.authorizationGeneration !== authorizationGeneration) return undefined;
      return result;
    } catch (error) {
      if (runtime?.authorizationGeneration === authorizationGeneration) {
        setGlobalError(messageOf(error));
      }
      return undefined;
    }
  };
  const runBoolean = async (action: () => Promise<unknown>) => Boolean(await run(async () => {
    await action();
    return true;
  }));
  const enterApplication = () => {
    if (!runtime?.projection) return;
    setActivationLocked(runtime.activationRequired);
    runtime.startInvalidations(() => undefined, error => setGlobalError(messageOf(error)));
  };

  useEffect(() => {
    if (!runtime) return;
    let active = true;
    void runtime.initialize().then(async session => {
      if (!active) return;
      if (session) {
        enterApplication();
        return;
      }
      try {
        if (runtime.auth.readGateToken()) setDirectory(await runtime.getLoginDirectory());
      } catch {
        runtime.auth.clearGateToken();
      }
    }).catch(error => {
      if (active) setGlobalError(messageOf(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      void runtime.stopInvalidations();
    };
  }, [runtime]);

  useEffect(() => {
    setEditingVesselId('');
    setDetailVesselId('');
    setSelectedVessels([]);
    setBatchSelected([]);
    setDirectory(null);
    setGlobalError('');
  }, [runtime, runtimeView.authorizationGeneration]);

  useEffect(() => {
    const editor = taskEditorRef.current;
    if (!editor) return;
    if (editorAuthorization && resolveAuthorizedTaskEditor(editor, editorAuthorization)) return;
    cleanupNormalizedTaskEditorDraft(editor, owner => runtime?.removeOwnedDraft(owner));
    taskEditorRef.current = null;
    setTaskEditorState(null);
  }, [runtime, editorAuthorization]);

  useEffect(() => {
    if (!runtime || !controller || !projection || activationLocked) return;
    const recover = async () => {
      if (recoveringDrafts.current || navigator.onLine === false) return;
      recoveringDrafts.current = true;
      try {
        const result = await reconcileNormalizedDraftEnvelopes(
          runtime.listDrafts(),
          envelope => controller.recoverDraft(envelope),
        );
        if (result.failureCount > 0) {
          setGlobalError(projection.vesselAccount
            ? '部分本機復原項目尚未完成，請重新整理後再試。'
            : `${result.failureCount} 筆本機復原項目尚未完成；其餘項目已獨立處理。`);
        }
      } finally {
        recoveringDrafts.current = false;
      }
    };
    window.addEventListener('online', recover);
    void recover();
    return () => window.removeEventListener('online', recover);
  }, [runtime, controller, projection?.actor.id, activationLocked]);

  if (configurationError) return <main className="auth-shell"><section className="auth-card">
    <h1>系統設定錯誤</h1><div className="error-banner">{configurationError}</div>
  </section></main>;
  if (!runtime || !controller || loading) return <main className="auth-shell"><section className="auth-card">
    <img src={fpmcLogo} alt="FPMC"/><h1>載入官方工作階段…</h1>
  </section></main>;
  if (!projection) return <GateAndLogin runtime={runtime} directory={directory}
    onDirectory={people => setDirectory(people.length ? people : null)}
    onSignedIn={enterApplication}/>;
  if (activationLocked) return <ActivationLock runtime={runtime}
    onActivated={() => setActivationLocked(false)}
    onSignOut={() => {
      setDirectory(null);
      void runtime.signOut().catch(error => setGlobalError(messageOf(error)));
    }}/>;

  const data = projection.data;
  const user = projection.actor;
  const permission = (key: Parameters<typeof hasPermission>[2]) => (
    hasPermission(data.settings.rolePermissions, user, key)
  );
  const viewAll = canAccessAllVessels(data.settings.rolePermissions, user, data.vessels);
  const visibleVessels = data.vessels.filter(vessel => vessel.isActive && (
    projection.vesselAccount
    || viewAll
    || vessel.assignedUserIds.includes(user.id)
    || user.managedVesselIds.includes(vessel.id)
    || hasActiveVesselDelegation(vessel, user.id)
  ));
  const visibleVesselIds = new Set(visibleVessels.map(vessel => vessel.id));
  const visibleTasks = data.tasks.filter(task => (
    taskVesselIds(task).some(id => visibleVesselIds.has(id))
    || task.ownerUserIds.includes(user.id)
  ));
  const visibleCases = projection.vesselAccount
    ? []
    : data.internalControlCases.filter(item => visibleVesselIds.has(item.vesselId));
  const detailVessel = visibleVessels.find(vessel => vessel.id === detailVesselId);
  const editingVessel = visibleVessels.find(vessel => vessel.id === editingVesselId);
  const canEdit = !projection.vesselAccount && permission('editBusinessContent');
  const canCreate = !projection.vesselAccount && permission('createTasks');
  const canClose = permission('closeTasks');
  const canDelete = !projection.vesselAccount && permission('deleteTasks');

  const openTask = (task: TaskItem, vesselId = '') => {
    setTaskEditor(openNormalizedTaskEditor(task, {
      authorizationEpoch,
      creating: false,
      progressVesselId: vesselId,
      draftOwner: {
        workspaceId: runtime.scope.workspaceId,
        actorId: user.id,
        entityKey: `task:${task.id}`,
      },
    }));
  };
  const addTask = (vesselId: string) => {
    if (!canCreate || !visibleVesselIds.has(vesselId)) return;
    setTaskEditor(openNormalizedTaskEditor(newTask(user, vesselId), {
      authorizationEpoch,
      creating: true,
      progressVesselId: '',
      draftOwner: {
        workspaceId: runtime.scope.workspaceId,
        actorId: user.id,
        entityKey: `task-create:${vesselId}`,
      },
    }));
  };
  const saveTask = async (candidate: TaskItem, creating: boolean) => {
    const outcome = await run(() => controller.saveTask(candidate, creating));
    if (!outcome) return false;
    if (outcome === 'drafted') alert('目前離線：內容已保存為個人草稿，尚未寫入伺服器。');
    return true;
  };
  const saveProgress = async (candidate: TaskItem, vesselId: string) => {
    const outcome = await run(() => controller.saveTaskProgress(candidate, vesselId));
    if (!outcome) return false;
    if (outcome === 'drafted') alert('目前離線：船端進度已保存為個人草稿。');
    return true;
  };
  const authorizationEpoch = editorAuthorization?.authorizationEpoch || '';
  const creatingTask = taskEditor?.creating === true;
  const taskProgressVesselId = taskEditor?.progressVesselId || '';

  const nav: Array<[Tab, string, boolean]> = [
    ['dashboard', '總覽', true],
    ['morning', '晨會工作區', true],
    ['work', '我的待辦', true],
    ['tasks', '全部未結', true],
    ['closed', '已結案', true],
    ['internal', '內控異常', !projection.vesselAccount],
    ['meetings', '臨時會議', !projection.vesselAccount],
    ['reports', '報表', permission('exportReports')],
    ['stats', '數據分析', !projection.vesselAccount],
    ['management', '系統管理', permission('enterManagement')],
  ];

  return <div className="app-shell normalized-authority-app">
    <header className="topbar">
      <div className="brand"><img src={fpmcLogo} alt="FPMC"/>
        <div><b>{data.settings.systemTitle}</b><small>Normalized Supabase Authority</small></div></div>
      <div className="topbar-actions">
        <span>{user.department}｜{user.name}</span>
        <button className="btn small ghost" onClick={async () => {
          const password = prompt('設定／變更新個人密碼（至少 12 字元）');
          if (password === null) return;
          if (password.length < 12) return setGlobalError('個人密碼至少需要 12 個字元。');
          const confirmation = prompt('再次輸入新個人密碼');
          if (confirmation !== password) return setGlobalError('兩次輸入的新密碼不一致。');
          await run(() => runtime.changePersonalPassword(password));
        }}>變更密碼</button>
        <button className="btn small ghost" onClick={() => {
          setDirectory(null);
          void runtime.signOut().catch(error => setGlobalError(messageOf(error)));
        }}>登出</button>
      </div>
    </header>
    <nav className="main-nav">{nav.filter(([, , visible]) => visible).map(([key, label]) =>
      <button key={key} className={tab === key ? 'active' : ''} onClick={() => {
        setTab(key);
        setDetailVesselId('');
      }}>{label}</button>)}</nav>
    {globalError && <div className="global-error" role="alert">
      <span>{projection.vesselAccount ? '資料狀態已變更，請重新整理後再試。' : globalError}</span>
      <button className="icon-btn" onClick={() => setGlobalError('')}>×</button>
    </div>}
    <main className="app-main">
      {detailVessel ? <VesselDetailPage vessel={detailVessel} data={data} currentUser={user}
        onBack={() => setDetailVesselId('')} onEditVessel={() => setEditingVesselId(detailVessel.id)}
        onAddTask={() => addTask(detailVessel.id)}
        onEditTask={taskId => {
          const task = visibleTasks.find(item => item.id === taskId);
          if (task) openTask(task, detailVessel.id);
        }}
        onOpenInternalControl={() => setTab('internal')}
        canEditVessel={canEdit} canCreateTasks={canCreate} canEditTasks={canEdit}
        canViewInternalControl={!projection.vesselAccount}/>
      : tab === 'dashboard' ? <DashboardView user={user} vessels={visibleVessels}
        tasks={visibleTasks} internalControlCases={visibleCases}
        meetings={dashboardMeetingAlerts(
          data.meetings,
          visibleVessels.map(vessel => vessel.id),
          () => true,
        )}
        selected={selectedVessels} setSelected={setSelectedVessels}
        batchSelected={batchSelected} setBatchSelected={setBatchSelected}
        onOpenVessel={setDetailVesselId} onEdit={setEditingVesselId} onAddTask={addTask}
        onToggleAttention={(vesselId, key) => {
          const vessel = visibleVessels.find(item => item.id === vesselId);
          if (vessel) void run(() => controller.toggleWeeklyAttention(vessel, key));
        }}
        onAdjustAttention={vesselId => {
          const vessel = visibleVessels.find(item => item.id === vesselId);
          if (!vessel) return;
          const value = prompt('人工關注程度：急、高、中、低、特別關注；留空取消',
            vessel.manualAttentionLevel || '');
          if (value === null) return;
          void run(() => controller.setManualAttention(vessel, value.trim() || null));
        }}
        onStartMeeting={() => setTab('meetings')} onOpenReport={() => setTab('reports')}
        onTaskMetric={mode => setTab(mode === 'open' ? 'tasks' : 'tasks')}
        onOpenBatchManagedVessels={() => {
          const ids = batchSelected.filter(id => visibleVesselIds.has(id));
          if (!ids.length) return alert('請先勾選要批次更新的船舶。');
          const remark = prompt('批次更新人工備註');
          if (remark === null) return;
          void run(() => controller.batchUpdateVessels(ids.map(vesselId => {
            const vessel = visibleVessels.find(item => item.id === vesselId)!;
            return {
              vesselId,
              patch: {
                position: {
                  ...vesselPositionCommandValue(vessel),
                  source: 'manual',
                  manualRemark: remark,
                },
              },
            };
          })));
        }}
        canEdit={canEdit} canCreateTasks={canCreate}
        canUseMeetings={permission('manageMeetings')} canUseReports={permission('exportReports')}/>
      : tab === 'morning' ? <MorningWorkspaceView data={data} user={user}
        visibleVessels={visibleVessels} selected={selectedVessels} setSelected={setSelectedVessels}
        onEditTask={(task, vesselId) => openTask(task, vesselId)}
        onAddTask={addTask} onOpenVessel={setDetailVesselId}
        onOpenTemporaryMeeting={() => setTab('meetings')} onOpenReport={() => setTab('reports')}
        commit={mutate => {
          const draft = structuredClone(data);
          mutate(draft);
          const report = draft.agendaReports.find(item =>
            !data.agendaReports.some(existing => existing.id === item.id));
          if (report) void run(() => controller.saveReport(report));
        }}/>
      : tab === 'work' ? <WorkCenter data={data} user={user} vessels={visibleVessels}
        onOpenTask={task => openTask(task)} onOpenInternalControl={() => setTab('internal')}
        onOpenVessel={setDetailVesselId}
        markAllRead={() => run(() => controller.markAllNotificationsRead(user)).then(() => undefined)}
        canComplete={canClose} canDelete={canDelete} canPrint={permission('exportReports')}
        onPrint={() => window.print()}
        onBatchComplete={ids => runBoolean(() => controller.batchTransitionTasks(ids, 'close'))}
        onBatchDelete={async ids => {
          if (!confirm(`確定刪除 ${ids.length} 筆待辦？`)) return false;
          return runBoolean(() => controller.batchTransitionTasks(ids, 'delete'));
        }}/>
      : tab === 'tasks' ? <TaskList data={{ ...data, tasks: visibleTasks }} vessels={visibleVessels}
        closed={false} onOpen={openTask}/>
      : tab === 'closed' ? <TaskList data={{ ...data, tasks: visibleTasks }} vessels={visibleVessels}
        closed onOpen={openTask}/>
      : tab === 'internal' ? <InternalControlPage data={data} user={user} vessels={visibleVessels}
        canCreate={canCreate} canEdit={canEdit} canClose={canClose} canDelete={canDelete}
        canExport={permission('exportReports')} authorizationEpoch={authorizationEpoch}
        onCreate={async (items, _revision, projections) =>
          Boolean(await run(() => controller.createInternalCaseBatch(items, projections)))}
        onUpdate={async (item, _updatedAt, _revision, taskProjection) =>
          Boolean(await run(() => controller.updateInternalCase(item, taskProjection)))}
        onDelete={item => runBoolean(() => controller.deleteInternalCase(item))}
        onOpenTask={taskId => {
          const task = visibleTasks.find(item => item.id === taskId);
          if (task) openTask(task);
        }}/>
      : tab === 'meetings' ? <NormalizedMeetings data={data} user={user}
        vessels={visibleVessels} canEdit={permission('manageMeetings')}
        onSave={async (meeting, creating) =>
          Boolean(await run(() => controller.saveMeeting(meeting, creating)))}
        onDelete={meetingId => runBoolean(() => controller.deleteMeeting(meetingId))}
        onCorrectStatus={input =>
          run(() => controller.correctMeetingStatus(input)).then(() => undefined)}/>
      : tab === 'reports' ? <ReportsView data={data} vessels={visibleVessels}/>
      : tab === 'stats' ? <DataAnalysisView data={{ ...data, tasks: visibleTasks }} vessels={visibleVessels}/>
      : <NormalizedManagement data={data} user={user}
        canManageUsers={permission('manageUsers')} canManageVessels={permission('manageVessels')}
        canManagePermissions={permission('manageRolePermissions')}
        canManageSettings={permission('manageSystemSettings')}
        canViewAudit={permission('viewAuditLogs')}
        userRecoveries={permission('manageUsers') ? runtime.listManageUserRecoveries() : []}
        onResumeUserRecovery={(entityKey, password) =>
          run(() => runtime.resumeManageUserRecovery(entityKey, password)).then(() => undefined)}
        onManageUser={input => run(() => runtime.manageUser(input)).then(() => undefined)}
        onUpdateUser={account => run(() => controller.updateUser(account)).then(() => undefined)}
        onCreateVessel={vessel => run(() => controller.createVessel(vessel)).then(() => undefined)}
        onUpdateVessel={(before, after) => run(() => controller.saveVessel(before, after)).then(() => undefined)}
        onDisableVessel={vesselId => run(() => controller.disableVessel(vesselId)).then(() => undefined)}
        onUpdateSettingValues={(section, values) =>
          run(() => controller.updateSettingValues(section, values)).then(() => undefined)}
        onUpdateRolePermissions={matrix =>
          run(() => controller.updateRolePermissions(matrix)).then(() => undefined)}
        onUpdateWorkspaceSettings={value =>
          run(() => controller.updateWorkspaceSettings(value)).then(() => undefined)}
        onUpdateSiteGate={password =>
          run(() => controller.updateSiteGate(password)).then(() => undefined)}/>}
    </main>
    {editingVessel && <VesselEditor vessel={editingVessel} data={data}
      close={() => setEditingVesselId('')}
      save={async candidate => Boolean(await run(() => controller.saveVessel(editingVessel, candidate)))}/>}
    {authorizedEditingTask && <TaskEditModal task={authorizedEditingTask} creating={creatingTask}
      data={data} visibleVessels={visibleVessels} currentUser={user}
      canClose={canClose} canDelete={canDelete} canCancelInternalControl={canClose}
      canEditOverall={(canEdit || creatingTask) && !authorizedEditingTask.sourceMeetingId}
      initialProgressVesselId={taskProgressVesselId}
      readOnly={!creatingTask && (
        (!canEdit && !projection.vesselAccount)
        || (Boolean(authorizedEditingTask.sourceMeetingId) && !taskProgressVesselId)
      )}
      readOnlyReason={authorizedEditingTask.sourceMeetingId
        ? '會議待辦的整體內容請由臨時會議頁以聚合命令編輯'
        : '目前角色只有檢視權限'}
      close={() => setTaskEditor(null)}
      onDraftChange={candidate => {
        const key = creatingTask ? `task-create:${candidate.vesselId}` : `task:${candidate.id}`;
        const versions = projection.versions.has(`task:${candidate.id}`)
          ? { [`task:${candidate.id}`]: projection.versions.get(`task:${candidate.id}`) }
          : {};
        runtime.saveDraft(key, { kind: 'task', candidate: structuredClone(candidate) } as Record<string, unknown>, versions);
      }}
      onSave={saveTask}
      onSaveVesselProgress={saveProgress}
      onDelete={() => {
        if (!canDelete || !confirm('確定刪除此待辦？')) return;
        void runBoolean(() => controller.deleteTask(authorizedEditingTask.id)).then(ok => {
          if (ok) setTaskEditor(null);
        });
      }}/>}
  </div>;
}
