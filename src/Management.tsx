import React, { useEffect, useMemo, useState } from 'react';
import type { AppData, PermissionKey, RolePermissions, UserAccount, UserRole, Vessel } from './types';
import { getSupabaseConfig, saveSupabaseConfig, type SupabaseConfig } from './cloud';
import { isOwner, nowIso, roleLabel, sha256, uid } from './utils';
import { hasPermission, normalizeRolePermissions, PERMISSION_KEYS, PERMISSION_LABELS } from './permissions';
import { departmentAfterRoleChange } from './personWorkflow';
import { vesselDisplayName } from './vesselDisplay';
import { WEEKLY_ATTENTION_CATEGORY_MAP, isMeetingTaskSource, taskCategoriesOf } from './taskCategories';

type Section = 'directory' | 'people' | 'vessels' | 'categories' | 'attention' | 'roles' | 'owner' | 'audit';
type DirectoryKind = 'all' | 'user' | 'vessel';
type UserDraft = Pick<UserAccount, 'department' | 'name' | 'username' | 'role' | 'isActive' | 'managedVesselIds'> & { password: string };
type VesselDraft = Pick<Vessel, 'name' | 'shortName' | 'fullName' | 'shipType' | 'fleetCategory' | 'isActive' | 'assignedUserIds'>;

