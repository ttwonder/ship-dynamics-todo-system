import React, { useState } from 'react';
import type { AppData, ShipStatus, TaskItem, TaskPriority, UserAccount, Vessel } from './types';
import { nowIso, todayDate, uid } from './utils';

type Commit = (updater: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;

type MultiChoice = { value: string; label: string; detail?: string };

function CheckboxMultiPicker({ label, values, choices, onChange }: { label: string; values: string[]; choices: MultiChoice[]; onChange: (values: string[]) => void }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  return <fieldset className="checkbox-multi-picker"><legend>{label}<span>已選 {values.length}</span></legend><div className="checkbox-multi-grid">{choices.map(choice => {
    const checked = values.includes(choice.value);
    return <label key={choice.value} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggle(choice.value)}/><span><b>{choice.label}</b>{choice.detail && <small>{choice.detail}</small>}</span></label>;
  })}</div></fieldset>;
}

export function VesselEditModal({ vessel, data, currentUser, close, commit, addTask, editTask }: { vessel?: Vessel; data: AppData; currentUser: UserAccount; close: () => void; commit: Commit; addTask: (vesselId: string) => void; editTask: (taskId: string) => void }) {
  if (!vessel) return null;
  const update = (change: (target: Vessel) => void, detail: string) => commit(draft => {
    const target = draft.vessels.find(item => item.id === vessel.id);
    if (!target) return;
    change(target);
    target.updatedAt = nowIso();
  }, '快速更新船舶', 'vessel', vessel.id, detail);
  const openTasks = data.tasks.filter(task => task.vesselId === vessel.id && !task.isClosed);
  const users = data.users.filter(user => user.isActive);
  return <div className="modal-backdrop"><div className="modal edit-modal"><div className="modal-header"><div><h2>快速更新｜{vessel.shortName || vessel.name}</h2><small>修改後立即保存；多選項可直接逐項勾選</small></div><button className="btn ghost" onClick={close}>完成並關閉</button></div>
    <div className="grid cols-4">
      <div className="field"><label>目前位置</label><input value={vessel.position.location} onChange={event => { const value = event.target.value; update(target => { target.position.location = value; target.position.updatedAt = nowIso(); }, '修改目前位置'); }}/></div>
      <div className="field"><label>上一港</label><input value={vessel.position.lastPort} onChange={event => { const value = event.target.value; update(target => { target.position.lastPort = value; target.position.updatedAt = nowIso(); }, '修改上一港'); }}/></div>
      <div className="field"><label>下一港</label><input value={vessel.position.nextPort} onChange={event => { const value = event.target.value; update(target => { target.position.nextPort = value; target.position.updatedAt = nowIso(); }, '修改下一港'); }}/></div>
      <div className="field"><label>航速（kn）</label><input type="number" min="0" step="0.1" value={vessel.position.speedKnots} onChange={event => { const value = Number(event.target.value || 0); update(target => { target.position.speedKnots = value; target.position.updatedAt = nowIso(); }, '修改航速'); }}/></div>
      <div className="field"><label>ETA</label><input value={vessel.position.eta} onChange={event => { const value = event.target.value; update(target => { target.position.eta = value; target.position.updatedAt = nowIso(); }, '修改 ETA'); }}/></div>
      <div className="field"><label>貨名</label><input value={vessel.cargo.name} onChange={event => { const value = event.target.value; update(target => { target.cargo.name = value; target.cargo.updatedAt = nowIso(); }, '修改貨名'); }}/></div>
      <div className="field"><label>數量</label><input value={vessel.cargo.quantity} onChange={event => { const value = event.target.value; update(target => { target.cargo.quantity = value; target.cargo.updatedAt = nowIso(); }, '修改貨物數量'); }}/></div>
      <div className="field"><label>人工備註</label><input value={vessel.position.manualRemark} onChange={event => { const value = event.target.value; update(target => { target.position.manualRemark = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }, '修改人工動態備註'); }}/></div>
      <div className="field span-2"><label>近期動態</label><textarea value={vessel.note.recentDynamics} onChange={event => { const value = event.target.value; update(target => { target.note.recentDynamics = value; target.note.updatedAt = nowIso(); }, '修改近期動態'); }}/></div>
      <div className="field span-2"><label>後續動態</label><textarea value={vessel.note.subsequentDynamics} onChange={event => { const value = event.target.value; update(target => { target.note.subsequentDynamics = value; target.note.updatedAt = nowIso(); }, '修改後續動態'); }}/></div>
    </div>
    <CheckboxMultiPicker label="船舶狀態" values={vessel.note.statusList} choices={data.settings.vesselStatuses.map(status => ({ value: status, label: status }))} onChange={values => update(target => { target.note.statusList = values as ShipStatus[]; target.note.updatedAt = nowIso(); }, `修改船舶狀態：${values.join('、') || '無'}`)}/>
    <CheckboxMultiPicker label="經管／負責人" values={vessel.assignedUserIds} choices={users.map(user => ({ value: user.id, label: user.name, detail: user.department }))} onChange={values => update(target => { target.assignedUserIds = values; }, `修改經管人員：${values.length} 人`)}/>
    <section className="modal-task-section"><div className="panel-title"><h3>未結事項 <span className="muted">({openTasks.length})</span></h3><button className="btn primary small" onClick={() => addTask(vessel.id)}>＋ 新增事項</button></div>{openTasks.length ? openTasks.map(task => <button key={task.id} className="modal-task-row" onClick={() => editTask(task.id)}><span className={`badge ${task.priority === '高' ? 'high' : task.priority === '中' ? 'mid' : 'low'}`}>{task.priority}</span><b>{task.description || '尚未輸入事項內容'}</b><small>{task.status || '尚未更新狀態'}｜期限 {task.expectedDate || '未設定'}</small></button>) : <div className="empty-state compact">目前沒有未結事項</div>}</section>
  </div></div>;
}

