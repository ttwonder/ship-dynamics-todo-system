import type { MeetingTaskItem, MeetingVesselScopeMode, NotificationKind, TaskItem, TaskPriority, TemporaryMeeting } from './types';
import { uid } from './utils';
import { reconcileTaskVesselScope } from './taskVesselProgress';
import { normalizeMeetingTaskCategoryList } from './taskCategories';

interface ReconcileMeetingTasksInput {
  tasks: TaskItem[];
  meetingId: string;
  vesselIds: string[];
  vesselScopeMode?: MeetingVesselScopeMode;
  vesselTypeScopes?: string[];
  followUp?: string;
  followUps?: MeetingTaskItem[];
  priority: TaskPriority;
  expectedDate: string;
  departments: string[];
  ownerUserIds?: string[];
  meetingTaskCategories?: string[];
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

export function resolveMeetingTaskItemIdForDeletion(
  task: Pick<TaskItem, 'sourceMeetingItemId'>,
  meeting: Pick<TemporaryMeeting, 'taskItems'>,
): string | null | undefined {
  if (!meeting.taskItems.length) return undefined;
  if (task.sourceMeetingItemId && meeting.taskItems.some(item => item.id === task.sourceMeetingItemId)) return task.sourceMeetingItemId;
  if (meeting.taskItems.length === 1) return meeting.taskItems[0].id;
  return null;
}

export type MeetingTaskNotificationKind = Extract<NotificationKind, 'task_created' | 'task_updated' | 'task_archived'>;
export interface MeetingTaskNotificationEvent {
  task: TaskItem;
  kind: MeetingTaskNotificationKind;
}

type MeetingWithTaskItems = { id: string; taskDescription?: unknown; taskItems?: unknown };

export const canonicalMeetingTaskItems = (items: MeetingTaskItem[], meetingId: string, meetingTaskCategories?: string[]): MeetingTaskItem[] => {
  const seen = new Set<string>();
  return items.map((item, index) => {
    const rawId = item.id || `${meetingId}-task-${index + 1}`;
    const id = seen.has(rawId) ? `${rawId}-duplicate-${index + 1}` : rawId;
    seen.add(id);
    return { id, description: item.description.trim(), categories: normalizeMeetingTaskCategoryList(item.categories, meetingTaskCategories), distributeToVessels: item.distributeToVessels === true };
  }).filter(item => item.id && item.description);
};

export const meetingTaskItems = (
  meeting: MeetingWithTaskItems,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[] = [],
): MeetingTaskItem[] => {
  if (Object.prototype.hasOwnProperty.call(meeting, 'taskItems')) {
    if (!Array.isArray(meeting.taskItems)) return [];
    return canonicalMeetingTaskItems(meeting.taskItems.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { id?: unknown; description?: unknown; categories?: unknown; distributeToVessels?: unknown };
      const id = typeof item.id === 'string' && item.id ? item.id : `${meeting.id}-task-${index + 1}`;
      return [{ id, description: typeof item.description === 'string' ? item.description : '', categories: normalizeMeetingTaskCategoryList(item.categories), distributeToVessels: item.distributeToVessels === true }];
    }), meeting.id);
  }
  const hasSavedDescription = Object.prototype.hasOwnProperty.call(meeting, 'taskDescription');
  const savedDescription = typeof meeting.taskDescription === 'string' ? meeting.taskDescription : '';
  if (hasSavedDescription) return savedDescription.trim() ? [{ id: `${meeting.id}-task-1`, description: savedDescription, categories: normalizeMeetingTaskCategoryList([]), distributeToVessels: false }] : [];
  const linkedTask = tasks.find(task => task.sourceMeetingId === meeting.id && task.description.trim());
  return linkedTask ? [{ id: linkedTask.sourceMeetingItemId || `${meeting.id}-task-1`, description: linkedTask.description, categories: normalizeMeetingTaskCategoryList(linkedTask.categories), distributeToVessels: linkedTask.distributeToVessels === true }] : [];
};

export const meetingTaskDescription = (
  meeting: MeetingWithTaskItems,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[] = [],
): string => meetingTaskItems(meeting, tasks)[0]?.description || '';

export const unchangedMeetingTaskItemIds = (
  meeting: MeetingWithTaskItems | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[],
  nextItems: MeetingTaskItem[],
): string[] => {
  if (!meeting) return [];
  const previous = new Map(meetingTaskItems(meeting, tasks).map(item => [item.id, item.description]));
  return nextItems.filter(item => previous.get(item.id) === item.description).map(item => item.id);
};

