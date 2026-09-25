import type { TrackingItem, TrackingKind } from './trackingTypes';
import { isValidInternalControlDate } from '../internalControlWorkflow';
import { TRACKING_COLUMNS, type TrackingColumn } from './trackingColumns';
export const TRACKING_TABS = [
  { id: 'undelivered', label: '未送船清單', kind: 'supply' },
  { id: 'delivered', label: '已送船清單', kind: 'supply' },
  { id: 'supply-all', label: '配件物料總清單', kind: 'supply' },
  { id: 'engineering-open', label: '未完成工程單', kind: 'engineering' },
  { id: 'engineering-closed', label: '已完成工程單', kind: 'engineering' },
] as const;
export type TrackingTab = typeof TRACKING_TABS[number]['id'];
export interface TrackingFilter { mode?: '' | 'blank' | 'nonblank'; text?: string; from?: string; to?: string; values?: string[] }
export interface TrackingQuery { vesselId: string; tab: TrackingTab; filters: Record<string, TrackingFilter>; sort: { key: string; direction: 'asc' | 'desc' }; search?: string }
export const trackingTabKind = (tab: TrackingTab): TrackingKind => TRACKING_TABS.find(value => value.id === tab)!.kind;
export function trackingInTab(row: TrackingItem, tab: TrackingTab): boolean {
  if (row.kind !== trackingTabKind(tab)) return false;
  if (tab === 'supply-all') return true;
  if (tab === 'undelivered') return !row.isClosed && row.deliveryStatus !== 'delivered';
  if (tab === 'delivered') return row.deliveryStatus === 'delivered';
  const completed = isValidInternalControlDate(row.completionDate);
  return tab === 'engineering-open' ? !completed : completed;
}
export const filterIsActive = (filter: TrackingFilter) => Boolean(filter.mode || filter.text || filter.from || filter.to || filter.values?.length);
export function selectTrackingRows(items: readonly TrackingItem[], query: TrackingQuery): TrackingItem[] {
  const columns = new Map(TRACKING_COLUMNS.map(column => [column.key, column]));
  const needle = query.search?.trim().toLocaleLowerCase();
  const rows = items.filter(row => row.vesselId === query.vesselId && trackingInTab(row, query.tab)).filter(row => {
    if (needle && !TRACKING_COLUMNS.some(column => column.value(row).toLocaleLowerCase().includes(needle))) return false;
    return Object.entries(query.filters).every(([key, filter]) => {
      const column = columns.get(key); if (!column || !filterIsActive(filter)) return true;
      const value = column.value(row); const date = value.slice(0, 10);
      if (filter.mode === 'blank' && value.trim()) return false;
      if (filter.mode === 'nonblank' && !value.trim()) return false;
      if (filter.text && !value.toLocaleLowerCase().includes(filter.text.toLocaleLowerCase())) return false;
      if (filter.from && (!date || date < filter.from)) return false;
      if (filter.to && (!date || date > filter.to)) return false;
      if (filter.values?.length && !filter.values.includes(value)) return false;
      return true;
    });
  });
  const column = columns.get(query.sort.key) || columns.get('createdAt')!;
  return rows.sort((left, right) => {
    const a = column.value(left), b = column.value(right);
    if (!a.trim() !== !b.trim()) return !a.trim() ? 1 : -1;
    const compared = a.localeCompare(b, 'zh-Hant', { numeric: true });
    return (query.sort.direction === 'asc' ? compared : -compared) || left.id.localeCompare(right.id);
  });
}
/** Stable, full filtered/sorted set, not the current page or unsent draft.
 * Excel/PDF consumes this single snapshot and must recheck the caller's identity. */
export function trackingRowSnapshot(rows: readonly TrackingItem[], columns: readonly TrackingColumn[]) {
  return { columns: columns.map(({ key, label, type, width }) => ({ key, label, type, width })), rows: rows.map(row => ({ id: row.id, item: structuredClone(row), values: Object.fromEntries(columns.map(column => [column.key, column.value(row)])) })) };
}
