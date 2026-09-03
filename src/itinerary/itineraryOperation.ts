import type { ItineraryPendingOperation } from './itineraryDraftStore';
import { createItineraryOperationId, type ItineraryDocument } from './itineraryTypes';

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function itineraryDocumentSignature(document: ItineraryDocument): string {
  return JSON.stringify(document);
}

function legacyEmptyAlternativeSignature(document: ItineraryDocument): string | null {
  if (document.alternativePlans.length) return null;
  const legacyDocument: Partial<ItineraryDocument> = { ...document };
  delete legacyDocument.alternativePlans;
  return JSON.stringify(legacyDocument);
}

export function pendingOperationForDocument(
  document: ItineraryDocument,
  current?: ItineraryPendingOperation | null,
  createId: () => string = createItineraryOperationId,
): ItineraryPendingOperation {
  const signature = itineraryDocumentSignature(document);
  if (current && OPERATION_ID.test(current.id)
      && (current.signature === signature || current.signature === legacyEmptyAlternativeSignature(document))) {
    return { id: current.id, signature };
  }
  return { id: createId(), signature };
}
