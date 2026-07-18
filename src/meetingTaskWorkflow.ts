import type { NotificationKind, TaskItem, TaskPriority } from './types';
import { uid } from './utils';

interface ReconcileMeetingTasksInput {
  tasks: TaskItem[];
  meetingId: string;
  vesselIds: string[];
  followUp: string;
  priority: TaskPriority;
  expectedDate: string;
  departments: string[];
  initialStatus: string;
  actorId: string;
  actorName: string;
  at: string;
  preserveExistingDescriptions?: boolean;
}

export interface ReconcileMeetingTasksResult {
  created: TaskItem[];
  updatedIds: string[];
  archivedIds: string[];
}

export type MeetingTaskNotificationKind = Extract<NotificationKind, 'task_created' | 'task_updated' | 'task_archived'>;
export interface MeetingTaskNotificationEvent {
  task: TaskItem;
  kind: MeetingTaskNotificationKind;
}

export const meetingTaskDescription = (
  meeting: { id: string; taskDescription?: unknown },
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'description'>[] = [],
): string => {
  const hasSavedDescription = Object.prototype.hasOwnProperty.call(meeting, 'taskDescription');
  const savedDescription = typeof meeting.taskDescription === 'string' ? meeting.taskDescription : '';
  if (hasSavedDescription) return savedDescription;
  return tasks.find(task => task.sourceMeetingId === meeting.id && task.description.trim())?.description || '';
};

export const shouldPreserveMeetingTaskDescriptions = (
  meeting: { id: string; taskDescription?: unknown } | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'description'>[],
  nextDescription: string,
): boolean => {
  if (!meeting) return false;
  return nextDescription === meetingTaskDescription(meeting, tasks);
};

const archiveLinkedTask = (
  task: TaskItem,
  reason: string,
  actorId: string,
  actorName: string,
  at: string,
) => {
  const wasClosed = task.isClosed;
  const logText = wasClosed ? `解除會議關聯：${reason}` : reason;
  task.isClosed = true;
  task.closedDate = task.closedDate || at.slice(0, 10);
  task.closedBy = task.closedBy || actorId;
  if (!wasClosed) task.status = reason;
  task.updatedBy = actorId;
  task.updatedAt = at;
  delete task.sourceMeetingId;
  task.statusLogs.unshift({ id: uid('log'), at, by: actorName, text: logText });
  return !wasClosed;
};

export const reconcileMeetingTasks = ({
  tasks,
  meetingId,
  vesselIds,
  followUp,
  priority,
  expectedDate,
  departments,
  initialStatus,
  actorId,
  actorName,
  at,
  preserveExistingDescriptions = false,
}: ReconcileMeetingTasksInput): ReconcileMeetingTasksResult => {
  const description = followUp.trim();
  const targetVesselIds = description ? Array.from(new Set(vesselIds)) : [];
  const targetSet = new Set(targetVesselIds);
  const grouped = new Map<string, TaskItem[]>();

  tasks.filter(task => task.sourceMeetingId === meetingId).forEach(task => {
    const group = grouped.get(task.vesselId) || [];
    group.push(task);
    grouped.set(task.vesselId, group);
  });

  const canonicalByVessel = new Map<string, TaskItem>();
  const archivedIds: string[] = [];
  grouped.forEach((group, vesselId) => {
    if (!targetSet.has(vesselId)) {
      const reason = description ? '已取消（已移出臨會/專題範圍）' : '已取消（臨會/專題待辦已清空）';
      group.forEach(task => {
        if (archiveLinkedTask(task, reason, actorId, actorName, at)) archivedIds.push(task.id);
      });
      return;
    }

    const canonical = group.find(task => !task.isClosed) || group[0];
    canonicalByVessel.set(vesselId, canonical);
    group.filter(task => task.id !== canonical.id).forEach(task => {
      if (archiveLinkedTask(task, '已取消（重複的臨會/專題待辦）', actorId, actorName, at)) archivedIds.push(task.id);
    });
  });

  const created: TaskItem[] = [];
  const updatedIds: string[] = [];
  targetVesselIds.forEach(vesselId => {
    const existingTask = canonicalByVessel.get(vesselId);
    if (existingTask) {
      Object.assign(existingTask, {
        sourceType: 'temporary' as const,
        priority,
        category: '臨會/專題',
        categories: ['臨會/專題'],
        expectedDate,
        departments: [...departments],
        updatedBy: actorId,
        updatedAt: at,
      });
      if (!preserveExistingDescriptions) existingTask.description = description;
      updatedIds.push(existingTask.id);
      return;
    }

    const task: TaskItem = {
      id: uid('task'),
      sourceMeetingId: meetingId,
      sourceType: 'temporary',
      vesselId,
      priority,
      isAware: true,
      isAbnormal: false,
      isInternalControl: false,
      category: '臨會/專題',
      categories: ['臨會/專題'],
      description,
      status: initialStatus.trim() || '待執行',
      expectedDate,
      departments: [...departments],
      ownerUserIds: [],
      isClosed: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: at,
      updatedAt: at,
      statusLogs: [{ id: uid('log'), at, by: actorName, text: initialStatus.trim() || '建立臨會/專題待辦' }],
    };
    tasks.unshift(task);
    created.push(task);
  });

  return { created, updatedIds, archivedIds };
};

export const meetingTaskNotificationEvents = (
  tasks: TaskItem[],
  result: ReconcileMeetingTasksResult,
): MeetingTaskNotificationEvent[] => {
  const taskById = new Map([...tasks, ...result.created].map(task => [task.id, task]));
  const refs: Array<{ taskId: string; kind: MeetingTaskNotificationKind }> = [
    ...result.created.map(task => ({ taskId: task.id, kind: 'task_created' as const })),
    ...result.updatedIds.map(taskId => ({ taskId, kind: 'task_updated' as const })),
    ...result.archivedIds.map(taskId => ({ taskId, kind: 'task_archived' as const })),
  ];
  return refs.flatMap(({ taskId, kind }) => {
    const task = taskById.get(taskId);
    return task ? [{ task, kind }] : [];
  });
};
