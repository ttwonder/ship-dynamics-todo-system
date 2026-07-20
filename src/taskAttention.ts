import type { TaskItem, TaskPriority } from './types';

type AttentionTaggedTask = Pick<TaskItem, 'sourceType' | 'sourceMeetingId' | 'attentionDimension' | 'distributeToVessels'>;

export function isMeetingAttentionTask(task: AttentionTaggedTask): boolean {
  return task.attentionDimension === 'meeting' || Boolean(task.sourceMeetingId) || task.sourceType === 'temporary';
}

export function isVesselDelegatedMeetingTask(task: AttentionTaggedTask): boolean {
  return isMeetingAttentionTask(task) && task.distributeToVessels === true;
}

export function appearsInSingleVesselTasks(task: AttentionTaggedTask): boolean {
  return !isMeetingAttentionTask(task) || isVesselDelegatedMeetingTask(task);
}

export const contributesToVesselAttention = (task: AttentionTaggedTask): boolean => !isMeetingAttentionTask(task);

export function vesselAttentionTasks<T extends AttentionTaggedTask>(tasks: T[]): T[] {
  return tasks.filter(contributesToVesselAttention);
}

export function canonicalTaskAttentionForSave<T extends TaskItem>(
  candidate: T,
  previous: Pick<TaskItem, 'sourceType' | 'sourceMeetingId' | 'attentionDimension' | 'priority'>,
  meetingPriority?: TaskPriority,
): T {
  if (isMeetingAttentionTask(previous)) {
    return { ...candidate, attentionDimension: 'meeting', priority: meetingPriority || previous.priority };
  }
  return { ...candidate, attentionDimension: 'task' };
}
