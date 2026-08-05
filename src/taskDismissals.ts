import type { AppData, TaskDismissal, TaskItem } from './types';

export type DismissibleWorkCenterData = Pick<AppData, 'taskDismissals' | 'tasks' | 'internalControlCases'>;
export type DismissedItemKind = TaskDismissal['itemKind'];

export interface DismissWorkCenterInput {
  userId: string;
  taskIds?: string[];
  internalControlCaseIds?: string[];
  at?: string;
}

export function workCenterDismissalId(userId: string, itemKind: DismissedItemKind, itemId: string) {
  return `work-dismissal:${encodeURIComponent(userId)}:${itemKind}:${encodeURIComponent(itemId)}`;
}

export function isWorkCenterItemDismissed(
  data: Pick<DismissibleWorkCenterData, 'taskDismissals'>,
  userId: string,
  itemKind: DismissedItemKind,
  itemId: string,
): boolean {
  return data.taskDismissals.some(item => item.userId === userId && item.itemKind === itemKind && item.itemId === itemId);
}

export function dismissWorkCenterItems<T extends DismissibleWorkCenterData>(data: T, input: DismissWorkCenterInput): T {
  const at = input.at || new Date().toISOString();
  if (Number.isNaN(new Date(at).getTime())) throw new Error('無效的個人移除時間');
  const existingTaskIds = new Set(data.tasks.map(task => task.id));
  const existingCaseIds = new Set(data.internalControlCases.map(item => item.id));
  const items: Array<{ itemKind: DismissedItemKind; itemId: string }> = [
    ...Array.from(new Set(input.taskIds || [])).filter(id => existingTaskIds.has(id)).map(itemId => ({ itemKind: 'task' as const, itemId })),
    ...Array.from(new Set(input.internalControlCaseIds || [])).filter(id => existingCaseIds.has(id)).map(itemId => ({ itemKind: 'internal-control' as const, itemId })),
  ];
  const additions: TaskDismissal[] = items
    .filter(item => !isWorkCenterItemDismissed(data, input.userId, item.itemKind, item.itemId))
    .map(item => ({
      id: workCenterDismissalId(input.userId, item.itemKind, item.itemId),
      userId: input.userId,
      itemKind: item.itemKind,
      itemId: item.itemId,
      dismissedAt: at,
      dismissedBy: input.userId,
    }));
  if (!additions.length) return data;
  return { ...data, taskDismissals: [...additions, ...data.taskDismissals] };
}

export function clearDismissalsForNewTaskAssignments(
  dismissals: TaskDismissal[],
  previous: Pick<TaskItem, 'id' | 'ownerUserIds'> | undefined,
  next: Pick<TaskItem, 'id' | 'ownerUserIds'>,
  previousAssignedUserIds: string[] = previous?.ownerUserIds || [],
  nextAssignedUserIds: string[] = next.ownerUserIds,
): TaskDismissal[] {
  if (!previous) return dismissals;
  const previousOwners = new Set(previousAssignedUserIds);
  const newlyAssigned = new Set(nextAssignedUserIds.filter(id => !previousOwners.has(id)));
  if (!newlyAssigned.size) return dismissals;
  return dismissals.filter(item => !(item.itemKind === 'task' && item.itemId === next.id && newlyAssigned.has(item.userId)));
}
