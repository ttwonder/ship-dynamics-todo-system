import type { AppData, InternalControlCase, PermissionKey, UserAccount } from '../types';
import type { TrackingItem, TrackingDeliveryStatus } from './trackingTypes';
import { createInternalControlCases, type InternalControlTaskProjection } from '../internalControlData';
import { isValidInternalControlDate } from '../internalControlWorkflow';
import { hasPermission, canAccessAllVessels } from '../permissions';
import { appendTrackingEvent, closureValue, resolveTrackingGroup, sourceForCase, validateTrackingClosureDate, type TrackingEntry, type TrackingLifecycleAction } from './trackingLifecycle';

export interface TrackingContext {actorId:string;at:string;operationId:string}
export interface TrackingVersion {id:string;expectedUpdatedAt:string}
export const TRACKING_EDIT_FIELDS=['referenceNo','description','applicationDate','originalItemNo','subitemNo','urgency','urgentSubtypes','purchaseNos','materialCategory','preparationDate','supplier','estimatedSupplyDatePlace','countersignDate','contractor','constructionPort','completionDate','originalRemarks','supplementalNotes','expectedDate'] as const;
export type TrackingEdit = Partial<Pick<TrackingItem,typeof TRACKING_EDIT_FIELDS[number]>>;
export type TrackingCommand =
 | {type:'create';items:TrackingItem[]}
 | {type:'progress';items:(TrackingVersion & {text:string})[]}
 | {type:'edit';items:(TrackingVersion & {changes:TrackingEdit})[]}
 | {type:'delivery';items:(TrackingVersion & {status:TrackingDeliveryStatus;date:string})[]}
 | {type:'sync';items:(TrackingVersion & {item:InternalControlCase;projection?:InternalControlTaskProjection})[]}
 | {type:'lifecycle';action:TrackingLifecycleAction;date?:string;outcome?:'completed'|'cancelled';targets:(TrackingVersion & {entry:TrackingEntry})[]};

const fail=(message:string):never=>{throw new Error(message);};
const selection=(ids:string[])=>{if(!ids.length||ids.length>100||new Set(ids).size!==ids.length)fail('tracking-selection-invalid');};
function authorize(data:AppData,actor:UserAccount,vesselId:string,permission:PermissionKey) {
 if(actor.role==='vessel')fail('tracking-shore-only');
 if(!hasPermission(data.settings.rolePermissions,actor,permission))fail('tracking-permission-denied');
 const vessel=data.vessels.find(v=>v.id===vesselId&&v.isActive);
 if(!vessel||!canAccessAllVessels(data.settings.rolePermissions,actor,[vessel]))fail('tracking-vessel-denied');
}
export function validateTrackingItem(item:TrackingItem):void {
 if(!item.id||!item.vesselId||!['supply','engineering'].includes(item.kind)||!item.referenceNo?.trim()||!item.description?.trim())fail('tracking-required-fields');
 for(const field of ['applicationDate','expectedDate','preparationDate','countersignDate','completionDate','actualDeliveryDate'] as const){
  const value=item[field];if((field==='applicationDate'||value)&&!isValidInternalControlDate(value))fail(`tracking-invalid-date:${field}`);
 }
 if(!['normal','urgent'].includes(item.urgency)||!['not-delivered','partially-delivered','delivered'].includes(item.deliveryStatus))fail('tracking-invalid-enum');
 if(item.deliveryStatus==='delivered'&&!item.actualDeliveryDate)fail('tracking-delivery-date-required');
 if(item.isClosed)validateTrackingClosureDate(item,item.closedDate || '');
}
export function trackingBucket(item:TrackingItem) {
 if(item.kind==='engineering')return !item.isClosed?'engineering-open':item.closureOutcome==='cancelled'?'engineering-cancelled':'engineering-completed';
 return item.deliveryStatus==='delivered'?'delivered':item.isClosed?'supply-closed':'undelivered';
}
export function prefillTrackingCase(data:AppData,source:TrackingItem,id:string):{item:InternalControlCase;missingDepartments:string[]} {
 const requested=source.kind==='supply'?['資材組','督導']:['船工處','督導'];
 const description=source.kind==='supply'
  ? [source.referenceNo,source.purchaseNos,source.materialCategory,source.description,source.supplementalNotes]
  : [source.referenceNo,source.subitemNo,source.description,source.originalRemarks,source.supplementalNotes];
 return {missingDepartments:requested.filter(d=>!data.settings.departments.includes(d)),item:{
  id,vesselId:source.vesselId,trackingItemId:source.id,reportDate:source.applicationDate,expectedDate:source.expectedDate,
  reportSource:'日常',description:description.filter(Boolean).join('\n'),priority:source.urgency==='urgent'?'急':'低',category:'其他',isAware:false,
  status:source.progress || '待處理',departments:requested.filter(d=>data.settings.departments.includes(d)),syncToTask:false,origin:'internal-control',isClosed:false,
  createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',statusLogs:[],
 }};
}
/** Pure all-or-none planner. Persist the returned entire delta once with the existing
 * durable records coordinator, never save its source/case/task parts separately. */
