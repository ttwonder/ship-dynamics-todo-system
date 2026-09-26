import { useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';
import { uid, nowIso } from '../runtimeUtils';
import { trackingColumnsFor } from './trackingColumns';
import { TrackingItemFields } from './TrackingItemFields';
import { importDuplicate, importRowErrors, parseTrackingWorkbook, selectImportBatch, type ImportRow, type TrackingImport } from './trackingImport';
import type { TrackingItem } from './trackingTypes';
import type { TrackingSubmission, TrackingUiCallbacks } from './trackingUiTypes';

interface ImportDraft { parsed: TrackingImport | null; sheet: number; shipConfirmed: boolean; duplicates: string[]; pending: TrackingSubmission | null; batches: {operation:string; ids:string[]; at:string}[] }
const empty = (): ImportDraft => ({parsed:null,sheet:0,shipConfirmed:false,duplicates:[],pending:null,batches:[]});
export default function TrackingImportModal({vesselId,vesselName,workspace,actorId,identity,canCreate,canClose,data,callbacks,onClose,registerGuard}: {
 vesselId:string; vesselName:string; workspace:string; actorId:string; identity:string; canCreate:boolean; canClose:boolean; data:AppData; callbacks:TrackingUiCallbacks; onClose:()=>void; registerGuard:(guard:null|(()=>Promise<boolean>))=>void;
}) {
 const key=JSON.stringify(['tracking-import-v1',workspace,actorId,vesselId]);
 const [state,setState]=useState<ImportDraft>(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')||empty();}catch{return empty();}});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[navigation,setNavigation]=useState<null|((allow:boolean)=>void)>(null);
 const stateRef=useRef(state);stateRef.current=state;const busyRef=useRef(false),mounted=useRef(true),generation=useRef(0);
 const live=useRef({identity,vesselId,canCreate,canClose,callbacks,data});live.current={identity,vesselId,canCreate,canClose,callbacks,data};
 const current=()=>mounted.current&&live.current.identity===identity&&live.current.vesselId===vesselId&&live.current.canCreate;
 const write=(next:ImportDraft)=>{try{localStorage.setItem(key,JSON.stringify(next));stateRef.current=next;setState(next);return true;}catch{setNotice('本機匯入草稿保存失敗；未送出，請勿關閉頁面。');return false;}};
 const sheet=state.parsed?.sheets[state.sheet],rows=sheet?.rows||[];
 const changeRow=(id:string,change:Partial<ImportRow>)=>{if(stateRef.current.pending||busyRef.current)return;const next=structuredClone(stateRef.current);next.parsed!.sheets[next.sheet].rows=rows.map(row=>row.key===id?{...row,...change}:row);write(next);};
 const errors=(row:ImportRow)=>{const d=importDuplicate(row,rows,data.trackingItems||[]);return [...importRowErrors(row),...(d.blocked?d.messages:[]),...(!state.duplicates.includes(row.key)?d.messages.filter(m=>m.includes('疑似')):[]),...(row.item.isClosed&&!canClose?['目前無結案權限']:[])];};
 const chosen=rows.filter(r=>r.selected&&!r.saved);
 const submit=async()=>{
  if(busyRef.current||!current())return false;
  const token=++generation.current;const isCurrent=()=>current()&&token===generation.current;
  busyRef.current=true;setBusy(true);setNotice('核對選取與最新資料；每批獨立交易，等待伺服器確認。');
  try{
   let pending=stateRef.current.pending;
   if(!pending){
    if(!stateRef.current.shipConfirmed)throw new Error('請先核對來源船名線索並確認本次選船。');
    const fresh=await live.current.callbacks.load(vesselId);if(!fresh||!isCurrent())return false;
    const s=stateRef.current,sourceRows=s.parsed!.sheets[s.sheet].rows;
    const items=selectImportBatch(sourceRows,fresh.trackingItems||[],s.duplicates);
    if(items.some(i=>i.isClosed)&&!live.current.canClose)throw new Error('目前無結案權限，整批未提交。');
    // Explicit closures are planned with existing lifecycle commands, in the SAME App delta/RPC.
    const closures=items.filter(i=>i.isClosed).map(i=>({id:i.id,date:i.closedDate||'',outcome:i.closureOutcome||'completed' as const}));
    pending={command:{type:'create',items,importClosures:closures},context:{actorId,at:nowIso(),operationId:uid('tracking-import')},identity};
    if(!write({...s,pending:structuredClone(pending)}))return false;
   }
   if(pending.identity!==identity)throw new Error('原提交屬於先前工作階段；請透過原保存協調器確認結果，不可另建。');
   const ok=await live.current.callbacks.submit(pending);if(!isCurrent())return false;
   if(!ok){setNotice('尚未確認保存；保留原批次、ID 及精確提交。請確認結果／重試相同提交，不能重選另一批。');return false;}
   const ids=pending.command.type==='create'?pending.command.items.map(r=>r.id):[];
   const next=structuredClone(stateRef.current);next.pending=null;
   next.parsed!.sheets.forEach(s=>s.rows.forEach(r=>{if(ids.includes(r.item.id)){r.saved=true;r.selected=false;}}));
   next.batches.push({operation:pending.context.operationId,ids,at:pending.context.at});
   if(!write(next))return false;
   if(!await live.current.callbacks.release()){setNotice('本批已確認保存，編輯鎖尚未釋放；請稍後關閉導入。');return true;}
   setNotice(`本批 ${ids.length} 項已確認並權威讀回。其他批次尚未提交；各批不構成同一交易。`);return true;
  }catch(e){if(isCurrent())setNotice(e instanceof Error?e.message:String(e));return false;}
  finally{if(isCurrent()){busyRef.current=false;setBusy(false);}}
 };
 const leave=async()=>{
  if(busyRef.current||stateRef.current.pending){setNotice('原提交尚待確認，不能關閉或放棄未知結果。');return false;}
  if(!stateRef.current.parsed||stateRef.current.parsed.sheets.every(s=>s.rows.every(r=>r.saved||!r.selected)))return true;
  return new Promise<boolean>(resolve=>setNavigation(()=>resolve));
 };
 useEffect(()=>{mounted.current=true;registerGuard(leave);return()=>{mounted.current=false;generation.current++;registerGuard(null);};},[]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(stateRef.current.parsed){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 const close=async()=>{if(await leave()&&await callbacks.release())onClose();};
 const reconcile=async()=>{
  if(busyRef.current||!stateRef.current.pending||!current())return;
  busyRef.current=true;setBusy(true);setNotice('正在核對原提交；未知結果不能解除。');
  try{if(!await callbacks.discardRejected?.()||!current())return;const fresh=await callbacks.load(vesselId);if(!fresh||!current())return;write({...stateRef.current,pending:null});setNotice('已證明拒絕並讀回最新資料；保留輸入，請重新核對選取後明確保存。');}
  finally{if(current()){busyRef.current=false;setBusy(false);}}
 };
 const loadFile=async(file:File|undefined)=>{
  if(!file||busyRef.current||stateRef.current.pending)return;
  if(stateRef.current.parsed?.sheets.some(s=>s.rows.some(r=>!r.saved&&r.selected))&&!confirm('以新檔取代未提交的匯入預覽？原檔不會修改。'))return;
  const token=++generation.current;busyRef.current=true;setBusy(true);setNotice('正在本機解析 Excel（XLSX／XLSM）；不會執行巨集、上傳或自動寫入業務資料。');
  try{const parsed=await parseTrackingWorkbook(await file.arrayBuffer(),file.name,vesselId);if(current()&&token===generation.current){write({...empty(),parsed});setNotice('解析完成；請核對工作表、欄位、異常及船舶，再明確選取保存。');}}
  catch(e){if(current()&&token===generation.current)setNotice(`解析失敗，未寫入：${e instanceof Error?e.message:String(e)}`);}
  finally{if(current()&&token===generation.current){busyRef.current=false;setBusy(false);}}
 };
 return <div className="modal-backdrop"><div className="modal tracking-modal tracking-import" role="dialog" aria-modal="true" aria-label="Excel 導入預覽">
  <div className="modal-head"><h2>Excel 導入預覽（只新增）</h2><button className="btn ghost" onClick={()=>void close()}>{state.batches.length?'關閉導入':'取消導入'}</button></div>
  <p>本次固定船舶：{vesselName}。原檔唯讀；不按名稱／工單覆寫或合併。每批最多 100 項，超過須自行選擇下一批，各批獨立原子保存。</p>
  <input aria-label="選擇跟蹤 Excel" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" disabled={busy||Boolean(state.pending)} onChange={e=>void loadFile(e.target.files?.[0])}/>
  {state.parsed&&<><label>來源工作表<select aria-label="匯入工作表" disabled={busy||Boolean(state.pending)} value={state.sheet} onChange={e=>write({...state,sheet:Number(e.target.value),shipConfirmed:false})}>{state.parsed.sheets.map((s,i)=><option key={s.name} value={i}>{s.name}｜{s.format}</option>)}</select></label>
   <p>來源：{state.parsed.fileName}｜SHA-256 {state.parsed.fileHash}<br/>主表範圍 {sheet?.range}；主表候選 {rows.filter(r=>!r.outside).length} 項（工程以分項計，不以工單去重）；人工加入 {rows.filter(r=>r.outside).length} 項；主表外排除 {sheet?.excluded.length} 列。可匯入 {rows.filter(r=>!r.saved&&!errors(r).length).length} 項；需處理 {rows.filter(r=>!r.saved&&errors(r).length).length} 項；已保存 {rows.filter(r=>r.saved).length} 項。</p>
   <p>船名／檔名線索：{sheet?.clues.join('｜')}；不能據此自動配船。</p>
   <label><input aria-label="確認本次選船" type="checkbox" disabled={busy||Boolean(state.pending)} checked={state.shipConfirmed} onChange={e=>write({...state,shipConfirmed:e.target.checked})}/>我已核對，將所選資料新增至「{vesselName}」</label>
   <details><summary>欄位映射（{sheet?.format}）</summary><ul>{sheet?.mapping.map(m=><li key={m.column}>{m.column}{m.hidden?'（原隱藏欄，已讀取）':''}：{m.label} → {trackingColumnsFor(sheet.kind).find(c=>c.key===m.field)?.label||m.field}</li>)}</ul><p>技術欄位按模板版本映射，不依個人顯示欄序。若映射不符，請取消或逐列修正，未選中的列不保存。</p></details>
   {sheet?.kind==='engineering'&&<p>原 F34 沒有緊急度：普通（預設）；不從顏色或文字猜緊急。完工日期不等於結案日期。</p>}
   <div className="tracking-toolbar"><button className="btn small" disabled={busy||Boolean(state.pending)} onClick={()=>{const next=structuredClone(state);next.parsed!.sheets[next.sheet].rows.forEach(r=>r.selected=!r.saved);write(next);}}>選取全部候選</button><button className="btn small" disabled={busy||Boolean(state.pending)} onClick={()=>{let n=0;const next=structuredClone(state);next.parsed!.sheets[next.sheet].rows.forEach(r=>r.selected=!r.saved&&!errors(r).length&&n++<100);write(next);}}>明確選取前 100 項可匯入資料</button><button className="btn small" disabled={busy||Boolean(state.pending)} onClick={()=>{const next=structuredClone(state);next.parsed!.sheets[next.sheet].rows.forEach(r=>r.selected=false);write(next);}}>清除本批選取</button><b>本批選取 {chosen.length} 項</b></div>
   <div className="tracking-import-rows">{rows.map(row=>{const duplicate=importDuplicate(row,rows,data.trackingItems||[]),problems=errors(row),prefix=`匯入第 ${row.sourceRow} 列 `;const update=(patch:Partial<TrackingItem>)=>changeRow(row.key,{item:{...row.item,...patch}});return <fieldset key={row.key} disabled={busy||Boolean(state.pending)||row.saved} className="tracking-form-row"><legend><label><input aria-label={`選取來源第${row.sourceRow}列`} type="checkbox" checked={row.selected} disabled={duplicate.blocked||row.saved} onChange={e=>changeRow(row.key,{selected:e.target.checked})}/>來源第 {row.sourceRow} 列｜{row.item.referenceNo} {row.item.subitemNo&&`分項 ${row.item.subitemNo}`}｜{row.saved?'已確認保存':problems.length?'需處理':'可匯入'}</label></legend>
    <div>{row.item.description}</div>{duplicate.messages.map(m=><p key={m}>{m}</p>)}
    {!duplicate.blocked&&duplicate.messages.some(m=>m.includes('疑似'))&&<label><input aria-label={`${prefix}確認疑似重複仍新增`} type="checkbox" checked={state.duplicates.includes(row.key)} onChange={e=>write({...state,duplicates:e.target.checked?[...state.duplicates,row.key]:state.duplicates.filter(k=>k!==row.key)})}/>核對後仍新增此独立來源（不覆寫）</label>}
    <details open={row.selected&&Boolean(problems.length)}><summary>核對／編輯完整欄位及原值</summary><TrackingItemFields row={row.item} prefix={prefix} creating onChange={update}/><div className="tracking-form-grid">
     {row.item.kind==='supply'&&<label>送船狀態<select aria-label={prefix+'送船狀態'} value={row.item.deliveryStatus} onChange={e=>update({deliveryStatus:e.target.value as TrackingItem['deliveryStatus']})}><option value="not-delivered">未送船</option><option value="partially-delivered">部分送船</option><option value="delivered">已送船（全部實際交船）</option></select></label>}
     <label><input type="checkbox" aria-label={prefix+'明確結案'} disabled={!canClose} checked={row.item.isClosed} onChange={e=>update({isClosed:e.target.checked})}/>明確結案（不由完工或收到文字推定）</label>
     {row.item.isClosed&&<><label>結案日期<input type="date" aria-label={prefix+'結案日期'} value={row.item.closedDate||''} onChange={e=>update({closedDate:e.target.value})}/></label>{row.item.kind==='engineering'&&<><label>結案結果<select aria-label={prefix+'結案結果'} value={row.item.closureOutcome||'completed'} onChange={e=>update({closureOutcome:e.target.value as TrackingItem['closureOutcome']})}><option value="completed">正常結案（不代填完工日期）</option><option value="cancelled">取消結案</option></select></label><button type="button" className="btn small" disabled={!row.item.completionDate} onClick={()=>update({closedDate:row.item.completionDate})}>明確採用已核對完工日期作結案日期</button></>}</>}
    </div><ul>{row.issues.map(issue=><li key={issue.code}><label><input type="checkbox" aria-label={prefix+issue.code} checked={row.acknowledgements.includes(issue.code)} onChange={e=>changeRow(row.key,{acknowledgements:e.target.checked?[...row.acknowledgements,issue.code]:row.acknowledgements.filter(k=>k!==issue.code)})}/>{issue.message}（我已核對並明確接受上方欄位值）</label></li>)}</ul><pre>{JSON.stringify(row.item.source,null,2)}</pre></details>
    {row.selected&&problems.length>0&&<p role="status">此列未就緒：{problems.join('；')}</p>}
   </fieldset>;})}</div>
   <details><summary>主表以外／排除清單（不會自動保存）</summary>{sheet?.excluded.map(ex=><section key={ex.sourceRow}><p>第 {ex.sourceRow} 列：{ex.reason}</p><pre>{JSON.stringify(ex.values,null,2)}</pre><button className="btn small" disabled={busy||Boolean(state.pending)||!sheet.mapping.length} onClick={()=>{const next=structuredClone(state);const s=next.parsed!.sheets[next.sheet];const item:TrackingItem={id:uid('tracking'),kind:s.kind,vesselId,referenceNo:'',description:'',applicationDate:'',urgency:'normal',expectedDate:'',progress:'',supplementalNotes:'',deliveryStatus:'not-delivered',isClosed:false,createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',statusLogs:[],source:{fileName:state.parsed!.fileName,sheetName:s.name,row:ex.sourceRow,originalValues:{...ex.values,_fileSha256:state.parsed!.fileHash}}};s.rows.push({key:`manual:${ex.sourceRow}`,sourceRow:ex.sourceRow,item,issues:[{code:'outside-confirm',message:'人工納入主表外原值，請補齊正確欄位並核對'}],acknowledgements:[],selected:false,outside:true});s.excluded=s.excluded.filter(r=>r.sourceRow!==ex.sourceRow);write(next);}}>人工加入第 {ex.sourceRow} 列供編輯</button></section>)}</details>
  </>}
  <p role="status">{notice}</p>{state.batches.length>0&&<details><summary>已確認批次 {state.batches.length}（各自獨立）</summary>{state.batches.map(b=><p key={b.operation}>{b.operation}｜{b.ids.length} 項｜{b.at}</p>)}</details>}
  <div className="modal-actions">{state.pending&&<button className="btn" disabled={busy} onClick={()=>void reconcile()}>核對並解除已拒絕匯入</button>}<button className="btn primary" disabled={busy||!canCreate||(!state.pending&&(!chosen.length||chosen.length>100||!state.shipConfirmed||chosen.some(r=>errors(r).length>0)))} onClick={()=>void submit()}>{busy?'等待解析／雲端確認…':state.pending?'確認結果／重試相同匯入':`確認保存所選 ${chosen.length} 項`}</button></div>
  {navigation&&<div className="tracking-navigation"><h3>尚有已選取、未保存的匯入資料</h3><button className="btn" onClick={()=>void submit().then(ok=>{if(ok){navigation(true);setNavigation(null);}})}>保存本批後繼續</button><button className="btn" onClick={()=>{if(write(stateRef.current)){navigation(true);setNavigation(null);}}}>保留匯入草稿並繼續</button><button className="btn" onClick={()=>{navigation(false);setNavigation(null);}}>取消切換</button></div>}
 </div></div>;
}
