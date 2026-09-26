import type ExcelJS from 'exceljs';
import { trackingColumnsFor } from './trackingColumns';
import { TRACKING_XLSX_VERSION } from './trackingImport';
import { trackingRowSnapshot } from './trackingFilters';
import { trackingTextChunks, trackingReportFileName, type TrackingReport } from './trackingReport';
import type { TrackingKind } from './trackingTypes';
import { formatTaipeiDateTime, taipeiDateKey } from '../taipeiTime';
import { TRACKING_REQUEST_TYPES } from './trackingRequestTypes';

function formatSheet(sheet:ExcelJS.Worksheet,widths:number[],header:number,paperSize=9){
 widths.forEach((w,i)=>{sheet.getColumn(i+1).width=w;});
 sheet.eachRow({includeEmpty:true},row=>{
  let lines=1;
  for(let c=1;c<=widths.length;c++){
   const cell=row.getCell(c);
   cell.font={name:'Microsoft JhengHei',size:11,bold:row.number<=header,color:{argb:'FF111111'}};
   cell.alignment={vertical:'top',wrapText:true};
   if(row.number>=header)cell.border={top:{style:'thin',color:{argb:'FF798492'}},bottom:{style:'thin',color:{argb:'FF798492'}},left:{style:'thin',color:{argb:'FF798492'}},right:{style:'thin',color:{argb:'FF798492'}}};
   if(row.number===header)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE5EDF5'}};
   const units=cell.text.split('\n').map(t=>Array.from(t).reduce((n,ch)=>n+(/[^\x00-\x7f]/.test(ch)?2:1),0));
   lines=Math.max(lines,units.reduce((n,v)=>n+Math.max(1,Math.ceil(v/Math.max(3,(widths[c-1]||15)-2))),0));
  }
  if(row.hasValues)row.height=row.number<header?row.number===1?28:32:Math.min(409,lines*16+8);
 });
 delete sheet.properties.outlineProperties;
 sheet.views=[{state:'frozen',ySplit:header,showGridLines:false}];
 sheet.pageSetup={orientation:'landscape',paperSize,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`1:${header}`,printArea:`A1:${sheet.getColumn(widths.length).letter}${Math.max(header+1,sheet.rowCount)}`,margins:{left:.25,right:.25,top:.4,bottom:.4,header:.15,footer:.15}};
 // Omitting scale is essential: a numeric Zoom overrides fit-to-page in native Excel.
 delete sheet.pageSetup.scale;
 sheet.headerFooter={oddFooter:'&LShip Dynamics&R第 &P 頁／共 &N 頁',oddHeader:'&C&"Microsoft JhengHei"跟蹤報表'};
}
export async function buildTrackingWorkbook(report:TrackingReport,template=false):Promise<ArrayBuffer>{
 const runtime=await import('exceljs');const book=new(runtime.Workbook||runtime.default.Workbook)();book.creator='Ship Dynamics';
 const columns=[...report.columns];
 // The immutable exported identity travels even when the personal ID column is hidden.
 if(!columns.some(c=>c.key==='id'))columns.push({key:'id',label:'系統 ID（僅辨識，不覆寫）',type:'text',width:230});
 columns.push({key:'vesselId',label:'來源船舶 ID（僅辨識）',type:'text',width:180});
 const sheet=book.addWorksheet(template?'填寫資料':'跟蹤資料');
 sheet.mergeCells(1,1,1,columns.length);sheet.getCell('A1').value=`${report.vesselName}｜${report.title}`;
 sheet.mergeCells(2,1,2,columns.length);sheet.getCell('A2').value=`${report.summary}\n匯出時間（台北）${formatTaipeiDateTime(report.generatedAt)}｜${report.rows.length} 項｜欄位超寬請列印「列印明細」，不必縮小資料字型。`;
 sheet.addRow(columns.map(c=>'tracking:'+c.key));sheet.addRow(columns.map(c=>c.label));
 for(const row of report.rows){
  const values=columns.map(c=>{
   const text=c.key==='id'?row.id:c.key==='vesselId'?report.vesselId:row.values[c.key]||'';
   if(text.length>32767)throw new Error(`項目 ${row.item.referenceNo} 的「${c.label}」超過 Excel 單格 32767 字元；未匯出截斷檔，請改用完整 PDF。`);
   if(c.type==='date'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)){const d=new Date(text.length===10?text+'T00:00:00Z':text);if(Number.isFinite(d.getTime()))return d;}
   return text; // Never formula objects, even = + - @ prefixed text.
  });sheet.addRow(values);
 }
 if(template)for(let i=0;i<10;i++)sheet.addRow(columns.map(()=>null));
 formatSheet(sheet,columns.map(c=>c.type==='date'?14:Math.min(45,Math.max(12,c.width/7))),4,8);
 sheet.getRow(3).hidden=true;
 columns.forEach((c,i)=>{const col=sheet.getColumn(i+1);col.numFmt=c.type==='date'?['createdAt','updatedAt'].includes(c.key)?'yyyy-mm-dd hh:mm:ss':'yyyy-mm-dd':'@';if(c.key==='vesselId'||(c.key==='id'&&!report.columns.some(x=>x.key==='id')))col.hidden=true;});
 sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(5,sheet.rowCount),column:columns.length}};
 report.rows.forEach((r,i)=>{if(r.item.urgency==='urgent'){const n=columns.findIndex(c=>c.key==='referenceNo');if(n>=0)sheet.getCell(i+5,n+1).font={name:'Microsoft JhengHei',size:11,bold:true,color:{argb:'FFC00000'}};}});
 if(template){
  const year=Number(taipeiDateKey(report.generatedAt).slice(0,4));
  const dates=book.addWorksheet('_tracking_dates');dates.state='veryHidden';dates.getColumn(1).numFmt='@';
  // Real ISO calendar dates, not locale-dependent serials or macro/calendar controls.
  for(const day=new Date(Date.UTC(year-5,0,1)),end=Date.UTC(year+11,0,1);day.getTime()<end;day.setUTCDate(day.getUTCDate()+1))dates.addRow([day.toISOString().slice(0,10)]);
  const name='TrackingTemplateDates';book.definedNames.add(`'_tracking_dates'!$A$1:$A$${dates.rowCount}`,name);
  const dateRule:ExcelJS.DataValidation={type:'list',allowBlank:true,showErrorMessage:true,errorStyle:'stop',errorTitle:'請選擇有效日期',error:'請使用本欄下拉清單中的日期（yyyy-mm-dd），不要輸入文字或多個日期。',showInputMessage:true,promptTitle:'日期下拉選擇',prompt:`請按右側箭頭選擇日期（${year-5}–${year+10}）；非必填日期可留空。`,formulae:[name]};
  // ExcelJS supports range validations at runtime but omits this API from its typings.
  // Cover appended input rows up to the existing import preview limit without adding blank printed pages.
  const validations=(sheet as ExcelJS.Worksheet & {dataValidations:{add(address:string,rule:ExcelJS.DataValidation):void}}).dataValidations;
  columns.forEach((c,i)=>{if(c.type==='date'){
   const col=sheet.getColumn(i+1);col.numFmt='@';
   // Column styles skip existing empty cells; retain text formatting in the bordered blank rows too.
   for(let r=5;r<=14;r++)sheet.getCell(r,i+1).numFmt='@';
   validations.add(`${col.letter}5:${col.letter}10000`,dateRule);
  }});
  for(let r=5;r<=14;r++){for(const k of ['normal','urgent','requestType']){const i=columns.findIndex(c=>c.key===k);if(i>=0)sheet.getCell(r,i+1).dataValidation={type:'list',allowBlank:true,showErrorMessage:true,error:'請選擇下拉清單中的內容',formulae:[k==='requestType'?'"'+TRACKING_REQUEST_TYPES.filter(t=>t.kind===report.kind).map(t=>t.label).join(',')+'"':'"是,否"']};}}
 }
 // Wide data stays editable/filterable. This explicit, unabridged companion is
 // the legible print layout: every chosen field, no hidden omission or tiny type.
 const print=book.addWorksheet('列印明細');
 print.mergeCells('A1:D1');print.getCell('A1').value=`${report.vesselName}｜${report.title}`;
 print.mergeCells('A2:D2');print.getCell('A2').value=`${report.summary}｜${report.rows.length} 項｜${formatTaipeiDateTime(report.generatedAt)}（台北）`;
 print.mergeCells('A3:D3');print.getCell('A3').value='完整欄位逐項列印；長文字標「續」，不省略。資料輸入／匯入請使用第一張工作表。';
 print.addRow(['序號','申請單號(材料或工程)','欄位','內容']);
 const printable=template?[{id:'',item:{referenceNo:''},values:{} as Record<string,string>}]:report.rows;
 printable.forEach((row,index)=>report.columns.forEach(col=>trackingTextChunks(row.values[col.key]||'').forEach((text,part)=>print.addRow([String(index+1),row.item.referenceNo,col.label+(part?`（續 ${part+1}）`:''),text]))));
 formatSheet(print,[7,25,25,94],4);
 print.getColumn(1).numFmt='@';print.getColumn(2).numFmt='@';print.getColumn(4).numFmt='@';
 const schema=book.addWorksheet('_tracking_schema');schema.addRows([['version',TRACKING_XLSX_VERSION],['kind',report.kind],['vesselName',report.vesselName],['vesselId',report.vesselId],['mapping','資料表 tracking: 技術列的欄位鍵；與個人欄序分離'],['policy','只新增；ID／歷程／人員不作寫入授權；重複 ID 必須排除'],['print','請列印「列印明細」；資料表完整保留所有選定欄位'],['dates','純日期 yyyy-mm-dd；完工、交船、結案與 DL 互不推導']]);schema.state='hidden';
 const buffer=await book.xlsx.writeBuffer();return Uint8Array.from(new Uint8Array(buffer)).buffer;
}
export async function buildTrackingTemplate(kind:TrackingKind,vesselName:string,vesselId:string){
 const report:TrackingReport={...trackingRowSnapshot([],trackingColumnsFor(kind).filter(c=>c.editable||['normal','urgent'].includes(c.key))),kind,vesselName,vesselId,title:kind==='supply'?'配件物料空白模板':'工程空白模板',generatedAt:new Date().toISOString(),summary:'空白模板｜日期、類型與普通／緊急請用下拉選擇｜日期格式 yyyy-mm-dd',selection:'all'};
 return buildTrackingWorkbook(report,true);
}
export function downloadTrackingBytes(bytes:ArrayBuffer,name:string,isCurrent:()=>boolean):boolean{
 if(!isCurrent())return false;const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
}
export async function downloadTrackingWorkbook(report:TrackingReport,isCurrent:()=>boolean){if(!isCurrent())return false;return downloadTrackingBytes(await buildTrackingWorkbook(report),trackingReportFileName(report,'xlsx'),isCurrent);}
