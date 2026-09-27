import type { TrackingItem } from './trackingTypes';
import { calculateTrackingStatistics, statisticsScope, type TrackingStatistics, type TrackingStatisticsQuery, type StatisticsFocus } from './trackingStatistics';

export type TrackingStatisticsSummary = Pick<TrackingStatistics, 'summary' | 'categories'>;
export function trackingStatisticsSummary(stats: TrackingStatisticsSummary): TrackingStatisticsSummary {
  return structuredClone({ summary: stats.summary, categories: stats.categories });
}
export function makeStatisticsSummaryReport(stats: TrackingStatisticsSummary, query: TrackingStatisticsQuery, metadata: { vesselName: string; generatedAt: string; today: string }) {
  const report = { ...metadata, title: '統計資訊', vesselId: query.vesselId, query: structuredClone(query), scope: { cohort: statisticsScope(query, { metric: 'total', category: 'all' }).cohort }, stats: trackingStatisticsSummary(stats) };
  const freeze = (value: unknown) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }; freeze(report);
  return report;
}
/** Legacy calculation entry remains compatible; the output is always summary-only. */
export function makeStatisticsReport(items: readonly TrackingItem[], query: TrackingStatisticsQuery, _focus: StatisticsFocus, metadata: { vesselName: string; generatedAt: string; today: string }) {
  return makeStatisticsSummaryReport(calculateTrackingStatistics(items, query, metadata.today), query, metadata);
}
export type StatisticsReport = ReturnType<typeof makeStatisticsSummaryReport>;
export const STATISTICS_POLICY = '目前已保存狀態；非歷史重建。按項目 ID 計數，同單號不合併。取消排除有效項目及比率；完成率＝已完成／有效項目。延遲率＝延遲／可判定（有效 DL 且已完成日期齊全，或已過 DL 仍未完成）；今日等於 DL 不逾期。無 DL、日期不足、未到期未完成不當作準時。摘要、分類與圖形使用同一範圍，不包含逐項明細。';
