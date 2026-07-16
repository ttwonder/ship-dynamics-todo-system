import React, { useEffect, useMemo, useState } from 'react';
import type { AppData, UserAccount, UserRole, Vessel } from './types';
import { fetchCloudData, getSupabaseConfig, saveCloudData, saveSupabaseConfig, type SupabaseConfig } from './cloud';
import { isOwner, nowIso, roleLabel, sha256, uid } from './utils';

type Section = 'directory' | 'people' | 'vessels' | 'roles' | 'owner' | 'audit';
type DirectoryKind = 'all' | 'user' | 'vessel';
type UserDraft = Pick<UserAccount, 'department' | 'name' | 'username' | 'role' | 'isActive' | 'managedVesselIds'> & { password: string };
type VesselDraft = Pick<Vessel, 'name' | 'shortName' | 'fullName' | 'shipType' | 'fleetCategory' | 'isActive' | 'assignedUserIds'>;

type Props = {
  data: AppData;
  currentUser: UserAccount;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
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
} : { department, name: '', username: '', role: 'operator', isActive: true, managedVesselIds: [], password: '123456' };
const vesselDraft = (v?: Vessel): VesselDraft => v ? {
  name: v.name,
  shortName: v.shortName,
  fullName: v.fullName,
  shipType: v.shipType,
  fleetCategory: v.fleetCategory,
  isActive: v.isActive,
  assignedUserIds: [...(v.assignedUserIds || [])],
} : { name: '', shortName: '', fullName: '', shipType: '', fleetCategory: 'tanker fleet', isActive: true, assignedUserIds: [] };

