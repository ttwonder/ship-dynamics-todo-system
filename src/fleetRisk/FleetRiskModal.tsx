import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {getSupabaseConfig} from '../cloud';
import type {VesselNameSource} from '../vesselDisplay';
import {createFleetRiskClient} from './client';
import {formatRiskTime,mostRecentScheduledAt,type FleetRiskSnapshot,type FleetRiskState} from './model';
import FleetRiskReport from './FleetRiskReport';

function PrintSnapshot({snapshot,vessels,done}:{snapshot:FleetRiskSnapshot;vessels:VesselNameSource[];done:()=>void}){
  const doneRef=useRef(done);doneRef.current=done;
  useEffect(()=>{
    let cancelled=false,restore:undefined|(()=>void);
    const run=async()=>{
      await document.fonts.ready;
      if(cancelled)return;
      const title=document.title,style=document.createElement('style');
      style.textContent='@page {size:A4 landscape;margin:10mm 8mm 13mm;@bottom-right {content:"第 " counter(page) " 頁／共 " counter(pages) " 頁";font-family:"Microsoft JhengHei";font-size:9pt;}}';
      document.head.append(style);
      document.title=`台塑海運船隊風險清單_${snapshot.queryCompletedAt.replace(/[:.]/g,'-')}`;
      document.body.classList.add('printing-fleet-risk');
      const after=()=>{restore?.();doneRef.current();};
      restore=()=>{style.remove();document.title=title;document.body.classList.remove('printing-fleet-risk');window.removeEventListener('afterprint',after);};
      window.addEventListener('afterprint',after,{once:true});
      try{window.print();}catch{after();}
    };
    void run();return()=>{cancelled=true;restore?.();};
  },[snapshot]);
  return createPortal(<div className="fr-print-root"><FleetRiskReport snapshot={snapshot} vessels={vessels}/></div>,document.body);
}

