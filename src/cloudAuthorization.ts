import type { AppData, PermissionKey, UserAccount } from './types';
import { canAccessAllVessels, hasPermission, normalizeRolePermissions } from './permissions';
import { hasActiveVesselDelegation } from './vesselDelegation';
import { buildCloudBlockPatch, type CloudBlockCollection, type CloudBlockPatchOperation } from './cloudBlockPatch';

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

function authorizeEntityOperation(data:AppData,actor:UserAccount,operation:Extract<CloudBlockPatchOperation,{kind:'entity'}>){
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
    else if(!value)permission(data,actor,'deleteTasks');
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
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
  if(collection==='agendaReports'){
    permission(data,actor,'exportReports');
    assertEntityScope(data,actor,collection,expected,value);
    return;
  }
}

function authorizeOrderOperation(data:AppData,actor:UserAccount,collection:CloudBlockCollection){
  if(collection==='users')permission(data,actor,'manageUsers');
  else if(collection==='vessels')permission(data,actor,'manageVessels');
  else if(collection==='tasks'||collection==='internalControlCases')permission(data,actor,'editBusinessContent');
  else if(collection==='meetings')permission(data,actor,'manageMeetings');
  else if(collection==='agendaReports')permission(data,actor,'exportReports');
}

export function assertActorAuthorizedForCloudBlockPatch(data:AppData,operations:readonly CloudBlockPatchOperation[],actorUserId:string):void{
  const actor=data.users.find(user=>user.id===actorUserId&&user.isActive);
  if(!actor)throw new CloudPatchAuthorizationError('actor-missing-or-inactive');
  const sideEffects:CloudBlockPatchOperation[]=[];
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
      authorizeEntityOperation(data,actor,operation);
      authorizedPrimary=true;
    }else{
      if(!entityOperationCollections.has(operation.collection))authorizeOrderOperation(data,actor,operation.collection);
      authorizedPrimary=true;
    }
  }
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
