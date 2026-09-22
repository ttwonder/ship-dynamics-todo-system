import type { InternalControlCase } from './types';
import { isValidInternalControlDate, type InternalControlVessel } from './internalControlWorkflow';

export const INTERNAL_CONTROL_ANALYSIS_DIMENSIONS = [
  { key: 'vessel', label: '船舶', multiple: false },
  { key: 'shipType', label: '船型', multiple: false },
  { key: 'priority', label: '重要程度', multiple: false },
  { key: 'category', label: '事項分類', multiple: false },
  { key: 'department', label: '涉及部門', multiple: true },
  { key: 'source', label: '報告來源', multiple: false },
  { key: 'equipment', label: '設備故障細項', multiple: false },
  { key: 'closure', label: '結案狀態', multiple: false },
] as const;
export type InternalControlAnalysisDimension = typeof INTERNAL_CONTROL_ANALYSIS_DIMENSIONS[number]['key'];
export type InternalControlTrendInterval = 'day' | 'week' | 'month';
export interface InternalControlAnalysisSelection {
  dimension: InternalControlAnalysisDimension;
  interval: InternalControlTrendInterval;
  focusKey: string;
}
export interface InternalControlAnalysisRow {
  key: string;
  label: string;
  count: number;
  share: number;
  rank: number;
}
export interface InternalControlBreakdown {
  key: InternalControlAnalysisDimension;
  label: string;
  multiple: boolean;
  rows: InternalControlAnalysisRow[];
}
type VesselNameFormatter = (vessel: InternalControlVessel) => string;

function dimensionValues(item: InternalControlCase, dimension: InternalControlAnalysisDimension, vesselMap: Map<string, InternalControlVessel>, formatVesselName?: VesselNameFormatter): Array<{ key: string; label: string }> {
  const vessel = vesselMap.get(item.vesselId);
  if (dimension === 'vessel') return [{ key: item.vesselId, label: vessel ? (formatVesselName?.(vessel) || vessel.name || vessel.shortName || vessel.fullName || item.vesselId) : item.vesselId }];
  let values: string[];
  switch (dimension) {
    case 'shipType': values = [vessel?.shipType || '未填船型']; break;
    case 'priority': values = [item.priority || '未填重要程度']; break;
    case 'category': values = [item.category || '未分類']; break;
    case 'department': values = item.departments.filter(Boolean); if (!values.length) values = ['未指定部門']; break;
    case 'source': values = [item.reportSource || '未填來源']; break;
    case 'equipment': values = [item.category === '設備故障' ? item.equipmentSubcategory || '未填細項' : '不適用（非設備故障）']; break;
    case 'closure': values = [item.isClosed ? '已結案' : '內控未完']; break;
  }
  // A case may involve several departments, but the same department counts once.
  return [...new Set(values)].map(value => ({ key: value, label: value }));
}

export function buildInternalControlBreakdowns(cases: InternalControlCase[], vessels: InternalControlVessel[], formatVesselName?: VesselNameFormatter): InternalControlBreakdown[] {
  const vesselMap = new Map(vessels.map(vessel => [vessel.id, vessel]));
  return INTERNAL_CONTROL_ANALYSIS_DIMENSIONS.map(dimension => {
    const counts = new Map<string, InternalControlAnalysisRow>();
    for (const item of cases) for (const value of dimensionValues(item, dimension.key, vesselMap, formatVesselName)) {
      const previous = counts.get(value.key);
      if (previous) previous.count++;
      else counts.set(value.key, { ...value, count: 1, share: 0, rank: 0 });
    }
    const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-TW') || a.key.localeCompare(b.key));
    rows.forEach((row, index) => {
      row.share = cases.length ? Math.round(row.count / cases.length * 1000) / 10 : 0;
      row.rank = index && row.count === rows[index - 1].count ? rows[index - 1].rank : index + 1;
    });
    return { ...dimension, rows };
  });
}

export function selectInternalControlTrendCases(cases: InternalControlCase[], vessels: InternalControlVessel[], dimension: InternalControlAnalysisDimension, focusKey: string): InternalControlCase[] {
  if (!focusKey) return cases;
  const vesselMap = new Map(vessels.map(vessel => [vessel.id, vessel]));
  return cases.filter(item => dimensionValues(item, dimension, vesselMap).some(value => value.key === focusKey));
}

export interface InternalControlTrendPoint { key: string; label: string; created: number; closed: number }
export interface InternalControlTrend {
  interval: InternalControlTrendInterval;
  fromDate: string;
  toDate: string;
  points: InternalControlTrendPoint[];
  invalidReportDates: number;
  invalidClosedDates: number;
  error: string;
}
const dateAtMidnight = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateKey = (value: Date) => value.toISOString().slice(0, 10);
function bucketStart(value: string, interval: InternalControlTrendInterval): Date {
  const date = dateAtMidnight(value);
  if (interval === 'month') date.setUTCDate(1);
  if (interval === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

export function buildInternalControlTrend(cases: InternalControlCase[], options: { interval: InternalControlTrendInterval; fromDate?: string; toDate?: string }): InternalControlTrend {
  const result: InternalControlTrend = { interval: options.interval, fromDate: options.fromDate || '', toDate: options.toDate || '', points: [], invalidReportDates: 0, invalidClosedDates: 0, error: '' };
  if ((result.fromDate && !isValidInternalControlDate(result.fromDate)) || (result.toDate && !isValidInternalControlDate(result.toDate))) return { ...result, error: '日期格式無效，請重新選擇報告日期範圍。' };
  if (result.fromDate && result.toDate && result.fromDate > result.toDate) return { ...result, error: '日期起不得晚於日期迄。' };
  const events: Array<{ date: string; kind: 'created' | 'closed' }> = [];
  for (const item of cases) {
    const validReport = isValidInternalControlDate(item.reportDate);
    if (validReport) events.push({ date: item.reportDate, kind: 'created' });
    else result.invalidReportDates++;
    if (item.isClosed) {
      if (isValidInternalControlDate(item.closedDate) && (!validReport || item.closedDate! >= item.reportDate)) events.push({ date: item.closedDate!, kind: 'closed' });
      else result.invalidClosedDates++;
    }
  }
  if (!events.length) return result;
  const dates = events.map(event => event.date).sort();
  result.fromDate ||= dates[0]; result.toDate ||= dates[dates.length - 1];
  if (result.fromDate > result.toDate) return result;
  const end = dateAtMidnight(result.toDate).getTime();
  const cursor = bucketStart(result.fromDate, options.interval);
  while (cursor.getTime() <= end) {
    if (result.points.length >= 366) return { ...result, points: [], error: '區間超過 366 個時間點；請縮短上方日期範圍，或改用週／月檢視。' };
    const key = dateKey(cursor);
    result.points.push({ key, label: options.interval === 'month' ? key.slice(0, 7) : options.interval === 'week' ? `${key} 週` : key, created: 0, closed: 0 });
    if (options.interval === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + (options.interval === 'week' ? 7 : 1));
  }
  const pointMap = new Map(result.points.map(point => [point.key, point]));
  for (const event of events) {
    if (event.date < result.fromDate || event.date > result.toDate) continue;
    const point = pointMap.get(dateKey(bucketStart(event.date, options.interval)));
    if (point) point[event.kind]++;
  }
  return result;
}
