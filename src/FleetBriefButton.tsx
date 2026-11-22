import {useLayoutEffect, useRef, useState} from 'react';
import type {FleetBriefCapture, FleetBriefReport} from './fleetBriefTypes';
import './fleetBriefPreview.css';

type Result = FleetBriefCapture & { url: string };

function TextPreview({report}:{report:FleetBriefReport}) {
  return <div className="fleet-brief-text"><p>此瀏覽器不支援內嵌 PDF。下方為同一份摘要的文字預覽，仍可手動儲存 PDF。</p>
    <p>{report.date}　{report.notice}</p>{report.sections.map(section=><section key={section.title}><h3>{section.title}</h3>
      {section.rows.length ? <table><thead><tr>{section.columns.map((col,i)=><th key={i}>{col.label}</th>)}</tr></thead>
        <tbody>{section.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{value}</td>)}</tr>)}</tbody></table> : <p>無符合項目</p>}</section>)}</div>;
}

export default function FleetBriefButton({prepare}:{prepare:(stillOpen:()=>boolean)=>Promise<FleetBriefCapture>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const generation=useRef(0), activeUrl=useRef('');
  const [open,setOpen]=useState(false), [result,setResult]=useState<Result|null>(null), [error,setError]=useState('');
  function discard() {
    ++generation.current;
    if(activeUrl.current) { URL.revokeObjectURL(activeUrl.current); activeUrl.current=''; }
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
      const {buildFleetBriefPdf}=await import('./fleetBriefPdf');
      const blob=await buildFleetBriefPdf(capture.report);
      if(!stillOpen())return;
      if(!capture.isCurrent())throw new Error('資料範圍已變更，請關閉後重新產生。');
      activeUrl.current=URL.createObjectURL(blob);
      setResult({...capture,url:activeUrl.current});
    } catch(e) { if(stillOpen())setError(e instanceof Error?e.message:'未能產生 PDF，請關閉後重試。'); }
  }
  const valid=result?.isCurrent() ? result : null;
  const message=error||(result&&!valid?'資料範圍已變更，請關閉後重新產生。':'');
  return <><button type="button" className="btn pink" onClick={()=>void preview()}>重點摘要</button>
    {open&&<dialog ref={dialog} className="fleet-brief-dialog" role="dialog" aria-labelledby="fleet-brief-title" onCancel={event=>{event.preventDefault();close();}}>
      <header><div><h2 id="fleet-brief-title">船隊重點摘要</h2><small>僅供預覽，不會自動儲存到硬碟。</small></div>
        <div>{valid&&<a className="btn primary" href={valid.url} download={`船隊重點摘要_${valid.report.date}.pdf`} onClick={e=>{if(!valid.isCurrent()){e.preventDefault();close();}}}>儲存 PDF</a>}
        <button type="button" className="btn ghost" autoFocus onClick={close}>關閉</button></div></header>
      {message?<p className="fleet-brief-message" role="alert">{message}</p>:valid?
        (navigator.pdfViewerEnabled?<object className="fleet-brief-object" type="application/pdf" data={valid.url} aria-label="重點摘要 PDF 預覽"><TextPreview report={valid.report}/></object>:<TextPreview report={valid.report}/>):
        <p className="fleet-brief-message" role="status">正在讀取本次資料並產生 PDF…</p>}
    </dialog>}</>;
}
