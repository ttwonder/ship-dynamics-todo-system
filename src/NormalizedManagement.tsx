import { useState } from 'react';
import type {
  AppData,
  PermissionKey,
  RolePermissions,
  UserAccount,
  UserRole,
  Vessel,
} from './types';
import type { ManageUserRecoverySummary } from './normalizedRuntime';
import { vesselDisplayName } from './vesselDisplay';
import { formatTaipeiDateTime } from './taipeiTime';
import { presentAuditLog } from './auditPresentation';

type SettingsSection = 'departments' | 'task-categories' | 'meeting-task-categories'
  | 'priorities' | 'equipment-options';

type Props = {
  data: AppData;
  user: UserAccount;
  canManageUsers: boolean;
  canManageVessels: boolean;
  canManagePermissions: boolean;
  canManageSettings: boolean;
  canViewAudit: boolean;
  userRecoveries: ManageUserRecoverySummary[];
  onResumeUserRecovery: (entityKey: string, password?: string) => Promise<void>;
  onManageUser: (input: Record<string, unknown> & {
    action: 'create' | 'disable' | 'change-role' | 'transfer-owner' | 'reset-password';
    targetUserId?: string;
  }) => Promise<void>;
  onUpdateUser: (user: UserAccount) => Promise<void>;
  onCreateVessel: (vessel: Vessel) => Promise<void>;
  onUpdateVessel: (before: Vessel, after: Vessel) => Promise<void>;
  onDisableVessel: (vesselId: string) => Promise<void>;
  onUpdateSettingValues: (section: SettingsSection, values: string[]) => Promise<void>;
  onUpdateRolePermissions: (matrix: RolePermissions) => Promise<void>;
  onUpdateWorkspaceSettings: (value: Record<string, unknown>) => Promise<void>;
  onUpdateSiteGate: (password: string) => Promise<void>;
};

const roles: UserRole[] = ['owner', 'admin', 'operator', 'vessel'];
const roleNames: Record<UserRole, string> = {
  owner: 'Owner',
  admin: '管理員',
  operator: '一般人員',
  vessel: '船端帳號',
};
const manageUserRecoveryActionNames: Record<ManageUserRecoverySummary['action'], string> = {
  create: '新增使用者',
  disable: '停用使用者',
  'change-role': '調整角色',
  'transfer-owner': '移交 Owner',
  'reset-password': '重設密碼',
};
const permissionNames: Record<PermissionKey, string> = {
  viewAllVessels: '查看全部船舶',
  editBusinessContent: '編輯業務內容',
  createTasks: '新增待辦',
  closeTasks: '結案／重開待辦',
  deleteTasks: '刪除待辦',
  manageMeetings: '管理會議',
  exportReports: '匯出報表',
  enterManagement: '進入管理中心',
  manageUsers: '管理使用者',
  manageVessels: '管理船舶',
  viewAuditLogs: '查看稽核紀錄',
  manageRolePermissions: '管理角色權限',
  manageSystemSettings: '管理系統設定',
};

function splitValues(value: string) {
  return Array.from(new Set(value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)));
}

