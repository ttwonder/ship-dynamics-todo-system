import {useEffect,useId,useRef,useState} from 'react';
import type {Vessel} from './types';
import {vesselDisplayName} from './vesselDisplay';
import './taskCreateEntry.css';

export type OpenTaskCreation=(vesselId:string,isCurrent:()=>boolean)=>Promise<boolean>;

// Selection only. The caller owns the existing creation lease, draft and save.
export function TaskCreateEntry({vessels,context,onCreate}:{vessels:Vessel[];context:{identity:string;isCurrent:()=>boolean};onCreate:OpenTaskCreation}) {
  const [vesselId,setVesselId]=useState('');
  const [opening,setOpening]=useState(false);
  const [error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const mounted=useRef(true);
  const pending=useRef(false);
  const titleId=useId(),selectId=useId();
  const available=vessels.filter(vessel=>vessel.isActive);
  const live=useRef({context,available});
  live.current={context,available};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const start=async()=>{
    if(pending.current||!live.current.context.isCurrent()||!live.current.available.some(vessel=>vessel.id===vesselId))return;
    const identity=context.identity;
    const isCurrent=()=>mounted.current&&live.current.context.identity===identity&&live.current.context.isCurrent();
    pending.current=true;setOpening(true);setError('');
    try {
      const opened=await onCreate(vesselId,isCurrent);
      if(!isCurrent())return;
      if(opened)dialog.current?.close();
      else setError('未開啟新增要事，請確認提示後重試。');
    } catch {
      if(isCurrent())setError('目前無法開啟新增要事，請稍後重試。');
    } finally {
      pending.current=false;
      if(mounted.current)setOpening(false);
    }
  };
  return <>
    <button type="button" className="btn small primary" aria-label="新增要事" disabled={!available.length} title={available.length?'先選船，再填寫要事':'目前沒有可新增要事的啟用船舶'} onClick={()=>{if(!context.isCurrent())return;setVesselId('');setError('');dialog.current?.showModal();}}>＋ 新增要事</button>
    <dialog ref={dialog} className="task-create-picker no-print" aria-labelledby={titleId} onCancel={event=>{if(pending.current)event.preventDefault();}}>
      <form onSubmit={event=>{event.preventDefault();void start();}}>
        <h2 id={titleId}>新增要事｜選擇船舶</h2>
        <div className="field"><label htmlFor={selectId}>船舶</label><select id={selectId} aria-label="新增要事船舶" value={available.some(vessel=>vessel.id===vesselId)?vesselId:''} disabled={opening} onChange={event=>setVesselId(event.target.value)} autoFocus><option value="">請選擇船舶</option>{available.map(vessel=><option key={vessel.id} value={vessel.id}>{vesselDisplayName(vessel)}</option>)}</select></div>
        <p className="muted">選定後沿用原新增表單；如需換船，請取消後重新選擇。</p>
        {error&&<p className="warn" role="alert">{error}</p>}
        <div className="heading-actions"><button type="button" className="btn small ghost" disabled={opening} onClick={()=>dialog.current?.close()}>取消</button><button type="submit" className="btn small primary" disabled={opening||!available.some(vessel=>vessel.id===vesselId)}>{opening?'正在開啟…':'下一步：填寫要事'}</button></div>
      </form>
    </dialog>
  </>;
}
