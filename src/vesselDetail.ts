import type { TaskItem, TaskPriority } from './types';
import { appearsInSingleVesselTasks } from './taskAttention';
import { taskHasVessel } from './taskVesselScope';
import { taskIsClosedForVessel, taskProgressForVessel } from './taskVesselProgress';

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
    if (!appearsInSingleVesselTasks(task)) return false;
    if (!taskHasVessel(task, vesselId)) return false;
    const progress=taskProgressForVessel(task,vesselId);
    if (filters.closedMode === 'open' && progress.isClosed) return false;
    if (filters.closedMode === 'closed' && !progress.isClosed) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (!query) return true;
    return [task.description, progress.status, task.expectedDate, ...(task.categories || []), ...(task.departments || [])]
      .join(' ').toLowerCase().includes(query);
  }).sort((left, right) => {
    if (filters.sort === 'due-asc') return compareDate(left.expectedDate, right.expectedDate) || priorityRank[left.priority] - priorityRank[right.priority];
    if (filters.sort === 'updated-desc') return right.updatedAt.localeCompare(left.updatedAt) || priorityRank[left.priority] - priorityRank[right.priority];
    return priorityRank[left.priority] - priorityRank[right.priority] || Number(taskIsClosedForVessel(left,vesselId)) - Number(taskIsClosedForVessel(right,vesselId)) || compareDate(left.expectedDate, right.expectedDate);
  });
}
