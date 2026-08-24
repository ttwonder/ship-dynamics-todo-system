import type { InternalControlCase, TaskItem, TemporaryMeeting } from './types';
import { morningItemChangedInWindow, type MorningWindow } from './morningHistory';
import { morningDiscussionTasks } from './morningTaskScope';
import { taskVesselIds } from './taskVesselScope';
import { taskIsClosedForScope } from './taskVesselProgress';

export interface MorningAgendaClassification {
  todayTasks: TaskItem[];
  historyTasks: TaskItem[];
  todayInternalControlCases: InternalControlCase[];
  historyInternalControlCases: InternalControlCase[];
}

export interface MorningAgendaClassificationInput {
  tasks: TaskItem[];
  internalControlCases: InternalControlCase[];
  meetings: TemporaryMeeting[];
  scopeVesselIds: string[];
  window: MorningWindow;
  todayTaskIds?: string[];
  todayInternalControlCaseIds?: string[];
  baselineTasks?: TaskItem[];
  baselineInternalControlCases?: InternalControlCase[];
}

const existedByWindowEnd = (createdAt: string, endedAt: string) => {
  const instant = new Date(createdAt);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() <= endedAt;
};

export function classifyMorningAgenda(input: MorningAgendaClassificationInput): MorningAgendaClassification {
  const scope = new Set(input.scopeVesselIds);
  const frozenTodayTasks = new Set(input.todayTaskIds || []);
  const frozenTodayCases = new Set(input.todayInternalControlCaseIds || []);
  const baselineTaskById = new Map((input.baselineTasks || []).map(task => [task.id, task]));
  const baselineCaseById = new Map((input.baselineInternalControlCases || []).map(item => [item.id, item]));
  const todayTasks: TaskItem[] = [];
  const historyTasks: TaskItem[] = [];
  const todayInternalControlCases: InternalControlCase[] = [];
  const historyInternalControlCases: InternalControlCase[] = [];

  morningDiscussionTasks(input.tasks, input.meetings).forEach(task => {
    if (task.isInternalControl || !existedByWindowEnd(task.createdAt, input.window.endedAt)) return;
    const scopedIds = taskVesselIds(task).filter(id => scope.has(id));
    if (!scopedIds.length) return;
    const isToday = frozenTodayTasks.has(task.id) || morningItemChangedInWindow(task, input.window, baselineTaskById.get(task.id));
    const isClosed = taskIsClosedForScope(task, scopedIds);
    if (isToday) todayTasks.push(task);
    else if (!isClosed) historyTasks.push(task);
  });

  input.internalControlCases.forEach(item => {
    if (!scope.has(item.vesselId) || !existedByWindowEnd(item.createdAt, input.window.endedAt)) return;
    const isToday = frozenTodayCases.has(item.id) || morningItemChangedInWindow(item, input.window, baselineCaseById.get(item.id));
    if (isToday) todayInternalControlCases.push(item);
    else if (!item.isClosed) historyInternalControlCases.push(item);
  });

  return { todayTasks, historyTasks, todayInternalControlCases, historyInternalControlCases };
}
