import type { VesselNameSource } from '../vesselDisplay';
import { dashboardVesselDisplayName } from '../vesselDisplay';
import type { ItineraryDocument } from './itineraryTypes';

export type ItineraryVesselNameSource = VesselNameSource & { id: string };

const englishVesselNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function shipItineraryVesselEnglishName(vessel: ItineraryVesselNameSource): string {
  return vessel.fullName?.trim() || vessel.shortName?.trim() || vessel.name?.trim() || vessel.id;
}

export function shipItineraryVesselOptionName(vessel: ItineraryVesselNameSource): string {
  const englishName = shipItineraryVesselEnglishName(vessel);
  const chineseName = vessel.name?.trim() || '';
  const shortName = vessel.shortName?.trim() || '';
  const fullName = vessel.fullName?.trim() || '';
  const duplicatesKnownName = [englishName, shortName, fullName]
    .filter(Boolean)
    .some(name => englishVesselNameCollator.compare(chineseName, name) === 0);
  return !chineseName || duplicatesKnownName ? englishName : `${englishName} ${chineseName}`;
}

export function sortShipItineraryVesselsByEnglishName<T extends ItineraryVesselNameSource>(vessels: readonly T[]): T[] {
  return [...vessels].sort((left, right) => {
    const englishOrder = englishVesselNameCollator.compare(shipItineraryVesselEnglishName(left), shipItineraryVesselEnglishName(right));
    if (englishOrder) return englishOrder;
    const optionOrder = englishVesselNameCollator.compare(shipItineraryVesselOptionName(left), shipItineraryVesselOptionName(right));
    return optionOrder || englishVesselNameCollator.compare(left.id, right.id);
  });
}

export function itineraryVesselDisplayName(vessel: ItineraryVesselNameSource): string {
  return dashboardVesselDisplayName(vessel);
}

export function withItineraryVesselDisplayName(
  document: ItineraryDocument,
  vessel: ItineraryVesselNameSource,
): ItineraryDocument {
  const vesselName = itineraryVesselDisplayName(vessel);
  return document.vesselName === vesselName ? document : { ...document, vesselName };
}

export function resolveItineraryEditorDocument(
  cloudDocument: ItineraryDocument | null,
  displayedDocument: ItineraryDocument | undefined,
  vessel: ItineraryVesselNameSource,
): ItineraryDocument | null {
  const document = cloudDocument || displayedDocument;
  return document ? withItineraryVesselDisplayName(document, vessel) : null;
}

export function projectItineraryDocumentsForDisplay(
  documents: Readonly<Record<string, ItineraryDocument>>,
  vessels: readonly ItineraryVesselNameSource[],
): Record<string, ItineraryDocument> {
  const projected = { ...documents };
  for (const vessel of vessels) {
    const document = documents[vessel.id];
    if (document) projected[vessel.id] = withItineraryVesselDisplayName(document, vessel);
  }
  return projected;
}
