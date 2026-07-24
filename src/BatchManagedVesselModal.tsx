import type { AppData, LoadStatus, NavigationStatus, UserAccount, Vessel, VesselCargoItem } from './types';
import { nowIso } from './utils';
import { vesselDisplayName } from './vesselDisplay';
import { composeScheduleValue, formatScheduleDisplay, scheduleDateValue, scheduleTimeValue } from './scheduleTime';
import { hasActiveVesselDelegation } from './vesselDelegation';

type Commit = (updater: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;

type Props = {
  vessels: Vessel[];
  currentUser: UserAccount;
  lockedVesselIds: string[];
  commit: Commit;
  close: () => void;
  onAddTask: (vesselId: string) => void;
};

const cargoLines = (items: VesselCargoItem[]) => items.map(item => `${item.name}${item.quantity ? `｜${item.quantity}` : ''}`).join('\n');
const parseCargoLines = (value: string): VesselCargoItem[] => value.split(/\r?\n/).map(line => {
  const [name = '', ...quantityParts] = line.split(/[｜|]/);
  return { name: name.trim(), quantity: quantityParts.join('｜').trim() };
}).filter(item => item.name || item.quantity);

function ScheduleDateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const date = scheduleDateValue(value);
  const time = scheduleTimeValue(value);
  return <div className="batch-managed-schedule"><label>{label}</label><div className="schedule-date-time-inputs"><input type="date" aria-label={`${label} 日期`} value={date} onChange={event => onChange(composeScheduleValue(event.target.value, time))}/><input type="time" aria-label={`${label} 小時分鐘`} value={time} disabled={!date} onChange={event => onChange(composeScheduleValue(date, event.target.value))}/></div><small>{formatScheduleDisplay(value) || 'TBA'}</small></div>;
}

export default function BatchManagedVesselModal({ vessels, currentUser, lockedVesselIds, commit, close, onAddTask }: Props) {
  const managedVessels = currentUser.role === 'owner' || currentUser.role === 'admin' ? vessels : vessels.filter(vessel => vessel.assignedUserIds.includes(currentUser.id) || currentUser.managedVesselIds.includes(vessel.id) || hasActiveVesselDelegation(vessel, currentUser.id));
  const updateVessel = (vesselId: string, detail: string, mutate: (vessel: Vessel) => void) => {
    if(!lockedVesselIds.includes(vesselId))return;
    commit(draft => {
    const vessel = draft.vessels.find(item => item.id === vesselId);
    if (!vessel) return;
    mutate(vessel);
    vessel.updatedAt = nowIso();
    }, '批量更新自管船舶', 'vessel', vesselId, detail);
  };
  return <div className="modal-backdrop"><div className="modal batch-managed-modal" role="dialog" aria-modal="true" aria-labelledby="batch-managed-title"><div className="modal-header"><div><h2 id="batch-managed-title">批量更新自管船舶</h2><small>一次更新目前位置、港口、航行、載況、ETA／ETB／ETD、貨名貨量與近期動態；原本單船快速更新仍保留。</small></div><button className="btn ghost" onClick={close}>完成並關閉</button></div>{managedVessels.length ? <div className="batch-managed-list">{managedVessels.map(vessel => <article key={vessel.id} className="batch-managed-card"><header><div><h3>{vesselDisplayName(vessel)}</h3><small>{vessel.shipType || '未設定船種'}｜{vessel.position.lastPort || '未設定'} → {vessel.position.nextPort || '未設定'}</small></div><span className="badge green">已鎖定</span><button className="btn primary small" onClick={() => onAddTask(vessel.id)}>＋ 新增要事</button></header><fieldset disabled={!lockedVesselIds.includes(vessel.id)} style={{border:0,padding:0,margin:0,minWidth:0}}><div className="batch-managed-grid"><label>目前位置<input value={vessel.position.location} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改目前位置', target => { target.position.location = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}/></label><label>上一港<input value={vessel.position.lastPort} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改上一港', target => { target.position.lastPort = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}/></label><label>下一港<input value={vessel.position.nextPort} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改下一港', target => { target.position.nextPort = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}/></label><label>航行狀態<select value={vessel.position.navigationStatus} onChange={event => { const value = event.target.value as NavigationStatus; updateVessel(vessel.id, '修改航行狀態', target => { target.position.navigationStatus = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}><option>航行</option><option>拋錨</option><option>進港中</option><option>出港中</option><option>停泊</option><option>漂航</option></select></label><label>速度<input type="number" min="0" step="0.1" value={vessel.position.speedKnots} onChange={event => { const value = Number(event.target.value || 0); updateVessel(vessel.id, '修改速度', target => { target.position.speedKnots = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}/></label><label>載況<select value={vessel.cargo.loadStatus} onChange={event => { const value = event.target.value as LoadStatus; updateVessel(vessel.id, '修改載況', target => { target.cargo.loadStatus = value; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }); }}><option>空載</option><option>非空載</option><option>滿載</option></select></label><ScheduleDateTimeField label="ETA" value={vessel.position.eta} onChange={value => updateVessel(vessel.id, '修改 ETA', target => { target.position.eta = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); })}/><ScheduleDateTimeField label="ETB" value={vessel.position.etb} onChange={value => updateVessel(vessel.id, '修改 ETB', target => { target.position.etb = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); })}/><ScheduleDateTimeField label="ETD" value={vessel.position.etd} onChange={value => updateVessel(vessel.id, '修改 ETD', target => { target.position.etd = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); })}/><label className="span-2">貨名貨量<textarea value={cargoLines(vessel.cargo.items)} placeholder={'每行一筆，例如：\n原油｜28,000 MT'} onChange={event => { const items = parseCargoLines(event.target.value); updateVessel(vessel.id, `修改貨名貨量：${items.length} 筆`, target => { target.cargo.items = items; target.cargo.name = items[0]?.name || ''; target.cargo.quantity = items[0]?.quantity || ''; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }); }}/></label><label className="span-2">近期動態<textarea value={vessel.note.recentDynamics} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改近期動態', target => { target.note.recentDynamics = value; target.note.subsequentDynamics = ''; target.note.updatedAt = nowIso(); }); }}/></label></div></fieldset></article>)}</div> : <div className="empty-state compact">目前沒有自管船舶</div>}</div></div>;
}
