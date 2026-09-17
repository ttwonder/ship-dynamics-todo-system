import type { Vessel } from './types';
import reference from './data/vesselParticularsReference.json';

export interface VesselParticularDraft {
  yearLabel: string;
  tonnageLabel: string;
  particularsSuggested: boolean;
}
type ParticularVessel = Pick<Vessel, 'name' | 'shortName' | 'fullName' | 'yearLabel' | 'tonnageLabel'>;
const nameKey = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();

/** Exact Chinese/English aliases only; conflicting identities must be reviewed manually. */
export function vesselParticularReference(vessel: ParticularVessel | undefined) {
  if (!vessel) return undefined;
  const names = new Set([vessel.name, vessel.shortName, vessel.fullName].filter(Boolean).map(nameKey));
  const matches = reference.rows.filter(row => [row.chineseName, row.englishName].some(name => names.has(nameKey(name))));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Used only when opening an editor; never by normalization, saved data or exports. */
export function vesselParticularDraft(vessel?: ParticularVessel): VesselParticularDraft {
  const suggestion = vesselParticularReference(vessel);
  const missingYear = typeof vessel?.yearLabel !== 'string';
  const missingTonnage = typeof vessel?.tonnageLabel !== 'string';
  return {
    yearLabel: missingYear ? suggestion?.yearLabel || '' : vessel.yearLabel,
    tonnageLabel: missingTonnage ? suggestion?.tonnageLabel || '' : vessel.tonnageLabel,
    particularsSuggested: Boolean(suggestion && (missingYear || missingTonnage)),
  };
}
