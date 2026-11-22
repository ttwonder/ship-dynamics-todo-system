import {useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {FleetBriefPaper} from './FleetBriefPaper';
import type {FleetBriefCapture} from './fleetBriefTypes';
import './fleetBriefPreview.css';

export default function FleetBriefButton({prepare}:{prepare:(stillOpen:()=>boolean)=>Promise<FleetBriefCapture>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const generation=useRef(0), endPrint=useRef<(()=>void)|null>(null);
  const [open,setOpen]=useState(false), [result,setResult]=useState<FleetBriefCapture|null>(null), [error,setError]=useState('');
  function discard() {
    ++generation.current;
    endPrint.current?.();
  }
  useLayoutEffect(()=>discard,[]);
  useLayoutEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();},[open]);
  function close() {
    discard();dialog.current?.close();setOpen(false);setResult(null);setError('');
  }
  async function preview() {
    if(open)return;
    const id=++generation.current,stillOpen=()=>generation.current===id;
    setOpen(true);setError('');setResult(null);
    try {
      const capture=await prepare(stillOpen);
      if(!stillOpen())return;
      if(!capture.isCurrent())throw new Error('資料範圍已變更，請關閉後重新產生。');
      setResult(capture);
    } catch(e) { if(stillOpen())setError(e instanceof Error?e.message:'未能讀取摘要，請關閉後重試。'); }
  }
  function print() {
    if(!result?.isCurrent()){close();return;}
    endPrint.current?.();
    const previous=document.title,title=`船隊重點摘要_${result.report.date}`;
    const cleanup=()=>{window.removeEventListener('afterprint',cleanup);if(document.title===title)document.title=previous;endPrint.current=null;};
    endPrint.current=cleanup;window.addEventListener('afterprint',cleanup);document.title=title;
    try {window.print();} catch {cleanup();setError('瀏覽器無法開啟列印視窗，請重試。');}
  }
  const valid=result?.isCurrent() ? result : null;
  const message=error||(result&&!valid?'資料範圍已變更，請關閉後重新產生。':'');
  return <><button type="button" className="btn pink" onClick={()=>void preview()}>重點摘要</button>
    {open&&createPortal(<dialog ref={dialog} className="fleet-brief-dialog" role="dialog" aria-labelledby="fleet-brief-title" onCancel={event=>{event.preventDefault();close();}}>
      <header><div><h2 id="fleet-brief-title">重點摘要預覽</h2><small>需要檔案時，在列印視窗選「另存為 PDF」。</small></div>
        <div>{valid&&<button type="button" className="btn primary" onClick={print}>列印／另存 PDF</button>}
        <button type="button" className="btn ghost" autoFocus onClick={close}>關閉</button></div></header>
      {message&&<p className="fleet-brief-message" role="alert">{message}</p>}
      {valid?<div className="brief-scroll"><FleetBriefPaper report={valid.report}/></div>:!message&&<p className="fleet-brief-message" role="status">正在讀取最新船況、行程與風險資料…</p>}
    </dialog>,document.body)}</>;
}
