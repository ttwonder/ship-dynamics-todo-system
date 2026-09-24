import type { AppData } from '../types';
/** Exact linked group only. Keep this explanation out of all ship-side UI. */
export function trackingLifecycleExplanation(data: AppData, caseId?: string): string {
  const item = caseId && data.internalControlCases.find(value => value.id === caseId);
  const source = item && data.trackingItems?.find(row => row.id === item.trackingItemId && row.linkState === 'active' && row.linkedCaseId === item.id);
  if (!item || !source) return '';
  const task = item.linkedTaskId && data.tasks.find(value => value.id === item.linkedTaskId && value.internalControlCaseId === item.id);
  return `本次結案／重開／日期更正同步影響：來源 ${source.referenceNo} [${source.id}] → 內控 [${item.id}]${task ? ` → 要事 [${task.id}]` : ''}。送船狀態、送船日期、完工日期及 DL 保持不變；本次結案日期解除後仍保留歷程。`;
}
export function TrackingLifecycleHint({text}:{text:string}) {
  return text ? <details className="tracking-linked-hint" open><summary title={text}>關聯結案／重開影響說明</summary><p>{text}</p></details> : null;
}