function newVesselDraft(): Vessel {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: '',
    shortName: '',
    fullName: '',
    shipType: '',
    fleetCategory: '',
    fleetTags: [],
    assignedUserIds: [],
    delegateManagers: [],
    vesselAccountUserIds: [],
    isActive: true,
    position: {
      source: 'manual',
      location: '',
      speedKnots: 0,
      navigationStatus: '停泊',
      lastPort: '',
      nextPort: '',
      eta: '',
      etb: '',
      etd: '',
      updatedAt: timestamp,
      manualRemark: '',
    },
    cargo: {
      source: 'manual',
      loadStatus: '空載',
      name: '',
      quantity: '',
      items: [],
      updatedAt: timestamp,
    },
    note: {
      statusList: [],
      statusSupplement: '',
      captain: '',
      chiefOfficer: '',
      chiefEngineer: '',
      firstEngineer: '',
      recentDynamics: '',
      maintenanceOverview: '',
      subsequentDynamics: '',
      updatedAt: timestamp,
    },
    weeklyAttention: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export default function NormalizedManagement(props: Props) {
  const {
    data,
    user,
    canManageUsers,
    canManageVessels,
    canManagePermissions,
    canManageSettings,
    canViewAudit,
  } = props;
  const [tab, setTab] = useState<'users' | 'vessels' | 'settings' | 'permissions' | 'audit'>('users');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      alert(error instanceof Error ? error.message : '伺服器拒絕此操作。');
    } finally {
      setBusy(false);
    }
  };
  return <section className="management-page normalized-management">
    <div className="page-heading"><div><h1>系統管理</h1>
      <p>帳號、角色、船舶、權限與設定均直接提交至歸一化伺服器。</p></div></div>
    <div className="subtabs">
      {([
        ['users', '使用者'],
        ['vessels', '船舶'],
        ['settings', '系統設定'],
        ['permissions', '角色權限'],
        ['audit', '稽核紀錄'],
      ] as const).map(([key, label]) => <button key={key}
        className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}
    </div>

    {tab === 'users' && <UsersPanel
      users={data.users}
      currentUser={user}
      disabled={busy || !canManageUsers}
      userRecoveries={canManageUsers ? props.userRecoveries : []}
      run={run}
      onResumeUserRecovery={props.onResumeUserRecovery}
      onManage={props.onManageUser}
      onUpdate={props.onUpdateUser}
    />}
    {tab === 'vessels' && <VesselsPanel
      vessels={data.vessels}
      users={data.users}
      disabled={busy || !canManageVessels}
      run={run}
      onCreate={props.onCreateVessel}
      onUpdate={props.onUpdateVessel}
      onDisable={props.onDisableVessel}
    />}
    {tab === 'settings' && <SettingsPanel
      data={data}
      disabled={busy || !canManageSettings}
      run={run}
      onValues={props.onUpdateSettingValues}
      onWorkspace={props.onUpdateWorkspaceSettings}
      onSiteGate={props.onUpdateSiteGate}
    />}
    {tab === 'permissions' && <PermissionsPanel
      matrix={data.settings.rolePermissions}
      disabled={busy || !canManagePermissions}
      run={run}
      save={props.onUpdateRolePermissions}
    />}
    {tab === 'audit' && <section className="panel">
      <h2>伺服器稽核紀錄</h2>
      {!canViewAudit ? <p className="empty-state">目前角色沒有查看權限。</p>
        : <div className="table-wrap"><table className="compact"><thead><tr>
          <th>時間</th><th>操作人</th><th>具體操作</th><th>操作對象</th><th>內容</th><th>IP號碼</th><th>IP歸屬地</th>
        </tr></thead><tbody>{data.auditLogs.map(log => { const presented = presentAuditLog(log, data); return <tr key={log.id}>
          <td>{formatTaipeiDateTime(log.at)}</td><td>{log.actorName}</td>
          <td>{presented.actionLabel}</td><td>{presented.targetLabel}</td><td>{presented.detailText}</td>
          <td>{presented.ipAddressLabel}</td><td>{presented.ipLocationLabel}</td>
        </tr>; })}</tbody></table></div>}
    </section>}
  </section>;
}

