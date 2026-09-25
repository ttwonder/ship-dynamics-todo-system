import type { TrackingItem } from './trackingTypes';
import { calculateTrackingStatistics, statisticsFocusRows, statisticsScope, STATISTICS_CATEGORIES, type TrackingStatisticsQuery, type StatisticsFocus, type StatisticsRow } from './trackingStatistics';

export const STATISTICS_DETAIL_COLUMNS = [
  { key:'id', label:'項目 ID', width:22 }, { key:'referenceNo', label:'申請單號(材料或工程)', width:24 }, { key:'applicationDate', label:'申請／開單日期', width:15 }, { key:'category', label:'分類／急件', width:20 },
  { key:'description', label:'內容摘要／工程內容', width:50 }, { key:'expectedDate', label:'期望完成日期/DL', width:15 }, { key:'actualDate', label:'實際送達／完工日期', width:16 },
  { key:'status', label:'目前狀態', width:22 }, { key:'delay', label:'延遲判定', width:20 }, { key:'progress', label:'最新進度', width:40 }, { key:'supplementalNotes', label:'補充說明', width:40 },
] as const;
export const statisticsStatus = (r: StatisticsRow) => (r.cancelled ? '取消' : r.completed ? '已完成' : r.partial ? '部分送船／未完成' : '未完成') + (!r.cancelled && r.item.isClosed ? '（已結案）' : '');
export const statisticsDelay = (r: StatisticsRow) => r.cancelled ? '不計' : r.delayed ? '延遲' : r.noDeadline ? '未填／無效 DL' : r.insufficientDate ? '完成日期不足' : r.notYetDue ? '未到期' : '準時';
export function makeStatisticsReport(items: readonly TrackingItem[], query: TrackingStatisticsQuery, focus: StatisticsFocus, metadata: { vesselName:string; generatedAt:string; today:string }) {
  const stats = calculateTrackingStatistics(structuredClone(items),query,metadata.today), scope = statisticsScope(query,focus);
  const rows = statisticsFocusRows(stats,focus).map(r => ({id:r.item.id, values:{ id:r.item.id, referenceNo:r.item.referenceNo, applicationDate:r.item.applicationDate, category:`${STATISTICS_CATEGORIES.find(c=>c.value===r.category)!.label}／${r.item.urgency==='urgent'?'急件':'普通'}`, description:r.item.description, expectedDate:r.item.expectedDate, actualDate:r.actualDate, status:statisticsStatus(r), delay:statisticsDelay(r), progress:r.item.progress, supplementalNotes:r.item.supplementalNotes }}));
  const report = { ...metadata, title:'統計資訊', vesselId:query.vesselId, query:{...query}, focus:{...focus}, scope, stats, rows };
  const freeze = (value:unknown) => { if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);} }; freeze(report);
  return report;
}
export type StatisticsReport = ReturnType<typeof makeStatisticsReport>;
export const STATISTICS_POLICY = '目前已保存狀態；非歷史重建。按項目 ID 計數，同單號不合併。取消排除有效項目及比率；完成率＝已完成／有效項目。延遲率＝延遲／可判定（有效 DL 且已完成日期齊全，或已過 DL 仍未完成）；今日等於 DL 不逾期。無 DL、日期不足、未到期未完成不當作準時。摘要／分類為完整條件；明細為條件內焦點。';