export const shouldPreserveMeetingTaskDescriptions = (
  meeting: MeetingWithTaskItems | null | undefined,
  tasks: Pick<TaskItem, 'sourceMeetingId' | 'sourceMeetingItemId' | 'description' | 'categories' | 'distributeToVessels'>[],
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
  vesselScopeMode = 'vessels',
  vesselTypeScopes = [],
  followUp = '',
  followUps,
  priority,
  expectedDate,
  departments,
  ownerUserIds = [],
  meetingTaskCategories = [],
  initialStatus,
  actorId,
  actorName,
  at,
  preserveExistingDescriptions = false,
  preserveExistingDescriptionItemIds = [],
}: ReconcileMeetingTasksInput): ReconcileMeetingTasksResult => {
  const normalizedFollowUps = canonicalMeetingTaskItems(
    (followUps ?? [{ id: `${meetingId}-task-1`, description: followUp, categories: normalizeMeetingTaskCategoryList([], meetingTaskCategories) }])
      .map((item, index) => ({ id: item.id || `${meetingId}-task-${index + 1}`, description: item.description, categories: normalizeMeetingTaskCategoryList(item.categories, meetingTaskCategories), distributeToVessels: item.distributeToVessels === true })),
    meetingId,
    meetingTaskCategories,
  );
  const targetVesselIds = Array.from(new Set(vesselIds.filter(Boolean)));
  const normalizedTypeScopes = vesselScopeMode === 'types' ? Array.from(new Set(vesselTypeScopes.filter(Boolean))) : [];
  const legacyItemId = normalizedFollowUps[0]?.id || `${meetingId}-task-1`;
  const targetItemIds = new Set(normalizedFollowUps.map(item => item.id));
  const grouped = new Map<string, TaskItem[]>();

  tasks.filter(task => task.sourceMeetingId === meetingId).forEach(task => {
    const itemId = task.sourceMeetingItemId || legacyItemId;
    const group = grouped.get(itemId) || [];
    group.push(task);
    grouped.set(itemId, group);
  });

  const archivedIds: string[] = [];
  if (!targetVesselIds.length) {
    grouped.forEach(group => group.forEach(task => {
      if (archiveLinkedTask(task, '已取消（臨會/專題未指定涉會船舶）', actorId, actorName, at)) archivedIds.push(task.id);
    }));
    return { created: [], updatedIds: [], archivedIds };
  }

  const canonicalByItemId = new Map<string, TaskItem>();
  grouped.forEach((group, itemId) => {
    if (!targetItemIds.has(itemId)) {
      const reason = normalizedFollowUps.length ? '已取消（臨會/專題待辦事項已移除）' : '已取消（臨會/專題待辦已清空）';
      group.forEach(task => {
        if (archiveLinkedTask(task, reason, actorId, actorName, at)) archivedIds.push(task.id);
      });
      return;
    }
    const orderedGroup = [...group].sort((left,right) =>
      Number(left.isClosed)-Number(right.isClosed)
      || (Date.parse(right.updatedAt||right.createdAt||'')||0)-(Date.parse(left.updatedAt||left.createdAt||'')||0)
      || left.id.localeCompare(right.id)
    );
    const canonical = orderedGroup[0];
    reconcileTaskVesselScope(canonical,targetVesselIds,orderedGroup);
    canonicalByItemId.set(itemId, canonical);
    orderedGroup.slice(1).forEach(task => {
      if (archiveLinkedTask(task, '已取消（舊版逐船重複待辦已合併）', actorId, actorName, at)) archivedIds.push(task.id);
    });
  });

  const preserveItemIds = new Set(preserveExistingDescriptionItemIds);
  const created: TaskItem[] = [];
  const updatedIds: string[] = [];
  normalizedFollowUps.forEach(item => {
    const existingTask = canonicalByItemId.get(item.id);
    if (existingTask) {
      Object.assign(existingTask, {
        sourceMeetingId: meetingId,
        sourceMeetingItemId: item.id,
        distributeToVessels: item.distributeToVessels === true,
        sourceType: 'temporary' as const,
        vesselId: targetVesselIds[0],
        vesselIds: [...targetVesselIds],
        vesselScopeMode,
        vesselTypeScopes: [...normalizedTypeScopes],
        priority,
        attentionDimension: 'meeting' as const,
        category: item.categories[0] || '',
        categories: [...item.categories],
        expectedDate,
        departments: [...departments],
        ownerUserIds: [...ownerUserIds],
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
      distributeToVessels: item.distributeToVessels === true,
      sourceType: 'temporary',
      vesselId: targetVesselIds[0],
      vesselIds: [...targetVesselIds],
      vesselScopeMode,
      vesselTypeScopes: [...normalizedTypeScopes],
      priority,
      attentionDimension: 'meeting',
      isAware: true,
      isAbnormal: false,
      isInternalControl: false,
      category: item.categories[0] || '',
      categories: [...item.categories],
      description: item.description,
      status: initialStatus.trim() || '待執行',
      expectedDate,
      departments: [...departments],
      ownerUserIds: [...ownerUserIds],
      isClosed: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: at,
      updatedAt: at,
      statusLogs: [{ id: uid('log'), at, by: actorName, text: initialStatus.trim() || '建立臨會/專題待辦' }],
      vesselProgress: [],
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
