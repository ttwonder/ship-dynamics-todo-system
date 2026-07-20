export type QuickMorningMode = 'all' | 'types' | 'vessels';

export type QuickMorningVessel = {
  id: string;
  shipType: string;
};

export function resolveQuickMorningSelection(
  mode: QuickMorningMode,
  selectedTypes: string[],
  selectedVesselIds: string[],
  vessels: QuickMorningVessel[],
): string[] {
  const typeSet = new Set(selectedTypes);
  const vesselSet = new Set(selectedVesselIds);
  if (mode === 'all') return vessels.map(vessel => vessel.id);
  if (mode === 'types') return vessels.filter(vessel => typeSet.has(vessel.shipType)).map(vessel => vessel.id);
  return vessels.filter(vessel => vesselSet.has(vessel.id)).map(vessel => vessel.id);
}
