import type { AppData } from '../types';
import type { CloudBlockPatchOperation } from '../cloudBlockPatch';
import { resolveTrackingGroup } from './trackingLifecycle';
import type { TrackingItem } from './trackingTypes';
import { TRACKING_EDIT_FIELDS } from './trackingWorkflow';
import { reclassifyTrackingDescription, trackingClassificationValue } from './trackingReclassification';
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const eq=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const only=(a:Record<string,unknown>,b:Record<string,unknown>,fields:string[])=>[...new Set([...Object.keys(a),...Object.keys(b)])].every(k=>fields.includes(k)||eq(a[k],b[k]));
/** A narrow exception for source-authored progress, not generic status or closure. */
export function trackingProgressEndpointKeys(data:AppData,ops:readonly CloudBlockPatchOperation[],actorId:string):Set<string> {
 const keys=new Set<string>();
 const entities=ops.filter((o):o is Extract<CloudBlockPatchOperation,{kind:'entity'}>=>o.kind==='entity');
 for(const op of entities){
  if(op.collection!=='trackingItems'||!op.expected||!op.value)continue;
  const a=op.expected,b=op.value;
  // A classification edit can also carry one source-authored progress log.
  // Admit only its exact linked label/history delta, not arbitrary endpoint edits.
  const events=Array.isArray(b.events)?b.events:[],oldEvents=Array.isArray(a.events)?a.events:[],event=events[events.length-1];
  if(!a.isClosed&&!b.isClosed&&event?.action==='reclassify'&&event.byUserId===actorId&&event.at===b.updatedAt&&b.updatedBy===actorId
   &&event.entry==='tracking'&&event.id===`${event.operationId}:${op.entityId}:reclassify`
   &&events.length>oldEvents.length&&eq(events.slice(0,oldEvents.length),oldEvents)
   &&eq(event.before,trackingClassificationValue(a as unknown as TrackingItem))&&eq(event.after,trackingClassificationValue(b as unknown as TrackingItem))
   &&only(a,b,a.kind!==b.kind?['kind','requestType',b.kind==='supply'?'actualDeliveryDate':'completionDate',...(b.kind==='supply'?['deliveryStatus']:[]),'events','updatedAt','updatedBy']:[...TRACKING_EDIT_FIELDS,'deliveryStatus','events','statusLogs','updatedAt','updatedBy'])){
   const group=resolveTrackingGroup(data,op.entityId),changedProgress=a.progress!==b.progress;
   const old=Array.isArray(a.statusLogs)?a.statusLogs:[],logs=Array.isArray(b.statusLogs)?b.statusLogs:[];
   const progressValid=changedProgress?logs.length===old.length+1&&eq(logs.slice(1),old)&&logs[0]?.text===b.progress&&logs[0]?.byUserId===actorId:eq(logs,old);
   const valid=(collection:'internalControlCases'|'tasks',endpoint:typeof group.item|typeof group.task)=>{
    if(!endpoint)return true;
    const update=entities.find(o=>o.collection===collection&&o.entityId===endpoint.id),x=update?.expected,y=update?.value;
    return !!x&&!!y&&!x.isClosed&&!y.isClosed&&eq(x,endpoint)
     &&only(x,y,['description','trackingLifecycle','updatedAt','updatedBy',...(changedProgress?['status','statusLogs']:[])])
     &&y.description===reclassifyTrackingDescription(String(x.description),a as unknown as TrackingItem,b as unknown as TrackingItem)
     &&eq(y.trackingLifecycle,[...(Array.isArray(x.trackingLifecycle)?x.trackingLifecycle:[]),event])
     &&y.updatedAt===b.updatedAt&&y.updatedBy===actorId
     &&(!changedProgress||y.status===b.progress&&eq(y.statusLogs,[logs[0],...group.item!.statusLogs]));
   };
   if(group.item&&progressValid&&valid('internalControlCases',group.item)&&valid('tasks',group.task)){
    keys.add(`internalControlCases:${group.item.id}`);if(group.task)keys.add(`tasks:${group.task.id}`);continue;
   }
  }
  if(a.isClosed||b.isClosed||a.progress===b.progress||!only(a,b,['progress','statusLogs','updatedAt','updatedBy'])||b.updatedBy!==actorId)continue;
  const old=Array.isArray(a.statusLogs)?a.statusLogs:[],logs=Array.isArray(b.statusLogs)?b.statusLogs:[];
  if(logs.length!==old.length+1||!eq(logs.slice(1),old)||logs[0]?.text!==b.progress||logs[0]?.byUserId!==actorId)continue;
  const group=resolveTrackingGroup(data,op.entityId);if(!group.item)continue;
  const caseOp=entities.find(o=>o.collection==='internalControlCases'&&o.entityId===group.item!.id);
  const taskOp=group.task?entities.find(o=>o.collection==='tasks'&&o.entityId===group.task!.id):undefined;
  const valid=(o:typeof caseOp,history:unknown[])=>!!o?.expected&&!!o.value&&!o.expected.isClosed&&!o.value.isClosed
   &&only(o.expected,o.value,['status','statusLogs','updatedAt','updatedBy'])&&o.value.status===b.progress
   &&eq(o.value.statusLogs,[logs[0],...history])&&o.value.updatedBy===actorId;
  if(!valid(caseOp,group.item.statusLogs)||(group.task&&!valid(taskOp,group.item.statusLogs)))continue;
  keys.add(`internalControlCases:${group.item.id}`);if(group.task)keys.add(`tasks:${group.task.id}`);
 }
 return keys;
}
