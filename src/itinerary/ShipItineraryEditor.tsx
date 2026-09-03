import { useMemo, useRef, useState } from 'react';
import { recalculateItineraryRows } from './itineraryDomain';
import { instantToWallTime, wallTimeToInstant } from './itineraryTime';
import {
  addShipAlternativePlan, addShipAlternativePlanRow, addShipDraftRow, promoteShipAlternativePlanToDraft,
  removeShipAlternativePlan, removeShipAlternativePlanRow, removeShipDraftRow, setAllShipAlternativeTimesManual,
  setAllShipTimesManual, setShipAlternativeAutomaticCalculation, setShipAutomaticCalculation,
  shipCalculationStartTimeZonePatch, updateShipAlternativePlanRow, updateShipDraftRow,
} from './shipItineraryModel';
import {
  ITINERARY_MAX_ALTERNATIVE_PLANS,
  type ItineraryAlternativePlan, type ItineraryDocument, type ItineraryRow,
} from './itineraryTypes';
import ItineraryDateInput from './ItineraryDateInput';
import ItineraryTimeInput from './ItineraryTimeInput';
import UtcOffsetSelect from './UtcOffsetSelect';
import ShipItineraryPlanWorkspace from './ShipItineraryPlanWorkspace';

interface ShipItineraryEditorProps {
  document: ItineraryDocument;
  readOnly: boolean;
  canSave: boolean;
  remoteUpdated: boolean;
  saving: boolean;
  onChange: (document: ItineraryDocument) => void;
  onSave: () => void;
  onCancel: () => void;
  onClosePreservingDraft: () => void;
  onDiscardDraft: () => void;
  onSyncLatest: () => void;
  onExportDraft: () => void;
}

function CalculationStartInput({ row, disabled, onPatch }: { row: ItineraryRow; disabled: boolean; onPatch: (patch: Partial<ItineraryRow>) => void }) {
  const wallResult = row.calculationStartUtc && row.calculationStartTimeZone
    ? instantToWallTime(row.calculationStartUtc, row.calculationStartTimeZone) : null;
  const wall = wallResult?.ok ? wallResult : null;
  const timeInputRef = useRef<HTMLInputElement>(null);
  const commit = (date: string, time: string) => {
    if (!date) return onPatch({ calculationStartUtc: null });
    if (!row.calculationStartTimeZone) return;
    const result = wallTimeToInstant(date, time || '00:00', row.calculationStartTimeZone);
    if (result.ok) onPatch({ calculationStartUtc: result.instant });
  };
  const useNow = () => {
    if (!row.calculationStartTimeZone) return;
    const now = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    onPatch({ calculationStartUtc: now });
  };
  return <div className="ship-calculation-anchor" aria-label="首列 ETA 起算時間">
    <div className="ship-calculation-anchor-title"><b>首列 ETA 起算</b><span>當下時間＋當下時區</span></div>
    <ItineraryDateInput value={wall?.date || ''} disabled={disabled || !row.calculationStartTimeZone} ariaLabel="首列 ETA 起算日期" onChange={date => commit(date, timeInputRef.current?.value || wall?.time || '00:00')} />
    <ItineraryTimeInput inputRef={timeInputRef} value={wall?.time || ''} disabled={disabled || !row.calculationStartTimeZone || !wall?.date} ariaLabel="首列 ETA 起算時間" onChange={time => commit(wall?.date || '', time)} />
    <UtcOffsetSelect value={row.calculationStartTimeZone} emptyLabel="當下時區" ariaLabel="首列 ETA 起算當下時區" disabled={disabled} onChange={value => onPatch(shipCalculationStartTimeZonePatch(row, value))} />
    <button type="button" className="btn ghost small" disabled={disabled || !row.calculationStartTimeZone} onClick={useNow}>使用現在</button>
    <p className="ship-calculation-anchor-note" role="note">請選擇實際計算值，如台北，則是UTC+8</p>
  </div>;
}

function PreviousPortNameInput({ row, disabled, onPatch }: { row: ItineraryRow; disabled: boolean; onPatch: (patch: Partial<ItineraryRow>) => void }) {
  const missing = !row.previousPortName?.trim();
  return <label className={`ship-previous-port-field${missing ? ' missing' : ''}`}>
    <span>上一港名稱 <em>必填</em></span>
    <input
      name="previousPortName"
      required
      aria-invalid={missing}
      aria-describedby={missing ? 'ship-previous-port-requirement' : undefined}
      maxLength={240}
      placeholder="請輸入上一港名稱"
      value={row.previousPortName || ''}
      disabled={disabled}
      onChange={event => onPatch({ previousPortName: event.target.value })}
    />
    <small id="ship-previous-port-requirement">保存並同步前必須填寫</small>
  </label>;
}

function gapMessage(missing: Array<{ rowNumber: number; label: string }>): string {
  const grouped = new Map<number, string[]>();
  missing.forEach(item => grouped.set(item.rowNumber, [...(grouped.get(item.rowNumber) || []), item.label]));
  return [...grouped.entries()].map(([row, labels]) => `第 ${row} 列：${[...new Set(labels)].join('、')}`).join('\n');
}

