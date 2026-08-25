import type { AppData, PermissionKey, TaskItem, UserAccount } from './types';
import { canAccessAllVessels, hasPermission, normalizeRolePermissions } from './permissions';
import { hasActiveVesselDelegation } from './vesselDelegation';
import { buildCloudBlockPatch, type CloudBlockCollection, type CloudBlockPatchOperation } from './cloudBlockPatch';
import { taskBelongsToUserWorkCenter } from './workCenterScope';
import { isTaipeiBusinessDay, taipeiDateKey } from './taipeiTime';
import { isMeetingTaskSource } from './taskCategories';

export class CloudPatchAuthorizationError extends Error{
  constructor(readonly reason:string){super(`Cloud patch authorization rejected: ${reason}`);this.name='CloudPatchAuthorizationError';}
}

const stable=(value:unknown):string=>{
  if(value===null)return'null';
  if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;
  if(typeof value==='object'){
    const record=value as Record<string,unknown>;
    return`{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const equal=(left:unknown,right:unknown)=>stable(left)===stable(right);
const jsonComparable=(value:unknown):unknown=>{
  const serialized=JSON.stringify(value);
  return serialized===undefined?undefined:JSON.parse(serialized);
};
const jsonEqual=(left:unknown,right:unknown)=>equal(jsonComparable(left),jsonComparable(right));

const activeVessels=(data:AppData)=>data.vessels.filter(vessel=>vessel.isActive);

export function actorAuthorizationEnvelope(data:AppData,actorUserId:string){
  const actor=data.users.find(user=>user.id===actorUserId&&user.isActive);
  if(!actor)return null;
  const vessels=activeVessels(data);
  const viewAll=canAccessAllVessels(data.settings.rolePermissions,actor,vessels);
  const visibleVesselIds=(viewAll?vessels:vessels.filter(vessel=>
    vessel.assignedUserIds.includes(actor.id)||actor.managedVesselIds.includes(vessel.id)||hasActiveVesselDelegation(vessel,actor.id)
  )).map(vessel=>vessel.id).sort();
  return{
    actor:structuredClone(actor),
    effectivePermissions:normalizeRolePermissions(data.settings.rolePermissions)[actor.role],
    visibleVesselIds,
    nonOwnerPasswordResetVersion:actor.role==='owner'?null:data.settings.nonOwnerPasswordResetVersion,
  };
}

export function actorStorageAuthorizationGuard(normalized:AppData,storage:AppData,actorUserId:string){
  const effective=actorAuthorizationEnvelope(normalized,actorUserId);
  const storedActor=storage.users.find(user=>user.id===actorUserId&&user.isActive);
  if(!effective||!storedActor)return null;
  const storedPermissions=(storage.settings.rolePermissions as Record<string,unknown>|undefined)?.[storedActor.role]||{};
  return{
    actor:JSON.parse(JSON.stringify(storedActor)),
    effectivePermissions:JSON.parse(JSON.stringify(storedPermissions)),
    visibleVesselIds:effective.visibleVesselIds,
    nonOwnerPasswordResetVersion:storedActor.role==='owner'?null:(storage.settings.nonOwnerPasswordResetVersion??null),
  };
}

export const actorAuthorizationUnchanged=(base:AppData,remote:AppData,actorUserId:string)=>{
  const before=actorAuthorizationEnvelope(base,actorUserId);
  const after=actorAuthorizationEnvelope(remote,actorUserId);
  return Boolean(before&&after&&equal(before,after));
};

const permission=(data:AppData,actor:UserAccount,key:PermissionKey)=>{
  if(!hasPermission(data.settings.rolePermissions,actor,key))throw new CloudPatchAuthorizationError(`missing-${key}`);
};

const changedFields=(expected:Record<string,unknown>|null,value:Record<string,unknown>|null)=>{
  const fields=new Set<string>();
  for(const key of new Set([...Object.keys(expected||{}),...Object.keys(value||{})]))if(!equal(expected?.[key],value?.[key]))fields.add(key);
  return fields;
};

const entityVesselIds=(collection:CloudBlockCollection,entity:Record<string,unknown>|null):string[]=>{
  if(!entity)return[];
  if(collection==='vessels')return[String(entity.id||'')].filter(Boolean);
  if(collection==='tasks')return[...new Set([String(entity.vesselId||''),...(Array.isArray(entity.vesselIds)?entity.vesselIds.map(String):[])])].filter(Boolean);
  if(collection==='internalControlCases')return[String(entity.vesselId||'')].filter(Boolean);
  if(collection==='meetings')return[...new Set([...(Array.isArray(entity.vessels)?entity.vessels.map(String):[]),...(Array.isArray(entity.vesselIds)?entity.vesselIds.map(String):[])])].filter(Boolean);
  if(collection==='agendaReports')return Array.isArray(entity.vesselIds)?entity.vesselIds.map(String).filter(Boolean):[];
  return[];
};

const visibleVesselIdSet=(data:AppData,actor:UserAccount)=>new Set((actorAuthorizationEnvelope(data,actor.id)?.visibleVesselIds)||[]);

const assertEntityScope=(data:AppData,actor:UserAccount,collection:CloudBlockCollection,expected:Record<string,unknown>|null,value:Record<string,unknown>|null)=>{
  if(actor.role==='owner'||actor.role==='admin'||hasPermission(data.settings.rolePermissions,actor,'viewAllVessels'))return;
  const visible=visibleVesselIdSet(data,actor);
  const ids=[...new Set([...entityVesselIds(collection,expected),...entityVesselIds(collection,value)])];
  if(ids.some(id=>!visible.has(id)))throw new CloudPatchAuthorizationError(`out-of-scope-${collection}`);
};

const VESSEL_MANAGEMENT_FIELDS=new Set(['id','name','shortName','fullName','fleet','fleetId','fleetCategory','shipType','isActive','assignedUserIds','managedByUserIds','delegateManagers']);
const VESSEL_NON_COLLABORATIVE_FIELDS=new Set([...VESSEL_MANAGEMENT_FIELDS,'updatedAt','updatedBy']);
const VESSEL_AUTHORIZATION_FIELDS=new Set(['isActive','assignedUserIds','delegateManagers']);
const STATUS_FIELDS=new Set(['status','statusLogs','isClosed','closedDate','closedBy','reopenedAt','reopenedBy']);
const SENSITIVE_SETTING_FIELDS=new Set(['sitePasswordHash','rolePermissions','nonOwnerPasswordResetVersion']);

const meetingTaskLifecycleChanged=(expected:Record<string,unknown>|null,value:Record<string,unknown>|null)=>{
  if(!value)return false;
  const items=(entity:Record<string,unknown>|null)=>new Map((Array.isArray(entity?.taskItems)?entity.taskItems:[]).flatMap(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return[];
    const item=raw as Record<string,unknown>;
    const id=String(item.id||'');
    return id?[[id,{isClosed:item.isClosed===true,closedDate:String(item.closedDate||''),closedBy:String(item.closedBy||'')}]]:[];
  }));
  const before=items(expected);
  const after=items(value);
  for(const [id,previous] of before){
    if(!after.has(id)&&(previous.isClosed||previous.closedDate||previous.closedBy))return true;
  }
  for(const [id,next] of after){
    const previous=before.get(id);
    if(!previous){if(next.isClosed||next.closedDate||next.closedBy)return true;continue;}
    if(!equal(previous,next))return true;
  }
  return false;
};

export function vesselPatchRequiresCollaborationLock(expected:Record<string,unknown>|null,value:Record<string,unknown>|null){
  if(!expected)return false;
  if(!value)return true;
  return[...changedFields(expected,value)].some(field=>!VESSEL_NON_COLLABORATIVE_FIELDS.has(field));
}

export function authorizationDomainGuard(data:AppData){
  return{
    users:structuredClone(data.users),
    vesselAuthorization:data.vessels.map(vessel=>({
      id:vessel.id,
      isActive:vessel.isActive,
      assignedUserIds:structuredClone(vessel.assignedUserIds||[]),
      delegateManagers:structuredClone(vessel.delegateManagers||[]),
    })).sort((left,right)=>left.id.localeCompare(right.id)),
    sensitiveSettings:{
      sitePasswordHash:data.settings.sitePasswordHash??null,
      rolePermissions:structuredClone(data.settings.rolePermissions),
      nonOwnerPasswordResetVersion:data.settings.nonOwnerPasswordResetVersion??null,
    },
  };
}

export const appDataAuthorizationDomainChanged=(base:AppData,next:AppData)=>!equal(authorizationDomainGuard(base),authorizationDomainGuard(next));

export function cloudBlockPatchTouchesAuthorizationDomain(operations:readonly CloudBlockPatchOperation[]){
  return operations.some(operation=>{
    if(operation.kind==='settings')return[...changedFields(operation.expected as unknown as Record<string,unknown>,operation.value as unknown as Record<string,unknown>)].some(field=>SENSITIVE_SETTING_FIELDS.has(field));
    if(operation.collection==='users')return true;
    if(operation.kind==='entity'&&operation.collection==='vessels')return[...changedFields(operation.expected,operation.value)].some(field=>VESSEL_AUTHORIZATION_FIELDS.has(field));
    return false;
  });
}

const taskDismissalResetKey=(userId:string,taskId:string)=>`${userId}\u0000${taskId}`;

function assertDailyMorningReportAuthorization(actor:UserAccount,expected:Record<string,unknown>|null,value:Record<string,unknown>|null){
  const dailyMorning=expected?.kind==='daily-morning'||value?.kind==='daily-morning';
  if(!dailyMorning)return;
  if(actor.role!=='owner'&&actor.role!=='admin')throw new CloudPatchAuthorizationError('daily-morning-owner-admin-only');
  if(!value)return;
  const businessDate=String(value.businessDate||'');
  const snapshot=value.snapshot as Record<string,unknown>|undefined;
  const capturedAt=String(snapshot?.capturedAt||'');
  const vesselIds=Array.isArray(value.vesselIds)?value.vesselIds.map(String):[];
  const snapshotVessels=Array.isArray(snapshot?.vessels)?snapshot.vessels as Array<Record<string,unknown>>:[];
  const snapshotTasks=Array.isArray(snapshot?.tasks)?snapshot.tasks as Array<Record<string,unknown>>:[];
  const snapshotInternalControlCases=Array.isArray(snapshot?.internalControlCases)?snapshot.internalControlCases as Array<Record<string,unknown>>:[];
  const snapshotMeetings=Array.isArray(snapshot?.meetings)?snapshot.meetings as Array<Record<string,unknown>>:[];
  const snapshotVesselIds=snapshotVessels.map(vessel=>String(vessel.id||''));
  const snapshotVesselIdSet=new Set(snapshotVesselIds);
  const validInternalControlScope=snapshotInternalControlCases.every(item=>Boolean(String(item.id||''))&&snapshotVesselIdSet.has(String(item.vesselId||'')));
  const sameVesselScope=equal([...new Set(vesselIds)].sort(),[...new Set(snapshotVesselIds)].sort());
  if(value.kind!=='daily-morning'
    || value.source!=='manual'
    || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)
    || value.id!==`daily-morning-${businessDate}`
    || !capturedAt
    || taipeiDateKey(capturedAt)!==businessDate
    || !isTaipeiBusinessDay(capturedAt)
    || !sameVesselScope
    || snapshotVesselIds.some(id=>!id)
    || !validInternalControlScope
    || Number(value.taskCount)!==snapshotTasks.length+snapshotInternalControlCases.length
    || snapshotTasks.some(task=>task.isInternalControl===true)
    || snapshotMeetings.some(meeting=>meeting.isInternalControl===true)){
    throw new CloudPatchAuthorizationError('invalid-daily-morning-report');
  }
}

function authorizedCrossUserTaskDismissalResets(data:AppData,operations:readonly CloudBlockPatchOperation[]){
  const resets=new Set<string>();
  for(const operation of operations){
    if(operation.kind!=='entity'||operation.collection!=='tasks'||!operation.value)continue;
    const before=data.tasks.find(task=>task.id===operation.entityId);
    if(!before)continue;
    const after=operation.value as unknown as TaskItem;
    for(const user of data.users){
      if(!user.isActive)continue;
      const belongedBefore=taskBelongsToUserWorkCenter(before,user,data.vessels,data.meetings);
      const belongsAfter=taskBelongsToUserWorkCenter(after,user,data.vessels,data.meetings);
      if(!belongedBefore&&belongsAfter)resets.add(taskDismissalResetKey(user.id,operation.entityId));
    }
  }
  return resets;
}

type EntityPatchOperation=Extract<CloudBlockPatchOperation,{kind:'entity'}>;
type OrderPatchOperation=Extract<CloudBlockPatchOperation,{kind:'order'}>;

const exactDeletionMembership=(
  base:readonly Record<string,unknown>[],
  entities:readonly EntityPatchOperation[],
  orders:readonly OrderPatchOperation[],
  shouldDelete:(entity:Record<string,unknown>)=>boolean,
  ordered:boolean,
)=>{
  const expectedDeleted=base.filter(shouldDelete);
  if(entities.length!==expectedDeleted.length)return false;
  const expectedById=new Map(expectedDeleted.map(entity=>[String(entity.id||''),entity]));
  if(expectedById.size!==expectedDeleted.length)return false;
  if(entities.some(operation=>operation.value!==null
    ||!operation.expected
    ||operation.entityId!==String(operation.expected.id||'')
    ||!jsonEqual(expectedById.get(operation.entityId),operation.expected)))return false;
  if(!ordered)return orders.length===0;
  if(!expectedDeleted.length)return orders.length===0;
  if(orders.length!==1)return false;
  const deletedIds=new Set(expectedDeleted.map(entity=>String(entity.id||'')));
  const baseIds=base.map(entity=>String(entity.id||''));
  return equal(orders[0].expectedIds,baseIds)
    &&equal(orders[0].valueIds,baseIds.filter(id=>!deletedIds.has(id)));
};

function exactWithdrawalAuditBundle(
  data:AppData,
  entities:readonly EntityPatchOperation[],
  orders:readonly OrderPatchOperation[],
  actor:UserAccount,
  caseId:string,
  taskId:string,
  at:string,
){
  const added=entities.filter(operation=>!operation.expected&&operation.value);
  if(added.length!==1)return false;
  const audit=added[0].value!;
  const expectedKeys=['action','actorId','actorName','actorRole','at','detail','entityId','entityType','id'].sort();
  const auditTime=Date.parse(String(audit.at||''));
  const mutationTime=Date.parse(at);
  if(!equal(Object.keys(audit).sort(),expectedKeys)
    ||!String(audit.id||'')
    ||data.auditLogs.some(item=>item.id===audit.id)
    ||!Number.isFinite(auditTime)
    ||!Number.isFinite(mutationTime)
    ||auditTime<mutationTime
    ||auditTime-mutationTime>60_000
    ||audit.actorId!==actor.id
    ||audit.actorName!==actor.name
    ||audit.actorRole!==actor.role
    ||audit.action!=='撤回同步要事'
    ||audit.entityType!=='internal-control'
    ||audit.entityId!==caseId
    ||audit.detail!==`撤回同步要事 ${taskId}；內控案件保持未結案`)return false;
  const baseIds=data.auditLogs.map(item=>item.id);
  const expectedValueIds=[String(audit.id),...baseIds].slice(0,500);
  if(orders.length!==1
    ||!equal(orders[0].expectedIds,baseIds)
    ||!equal(orders[0].valueIds,expectedValueIds))return false;
  const deletedIds=new Set(baseIds.filter(id=>!expectedValueIds.includes(id)));
  const deleted=entities.filter(operation=>operation.expected&&!operation.value);
  if(deleted.length!==deletedIds.size||entities.length!==added.length+deleted.length)return false;
  return deleted.every(operation=>deletedIds.has(operation.entityId)
    &&jsonEqual(data.auditLogs.find(item=>item.id===operation.entityId),operation.expected));
}

function exactOriginBoundTaskSyncWithdrawals(data:AppData,operations:readonly CloudBlockPatchOperation[],actor:UserAccount){
  const none=new Set<string>();
  if(actor.role==='vessel'||!hasPermission(data.settings.rolePermissions,actor,'editBusinessContent'))return none;
  if(operations.some(operation=>operation.kind==='settings'
    ||!new Set<CloudBlockCollection>(['tasks','internalControlCases','taskDismissals','notifications','auditLogs']).has(operation.collection)))return none;
  const entities=operations.filter((operation):operation is EntityPatchOperation=>operation.kind==='entity');
  const orders=operations.filter((operation):operation is OrderPatchOperation=>operation.kind==='order');
  const taskEntities=entities.filter(operation=>operation.collection==='tasks');
  const caseEntities=entities.filter(operation=>operation.collection==='internalControlCases');
  if(taskEntities.length!==1||caseEntities.length!==1)return none;
  const taskDelete=taskEntities[0];
  const caseUpdate=caseEntities[0];
  if(!taskDelete.expected||taskDelete.value||!caseUpdate.expected||!caseUpdate.value)return none;
  const taskId=taskDelete.entityId;
  const caseId=caseUpdate.entityId;
  const tasksById=data.tasks.filter(task=>task.id===taskId);
  const casesById=data.internalControlCases.filter(item=>item.id===caseId);
  if(tasksById.length!==1||casesById.length!==1)return none;
  const task=tasksById[0];
  const item=casesById[0];
  if(!jsonEqual(task,taskDelete.expected)
    ||!jsonEqual(item,caseUpdate.expected)
    ||item.origin!=='internal-control'
    ||item.isClosed
    ||item.syncToTask!==true
    ||item.linkedTaskId!==taskId
    ||task.isInternalControl!==true
    ||task.internalControlCaseId!==caseId
    ||data.internalControlCases.filter(candidate=>candidate.linkedTaskId===taskId).length!==1
    ||data.tasks.filter(candidate=>candidate.internalControlCaseId===caseId).length!==1)return none;
  const taskScope=entityVesselIds('tasks',task as unknown as Record<string,unknown>);
  if(taskScope.length!==1
    ||taskScope[0]!==item.vesselId
    ||task.vesselId!==item.vesselId
    ||task.distributeToVessels===true
    ||task.sourceType!=='morning'
    ||Boolean(task.sourceMeetingItemId)
    ||isMeetingTaskSource(task))return none;
  const fields=changedFields(caseUpdate.expected,caseUpdate.value);
  if(!fields.has('syncToTask')
    ||!fields.has('linkedTaskId')
    ||!fields.has('updatedAt')
    ||[...fields].some(field=>!new Set(['syncToTask','linkedTaskId','updatedAt','updatedBy']).has(field))
    ||caseUpdate.value.syncToTask!==false
    ||Object.prototype.hasOwnProperty.call(caseUpdate.value,'linkedTaskId')
    ||caseUpdate.value.updatedBy!==actor.id
    ||typeof caseUpdate.value.updatedAt!=='string'
    ||!Number.isFinite(Date.parse(caseUpdate.value.updatedAt)))return none;
  assertEntityScope(data,actor,'tasks',taskDelete.expected,null);
  assertEntityScope(data,actor,'internalControlCases',caseUpdate.expected,caseUpdate.value);

  const taskOrders=orders.filter(operation=>operation.collection==='tasks');
  const taskIds=data.tasks.map(candidate=>candidate.id);
  if(taskOrders.length!==1
    ||!equal(taskOrders[0].expectedIds,taskIds)
    ||!equal(taskOrders[0].valueIds,taskIds.filter(id=>id!==taskId)))return none;
  const caseOrders=orders.filter(operation=>operation.collection==='internalControlCases');
  if(caseOrders.length)return none;
  const notificationEntities=entities.filter(operation=>operation.collection==='notifications');
  const notificationOrders=orders.filter(operation=>operation.collection==='notifications');
  if(!exactDeletionMembership(
    data.notifications as unknown as Record<string,unknown>[],
    notificationEntities,
    notificationOrders,
    notice=>notice.taskId===taskId,
    true,
  ))return none;
  const dismissalEntities=entities.filter(operation=>operation.collection==='taskDismissals');
  const dismissalOrders=orders.filter(operation=>operation.collection==='taskDismissals');
  if(!exactDeletionMembership(
    data.taskDismissals as unknown as Record<string,unknown>[],
    dismissalEntities,
    dismissalOrders,
    dismissal=>dismissal.itemKind==='task'&&dismissal.itemId===taskId,
    false,
  ))return none;
  const auditEntities=entities.filter(operation=>operation.collection==='auditLogs');
  const auditOrders=orders.filter(operation=>operation.collection==='auditLogs');
  if(!exactWithdrawalAuditBundle(data,auditEntities,auditOrders,actor,caseId,taskId,String(caseUpdate.value.updatedAt)))return none;
  return new Set([taskId]);
}

function authorizeEntityOperation(data:AppData,actor:UserAccount,operation:Extract<CloudBlockPatchOperation,{kind:'entity'}>,crossUserTaskDismissalResets:Set<string>,withdrawnTaskIds:Set<string>){
  const {collection,expected,value}=operation;
  const fields=changedFields(expected,value);
  if(collection==='users'){
    const selfServicePasswordChange=Boolean(expected&&value&&operation.entityId===actor.id&&[...fields].every(field=>field==='passwordHash'||field==='updatedAt'));
    if(selfServicePasswordChange)return;
    permission(data,actor,'manageUsers');
    const previousTarget=expected as unknown as UserAccount|null;
    const nextTarget=value as unknown as UserAccount|null;
    if((previousTarget?.role==='owner'||nextTarget?.role==='owner')&&actor.role!=='owner')throw new CloudPatchAuthorizationError('owner-account-is-owner-only');
    return;
  }
  if(collection==='vessels'){
    if(!expected||!value||[...fields].some(field=>VESSEL_MANAGEMENT_FIELDS.has(field)))permission(data,actor,'manageVessels');
    else permission(data,actor,'editBusinessContent');
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
  if(collection==='tasks'){
    if(!expected)permission(data,actor,'createTasks');
    else if(!value&&!withdrawnTaskIds.has(operation.entityId))permission(data,actor,'deleteTasks');
    else{
      if([...fields].some(field=>STATUS_FIELDS.has(field)))permission(data,actor,'closeTasks');
      if([...fields].some(field=>!STATUS_FIELDS.has(field)&&field!=='updatedAt'&&field!=='updatedBy'))permission(data,actor,'editBusinessContent');
    }
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
  if(collection==='internalControlCases'){
    if(!expected)permission(data,actor,'createTasks');
    else if(!value)permission(data,actor,'deleteTasks');
    else{
      if([...fields].some(field=>STATUS_FIELDS.has(field)))permission(data,actor,'closeTasks');
      if([...fields].some(field=>!STATUS_FIELDS.has(field)&&field!=='updatedAt'&&field!=='updatedBy'))permission(data,actor,'editBusinessContent');
    }
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
  if(collection==='meetings'){
    permission(data,actor,'manageMeetings');
    if(meetingTaskLifecycleChanged(expected,value))permission(data,actor,'closeTasks');
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
  if(collection==='agendaReports'){
    permission(data,actor,'exportReports');
    assertDailyMorningReportAuthorization(actor,expected,value);
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
  if(collection==='taskDismissals'){
    const dismissal=((value||expected)||{}) as Record<string,unknown>;
    const itemKind=String(dismissal.itemKind||'');
    const itemId=String(dismissal.itemId||'');
    const dismissalUserId=String(dismissal.userId||'');
    const actorOwned=dismissalUserId===actor.id&&dismissal.dismissedBy===actor.id;
    const exactCrossUserReset=Boolean(!value&&expected&&itemKind==='task'&&dismissal.dismissedBy===dismissalUserId&&crossUserTaskDismissalResets.has(taskDismissalResetKey(dismissalUserId,itemId)));
    const exactWithdrawalCleanup=Boolean(!value&&expected&&itemKind==='task'&&withdrawnTaskIds.has(itemId));
    if(!actorOwned&&!exactCrossUserReset&&!exactWithdrawalCleanup)throw new CloudPatchAuthorizationError('task-dismissal-must-belong-to-actor');
    if(exactCrossUserReset||exactWithdrawalCleanup)return;
    if(itemKind==='task'){
      const task=data.tasks.find(item=>item.id===itemId);
      if(!task)throw new CloudPatchAuthorizationError('task-dismissal-target-missing');
      assertEntityScope(data,actor,'tasks',task as unknown as Record<string,unknown>,task as unknown as Record<string,unknown>);
    }else if(itemKind==='internal-control'){
      const item=data.internalControlCases.find(candidate=>candidate.id===itemId);
      if(!item)throw new CloudPatchAuthorizationError('task-dismissal-target-missing');
      assertEntityScope(data,actor,'internalControlCases',item as unknown as Record<string,unknown>,item as unknown as Record<string,unknown>);
    }else throw new CloudPatchAuthorizationError('invalid-task-dismissal-kind');
    return;
  }
}

function authorizeOrderOperation(data:AppData,actor:UserAccount,collection:CloudBlockCollection){
  if(collection==='users')permission(data,actor,'manageUsers');
  else if(collection==='vessels')permission(data,actor,'manageVessels');
  else if(collection==='tasks'||collection==='internalControlCases')permission(data,actor,'editBusinessContent');
  else if(collection==='meetings')permission(data,actor,'manageMeetings');
  else if(collection==='agendaReports')permission(data,actor,'exportReports');
  else if(collection==='taskDismissals')throw new CloudPatchAuthorizationError('task-dismissal-order-without-entity');
}

const exactSelfNotificationRead=(operation:Extract<CloudBlockPatchOperation,{kind:'entity'}>,actor:UserAccount)=>{
  if(operation.collection!=='notifications'||!operation.expected||!operation.value)return false;
  const fields=changedFields(operation.expected,operation.value);
  return fields.size===1
    && fields.has('readAt')
    && operation.expected.userId===actor.id
    && operation.value.userId===actor.id
    && !operation.expected.readAt
    && typeof operation.value.readAt==='string'
    && Boolean(operation.value.readAt);
};

const exactLegacyNotificationReadAudit=(data:AppData,operations:readonly CloudBlockPatchOperation[],actor:UserAccount)=>{
  const notificationReads=operations.filter((operation):operation is Extract<CloudBlockPatchOperation,{kind:'entity'}>=>operation.kind==='entity'&&operation.collection==='notifications');
  if(!notificationReads.length||notificationReads.some(operation=>!exactSelfNotificationRead(operation,actor)))return false;
  if(operations.some(operation=>{
    if(operation.kind==='settings')return true;
    return operation.collection!=='notifications'&&operation.collection!=='auditLogs';
  }))return false;
  if(operations.some(operation=>operation.kind!=='settings'&&operation.collection==='notifications'&&operation.kind!=='entity'))return false;
  const readTransitions=notificationReads.map(operation=>({
    taskId:String(operation.value?.taskId||''),
    at:String(operation.value?.readAt||''),
  }));
  if(readTransitions.some(transition=>!transition.taskId||!Number.isFinite(Date.parse(transition.at))))return false;
  const auditEntities=operations.filter((operation):operation is Extract<CloudBlockPatchOperation,{kind:'entity'}>=>operation.kind==='entity'&&operation.collection==='auditLogs');
  const added=auditEntities.filter(operation=>!operation.expected&&operation.value);
  if(!added.length)return false;
  const expectedAuditKeys=['action','actorId','actorName','actorRole','at','detail','entityId','entityType','id'].sort();
  const validLegacyAudit=(audit:Record<string,unknown>)=>{
    const auditTime=Date.parse(String(audit.at||''));
    const matchingRead=readTransitions.some(transition=>
      (audit.action==='標記通知已讀'||transition.taskId===audit.entityId)
      && Math.abs(auditTime-Date.parse(transition.at))<=60_000
    );
    const taskReadAudit=audit.action==='查看待辦更新'
      && audit.detail==='標記此待辦未讀變動'
      && matchingRead;
    const markAllAudit=audit.action==='標記通知已讀'
      && audit.detail==='全部標記已讀'
      && audit.entityId===actor.id
      && matchingRead;
    return equal(Object.keys(audit).sort(),expectedAuditKeys)
      && audit.actorId===actor.id
      && audit.actorName===actor.name
      && audit.actorRole===actor.role
      && audit.entityType==='notification'
      && (taskReadAudit||markAllAudit)
      && Number.isFinite(auditTime);
  };
  if(added.some(operation=>!validLegacyAudit(operation.value!)))return false;
  const baseIds=data.auditLogs.map(item=>item.id);
  const auditOrders=operations.filter((operation):operation is Extract<CloudBlockPatchOperation,{kind:'order'}>=>operation.kind==='order'&&operation.collection==='auditLogs');
  if(auditOrders.length!==1||!equal(auditOrders[0].expectedIds,baseIds))return false;
  const baseIdSet=new Set(baseIds);
  const addedById=new Map(added.map(operation=>[operation.entityId,operation.value!] as const));
  const addedIds=new Set(addedById.keys());
  const valueIds=auditOrders[0].valueIds;
  if(new Set(valueIds).size!==valueIds.length||valueIds.some(id=>!baseIdSet.has(id)&&!addedIds.has(id)))return false;
  const addedIdsInOrder=valueIds.filter(id=>addedIds.has(id));
  if(addedIdsInOrder.length!==addedIds.size||addedIdsInOrder.some(id=>!addedIds.has(id)))return false;
  const retainedBaseIds=valueIds.filter(id=>baseIdSet.has(id));
  const expectedLength=Math.min(500,baseIds.length+addedIds.size);
  if(valueIds.length!==expectedLength
    ||retainedBaseIds.length!==expectedLength-addedIds.size
    ||!equal(retainedBaseIds,baseIds.slice(0,retainedBaseIds.length)))return false;
  const baseById=new Map(data.auditLogs.map(item=>[item.id,item] as const));
  const auditAt=(id:string)=>String(addedById.get(id)?.at||baseById.get(id)?.at||'');
  for(let left=0;left<valueIds.length;left+=1){
    for(let right=left+1;right<valueIds.length;right+=1){
      if(!addedIds.has(valueIds[left])&&!addedIds.has(valueIds[right]))continue;
      if(auditAt(valueIds[left]).localeCompare(auditAt(valueIds[right]))<0)return false;
    }
  }
  const expectedDeletedIds=baseIds.slice(retainedBaseIds.length);
  const deleted=auditEntities.filter(operation=>operation.expected&&!operation.value).map(operation=>operation.entityId).sort();
  if(!equal(deleted,[...expectedDeletedIds].sort())||auditEntities.length!==added.length+expectedDeletedIds.length)return false;
  return true;
};

export function assertActorAuthorizedForCloudBlockPatch(data:AppData,operations:readonly CloudBlockPatchOperation[],actorUserId:string):void{
  const actor=data.users.find(user=>user.id===actorUserId&&user.isActive);
  if(!actor)throw new CloudPatchAuthorizationError('actor-missing-or-inactive');
  const sideEffects:CloudBlockPatchOperation[]=[];
  const crossUserTaskDismissalResets=authorizedCrossUserTaskDismissalResets(data,operations);
  const withdrawnTaskIds=exactOriginBoundTaskSyncWithdrawals(data,operations,actor);
  const entityOperationCollections=new Set(operations.filter((operation):operation is Extract<CloudBlockPatchOperation,{kind:'entity'}>=>operation.kind==='entity').map(operation=>operation.collection));
  let authorizedPrimary=false;
  for(const operation of operations){
    if((operation.kind==='entity'||operation.kind==='order')&&(operation.collection==='notifications'||operation.collection==='auditLogs')){
      sideEffects.push(operation);continue;
    }
    if(operation.kind==='settings'){
      const fields=changedFields(operation.expected as unknown as Record<string,unknown>,operation.value as unknown as Record<string,unknown>);
      if(fields.has('rolePermissions'))permission(data,actor,'manageRolePermissions');
      if([...fields].some(field=>field!=='rolePermissions'&&field!=='lastCloudSyncAt'))permission(data,actor,'manageSystemSettings');
      authorizedPrimary=true;
    }else if(operation.kind==='entity'){
      authorizeEntityOperation(data,actor,operation,crossUserTaskDismissalResets,withdrawnTaskIds);
      authorizedPrimary=true;
    }else{
      if(!entityOperationCollections.has(operation.collection))authorizeOrderOperation(data,actor,operation.collection);
      authorizedPrimary=true;
    }
  }
  if(!authorizedPrimary&&exactLegacyNotificationReadAudit(data,operations,actor))return;
  for(const operation of sideEffects){
    if(operation.kind==='entity'&&operation.collection==='notifications'){
      const notification=(operation.value||operation.expected) as Record<string,unknown>|null;
      if(notification?.userId===actor.id)continue;
    }
    if(!authorizedPrimary)throw new CloudPatchAuthorizationError(`unaccompanied-${operation.kind==='entity'?operation.collection:'order'}`);
  }
}

export function assertActorAuthorizedForAppDataChange(base:AppData,next:AppData,actorUserId:string):void{
  assertActorAuthorizedForCloudBlockPatch(base,buildCloudBlockPatch(base,next,base),actorUserId);
}