function UsersPanel({
  users,
  currentUser,
  disabled,
  userRecoveries,
  run,
  onResumeUserRecovery,
  onManage,
  onUpdate,
}: {
  users: UserAccount[];
  currentUser: UserAccount;
  disabled: boolean;
  userRecoveries: ManageUserRecoverySummary[];
  run: (action: () => Promise<void>) => Promise<void>;
  onResumeUserRecovery: Props['onResumeUserRecovery'];
  onManage: Props['onManageUser'];
  onUpdate: Props['onUpdateUser'];
}) {
  const create = () => {
    const displayName = prompt('姓名');
    if (!displayName?.trim()) return;
    const usernameLabel = prompt('登入顯示帳號');
    if (!usernameLabel?.trim()) return;
    const department = prompt('部門');
    if (!department?.trim()) return;
    const role = prompt('角色：admin / operator / vessel', 'operator') as UserRole | null;
    if (!role || !['admin', 'operator', 'vessel'].includes(role)) return alert('角色不正確。');
    const password = prompt('臨時密碼（至少 12 字元）');
    if (!password || password.length < 12) return alert('密碼至少 12 字元。');
    void run(() => onManage({
      action: 'create',
      displayName: displayName.trim(),
      usernameLabel: usernameLabel.trim(),
      department: department.trim(),
      role,
      password,
    }));
  };
  const resumeRecovery = (recovery: ManageUserRecoverySummary) => {
    let password: string | undefined;
    if (recovery.requiresPassword) {
      const entered = prompt('重新輸入原操作密碼（至少 12 字元）');
      if (!entered || entered.length < 12 || entered.length > 256) {
        return alert('密碼必須為 12 至 256 字元。');
      }
      password = entered;
    }
    void run(() => onResumeUserRecovery(recovery.entityKey, password));
  };
  return <section className="panel">
    {userRecoveries.length > 0 && <section className="recovery-banner" role="status">
      <b>有 {userRecoveries.length} 筆帳號操作需要確認</b>
      <p>外部帳號效果可能已發生，不能取消；請以原操作資料完成復原。</p>
      <div className="table-actions">{userRecoveries.map(recovery => {
        const target = recovery.targetUserId
          ? users.find(account => account.id === recovery.targetUserId)?.name || '指定使用者'
          : '新使用者';
        return <button key={recovery.entityKey} className="btn small"
          disabled={disabled} onClick={() => resumeRecovery(recovery)}>
          復原：{manageUserRecoveryActionNames[recovery.action]}｜{target}
        </button>;
      })}</div>
    </section>}
    <div className="panel-title"><h2>使用者與原生 Supabase Auth</h2>
      <button className="btn primary" disabled={disabled} onClick={create}>＋新增使用者</button></div>
    <div className="table-wrap"><table className="compact"><thead><tr>
      <th>人員</th><th>帳號</th><th>角色</th><th>狀態</th><th>操作</th>
    </tr></thead><tbody>{users.map(account => <tr key={account.id}>
      <td><b>{account.name}</b><small>{account.department}</small></td>
      <td>{account.username}</td>
      <td><select value={account.role} disabled={disabled || account.role === 'owner'}
        onChange={event => void run(() => onManage({
          action: 'change-role',
          targetUserId: account.id,
          role: event.target.value,
        }))}>{roles.map(role => <option key={role} value={role}>{roleNames[role]}</option>)}</select></td>
      <td>{account.isActive ? '啟用' : '停用'}</td>
      <td><div className="table-actions">
        <button className="btn small ghost" disabled={disabled} onClick={() => {
          const name = prompt('姓名', account.name);
          const department = prompt('部門', account.department);
          const username = prompt('登入顯示帳號', account.username);
          if (!name?.trim() || !department?.trim() || !username?.trim()) return;
          void run(() => onUpdate({
            ...account,
            name: name.trim(),
            department: department.trim(),
            username: username.trim(),
          }));
        }}>資料</button>
        <button className="btn small ghost" disabled={disabled} onClick={() => {
          const password = prompt('新臨時密碼（至少 12 字元）');
          if (!password || password.length < 12) return;
          void run(() => onManage({
            action: 'reset-password',
            targetUserId: account.id,
            password,
          }));
        }}>重設密碼</button>
        {currentUser.role === 'owner' && account.role !== 'owner' && account.isActive &&
          <button className="btn small ghost" disabled={disabled}
            onClick={() => confirm(`將 Owner 移轉給 ${account.name}？`)
              && void run(() => onManage({ action: 'transfer-owner', targetUserId: account.id }))}>
            移轉 Owner
          </button>}
        {account.role !== 'owner' && account.isActive &&
          <button className="btn small danger" disabled={disabled}
            onClick={() => confirm(`停用 ${account.name}？`)
              && void run(() => onManage({ action: 'disable', targetUserId: account.id }))}>
            停用
          </button>}
      </div></td>
    </tr>)}</tbody></table></div>
  </section>;
}

