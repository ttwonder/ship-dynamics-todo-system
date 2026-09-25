import type { TrackingItem } from './trackingTypes';
import { trackingColumnsFor } from './trackingColumns';
import { TRACKING_REQUEST_TYPES, trackingRequestKind, type TrackingRequestType } from './trackingRequestTypes';

/** Shared by create/edit and import preview; stored legacy fields are not erased. */
export function TrackingItemFields({ row, prefix, creating, onChange }: {
  row: TrackingItem; prefix: string; creating: boolean; onChange: (patch: Partial<TrackingItem>) => void;
}) {
  const columns = trackingColumnsFor(row.kind);
  const field = (key: string) => {
    const column = columns.find(value => value.key === key)!;
    return <label key={key}>{column.label}{column.required ? ' *' : ''}{column.type === 'date'
      ? <input type="date" required={column.required} aria-label={prefix + column.label} value={column.value(row)} onChange={event => onChange({ [key]: event.target.value, ...(key === 'actualDeliveryDate' ? { deliveryStatus: event.target.value ? 'delivered' : 'not-delivered' } : {}) })}/>
      : <textarea required={column.required} rows={1} aria-label={prefix + column.label} value={column.value(row)} onChange={event => onChange({ [key]: event.target.value })}/>}
    </label>;
  };
  const changeType = (value: TrackingRequestType) => {
    const kind = trackingRequestKind(value);
    if (!creating && kind !== row.kind) return;
    const date = row.kind === 'supply' ? row.actualDeliveryDate : row.completionDate;
    onChange({ requestType: value, ...(creating && kind !== row.kind ? { kind, completionDate: kind === 'engineering' ? date : undefined, actualDeliveryDate: kind === 'supply' ? date : undefined, deliveryStatus: kind === 'supply' && date ? 'delivered' : 'not-delivered' } : {}) });
  };
  return <div className="tracking-form-grid tracking-request-fields">
    <div className="tracking-input-line" aria-label={prefix + '第一行'}>{['referenceNo','purchaseNos','originalItemNo','applicationDate'].map(field)}</div>
    <div className="tracking-input-line" aria-label={prefix + '第二行'}>
      <label>類型<select aria-label={prefix + '類型'} value={row.requestType || ''} required={creating} onChange={event => changeType(event.target.value as TrackingRequestType)}>
        {!row.requestType && <option value="" disabled>未指定（舊資料）</option>}
        {TRACKING_REQUEST_TYPES.map(option => <option key={option.value} value={option.value} disabled={!creating && option.kind !== row.kind}>{option.label}</option>)}
      </select>{!creating && <small>已保存項目限原材料／工程大類。</small>}</label>
      {field('description')}{field('expectedDate')}{field(row.kind === 'supply' ? 'actualDeliveryDate' : 'completionDate')}
    </div>
    <div className="tracking-input-line tracking-input-line-three" aria-label={prefix + '第三行'}>
      <div className="tracking-urgency" role="group" aria-label={prefix + '緊急程度'}>
        <label className="tracking-urgency-option"><input type="checkbox" aria-label={prefix + '普通'} checked={row.urgency === 'normal'} onChange={() => onChange({ urgency: 'normal' })}/>普通</label>
        <label className="tracking-urgency-option"><input type="checkbox" aria-label={prefix + '緊急'} checked={row.urgency === 'urgent'} onChange={() => onChange({ urgency: 'urgent' })}/>緊急</label>
      </div>
      {field('supplementalNotes')}{field('progress')}
    </div>
  </div>;
}
