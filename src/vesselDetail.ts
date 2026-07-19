import type { TaskItem, TaskPriority } from './types';
import { taskHasVessel } from './taskVesselScope';

export type VesselTaskClosedMode = 'all' | 'open' | 'closed';
export type VesselTaskSort = 'priority' | 'due-asc' | 'updated-desc';

export interface VesselDetailTaskFilters {
  closedMode: VesselTaskClosedMode;
  priority: 'all' | TaskPriority;
  query: string;
  sort: VesselTaskSort;
}

const priorityRank: Record<TaskPriority, number> = { 急: 0, 高: 1, 中: 2, 低: 3 };
const compareDate = (left: string, right: string) => {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
};

export function selectVesselDetailTasks(tasks: TaskItem[], vesselId: string, filters: VesselDetailTaskFilters): TaskItem[] {
  const query = filters.query.trim().toLowerCase();
  return tasks.filter(task => {
    if (!taskHasVessel(task, vesselId)) return false;
    if (filters.closedMode === 'open' && task.isClosed) return false;
    if (filters.closedMode === 'closed' && !task.isClosed) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (!query) return true;
    return [task.description, task.status, task.expectedDate, ...(task.categories || []), ...(task.departments || [])]
      .join(' ').toLowerCase().includes(query);
  }).sort((left, right) => {
    if (filters.sort === 'due-asc') return compareDate(left.expectedDate, right.expectedDate) || priorityRank[left.priority] - priorityRank[right.priority];
    if (filters.sort === 'updated-desc') return right.updatedAt.localeCompare(left.updatedAt) || priorityRank[left.priority] - priorityRank[right.priority];
    return priorityRank[left.priority] - priorityRank[right.priority] || Number(left.isClosed) - Number(right.isClosed) || compareDate(left.expectedDate, right.expectedDate);
  });
}
