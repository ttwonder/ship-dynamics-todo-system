import type { MeetingTaskItem, NotificationKind, TaskItem, TaskPriority } from './types';
import { uid } from './utils';

interface ReconcileMeetingTasksInput {
  tasks: TaskItem[];
  meetingId: string;
  vesselIds: string[];
  followUp?: string;
  followUps?: MeetingTaskItem[];
  priority: TaskPriority;
  expectedDate: string;
  departments: string[];
  initialStatus: string;
  actorId: string;
  actorName: string;
  at: string;
  preserveExistingDescriptions?: boolean;
  preserveExistingDescriptionItemIds?: string[];
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

type MeetingWithTaskItems = { id: string; taskDescription?: unknown; taskItems?: unknown };

export const canonicalMeetingTaskItems = (items: MeetingTaskItem[], meetingId: string): MeetingTaskItem[] => {
  const seen = new Set<string>();
  return items.map((item, index) => {
    const rawId = item.id || `${meetingId}-task-${index + 1}`;
    const id = seen.has(rawId) ? `${rawId}-duplicate-${index + 1}` : rawId;
    seen.add(id);
    return { id, description: item.description.trim() };
  }).filter(item => item.id && item.description);
};

export const meetingTaskItems = (
  meeting: MeetingWithTaskItems,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description'>[] = [],
): MeetingTaskItem[] => {
  if (Object.prototype.hasOwnProperty.call(meeting, 'taskItems')) {
    if (!Array.isArray(meeting.taskItems)) return [];
    return canonicalMeetingTaskItems(meeting.taskItems.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { id?: unknown; description?: unknown };
      const id = typeof item.id === 'string' && item.id ? item.id : `${meeting.id}-task-${index + 1}`;
      return [{ id, description: typeof item.description === 'string' ? item.description : '' }];
    }), meeting.id);
  }
  const hasSavedDescription = Object.prototype.hasOwnProperty.call(meeting, 'taskDescription');
  const savedDescription = typeof meeting.taskDescription === 'string' ? meeting.taskDescription : '';
  if (hasSavedDescription) return savedDescription.trim() ? [{ id: `${meeting.id}-task-1`, description: savedDescription }] : [];
  const linkedTask = tasks.find(task => task.sourceMeetingId === meeting.id && task.description.trim());
  return linkedTask ? [{ id: linkedTask.sourceMeetingItemId || `${meeting.id}-task-1`, description: linkedTask.description }] : [];
};

export const meetingTaskDescription = (
  meeting: MeetingWithTaskItems,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description'>[] = [],
): string => meetingTaskItems(meeting, tasks)[0]?.description || '';

export const unchangedMeetingTaskItemIds = (
  meeting: MeetingWithTaskItems | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description'>[],
  nextItems: MeetingTaskItem[],
): string[] => {
  if (!meeting) return [];
  const previous = new Map(meetingTaskItems(meeting, tasks).map(item => [item.id, item.description]));
  return nextItems.filter(item => previous.get(item.id) === item.description).map(item => item.id);
};

export const shouldPreserveMeetingTaskDescriptions = (
  meeting: MeetingWithTaskItems | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description'>[],
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
  delete task.sourceMeetingItemId;
  task.statusLogs.unshift({ id: uid('log'), at, by: actorName, text: logText });
  return !wasClosed;
};

export const reconcileMeetingTasks = ({
  tasks,
  meetingId,
  vesselIds,
  followUp = '',
  followUps,
  priority,
  expectedDate,
  departments,
  initialStatus,
  actorId,
  actorName,
  at,
  preserveExistingDescriptions = false,
  preserveExistingDescriptionItemIds = [],
}: ReconcileMeetingTasksInput): ReconcileMeetingTasksResult => {
  const normalizedFollowUps = canonicalMeetingTaskItems(
    (followUps ?? [{ id: `${meetingId}-task-1`, description: followUp }])
      .map((item, index) => ({ id: item.id || `${meetingId}-task-${index + 1}`, description: item.description })),
    meetingId,
  );
  const targetVesselIds = Array.from(new Set(vesselIds));
  const legacyItemId = normalizedFollowUps[0]?.id || `${meetingId}-task-1`;
  const keyOf = (itemId: string, vesselId: string) => `${itemId}\u0000${vesselId}`;
  const targets = normalizedFollowUps.flatMap(item => targetVesselIds.map(vesselId => ({ item, vesselId, key: keyOf(item.id, vesselId) })));
  const targetKeys = new Set(targets.map(target => target.key));
  const grouped = new Map<string, TaskItem[]>();

  tasks.filter(task => task.sourceMeetingId === meetingId).forEach(task => {
    const itemId = task.sourceMeetingItemId || legacyItemId;
    const key = keyOf(itemId, task.vesselId);
    const group = grouped.get(key) || [];
    group.push(task);
    grouped.set(key, group);
  });

  const canonicalByKey = new Map<string, TaskItem>();
  const archivedIds: string[] = [];
  grouped.forEach((group, key) => {
    if (!targetKeys.has(key)) {
      const reason = normalizedFollowUps.length ? '已取消（臨會/專題待辦事項或船舶範圍已移除）' : '已取消（臨會/專題待辦已清空）';
      group.forEach(task => {
        if (archiveLinkedTask(task, reason, actorId, actorName, at)) archivedIds.push(task.id);
      });
      return;
    }
    const canonical = group.find(task => !task.isClosed) || group[0];
    canonicalByKey.set(key, canonical);
    group.filter(task => task.id !== canonical.id).forEach(task => {
      if (archiveLinkedTask(task, '已取消（重複的臨會/專題待辦）', actorId, actorName, at)) archivedIds.push(task.id);
    });
  });

  const preserveItemIds = new Set(preserveExistingDescriptionItemIds);
  const created: TaskItem[] = [];
  const updatedIds: string[] = [];
  targets.forEach(({ item, vesselId, key }) => {
    const existingTask = canonicalByKey.get(key);
    if (existingTask) {
      Object.assign(existingTask, {
        sourceMeetingId: meetingId,
        sourceMeetingItemId: item.id,
        sourceType: 'temporary' as const,
        priority,
        category: '臨會/專題',
        categories: ['臨會/專題'],
        expectedDate,
        departments: [...departments],
        updatedBy: actorId,
        updatedAt: at,
      });
      if (!preserveExistingDescriptions && !preserveItemIds.has(item.id)) existingTask.description = item.description;
      updatedIds.push(existingTask.id);
      return;
    }

    const task: TaskItem = {
      id: uid('task'),
      sourceMeetingId: meetingId,
      sourceMeetingItemId: item.id,
      sourceType: 'temporary',
      vesselId,
      priority,
      isAware: true,
      isAbnormal: false,
      isInternalControl: false,
      category: '臨會/專題',
      categories: ['臨會/專題'],
      description: item.description,
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
  const seen = new Set<string>();
  return refs.flatMap(({ taskId, kind }) => {
    const key = `${kind} ${taskId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const task = taskById.get(taskId);
    return task ? [{ task, kind }] : [];
  });
};
