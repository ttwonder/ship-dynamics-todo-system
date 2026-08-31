import { useMemo, useState } from 'react';
import type { ItineraryDocument } from './itineraryTypes';
import { COMMON_IANA_TIME_ZONES } from './itineraryTime';
import { resolveParsedItinerarySheet, type ParsedItinerarySheet, type ParsedItineraryWorkbook } from './itineraryExcel';

export interface ItineraryImportApplyItem {
  sheet: ParsedItinerarySheet;
  vesselId: string;
}

export interface ItineraryImportApplyResult {
  sheetName: string;
  vesselName: string;
  ok: boolean;
  message: string;
}

interface ItineraryImportPreviewProps {
  fileName: string;
  parsed: ParsedItineraryWorkbook;
  documents: ItineraryDocument[];
  selectedVesselIds: string[];
  onApply: (items: ItineraryImportApplyItem[]) => Promise<ItineraryImportApplyResult[]>;
  onClose: () => void;
}

function normalized(value: string): string { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

function initialMappings(parsed: ParsedItineraryWorkbook, documents: ItineraryDocument[], selectedVesselIds: string[]): Record<string, string> {
  const available = new Map(documents.map(document => [document.vesselId, document]));
  const byName = new Map(documents.flatMap(document => [[normalized(document.vesselName), document.vesselId]]));
  const singleSelected = parsed.sheets.length === 1 && selectedVesselIds.length === 1 && available.has(selectedVesselIds[0]) ? selectedVesselIds[0] : '';
  return Object.fromEntries(parsed.sheets.map(sheet => {
    const embedded = sheet.embeddedVesselId && available.has(sheet.embeddedVesselId) ? sheet.embeddedVesselId : '';
    const named = byName.get(normalized(sheet.embeddedVesselName || sheet.sheetName)) || '';
    return [sheet.sheetName, embedded || named || singleSelected];
  }));
}

export default function ItineraryImportPreview({ fileName, parsed, documents, selectedVesselIds, onApply, onClose }: ItineraryImportPreviewProps) {
  const [mappings, setMappings] = useState<Record<string, string>>(() => initialMappings(parsed, documents, selectedVesselIds));
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(parsed.sheets.map(sheet => sheet.sheetName)));
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ItineraryImportApplyResult[] | null>(null);
  const documentById = useMemo(() => new Map(documents.map(document => [document.vesselId, document])), [documents]);
  const prepared = parsed.sheets.map(sheet => {
    const resolved = resolveParsedItinerarySheet(sheet, overrides[sheet.sheetName] || {});
    const vesselId = mappings[sheet.sheetName] || '';
    return { sheet: resolved, vesselId, document: documentById.get(vesselId) || null };
  });
  const mappingCounts = prepared.reduce<Record<string, number>>((counts, item) => {
    if (item.vesselId) counts[item.vesselId] = (counts[item.vesselId] || 0) + 1;
    return counts;
  }, {});
  const ready = prepared.filter(item => enabled.has(item.sheet.sheetName) && item.document && item.sheet.rows.length > 0 && item.sheet.issues.length === 0 && mappingCounts[item.vesselId] === 1);

  const toggle = (sheetName: string) => setEnabled(current => {
    const next = new Set(current);
    if (next.has(sheetName)) next.delete(sheetName); else next.add(sheetName);
    return next;
  });
  const updateZone = (sheetName: string, rowId: string, zone: string) => setOverrides(current => ({
    ...current,
    [sheetName]: { ...(current[sheetName] || {}), [rowId]: zone },
  }));
  const apply = async () => {
    if (!ready.length || applying) return;
    if (!window.confirm(`將以 Excel 內容覆蓋 ${ready.length} 艘船的 Itinerary，並為每艘建立新 Revision。確定繼續嗎？`)) return;
    setApplying(true);
    try {
      setResults(await onApply(ready.map(item => ({ sheet: item.sheet, vesselId: item.vesselId }))));
    } finally {
      setApplying(false);
    }
  };

  return <div className="modal-backdrop itinerary-import-backdrop" role="presentation">
    <section className="modal itinerary-import-modal" role="dialog" aria-modal="true" aria-labelledby="itinerary-import-title">
      <header className="itinerary-import-head"><div><h2 id="itinerary-import-title">Excel 匯入預覽</h2><p>{fileName}｜{parsed.sheets.length} 個工作表｜只覆蓋勾選且驗證通過的船舶</p></div><button type="button" className="btn ghost" disabled={applying} onClick={onClose}>{results?'完成':'取消'}</button></header>
      {!results?<div className="itinerary-import-scroll">
        <table className="itinerary-import-table"><thead><tr><th>匯入</th><th>Excel 分頁</th><th>覆蓋船舶</th><th>列數</th><th>目前 Revision</th><th>檢查結果</th></tr></thead>
          {prepared.map(item=>{
            const duplicate = item.vesselId && mappingCounts[item.vesselId] > 1;
            const issueText = duplicate ? '同一艘船不可由兩個分頁同時覆蓋' : item.sheet.issues.map(issue=>issue.message).join('；');
            const isReady = Boolean(item.document && item.sheet.rows.length && !item.sheet.issues.length && !duplicate);
            return <tbody className="itinerary-import-sheet-group" key={item.sheet.sheetName}>
              <tr><td><input type="checkbox" checked={enabled.has(item.sheet.sheetName)} disabled={applying} onChange={()=>toggle(item.sheet.sheetName)}/></td><td title={item.sheet.sheetName}>{item.sheet.sheetName}</td><td><select value={item.vesselId} disabled={applying} onChange={event=>setMappings(current=>({...current,[item.sheet.sheetName]:event.target.value}))}><option value="">請選擇船舶</option>{documents.map(document=><option key={document.vesselId} value={document.vesselId}>{document.vesselName}</option>)}</select></td><td>{item.sheet.rows.length}</td><td>{item.document?`R${item.document.revision}`:'—'}</td><td><span className={`itinerary-import-status ${isReady?'ready':'blocked'}`} title={issueText}>{isReady?'可覆蓋':issueText||'請選擇船舶'}</span></td></tr>
              {item.sheet.timeZoneNeeds.map(need=><tr className="itinerary-zone-repair" key={need.rowId}><td></td><td colSpan={2}>Excel 第 {need.rowNumber} 列｜{need.portDockName||'未命名港口'}{need.legacyOffsetHours!==null?`｜原時差 ${need.legacyOffsetHours>=0?'+':''}${need.legacyOffsetHours}`:''}</td><td colSpan={3}><input list="itinerary-import-time-zones" value={overrides[item.sheet.sheetName]?.[need.rowId]||''} placeholder="選擇 IANA 時區，例如 Asia/Seoul" onChange={event=>updateZone(item.sheet.sheetName,need.rowId,event.target.value)}/></td></tr>)}
            </tbody>;
          })}
        </table>
        <datalist id="itinerary-import-time-zones">{COMMON_IANA_TIME_ZONES.map(zone=><option key={zone} value={zone}/>)}</datalist>
      </div>:<div className="itinerary-import-results"><table className="itinerary-import-table"><thead><tr><th>分頁</th><th>船舶</th><th>結果</th></tr></thead><tbody>{results.map(result=><tr key={`${result.sheetName}-${result.vesselName}`}><td>{result.sheetName}</td><td>{result.vesselName}</td><td><span className={`itinerary-import-status ${result.ok?'ready':'blocked'}`}>{result.message}</span></td></tr>)}</tbody></table></div>}
      {!results&&<footer className="itinerary-import-foot"><span>準備覆蓋 {ready.length} 艘；有錯誤、重複對應或未選船舶的分頁不會送出。</span><button type="button" className="btn primary" disabled={!ready.length||applying} onClick={apply}>{applying?'覆蓋中…':`確認覆蓋 ${ready.length} 艘`}</button></footer>}
    </section>
  </div>;
}
