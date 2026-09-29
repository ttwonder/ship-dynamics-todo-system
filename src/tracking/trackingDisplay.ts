import type { TrackingItem } from './trackingTypes';

/** Business identity for operators. Internal IDs remain keys, never display fallbacks. */
export function trackingItemLabel(row: Pick<TrackingItem, 'referenceNo' | 'description' | 'originalItemNo' | 'subitemNo'>): string {
  return [row.referenceNo.trim() || '未填申請單號', row.description.trim() || '未填內容',
    row.originalItemNo?.trim() && `原項次：${row.originalItemNo.trim()}`,
    row.subitemNo?.trim() && row.subitemNo.trim() !== row.originalItemNo?.trim() && `子項次：${row.subitemNo.trim()}`,
  ].filter(Boolean).join('｜');
}
