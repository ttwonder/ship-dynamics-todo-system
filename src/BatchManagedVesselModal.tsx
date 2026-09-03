import { useEffect, useState } from 'react';
import type { LoadStatus, NavigationStatus, Vessel, VesselCargoItem } from './types';
import { nowIso } from './utils';
import { vesselDisplayName } from './vesselDisplay';
import { formatScheduleDisplay, scheduleDateValue, scheduleTimeValue } from './scheduleTime';

type Props = {
  vessels: Vessel[];
  lockedVesselIds: string[];
  readOnly: boolean;
  saving: boolean;
  save: (vessels: Vessel[]) => Promise<boolean>;
  cancel: () => void;
  close: () => void;
  discard: () => void;
  onAddTask: (vesselId: string) => void;
};

const cargoLines = (items: VesselCargoItem[]) => items.map(item => `${item.name}${item.quantity ? `｜${item.quantity}` : ''}`).join('\n');
const BATCH_PAGE_SIZE = 8;

function ScheduleDateTimeField({ label, value }: { label: string; value: string }) {
  const date = scheduleDateValue(value);
  const time = scheduleTimeValue(value);
  return <div className="batch-managed-schedule">
    <label>{label}</label>
    <div className="schedule-date-time-inputs">
      <input type="date" aria-label={`${label} 日期`} value={date} disabled/>
      <input type="time" aria-label={`${label} 小時分鐘`} value={time} disabled/>
    </div>
    <small>{formatScheduleDisplay(value) || 'TBA'}｜由 Itinerary 正式首列同步</small>
  </div>;
}

export default function BatchManagedVesselModal({ vessels, lockedVesselIds, readOnly, saving, save, cancel, close, discard, onAddTask }: Props) {
  const [draftVessels,setDraftVessels]=useState<Vessel[]>(()=>structuredClone(vessels));
  const [submitting,setSubmitting]=useState(false);
  const busy=saving||submitting;
  const managedVessels=draftVessels;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(managedVessels.length / BATCH_PAGE_SIZE));
  useEffect(() => setPage(current => Math.min(current, pageCount)), [pageCount]);
  const pageVessels = managedVessels.slice((page - 1) * BATCH_PAGE_SIZE, page * BATCH_PAGE_SIZE);
  const updateVessel = (vesselId: string, _detail: string, mutate: (vessel: Vessel) => void) => {
    if(readOnly||busy||!lockedVesselIds.includes(vesselId))return;
    setDraftVessels(previous=>{
      const next=structuredClone(previous);
      const vessel=next.find(item=>item.id===vesselId);
      if(!vessel)return previous;
      mutate(vessel);
      vessel.updatedAt=nowIso();
      return next;
    });
  };
  const submit=async(afterSave?:()=>void)=>{
    if(busy||readOnly)return;
    setSubmitting(true);
    try{if(await save(structuredClone(draftVessels)))afterSave?.();}
    finally{setSubmitting(false);}
  };

  return <div className="modal-backdrop"><div className="modal batch-managed-modal" role="dialog" aria-modal="true" aria-labelledby="batch-managed-title">
    <div className="modal-header">
      <div>
        <h2 id="batch-managed-title">批量更新船舶</h2>
        <small>欄位先暫存在本視窗；按「保存並關閉」才會一次寫入全部修改。</small>
        <small>上一港、下一港、ETA／ETB／ETD 與貨名貨量由 Itinerary 正式首列同步，只可在 Itinerary 修改。</small>
        <small>共 {managedVessels.length} 艘；第 {page} / {pageCount} 頁</small>
        {readOnly&&<small className="danger-note">正在等待雲端確認；欄位已暫停，船舶鎖仍保留。</small>}
      </div>
      <div className="heading-actions">
        <button className={readOnly?'btn red':'btn ghost'} disabled={busy} onClick={readOnly?discard:cancel}>取消並關閉</button>
        <button className="btn primary" disabled={busy} onClick={()=>{if(readOnly)close();else void submit();}}>{busy?'雲端確認中…':readOnly?'重試保存並關閉':'保存並關閉'}</button>
      </div>
    </div>
    {managedVessels.length ? <>
      <div className="batch-managed-list">{pageVessels.map(vessel => <article key={vessel.id} className="batch-managed-card">
        <header>
          <div><h3>{vesselDisplayName(vessel)}</h3><small>{vessel.shipType || '未設定船種'}｜{vessel.position.lastPort || '未設定'} → {vessel.position.nextPort || '未設定'}</small></div>
          <span className="badge green">已鎖定</span>
          <button className="btn primary small" disabled={readOnly||busy} onClick={() => void submit(()=>onAddTask(vessel.id))}>＋ 新增要事</button>
        </header>
        <fieldset disabled={readOnly||busy||!lockedVesselIds.includes(vessel.id)} style={{border:0,padding:0,margin:0,minWidth:0}}>
          <div className="batch-managed-grid">
            <label>目前位置<input value={vessel.position.location} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改目前位置', target => { target.position.location = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}/></label>
            <label>上一港<input readOnly aria-readonly="true" value={vessel.position.lastPort}/><small>Itinerary</small></label>
            <label>下一港<input readOnly aria-readonly="true" value={vessel.position.nextPort}/><small>Itinerary</small></label>
            <label>航行狀態<select value={vessel.position.navigationStatus} onChange={event => { const value = event.target.value as NavigationStatus; updateVessel(vessel.id, '修改航行狀態', target => { target.position.navigationStatus = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}><option>航行</option><option>拋錨</option><option>進港中</option><option>出港中</option><option>停泊</option><option>漂航</option></select></label>
            <label>載況<select value={vessel.cargo.loadStatus} onChange={event => { const value = event.target.value as LoadStatus; updateVessel(vessel.id, '修改載況', target => { target.cargo.loadStatus = value; target.cargo.source = 'manual'; target.cargo.updatedAt = nowIso(); }); }}><option>空載</option><option>非空載</option><option>滿載</option></select></label>
            <ScheduleDateTimeField label="ETA" value={vessel.position.eta}/>
            <ScheduleDateTimeField label="ETB" value={vessel.position.etb}/>
            <ScheduleDateTimeField label="ETD" value={vessel.position.etd}/>
            <label className="span-2">貨名貨量<textarea readOnly aria-readonly="true" value={cargoLines(vessel.cargo.items)}/><small>由 Itinerary 正式首列同步；保留原始多行文字</small></label>
            <label className="span-2">人工備註<textarea value={vessel.position.manualRemark} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改人工備註', target => { target.position.manualRemark = value; target.position.source = 'manual'; target.position.updatedAt = nowIso(); }); }}/></label>
            <label className="span-2">近期動態<textarea value={vessel.note.recentDynamics} onChange={event => { const value = event.target.value; updateVessel(vessel.id, '修改近期動態', target => { target.note.recentDynamics = value; target.note.subsequentDynamics = ''; target.note.updatedAt = nowIso(); }); }}/></label>
          </div>
        </fieldset>
      </article>)}</div>
      {pageCount>1&&<nav className="batch-managed-pagination" aria-label="批量船舶分頁">
        <button type="button" className="btn small ghost" disabled={page<=1||busy} onClick={()=>setPage(current=>Math.max(1,current-1))}>上一頁</button>
        <span>第 {page} / {pageCount} 頁</span>
        <button type="button" className="btn small ghost" disabled={page>=pageCount||busy} onClick={()=>setPage(current=>Math.min(pageCount,current+1))}>下一頁</button>
      </nav>}
    </> : <div className="empty-state compact">目前沒有自管船舶</div>}
  </div></div>;
}