export function TaskEditModal({ task, data, visibleVessels, currentUser, close, commit }: { task?: TaskItem; data: AppData; visibleVessels: Vessel[]; currentUser: UserAccount; close: () => void; commit: Commit }) {
  const [quickStatus, setQuickStatus] = useState('');
  if (!task || !visibleVessels.some(vessel => vessel.id === task.vesselId)) return null;
  const update = (change: (target: TaskItem) => void, detail: string) => commit(draft => {
    const target = draft.tasks.find(item => item.id === task.id);
    if (!target) return;
    change(target);
    target.updatedAt = nowIso();
    target.updatedBy = currentUser.id;
  }, '更新事項', 'task', task.id, detail);
  const addStatus = () => {
    const value = quickStatus.trim();
    if (!value) return;
    update(target => { target.status = value; target.statusLogs.unshift({ id: uid('log'), at: nowIso(), by: currentUser.name, text: value }); }, '新增狀態紀錄');
    setQuickStatus('');
  };
  const toggleClosed = () => update(target => {
    target.isClosed = !target.isClosed;
    if (target.isClosed) { target.closedDate = todayDate(); target.closedBy = currentUser.id; }
    else { delete target.closedDate; delete target.closedBy; }
  }, task.isClosed ? '重新開啟事項' : '結案事項');
  const users = data.users.filter(user => user.isActive);
  return <div className="modal-backdrop"><div className="modal edit-modal"><div className="modal-header"><div><h2>更新事項</h2><small>{task.isClosed ? '已結案' : '未結'}｜修改後立即保存</small></div><div className="heading-actions"><button className={`btn ${task.isClosed ? 'green' : 'red'}`} onClick={toggleClosed}>{task.isClosed ? '重新開啟' : '標記結案'}</button><button className="btn ghost" onClick={close}>完成並關閉</button></div></div>
    <div className="grid cols-3">
      <div className="field"><label>船舶</label><select value={task.vesselId} onChange={event => { const value = event.target.value; update(target => { target.vesselId = value; }, '修改船舶'); }}>{visibleVessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vessel.shortName || vessel.name}｜{vessel.fullName}</option>)}</select></div>
      <div className="field"><label>關注程度</label><select value={task.priority} onChange={event => { const value = event.target.value as TaskPriority; update(target => { target.priority = value; }, '修改關注程度'); }}>{data.settings.priorities.map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></div>
      <div className="field"><label>分類</label><select value={task.category} onChange={event => { const value = event.target.value; update(target => { target.category = value; }, '修改分類'); }}>{data.settings.taskCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></div>
      <div className="field span-3"><label>事項內容</label><textarea value={task.description} onChange={event => { const value = event.target.value; update(target => { target.description = value; }, '修改事項內容'); }}/></div>
      <div className="field span-2"><label>目前狀態／決議</label><textarea value={task.status} onChange={event => { const value = event.target.value; update(target => { target.status = value; }, '修改目前狀態'); }}/></div>
      <div className="field"><label>預計完成日期</label><input type="date" value={task.expectedDate} onChange={event => { const value = event.target.value; update(target => { target.expectedDate = value; }, '修改預計完成日期'); }}/></div>
      <label className="aware-toggle"><input type="checkbox" checked={task.isAware} onChange={event => { const value = event.target.checked; update(target => { target.isAware = value; }, '修改知曉標記'); }}/><span>標記為知曉事項</span></label>
    </div>
    <CheckboxMultiPicker label="涉及部門" values={task.departments} choices={data.settings.departments.map(department => ({ value: department, label: department }))} onChange={values => update(target => { target.departments = values; }, `修改涉及部門：${values.join('、') || '無'}`)}/>
    <CheckboxMultiPicker label="經管／負責人" values={task.ownerUserIds} choices={users.map(user => ({ value: user.id, label: user.name, detail: user.department }))} onChange={values => update(target => { target.ownerUserIds = values; }, `修改負責人：${values.length} 人`)}/>
    <div className="quick-status-bar"><input value={quickStatus} onChange={event => setQuickStatus(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addStatus(); }} placeholder="現場快速更新狀態…"/><button className="btn primary" onClick={addStatus}>加入狀態紀錄</button></div>
    <section className="status-history"><h3>狀態歷程</h3>{task.statusLogs.length ? task.statusLogs.map(log => <article key={log.id}><b>{log.text}</b><small>{new Date(log.at).toLocaleString('zh-TW')}｜{log.by}</small></article>) : <p className="muted">尚無狀態紀錄</p>}</section>
  </div></div>;
}
