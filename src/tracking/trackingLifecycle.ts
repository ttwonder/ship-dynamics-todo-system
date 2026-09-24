import type { AppData, InternalControlCase, UserAccount } from '../types';
import type { TrackingEvent, TrackingItem } from './trackingTypes';
import { isValidInternalControlDate } from '../internalControlWorkflow';

export type TrackingGraph = Pick<AppData, 'tasks' | 'internalControlCases' | 'trackingItems'>;
export type TrackingActor = Pick<UserAccount, 'id' | 'name'>;
export type TrackingEntry = TrackingEvent['entry'];
export type TrackingLifecycleAction = 'close' | 'reopen' | 'correct-close-date';
export const closureValue = (item: {isClosed:boolean;closedDate?:string;closedBy?:string}) => ({isClosed:item.isClosed,closedDate:item.closedDate || '',closedBy:item.closedBy || ''});

export function sourceForCase(data: TrackingGraph, item: InternalControlCase): TrackingItem | undefined {
  const sources=(data.trackingItems || []).filter(s=>s.linkState==='active'&&s.linkedCaseId===item.id);
  if(item.trackingLinkState==='invalid'&&!sources.length)return undefined;
  if(!sources.length&&!item.trackingItemId)return undefined;
  if(sources.length!==1||sources[0].id!==item.trackingItemId||sources[0].vesselId!==item.vesselId)throw new Error('tracking-link-inconsistent');
  return sources[0];
}

/** Exact reciprocal group only; never infer membership from a reference number. */
export function resolveTrackingGroup(data: TrackingGraph, sourceId: string) {
  const sources=(data.trackingItems || []).filter(s=>s.id===sourceId);
  if(sources.length!==1)throw new Error('tracking-source-missing');
  const source=sources[0];
  if(source.linkState!=='active')return {source, item:undefined, task:undefined};
  const cases=data.internalControlCases.filter(c=>c.id===source.linkedCaseId);
  if(cases.length!==1||sourceForCase(data,cases[0])!==source)throw new Error('tracking-link-inconsistent');
  const item=cases[0];
  const claims=data.tasks.filter(t=>t.internalControlCaseId===item.id||t.id===item.linkedTaskId);
  if(!item.syncToTask&&!item.linkedTaskId&&!claims.length)return {source,item,task:undefined};
  if(claims.length!==1||!item.syncToTask||claims[0].id!==item.linkedTaskId||claims[0].internalControlCaseId!==item.id||!claims[0].isInternalControl||claims[0].sourceMeetingId||claims[0].vesselId!==source.vesselId)throw new Error('tracking-task-link-inconsistent');
  return {source,item,task:claims[0]};
}

export function appendTrackingEvent(source:TrackingItem, action:TrackingEvent['action'], before:Record<string,unknown>, after:Record<string,unknown>, actor:TrackingActor, at:string, entry:TrackingEntry, operationId:string) {
  const event:TrackingEvent={id:`${operationId}:${source.id}:${action}`,operationId,action,before,after,byUserId:actor.id,at,entry};
  source.events=[...(source.events || []),event];
  source.updatedBy=actor.id;source.updatedAt=at;
  return event;
}

export function validateTrackingClosureDate(source:TrackingItem, date:string, reportDate?:string) {
  if(!isValidInternalControlDate(date)||date<source.applicationDate||(reportDate&&date<reportDate))throw new Error('tracking-invalid-close-date');
}

/** Mounted case/task saves call this before publishing their existing projections. */
export function convergeTrackingCaseLifecycle(data:TrackingGraph, previous:InternalControlCase, saved:InternalControlCase, actor:TrackingActor, at:string, entry:TrackingEntry='internal-control') {
  const source=sourceForCase(data,previous);
  if(!source)return;
  if(saved.trackingItemId!==previous.trackingItemId||saved.vesselId!==previous.vesselId)throw new Error('tracking-link-immutable');
  if(source.isClosed!==previous.isClosed||(source.isClosed&&source.closedDate!==previous.closedDate))throw new Error('tracking-lifecycle-inconsistent');
  if(previous.isClosed===saved.isClosed&&previous.closedDate===saved.closedDate)return;
  if(saved.isClosed)validateTrackingClosureDate(source,saved.closedDate || '',saved.reportDate);
  const before=closureValue(source);
  const action:TrackingLifecycleAction=!saved.isClosed?'reopen':previous.isClosed?'correct-close-date':'close';
  source.isClosed=saved.isClosed;
  if(saved.isClosed){source.closedDate=saved.closedDate;source.closedBy=saved.closedBy;}
  else {delete source.closedDate;delete source.closedBy;}
  const event=appendTrackingEvent(source,action,before,closureValue(source),actor,at,entry,`${entry}:${saved.id}:${at}`);
  saved.trackingLifecycle=[...(previous.trackingLifecycle || []),event];
}

export function invalidateTrackingCase(data:TrackingGraph, item:InternalControlCase, actor:TrackingActor, at:string) {
  const source=sourceForCase(data,item);if(!source)return;
  appendTrackingEvent(source,'invalidate-link',{caseId:item.id,taskId:item.linkedTaskId || '',linkState:'active'},{linkState:'invalid'},actor,at,'internal-control',`unlink:${item.id}:${at}`);
  source.linkState='invalid'; // retain former ID and the immutable relationship history
  item.trackingLinkState='invalid';
}
