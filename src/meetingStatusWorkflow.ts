import type { StatusLog, TemporaryMeeting } from './types';

type MeetingStatusState = Pick<TemporaryMeeting, 'latestStatus' | 'statusLogs'>;

export function addMeetingStatusRecord(
  meeting: MeetingStatusState,
  rawText: string,
  actorName: string,
  at: string,
  id: string,
): { latestStatus: string; statusLogs: StatusLog[] } | null {
  const text = rawText.trim();
  if (!text) return null;
  return {
    latestStatus: text,
    statusLogs: [{ id, at, by: actorName, text }, ...(meeting.statusLogs || [])],
  };
}