export default function ManagementView({ data, currentUser, setData, commit }: Props) {
  const owner = isOwner(currentUser);
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
  }, [selectedUserId, data.revision, creatingUser]);
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
    setSection(next);
    setQuery('');
    if (next === 'people' && !owner) selectUser(currentUser.id);
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
    if (!owner) return;
    setCreatingUser(true);
    setSelectedUserId('');
    setPersonDraft(userDraft(undefined, data.settings.departments[0] || ''));
  };
  const startNewVessel = () => {
    setCreatingVessel(true);
    setSelectedVesselId('');
    setShipDraft(vesselDraft());
  };

  const savePerson = async () => {
    if (!personDraft.name.trim() || !personDraft.username.trim()) return alert('請填寫姓名與用戶名');
    const duplicate = data.users.some(u => u.id !== selectedUserId && u.username.trim().toLowerCase() === personDraft.username.trim().toLowerCase());
    if (duplicate) return alert('用戶名已存在');
    if (!owner) {
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
    const passwordHash = personDraft.password ? await sha256(personDraft.password) : selected?.passwordHash || await sha256('123456');
    const managedIds = activeVessels.filter(v => personDraft.managedVesselIds.includes(v.id)).map(v => v.id);
    commit(d => {
      let user = d.users.find(u => u.id === id);
      if (!user) {
        user = { id, createdAt: nowIso(), updatedAt: nowIso(), passwordHash, department: '', name: '', username: '', role: 'operator', isActive: true, managedVesselIds: [] };
        d.users.push(user);
      }
      Object.assign(user, { department: personDraft.department.trim(), name: personDraft.name.trim(), username: personDraft.username.trim(), role: personDraft.role, isActive: personDraft.isActive, managedVesselIds: managedIds, passwordHash, updatedAt: nowIso() });
      if (!d.settings.departments.includes(user.department)) d.settings.departments.push(user.department);
      d.vessels.forEach(v => {
        const assigned = managedIds.includes(v.id);
        v.assignedUserIds = assigned ? Array.from(new Set([...v.assignedUserIds, id])) : v.assignedUserIds.filter(userId => userId !== id);
      });
    }, creatingUser ? '新增人員' : '更新人員', 'user', id, personDraft.name.trim());
    setCreatingUser(false);
    setSelectedUserId(id);
    setSaveNotice(`✓ ${creatingUser ? '人員已建立' : '人員資料已保存'}`);
  };

  const disablePerson = () => {
    if (!owner || !selectedUserId) return;
    if (selectedUserId === currentUser.id) return alert('不可停用目前登入的 Owner');
    const target = data.users.find(u => u.id === selectedUserId);
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
    if (!shipDraft.shortName.trim() && !shipDraft.name.trim()) return alert('請填寫船名或簡稱');
    const id = creatingVessel ? uid('vessel') : selectedVesselId;
    const selected = data.vessels.find(v => v.id === selectedVesselId);
    const assignedIds = activeUsers.filter(u => shipDraft.assignedUserIds.includes(u.id)).map(u => u.id);
    commit(d => {
      let vessel = d.vessels.find(v => v.id === id);
      if (!vessel) {
        const at = nowIso();
        vessel = {
          id, createdAt: at, updatedAt: at, name: '', shortName: '', fullName: '', shipType: '', fleetCategory: 'tanker fleet', fleetTags: [], assignedUserIds: [], isActive: true,
          position: { source: 'manual', location: '', speedKnots: 0, lastPort: '', nextPort: '', eta: '', updatedAt: at, manualRemark: '' },
          cargo: { name: '', quantity: '', updatedAt: at },
          note: { statusList: [], recentDynamics: '', subsequentDynamics: '', updatedAt: at },
        };
        d.vessels.push(vessel);
      }
      Object.assign(vessel, { name: shipDraft.name.trim() || shipDraft.shortName.trim(), shortName: shipDraft.shortName.trim() || shipDraft.name.trim(), fullName: shipDraft.fullName.trim(), shipType: shipDraft.shipType.trim(), fleetCategory: shipDraft.fleetCategory, isActive: shipDraft.isActive, assignedUserIds: assignedIds, updatedAt: nowIso() });
      d.users.forEach(u => {
        const assigned = assignedIds.includes(u.id);
        u.managedVesselIds = assigned ? Array.from(new Set([...(u.managedVesselIds || []), id])) : (u.managedVesselIds || []).filter(vesselId => vesselId !== id);
      });
    }, creatingVessel ? '新增船舶' : '更新船舶', 'vessel', id, shipDraft.shortName || shipDraft.name);
    setCreatingVessel(false);
    setSelectedVesselId(id);
    setSaveNotice(`✓ ${creatingVessel ? '船舶已建立' : '船舶資料已保存'}`);
  };

  const disableVessel = () => {
    if (!selectedVesselId) return;
    const target = data.vessels.find(v => v.id === selectedVesselId);
    if (!target || !confirm(`確定停用「${target.shortName || target.name}」？`)) return;
    commit(d => {
      const vessel = d.vessels.find(v => v.id === selectedVesselId);
      if (vessel) { vessel.isActive = false; vessel.updatedAt = nowIso(); }
      d.users.forEach(u => { u.managedVesselIds = (u.managedVesselIds || []).filter(id => id !== selectedVesselId); });
    }, '停用船舶', 'vessel', selectedVesselId, target.shortName || target.name);
    const next = activeVessels.find(v => v.id !== selectedVesselId);
    if (next) selectVessel(next.id);
  };

  const directoryItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const users = activeUsers.map(u => ({ key: `user:${u.id}`, kind: 'user' as const, title: u.name, subtitle: `${u.department}｜${roleLabel(u.role)}`, meta: `${(u.managedVesselIds || []).length} 艘船` }));
    const vessels = activeVessels.map(v => ({ key: `vessel:${v.id}`, kind: 'vessel' as const, title: v.shortName || v.name, subtitle: `${v.fullName || '未填全名'}｜${v.shipType || '未填船型'}`, meta: `${v.assignedUserIds.length} 人` }));
    return [...users, ...vessels].filter(item => (directoryKind === 'all' || item.kind === directoryKind) && (!q || `${item.title} ${item.subtitle} ${item.meta}`.toLowerCase().includes(q)));
  }, [activeUsers, activeVessels, directoryKind, query]);
  const personDepartments = Array.from(new Set(activeUsers.map(user => user.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const filteredPeople = activeUsers.filter(u => owner ? true : u.id === currentUser.id).filter(u => departmentFilter === 'all' || u.department === departmentFilter).filter(u => !query.trim() || `${u.name} ${u.department} ${u.username} ${roleLabel(u.role)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredVessels = activeVessels.filter(v => !query.trim() || `${v.name} ${v.shortName} ${v.fullName} ${v.shipType}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedDirectory = directoryItems.find(item => item.key === directorySelection) || directoryItems[0];
  const selectedAudit = data.auditLogs.find(log => log.id === auditId) || data.auditLogs[0];

  const nav = [
    { id: 'directory' as const, icon: '▦', label: '總清單' },
    ...(owner ? [{ id: 'people' as const, icon: '♟', label: '人員' }] : [{ id: 'people' as const, icon: '♟', label: '我的帳號' }]),
    { id: 'vessels' as const, icon: '🚢', label: '船舶' },
    { id: 'roles' as const, icon: '◆', label: '角色權限' },
    ...(owner ? [{ id: 'owner' as const, icon: '🔐', label: 'Owner 與雲端' }] : []),
    { id: 'audit' as const, icon: '▤', label: '操作紀錄' },
  ];

  return <section className="management-view">
    <div className="page-heading management-heading"><div><h1>管理中心</h1><p>B 版主從管理：先從總清單或中間欄選擇，再在右側編輯單筆資料。</p></div><div className="management-kpis"><span><small>人員</small><b>{activeUsers.length}</b></span><span><small>船舶</small><b>{activeVessels.length}</b></span><span><small>管理員</small><b>{activeUsers.filter(u => u.role !== 'operator').length}</b></span></div></div>
    <div className="management-shell">
      <aside className="management-sidebar"><h2>管理功能</h2>{nav.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => go(item.id)}><i>{item.icon}</i>{item.label}</button>)}<div className="management-sidebar-note"><b>{currentUser.name}</b><span>{roleLabel(currentUser.role)}</span></div></aside>

      {section === 'directory' && <>
        <div className="management-master"><MasterHeader title="總清單" count={directoryItems.length} query={query} setQuery={setQuery}/><div className="management-segments"><button className={directoryKind === 'all' ? 'active' : ''} onClick={() => setDirectoryKind('all')}>全部</button><button className={directoryKind === 'user' ? 'active' : ''} onClick={() => setDirectoryKind('user')}>人員</button><button className={directoryKind === 'vessel' ? 'active' : ''} onClick={() => setDirectoryKind('vessel')}>船舶</button></div><div className="management-list">{directoryItems.map(item => <button key={item.key} className={`management-list-item ${selectedDirectory?.key === item.key ? 'active' : ''}`} onClick={() => setDirectorySelection(item.key)}><span className={`management-avatar ${item.kind}`}>{item.kind === 'user' ? item.title.slice(0, 1) : '🚢'}</span><span><b>{item.title}</b><small>{item.subtitle}</small></span><em>{item.meta}</em></button>)}</div></div>
        <div className="management-detail">{selectedDirectory ? <DirectoryDetail item={selectedDirectory} data={data} onEdit={() => { if (selectedDirectory.kind === 'user') { selectUser(selectedDirectory.key.slice(5)); go('people'); } else { selectVessel(selectedDirectory.key.slice(7)); go('vessels'); } }}/>:<EmptyDetail text="沒有符合條件的資料"/>}</div>
      </>}

      {section === 'people' && <>
        <div className="management-master"><MasterHeader title={owner ? '人員' : '我的帳號'} count={filteredPeople.length} query={query} setQuery={setQuery} action={owner ? { label: '＋ 新增', onClick: startNewUser } : undefined}/>{owner && <label className="management-department-filter"><span>人員部門篩選</span><select aria-label="人員部門篩選" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="all">全部部門</option>{personDepartments.map(department => <option key={department} value={department}>{department}</option>)}</select></label>}<div className="management-list">{filteredPeople.map(u => <button key={u.id} className={`management-list-item ${!creatingUser && selectedUserId === u.id ? 'active' : ''}`} onClick={() => selectUser(u.id)}><span className="management-avatar">{u.name.slice(0, 1)}</span><span><b>{u.name}</b><small>{u.department}｜{(u.managedVesselIds || []).length} 艘船</small></span><em className={`role-${u.role}`}>{roleLabel(u.role)}</em></button>)}</div></div>
        <div className="management-detail"><PersonEditor draft={personDraft} setDraft={setPersonDraft} creating={creatingUser} owner={owner} currentUser={currentUser} selectedUserId={selectedUserId} departments={data.settings.departments} vessels={activeVessels} assignmentQuery={assignmentQuery} setAssignmentQuery={setAssignmentQuery} onSave={savePerson} onDisable={disablePerson}/></div>
      </>}

      {section === 'vessels' && <>
        <div className="management-master"><MasterHeader title="船舶" count={filteredVessels.length} query={query} setQuery={setQuery} action={{ label: '＋ 新增', onClick: startNewVessel }}/><div className="management-list">{filteredVessels.map(v => <button key={v.id} className={`management-list-item ${!creatingVessel && selectedVesselId === v.id ? 'active' : ''}`} onClick={() => selectVessel(v.id)}><span className="management-avatar vessel">🚢</span><span><b>{v.shortName || v.name}</b><small>{v.shipType || '未填船型'}｜{v.fleetCategory}</small></span><em>{v.assignedUserIds.length} 人</em></button>)}</div></div>
        <div className="management-detail"><VesselEditor draft={shipDraft} setDraft={setShipDraft} creating={creatingVessel} users={activeUsers} assignmentQuery={assignmentQuery} setAssignmentQuery={setAssignmentQuery} onSave={saveVessel} onDisable={disableVessel}/></div>
      </>}

      {section === 'roles' && <><div className="management-master"><div className="management-master-heading"><div><h2>角色權限</h2><small>固定權限層級</small></div></div>{(['owner','admin','operator'] as UserRole[]).map(role => <button key={role} className="management-list-item" onClick={() => setDirectorySelection(role)}><span className="management-avatar">{roleLabel(role).slice(0,1)}</span><span><b>{roleLabel(role)}</b><small>{activeUsers.filter(u => u.role === role).length} 人</small></span></button>)}</div><div className="management-detail"><RoleOverview/></div></>}

      {section === 'owner' && owner && <><div className="management-master"><div className="management-master-heading"><div><h2>Owner 與雲端</h2><small>敏感設定集中管理</small></div></div><div className="management-list"><button className={`management-list-item ${ownerPanel === 'gate' ? 'active' : ''}`} onClick={() => setOwnerPanel('gate')}><span className="management-avatar">🔐</span><span><b>進站密碼</b><small>網站第一道存取門</small></span></button><button className={`management-list-item ${ownerPanel === 'supabase' ? 'active' : ''}`} onClick={() => setOwnerPanel('supabase')}><span className="management-avatar">☁</span><span><b>Supabase 設定</b><small>工作區與資料表</small></span></button><button className={`management-list-item ${ownerPanel === 'cloud' ? 'active' : ''}`} onClick={() => setOwnerPanel('cloud')}><span className="management-avatar">↕</span><span><b>雲端資料</b><small>載入或保存主資料</small></span></button></div></div><div className="management-detail"><OwnerSettings panel={ownerPanel} sitePassword={sitePassword} setSitePassword={setSitePassword} config={config} setConfig={setConfig} data={data} setData={setData} commit={commit}/></div></>}

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
    return <div className="management-editor"><EditorHeading title={user.name} subtitle={`${user.department}｜${roleLabel(user.role)}`} actions={<button className="btn primary" onClick={onEdit}>開啟人員設定</button>}/><div className="management-summary-grid"><Summary label="角色" value={roleLabel(user.role)}/><Summary label="經管船舶" value={`${ships.length} 艘`}/><Summary label="狀態" value={user.isActive ? '啟用' : '停用'}/></div><EditorSection title="經管船舶"><div className="management-tags">{ships.length ? ships.map(v => <span key={v.id}>{v.shortName || v.name}</span>) : <em>尚未指派</em>}</div></EditorSection></div>;
  }
  const vessel = data.vessels.find(v => v.id === id)!;
  const people = data.users.filter(u => u.isActive && vessel.assignedUserIds.includes(u.id));
  return <div className="management-editor"><EditorHeading title={vessel.shortName || vessel.name} subtitle={`${vessel.fullName || '未填全名'}｜${vessel.shipType || '未填船型'}`} actions={<button className="btn primary" onClick={onEdit}>開啟船舶設定</button>}/><div className="management-summary-grid"><Summary label="船隊" value={vessel.fleetCategory}/><Summary label="經管人員" value={`${people.length} 人`}/><Summary label="狀態" value={vessel.isActive ? '啟用' : '停用'}/></div><EditorSection title="經管人員"><div className="management-tags">{people.length ? people.map(u => <span key={u.id}>{u.name}</span>) : <em>尚未指派</em>}</div></EditorSection></div>;
}