export default function FleetRiskModal({vessels,close}:{vessels:VesselNameSource[];close:()=>void}){
  const [client]=useState(()=>createFleetRiskClient(getSupabaseConfig()));
  const [state,setState]=useState<FleetRiskState|null>(null);
  const [loading,setLoading]=useState(false),[submitting,setSubmitting]=useState(false);
  const [confirm,setConfirm]=useState(false),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
  const [printing,setPrinting]=useState<{snapshot:FleetRiskSnapshot;vessels:VesselNameSource[]}|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(false),epoch=useRef(0),controller=useRef<AbortController|null>(null);
  const closeRef=useRef(close);closeRef.current=close;
  const begin=()=>{controller.current?.abort();controller.current=new AbortController();return{signal:controller.current.signal,id:++epoch.current};};
  const read=useCallback(async()=>{
    const task=begin();setLoading(true);setError('');
    try{const next=await client.read(task.signal);if(alive.current&&epoch.current===task.id){setState(next);setUnknown(false);}}
    catch(e){if(alive.current&&!task.signal.aborted)setError(e instanceof Error?e.message:'無法讀取風險清單，原清單未變更。');}
    finally{if(alive.current&&epoch.current===task.id)setLoading(false);}
  },[client]);
  useEffect(()=>{
    alive.current=true;
    const previous=document.activeElement as HTMLElement;
    dialog.current?.showModal();
    void read();
    return()=>{alive.current=false;++epoch.current;controller.current?.abort();dialog.current?.close();previous?.focus();};
  },[read]);
  useEffect(()=>{
    if(state?.attempt?.status!=='running'||error||submitting)return;
    const timer=setTimeout(()=>void read(),2500);
    return()=>clearTimeout(timer);
  },[state,error,submitting,read]);
  const refresh=async()=>{
    if(submitting||state?.attempt?.status==='running'||unknown)return;
    setConfirm(false);setSubmitting(true);setError('');
    const task=begin();
    try{
      const result=await client.refresh(crypto.randomUUID(),task.signal);
      if(alive.current&&epoch.current===task.id){setState(result.state);setUnknown(false);}
    }catch(e){if(alive.current&&!task.signal.aborted){setUnknown(true);setError(e instanceof Error?e.message:'更新請求結果未確認，請讀取更新狀態。');}}
    finally{if(alive.current&&epoch.current===task.id)setSubmitting(false);}
  };
  const snapshot=state?.snapshot,attempt=state?.attempt;
  const running=attempt?.status==='running';
  const stale=!!snapshot&&Date.parse(snapshot.queryStartedAt)<Date.parse(mostRecentScheduledAt(state!.serverTime));
  return createPortal(<>
    <dialog className="fleet-risk-dialog" ref={dialog} aria-labelledby="fleet-risk-title" onCancel={event=>{event.preventDefault();if(!printing)closeRef.current();}}>
      <div className="fr-shell">
        <header className="fr-toolbar"><h2 id="fleet-risk-title">船隊風險清單</h2>
          <button type="button" className="btn ghost" disabled={loading||submitting||!!printing} onClick={()=>void read()}>讀取更新狀態</button>
          <button type="button" className="btn fleet-risk-trigger" disabled={!state||running||submitting||unknown||!!printing} onClick={()=>setConfirm(true)}>強制更新</button>
          <button type="button" className="btn primary" disabled={!snapshot||!!printing} aria-label="匯出 PDF" onClick={()=>snapshot&&setPrinting({snapshot:structuredClone(snapshot),vessels:structuredClone(vessels)})}>匯出 PDF</button>
          <button type="button" className="btn ghost" disabled={!!printing} onClick={close}>關閉風險清單</button>
        </header>
        <div className="fr-status" aria-live="polite">
          <p>每天台北時間 <strong>07:00 開始更新</strong>；平常直接讀取最近成功清單，不重新逐船查詢。</p>
          {state&&<p>下次排程：{formatRiskTime(state.nextScheduledAt)}（台北）｜PDF 匯出目前顯示版本，於列印視窗選「另存為 PDF」。</p>}
          {loading&&!state&&<p>正在讀取已保存的清單…</p>}
          {submitting&&<p>正在提交更新請求…</p>}
          {running&&<p className="fr-notice">雲端正在更新：{attempt.done}／{attempt.total||'待取得名冊'} 艘。完成後整份替換；目前清單及 PDF 仍為原版本。關閉視窗不會取消共用的雲端更新。</p>}
          {stale&&<p className="fr-notice">最近應更新的 07:00 完整清單尚未確認，仍顯示 {formatRiskTime(snapshot!.queryCompletedAt)} 的成功清單，並非本日最新結果。</p>}
          {attempt?.status==='failed'&&<p className="fr-error">最近一次更新失敗（{formatRiskTime(attempt.startedAt)}）；原清單未被替換。{attempt.error?`原因：${attempt.error}`:''}</p>}
          {error&&<p className="fr-error" role="alert">{error}</p>}
        </div>
        {confirm&&<div className="fr-confirm" role="group" aria-label="確認強制更新">
          <p><strong>重新向官網查詢全部船舶，需要等待一段時間。</strong>採 2～4 艘同時查詢，可能需數分鐘，實際依官網速度而定。全部成功後才替換目前清單；失敗保留原版。</p>
          <button type="button" className="btn primary" onClick={()=>void refresh()}>開始更新</button><button type="button" className="btn ghost" onClick={()=>setConfirm(false)}>取消，保留目前清單</button>
        </div>}
        <div className="fr-scroll">{snapshot?<FleetRiskReport snapshot={snapshot} vessels={vessels}/>:<div className="fr-empty">{loading?'正在讀取…':'尚無成功的船隊風險清單。可等待每日排程，或按「強制更新」取得首份清單。'}<br/>未取得資料不代表低風險。</div>}</div>
      </div>
    </dialog>
    {printing&&<PrintSnapshot snapshot={printing.snapshot} vessels={printing.vessels} done={()=>setPrinting(null)}/>}
  </>,document.body);
}
