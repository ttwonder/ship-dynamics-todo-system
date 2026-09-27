import { trackingColumnMinWidth, type TrackingColumn } from './trackingColumns';
export const TRACKING_COLUMN_SCHEMA = 1;
export interface TrackingPreferences { order: string[]; hidden: string[]; widths: Record<string, number>; requestTypeOrderVersion?: 1 }
export const trackingPreferenceKey = (workspace: string, actorId: string, tab: string) => JSON.stringify(['tracking-columns', workspace, actorId, tab, TRACKING_COLUMN_SCHEMA]);
function typeAfterReference(order: string[]): string[] {
  if (!order.includes('referenceNo') || !order.includes('requestType')) return order;
  const next = order.filter(key => key !== 'requestType');
  next.splice(next.indexOf('referenceNo') + 1, 0, 'requestType');
  return next;
}
export const defaultTrackingPreferences = (columns: readonly TrackingColumn[]): TrackingPreferences => ({ order: typeAfterReference(columns.map(c => c.key)), hidden: columns.filter(c => c.hidden).map(c => c.key), widths: {}, requestTypeOrderVersion: 1 });
export function readTrackingPreferences(key: string, columns: readonly TrackingColumn[]): TrackingPreferences {
  const fallback = defaultTrackingPreferences(columns);
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden)) return fallback;
    const keys = new Set(columns.map(c => c.key));
    const order = [...new Set<string>(saved.order.filter((k: unknown) => typeof k === 'string' && keys.has(k)))];
    const widths = Object.fromEntries(Object.entries(saved.widths || {}).filter(([k, w]) => keys.has(k) && typeof w === 'number' && Number.isFinite(w) && w >= trackingColumnMinWidth(k) && w <= 800));
    const hidden = saved.hidden.filter((k: string) => keys.has(k) && k !== 'referenceNo');
    const visibleOrder = order.filter(k => !hidden.includes(k));
    const oldDefault = order.length === columns.length && order.every((k, index) => k === columns[index].key);
    const completeOrder = [...order, ...fallback.order.filter(k => !order.includes(k))];
    // Keep the storage key, widths and other columns; repair only old default /
    // missing / tail-appended type placement. Later explicit reorders stay valid.
    const repairType = saved.requestTypeOrderVersion !== 1 && (!order.includes('requestType') || visibleOrder[visibleOrder.length - 1] === 'requestType' || oldDefault);
    return { order: repairType ? typeAfterReference(completeOrder) : completeOrder, hidden, widths: widths as Record<string, number>, requestTypeOrderVersion: 1 };
  } catch { return fallback; }
}
export function writeTrackingPreferences(key: string, value: TrackingPreferences) { try { localStorage.setItem(key, JSON.stringify({ ...value, requestTypeOrderVersion: 1 })); return true; } catch { return false; } }