function PersonEditor({ draft, setDraft, creating, owner, currentUser, selectedUserId, departments, vessels, assignmentQuery, setAssignmentQuery, onSave, onDisable }: { draft:UserDraft; setDraft:React.Dispatch<React.SetStateAction<UserDraft>>; creating:boolean; owner:boolean; currentUser:UserAccount; selectedUserId:string; departments:string[]; vessels:Vessel[]; assignmentQuery:string; setAssignmentQuery:(v:string)=>void; onSave:()=>void; onDisable:()=>void }) {
  const visibleAssignments = vessels.filter(v => !assignmentQuery.trim() || `${v.shortName} ${v.fullName} ${v.name}`.toLowerCase().includes(assignmentQuery.trim().toLowerCase()));
  const toggle = (id:string) => setDraft(prev => ({ ...prev, managedVesselIds: prev.managedVesselIds.includes(id) ? prev.managedVesselIds.filter(x => x !== id) : [...prev.managedVesselIds, id] }));
  return <div className="management-editor"><EditorHeading title={creating ? '新增人員' : draft.name || '人員設定'} subtitle={creating ? '建立帳號、角色與經管船舶' : `${draft.department}｜${roleLabel(draft.role)}`} actions={<>{!creating && owner && selectedUserId !== currentUser.id && <button className="btn danger" onClick={onDisable}>停用</button>}<button className="btn primary" onClick={onSave}>{creating ? '建立人員' : '保存變更'}</button></>}/><div className="management-summary-grid"><Summary label="角色" value={roleLabel(draft.role)}/><Summary label="經管船舶" value={`${draft.managedVesselIds.length} 艘`}/><Summary label="帳號狀態" value={draft.isActive ? '啟用' : '停用'}/></div><EditorSection title="基本資料與角色"><div className="management-form"><label>姓名<input disabled={!owner && selectedUserId !== currentUser.id} value={draft.name} onChange={e => setDraft(prev => ({...prev,name:e.target.value}))}/></label><label>用戶名<input disabled={!owner && selectedUserId !== currentUser.id} value={draft.username} onChange={e => setDraft(prev => ({...prev,username:e.target.value}))}/></label><label>部門<input disabled={!owner} list="management-departments" value={draft.department} onChange={e => setDraft(prev => ({...prev,department:e.target.value}))}/><datalist id="management-departments">{departments.map(d => <option key={d} value={d}/>)}</datalist></label><label>角色<select disabled={!owner || selectedUserId === currentUser.id} value={draft.role} onChange={e => setDraft(prev => ({...prev,role:e.target.value as UserRole}))}><option value="operator">操作員</option><option value="admin">管理員</option><option value="owner">Owner</option></select></label></div></EditorSection>{owner && <EditorSection title="經管船舶"><AssignmentPicker query={assignmentQuery} setQuery={setAssignmentQuery} count={draft.managedVesselIds.length} onAll={() => setDraft(prev => ({...prev,managedVesselIds:vessels.map(v=>v.id)}))} onClear={() => setDraft(prev => ({...prev,managedVesselIds:[]}))}>{visibleAssignments.map(v => <label key={v.id} className={draft.managedVesselIds.includes(v.id) ? 'selected' : ''}><input type="checkbox" checked={draft.managedVesselIds.includes(v.id)} onChange={() => toggle(v.id)}/><span>{v.shortName || v.name}</span><small>{v.fullName}</small></label>)}</AssignmentPicker></EditorSection>}<EditorSection title="密碼"><div className="management-password"><div><b>{creating ? '初始密碼' : '重設密碼'}</b><small>密碼只保存雜湊，無法查看原明文。</small></div><input disabled={!owner && selectedUserId !== currentUser.id} type="password" value={draft.password} placeholder={creating ? '預設 123456' : '留空表示不變更'} onChange={e => setDraft(prev => ({...prev,password:e.target.value}))}/></div></EditorSection></div>;
}

