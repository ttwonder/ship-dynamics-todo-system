import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trackingTextChunks, trackingReportFileName, type TrackingReport } from './trackingReport';
import { formatTaipeiDateTime } from '../taipeiTime';
import './trackingReport.css';

export default function TrackingReportPreview({report,isCurrent,close}:{report:TrackingReport;isCurrent:()=>boolean;close:()=>void}){
 const [paper,setPaper]=useState<'A4'|'A3'>('A4'),[notice,setNotice]=useState('');
 const cleanupRef=useRef<null|(()=>void)>(null),mounted=useRef(true),shell=useRef<HTMLDivElement>(null);
 const current=useRef(isCurrent);current.current=isCurrent;
 useEffect(()=>{mounted.current=true;const previous=document.activeElement as HTMLElement;const keys=(e:KeyboardEvent)=>{if(e.key==='Escape')close();if(e.key==='Tab'){const controls=[...shell.current!.querySelectorAll<HTMLElement>('button,select')];const at=controls.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&at===0){e.preventDefault();controls[controls.length-1]?.focus();}else if(!e.shiftKey&&at===controls.length-1){e.preventDefault();controls[0]?.focus();}}};shell.current?.querySelector('button')?.focus();document.addEventListener('keydown',keys);return()=>{mounted.current=false;cleanupRef.current?.();document.removeEventListener('keydown',keys);previous?.focus();};},[]);
 const detailed=report.columns.length>8;
 const print=async()=>{
  if(!current.current()){setNotice('身份、範圍或保存狀態已改變，請關閉後重新建立快照。');return;}
  await document.fonts.ready;
  if(!mounted.current||!current.current())return;
  cleanupRef.current?.();const title=document.title,style=document.createElement('style');
  style.dataset.trackingPrint='true';style.textContent=`@page { size: ${paper} landscape; margin: 10mm 8mm 13mm; @bottom-right {content: "第 " counter(page) " 頁／共 " counter(pages) " 頁";font-family: "Microsoft JhengHei";font-size:9pt;} }`;
  document.head.append(style);document.title=trackingReportFileName(report,'pdf').replace(/\.pdf$/,'');document.body.classList.add('printing-tracking-report');
  const cleanup=()=>{style.remove();document.title=title;document.body.classList.remove('printing-tracking-report');window.removeEventListener('afterprint',cleanup);cleanupRef.current=null;};cleanupRef.current=cleanup;window.addEventListener('afterprint',cleanup,{once:true});
  try{window.print();}catch(e){cleanup();setNotice(String(e));}
 };
 return createPortal(<div className="tracking-report-modal" role="dialog" aria-modal="true" aria-label="跟蹤 PDF 預覽"><div className="tracking-report-shell" ref={shell}>
  <div className="tracking-report-actions no-print"><h2>跟蹤 PDF 預覽</h2><label>紙張<select aria-label="PDF 紙張" value={paper} onChange={e=>setPaper(e.target.value as 'A4'|'A3')}><option>A4</option><option>A3</option></select></label><span>橫向｜{detailed?'完整逐欄明細（不縮小文字／不省略欄位）':'精簡表格'}｜長文以「續」跨列</span><button className="btn primary" onClick={()=>void print()}>導出／列印 PDF</button><button className="btn ghost" onClick={close}>關閉 PDF 預覽</button>{notice&&<p role="status">{notice}</p>}</div>
  <article className={`tracking-report-paper paper-${paper}`}><table><colgroup>{detailed?<><col style={{width:'7%'}}/><col style={{width:'20%'}}/><col style={{width:'19%'}}/><col style={{width:'54%'}}/></>:report.columns.map(c=><col key={c.key} style={{width:`${c.width/report.columns.reduce((n,c)=>n+c.width,0)*100}%`}}/>)}</colgroup>
   <thead><tr><th colSpan={detailed?4:report.columns.length} className="tracking-report-heading"><h1>{report.vesselName}｜{report.title}</h1><p>{report.summary}｜{report.rows.length} 項｜{formatTaipeiDateTime(report.generatedAt)}（台北）</p><small>同一確認資料快照；完整內容續列，不作交船／結案推論。</small></th></tr><tr>{(detailed?['序號','項目編號','欄位','內容']:report.columns.map(c=>c.label)).map((c,i)=><th key={i}>{c}</th>)}</tr></thead>
   <tbody>{report.rows.flatMap((row,index)=>detailed?report.columns.flatMap(col=>trackingTextChunks(row.values[col.key]||'',800).map((text,part)=><tr key={`${row.id}:${col.key}:${part}`}><td>{index+1}{part?' 續':''}</td><td className={row.item.urgency==='urgent'?'tracking-report-urgent':''}>{row.item.referenceNo}</td><td>{col.label}{part?`（續 ${part+1}）`:''}</td><td>{text||'—'}</td></tr>)):(()=>{const chunks=report.columns.map(col=>trackingTextChunks(row.values[col.key]||'',180));const n=Math.max(1,...chunks.map(c=>c.length));return Array.from({length:n},(_,part)=><tr key={`${row.id}:${part}`}>{report.columns.map((col,c)=><td className={col.key==='referenceNo'&&row.item.urgency==='urgent'?'tracking-report-urgent':''} key={col.key}>{col.key==='referenceNo'&&part?`${row.item.referenceNo}（續 ${part+1}）`:chunks[c][part]||''}</td>)}</tr>);})())}
   {!report.rows.length&&<tr><td colSpan={detailed?4:report.columns.length}>沒有符合條件的項目（0 項）</td></tr>}</tbody>
  </table></article>
 </div></div>,document.body);
}