type Props = {
  data: AppData;
  currentUser: UserAccount;
  commit: (mutate: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
};

const emptyConfig: SupabaseConfig = { supabaseUrl: '', supabaseAnonKey: '', workspaceKey: 'ship-dynamics-main', tableName: 'ship_dynamics_app_state' };
const userDraft = (u?: UserAccount, department = ''): UserDraft => u ? {
  department: u.department,
  name: u.name,
  username: u.username,
  role: u.role,
  isActive: u.isActive,
  managedVesselIds: [...(u.managedVesselIds || [])],
  password: '',
} : { department, name: '', username: '', role: 'operator', isActive: true, managedVesselIds: [], password: '' };
const vesselDraft = (v?: Vessel): VesselDraft => v ? {
  name: v.name,
  shortName: v.shortName,
  fullName: v.fullName,
  shipType: v.shipType,
  fleetCategory: v.fleetCategory,
  isActive: v.isActive,
  assignedUserIds: [...(v.assignedUserIds || [])],
} : { name: '', shortName: '', fullName: '', shipType: '', fleetCategory: 'tanker fleet', isActive: true, assignedUserIds: [] };
const canManageVesselAssignments = (user: Pick<UserAccount, 'role' | 'isActive'>) => user.isActive && (user.role === 'admin' || user.role === 'operator');
const managerNames = (users: UserAccount[], ids: string[]) => ids.map(id => users.find(user => user.id === id && user.isActive)?.name).filter(Boolean) as string[];

export default function ManagementView({ data, currentUser, commit }: Props) {
  const owner = isOwner(currentUser);
  const canManageUsers = hasPermission(data.settings.rolePermissions, currentUser, 'manageUsers');
  const canManageVessels = hasPermission(data.settings.rolePermissions, currentUser, 'manageVessels');
  const canViewAudit = hasPermission(data.settings.rolePermissions, currentUser, 'viewAuditLogs');
  const canManageSystem = hasPermission(data.settings.rolePermissions, currentUser, 'manageSystemSettings');
  const canManageCategories = owner || currentUser.role === 'admin';
  const activeUsers = useMemo(() => data.users.filter(u => u.isActive), [data.users]);
  const activeVessels = useMemo(() => data.vessels.filter(v => v.isActive), [data.vessels]);
  const [section, setSection] = useState<Section>('directory');
  const [query, setQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [directoryKind, setDirectoryKind] = useState<DirectoryKind>('all');
  const [directorySelection, setDirectorySelection] = useState(() => `user:${currentUser.id}`);
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id);
  const [selectedVesselId, setSelectedVesselId] = useState(activeVessels[0]?.id || '');
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingVessel, setCreatingVessel] = useState(false);
  const [personDraft, setPersonDraft] = useState<UserDraft>(() => userDraft(currentUser));
  const [shipDraft, setShipDraft] = useState<VesselDraft>(() => vesselDraft(activeVessels[0]));
  const [assignmentQuery, setAssignmentQuery] = useState('');
  const [sitePassword, setSitePassword] = useState('');
  const [config, setConfig] = useState<SupabaseConfig>(() => getSupabaseConfig() || emptyConfig);
  const [ownerPanel, setOwnerPanel] = useState<'gate' | 'supabase' | 'cloud'>('gate');
  const [auditId, setAuditId] = useState(data.auditLogs[0]?.id || '');
  const [saveNotice, setSaveNotice] = useState('');

  useEffect(() => {
    if (creatingUser) return;
    const selected = data.users.find(u => u.id === selectedUserId);
    if (selected) setPersonDraft(userDraft(selected));
  }, [selectedUserId, data.revision, creatingUser, currentUser.id, owner]);
  useEffect(() => {
    if (creatingVessel) return;
    const selected = data.vessels.find(v => v.id === selectedVesselId);
    if (selected) setShipDraft(vesselDraft(selected));
  }, [selectedVesselId, data.revision, creatingVessel]);
  useEffect(() => {
    if (!saveNotice) return;
    const timer = window.setTimeout(() => setSaveNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  const go = (next: Section) => {
    if (next === 'vessels' && !canManageVessels) return alert('目前角色未獲授權管理船舶');
    if (next === 'categories' && !canManageCategories) return alert('只有 Owner／管理員可以維護分類');
    if (next === 'audit' && !canViewAudit) return alert('目前角色未獲授權查看操作紀錄');
    if (next === 'owner' && !canManageSystem) return alert('只有 Owner 可以進入敏感設定');
    setSection(next);
    setQuery('');
    if (next === 'people' && !canManageUsers) selectUser(currentUser.id);
  };
  const selectUser = (id: string) => {
    const user = data.users.find(u => u.id === id);
    if (!user) return;
    setCreatingUser(false);
    setSelectedUserId(id);
    setPersonDraft(userDraft(user));
    setAssignmentQuery('');
  };
  const selectVessel = (id: string) => {
    const vessel = data.vessels.find(v => v.id === id);
    if (!vessel) return;
    setCreatingVessel(false);
    setSelectedVesselId(id);
    setShipDraft(vesselDraft(vessel));
    setAssignmentQuery('');
  };
  const startNewUser = () => {
    if (!canManageUsers) return alert('目前角色未獲授權新增人員');
    setCreatingUser(true);
    setSelectedUserId('');
    const firstPersonnelDepartment = data.settings.departments.map(department => department.trim()).find(department => department && department !== '船舶帳戶') || '';
    setPersonDraft(userDraft(undefined, firstPersonnelDepartment));
  };
  const startNewVessel = () => {
    if (!canManageVessels) return alert('目前角色未獲授權新增船舶');
    setCreatingVessel(true);
    setSelectedVesselId('');
    setShipDraft(vesselDraft());
  };

  const savePerson = async () => {
    const targetUser = data.users.find(u => u.id === selectedUserId);
    if (!owner && (targetUser?.role === 'owner' || personDraft.role === 'owner')) return alert('管理員不可建立或修改 Owner 帳號');
    if (!personDraft.name.trim() || !personDraft.username.trim()) return alert('請填寫姓名與用戶名');
    if (personDraft.role === 'vessel' && personDraft.managedVesselIds.length !== 1) return alert('船舶帳戶必須且只能綁定一艘船舶');
    const personnelDepartments = data.settings.departments.map(department => department.trim()).filter(department => department && department !== '船舶帳戶');
    const normalizedDepartment = personDraft.role === 'vessel' ? '船舶帳戶' : personDraft.department.trim();
    if (personDraft.role !== 'vessel' && (!normalizedDepartment || normalizedDepartment === '船舶帳戶' || !personnelDepartments.includes(normalizedDepartment))) return alert('請為人員角色選擇有效部門');
    if (creatingUser && !personDraft.password.trim()) return alert('請為新帳號設定密碼');
    const duplicate = data.users.some(u => u.id !== selectedUserId && u.username.trim().toLowerCase() === personDraft.username.trim().toLowerCase());
    if (duplicate) return alert('用戶名已存在');
    if (!owner && !canManageUsers) {
      if (creatingUser || selectedUserId !== currentUser.id) return alert('管理員只能修改自己的帳號');
      const selected = data.users.find(u => u.id === currentUser.id);
      if (!selected) return;
      const passwordHash = personDraft.password ? await sha256(personDraft.password) : selected.passwordHash;
      commit(d => {
        const user = d.users.find(u => u.id === currentUser.id);
        if (user) Object.assign(user, { name: personDraft.name.trim(), username: personDraft.username.trim(), passwordHash, updatedAt: nowIso() });
      }, '管理員更新自己的帳號', 'user', currentUser.id, personDraft.name.trim());
      setSaveNotice('✓ 人員資料已保存');
      return;
    }
    const id = creatingUser ? uid('user') : selectedUserId;
    const selected = data.users.find(u => u.id === selectedUserId);
    if (!creatingUser && !selected) return;
    if (selected?.id === currentUser.id && personDraft.role !== 'owner') return alert('目前登入的 Owner 不可降級自己');
    const passwordHash = personDraft.password ? await sha256(personDraft.password) : selected?.passwordHash || '';
    const managedIds = personDraft.role === 'owner' ? [] : activeVessels.filter(v => personDraft.managedVesselIds.includes(v.id)).map(v => v.id);
    commit(d => {
      let user = d.users.find(u => u.id === id);
      if (!user) {
        user = { id, createdAt: nowIso(), updatedAt: nowIso(), passwordHash, department: '', name: '', username: '', role: 'operator', isActive: true, managedVesselIds: [] };
        d.users.push(user);
      }
      Object.assign(user, { department: normalizedDepartment, name: personDraft.name.trim(), username: personDraft.username.trim(), role: personDraft.role, isActive: personDraft.isActive, managedVesselIds: managedIds, passwordHash, updatedAt: nowIso() });
      if (user.department && !d.settings.departments.includes(user.department)) d.settings.departments.push(user.department);
      d.vessels.forEach(v => {
        const assigned = personDraft.role !== 'vessel' && managedIds.includes(v.id);
        v.assignedUserIds = assigned ? Array.from(new Set([...v.assignedUserIds, id])) : v.assignedUserIds.filter(userId => userId !== id);
      });
    }, creatingUser ? '新增人員' : '更新人員', 'user', id, personDraft.name.trim());
    setCreatingUser(false);
    setSelectedUserId(id);
    setSaveNotice(`✓ ${creatingUser ? '人員已建立' : '人員資料已保存'}`);
  };

  const clearPersonPassword = () => {
    if (!owner || !selectedUserId || selectedUserId === currentUser.id) return alert('只有 Owner 可以清除其他人員的密碼');
    const target = data.users.find(user => user.id === selectedUserId);
    if (!target || target.role === 'owner') return alert('不可清除 Owner 密碼');
    if (!window.confirm(`清除「${target.name}」的登入密碼後，該人員可無密碼登入。是否繼續？`)) return;
    commit(draft => { const user = draft.users.find(item => item.id === selectedUserId); if (user) { user.passwordHash = ''; user.updatedAt = nowIso(); } }, 'Owner 清除人員密碼', 'user', selectedUserId, `${target.name} 改為無密碼登入`);
    setPersonDraft(previous => ({ ...previous, password: '' }));
    setSaveNotice('✓ 密碼已清除，可無密碼登入');
  };

  const disablePerson = () => {
    if (!canManageUsers || !selectedUserId) return alert('目前角色未獲授權停用人員');
    if (selectedUserId === currentUser.id) return alert('不可停用目前登入的 Owner');
    const target = data.users.find(u => u.id === selectedUserId);
    if (!owner && target?.role === 'owner') return alert('管理員不可停用 Owner');
    if (!target || !confirm(`確定停用「${target.name}」？`)) return;
    commit(d => {
      const user = d.users.find(u => u.id === selectedUserId);
      if (user) { user.isActive = false; user.updatedAt = nowIso(); }
      d.vessels.forEach(v => { v.assignedUserIds = v.assignedUserIds.filter(id => id !== selectedUserId); });
    }, '停用人員', 'user', selectedUserId, target.name);
    const next = activeUsers.find(u => u.id !== selectedUserId);
    if (next) selectUser(next.id);
  };

  const saveVessel = () => {
    if (!canManageVessels) return alert('目前角色未獲授權管理船舶');
    if (!shipDraft.shortName.trim() && !shipDraft.name.trim()) return alert('請填寫船名或簡稱');
    const id = creatingVessel ? uid('vessel') : selectedVesselId;
    const assignedIds = activeUsers.filter(u => canManageVesselAssignments(u) && shipDraft.assignedUserIds.includes(u.id)).map(u => u.id);
    commit(d => {
      let vessel = d.vessels.find(v => v.id === id);
      if (!vessel) {
        const at = nowIso();
        vessel = {
          id, createdAt: at, updatedAt: at, name: '', shortName: '', fullName: '', shipType: '', fleetCategory: 'tanker fleet', fleetTags: [], assignedUserIds: [], isActive: true,
          position: { source: 'manual', location: '', speedKnots: 0, navigationStatus: '航行', lastPort: '', nextPort: '', eta: '', etb: '', etd: '', updatedAt: at, manualRemark: '' },
          cargo: { source: 'manual', loadStatus: '空載', name: '', quantity: '', items: [], updatedAt: at },
          note: { statusList: [], recentDynamics: '', subsequentDynamics: '', updatedAt: at },
          weeklyAttention: [],
        };
        d.vessels.push(vessel);
      }
      Object.assign(vessel, { name: shipDraft.name.trim() || shipDraft.shortName.trim(), shortName: shipDraft.shortName.trim() || shipDraft.name.trim(), fullName: shipDraft.fullName.trim(), shipType: shipDraft.shipType.trim(), fleetCategory: shipDraft.fleetCategory, isActive: shipDraft.isActive, assignedUserIds: assignedIds, updatedAt: nowIso() });
      d.users.forEach(u => {
        if (u.role === 'owner') { u.managedVesselIds = []; return; }
        if (!canManageVesselAssignments(u)) return;
        const assigned = assignedIds.includes(u.id);
        u.managedVesselIds = assigned ? Array.from(new Set([...(u.managedVesselIds || []), id])) : (u.managedVesselIds || []).filter(vesselId => vesselId !== id);
      });
    }, creatingVessel ? '新增船舶' : '更新船舶', 'vessel', id, vesselDisplayName(shipDraft));
    setCreatingVessel(false);
    setSelectedVesselId(id);
    setSaveNotice(`✓ ${creatingVessel ? '船舶已建立' : '船舶資料已保存'}`);
  };

  const disableVessel = () => {
    if (!canManageVessels) return alert('目前角色未獲授權停用船舶');
    if (!selectedVesselId) return;
    const target = data.vessels.find(v => v.id === selectedVesselId);
    if (!target || !confirm(`確定停用「${vesselDisplayName(target)}」？`)) return;
    commit(d => {
      const vessel = d.vessels.find(v => v.id === selectedVesselId);
      if (vessel) { vessel.isActive = false; vessel.updatedAt = nowIso(); }
      d.users.forEach(u => {
        const wasBound = (u.managedVesselIds || []).includes(selectedVesselId);
        u.managedVesselIds = (u.managedVesselIds || []).filter(id => id !== selectedVesselId);
        if (wasBound && u.role === 'vessel') u.isActive = false;
      });
    }, '停用船舶', 'vessel', selectedVesselId, vesselDisplayName(target));
    const next = activeVessels.find(v => v.id !== selectedVesselId);
    if (next) selectVessel(next.id);
  };

  const directoryItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const users = activeUsers.map(u => ({ key: `user:${u.id}`, kind: 'user' as const, title: u.name, subtitle: `${u.department}｜${roleLabel(u.role)}`, meta: `${(u.managedVesselIds || []).length} 艘船` }));
    const vessels = activeVessels.map(v => { const names = managerNames(activeUsers, v.assignedUserIds); return { key: `vessel:${v.id}`, kind: 'vessel' as const, title: vesselDisplayName(v), subtitle: v.shipType || '未填船型', meta: names.length ? `${names.length} 人｜${names.join('、')}` : '0 人' }; });
    return [...users, ...vessels].filter(item => (directoryKind === 'all' || item.kind === directoryKind) && (!q || `${item.title} ${item.subtitle} ${item.meta}`.toLowerCase().includes(q)));
  }, [activeUsers, activeVessels, directoryKind, query]);
  const personDepartments = Array.from(new Set(activeUsers.map(user => user.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const filteredPeople = activeUsers.filter(u => canManageUsers ? (owner || u.role !== 'owner') : u.id === currentUser.id).filter(u => departmentFilter === 'all' || u.department === departmentFilter).filter(u => !query.trim() || `${u.name} ${u.department} ${u.username} ${roleLabel(u.role)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredVessels = activeVessels.filter(v => !query.trim() || `${v.name} ${v.shortName} ${v.fullName} ${v.shipType}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedDirectory = directoryItems.find(item => item.key === directorySelection) || directoryItems[0];
  const selectedAudit = data.auditLogs.find(log => log.id === auditId) || data.auditLogs[0];

  const nav = [
    { id: 'directory' as const, icon: '▦', label: '總清單' },
    ...(canManageUsers ? [{ id: 'people' as const, icon: '♟', label: '人員' }] : [{ id: 'people' as const, icon: '♟', label: '我的帳號' }]),
    ...(canManageVessels ? [{ id: 'vessels' as const, icon: '🚢', label: '船舶' }] : []),
    ...(canManageCategories ? [{ id: 'categories' as const, icon: '≡', label: '分類管理' }] : []),
    { id: 'attention' as const, icon: '◉', label: '關注度說明' },
    { id: 'roles' as const, icon: '◆', label: '角色權限' },
    ...(canManageSystem ? [{ id: 'owner' as const, icon: '🔐', label: 'Owner 與雲端' }] : []),
    ...(canViewAudit ? [{ id: 'audit' as const, icon: '▤', label: '操作紀錄' }] : []),
  ];

  return <section className="management-view">
    <div className="page-heading management-heading"><div><h1>管理中心</h1><p>B 版主從管理：先從總清單或中間欄選擇，再在右側編輯單筆資料。</p></div><div className="management-kpis"><span><small>人員</small><b>{activeUsers.length}</b></span><span><small>船舶</small><b>{activeVessels.length}</b></span><span><small>管理員</small><b>{activeUsers.filter(u => u.role === 'owner' || u.role === 'admin').length}</b></span></div></div>
    <div className="management-shell">
      <aside className="management-sidebar"><h2>管理功能</h2>{nav.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => go(item.id)}><i>{item.icon}</i>{item.label}</button>)}<div className="management-sidebar-note"><b>{currentUser.name}</b><span>{roleLabel(currentUser.role)}</span></div></aside>

      {section === 'directory' && <>
        <div className="management-master"><MasterHeader title="總清單" count={directoryItems.length} query={query} setQuery={setQuery}/><div className="management-segments"><button className={directoryKind === 'all' ? 'active' : ''} onClick={() => setDirectoryKind('all')}>全部</button><button className={directoryKind === 'user' ? 'active' : ''} onClick={() => setDirectoryKind('user')}>人員</button><button className={directoryKind === 'vessel' ? 'active' : ''} onClick={() => setDirectoryKind('vessel')}>船舶</button></div><div className="management-list">{directoryItems.map(item => <button key={item.key} className={`management-list-item ${selectedDirectory?.key === item.key ? 'active' : ''}`} onClick={() => setDirectorySelection(item.key)}><span className={`management-avatar ${item.kind}`}>{item.kind === 'user' ? item.title.slice(0, 1) : '🚢'}</span><span><b>{item.title}</b><small>{item.subtitle}</small></span><em>{item.meta}</em></button>)}</div></div>
        <div className="management-detail">{selectedDirectory ? <DirectoryDetail item={selectedDirectory} data={data} onEdit={() => { if (selectedDirectory.kind === 'user') { selectUser(selectedDirectory.key.slice(5)); go('people'); } else { selectVessel(selectedDirectory.key.slice(7)); go('vessels'); } }}/>:<EmptyDetail text="沒有符合條件的資料"/>}</div>
      </>}

      {section === 'people' && <>
        <div className="management-master"><MasterHeader title={canManageUsers ? '人員' : '我的帳號'} count={filteredPeople.length} query={query} setQuery={setQuery} action={canManageUsers ? { label: '＋ 新增', onClick: startNewUser } : undefined}/>{canManageUsers && <label className="management-department-filter"><span>人員部門篩選</span><select aria-label="人員部門篩選" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="all">全部部門</option>{personDepartments.map(department => <option key={department} value={department}>{department}</option>)}</select></label>}<div className="management-list">{filteredPeople.map(u => <button key={u.id} className={`management-list-item ${!creatingUser && selectedUserId === u.id ? 'active' : ''}`} onClick={() => selectUser(u.id)}><span className="management-avatar">{u.name.slice(0, 1)}</span><span><b>{u.name}</b><small>{u.department}｜{(u.managedVesselIds || []).length} 艘船</small></span><em className={`role-${u.role}`}>{roleLabel(u.role)}</em></button>)}</div></div>
        <div className="management-detail"><PersonEditor draft={personDraft} setDraft={setPersonDraft} creating={creatingUser} owner={owner} manager={canManageUsers} currentUser={currentUser} selectedUserId={selectedUserId} departments={data.settings.departments} vessels={activeVessels} assignmentQuery={assignmentQuery} setAssignmentQuery={setAssignmentQuery} onSave={savePerson} onDisable={disablePerson} onClearPassword={clearPersonPassword}/></div>
      </>}

      {section === 'vessels' && <>
        <div className="management-master"><MasterHeader title="船舶" count={filteredVessels.length} query={query} setQuery={setQuery} action={{ label: '＋ 新增', onClick: startNewVessel }}/><div className="management-list">{filteredVessels.map(v => <button key={v.id} className={`management-list-item ${!creatingVessel && selectedVesselId === v.id ? 'active' : ''}`} onClick={() => selectVessel(v.id)}><span className="management-avatar vessel">🚢</span><span><b>{vesselDisplayName(v)}</b><small>{v.shipType || '未填船型'}｜{v.fleetCategory}</small></span><em>{managerNames(activeUsers, v.assignedUserIds).length ? `${managerNames(activeUsers, v.assignedUserIds).length} 人｜${managerNames(activeUsers, v.assignedUserIds).join('、')}` : '0 人'}</em></button>)}</div></div>
        <div className="management-detail"><VesselEditor draft={shipDraft} setDraft={setShipDraft} creating={creatingVessel} users={activeUsers.filter(canManageVesselAssignments)} assignmentQuery={assignmentQuery} setAssignmentQuery={setAssignmentQuery} onSave={saveVessel} onDisable={disableVessel}/></div>
      </>}

      {section === 'categories' && canManageCategories && <>
        <div className="management-master"><div className="management-master-heading"><div><h2>分類管理 <small>{data.settings.taskCategories.length + data.settings.meetingTaskCategories.length}</small></h2><small>要事分類與臨會/專題待辦分類完全分開</small></div></div><div className="management-list"><div className="management-list-item category-summary"><span className="management-avatar category">要</span><span><b>要事分類</b><small>{data.settings.taskCategories.length} 個；普通/早會來源待辦使用</small></span><em>{data.tasks.filter(task => !isMeetingTaskSource(task)).length} 件</em></div>{data.settings.taskCategories.map((category, index) => <div key={`task-${category}-${index}`} className="management-list-item category-summary"><span className="management-avatar category">≡</span><span><b>{category}</b><small>{WEEKLY_ATTENTION_CATEGORY_MAP[category] ? '自動點亮看板狀態' : '一般要事分類'}</small></span><em>{data.tasks.filter(task => !isMeetingTaskSource(task) && taskCategoriesOf(task).includes(category)).length} 件</em></div>)}<div className="management-list-item category-summary"><span className="management-avatar meeting">臨</span><span><b>臨會/專題待辦分類</b><small>{data.settings.meetingTaskCategories.length} 個；臨會來源待辦使用</small></span><em>{data.tasks.filter(task => isMeetingTaskSource(task)).length} 件</em></div>{data.settings.meetingTaskCategories.map((category, index) => <div key={`meeting-${category}-${index}`} className="management-list-item category-summary"><span className="management-avatar meeting">◇</span><span><b>{category}</b><small>臨會/專題待辦分類</small></span><em>{data.tasks.filter(task => isMeetingTaskSource(task) && taskCategoriesOf(task).includes(category)).length} 件</em></div>)}</div></div>
        <div className="management-detail"><div className="management-category-stack"><TaskCategoryManager key={`task-${data.revision}`} title="要事分類" subtitle="只套用於普通要事／早會來源待辦；歷史要事分類不會被改寫。" categories={data.settings.taskCategories} tasks={data.tasks.filter(task=>!isMeetingTaskSource(task))} onSave={categories => { commit(d => { d.settings.taskCategories = categories; d.settings.taskCategorySchemaVersion = 2; }, '更新要事分類', 'settings', 'task-categories', categories.join('、')); setSaveNotice('要事分類已保存'); }}/><TaskCategoryManager key={`meeting-${data.revision}`} title="臨會/專題待辦分類" subtitle="只套用於臨會/專題來源待辦；不會混入普通要事分類。" categories={data.settings.meetingTaskCategories} tasks={data.tasks.filter(task=>isMeetingTaskSource(task))} onSave={categories => { commit(d => { d.settings.meetingTaskCategories = categories; d.settings.meetingTaskCategorySchemaVersion = 2; }, '更新臨會/專題待辦分類', 'settings', 'meeting-task-categories', categories.join('、')); setSaveNotice('臨會/專題待辦分類已保存'); }}/></div></div>
      </>}

      {section === 'attention' && <><div className="management-master"><div className="management-master-heading"><div><h2>關注度規則</h2><small>自動下限與手動提高</small></div></div><div className="management-list"><div className="management-list-item category-summary"><span className="management-avatar">特</span><span><b>特別關注</b><small>最高人工關注</small></span></div><div className="management-list-item category-summary"><span className="management-avatar">急</span><span><b>存在急件</b><small>最高自動關注</small></span></div><div className="management-list-item category-summary"><span className="management-avatar">高</span><span><b>事故／異常／PSC</b><small>至少高關注</small></span></div><div className="management-list-item category-summary"><span className="management-avatar">中</span><span><b>其他狀態燈</b><small>至少中關注</small></span></div><div className="management-list-item category-summary"><span className="management-avatar">低</span><span><b>其餘情況</b><small>例行關注</small></span></div></div></div><div className="management-detail"><AttentionGuide/></div></>}

      {section === 'roles' && <><div className="management-master"><div className="management-master-heading"><div><h2>角色權限</h2><small>精細權限矩陣</small></div></div>{(['owner','admin','operator','vessel'] as UserRole[]).map(role => <div key={role} className="management-list-item"><span className="management-avatar">{roleLabel(role).slice(0,1)}</span><span><b>{roleLabel(role)}</b><small>{activeUsers.filter(u => u.role === role).length} 人</small></span></div>)}</div><div className="management-detail"><RolePermissionMatrix matrix={data.settings.rolePermissions} editable={owner} onChange={(role,key,value)=>commit(d=>{const next=structuredClone(d.settings.rolePermissions);next[role][key]=value;d.settings.rolePermissions=normalizeRolePermissions(next);},'更新角色權限','settings','role-permissions',`${roleLabel(role)}｜${PERMISSION_LABELS[key].label}｜${value?'開啟':'關閉'}`)}/></div></>}

      {section === 'owner' && owner && <><div className="management-master"><div className="management-master-heading"><div><h2>Owner 與雲端</h2><small>敏感設定集中管理</small></div></div><div className="management-list"><button className={`management-list-item ${ownerPanel === 'gate' ? 'active' : ''}`} onClick={() => setOwnerPanel('gate')}><span className="management-avatar">🔐</span><span><b>進站密碼</b><small>網站第一道存取門</small></span></button><button className={`management-list-item ${ownerPanel === 'supabase' ? 'active' : ''}`} onClick={() => setOwnerPanel('supabase')}><span className="management-avatar">☁</span><span><b>Supabase 設定</b><small>工作區與資料表</small></span></button><button className={`management-list-item ${ownerPanel === 'cloud' ? 'active' : ''}`} onClick={() => setOwnerPanel('cloud')}><span className="management-avatar">↕</span><span><b>雲端資料</b><small>載入或保存主資料</small></span></button></div></div><div className="management-detail"><OwnerSettings panel={ownerPanel} sitePassword={sitePassword} setSitePassword={setSitePassword} config={config} setConfig={setConfig} data={data} commit={commit}/></div></>}

      {section === 'audit' && <><div className="management-master"><MasterHeader title="操作紀錄" count={data.auditLogs.length} query={query} setQuery={setQuery}/><div className="management-list">{data.auditLogs.filter(log => !query.trim() || `${log.actorName} ${log.action} ${log.detail}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0,100).map(log => <button key={log.id} className={`management-list-item ${selectedAudit?.id === log.id ? 'active' : ''}`} onClick={() => setAuditId(log.id)}><span className="management-avatar audit">▤</span><span><b>{log.action}</b><small>{log.actorName}｜{new Date(log.at).toLocaleString()}</small></span></button>)}</div></div><div className="management-detail">{selectedAudit ? <div className="management-editor"><EditorHeading title={selectedAudit.action} subtitle="操作紀錄詳細資料"/><div className="management-summary-grid"><Summary label="操作者" value={selectedAudit.actorName}/><Summary label="角色" value={roleLabel(selectedAudit.actorRole)}/><Summary label="時間" value={new Date(selectedAudit.at).toLocaleString()}/></div><EditorSection title="內容"><p>{selectedAudit.detail || '無補充內容'}</p><p className="muted">{selectedAudit.entityType}｜{selectedAudit.entityId}</p></EditorSection></div>:<EmptyDetail text="目前沒有操作紀錄"/>}</div></>}
    </div>
    {saveNotice && <div className="management-save-toast" role="status" aria-live="polite">{saveNotice}</div>}
  </section>;
}

function MasterHeader({ title, count, query, setQuery, action }: { title:string; count:number; query:string; setQuery:(value:string)=>void; action?:{label:string;onClick:()=>void} }) {
  return <div className="management-master-heading"><div><h2>{title} <small>{count}</small></h2></div>{action && <button className="btn small primary" onClick={action.onClick}>{action.label}</button>}<input value={query} onChange={e => setQuery(e.target.value)} placeholder={`搜尋${title}…`}/></div>;
}
function EditorHeading({ title, subtitle, actions }: { title:string; subtitle:string; actions?:React.ReactNode }) { return <div className="management-editor-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{actions && <div className="management-editor-actions">{actions}</div>}</div>; }
function EditorSection({ title, children }: { title:string; children:React.ReactNode }) { return <section className="management-editor-section"><h3>{title}</h3><div className="management-editor-section-body">{children}</div></section>; }
function Summary({ label, value }: { label:string; value:string|number }) { return <div className="management-summary"><small>{label}</small><b>{value}</b></div>; }
function EmptyDetail({ text }: { text:string }) { return <div className="management-empty"><b>尚未選擇資料</b><span>{text}</span></div>; }

function DirectoryDetail({ item, data, onEdit }: { item:{key:string;kind:'user'|'vessel';title:string;subtitle:string;meta:string}; data:AppData; onEdit:()=>void }) {
  const id = item.key.split(':')[1];
  if (item.kind === 'user') {
    const user = data.users.find(u => u.id === id)!;
    const ships = data.vessels.filter(v => v.isActive && (v.assignedUserIds.includes(id) || (user.managedVesselIds || []).includes(v.id)));
    return <div className="management-editor"><EditorHeading title={user.name} subtitle={`${user.department}｜${roleLabel(user.role)}`} actions={<button className="btn primary" onClick={onEdit}>開啟人員設定</button>}/><div className="management-summary-grid"><Summary label="角色" value={roleLabel(user.role)}/><Summary label="經管船舶" value={`${ships.length} 艘`}/><Summary label="狀態" value={user.isActive ? '啟用' : '停用'}/></div><EditorSection title="經管船舶"><div className="management-tags">{ships.length ? ships.map(v => <span key={v.id}>{vesselDisplayName(v)}</span>) : <em>尚未指派</em>}</div></EditorSection></div>;
  }
  const vessel = data.vessels.find(v => v.id === id)!;
  const people = data.users.filter(u => u.isActive && vessel.assignedUserIds.includes(u.id));
  const names = people.map(user => user.name);
  return <div className="management-editor"><EditorHeading title={vesselDisplayName(vessel)} subtitle={vessel.shipType || '未填船型'} actions={<button className="btn primary" onClick={onEdit}>開啟船舶設定</button>}/><div className="management-summary-grid"><Summary label="船隊" value={vessel.fleetCategory}/><Summary label="經管人員" value={names.length ? `${names.length} 人｜${names.join('、')}` : '0 人'}/><Summary label="狀態" value={vessel.isActive ? '啟用' : '停用'}/></div><EditorSection title="經管人員"><div className="management-tags">{people.length ? people.map(u => <span key={u.id}>{u.name}</span>) : <em>尚未指派</em>}</div></EditorSection></div>;
}

function PersonEditor({ draft, setDraft, creating, owner, manager, currentUser, selectedUserId, departments, vessels, assignmentQuery, setAssignmentQuery, onSave, onDisable, onClearPassword }: { draft:UserDraft; setDraft:React.Dispatch<React.SetStateAction<UserDraft>>; creating:boolean; owner:boolean; manager:boolean; currentUser:UserAccount; selectedUserId:string; departments:string[]; vessels:Vessel[]; assignmentQuery:string; setAssignmentQuery:(v:string)=>void; onSave:()=>void; onDisable:()=>void; onClearPassword:()=>void }) {
  const visibleAssignments = vessels.filter(v => !assignmentQuery.trim() || `${v.shortName} ${v.fullName} ${v.name}`.toLowerCase().includes(assignmentQuery.trim().toLowerCase()));
  const departmentChoices = Array.from(new Set([draft.department, ...departments])).filter(department => department && department !== '船舶帳戶');
  const toggle = (id:string) => setDraft(prev => ({ ...prev, managedVesselIds: prev.role === 'owner' ? [] : prev.role === 'vessel' ? (prev.managedVesselIds.includes(id) ? [] : [id]) : prev.managedVesselIds.includes(id) ? prev.managedVesselIds.filter(x => x !== id) : [...prev.managedVesselIds, id] }));
  return <div className="management-editor"><EditorHeading title={creating ? '新增人員' : draft.name || '人員設定'} subtitle={creating ? '建立帳號、角色與經管船舶' : `${draft.department}｜${roleLabel(draft.role)}`} actions={<>{!creating && manager && selectedUserId !== currentUser.id && <button className="btn danger" onClick={onDisable}>停用</button>}<button className="btn primary" onClick={onSave}>{creating ? '建立人員' : '保存變更'}</button></>}/><div className="management-summary-grid"><Summary label="角色" value={roleLabel(draft.role)}/><Summary label="資料範圍" value={draft.role==='owner'?'全船隊':draft.role==='admin'?`全船可見｜經管 ${draft.managedVesselIds.length} 艘`:`${draft.managedVesselIds.length} 艘`}/><Summary label="帳號狀態" value={draft.isActive ? '啟用' : '停用'}/></div><EditorSection title="基本資料與角色"><div className="management-form"><label>姓名<input disabled={!manager && selectedUserId !== currentUser.id} value={draft.name} onChange={e => setDraft(prev => ({...prev,name:e.target.value}))}/></label><label>用戶名<input disabled={!manager && selectedUserId !== currentUser.id} value={draft.username} onChange={e => setDraft(prev => ({...prev,username:e.target.value}))}/></label><label>部門<select aria-label="人員部門" disabled={!manager || draft.role === 'vessel'} value={draft.role === 'vessel' ? '船舶帳戶' : draft.department} onChange={e => setDraft(prev => ({...prev,department:e.target.value}))}>{draft.role === 'vessel' ? <option value="船舶帳戶">船舶帳戶</option> : departmentChoices.map(department => <option key={department} value={department}>{department}</option>)}</select></label><label>角色<select disabled={!manager || selectedUserId === currentUser.id} value={draft.role} onChange={e => setDraft(prev => { const role = e.target.value as UserRole; return {...prev,role,department:departmentAfterRoleChange(prev.department,role,departments),managedVesselIds:role==='owner'?[]:role==='vessel'?prev.managedVesselIds.slice(0,1):prev.managedVesselIds}; })}><option value="operator">操作員</option><option value="vessel">船舶帳戶</option>{(owner||draft.role==='admin')&&<option value="admin">管理員</option>}{owner&&<option value="owner">Owner</option>}</select></label></div></EditorSection>{manager && draft.role !== 'owner' && <EditorSection title="經管船舶"><AssignmentPicker query={assignmentQuery} setQuery={setAssignmentQuery} count={draft.managedVesselIds.length} onAll={() => setDraft(prev => ({...prev,managedVesselIds:prev.role==='vessel'?vessels.slice(0,1).map(v=>v.id):vessels.map(v=>v.id)}))} onClear={() => setDraft(prev => ({...prev,managedVesselIds:[]}))}>{visibleAssignments.map(v => <label key={v.id} className={draft.managedVesselIds.includes(v.id) ? 'selected' : ''}><input type="checkbox" checked={draft.managedVesselIds.includes(v.id)} onChange={() => toggle(v.id)}/><span>{vesselDisplayName(v)}</span><small>{v.shipType || '未填船型'}</small></label>)}</AssignmentPicker></EditorSection>}<EditorSection title="密碼"><div className="management-password"><div><b>{creating ? '初始密碼' : owner&&selectedUserId!==currentUser.id&&draft.role!=='owner' ? 'Owner 重設密碼' : '重設密碼'}</b><small>{owner&&selectedUserId!==currentUser.id&&draft.role!=='owner' ? 'Owner 可重設或清除此人員密碼；不保存、也不顯示既有明文。' : '自己的密碼輸入後保存；留空表示不變更。'}</small></div><input disabled={!creating&&selectedUserId!==currentUser.id&&!owner} type="password" value={draft.password} placeholder={creating ? '請設定初始密碼' : '留空表示不變更'} onChange={e => setDraft(prev => ({...prev,password:e.target.value}))}/>{!creating&&owner&&selectedUserId!==currentUser.id&&draft.role!=='owner'&&<button className="btn danger" onClick={onClearPassword}>清除密碼</button>}</div></EditorSection></div>;
}

function VesselEditor({ draft, setDraft, creating, users, assignmentQuery, setAssignmentQuery, onSave, onDisable }: { draft:VesselDraft; setDraft:React.Dispatch<React.SetStateAction<VesselDraft>>; creating:boolean; users:UserAccount[]; assignmentQuery:string; setAssignmentQuery:(v:string)=>void; onSave:()=>void; onDisable:()=>void }) {
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const departments = Array.from(new Set(users.map(user => user.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const selectedManagers = managerNames(users, draft.assignedUserIds);
  const visibleAssignments = users
    .filter(user => departmentFilter === 'all' || user.department === departmentFilter)
    .filter(user => !assignmentQuery.trim() || `${user.name} ${user.department} ${user.username} ${roleLabel(user.role)}`.toLowerCase().includes(assignmentQuery.trim().toLowerCase()));
  const toggle = (id:string) => setDraft(prev => ({ ...prev, assignedUserIds: prev.assignedUserIds.includes(id) ? prev.assignedUserIds.filter(x => x !== id) : [...prev.assignedUserIds, id] }));
  return <div className="management-editor"><EditorHeading title={creating ? '新增船舶' : vesselDisplayName(draft)} subtitle={creating ? '建立船舶基本資料與經管人員' : draft.shipType || '未填船型'} actions={<>{!creating && <button className="btn danger" onClick={onDisable}>停用</button>}<button className="btn primary" onClick={onSave}>{creating ? '建立船舶' : '保存變更'}</button></>}/><div className="management-summary-grid"><Summary label="船隊" value={draft.fleetCategory}/><Summary label="經管人員" value={selectedManagers.length ? `${selectedManagers.length} 人｜${selectedManagers.join('、')}` : '0 人'}/><Summary label="狀態" value={draft.isActive ? '啟用' : '停用'}/></div><EditorSection title="船舶資料"><div className="management-form"><label>系統名稱<input value={draft.name} onChange={e => setDraft(prev => ({...prev,name:e.target.value}))}/></label><label>簡稱<input value={draft.shortName} onChange={e => setDraft(prev => ({...prev,shortName:e.target.value}))}/></label><label className="span-2">完整船名<input value={draft.fullName} onChange={e => setDraft(prev => ({...prev,fullName:e.target.value}))}/></label><label>船型<input value={draft.shipType} onChange={e => setDraft(prev => ({...prev,shipType:e.target.value}))}/></label><label>船隊<select value={draft.fleetCategory} onChange={e => setDraft(prev => ({...prev,fleetCategory:e.target.value}))}><option value="tanker fleet">油輪船隊</option><option value="bulk fleet">散貨船隊</option></select></label></div></EditorSection><EditorSection title="經管人員"><AssignmentPicker query={assignmentQuery} setQuery={setAssignmentQuery} count={draft.assignedUserIds.length} department={departmentFilter} setDepartment={setDepartmentFilter} departments={departments} departmentLabel="經管部門篩選" selectedNames={selectedManagers} onAll={() => setDraft(prev => ({...prev,assignedUserIds:visibleAssignments.map(user=>user.id)}))} onClear={() => setDraft(prev => ({...prev,assignedUserIds:[]}))}>{visibleAssignments.map(user => <label key={user.id} className={draft.assignedUserIds.includes(user.id) ? 'selected' : ''}><input type="checkbox" checked={draft.assignedUserIds.includes(user.id)} onChange={() => toggle(user.id)}/><span>{user.name}</span><small>{user.department}｜{roleLabel(user.role)}</small></label>)}</AssignmentPicker></EditorSection></div>;
}

function AssignmentPicker({ query, setQuery, count, onAll, onClear, children, department, setDepartment, departments = [], departmentLabel = '部門篩選', selectedNames = [] }: { query:string; setQuery:(v:string)=>void; count:number; onAll:()=>void; onClear:()=>void; children:React.ReactNode; department?:string; setDepartment?:(value:string)=>void; departments?:string[]; departmentLabel?:string; selectedNames?:string[] }) {
  return <div className="management-assignment"><div className="management-assignment-tools">{setDepartment && <label className="assignment-department-filter"><span>{departmentLabel}</span><select aria-label={departmentLabel} value={department || 'all'} onChange={event => setDepartment(event.target.value)}><option value="all">全部部門</option>{departments.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}<input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋後勾選…"/><span>已選 {count}{selectedNames.length ? `｜${selectedNames.join('、')}` : ''}</span><button className="btn small ghost" onClick={onAll}>全選</button><button className="btn small ghost" onClick={onClear}>清空</button></div><div className="management-assignment-grid">{children}</div></div>;
}
function TaskCategoryManager({ title, subtitle, categories, tasks, onSave }: { title:string; subtitle:string; categories:string[]; tasks:AppData['tasks']; onSave:(categories:string[])=>void }) {
  const [draft, setDraft] = useState(() => [...categories]);
  const [newCategory, setNewCategory] = useState('');
  const usage = (category:string) => tasks.filter(task => taskCategoriesOf(task).includes(category)).length;
  const add = () => {
    const value = newCategory.trim();
    if (!value) return alert('請輸入分類名稱');
    if (draft.some(category => category.toLocaleLowerCase() === value.toLocaleLowerCase())) return alert('分類名稱不可重複');
    setDraft(prev => [...prev, value]);
    setNewCategory('');
  };
  const move = (index:number, direction:-1|1) => setDraft(prev => {
    const target = index + direction;
    if (target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const remove = (index:number) => {
    if (draft.length <= 1) return alert('至少要保留一個分類');
    const category = draft[index];
    const count = usage(category);
    if (count && !window.confirm(`「${category}」已用於 ${count} 件歷史待辦。刪除後只會從新建選單移除，歷史資料仍會保留。是否繼續？`)) return;
    setDraft(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  };
  const save = () => {
    const clean = draft.map(category => category.trim());
    if (clean.some(category => !category)) return alert('分類名稱不可留空');
    if (new Set(clean.map(category => category.toLocaleLowerCase())).size !== clean.length) return alert('分類名稱不可重複');
    onSave(clean);
  };
  return <div className="management-editor task-category-editor"><EditorHeading title={title} subtitle={subtitle} actions={<button className="btn primary" onClick={save}>保存分類設定</button>}/><EditorSection title="分類順序與名稱"><div className="task-category-list">{draft.map((category, index) => <div className="task-category-row" key={`${index}-${category}`}><span className="task-category-order">{index + 1}</span><input aria-label={`${title} 分類 ${index + 1}`} value={category} onChange={event => setDraft(prev => prev.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}/><span className={`task-category-link ${WEEKLY_ATTENTION_CATEGORY_MAP[category] ? 'linked' : ''}`}>{WEEKLY_ATTENTION_CATEGORY_MAP[category] ? '自動點亮' : `${usage(category)} 件`}</span><button className="btn small ghost" title="上移" disabled={index === 0} onClick={() => move(index, -1)}>↑ 上移</button><button className="btn small ghost" title="下移" disabled={index === draft.length - 1} onClick={() => move(index, 1)}>↓ 下移</button><button className="btn small danger" onClick={() => remove(index)}>刪除</button></div>)}</div></EditorSection><EditorSection title="新增分類"><div className="task-category-add"><input aria-label={`${title} 新分類名稱`} value={newCategory} onChange={event => setNewCategory(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} placeholder="輸入新的分類名稱"/><button className="btn primary" onClick={add}>新增分類</button></div><p className="muted">兩套分類彼此獨立：要事分類只服務普通/早會來源待辦；臨會/專題待辦分類只服務臨會來源待辦。</p></EditorSection></div>;
}

function AttentionGuide() {
  return <div className="management-editor"><EditorHeading title="船舶關注度判斷方式" subtitle="關注度採可解釋規則計算，不是 AI 或外部黑箱模型。"/><EditorSection title="自動最低等級（只看未結事項及目前狀態燈）"><ol className="attention-guide-list"><li><b>急關注：</b>存在優先級為「急」的事項。</li><li><b>高關注：</b>發生事故、存在任何「異常」事項、PSC 窗口燈點亮，或存在優先級為「高」的事項。</li><li><b>中關注：</b>除 PSC 窗口外任一狀態燈點亮，或存在優先級為「中」的事項。</li><li><b>低關注：</b>其餘情況，包括只有低優先級事項或沒有未結事項。</li></ol></EditorSection><EditorSection title="手動提高"><p>具備船舶動態編輯權限的人員，可直接點擊船舶看板右上方的關注度標籤，在「自動」及不低於目前自動下限的等級間切換。手動值可保持同級或提高到「急／特別關注」，但不能把事故、異常或 PSC 窗口降到高關注以下；手動值不會修改事項優先級。</p></EditorSection><EditorSection title="特別關注"><p>「特別關注」為最高船舶關注狀態，只能由人工設定，用於需要持續置頂關注但不應改寫個別事項優先級的船舶。</p></EditorSection><EditorSection title="一週關注狀態燈"><p>換員操作、加油加水、物料配件、維修、Survey、稽核檢查任一點亮時，船舶至少為中關注；PSC 窗口點亮時至少為高關注。相關事項分類會自動點亮，也可在看板手動開關。</p></EditorSection></div>;
}

function RolePermissionMatrix({ matrix, editable, onChange }: { matrix:RolePermissions; editable:boolean; onChange:(role:UserRole,key:PermissionKey,value:boolean)=>void }) {
  const roles: UserRole[] = ['owner','admin','operator','vessel'];
  const isFixed = (role:UserRole, key:PermissionKey) => role === 'owner' || role === 'vessel' || key === 'enterManagement' || key === 'deleteTasks' || key === 'manageRolePermissions' || key === 'manageSystemSettings' || (role === 'operator' && ['manageUsers','manageVessels','viewAuditLogs'].includes(key));
  return <div className="management-editor permission-editor"><EditorHeading title="角色權限矩陣" subtitle={editable ? '只有 Owner 可以調整；變更會寫入雲端主資料與操作紀錄。' : '目前為唯讀。只有 Owner 可以調整角色權限。'}/><div className="permission-legend"><span>● 可使用</span><span>○ 不可使用</span><span>🔒 固定安全規則</span></div>{(['業務內容','管理功能'] as const).map(group => <EditorSection key={group} title={group}><div className="permission-table"><div className="permission-row permission-head"><b>權限項目</b>{roles.map(role=><b key={role}>{roleLabel(role)}</b>)}</div>{PERMISSION_KEYS.filter(key=>PERMISSION_LABELS[key].group===group).map(key=><div className="permission-row" key={key}><span><b>{PERMISSION_LABELS[key].label}</b>{PERMISSION_LABELS[key].fixed&&<small>{PERMISSION_LABELS[key].fixed}</small>}</span>{roles.map(role=>{const fixed=isFixed(role,key);const checked=matrix[role][key];return <label key={role} className={`permission-switch ${checked?'enabled':''} ${fixed?'fixed':''}`} title={fixed?'固定安全規則':editable?'點擊切換':'僅 Owner 可調整'}><input type="checkbox" checked={checked} disabled={!editable||fixed} onChange={event=>onChange(role,key,event.target.checked)}/><i/><em>{fixed?'🔒':checked?'開':'關'}</em></label>;})}</div>)}</div></EditorSection>)}</div>;
}

function OwnerSettings({ panel, sitePassword, setSitePassword, config, setConfig, data, commit }: { panel:'gate'|'supabase'|'cloud'; sitePassword:string; setSitePassword:(v:string)=>void; config:SupabaseConfig; setConfig:React.Dispatch<React.SetStateAction<SupabaseConfig>>; data:AppData; commit:Props['commit'] }) {
  const saveGate = async () => { if (!sitePassword) return alert('請輸入新進站密碼'); const hash = await sha256(sitePassword); commit(d => { d.settings.sitePasswordHash = hash; }, '修改進站密碼', 'settings', 'site-password', 'Owner 更新進站密碼'); setSitePassword(''); alert('進站密碼已更新'); };
  if (panel === 'gate') return <div className="management-editor"><EditorHeading title="進站密碼" subtitle="網站載入後的第一道存取門"/><EditorSection title="更新密碼"><div className="management-password"><div><b>新進站密碼</b><small>只保存 SHA-256 雜湊，不保存明文。</small></div><input type="password" value={sitePassword} onChange={e => setSitePassword(e.target.value)} placeholder="輸入新密碼"/><button className="btn primary" onClick={saveGate}>保存</button></div></EditorSection></div>;
  if (panel === 'supabase') return <div className="management-editor"><EditorHeading title="Supabase 設定" subtitle="設定保存於目前瀏覽器；部署版 public 設定仍具有優先權" actions={<button className="btn primary" onClick={() => { saveSupabaseConfig(config); window.location.reload(); }}>保存設定並重新載入</button>}/><EditorSection title="連線資訊"><div className="management-form one"><label>Project URL<input value={config.supabaseUrl} onChange={e => setConfig(prev => ({...prev,supabaseUrl:e.target.value}))}/></label><label>Anon key<input type="password" value={config.supabaseAnonKey} onChange={e => setConfig(prev => ({...prev,supabaseAnonKey:e.target.value}))}/></label><label>工作區<input value={config.workspaceKey} onChange={e => setConfig(prev => ({...prev,workspaceKey:e.target.value}))}/></label><label>資料表<input value={config.tableName || ''} onChange={e => setConfig(prev => ({...prev,tableName:e.target.value}))}/></label></div></EditorSection></div>;
  return <div className="management-editor"><EditorHeading title="雲端資料" subtitle={`目前本機 revision ${data.revision}`}/><div className="management-cloud-actions"><article><b>同步與保存統一由頁首執行</b><p>請使用頁首「同步最新」或「保存修改」。系統會先檢查啟動版本與雲端 revision；偵測分歧時會阻止覆寫。</p></article></div></div>;
}