export function runTrackingCommand(data:AppData,command:TrackingCommand,context:TrackingContext):AppData {
 if(!context.operationId||!Number.isFinite(Date.parse(context.at)))fail('tracking-context-invalid');
 const next=structuredClone(data),actor=next.users.find(u=>u.id===context.actorId&&u.isActive);
 if(!actor||actor.role==='vessel')fail('tracking-shore-only');
 const user=actor!;const {at,operationId}=context;
 next.trackingItems ||= [];
 const find=(id:string,version:string)=>{
  const group=resolveTrackingGroup(next,id);
  if(group.source.updatedAt!==version)fail('tracking-stale-source');
  return group;
 };
 if(command.type==='create'){
  selection(command.items.map(i=>i.id));
  for(const input of command.items){
   authorize(next,user,input.vesselId,'createTasks');
   if(next.trackingItems.some(i=>i.id===input.id))fail('tracking-id-exists');
   const item:TrackingItem={...structuredClone(input),urgency:input.urgency || 'normal',expectedDate:input.expectedDate || '',supplementalNotes:input.supplementalNotes || '',progress:input.progress || '',deliveryStatus:input.deliveryStatus || 'not-delivered',isClosed:false,createdBy:user.id,updatedBy:user.id,createdAt:at,updatedAt:at,statusLogs:[],events:[]};
   delete item.closedDate;delete item.closedBy;delete item.closureOutcome;delete item.linkedCaseId;delete item.linkState;
   if(item.progress)item.statusLogs=[{id:`${operationId}:${item.id}:initial`,at,by:user.name,byUserId:user.id,text:item.progress}];
   validateTrackingItem(item);next.trackingItems.push(item);
  }
 } else if(command.type==='lifecycle'){
  selection(command.targets.map(t=>`${t.entry}:${t.id}`));
  const seen=new Set<string>();
  for(const target of command.targets){
   const endpoint=target.entry==='tracking'?next.trackingItems.find(s=>s.id===target.id):target.entry==='internal-control'?next.internalControlCases.find(c=>c.id===target.id):next.tasks.find(t=>t.id===target.id);
   if(!endpoint||endpoint.updatedAt!==target.expectedUpdatedAt)fail('tracking-stale-endpoint');
   const item=target.entry==='internal-control'?next.internalControlCases.find(c=>c.id===target.id):target.entry==='task'?next.internalControlCases.find(c=>c.linkedTaskId===target.id):undefined;
   const source=target.entry==='tracking'?next.trackingItems.find(s=>s.id===target.id):item?sourceForCase(next,item):undefined;
   if(!source)fail('tracking-source-missing');
   if(seen.has(source!.id))continue;seen.add(source!.id);
   const group=resolveTrackingGroup(next,source!.id),members=[group.source,...(group.item?[group.item]:[]),...(group.task?[group.task]:[])];
   authorize(next,user,group.source.vesselId,'closeTasks');
   if(members.some(m=>m.isClosed!==group.source.isClosed||(m.isClosed&&m.closedDate!==group.source.closedDate)))fail('tracking-lifecycle-inconsistent');
   if(command.action==='close'&&group.source.isClosed||command.action!=='close'&&!group.source.isClosed)fail('tracking-lifecycle-state');
   if(command.action!=='reopen')validateTrackingClosureDate(group.source,command.date || '',group.item?.reportDate);
   const before=closureValue(group.source);
   for(const member of members){
    member.isClosed=command.action!=='reopen';member.updatedBy=user.id;member.updatedAt=at;
    if(member.isClosed){member.closedDate=command.date;member.closedBy=command.action==='close'?user.id:member.closedBy;}
    else {delete member.closedDate;delete member.closedBy;}
   }
   if(group.source.kind==='engineering'&&command.action==='close')group.source.closureOutcome=command.outcome || 'completed';
   const event=appendTrackingEvent(group.source,command.action,before,closureValue(group.source),user,at,target.entry,operationId);
   for(const member of [group.item,group.task])if(member)member.trackingLifecycle=[...(member.trackingLifecycle || []),structuredClone(event)];
  }
 } else {
  selection(command.items.map(i=>i.id));
  for(const input of command.items){
   const {source,item,task}=find(input.id,input.expectedUpdatedAt);
   authorize(next,user,source.vesselId,command.type==='sync'?'createTasks':'editBusinessContent');
   if(command.type==='edit'){
    if(source.isClosed)fail('tracking-closed-edit');
    const changes=(input as Extract<TrackingCommand,{type:'edit'}>['items'][number]).changes;
    if(!changes||Object.keys(changes).some(k=>!(TRACKING_EDIT_FIELDS as readonly string[]).includes(k)))fail('tracking-edit-field-forbidden');
    Object.assign(source,structuredClone(changes));validateTrackingItem(source);
   } else if(command.type==='progress'){
    if(source.isClosed||item?.isClosed||task?.isClosed)fail('tracking-closed-progress');
    const text=(input as Extract<TrackingCommand,{type:'progress'}>['items'][number]).text.trim();
    if(!text)fail('tracking-empty-progress');
    if(text===source.progress)continue;
    const log={id:`${operationId}:${source.id}:progress`,at,by:user.name,byUserId:user.id,text};
    source.progress=text;source.statusLogs=[log,...source.statusLogs];
    if(item){item.status=text;item.statusLogs=[structuredClone(log),...item.statusLogs];item.updatedAt=at;item.updatedBy=user.id;}
    if(task){task.status=text;task.statusLogs=structuredClone(item!.statusLogs);task.updatedAt=at;task.updatedBy=user.id;}
   } else if(command.type==='delivery'){
    const delivery=input as Extract<TrackingCommand,{type:'delivery'}>['items'][number];
    if(source.kind!=='supply')fail('tracking-not-supply');
    const before={deliveryStatus:source.deliveryStatus,actualDeliveryDate:source.actualDeliveryDate || ''};
    source.deliveryStatus=delivery.status;
    if(delivery.status==='delivered')source.actualDeliveryDate=delivery.date;
    else delete source.actualDeliveryDate;
    validateTrackingItem(source);
    appendTrackingEvent(source,'delivery',before,{deliveryStatus:source.deliveryStatus,actualDeliveryDate:source.actualDeliveryDate || ''},user,at,'tracking',operationId);
   } else {
    const sync=input as Extract<TrackingCommand,{type:'sync'}>['items'][number];
    if(item||source.linkState==='active')fail('tracking-already-linked');
    if(source.isClosed)fail('tracking-closed-sync');
    if(sync.item.vesselId!==source.vesselId||sync.item.isClosed)fail('tracking-sync-scope');
    const candidate={...structuredClone(sync.item),trackingItemId:source.id};
    createInternalControlCases(next,[candidate],user,at,sync.projection?{[candidate.id]:sync.projection}:{});
    appendTrackingEvent(source,'link',{caseId:source.linkedCaseId || '',linkState:source.linkState || ''},{caseId:candidate.id,linkState:'active'},user,at,'tracking',operationId);
    source.linkedCaseId=candidate.id;source.linkState='active';
   }
   source.updatedAt=at;source.updatedBy=user.id;
  }
 }
 return next;
}
