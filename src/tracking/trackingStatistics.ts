import type { TrackingItem } from './trackingTypes';
import { isValidInternalControlDate as validDate } from '../internalControlWorkflow';
import { TRACKING_REQUEST_TYPES, type TrackingRequestType } from './trackingRequestTypes';

export type StatisticsCategory = TrackingRequestType | 'unclassified';
export type StatisticsType = StatisticsCategory | 'all' | 'materials' | 'engineering';
export interface TrackingStatisticsQuery { vesselId: string; from: string; to: string; type: StatisticsType; urgency: 'all' | 'normal' | 'urgent' }
export const STATISTICS_CATEGORIES = ['semiannual-materials', 'temporary-materials', 'spares', 'repair', 'drydock', 'unclassified'].map(value => ({ value: value as StatisticsCategory, label: TRACKING_REQUEST_TYPES.find(t => t.value === value)?.label || '舊資料未分類' }));
export const STATISTICS_TYPES = [{ value: 'all', label: '全部類型' }, { value: 'materials', label: '物料（半年／臨時）' }, { value: 'engineering', label: '工程（維修／塢修）' }, ...STATISTICS_CATEGORIES];
export function statisticsQueryError(query: TrackingStatisticsQuery): string {
  if ((query.from && !validDate(query.from)) || (query.to && !validDate(query.to))) return '請填寫有效的申請／開單日期。';
  if (query.from && query.to && query.from > query.to) return '開始日期不能晚於結束日期。';
  return '';
}
export function trackingStatisticsFacts(item: TrackingItem, today: string) {
  const category: StatisticsCategory = TRACKING_REQUEST_TYPES.some(t => t.value === item.requestType && t.kind === item.kind) ? item.requestType! : 'unclassified';
  const cancelled = item.isClosed && item.closureOutcome === 'cancelled';
  const completed = !cancelled && (item.kind === 'supply' ? item.deliveryStatus === 'delivered' : validDate(item.completionDate));
  const incomplete = !cancelled && !completed;
  const actualDate = item.kind === 'supply' ? item.actualDeliveryDate : item.completionDate;
  const deadline = validDate(item.expectedDate), actual = validDate(actualDate);
  const overdueCompleted = completed && deadline && actual && actualDate! > item.expectedDate;
  const overdueIncomplete = incomplete && deadline && today > item.expectedDate;
  return { item, category, cancelled, completed, incomplete, actualDate: actualDate || '', partial: !cancelled && item.kind === 'supply' && item.deliveryStatus === 'partially-delivered', overdueCompleted, overdueIncomplete,
    delayed: overdueCompleted || overdueIncomplete, delayEligible: !cancelled && deadline && (completed && actual || overdueIncomplete),
    noDeadline: !cancelled && !deadline, insufficientDate: completed && deadline && !actual, notYetDue: incomplete && deadline && today <= item.expectedDate };
}
export type StatisticsRow = ReturnType<typeof trackingStatisticsFacts>;
function summarize(rows: StatisticsRow[]) {
  const count = (test: (row: StatisticsRow) => boolean) => rows.filter(test).length;
  const total = rows.length, cancelled = count(r => r.cancelled), effective = total - cancelled, completed = count(r => r.completed);
  const delayEligible = count(r => r.delayEligible), delayed = count(r => r.delayed);
  return { total, cancelled, effective, completed, incomplete: effective - completed, completionRate: effective ? completed / effective : null,
    delayed, delayEligible, delayRate: delayEligible ? delayed / delayEligible : null,
    overdueCompleted: count(r => r.overdueCompleted), overdueIncomplete: count(r => r.overdueIncomplete), noDeadline: count(r => r.noDeadline), insufficientDate: count(r => r.insufficientDate), notYetDue: count(r => r.notYetDue),
    partial: count(r => r.partial), urgent: count(r => r.item.urgency === 'urgent'), urgentCompleted: count(r => r.item.urgency === 'urgent' && r.completed), urgentIncomplete: count(r => r.item.urgency === 'urgent' && r.incomplete), urgentCancelled: count(r => r.item.urgency === 'urgent' && r.cancelled) };
}
export function calculateTrackingStatistics(items: readonly TrackingItem[], query: TrackingStatisticsQuery, today: string) {
  const error = statisticsQueryError(query); if (error) throw new Error(error);
  if (!validDate(today)) throw new Error('統計基準日期無效。');
  const rows = [...new Map(items.filter(item => item.vesselId === query.vesselId).map(item => [item.id, item])).values()]
    .map(item => trackingStatisticsFacts(item, today)).filter(row => {
      const item = row.item;
      if ((query.from || query.to) && (!validDate(item.applicationDate) || query.from && item.applicationDate < query.from || query.to && item.applicationDate > query.to)) return false;
      if (query.urgency !== 'all' && item.urgency !== query.urgency) return false;
      return query.type === 'all' || (query.type === 'materials' ? ['semiannual-materials', 'temporary-materials'].includes(row.category) : query.type === 'engineering' ? item.kind === 'engineering' : row.category === query.type);
    }).sort((a, b) => b.item.applicationDate.localeCompare(a.item.applicationDate) || a.item.id.localeCompare(b.item.id));
  return { rows, summary: summarize(rows), categories: STATISTICS_CATEGORIES.map(category => ({ ...category, summary: summarize(rows.filter(r => r.category === category.value)) })) };
}
export type TrackingStatistics = ReturnType<typeof calculateTrackingStatistics>;
export const STATISTICS_METRICS = [
  ['total','申請數'], ['effective','有效項目'], ['completed','已完成'], ['incomplete','未完成'], ['cancelled','取消'], ['partial','部分送船'],
  ['delayed','延遲數'], ['delayEligible','延遲可判定'], ['overdueIncomplete','逾期未完成'], ['overdueCompleted','逾期完成'],
  ['urgent','急件總數'], ['urgentCompleted','急件已完成'], ['urgentIncomplete','急件未完成'], ['urgentCancelled','急件取消'],
  ['noDeadline','未填／無效 DL'], ['insufficientDate','完成日期不足'], ['notYetDue','未到期未完成'],
] as const;
export type StatisticsMetric = typeof STATISTICS_METRICS[number][0];
export interface StatisticsFocus { metric: StatisticsMetric; category: StatisticsCategory | 'all' }
export const statisticsPercent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
export function statisticsFocusRows(stats: TrackingStatistics, focus: StatisticsFocus): StatisticsRow[] {
  return stats.rows.filter(row => {
    if (focus.category !== 'all' && row.category !== focus.category) return false;
    switch (focus.metric) {
      case 'total': return true;
      case 'effective': return !row.cancelled;
      case 'urgent': return row.item.urgency === 'urgent';
      case 'urgentCompleted': return row.item.urgency === 'urgent' && row.completed;
      case 'urgentIncomplete': return row.item.urgency === 'urgent' && row.incomplete;
      case 'urgentCancelled': return row.item.urgency === 'urgent' && row.cancelled;
      default: return row[focus.metric];
    }
  });
}
export function statisticsScope(query: TrackingStatisticsQuery, focus: StatisticsFocus) {
  const cohort = `申請／開單日期 ${query.from || '不限起日'} ～ ${query.to || '不限迄日'}（含邊界）｜${STATISTICS_TYPES.find(t => t.value === query.type)?.label}｜${query.urgency === 'all' ? '普通＋急件' : query.urgency === 'urgent' ? '急件' : '普通'}`;
  const detail = `${STATISTICS_CATEGORIES.find(c => c.value === focus.category)?.label || '全部分類'}／${STATISTICS_METRICS.find(m => m[0] === focus.metric)![1]}`;
  return { cohort, detail };
}