function VesselEditor({ draft, setDraft, creating, users, assignmentQuery, setAssignmentQuery, onSave, onDisable }: { draft:VesselDraft; setDraft:React.Dispatch<React.SetStateAction<VesselDraft>>; creating:boolean; users:UserAccount[]; assignmentQuery:string; setAssignmentQuery:(v:string)=>void; onSave:()=>void; onDisable:()=>void }) {
  const visibleAssignments = users.filter(u => !assignmentQuery.trim() || `${u.name} ${u.department} ${u.username}`.toLowerCase().includes(assignmentQuery.trim().toLowerCase()));
  const toggle = (id:string) => setDraft(prev => ({ ...prev, assignedUserIds: prev.assignedUserIds.includes(id) ? prev.assignedUserIds.filter(x => x !== id) : [...prev.assignedUserIds, id] }));
  return <div className="management-editor"><EditorHeading title={creating ? '新增船舶' : draft.shortName || draft.name || '船舶設定'} subtitle={creating ? '建立船舶基本資料與經管人員' : `${draft.fullName || '未填全名'}｜${draft.shipType || '未填船型'}`} actions={<>{!creating && <button className="btn danger" onClick={onDisable}>停用</button>}<button className="btn primary" onClick={onSave}>{creating ? '建立船舶' : '保存變更'}</button></>}/><div className="management-summary-grid"><Summary label="船隊" value={draft.fleetCategory}/><Summary label="經管人員" value={`${draft.assignedUserIds.length} 人`}/><Summary label="狀態" value={draft.isActive ? '啟用' : '停用'}/></div><EditorSection title="船舶資料"><div className="management-form"><label>系統名稱<input value={draft.name} onChange={e => setDraft(prev => ({...prev,name:e.target.value}))}/></label><label>簡稱<input value={draft.shortName} onChange={e => setDraft(prev => ({...prev,shortName:e.target.value}))}/></label><label className="span-2">完整船名<input value={draft.fullName} onChange={e => setDraft(prev => ({...prev,fullName:e.target.value}))}/></label><label>船型<input value={draft.shipType} onChange={e => setDraft(prev => ({...prev,shipType:e.target.value}))}/></label><label>船隊<select value={draft.fleetCategory} onChange={e => setDraft(prev => ({...prev,fleetCategory:e.target.value}))}><option value="tanker fleet">油輪船隊</option><option value="bulk fleet">散貨船隊</option></select></label></div></EditorSection><EditorSection title="經管人員"><AssignmentPicker query={assignmentQuery} setQuery={setAssignmentQuery} count={draft.assignedUserIds.length} onAll={() => setDraft(prev => ({...prev,assignedUserIds:users.map(u=>u.id)}))} onClear={() => setDraft(prev => ({...prev,assignedUserIds:[]}))}>{visibleAssignments.map(u => <label key={u.id} className={draft.assignedUserIds.includes(u.id) ? 'selected' : ''}><input type="checkbox" checked={draft.assignedUserIds.includes(u.id)} onChange={() => toggle(u.id)}/><span>{u.name}</span><small>{u.department}｜{roleLabel(u.role)}</small></label>)}</AssignmentPicker></EditorSection></div>;
}

