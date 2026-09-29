import type { TrackingItem } from './trackingTypes';

// Input rule only: do not retroactively invalidate saved urgent rows in unrelated workflows.
export function trackingUrgentNotesError(row: Pick<TrackingItem, 'urgency' | 'supplementalNotes'>): string {
  return row.urgency === 'urgent' && !row.supplementalNotes?.trim() ? '緊急項目請填寫補充說明，不能只填空白。' : '';
}
