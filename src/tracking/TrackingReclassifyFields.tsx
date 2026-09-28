import type { TrackingReclassificationDraft } from './TrackingModals';
import type { TrackingItem } from './trackingTypes';
import type { TrackingUiCommand } from './trackingUiCommands';
import { TRACKING_REQUEST_TYPES, trackingRequestKind, trackingRequestTypeLabel, type TrackingRequestType } from './trackingRequestTypes';

const deliveryLabels = { 'not-delivered': '未送船', 'partially-delivered': '部分送船', delivered: '已送船' } as const;
export function trackingReclassificationNeedsReview(rows: TrackingItem[], requestType: TrackingRequestType | '') {
  if (!requestType) return false;
  const kind = trackingRequestKind(requestType);
  return rows.some(row => row.kind !== kind && Boolean((row.kind === 'supply' ? row.actualDeliveryDate : row.completionDate) || row.deliveryStatus !== 'not-delivered'));
}

/** Defaults read only the target-kind stored facts. Never transfer the current-kind date. */
export function trackingReclassificationDefaults(rows: TrackingItem[], requestType: TrackingRequestType): TrackingReclassificationDraft {
  const kind = trackingRequestKind(requestType);
  return { requestType, reviewed: false, values: rows.map(row => ({ id: row.id,
    actualDate: (kind === 'supply' ? row.actualDeliveryDate : row.completionDate) || '',
    deliveryStatus: kind === 'supply' && row.actualDeliveryDate ? 'delivered' : row.deliveryStatus,
  })) };
}

// A retry may begin after newer edits: a fresh generation alone does not prove equality.
export function trackingReclassificationMatchesCommand(value: TrackingReclassificationDraft | undefined, command: Extract<TrackingUiCommand, { type: 'reclassify' }>): boolean {
  return Boolean(value && value.values.length === command.items.length && command.items.every(item => {
    const row = value.values.find(target => target.id === item.id);
    return value.requestType === item.requestType && row?.actualDate === item.actualDate && row?.deliveryStatus === item.deliveryStatus;
  }));
}

/** Reconciliation keeps explicit target inputs, not a stale review of newer original facts. */
export function reconcileTrackingReclassification(value: TrackingReclassificationDraft | undefined, originals: TrackingItem[]): TrackingReclassificationDraft | undefined {
  if (!value) return value;
  const engineering = value.requestType && trackingRequestKind(value.requestType) === 'engineering';
  return { ...value, reviewed: false, values: value.values.map(row => ({ ...row,
    ...(engineering ? { deliveryStatus: originals.find(original => original.id === row.id)?.deliveryStatus || row.deliveryStatus } : {}),
  })) };
}

export function TrackingReclassifyFields({ originals, value, onChange }: {
  originals: TrackingItem[]; value: TrackingReclassificationDraft; onChange: (value: TrackingReclassificationDraft) => void;
}) {
  const kind = value.requestType ? trackingRequestKind(value.requestType) : null;
  const update = (id: string, patch: Partial<TrackingReclassificationDraft['values'][number]>) => onChange({ ...value, reviewed: false, values: value.values.map(row => row.id === id ? { ...row, ...patch } : row) });
  return <div className="tracking-reclassify-fields">
    <label>本批目標類型 *<select aria-label="本批目標類型" required value={value.requestType} onChange={event => {
      const requestType = event.target.value as TrackingRequestType;
      onChange(kind === trackingRequestKind(requestType) ? { ...value, requestType, reviewed: false } : trackingReclassificationDefaults(originals, requestType));
    }}><option value="" disabled>請選擇目標類型</option>{TRACKING_REQUEST_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <p className="tracking-reclassify-note">日期不會自動跨類別轉用；目標日期預填該類別原先儲存的日期，原類別資料仍保留。改為工程時，原送船狀態及送達日期不變。</p>
    {originals.map((original, index) => {
      const target = value.values.find(row => row.id === original.id);
      const prefix = `第 ${index + 1} 筆 `;
      return <fieldset className="tracking-form-row tracking-reclassify-row" key={original.id} data-reclassify-id={original.id}>
        <legend>{prefix}｜{original.referenceNo} {original.originalItemNo || ''} [{original.id}]</legend>
        <div className="tracking-reclassify-grid">
          <div className="tracking-reclassify-original"><strong>原類型：{trackingRequestTypeLabel(original.requestType) || '未指定（舊資料）'}</strong><span>原實際{original.kind === 'supply' ? '送達' : '完工'}日期：{(original.kind === 'supply' ? original.actualDeliveryDate : original.completionDate) || '—'}</span><span>原送船狀態：{deliveryLabels[original.deliveryStatus]}</span></div>
          {kind && target && <>
            <label>目標{kind === 'supply' ? '實際送達' : '完工'}日期{kind === 'supply' && target.deliveryStatus === 'delivered' ? ' *' : ''}<input aria-label={prefix + (kind === 'supply' ? '目標實際送達日期' : '目標完工日期')} type="date" value={target.actualDate} disabled={kind === 'supply' && target.deliveryStatus !== 'delivered'} required={kind === 'supply' && target.deliveryStatus === 'delivered'} onChange={event => update(original.id, { actualDate: event.target.value })}/></label>
            {kind === 'supply' ? <label>目標送船狀態<select aria-label={prefix + '目標送船狀態'} value={target.deliveryStatus} onChange={event => update(original.id, { deliveryStatus: event.target.value as TrackingItem['deliveryStatus'], ...(event.target.value !== 'delivered' ? { actualDate: '' } : {}) })}>{Object.entries(deliveryLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label> : <p className="tracking-reclassify-note">保留原送船狀態：{deliveryLabels[original.deliveryStatus]}<br/>保留原送達日期：{original.actualDeliveryDate || '—'}</p>}
          </>}
        </div>
      </fieldset>;
    })}
    {trackingReclassificationNeedsReview(originals, value.requestType) && <label className="tracking-reclassify-review"><input aria-label="已逐筆核對日期及送船狀態" type="checkbox" required checked={value.reviewed} onChange={event => onChange({ ...value, reviewed: event.target.checked })}/>已逐筆核對日期及送船狀態，確認不把原日期直接當作另一類別的實際日期。</label>}
  </div>;
}
