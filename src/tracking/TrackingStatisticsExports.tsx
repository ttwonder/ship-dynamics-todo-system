import { useEffect, useRef, useState } from 'react';
import type { TrackingItem } from './trackingTypes';
import type { TrackingStatisticsQuery, StatisticsFocus } from './trackingStatistics';
import { makeStatisticsReport, type StatisticsReport } from './trackingStatisticsReport';
import { trackingReportFileName } from './trackingReport';
import TrackingStatisticsPreview from './TrackingStatisticsPreview';

export default function TrackingStatisticsExports({items,query,focus,vesselName,generatedAt,today,isCurrent}:{items:readonly TrackingItem[];query:TrackingStatisticsQuery;focus:StatisticsFocus;vesselName:string;generatedAt:string;today:string;isCurrent:()=>boolean}) {
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[pdf,setPdf]=useState<{report:StatisticsReport;valid:()=>boolean}|null>(null);
  const mounted=useRef(true),busyRef=useRef(false),signature=JSON.stringify([query,focus,vesselName,generatedAt,today]),live=useRef({signature,isCurrent});live.current={signature,isCurrent};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setPdf(null);setNotice('');},[signature]);
  const valid=()=>mounted.current&&signature===live.current.signature&&live.current.isCurrent();
  const capture=()=>makeStatisticsReport(items,query,focus,{vesselName,generatedAt,today});
  const excel=async()=>{
    if(busyRef.current)return;if(!valid()){setNotice('統計快照已失效，請重讀統計。');return;}
    const report=capture();busyRef.current=true;setBusy(true);
    try{const [api,download]=await Promise.all([import('./trackingStatisticsExcel'),import('./trackingExcel')]);if(!valid())return;const bytes=await api.buildStatisticsWorkbook(report);if(download.downloadTrackingBytes(bytes,trackingReportFileName(report,'xlsx'),valid))setNotice('統計 XLSX 已產生；摘要為完整條件，明細為相同快照內的焦點。');}
    catch(error){if(valid())setNotice(`統計 Excel 匯出失敗：${error instanceof Error?error.message:String(error)}`);}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  };
  return <div className="tracking-stat-exports" aria-label="統計專用匯出"><button className="btn small" disabled={busy} onClick={()=>void excel()}>統計 Excel</button><button className="btn small" disabled={busy} onClick={()=>{if(valid())setPdf({report:capture(),valid});else setNotice('統計快照已失效，請重讀統計。');}}>統計 PDF</button><span>同一確認快照、同條件／焦點（與原清單匯出分開）</span>{notice&&<p role="status">{notice}</p>}{pdf&&<TrackingStatisticsPreview report={pdf.report} isCurrent={pdf.valid} close={()=>setPdf(null)}/>}</div>;
}
