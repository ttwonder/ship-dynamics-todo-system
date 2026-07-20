import { vesselDisplayName } from './vesselDisplay';

export type MeetingPdfScope = {
  vesselScopeMode?: 'all' | 'types' | 'vessels';
  vesselTypeScopes?: string[];
  vessels: string[];
};

export type MeetingPdfVessel = {
  id: string;
  name?: string;
  shortName?: string;
  fullName?: string;
  shipType?: string;
};

export function meetingPdfVesselSummary(meeting: MeetingPdfScope, vessels: MeetingPdfVessel[]): string {
  if (meeting.vesselScopeMode === 'all') return '全部船舶';
  if (meeting.vesselScopeMode === 'types') {
    const types = Array.from(new Set((meeting.vesselTypeScopes || []).map(value => value.trim()).filter(Boolean)));
    return `船舶類型：${types.join('、') || '未指定'}`;
  }
  const byId = new Map(vessels.map(vessel => [vessel.id, vessel]));
  const names = Array.from(new Set(meeting.vessels.map(id => vesselDisplayName(byId.get(id))).filter(Boolean)));
  return names.join('、') || '未指定船舶';
}
