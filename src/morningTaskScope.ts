import type { TaskItem, TemporaryMeeting } from './types';

type MorningTask = Pick<TaskItem, 'sourceType' | 'sourceMeetingId'>;
type MorningMeeting = Pick<TemporaryMeeting, 'id' | 'includeInMorning'>;

export function isTaskIncludedInMorning(task: MorningTask, meetings: MorningMeeting[]): boolean {
  if (!task.sourceMeetingId && task.sourceType !== 'temporary') return true;
  if (!task.sourceMeetingId) return false;
  return meetings.find(meeting => meeting.id === task.sourceMeetingId)?.includeInMorning === true;
}

export function morningDiscussionTasks<T extends MorningTask>(tasks: T[], meetings: MorningMeeting[]): T[] {
  return tasks.filter(task => isTaskIncludedInMorning(task, meetings));
}
