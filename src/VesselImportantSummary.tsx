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
  const hasSummary = Boolean(vessel.position.manualRemark || vessel.note.recentDynamics || abnormalMeetings.length || standaloneInternalCases.length || summaryTasks.length);

  if (compact) return <span className="ship-summary morning-vessel-summary" aria-label="重要摘要">
    <b className="ship-summary-title">重要摘要</b>
    <span className="ship-summary-content">
      {vessel.position.manualRemark && <span className="manual-remark-summary"><strong>人工備註</strong>{vessel.position.manualRemark}</span>}
      {vessel.note.recentDynamics && <span><strong>近期／後續動態</strong>{vessel.note.recentDynamics}</span>}
      {abnormalMeetings.length > 0 && <span className="meeting-abnormal-summary"><strong>臨會/專題異常</strong>{canDiscloseMeetingSubjects ? abnormalMeetings.map(meeting => meeting.subject || '未命名會議').join('、') : `存在需關注之臨會/專題異常 ${abnormalMeetings.length} 件`}</span>}
      {standaloneInternalCases.length > 0 && <span className="internal-control-summary"><strong>未同步內控</strong>{standaloneInternalCases.length} 件</span>}
      {summaryTasks.map(task => <span className="morning-summary-task" key={task.id}>{task.isAbnormal && <span>異常</span>}<strong>{task.priority}</strong><span>{richTextToPlainText(task.description) || '尚未輸入要事內容'}</span></span>)}
      {!hasSummary && <span>目前無重要摘要</span>}
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
      {!hasSummary && <p>目前無重要摘要</p>}
    </div>
  </div>;
}
