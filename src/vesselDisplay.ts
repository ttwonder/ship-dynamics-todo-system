export type VesselNameSource = { id?: string; name?: string; shortName?: string; fullName?: string };

export function vesselDisplayName(vessel?: VesselNameSource | null): string {
  return vessel?.fullName?.trim() || vessel?.name?.trim() || vessel?.shortName?.trim() || vessel?.id || '未明船舶';
}

export function dashboardVesselDisplayName(vessel?: VesselNameSource | null): string {
  const displayName = vesselDisplayName(vessel);
  const chineseName = vessel?.name?.trim() || '';
  const fullName = vessel?.fullName?.trim() || '';
  const shortName = vessel?.shortName?.trim() || '';
  if (!chineseName || chineseName === displayName || chineseName === fullName || chineseName === shortName) return displayName;
  return `${chineseName} ${displayName}`;
}
