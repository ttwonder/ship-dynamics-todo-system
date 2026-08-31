import type { ItineraryPendingOperation } from './itineraryDraftStore';
import { createItineraryOperationId, type ItineraryDocument } from './itineraryTypes';

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function itineraryDocumentSignature(document: ItineraryDocument): string {
  return JSON.stringify(document);
}

export function pendingOperationForDocument(
  document: ItineraryDocument,
  current?: ItineraryPendingOperation | null,
  createId: () => string = createItineraryOperationId,
): ItineraryPendingOperation {
  const signature = itineraryDocumentSignature(document);
  return current?.signature === signature && OPERATION_ID.test(current.id) ? current : { id: createId(), signature };
}
