import type { AppData } from '../types';
import { richTextToPlainText } from '../richText';
import { formatTaipeiDateTime } from '../taipeiTime';
import { vesselSelectionDisplayName } from '../vesselDisplay';
import { resolveTrackingGroup, sourceForCase, type TrackingLifecycleAction } from './trackingLifecycle';
import { trackingItemLabel } from './trackingDisplay';
import { trackingRequestTypeLabel } from './trackingRequestTypes';

function brief(value?: string) {
  const chars = Array.from(richTextToPlainText(value).replace(/\s+/g, ' '));
  return chars.length > 32 ? `${chars.slice(0, 32).join('')}…` : chars.join('');
}

/** Shore editors only. Resolve membership by reciprocal IDs; show business labels instead. */
type ImpactPreview = {action?: TrackingLifecycleAction; date?: string; taskId?: string; createTask?: boolean};
export function trackingLifecycleExplanation(data: AppData, caseId?: string, preview: ImpactPreview = {}): string {
  const uncertain = '無法確認同步範圍：關聯資料不完整或不一致，請重新載入並核對。';
  const removed = '跟蹤關聯已失效；本次操作不會同步到原跟蹤項目。';
  const item = caseId && data.internalControlCases.find(row => row.id === caseId);
  if (!item) {
    const reverseClaim = preview.taskId && data.internalControlCases.some(row => row.linkedTaskId === preview.taskId && row.trackingItemId);
    return reverseClaim || (caseId && data.trackingItems?.some(row => row.linkedCaseId === caseId && row.linkState === 'active')) ? uncertain : '';
  }
  let group: ReturnType<typeof resolveTrackingGroup>;
  try {
    const source = sourceForCase(data, item);
    if (!source) return item.trackingLinkState === 'invalid' ? removed : '';
    if (item.trackingLinkState === 'invalid') return uncertain;
    group = resolveTrackingGroup(data, source.id);
  } catch {
    // Partial read models can lack an endpoint. Never guess a group or interrupt the editor.
    return uncertain;
  }
  const {source, task} = group;
  if ((preview.taskId && task?.id !== preview.taskId)
    || data.internalControlCases.some(other => other !== item && (
      (other.trackingItemId === source.id && other.trackingLinkState !== 'invalid') || (task && other.linkedTaskId === task.id)))
    || [item, ...(task ? [task] : [])].some(member => member.isClosed !== source.isClosed || (source.isClosed && member.closedDate !== source.closedDate))) return uncertain;
  const vessel = data.vessels.find(row => row.id === source.vesselId);
  const vesselName = vesselSelectionDisplayName({name:vessel?.name, fullName:vessel?.fullName, shortName:vessel?.shortName});
  const kind = trackingRequestTypeLabel(source.requestType) || (source.kind === 'supply' ? '物料' : '工程');
  const sourceLabel = trackingItemLabel({...source, description:brief(source.description)});
  const delivery = {'not-delivered':'未送船','partially-delivered':'部分送船',delivered:'已送船'}[source.deliveryStatus];
  const retained = source.kind === 'supply'
    ? `送船狀態：${delivery || '未記錄'}｜實際送達日期：${source.actualDeliveryDate || '未填'}`
    : `完工日期：${source.completionDate || '未填'}`;
  const taskLabel = task ? `要事：${brief(task.description) || '未填事項內容'}` : preview.createTask ? '尚未連結要事；已勾選同步，保存時將建立要事' : '未連結要事';
  const targets = task ? '跟蹤項目、內控案件與要事' : preview.createTask ? '跟蹤項目、內控案件與新要事' : '跟蹤項目與內控案件';
  const action = preview.action || (item.isClosed ? 'reopen' : 'close');
  const change = action === 'reopen'
    ? `重開後：${targets}改為未結案，清除本次結案日期（${item.closedDate || '未記錄'}），保留歷程。`
    : action === 'correct-close-date'
      ? `更正後：${targets}維持已結案，結案日期：${item.closedDate || '未記錄'} → ${preview.date || '待選擇'}。`
      : `結案後：${targets}同步結案，結案日期：${preview.date || '待選擇'}${source.kind === 'engineering' ? '；工程結案結果為正常結案' : ''}。`;
  return [
    `跟蹤項目：${vesselName}｜${kind}｜${sourceLabel}`,
    `內控案件：${[item.reportDate,brief(item.description) || item.category].filter(Boolean).join('｜') || '本案'}｜${taskLabel}`,
    change,
    `跟蹤項目不變：${retained}｜期望完成日/DL：${source.expectedDate || '未填'}`,
    source.deletion && `來源已刪除（${formatTaipeiDateTime(source.deletion.at)} UTC+8，理由：${source.deletion.reason}）；仍同步結案資料，不會還原來源。`,
  ].filter(Boolean).join('\n');
}

export function TrackingLifecycleHint({text}:{text:string}) {
  return text ? <details className="tracking-linked-hint" open><summary>關聯影響說明</summary>{text.split('\n').map((line,index) => <div key={index}>{line}</div>)}</details> : null;
}