function VesselsPanel({
  vessels,
  users,
  disabled,
  run,
  onCreate,
  onUpdate,
  onDisable,
}: {
  vessels: Vessel[];
  users: UserAccount[];
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onCreate: Props['onCreateVessel'];
  onUpdate: Props['onUpdateVessel'];
  onDisable: Props['onDisableVessel'];
}) {
  const edit = (before?: Vessel) => {
    const draft = before ? structuredClone(before) : newVesselDraft();
    const shortName = prompt('船舶簡稱', draft.shortName);
    if (!shortName?.trim()) return;
    const fullName = prompt('船舶全名', draft.fullName || shortName);
    const shipType = prompt('船型', draft.shipType);
    const fleetCategory = prompt('船隊分類', draft.fleetCategory);
    draft.shortName = shortName.trim();
    draft.name = draft.name || draft.shortName;
    draft.fullName = fullName?.trim() || draft.shortName;
    draft.shipType = shipType?.trim() || '';
    draft.fleetCategory = fleetCategory?.trim() || '';
    const managers = prompt(
      '管理人員 ID（逗號分隔）',
      draft.assignedUserIds.join(','),
    );
    draft.assignedUserIds = (managers || '').split(',').map(value => value.trim())
      .filter(id => users.some(user => user.id === id && user.isActive
        && ['admin', 'operator'].includes(user.role)));
    const delegates = prompt(
      '代理管理人員 ID（逗號分隔）',
      draft.delegateManagers.filter(item => item.isActive).map(item => item.userId).join(','),
    );
    draft.delegateManagers = (delegates || '').split(',').map(value => value.trim())
      .filter(id => users.some(user => user.id === id && user.isActive
        && ['admin', 'operator'].includes(user.role)))
      .map(userId => ({ userId, isActive: true }));
    const vesselAccounts = prompt(
      '船端帳號 ID（逗號分隔；每個帳號只能指派一艘船）',
      (draft.vesselAccountUserIds || []).join(','),
    );
    draft.vesselAccountUserIds = (vesselAccounts || '').split(',')
      .map(value => value.trim())
      .filter(id => users.some(user => user.id === id && user.isActive && user.role === 'vessel'));
    void run(() => before ? onUpdate(before, draft) : onCreate(draft));
  };
  return <section className="panel">
    <div className="panel-title"><h2>船舶與經理／代理指派</h2>
      <button className="btn primary" disabled={disabled} onClick={() => edit()}>＋新增船舶</button></div>
    <div className="table-wrap"><table className="compact"><thead><tr>
      <th>船舶</th><th>船型／船隊</th><th>管理人員</th><th>代理／船端帳號</th><th>操作</th>
    </tr></thead><tbody>{vessels.map(vessel => <tr key={vessel.id}>
      <td><b>{vesselDisplayName(vessel)}</b><small>{vessel.id}</small></td>
      <td>{vessel.shipType}<small>{vessel.fleetCategory}</small></td>
      <td>{vessel.assignedUserIds.map(id => users.find(user => user.id === id)?.name || id).join('、') || '-'}</td>
      <td>{vessel.delegateManagers.filter(item => item.isActive)
        .map(item => users.find(user => user.id === item.userId)?.name || item.userId).join('、') || '-'}
        <small>船端：{(vessel.vesselAccountUserIds || [])
          .map(id => users.find(user => user.id === id)?.name || id).join('、') || '-'}</small></td>
      <td><div className="table-actions">
        <button className="btn small primary" disabled={disabled} onClick={() => edit(vessel)}>編輯</button>
        {vessel.isActive && <button className="btn small danger" disabled={disabled}
          onClick={() => confirm(`停用 ${vesselDisplayName(vessel)}？`)
            && void run(() => onDisable(vessel.id))}>停用</button>}
      </div></td>
    </tr>)}</tbody></table></div>
  </section>;
}

