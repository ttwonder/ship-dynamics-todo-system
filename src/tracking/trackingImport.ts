import type ExcelJS from 'exceljs';
import type { TrackingItem, TrackingKind } from './trackingTypes';
import { isValidInternalControlDate } from '../internalControlWorkflow';
import { TRACKING_LEGACY_EDIT_FIELDS, validateTrackingItem } from './trackingWorkflow';
import { uid } from '../runtimeUtils';
import { trackingColumnsFor } from './trackingColumns';
import { parseTrackingRequestType } from './trackingRequestTypes';

export const TRACKING_XLSX_VERSION = 'ship-tracking/1';
export interface ImportIssue { code: string; message: string }
export interface ImportRow {
  key: string; sourceRow: number; item: TrackingItem; issues: ImportIssue[];
  acknowledgements: string[]; selected: boolean; saved?: boolean; outside?: boolean; exportedId?: string;
}
export interface ImportExcluded { sourceRow: number; reason: string; values: Record<string, string | number | boolean | null> }
export interface ImportSheet {
  name: string; kind: TrackingKind; format: string; range: string; clues: string[];
  mapping: { column: string; label: string; field: string; hidden: boolean }[];
  rows: ImportRow[]; excluded: ImportExcluded[];
}
export interface TrackingImport { fileName: string; fileHash: string; sheets: ImportSheet[] }
const F28 = ['originalItemNo','applicationDate','referenceNo','purchaseNos','materialCategory','description','normal','urgent','urgentOther','preparationDate','supplier','estimatedSupplyDatePlace','progress'];
const F34 = ['originalItemNo','referenceNo','description','applicationDate','countersignDate','contractor','constructionPort','completionDate','originalRemarks'];
const DATE_FIELDS = new Set(['applicationDate','expectedDate','preparationDate','countersignDate','completionDate','actualDeliveryDate','closedDate']);
function raw(cell: ExcelJS.Cell): string | number | boolean | null {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if ('formula' in value || 'sharedFormula' in value) return `=${'formula' in value ? value.formula : value.sharedFormula}`;
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  if ('text' in value) return value.text;
  return cell.text;
}
function display(cell: ExcelJS.Cell): string {
  const v = raw(cell);
  // Numeric identifiers with an explicit zero display mask retain their display zeros.
  return typeof v === 'number' && /^0+$/.test(cell.numFmt) ? String(v).padStart(cell.numFmt.length, '0') : v == null ? '' : String(v);
}
export function parseTrackingDate(value: unknown, date1904 = false): string | null {
  if (value == null || value === '') return '';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0,10) : null;
  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) || text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) { const date = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`; return isValidInternalControlDate(date) ? date : null; }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value < 100000 && (date1904 || value !== 60)) {
    const base = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    return new Date(base + (value + (!date1904 && value < 60 ? 1 : 0)) * 86400000).toISOString().slice(0,10);
  }
  return null;
}
const marked = (value: string) => /^(v|✓|✔|是|true|1|y|yes)$/i.test(value.trim());
function blankItem(vesselId: string, kind: TrackingKind): TrackingItem {
  return { id: uid('tracking'), vesselId, kind, referenceNo:'', description:'', applicationDate:'', urgency:'normal', expectedDate:'', progress:'', supplementalNotes:'', deliveryStatus:'not-delivered', isClosed:false, createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',statusLogs:[] };
}
export async function parseTrackingWorkbook(input: ArrayBuffer | Uint8Array, fileName: string, vesselId: string): Promise<TrackingImport> {
  if (input.byteLength > 20 * 1024 * 1024) throw new Error('檔案超過 20 MB，請先分成較小的 XLSX。');
  const runtime = await import('exceljs');
  const book = new (runtime.Workbook || runtime.default.Workbook)();
  await book.xlsx.load(input as ExcelJS.Buffer);
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(new Uint8Array(input as ArrayBuffer)).buffer);
  const fileHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  const result: TrackingImport = { fileName, fileHash, sheets:[] };
  const schema = book.getWorksheet('_tracking_schema');
  if (schema && schema.getCell('B1').text !== TRACKING_XLSX_VERSION) throw new Error('不支援此跟蹤模板版本；未匯入任何資料。');
  for (const sheet of book.worksheets) {
    if (sheet.name.startsWith('_') || sheet.name === '列印明細') continue;
    if (sheet.rowCount > 10000 || sheet.columnCount > 200) throw new Error('工作表超過預覽上限（10000 列／200 欄），請明確分檔。');
    let keys: string[] = [], start = 0, header = 0, kind: TrackingKind = 'supply', format = '';
    const keyRow = schema ? Array.from({length:Math.min(20,sheet.rowCount)},(_,i)=>i+1).find(r=>sheet.getRow(r).values && sheet.getRow(r).findCell(1)?.text.startsWith('tracking:')) : undefined;
    if (keyRow) {
      const k = schema!.getCell('B2').text;
      if (k !== 'supply' && k !== 'engineering') throw new Error('模板資料類型不明。');
      kind=k; header=keyRow+1; start=header+1; format=TRACKING_XLSX_VERSION;
      sheet.getRow(keyRow).eachCell({includeEmpty:true},(cell,c)=>{keys[c-1]=cell.text.replace(/^tracking:/,'');});
      const known=new Set([...trackingColumnsFor(kind).map(c=>c.key),...TRACKING_LEGACY_EDIT_FIELDS,'vesselId']);
      if(keys.some(k=>!known.has(k)) || new Set(keys).size!==keys.length) throw new Error('模板欄位映射不明或重複，請使用新空白模板。');
    } else {
      for (let r=1; r<=Math.min(20,sheet.rowCount); r++) {
        if (/工委單編號/.test(sheet.getCell(r,2).text) && /工程內容/.test(sheet.getCell(r,3).text)) {keys=F34;header=r;start=r+1;kind='engineering';format='F34';break;}
        if (/Submitted|船上申請日期/i.test(sheet.getCell(r,2).text) && /M\/R|材料申請單/i.test(sheet.getCell(r,3).text)) {keys=F28;header=r;start=r+2;format='F28';break;}
      }
    }
    if (!start) {
      const excluded: ImportExcluded[]=[];sheet.eachRow(row=>{const values:ImportExcluded['values']={};row.eachCell(c=>{values[c.address]=raw(c);});if(Object.values(values).some(v=>v!==null&&v!==''))excluded.push({sourceRow:row.number,reason:'無法識別的工作表／欄位；不自動新增',values});});
      if(excluded.length)result.sheets.push({name:sheet.name,kind,format:'無法識別',range:'無主表',clues:[fileName],mapping:[],rows:[],excluded});continue;
    }
    const parsed: ImportSheet={name:sheet.name,kind,format,range:'',clues:[fileName,display(sheet.getCell('A1')), ...(schema?[schema.getCell('B3').text]:[])].filter(Boolean),mapping:keys.map((field,i)=>({column:sheet.getColumn(i+1).letter,label:sheet.getCell(header,i+1).text || sheet.getCell(header+1,i+1).text || '原項次',field,hidden:Boolean(sheet.getColumn(i+1).hidden)})),rows:[],excluded:[]};
    let ended=false, last=start-1;
    for(let r=start;r<=sheet.rowCount;r++) {
      const row=sheet.getRow(r),values:ImportExcluded['values']={};
      row.eachCell(cell=>{const v=raw(cell);if(v!==null&&v!=='')values[cell.address]=v;});
      if(!Object.keys(values).length){if(format!==TRACKING_XLSX_VERSION)ended=true;continue;}
      const ref=sheet.getCell(r,keys.indexOf('referenceNo')+1),description=sheet.getCell(r,keys.indexOf('description')+1);
      if(ended || (format!==TRACKING_XLSX_VERSION && !display(ref) && !display(description))) {parsed.excluded.push({sourceRow:r,reason:'主表以外／備註或不同欄位區，需人工選擇及補齊',values});continue;}
      last=r;
      const item=blankItem(vesselId,kind),issues:ImportIssue[]=[];
      const issue=(code:string,message:string)=>{if(!issues.some(v=>v.code===code))issues.push({code,message});};
      const fields:Record<string,string>={};
      keys.forEach((k,i)=>{fields[k]=display(sheet.getCell(r,i+1));});
      for(const key of keys) {
        const cell=sheet.getCell(r,keys.indexOf(key)+1),value=fields[key];
        if(DATE_FIELDS.has(key)) {
          const date=parseTrackingDate(cell.value,book.properties.date1904);
          if(date===null){issue(`date:${key}`,`${trackingColumnsFor(kind).find(c=>c.key===key)?.label || key} 原值「${value}」無法唯一判定；請改為明確日期或明確留空`);(item as unknown as Record<string,unknown>)[key]='';}
          else (item as unknown as Record<string,unknown>)[key]=date;
        } else if(key==='requestType') {
          if(value.trim()) { item.requestType=parseTrackingRequestType(value.trim()) || value as TrackingItem['requestType']; }
        } else if((TRACKING_LEGACY_EDIT_FIELDS as readonly string[]).includes(key)||trackingColumnsFor(kind).some(c=>c.key===key&&(c.editable||key==='progress'))) (item as unknown as Record<string,unknown>)[key]=key==='urgentSubtypes'?value.split('、').filter(Boolean):value;
        if(cell.type===6 || (typeof cell.value==='object'&&cell.value&&('formula' in cell.value||'sharedFormula' in cell.value)))issue(`formula:${key}`,'原檔含公式；保留公式原文，不執行、不採用快取結果。請核對此列。');
      }
      if(format==='F28'||format===TRACKING_XLSX_VERSION) {
        const normal=marked(fields.normal||''),urgent=marked(fields.urgent||'')||marked(fields.urgentOther||'');
        item.urgency=urgent?'urgent':'normal';
        if(normal===urgent)issue('urgency-confirm',normal?'普通與緊急衝突，請選定一種':'普通／緊急均空白，請確認普通預設或改為緊急');
        if(format==='F28')item.urgentSubtypes=[...(marked(fields.urgent||'')?['檢查航行必須']:[]),...(marked(fields.urgentOther||'')?['其他']:[])];
      }
      if(format==='F34'&&ref.isMerged) {
        let first=ref.master.row,bottom=Number(first);
        while(bottom<sheet.rowCount&&sheet.getCell(bottom+1,ref.col).isMerged&&sheet.getCell(bottom+1,ref.col).master.address===ref.master.address)bottom++;
        if(bottom>Number(first))item.subitemNo=String(r-Number(first)+1);
      }
      if(kind==='supply'&&/(收到|已到|交船|送船|到貨|received|delivered)/i.test(item.progress)) issue('delivery-confirm','說明提及收到／交船；不得推定整單已送船。請明確核對送船狀態及全部送達日期。');
      if(kind==='engineering'&&/(取消|撤銷|自修|未完成|未完工)/.test((fields.completionDate||'')+' '+item.originalRemarks)) issue('completion-confirm','包含取消／撤銷／自修／未完成描述；保留原備註。請核對完工事實及獨立結案選項。');
      if(fields.deliveryStatus){const status=({'未送船':'not-delivered','部分送船':'partially-delivered','已送船':'delivered'} as Record<string,TrackingItem['deliveryStatus']>)[fields.deliveryStatus];if(status)item.deliveryStatus=status;else issue('delivery-confirm','送船狀態不明，預設未送船，請明確核對。');}
      if(kind==='supply'&&!fields.deliveryStatus&&item.actualDeliveryDate)item.deliveryStatus='delivered';
      if(fields.isClosed==='已結案'||fields.isClosed==='true') {item.isClosed=true;item.closureOutcome=fields.closureOutcome?.includes('取消')?'cancelled':'completed';issue('closure-confirm','此列明示已結案，必須核對結案日期／結果；不由完工日期推定。');}
      if(fields.vesselId&&fields.vesselId!==vesselId)issue('vessel-confirm','原匯出船舶 ID 與本次選船不同；請確認，不自動切換船舶。');
      item.source={fileName,sheetName:sheet.name,row:r,originalValues:{...values,'_fileSha256':fileHash,...(fields.id?{'_exportedId':fields.id}:{})}};
      parsed.rows.push({key:`${sheet.id}:${r}`,sourceRow:r,item,issues,acknowledgements:[],selected:false,exportedId:fields.id||undefined});
    }
    parsed.range=`A${start}:${sheet.getColumn(keys.length).letter}${last}`;result.sheets.push(parsed);
  }
  if(!result.sheets.length)throw new Error('沒有可供預覽的工作表。');
  return result;
}
export function importRowErrors(row: ImportRow): string[] {
  const errors=row.issues.filter(issue=>!row.acknowledgements.includes(issue.code)).map(issue=>issue.message);
  try {validateTrackingItem(row.item);}catch(e){errors.push(e instanceof Error?e.message:String(e));}
  return errors;
}
export function importDuplicate(row: ImportRow, all: readonly ImportRow[], existing: readonly TrackingItem[]): {blocked:boolean; messages:string[]} {
  const sameScope=existing.filter(i=>i.vesselId===row.item.vesselId&&i.kind===row.item.kind);
  const exactId=Boolean(row.exportedId&&(existing.some(i=>i.id===row.exportedId)||all.some(r=>r.key!==row.key&&r.exportedId===row.exportedId)));
  const fingerprint=(i:TrackingItem)=>i.source?.originalValues._fileSha256;
  const sameSource=sameScope.some(i=>fingerprint(i)&&fingerprint(i)===fingerprint(row.item)&&i.source?.row===row.sourceRow&&i.source?.sheetName===row.item.source?.sheetName);
  const equal=(i:TrackingItem)=>i.referenceNo===row.item.referenceNo&&i.description===row.item.description&&i.subitemNo===row.item.subitemNo;
  const inFile=all.some(r=>r.key!==row.key&&!r.saved&&equal(r.item));const suspected=sameScope.some(equal);
  const siblings=all.some(r=>r.key!==row.key&&r.item.referenceNo===row.item.referenceNo&&!equal(r.item));
  return {blocked:exactId||sameSource,messages:[...(exactId?['相同系統 ID 已存在或在本檔重複：必須排除，不會另建或覆寫']:[]),...(sameSource?['相同來源指紋已匯入：必須排除']:[]),...(inFile?['本檔疑似重複，請明確排除或確認仍新增']:[]),...(suspected?['與既有來源疑似相同，請明確排除或確認仍新增']:[]),...(siblings?['同單號不同分項／內容：各自保留，不合併']:[])]};
}
export function selectImportBatch(rows: readonly ImportRow[], existing: readonly TrackingItem[], duplicateConfirmed: readonly string[]): TrackingItem[] {
  const chosen=rows.filter(r=>r.selected&&!r.saved);
  if(!chosen.length||chosen.length>100)throw new Error('每批須明確選取 1–100 項；各批是獨立原子交易，不會自動截斷或跨批保證。');
  for(const row of chosen){const d=importDuplicate(row,rows,existing);if(d.blocked||importRowErrors(row).length||d.messages.some(m=>m.includes('疑似'))&&!duplicateConfirmed.includes(row.key))throw new Error(`來源第 ${row.sourceRow} 列尚有未解決異常／重複，整批未提交。`);}
  return structuredClone(chosen.map(r=>r.item));
}
