import { useEffect, useRef, useState } from 'react';
import type { TrackingUiCallbacks } from './trackingUiTypes';
import { trackingColumnsFor } from './trackingColumns';
import { trackingTabKind, type TrackingQuery } from './trackingFilters';
import { defaultTrackingExportMonths, selectTrackingExportRows, trackingExportMonthRange } from './trackingExportMonths';
import { compactTrackingColumns, makeTrackingReport, trackingTitle, type TrackingReport } from './trackingReport';
import type { TrackingPreferences } from './trackingTablePreferences';
import TrackingReportPreview from './TrackingReportPreview';

export default function TrackingExports({query,preferences,selected,vesselName,identity,workspace,callbacks,blocked,count}:{query:TrackingQuery;preferences:TrackingPreferences;selected:string[];vesselName:string;identity:string;workspace:string;callbacks:TrackingUiCallbacks;blocked:boolean;count:number}){
 const [open,setOpen]=useState(false),[scope,setScope]=useState<'all'|'selected'>('all'),[fields,setFields]=useState('visible'),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [report,setReport]=useState<TrackingReport|null>(null),[pdf,setPdf]=useState(false);
 const [months,setMonths]=useState(defaultTrackingExportMonths);
 const generation=useRef(0),mounted=useRef(true),authority=useRef<(()=>boolean)|null>(null),busyRef=useRef(false);
 const signature=JSON.stringify([identity,workspace,query,preferences,selected,months,scope,fields,blocked,vesselName]);
 const live=useRef({identity,workspace,query,blocked,callbacks,signature});live.current={identity,workspace,query,blocked,callbacks,signature};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>{generation.current++;setReport(null);setPdf(false);setNotice('');},[signature]);
 const capture=()=>{const token=++generation.current,owner=identity,ws=workspace,vessel=query.vesselId;return()=>mounted.current&&token===generation.current&&owner===live.current.identity&&ws===live.current.workspace&&vessel===live.current.query.vesselId&&signature===live.current.signature&&!live.current.blocked;};
 const isCurrent=()=>Boolean(authority.current?.());
 const freeze=async()=>{
  if(busyRef.current||blocked||query.view==='deleted'||query.view==='requests'||['deleted','requests'].includes(query.tab))return;const current=capture();busyRef.current=true;setBusy(true);setReport(null);setPdf(false);setNotice('讀取已確認資料；不會以草稿或未知結果產生正式匯出。');
  try{
   const range=trackingExportMonthRange(months);
   const source=await callbacks.captureExport?.(query.vesselId);if(!source||!current()||!source.isCurrent()){if(current())setNotice('資料尚未確認或範圍已改變，請先完成保存／確認原結果再匯出。');return;}
   const rows=selectTrackingExportRows(source.items,query,months,scope==='selected'?selected:undefined);
   const all=trackingColumnsFor(trackingTabKind(query.tab));
   const columns=fields==='full'?all:fields==='compact'?compactTrackingColumns(trackingTabKind(query.tab)):preferences.order.flatMap(key=>{const c=all.find(c=>c.key===key);return c&&!preferences.hidden.includes(key)?[{...c,width:preferences.widths[key]||c.width}]:[];});
   const summary=`${scope==='all'?'全部符合目前條件':'所選'} ${rows.length} 項｜申請/開單日期（applicationDate）自然月 ${range.startMonth} 至 ${range.endMonth}（${range.from}～${range.to}，含首尾日）｜分頁 ${trackingTitle(query.tab)}｜${fields==='full'?'標準完整欄位':fields==='compact'?'明確精簡欄位':'目前可見欄位及欄序'}｜排序 ${all.find(c=>c.key===query.sort.key)?.label||query.sort.key} ${query.sort.direction==='asc'?'升冪':'降冪'}｜搜尋 ${query.search||'無'}｜篩選 ${JSON.stringify(query.filters)}`;
   authority.current=()=>current()&&source.isCurrent();
   setReport(makeTrackingReport(rows,columns,{vesselId:query.vesselId,vesselName,kind:trackingTabKind(query.tab),title:trackingTitle(query.tab),generatedAt:new Date().toISOString(),summary,selection:scope}));setNotice('共用快照已固定，XLSX 與 PDF 使用同一份記錄、欄位及排序。');
  }catch(e){if(current())setNotice(String(e));}finally{busyRef.current=false;if(mounted.current)setBusy(false);}
 };
 const download=async()=>{
  if(!report||busyRef.current||!isCurrent()){setNotice('快照已失效，請重新建立。');return;}
  const captured=report,valid=authority.current!;busyRef.current=true;setBusy(true);
  try{const api=await import('./trackingExcel');if(valid()&&await api.downloadTrackingWorkbook(captured,valid)&&valid())setNotice('XLSX 已產生；完整資料及「列印明細」使用同一快照。');}catch(e){if(valid())setNotice(`Excel 匯出失敗：${String(e)}`);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}
 };
 const template=async(kind:'supply'|'engineering')=>{
  if(busyRef.current||blocked)return;const current=capture();busyRef.current=true;setBusy(true);
  try{const api=await import('./trackingExcel');const bytes=await api.buildTrackingTemplate(kind,vesselName,query.vesselId);if(current())api.downloadTrackingBytes(bytes,kind==='supply'?'tracking-parts-materials.xlsm':'tracking-engineering.xlsm',current);}catch(e){if(current())setNotice(`模板下載失敗：${String(e)}`);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}
 };
 if(query.view==='deleted'||query.view==='requests'||['deleted','requests'].includes(query.tab))return null;
 return <><div className="tracking-export-actions" aria-label="跟蹤匯出與模板"><button className="btn small" disabled={blocked||busy} onClick={()=>{setOpen(true);setReport(null);}}>導出excel</button><button className="btn small" disabled={blocked||busy} onClick={()=>{setOpen(true);setReport(null);}}>導出pdf</button><button className="btn small" disabled={blocked||busy} onClick={()=>void template('supply')}>配件物料模板</button><button className="btn small" disabled={blocked||busy} onClick={()=>void template('engineering')}>工程模板</button></div>
 {notice&&!open&&<p role="status">{notice}</p>}
 {open&&<div className="modal-backdrop"><div className="modal tracking-export" role="dialog" aria-modal="true" aria-label="跟蹤匯出"><h2>{vesselName}｜{trackingTitle(query.tab)}匯出</h2><p>依申請/開單日期（applicationDate）套用完整自然月，並與目前船舶、分頁、搜尋、欄位篩選及所選項目取交集；不含已刪除項目。</p><div style={{display:'flex',flexWrap:'wrap',gap:12}}><label style={{flex:'1 1 160px'}}>開始月份<input aria-label="匯出開始月份" type="month" required min="0001-01" max="9999-12" disabled={busy} value={months.startMonth} style={{width:'100%'}} onChange={e=>{setMonths({...months,startMonth:e.target.value});setReport(null);setPdf(false);generation.current++;}}/></label><label style={{flex:'1 1 160px'}}>結束月份<input aria-label="匯出結束月份" type="month" required min="0001-01" max="9999-12" disabled={busy} value={months.endMonth} style={{width:'100%'}} onChange={e=>{setMonths({...months,endMonth:e.target.value});setReport(null);setPdf(false);generation.current++;}}/></label></div><label>資料範圍<select aria-label="匯出資料範圍" disabled={busy} value={scope} onChange={e=>{setScope(e.target.value as 'all'|'selected');setReport(null);generation.current++;}}><option value="all">目前畫面條件 {count} 項（尚未套用月份；不限本頁 30 項）</option><option value="selected">所選 {selected.length} 項（限目前條件內）</option></select></label><label>欄位<select aria-label="匯出欄位" disabled={busy} value={fields} onChange={e=>{setFields(e.target.value);setReport(null);generation.current++;}}><option value="visible">目前可見欄位及欄序</option><option value="full">標準完整欄位</option><option value="compact">明確精簡列印欄位（7 欄）</option></select></label><p>預設 A4 橫向；欄位多於 8 欄時，PDF 使用完整逐欄明細，不偷偷縮字或省略。也可選精簡 7 欄或 PDF 預覽中的 A3 橫向。Excel 保留完整資料表，寬表請列印「列印明細」。</p><button className="btn" disabled={busy||blocked} onClick={()=>void freeze()}>建立共用快照</button>{report&&<><p>{report.summary}</p><button className="btn primary" disabled={busy} onClick={()=>void download()}>下載 XLSX</button><button className="btn" disabled={busy} onClick={()=>{if(isCurrent())setPdf(true);else setNotice('快照已失效，請重新建立。');}}>PDF 預覽</button></>}<p role="status">{notice}</p><button className="btn ghost" disabled={busy} onClick={()=>{generation.current++;setOpen(false);setReport(null);setPdf(false);}}>關閉匯出</button></div></div>}
 {pdf&&report&&<TrackingReportPreview report={report} isCurrent={isCurrent} close={()=>setPdf(false)}/>}
 </>;
}