function SettingsPanel({
  data,
  disabled,
  run,
  onValues,
  onWorkspace,
  onSiteGate,
}: {
  data: AppData;
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onValues: Props['onUpdateSettingValues'];
  onWorkspace: Props['onUpdateWorkspaceSettings'];
  onSiteGate: Props['onUpdateSiteGate'];
}) {
  const sections: Array<[SettingsSection, string, string[]]> = [
    ['departments', '部門', data.settings.departments],
    ['task-categories', '晨會待辦分類', data.settings.taskCategories],
    ['meeting-task-categories', '會議待辦分類', data.settings.meetingTaskCategories],
    ['priorities', '優先程度', data.settings.priorities],
    ['equipment-options', '設備故障細項', data.settings.equipmentFailureSubcategories],
  ];
  return <div className="management-settings-grid">
    <section className="panel">
      <h2>系統名稱</h2>
      <button className="btn primary" disabled={disabled} onClick={() => {
        const systemTitle = prompt('系統名稱', data.settings.systemTitle);
        if (!systemTitle?.trim()) return;
        void run(() => onWorkspace({
          systemTitle: systemTitle.trim(),
          vesselStatuses: data.settings.vesselStatuses,
        }));
      }}>更新系統名稱</button>
    </section>
    <section className="panel">
      <h2>網站入口密碼</h2>
      <p className="muted">新密碼只送往安全 RPC，不存放在瀏覽器或 operation payload。</p>
      <button className="btn primary" disabled={disabled} onClick={() => {
        const password = prompt('新網站入口密碼');
        if (!password || password.length < 12) return alert('密碼至少 12 字元。');
        void run(() => onSiteGate(password));
      }}>更新網站入口密碼</button>
    </section>
    {sections.map(([section, label, values]) => <section className="panel" key={section}>
      <h2>{label}</h2><pre className="settings-value-preview">{values.join('\n')}</pre>
      <button className="btn ghost" disabled={disabled} onClick={() => {
        const next = prompt(`${label}；以換行或逗號分隔`, values.join('\n'));
        if (next === null) return;
        const parsed = splitValues(next);
        if (!parsed.length) return alert('至少保留一個選項。');
        void run(() => onValues(section, parsed));
      }}>編輯</button>
    </section>)}
  </div>;
}

function PermissionsPanel({
  matrix,
  disabled,
  run,
  save,
}: {
  matrix: RolePermissions;
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  save: Props['onUpdateRolePermissions'];
}) {
  const [draft, setDraft] = useState(() => structuredClone(matrix));
  const permissions = Object.keys(permissionNames) as PermissionKey[];
  return <section className="panel">
    <div className="panel-title"><h2>角色權限矩陣</h2>
      <button className="btn primary" disabled={disabled}
        onClick={() => void run(() => save(draft))}>儲存權限</button></div>
    <div className="table-wrap"><table className="compact"><thead><tr>
      <th>權限</th>{roles.map(role => <th key={role}>{roleNames[role]}</th>)}
    </tr></thead><tbody>{permissions.map(permission => <tr key={permission}>
      <td>{permissionNames[permission]}</td>
      {roles.map(role => <td key={role}><input type="checkbox"
        disabled={disabled || role === 'owner'}
        checked={draft[role][permission]}
        onChange={event => setDraft(previous => ({
          ...previous,
          [role]: { ...previous[role], [permission]: event.target.checked },
        }))}/></td>)}
    </tr>)}</tbody></table></div>
  </section>;
}
