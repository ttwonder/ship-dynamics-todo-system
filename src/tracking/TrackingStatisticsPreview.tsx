import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTaipeiDateTime } from '../taipeiTime';
import { STATISTICS_METRICS, statisticsPercent } from './trackingStatistics';
import { STATISTICS_POLICY, type StatisticsReport } from './trackingStatisticsReport';
import { trackingReportFileName } from './trackingReport';
import TrackingStatisticsCharts from './TrackingStatisticsCharts';
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
    <div className="tracking-report-actions"><h2>統計 PDF 預覽</h2><span>A4 橫向｜摘要、分類與圖形總計</span><button className="btn primary" onClick={()=>void print()}>列印統計 PDF</button><button className="btn" onClick={close}>關閉統計 PDF</button>{notice&&<p role="alert">{notice}</p>}</div>
    <article className="tracking-report-paper"><h1>{report.vesselName}｜統計資訊</h1><p>摘要範圍：{report.scope.cohort}</p><p>確認快照 {formatTaipeiDateTime(report.generatedAt)}（台北）｜逾期判定日 {report.today}</p><p className="tracking-stat-print-policy">{STATISTICS_POLICY}</p>
      <div className="tracking-stat-print-summary">{STATISTICS_METRICS.map(([key,label])=><span key={key}>{label}：<b>{report.stats.summary[key]}</b></span>)}<span>完成率：{statisticsPercent(report.stats.summary.completionRate)}（{report.stats.summary.completed}/{report.stats.summary.effective}）</span><span>延遲率：{statisticsPercent(report.stats.summary.delayRate)}（{report.stats.summary.delayed}/{report.stats.summary.delayEligible}）</span></div>
      <table aria-label="PDF 統計分類"><thead><tr>{categoryHeaders.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.stats.categories.map(c=><tr key={c.value}>{[c.label,c.summary.total,c.summary.effective,c.summary.completed,c.summary.incomplete,c.summary.cancelled,statisticsPercent(c.summary.completionRate),c.summary.delayed,c.summary.delayEligible,statisticsPercent(c.summary.delayRate),c.summary.urgent].map((v,i)=><td key={i}>{v}</td>)}</tr>)}</tbody></table>
      <TrackingStatisticsCharts stats={report.stats}/>
    </article>
  </div></div>,document.body);
}
