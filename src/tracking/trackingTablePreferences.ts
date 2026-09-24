import type { TrackingColumn } from './trackingColumns';
export const TRACKING_COLUMN_SCHEMA = 1;
export interface TrackingPreferences { order: string[]; hidden: string[]; widths: Record<string, number> }
export const trackingPreferenceKey = (workspace: string, actorId: string, tab: string) => JSON.stringify(['tracking-columns', workspace, actorId, tab, TRACKING_COLUMN_SCHEMA]);
export const defaultTrackingPreferences = (columns: readonly TrackingColumn[]): TrackingPreferences => ({ order: columns.map(c => c.key), hidden: columns.filter(c => c.hidden).map(c => c.key), widths: {} });
export function readTrackingPreferences(key: string, columns: readonly TrackingColumn[]): TrackingPreferences {
  const fallback = defaultTrackingPreferences(columns);
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden)) return fallback;
    const keys = new Set(columns.map(c => c.key));
    const order = [...new Set<string>(saved.order.filter((k: unknown) => typeof k === 'string' && keys.has(k)))];
    const widths = Object.fromEntries(Object.entries(saved.widths || {}).filter(([k, w]) => keys.has(k) && typeof w === 'number' && Number.isFinite(w) && w >= 70 && w <= 800));
    return { order: [...order, ...fallback.order.filter(k => !order.includes(k))], hidden: saved.hidden.filter((k: string) => keys.has(k) && k !== 'referenceNo'), widths: widths as Record<string, number> };
  } catch { return fallback; }
}
export function writeTrackingPreferences(key: string, value: TrackingPreferences) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
