import type { InternalControlCase, TaskItem, Vessel } from './types';
import type { DashboardMeetingAlert } from './meetingVesselAttention';
import { meetingCreatesVesselAbnormalAlert } from './meetingVesselAttention';
import { appearsInSingleVesselTasks } from './taskAttention';
import { taskHasVessel } from './taskVesselScope';
import { taskIsClosedForVessel } from './taskVesselProgress';
import { unlinkedInternalControlCasesForVessel } from './vesselAttention';
import RichTextContent from './RichTextContent';
import { richTextToPlainText } from './richText';

const PRIORITY_RANK = { 急: 0, 高: 1, 中: 2, 低: 3 } as const;
const priorityClass = (priority: TaskItem['priority']) => priority === '急' ? 'urgent' : priority === '高' ? 'high' : priority === '中' ? 'mid' : 'low';

type Props = {
  vessel: Vessel;
  tasks: TaskItem[];
  internalControlCases: InternalControlCase[];
  meetings: DashboardMeetingAlert[];
  canDiscloseMeetingSubjects: boolean;
  compact?: boolean;
};

export default function VesselImportantSummary({ vessel, tasks, internalControlCases, meetings, canDiscloseMeetingSubjects, compact = false }: Props) {
  const summaryTasks = tasks
    .filter(task => taskHasVessel(task, vessel.id) && !taskIsClosedForVessel(task, vessel.id) && appearsInSingleVesselTasks(task))
    .sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || Number(right.isAbnormal) - Number(left.isAbnormal));
  const abnormalMeetings = meetings.filter(meeting => meetingCreatesVesselAbnormalAlert(meeting, vessel.id));
  const standaloneInternalCases = unlinkedInternalControlCasesForVessel(internalControlCases, vessel.id);
  const dashboardHasSummary = Boolean(vessel.position.manualRemark || vessel.note.recentDynamics || abnormalMeetings.length || standaloneInternalCases.length || summaryTasks.length);
  const morningCases = internalControlCases
    .filter(item => item.vesselId === vessel.id && !item.isClosed)
    .sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]);
  const morningCaseIds = new Set(morningCases.map(item => item.id));
  const morningLinkedTaskIds = new Set(morningCases.map(item => item.linkedTaskId).filter((id): id is string => Boolean(id)));
  const morningTasks = summaryTasks.filter(task => !task.isInternalControl);
  const orphanInternalTasks = summaryTasks.filter(task => task.isInternalControl
    && !morningLinkedTaskIds.has(task.id)
    && !(task.internalControlCaseId && morningCaseIds.has(task.internalControlCaseId)));
  const morningInternalItems = [
    ...morningCases.map(item => ({ id: `case-${item.id}`, description: item.description, priority: item.priority, isAbnormal: false })),
    ...orphanInternalTasks.map(task => ({ id: `task-${task.id}`, description: task.description, priority: task.priority, isAbnormal: task.isAbnormal })),
  ].sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || Number(right.isAbnormal) - Number(left.isAbnormal));
  const compactHasSummary = Boolean(vessel.position.manualRemark || vessel.note.recentDynamics || abnormalMeetings.length || morningTasks.length || morningInternalItems.length);

  if (compact) return <span className="ship-summary morning-vessel-summary" aria-label="重要摘要">
    <b className="ship-summary-title">重要摘要</b>
    <span className="ship-summary-content">
    {vessel.position.manualRemark && <span className="morning-summary-section summary-source-manual"><span className="morning-summary-source-label">人工備註</span><span className="morning-summary-text manual-remark-summary">{vessel.position.manualRemark}</span></span>}
    {vessel.note.recentDynamics && <span className="morning-summary-section summary-source-dynamics"><span className="morning-summary-source-label">船舶動態</span><span className="morning-summary-text">{vessel.note.recentDynamics}</span></span>}
    {morningTasks.length > 0 && <span className="morning-summary-section summary-source-task"><span className="morning-summary-source-label">要事</span>{morningTasks.map(task => <span className="morning-summary-item morning-summary-task" key={task.id}>{task.isAbnormal && <span className="inline-abnormal">異常</span>}<span className={`badge ${priorityClass(task.priority)}`}>{task.priority}</span><span className="morning-summary-item-text">{richTextToPlainText(task.description) || '尚未輸入要事內容'}</span></span>)}</span>}
    {morningInternalItems.length > 0 && <span className="morning-summary-section summary-source-internal"><span className="morning-summary-source-label">內控</span>{morningInternalItems.map(item => <span className="morning-summary-item morning-summary-internal" key={item.id}>{item.isAbnormal && <span className="inline-abnormal">異常</span>}<span className={`badge ${priorityClass(item.priority)}`}>{item.priority}</span><span className="morning-summary-item-text">{richTextToPlainText(item.description) || '尚未輸入內控內容'}</span></span>)}</span>}
    {abnormalMeetings.length > 0 && <span className="morning-summary-section summary-source-meeting"><span className="morning-summary-source-label">臨會／專題異常</span><span className="morning-summary-text meeting-abnormal-summary">{canDiscloseMeetingSubjects ? abnormalMeetings.map(meeting => meeting.subject || '未命名會議').join('、') : `存在需關注之臨會／專題異常 ${abnormalMeetings.length} 件`}</span></span>}
    {!compactHasSummary && <span>目前無重要摘要</span>}
    </span>
  </span>;

  return <div className="ship-summary" aria-label="重要摘要">
    <b className="ship-summary-title">重要摘要</b>
    <div className="ship-summary-content">
      {vessel.position.manualRemark && <p className="manual-remark-summary"><strong>人工備註</strong>{vessel.position.manualRemark}</p>}
      {vessel.note.recentDynamics && <p><strong>近期／後續動態</strong>{vessel.note.recentDynamics}</p>}
      {abnormalMeetings.length > 0 && <p className="meeting-abnormal-summary"><strong>臨會/專題異常</strong>{canDiscloseMeetingSubjects ? abnormalMeetings.map(meeting => meeting.subject || '未命名會議').join('、') : `存在需關注之臨會/專題異常 ${abnormalMeetings.length} 件`}</p>}
      {standaloneInternalCases.length > 0 && <p className="internal-control-summary"><strong>未同步內控</strong>{standaloneInternalCases.length} 件</p>}
      {summaryTasks.length > 0 && <ul>{summaryTasks.map(task => <li key={task.id}>{task.isAbnormal && <span>異常</span>}<strong>{task.priority}</strong><RichTextContent compact value={task.description} fallback="尚未輸入要事內容"/></li>)}</ul>}
      {!dashboardHasSummary && <p>目前無重要摘要</p>}
    </div>
  </div>;
}
