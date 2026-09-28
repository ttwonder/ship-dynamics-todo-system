import type { TrackingItem } from './trackingTypes';
import { appendTrackingEvent, type TrackingActor } from './trackingLifecycle';

export type TrackingDeletionAction = 'delete' | 'restore' | 'request-delete' | 'reject-delete';
export const isTrackingDeleted = (item: Pick<TrackingItem, 'deletion'>) => Boolean(item.deletion);
export const isTrackingDeletionPending = (item: Pick<TrackingItem, 'deletion' | 'deletionRequest'>) => !isTrackingDeleted(item) && item.deletionRequest?.status === 'pending';
export const trackingDeletionValue = (item: TrackingItem) => ({ deletion: item.deletion ? structuredClone(item.deletion) : null, deletionRequest: item.deletionRequest ? structuredClone(item.deletionRequest) : null });

/** Source-only mutation. Caller owns role/scope/version/lease checks and publication. */
export function applyTrackingDeletion(source: TrackingItem, action: TrackingDeletionAction, inputReason: string, actor: TrackingActor, at: string, operationId: string) {
  const reason = typeof inputReason === 'string' ? inputReason.trim() : '';
  if (!reason || reason.length > 500) throw new Error('tracking-deletion-reason-invalid');
  const before = trackingDeletionValue(source);
  if (action === 'delete') {
    if (isTrackingDeleted(source)) throw new Error('tracking-already-deleted');
    source.deletion = { at, byUserId: actor.id, reason };
    if (source.deletionRequest?.status === 'pending') source.deletionRequest = { ...source.deletionRequest, status: 'approved', reviewedAt: at, reviewedBy: actor.id, reviewReason: reason };
  } else if (action === 'restore') {
    if (!isTrackingDeleted(source)) throw new Error('tracking-not-deleted');
    delete source.deletion;
  } else if (action === 'request-delete') {
    if (isTrackingDeleted(source)) throw new Error('tracking-source-deleted');
    if (isTrackingDeletionPending(source)) throw new Error('tracking-deletion-already-pending');
    source.deletionRequest = { at, byUserId: actor.id, reason, status: 'pending' };
  } else if (action === 'reject-delete') {
    if (!isTrackingDeletionPending(source)) throw new Error('tracking-deletion-request-not-pending');
    source.deletionRequest = { ...source.deletionRequest!, status: 'rejected', reviewedAt: at, reviewedBy: actor.id, reviewReason: reason };
  } else throw new Error('tracking-deletion-action-invalid');
  return appendTrackingEvent(source, action, before, { ...trackingDeletionValue(source), reason }, actor, at, 'tracking', operationId);
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
/** Metadata transitions are source-only, canonical commands even through generic record patches. */
export function isCanonicalTrackingDeletionChange(before: TrackingItem, after: TrackingItem, actorId: string): boolean {
  const oldEvents = before.events || [], events = after.events || [], event = events[events.length - 1];
  const deletionAction = Boolean(event && ['delete', 'restore', 'request-delete', 'reject-delete'].includes(event.action));
  if (canonical(trackingDeletionValue(before)) === canonical(trackingDeletionValue(after)) && !(deletionAction && canonical(oldEvents) !== canonical(events))) return true;
  if (!event || !deletionAction || event.action === 'request-delete' || event.entry !== 'tracking' || event.byUserId !== actorId || !event.operationId || !Number.isFinite(Date.parse(event.at))) return false;
  const expected = structuredClone(before);
  try {
    applyTrackingDeletion(expected, event.action as TrackingDeletionAction, event.after.reason as string, { id: actorId, name: '' }, event.at, event.operationId);
    return canonical(expected) === canonical(after);
  } catch { return false; }
}
