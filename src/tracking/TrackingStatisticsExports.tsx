import { useEffect, useRef, useState } from 'react';
import type { TrackingStatisticsQuery } from './trackingStatistics';
import { makeStatisticsSummaryReport, type StatisticsReport, type TrackingStatisticsSummary } from './trackingStatisticsReport';
import { trackingReportFileName } from './trackingReport';
import TrackingStatisticsPreview from './TrackingStatisticsPreview';

export default function TrackingStatisticsExports({stats,query,vesselName,generatedAt,today,isCurrent}:{stats:TrackingStatisticsSummary;query:TrackingStatisticsQuery;vesselName:string;generatedAt:string;today:string;isCurrent:()=>boolean}) {
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[pdf,setPdf]=useState<{report:StatisticsReport;valid:()=>boolean}|null>(null);
  const mounted=useRef(true),busyRef=useRef(false),signature=JSON.stringify([query,vesselName,generatedAt,today]),live=useRef({signature,isCurrent});live.current={signature,isCurrent};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setPdf(null);setNotice('');},[signature]);
  const valid=()=>mounted.current&&signature===live.current.signature&&live.current.isCurrent();
  const capture=()=>makeStatisticsSummaryReport(stats,query,{vesselName,generatedAt,today});
  const excel=async()=>{
    if(busyRef.current)return;if(!valid()){setNotice('統計快照已失效，請重讀統計。');return;}
    const report=capture();busyRef.current=true;setBusy(true);
    try{const [api,download]=await Promise.all([import('./trackingStatisticsExcel'),import('./trackingExcel')]);if(!valid())return;const bytes=await api.buildStatisticsWorkbook(report);if(download.downloadTrackingBytes(bytes,trackingReportFileName(report,'xlsx'),valid))setNotice('統計 XLSX 已產生；只含所選範圍的摘要與分類，不含逐項明細。');}
    catch(error){if(valid())setNotice(`統計 Excel 匯出失敗：${error instanceof Error?error.message:String(error)}`);}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  };
  return <div className="tracking-stat-exports" aria-label="統計專用匯出"><button className="btn small" disabled={busy} onClick={()=>void excel()}>統計 Excel</button><button className="btn small" disabled={busy} onClick={()=>{if(valid())setPdf({report:capture(),valid});else setNotice('統計快照已失效，請重讀統計。');}}>統計 PDF</button><span>同一確認快照、同條件彙總（與原清單匯出分開）</span>{notice&&<p role="status">{notice}</p>}{pdf&&<TrackingStatisticsPreview report={pdf.report} isCurrent={pdf.valid} close={()=>setPdf(null)}/>}</div>;
}