function sharedAnchorLabel(row: ItineraryRow | undefined): string {
  if (!row?.calculationStartUtc || !row.calculationStartTimeZone) return '尚未設定';
  const wall = instantToWallTime(row.calculationStartUtc, row.calculationStartTimeZone);
  return wall.ok ? `${wall.date} ${wall.time}（${row.calculationStartTimeZone}）` : `${row.calculationStartUtc}（${row.calculationStartTimeZone}）`;
}

function ShipAlternativePlanEditor({ document, plan, index, readOnly, onChange }: {
  document: ItineraryDocument;
  plan: ItineraryAlternativePlan;
  index: number;
  readOnly: boolean;
  onChange: (document: ItineraryDocument) => void;
}) {
  const [modeMessage, setModeMessage] = useState('');
  const title = `備選方案${index + 1}`;
  const calculation = useMemo(() => recalculateItineraryRows(plan.rows), [plan.rows]);
  const patchRow = (rowId: string, patch: Partial<ItineraryRow>) => onChange(updateShipAlternativePlanRow(document, plan.planId, rowId, patch));

  const switchAllManual = () => {
    if (!window.confirm(`確定將${title}的所有 ETA／ETB／ETC／ETD 改為手動輸入嗎？`)) return;
    onChange(setAllShipAlternativeTimesManual(document, plan.planId));
    setModeMessage('已切換為全手動輸入；目前計算結果已保留。');
  };
  const calculateAllAutomatic = () => {
    const result = setShipAlternativeAutomaticCalculation(document, plan.planId);
    onChange(result.document);
    if (result.missing.length) {
      const details = gapMessage(result.missing);
      setModeMessage(`自動計算尚缺必要的時間／Offset：\n${details}`);
      window.alert(`自動計算尚缺以下必要資料：\n${details}\n\n其他未填時數會按 0 計算，也可將個別時間欄切換為「手」。`);
      return;
    }
    setModeMessage('自動計算完成；後續修改參數時標示「自」的時間會立即重算。');
  };
  const promote = () => {
    if (!window.confirm(`將${title}帶入正式草稿？\n\n目前正式草稿的行程內容將被替換；上一港與首列 ETA 起算保留。此操作不會立即同步，原備選也會保留。`)) return;
    onChange(promoteShipAlternativePlanToDraft(document, plan.planId));
    setModeMessage('已帶入正式草稿；請核對上方正式方案後再保存並同步。');
  };
  const removePlan = () => {
    if (!window.confirm(`確定刪除${title}？刪除後其餘方案會重新編號。`)) return;
    onChange(removeShipAlternativePlan(document, plan.planId));
  };

  return <section className="ship-alternative-plan" aria-label={title}>
    <div className="ship-alternative-head">
      <div className="ship-alternative-title"><h3>{title}</h3><span>首列 ETA 起算沿用正式方案：<b>{sharedAnchorLabel(document.rows[0])}</b></span></div>
      <div className="ship-alternative-actions">
        <button type="button" className="btn ghost small" disabled={readOnly} onClick={switchAllManual}>全部手動輸入</button>
        <button type="button" className="btn primary small" disabled={readOnly} onClick={calculateAllAutomatic}>一鍵自動計算</button>
        <button type="button" className="btn ghost small" disabled={readOnly} onClick={promote}>帶入正式草稿</button>
        <button type="button" className="btn red small" aria-label={`刪除${title}`} disabled={readOnly} onClick={removePlan}>刪除</button>
      </div>
      {modeMessage && <span className="ship-mode-message" role="status">{modeMessage}</span>}
    </div>
    <ShipItineraryPlanWorkspace
      rows={plan.rows}
      readOnly={readOnly}
      labelPrefix={title}
      onPatchRow={patchRow}
      onRemoveRow={rowId => onChange(removeShipAlternativePlanRow(document, plan.planId, rowId))}
    />
    <div className="ship-alternative-footer">
      <button type="button" className="btn ghost small" disabled={readOnly} onClick={() => onChange(addShipAlternativePlanRow(document, plan.planId))}>＋ 下一行</button>
      <span className={calculation.issues.length ? 'ship-issue' : 'ship-ok'}>{calculation.issues.length ? `${calculation.issues.length} 個欄位待確認` : '公式檢查正常'}</span>
    </div>
  </section>;
}

