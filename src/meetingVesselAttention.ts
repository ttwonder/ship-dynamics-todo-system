import type { TemporaryMeeting } from './types';

export type DashboardMeetingAlert = Pick<TemporaryMeeting, 'id' | 'subject' | 'status' | 'vesselScopeMode' | 'vessels' | 'isAbnormal'>;

export function meetingCreatesVesselAbnormalAlert(
  meeting: Pick<TemporaryMeeting, 'status' | 'vesselScopeMode' | 'vessels' | 'isAbnormal'>,
  vesselId: string,
): boolean {
  const scopeMode = meeting.vesselScopeMode || 'vessels';
  const status = meeting.status || '追蹤中';
  return meeting.isAbnormal === true
    && status !== '已完成'
    && scopeMode !== 'all'
    && meeting.vessels.includes(vesselId);
}

export function dashboardMeetingAlerts(
  meetings: TemporaryMeeting[],
  visibleVesselIds: string[],
  canReadContent: (meeting: TemporaryMeeting) => boolean,
): DashboardMeetingAlert[] {
  const visibleIds=new Set(visibleVesselIds.filter(Boolean));
  return meetings
    .filter(meeting=>[...visibleIds].some(vesselId=>meetingCreatesVesselAbnormalAlert(meeting,vesselId)))
    .map(meeting => ({
      id: meeting.id,
      subject: canReadContent(meeting) ? meeting.subject : '',
      status: meeting.status,
      vesselScopeMode: meeting.vesselScopeMode,
      vessels: meeting.vessels.filter(vesselId=>visibleIds.has(vesselId)),
      isAbnormal: meeting.isAbnormal,
    }));
}
