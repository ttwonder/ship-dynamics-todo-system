import type { InternalControlCase, TaskItem } from '../types';
import type { TrackingEvent, TrackingItem } from './trackingTypes';
import { trackingRequestTypeLabel } from './trackingRequestTypes';

/** Dates from the other kind remain historical facts, not implied completion. */
export const trackingClassificationValue = (source: TrackingItem) => ({
  kind: source.kind,
  requestType: source.requestType || '',
  completionDate: source.completionDate || '',
  actualDeliveryDate: source.actualDeliveryDate || '',
  deliveryStatus: source.deliveryStatus,
});

/** Replace only the original generated type label, never the whole case text.
 * If the label was removed/changed manually, preserve it and append the source's
 * current label. Plain text and the existing rich-text paragraph form are valid. */
export function reclassifyTrackingDescription(description: string, before: TrackingItem, after: TrackingItem): string {
  if (before.requestType === after.requestType && before.kind === after.kind) return description;
  const oldLabel = trackingRequestTypeLabel(before.requestType);
  const line = `類型：${trackingRequestTypeLabel(after.requestType)}`;
  let result = description;
  const match = oldLabel ? new RegExp(`(^|[>\\r\\n])類型：${oldLabel}(?=$|[<\\r\\n])`) : null;
  if (match?.test(result)) result = result.replace(match, (_, prefix: string) => prefix + line);
  else result += /<(?:p|div|br)\b/i.test(result) ? `<p>${line}</p>` : `\n${line}`;
  const oldDate = before.kind === 'supply' ? before.actualDeliveryDate : before.completionDate;
  const newDate = after.kind === 'supply' ? after.actualDeliveryDate : after.completionDate;
  if (oldDate) {
    const dateMatch = new RegExp(`(^|[>\\r\\n])實際送達/完工日期：${oldDate}(?=$|[<\\r\\n])`);
    const dateLine = newDate ? `實際送達/完工日期：${newDate}` : `原${before.kind === 'engineering' ? '工程完工' : '物料送達'}日期（分類修正前）：${oldDate}`;
    result = result.replace(dateMatch, (_, prefix: string) => prefix + dateLine);
  }
  return result;
}

export function synchronizeTrackingClassification(before: TrackingItem, source: TrackingItem, item: InternalControlCase | undefined, task: TaskItem | undefined, event: TrackingEvent): void {
  for (const endpoint of [item, task]) {
    if (!endpoint) continue;
    endpoint.description = reclassifyTrackingDescription(endpoint.description, before, source);
    endpoint.trackingLifecycle = [...(endpoint.trackingLifecycle || []), structuredClone(event)];
    endpoint.updatedAt = event.at;
    endpoint.updatedBy = event.byUserId;
  }
}
