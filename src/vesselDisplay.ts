export type VesselNameSource = { id?: string; name?: string; shortName?: string; fullName?: string };

export function vesselDisplayName(vessel?: VesselNameSource | null): string {
  return vessel?.fullName?.trim() || vessel?.name?.trim() || vessel?.shortName?.trim() || vessel?.id || '未明船舶';
}
