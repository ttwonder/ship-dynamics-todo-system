import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTaipeiDateTime } from '../taipeiTime';
import { STATISTICS_METRICS, statisticsPercent } from './trackingStatistics';
import { STATISTICS_POLICY, type StatisticsReport } from './trackingStatisticsReport';
import { trackingReportFileName, trackingTextChunks } from './trackingReport';
import './trackingReport.css';
import './trackingStatistics.css';

export default function TrackingStatisticsPreview({ report, isCurrent, close }: { report:StatisticsReport; isCurrent:()=>boolean; close:()=>void }) {
  const [notice,setNotice]=useState(''),cleanup=useRef<null|(()=>void)>(null),mounted=useRef(true),current=useRef(isCurrent),shell=useRef<HTMLDivElement>(null);
  current.current=isCurrent;
  useEffect(()=>{mounted.current=true;const previous=document.activeElement as HTMLElement; shell.current?.querySelector('button')?.focus();const keys=(event:KeyboardEvent)=>{if(event.key==='Escape')close();if(event.key==='Tab'){const buttons=[...shell.current!.querySelectorAll('button')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.shiftKey&&at===0){event.preventDefault();buttons[buttons.length-1]?.focus();}else if(!event.shiftKey&&at===buttons.length-1){event.preventDefault();buttons[0]?.focus();}}};document.addEventListener('keydown',keys);return()=>{mounted.current=false;cleanup.current?.();document.removeEventListener('keydown',keys);previous?.focus();};},[]);
  const print=async()=>{
    if(!current.current()){setNotice('身份、船舶、條件或保存狀態已變更；此統計快照不可匯出。請關閉並重讀統計。');return;}
    await document.fonts.ready;if(!mounted.current||!current.current())return;
    cleanup.current?.();const title=document.title,style=document.createElement('style');style.textContent='@page{size:A4 landscape;margin:10mm 8mm 13mm;@bottom-right{content:"第 " counter(page) " 頁／共 " counter(pages) " 頁";font-size:9pt}}';document.head.append(style);
    document.title=trackingReportFileName(report,'pdf').replace(/\.pdf$/,'');document.body.classList.add('printing-tracking-report');
    const after=()=>{style.remove();document.title=title;document.body.classList.remove('printing-tracking-report');window.removeEventListener('afterprint',after);cleanup.current=null;};cleanup.current=after;window.addEventListener('afterprint',after,{once:true});
    try{window.print();}catch{after();setNotice('未能啟動列印，請重試。');}
  };
  const categoryHeaders=['分類','申請數','有效項目','已完成','未完成','取消','完成率','延遲數','可判定','延遲率','急件'];
  return createPortal(<div className="tracking-report-modal tracking-stat-report" role="dialog" aria-modal="true" aria-label="統計 PDF 預覽"><div ref={shell} className="tracking-report-shell">
    <div className="tracking-report-actions"><h2>統計 PDF 預覽</h2><span>A4 橫向｜一頁寬、多頁高｜長內容續列</span><button className="btn primary" onClick={()=>void print()}>列印統計 PDF</button><button className="btn" onClick={close}>關閉統計 PDF</button>{notice&&<p role="alert">{notice}</p>}</div>
    <article className="tracking-report-paper"><h1>{report.vesselName}｜統計資訊</h1><p>摘要範圍：{report.scope.cohort}</p><p>確認快照 {formatTaipeiDateTime(report.generatedAt)}（台北）｜逾期判定日 {report.today}</p><p className="tracking-stat-print-policy">{STATISTICS_POLICY}</p>
      <div className="tracking-stat-print-summary">{STATISTICS_METRICS.map(([key,label])=><span key={key}>{label}：<b>{report.stats.summary[key]}</b></span>)}<span>完成率：{statisticsPercent(report.stats.summary.completionRate)}（{report.stats.summary.completed}/{report.stats.summary.effective}）</span><span>延遲率：{statisticsPercent(report.stats.summary.delayRate)}（{report.stats.summary.delayed}/{report.stats.summary.delayEligible}）</span></div>
      <table aria-label="PDF 統計分類"><thead><tr>{categoryHeaders.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.stats.categories.map(c=><tr key={c.value}>{[c.label,c.summary.total,c.summary.effective,c.summary.completed,c.summary.incomplete,c.summary.cancelled,statisticsPercent(c.summary.completionRate),c.summary.delayed,c.summary.delayEligible,statisticsPercent(c.summary.delayRate),c.summary.urgent].map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table>
      <table className="tracking-stat-print-details" aria-label="PDF 統計明細"><colgroup>{[14,9,9,19,9,9,10,10,11].map((w,i)=><col key={i} style={{width:`${w}%`}}/>)}</colgroup><thead><tr><th colSpan={9}>期間申請明細：{report.rows.length} 項｜焦點：{report.scope.detail}｜完整條件 {report.stats.summary.total} 項<br/>摘要範圍：{report.scope.cohort}</th></tr><tr>{['申請單號／項目 ID','申請／開單日期','分類／急件','內容摘要／工程內容','DL','實際送達／完工','狀態／延遲','最新進度','補充說明'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.rows.flatMap(row=>{
        const v=row.values,parts=[`${v.referenceNo}\n${v.id}`,v.applicationDate,v.category,v.description,v.expectedDate,v.actualDate,`${v.status}\n${v.delay}`,v.progress,v.supplementalNotes].map(value=>trackingTextChunks(value||'',140));
        return Array.from({length:Math.max(...parts.map(p=>p.length))},(_,i)=><tr key={`${row.id}:${i}`}>{parts.map((p,c)=><td key={c}>{p[i]||(c===0?`續 ${i+1}`:'')}</td>)}</tr>);
      })}{!report.rows.length&&<tr><td colSpan={9}>沒有符合目前條件／焦點的項目（0 項）</td></tr>}</tbody></table>
    </article>
  </div></div>,document.body);
}
