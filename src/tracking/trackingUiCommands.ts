import type { AppData, InternalControlCase } from '../types';
import { canAccessAllVessels, hasPermission } from '../permissions';
import { updateInternalControlCase, type InternalControlTaskProjection } from '../internalControlData';
import { runTrackingCommand, type TrackingCommand, type TrackingContext, type TrackingVersion } from './trackingWorkflow';

/** UI continuation only: reuse the existing internal-control editor domain API.
 * No new storage protocol or second save queue; App submits one related delta. */
export type TrackingUiCommand = TrackingCommand | (Extract<TrackingCommand, {type:'create'}> & {
  importClosures: {id:string; date:string; outcome:'completed'|'cancelled'}[];
}) | {
  type: 'sync-edit';
  items: (TrackingVersion & { item: InternalControlCase; expectedCaseUpdatedAt: string; projection?: InternalControlTaskProjection })[];
};
export function runTrackingUiCommand(data: AppData, command: TrackingUiCommand, context: TrackingContext): AppData {
  if (command.type === 'create' && 'importClosures' in command) {
    const ids = new Set(command.items.map(i => i.id));
    if (new Set(command.importClosures.map(i => i.id)).size !== command.importClosures.length || command.importClosures.some(i => !ids.has(i.id))) throw new Error('tracking-import-closure-selection');
    let next = runTrackingCommand(data, { type:'create', items:command.items }, context);
    for (const closure of command.importClosures) next = runTrackingCommand(next, { type:'lifecycle', action:'close', date:closure.date, outcome:closure.outcome, targets:[{entry:'tracking', id:closure.id, expectedUpdatedAt:context.at}] }, context);
    return next;
  }
  if (command.type !== 'sync-edit') return runTrackingCommand(data, command, context);
  const next = structuredClone(data);
  const actor = next.users.find(user => user.id === context.actorId && user.isActive);
  if (!actor || actor.role === 'vessel' || !hasPermission(next.settings.rolePermissions, actor, 'editBusinessContent')) throw new Error('tracking-permission-denied');
  if (!command.items.length || command.items.length > 100 || new Set(command.items.map(value => value.id)).size !== command.items.length) throw new Error('tracking-selection-invalid');
  for (const value of command.items) {
    const source = next.trackingItems?.find(row => row.id === value.id);
    const vessel = source && next.vessels.find(row => row.id === source.vesselId && row.isActive);
    if (!source || source.updatedAt !== value.expectedUpdatedAt || source.linkState !== 'active' || source.linkedCaseId !== value.item.id || !vessel || !canAccessAllVessels(next.settings.rolePermissions, actor, [vessel])) throw new Error('tracking-sync-continuation-stale');
    const previous = next.internalControlCases.find(item => item.id === value.item.id);
    if (!previous || previous.trackingItemId !== source.id || previous.isClosed || value.item.vesselId !== source.vesselId || value.item.isClosed) throw new Error('tracking-sync-continuation-invalid');
    updateInternalControlCase(next, value.item, value.expectedCaseUpdatedAt, actor, context.at, value.projection);
  }
  return next;
}
