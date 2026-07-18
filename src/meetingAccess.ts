import type { MeetingVesselScopeMode, RolePermissions, TemporaryMeeting, UserAccount, Vessel } from './types';
import { hasPermission } from './permissions';

const scopeModeOf = (meeting: Pick<TemporaryMeeting, 'vesselScopeMode'>): MeetingVesselScopeMode => meeting.vesselScopeMode || 'vessels';

export const canEditTemporaryMeetings = (
  matrix: RolePermissions | undefined,
  user: Pick<UserAccount, 'role'> | null | undefined,
): boolean => hasPermission(matrix, user, 'manageMeetings') && hasPermission(matrix, user, 'viewAllVessels');

export const meetingAppliesToUser = (
  meeting: Pick<TemporaryMeeting, 'vesselScopeMode' | 'vesselTypeScopes' | 'vessels'>,
  visibleVessels: Pick<Vessel, 'id' | 'shipType'>[],
  canViewAllMeetings: boolean,
): boolean => {
  if (canViewAllMeetings) return true;
  const visibleIds = new Set(visibleVessels.map(vessel => vessel.id));
  const mode = scopeModeOf(meeting);
  if (mode === 'all') return visibleVessels.length > 0;
  if (mode === 'types') return visibleVessels.some(vessel => (meeting.vesselTypeScopes || []).includes(vessel.shipType));
  return meeting.vessels.some(id => visibleIds.has(id));
};