function AssignmentPicker({ query, setQuery, count, onAll, onClear, children }: { query:string; setQuery:(v:string)=>void; count:number; onAll:()=>void; onClear:()=>void; children:React.ReactNode }) {
  return <div className="management-assignment"><div className="management-assignment-tools"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋後勾選…"/><span>已選 {count}</span><button className="btn small ghost" onClick={onAll}>全選</button><button className="btn small ghost" onClick={onClear}>清空</button></div><div className="management-assignment-grid">{children}</div></div>;
}
function RoleOverview() { return <div className="management-editor"><EditorHeading title="角色權限" subtitle="固定三層權限，避免逐欄設定造成混亂"/><div className="management-role-cards"><article><b>Owner</b><p>管理所有人員、Owner 帳號、角色、船舶、進站密碼與 Supabase。</p></article><article><b>管理員</b><p>管理船舶與經管人員，可修改自己的帳號與密碼；不可管理 Owner。</p></article><article><b>操作員</b><p>只使用業務頁面；依船舶指派範圍查看與更新，不可進入管理中心。</p></article></div></div>; }

function OwnerSettings({ panel, sitePassword, setSitePassword, config, setConfig, data, setData, commit }: { panel:'gate'|'supabase'|'cloud'; sitePassword:string; setSitePassword:(v:string)=>void; config:SupabaseConfig; setConfig:React.Dispatch<React.SetStateAction<SupabaseConfig>>; data:AppData; setData:React.Dispatch<React.SetStateAction<AppData>>; commit:Props['commit'] }) {
  const saveGate = async () => { if (!sitePassword) return alert('請輸入新進站密碼'); const hash = await sha256(sitePassword); commit(d => { d.settings.sitePasswordHash = hash; }, '修改進站密碼', 'settings', 'site-password', 'Owner 更新進站密碼'); setSitePassword(''); alert('進站密碼已更新'); };
  if (panel === 'gate') return <div className="management-editor"><EditorHeading title="進站密碼" subtitle="網站載入後的第一道存取門"/><EditorSection title="更新密碼"><div className="management-password"><div><b>新進站密碼</b><small>只保存 SHA-256 雜湊，不保存明文。</small></div><input type="password" value={sitePassword} onChange={e => setSitePassword(e.target.value)} placeholder="輸入新密碼"/><button className="btn primary" onClick={saveGate}>保存</button></div></EditorSection></div>;
  if (panel === 'supabase') return <div className="management-editor"><EditorHeading title="Supabase 設定" subtitle="設定保存於目前瀏覽器；部署版 public 設定仍具有優先權" actions={<button className="btn primary" onClick={() => { saveSupabaseConfig(config); alert('Supabase 瀏覽器設定已保存'); }}>保存設定</button>}/><EditorSection title="連線資訊"><div className="management-form one"><label>Project URL<input value={config.supabaseUrl} onChange={e => setConfig(prev => ({...prev,supabaseUrl:e.target.value}))}/></label><label>Anon key<input type="password" value={config.supabaseAnonKey} onChange={e => setConfig(prev => ({...prev,supabaseAnonKey:e.target.value}))}/></label><label>工作區<input value={config.workspaceKey} onChange={e => setConfig(prev => ({...prev,workspaceKey:e.target.value}))}/></label><label>資料表<input value={config.tableName || ''} onChange={e => setConfig(prev => ({...prev,tableName:e.target.value}))}/></label></div></EditorSection></div>;
  return <div className="management-editor"><EditorHeading title="雲端資料" subtitle={`目前本機 revision ${data.revision}`}/><div className="management-cloud-actions"><article><b>載入雲端主資料</b><p>以 Supabase 現有資料替換目前瀏覽器資料。</p><button className="btn ghost" onClick={async () => { if (!confirm('確定載入雲端資料並替換目前瀏覽器內容？')) return; const cloud = await fetchCloudData(); if (!cloud) return alert('雲端沒有資料'); setData(cloud); alert(`已載入雲端 rev.${cloud.revision}`); }}>載入雲端</button></article><article><b>保存目前資料到雲端</b><p>將目前 revision {data.revision} 寫入 Supabase 主資料。</p><button className="btn primary" onClick={async () => { if (!confirm('確定以目前資料更新雲端主資料？')) return; await saveCloudData(data); alert('雲端資料已保存'); }}>保存雲端</button></article></div></div>;
}
