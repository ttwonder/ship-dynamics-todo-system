import type { AgendaReport, AppData, MorningReportSnapshot, TaskItem, TemporaryMeeting, Vessel } from './types';
import { isTaipeiBusinessDay, taipeiBusinessDateLabel, taipeiDateKey } from './taipeiTime';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskVesselIds } from './taskVesselScope';
import { taskIsClosedForScope } from './taskVesselProgress';

export type MorningHistoryData = Pick<AppData, 'agendaReports' | 'vessels' | 'tasks' | 'meetings'>;

export interface DailyMorningSaveInput {
  at?: Date | string | number;
  actorUserId: string;
  source: 'manual' | 'scheduled';
}

export type DailyMorningSaveResult<T extends MorningHistoryData> =
  | { status: 'not-business-day'; data: T; report?: undefined }
  | { status: 'saved'; data: T; report: AgendaReport };

function instantIso(value: Date | string | number | undefined): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('無效的早會快照時間');
  return date.toISOString();
}

function cloneSnapshot(vessels: Vessel[], tasks: TaskItem[], meetings: TemporaryMeeting[], capturedAt: string): MorningReportSnapshot {
  return structuredClone({ capturedAt, vessels, tasks, meetings });
}

function morningSnapshotContent(tasks: TaskItem[], meetings: TemporaryMeeting[], vesselIds: string[]) {
  const allowed = new Set(vesselIds);
  const visibleMeetings = meetings.filter(meeting => meeting.includeInMorning && !meeting.isInternalControl);
  const meetingIds = new Set(visibleMeetings.map(meeting => meeting.id));
  const visibleTasks = morningDiscussionTasks(tasks, visibleMeetings).filter(task => {
    if (task.isInternalControl) return false;
    if (task.sourceMeetingId && !meetingIds.has(task.sourceMeetingId)) return false;
    const scopedIds = taskVesselIds(task).filter(id => allowed.has(id));
    return scopedIds.length > 0 && !taskIsClosedForScope(task, scopedIds);
  });
  const usedMeetingIds = new Set(visibleTasks.map(task => task.sourceMeetingId).filter(Boolean));
  return {
    tasks: visibleTasks,
    meetings: visibleMeetings.filter(meeting => usedMeetingIds.has(meeting.id)),
  };
}

export function upsertDailyMorningReport<T extends MorningHistoryData>(data: T, input: DailyMorningSaveInput): DailyMorningSaveResult<T> {
  const capturedAt = instantIso(input.at);
  if (!isTaipeiBusinessDay(capturedAt)) return { status: 'not-business-day', data };

  const businessDate = taipeiDateKey(capturedAt);
  const vessels = data.vessels.filter(vessel => vessel.isActive !== false);
  const vesselIds = vessels.map(vessel => vessel.id);
  const content = morningSnapshotContent(data.tasks, data.meetings, vesselIds);
  const snapshot = cloneSnapshot(vessels, content.tasks, content.meetings, capturedAt);
  const existingIndex = data.agendaReports.findIndex(report => report.kind === 'daily-morning' && report.businessDate === businessDate);
  const existing = existingIndex >= 0 ? data.agendaReports[existingIndex] : undefined;
  const report: AgendaReport = {
    id: existing?.id || `daily-morning-${businessDate}`,
    title: `${taipeiBusinessDateLabel(capturedAt)}早會內容`,
    vesselIds,
    createdBy: existing?.createdBy || input.actorUserId,
    createdAt: existing?.createdAt || capturedAt,
    taskCount: content.tasks.length,
    kind: 'daily-morning',
    businessDate,
    source: input.source === 'manual' || existing?.source !== 'manual' ? input.source : 'manual',
    updatedAt: capturedAt,
    snapshot,
  };
  const agendaReports = [...data.agendaReports];
  if (existingIndex >= 0) agendaReports[existingIndex] = report;
  else agendaReports.unshift(report);
  return { status: 'saved', data: { ...data, agendaReports } as T, report };
}

export function dailyMorningReports(reports: AgendaReport[]): AgendaReport[] {
  return reports
    .filter(report => report.kind === 'daily-morning' && Boolean(report.businessDate) && Boolean(report.snapshot))
    .sort((left, right) => (right.businessDate || '').localeCompare(left.businessDate || '') || (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt));
}