export default function ShipItineraryEditor({ document, readOnly, canSave, remoteUpdated, saving, onChange, onSave, onCancel, onClosePreservingDraft, onDiscardDraft, onSyncLatest, onExportDraft }: ShipItineraryEditorProps) {
  const [modeMessage, setModeMessage] = useState('');
  const calculation = useMemo(() => recalculateItineraryRows(document.rows), [document.rows]);
  const patchRow = (rowId: string, patch: Partial<ItineraryRow>) => onChange(updateShipDraftRow(document, rowId, patch));
  const firstRow = document.rows[0];
  const alternativePlans = [...(document.alternativePlans || [])].sort((left, right) => left.sortOrder - right.sortOrder || left.planId.localeCompare(right.planId));
  const previousPortMissing = !firstRow?.previousPortName?.trim();
  const saveAllowed = canSave && !previousPortMissing;

  const switchAllManual = () => {
    if (!window.confirm('切換後，正式方案所有 ETA／ETB／ETC／ETD 都改為手動輸入；修改右側參數將不再更新這些時間。確定繼續嗎？')) return;
    onChange(setAllShipTimesManual(document));
    setModeMessage('正式方案已切換為全手動輸入；目前計算結果已保留為手動值。');
  };
  const calculateAllAutomatic = () => {
    const result = setShipAutomaticCalculation(document);
    onChange(result.document);
    if (result.missing.length) {
      const details = gapMessage(result.missing);
      setModeMessage(`正式方案自動計算尚缺必要的時間／Offset：\n${details}`);
      window.alert(`自動計算尚缺以下必要資料：\n${details}\n\n其他未填時數會按 0 計算，也可將個別時間欄切換為「手」。`);
      return;
    }
    setModeMessage('正式方案自動計算完成；未填的時數按 0 計算，後續修改參數時標示「自」的時間會立即重算。');
  };

  return <section className="ship-editor" aria-label="船端 Itinerary 編輯器">
    {remoteUpdated && <div className="ship-conflict-banner"><b>辦公室已有更新，保存已暫停。</b><span>目前草稿仍在本機；先匯出草稿或直接載入最新，再繼續。</span><div><button className="btn ghost small" onClick={onExportDraft}>匯出目前草稿</button><button className="btn primary small" onClick={onSyncLatest}>同步最新</button></div></div>}
    {readOnly && !remoteUpdated && <div className="ship-conflict-banner"><b>編輯鎖已失效，畫面已凍結。</b><span>草稿仍保留，不會自動覆蓋雲端。</span></div>}
    <div className="ship-editor-mode-bar">
      {firstRow && <CalculationStartInput row={firstRow} disabled={readOnly} onPatch={patch => patchRow(firstRow.rowId, patch)} />}
      {firstRow && <PreviousPortNameInput row={firstRow} disabled={readOnly} onPatch={patch => patchRow(firstRow.rowId, patch)} />}
      <div className="ship-editor-mode-actions">
        <button type="button" className="btn ship-add-alternative small" aria-label="增加備選計劃" disabled={readOnly || alternativePlans.length >= ITINERARY_MAX_ALTERNATIVE_PLANS} onClick={() => onChange(addShipAlternativePlan(document))}>＋ 增加備選計劃</button>
        <button type="button" className="btn ghost small" disabled={readOnly} onClick={switchAllManual}>全部手動輸入</button>
        <button type="button" className="btn primary small" disabled={readOnly} onClick={calculateAllAutomatic}>一鍵自動計算</button>
      </div>
      {alternativePlans.length >= ITINERARY_MAX_ALTERNATIVE_PLANS && <span className="ship-alternative-limit">已達 {ITINERARY_MAX_ALTERNATIVE_PLANS} 個備選方案上限</span>}
      {modeMessage && <span className="ship-mode-message" role="status">{modeMessage}</span>}
    </div>
    <ShipItineraryPlanWorkspace
      rows={document.rows}
      readOnly={readOnly}
      onPatchRow={patchRow}
      onRemoveRow={rowId => onChange(removeShipDraftRow(document, rowId))}
    />
    <div className="ship-formal-plan-footer">
      <button type="button" className="btn ghost small" disabled={readOnly} onClick={() => onChange(addShipDraftRow(document))}>＋ 正式方案下一行</button>
      <span className={!saveAllowed || calculation.issues.length ? 'ship-issue' : 'ship-ok'}>{previousPortMissing ? '請填寫上一港名稱' : !canSave ? '請至少填寫一列資料' : calculation.issues.length ? `${calculation.issues.length} 個欄位待確認` : '正式方案公式檢查正常'}</span>
    </div>
    {alternativePlans.length > 0 && <div className="ship-alternative-plans" aria-label="備選方案列表">
      {alternativePlans.map((plan, index) => <ShipAlternativePlanEditor key={plan.planId} document={document} plan={plan} index={index} readOnly={readOnly} onChange={onChange} />)}
    </div>}
    <div className="ship-editor-footer">
      <span>{alternativePlans.length ? `備選方案 ${alternativePlans.length}／${ITINERARY_MAX_ALTERNATIVE_PLANS}` : '尚未建立備選方案'}</span>
      <div className="ship-editor-actions">
        {readOnly ? <><button className="btn ghost small" onClick={onClosePreservingDraft}>關閉（保留草稿）</button><button className="btn red small" onClick={onDiscardDraft}>丟棄草稿</button></> : <button className="btn ghost small" onClick={onCancel}>取消編輯</button>}
        <button className="btn primary small" disabled={readOnly || saving || remoteUpdated || !saveAllowed} onClick={onSave}>{saving ? '保存中…' : '保存並同步'}</button>
      </div>
    </div>
  </section>;
}
