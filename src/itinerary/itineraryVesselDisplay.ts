import type { VesselNameSource } from '../vesselDisplay';
import { dashboardVesselDisplayName } from '../vesselDisplay';
import type { ItineraryDocument } from './itineraryTypes';

export type ItineraryVesselNameSource = VesselNameSource & { id: string };

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
