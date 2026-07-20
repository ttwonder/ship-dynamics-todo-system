import type { UserNotification } from './types';

export function unreadTaskUpdateCounts(notifications: UserNotification[], userId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const notice of notifications) {
    if (notice.userId !== userId || notice.readAt || !notice.taskId) continue;
    counts[notice.taskId] = 1;
  }
  return counts;
}
