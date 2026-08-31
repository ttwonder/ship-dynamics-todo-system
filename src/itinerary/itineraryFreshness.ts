import type { ItineraryDocument } from './itineraryTypes';

export function selectLatestItineraryDocument(
  current: ItineraryDocument | null | undefined,
  incoming: ItineraryDocument | null | undefined,
): ItineraryDocument | null {
  if (!incoming) return current || null;
  if (!current || current.vesselId !== incoming.vesselId) return incoming;
  return incoming.revision > current.revision ? incoming : current;
}

export function mergeLatestItineraryDocuments(
  current: Readonly<Record<string, ItineraryDocument>>,
  incoming: Readonly<Record<string, ItineraryDocument | null>>,
): Record<string, ItineraryDocument> {
  const merged = { ...current };
  for (const [vesselId, document] of Object.entries(incoming)) {
    const latest = selectLatestItineraryDocument(current[vesselId], document);
    if (latest) merged[vesselId] = latest;
  }
  return merged;
}
