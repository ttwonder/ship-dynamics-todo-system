import type { AppData } from './types';
import { actorAuthorizationUnchanged } from './cloudAuthorization';

const COLLECTION_KEYS = ['users', 'vessels', 'tasks', 'internalControlCases', 'meetings', 'agendaReports', 'taskDismissals', 'auditLogs', 'notifications'] as const;
type CollectionKey = typeof COLLECTION_KEYS[number];
type SnapshotName = 'base' | 'local' | 'remote';
type Identified = { id: string };
const FIELD_LEVEL_COLLECTIONS = new Set<CollectionKey>(['vessels', 'tasks', 'internalControlCases', 'meetings']);

const clone = <T,>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const appDataContentEqual = (left: AppData, right: AppData) => {
  const { revision: _leftRevision, updatedAt: _leftUpdatedAt, ...leftContent } = left;
  const { revision: _rightRevision, updatedAt: _rightUpdatedAt, ...rightContent } = right;
  return equal(leftContent, rightContent);
};

export class CloudRebaseConflictError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super(`雲端資料與本機修改發生重疊衝突：${conflicts.join('、')}。本機編輯內容已保留，未被雲端資料覆蓋。`);
    this.name = 'CloudRebaseConflictError';
    this.conflicts = conflicts;
  }
}

function validateCollectionIds(key: CollectionKey, snapshot: SnapshotName, items: unknown[], conflicts: string[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (!plainObject(item) || typeof item.id !== 'string' || !item.id.trim()) {
      conflicts.push(`${key}:${snapshot}:invalid-id`);
      continue;
    }
    if (seen.has(item.id)) conflicts.push(`${key}:${snapshot}:duplicate-id:${item.id}`);
    seen.add(item.id);
  }
}

const changedIds = (baseItems: Identified[], sideItems: Identified[]) => {
  const baseById = new Map(baseItems.map(item => [item.id, item]));
  const sideById = new Map(sideItems.map(item => [item.id, item]));
  return new Set([...new Set([...baseById.keys(), ...sideById.keys()])].filter(id => !equal(baseById.get(id), sideById.get(id))));
};

const settingsKeyChanged = (base: AppData, side: AppData, key: keyof AppData['settings']) => !equal(base.settings[key], side.settings[key]);
const SENSITIVE_SETTINGS: (keyof AppData['settings'])[] = ['sitePasswordHash', 'rolePermissions', 'nonOwnerPasswordResetVersion'];
const vesselAuthorizationShape = (data: AppData) => data.vessels.map(vessel=>({
  id:vessel.id,
  isActive:vessel.isActive,
  assignedUserIds:[...(vessel.assignedUserIds||[])].sort(),
  delegateManagers:[...(vessel.delegateManagers||[])].map(item=>({userId:item.userId,isActive:item.isActive})).sort((left,right)=>left.userId.localeCompare(right.userId)),
})).sort((left,right)=>left.id.localeCompare(right.id));
const vesselAuthorizationChanged = (base: AppData, side: AppData) => !equal(vesselAuthorizationShape(base),vesselAuthorizationShape(side));

function meaningfulChange(base: AppData, side: AppData) {
  if (!equal(base.settings, side.settings)) return true;
  return COLLECTION_KEYS.some(key => key !== 'auditLogs' && !equal(base[key], side[key]));
}

function relationshipValues(baseItems: any[], sideItems: any[], ids: Set<string>, read: (item: any) => string[]) {
  const values = new Set<string>();
  for (const item of [...baseItems, ...sideItems]) if (ids.has(item.id)) read(item).filter(Boolean).forEach(value => values.add(value));
  return values;
}

const intersects = (left: Set<string>, right: Set<string>) => [...left].some(value => right.has(value));

function detectDependencyConflicts(base: AppData, local: AppData, remote: AppData, conflicts: string[],actorUserId?:string) {
  const localSensitive = !equal(base.users, local.users) || vesselAuthorizationChanged(base,local) || SENSITIVE_SETTINGS.some(key => settingsKeyChanged(base, local, key));
  const remoteSensitive = !equal(base.users, remote.users) || vesselAuthorizationChanged(base,remote) || SENSITIVE_SETTINGS.some(key => settingsKeyChanged(base, remote, key));
  const actorAuthorizationChanged=remoteSensitive&&meaningfulChange(base,local)&&(!actorUserId||!actorAuthorizationUnchanged(base,remote,actorUserId));
  if ((localSensitive && meaningfulChange(base, remote)) || actorAuthorizationChanged) conflicts.push('authorization-domain');
  const changed = (side: AppData, key: CollectionKey) => changedIds(base[key] as Identified[], side[key] as Identified[]);
  const localTaskIds = changed(local, 'tasks');
  const remoteTaskIds = changed(remote, 'tasks');
  const localCaseIds = changed(local, 'internalControlCases');
  const remoteCaseIds = changed(remote, 'internalControlCases');
  const localMeetingIds = changed(local, 'meetings');
  const remoteMeetingIds = changed(remote, 'meetings');
  const localVesselIds = changed(local, 'vessels');
  const remoteVesselIds = changed(remote, 'vessels');
  const taskCases = (side: AppData, ids: Set<string>) => relationshipValues(base.tasks, side.tasks, ids, item => [item.internalControlCaseId || '']);
  const taskMeetings = (side: AppData, ids: Set<string>) => relationshipValues(base.tasks, side.tasks, ids, item => [item.sourceMeetingId || '']);
  const taskVessels = (side: AppData, ids: Set<string>) => relationshipValues(base.tasks, side.tasks, ids, item => [item.vesselId || '', ...(item.vesselIds || [])]);
  const caseTasks = (side: AppData, ids: Set<string>) => relationshipValues(base.internalControlCases, side.internalControlCases, ids, item => [item.linkedTaskId || '']);
  const caseVessels = (side: AppData, ids: Set<string>) => relationshipValues(base.internalControlCases, side.internalControlCases, ids, item => [item.vesselId || '']);
  if (intersects(taskCases(local, localTaskIds), remoteCaseIds) || intersects(taskCases(remote, remoteTaskIds), localCaseIds)) conflicts.push('dependency:internal-control');
  if (intersects(caseTasks(local, localCaseIds), remoteTaskIds) || intersects(caseTasks(remote, remoteCaseIds), localTaskIds)) conflicts.push('dependency:internal-control-task');
  if (intersects(taskMeetings(local, localTaskIds), remoteMeetingIds) || intersects(taskMeetings(remote, remoteTaskIds), localMeetingIds)) conflicts.push('dependency:meeting-task');
  if (intersects(taskVessels(local, localTaskIds), remoteVesselIds) || intersects(taskVessels(remote, remoteTaskIds), localVesselIds) || intersects(caseVessels(local, localCaseIds), remoteVesselIds) || intersects(caseVessels(remote, remoteCaseIds), localVesselIds)) conflicts.push('dependency:vessel-scope');
}

const changedEntityFields=(base:Identified,side:Identified)=>new Set(Object.keys({...base,...side}).filter(key=>key!=='updatedAt'&&key!=='updatedBy'&&!equal((base as any)[key],(side as any)[key])));
const fieldSetIntersects=(changed:Set<string>,fields:Set<string>)=>[...changed].some(field=>fields.has(field));
const TASK_SCOPE_FIELDS=new Set(['vesselId','vesselIds','vesselScopeMode','vesselTypeScopes','distributeToVessels','ownerUserIds']);
const TASK_STATUS_FIELDS=new Set(['status','statusLogs','isClosed','closedDate','closedBy']);
const TASK_PROGRESS_STATUS_FIELDS=new Set(['status','statusLogs','isClosed','closedDate','closedBy']);
const TASK_SOURCE_FIELDS=new Set(['sourceMeetingId','sourceMeetingItemId','sourceType','attentionDimension']);
const TASK_INTERNAL_FIELDS=new Set(['isInternalControl','internalControlCaseId','internalControlCancelledAt','internalControlCancelledBy']);
const CASE_SCOPE_FIELDS=new Set(['vesselId']);
const CASE_STATUS_FIELDS=new Set(['status','statusLogs','isClosed','closedDate','closedBy']);
const CASE_LINK_FIELDS=new Set(['linkedTaskId','syncToTask']);
const MEETING_SCOPE_FIELDS=new Set(['vessels','vesselScopeMode','vesselTypeScopes','appliesToAllVessels']);
const MEETING_TASK_FIELDS=new Set(['taskItems','taskDescription','isInternalControl']);

function detectEntityDomainConflicts(key:CollectionKey,id:string,base:Identified,local:Identified,remote:Identified,conflicts:string[]){
  if(equal(local,base)||equal(remote,base)||equal(local,remote))return;
  const localFields=changedEntityFields(base,local);const remoteFields=changedEntityFields(base,remote);
  const scopeConflict=(fields:Set<string>,label:string)=>{
    if((fieldSetIntersects(localFields,fields)&&remoteFields.size)||(fieldSetIntersects(remoteFields,fields)&&localFields.size))conflicts.push(`dependency:${label}:${id}`);
  };
  const groupConflict=(fields:Set<string>,label:string)=>{
    if(fieldSetIntersects(localFields,fields)&&fieldSetIntersects(remoteFields,fields))conflicts.push(`dependency:${label}:${id}`);
  };
  const exclusiveTransactionConflict=(fields:Set<string>,label:string)=>{
    if((fieldSetIntersects(localFields,fields)&&remoteFields.size)||(fieldSetIntersects(remoteFields,fields)&&localFields.size))conflicts.push(`dependency:${label}:${id}`);
  };
  if(key==='tasks'){
    scopeConflict(TASK_SCOPE_FIELDS,'task-scope');
    exclusiveTransactionConflict(TASK_STATUS_FIELDS,'task-status');
    const progressIndex=(value:unknown)=>new Map((Array.isArray(value)?value:[]).filter(plainObject).map(item=>[String(item.vesselId||''),item as Identified]));
    const baseProgress=progressIndex((base as any).vesselProgress);
    const localProgress=progressIndex((local as any).vesselProgress);
    const remoteProgress=progressIndex((remote as any).vesselProgress);
    for(const [vesselId,baseMember] of baseProgress){
      const localMember=localProgress.get(vesselId);const remoteMember=remoteProgress.get(vesselId);
      if(!localMember||!remoteMember)continue;
      const localMemberFields=changedEntityFields(baseMember,localMember);
      const remoteMemberFields=changedEntityFields(baseMember,remoteMember);
      if((fieldSetIntersects(localMemberFields,TASK_PROGRESS_STATUS_FIELDS)&&remoteMemberFields.size)||(fieldSetIntersects(remoteMemberFields,TASK_PROGRESS_STATUS_FIELDS)&&localMemberFields.size))conflicts.push(`dependency:task-vessel-status:${id}:${vesselId}`);
    }
    scopeConflict(TASK_SOURCE_FIELDS,'task-source');
    scopeConflict(TASK_INTERNAL_FIELDS,'task-internal-control');
  }else if(key==='internalControlCases'){
    scopeConflict(CASE_SCOPE_FIELDS,'internal-control-scope');
    exclusiveTransactionConflict(CASE_STATUS_FIELDS,'internal-control-status');
    scopeConflict(CASE_LINK_FIELDS,'internal-control-link');
  }else if(key==='meetings'){
    scopeConflict(MEETING_SCOPE_FIELDS,'meeting-scope');
    groupConflict(MEETING_TASK_FIELDS,'meeting-task-items');
  }
}

function mergeSettingsValue(base: unknown, local: unknown, remote: unknown, path: string, conflicts: string[]): unknown {
  if (equal(local, base)) return clone(remote);
  if (equal(remote, base)) return clone(local);
  if (equal(local, remote)) return clone(local);
  if (plainObject(base) && plainObject(local) && plainObject(remote)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = mergeSettingsValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  conflicts.push(path);
  return clone(remote);
}

const entityTimestamp = (value: Record<string, unknown>) => typeof value.updatedAt === 'string' ? value.updatedAt : '';

function validateStatusLogArray(base: unknown[], local: unknown[], remote: unknown[], path: string, conflicts: string[]) {
  const validate = (items: unknown[], snapshot: SnapshotName) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (!plainObject(item) || typeof item.id !== 'string' || !item.id.trim()) { conflicts.push(`${path}:${snapshot}:invalid-id`); continue; }
      if (seen.has(item.id)) conflicts.push(`${path}:${snapshot}:duplicate-id:${item.id}`);
      seen.add(item.id);
    }
  };
  validate(base,'base');validate(local,'local');validate(remote,'remote');
  const localById=new Map(local.map(item=>[(item as Identified).id,item]));
  const remoteById=new Map(remote.map(item=>[(item as Identified).id,item]));
  for(const baseItem of base){
    const id=(baseItem as Identified).id;
    if(!equal(localById.get(id),baseItem)||!equal(remoteById.get(id),baseItem))conflicts.push(`${path}:${id}`);
  }
}

function validateNestedStatusHistory(base: unknown, local: unknown, remote: unknown, path: string, conflicts: string[]) {
  if(!plainObject(base))return;
  if(!plainObject(local)||!plainObject(remote)){conflicts.push(path);return;}
  for(const [key,baseValue] of Object.entries(base)){
    const localValue=local[key];const remoteValue=remote[key];const childPath=`${path}.${key}`;
    if(key==='statusLogs'&&Array.isArray(baseValue)){
      if(!Array.isArray(localValue)||!Array.isArray(remoteValue)){conflicts.push(childPath);continue;}
      validateStatusLogArray(baseValue,localValue,remoteValue,childPath,conflicts);
      continue;
    }
    if(plainObject(baseValue)&&plainObject(localValue)&&plainObject(remoteValue))validateNestedStatusHistory(baseValue,localValue,remoteValue,childPath,conflicts);
    if(Array.isArray(baseValue)&&Array.isArray(localValue)&&Array.isArray(remoteValue)&&key==='vesselProgress'){
      const index=(items:unknown[])=>new Map(items.filter(plainObject).map(item=>[String(item.vesselId||''),item]));
      const localByKey=index(localValue);const remoteByKey=index(remoteValue);
      for(const baseItem of baseValue.filter(plainObject)){
        const memberKey=String(baseItem.vesselId||'');
        validateNestedStatusHistory(baseItem,localByKey.get(memberKey),remoteByKey.get(memberKey),`${childPath}:${memberKey}`,conflicts);
      }
    }
  }
}

function mergeStatusLogs(base: unknown[], local: unknown[], remote: unknown[], path: string, conflicts: string[]): unknown[] {
  validateStatusLogArray(base,local,remote,path,conflicts);
  const baseById = new Map(base.map(item => [(item as Identified).id, item]));
  const localById = new Map(local.map(item => [(item as Identified).id, item]));
  const remoteById = new Map(remote.map(item => [(item as Identified).id, item]));
  const ids = [...new Set([...remoteById.keys(), ...localById.keys(), ...baseById.keys()])];
  const merged: unknown[] = [];
  for (const id of ids) {
    const baseItem = baseById.get(id);
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    let resolved: unknown;
    if(baseItem!==undefined){
      if(!equal(localItem,baseItem)||!equal(remoteItem,baseItem))conflicts.push(`${path}:${id}`);
      resolved=baseItem;
    }else if(localItem===undefined)resolved=remoteItem;
    else if(remoteItem===undefined)resolved=localItem;
    else if(equal(localItem,remoteItem))resolved=localItem;
    else {
      conflicts.push(`${path}:${id}`);
      resolved = remoteItem;
    }
    if (resolved !== undefined) merged.push(clone(resolved));
  }
  return merged.sort((left: any, right: any) => String(right?.at || '').localeCompare(String(left?.at || '')));
}

function mergeImmutableAuditLogs(baseItems: Identified[],localItems: Identified[],remoteItems: Identified[],conflicts:string[]){
  const baseById=new Map(baseItems.map(item=>[item.id,item]));
  const localById=new Map(localItems.map(item=>[item.id,item]));
  const remoteById=new Map(remoteItems.map(item=>[item.id,item]));
  const allowsTrustedRetention=(sideItems:Identified[],sideById:Map<string,Identified>)=>{
    const retainedBaseIds=baseItems.filter(item=>sideById.has(item.id)).map(item=>item.id);
    const missingCount=baseItems.length-retainedBaseIds.length;
    const newCount=sideItems.filter(item=>!baseById.has(item.id)).length;
    const retainedPrefix=retainedBaseIds.every((id,index)=>baseItems[index]?.id===id);
    return baseItems.length===500&&sideItems.length===500&&missingCount>0&&missingCount===newCount&&retainedPrefix;
  };
  const localRetention=allowsTrustedRetention(localItems,localById);
  const remoteRetention=allowsTrustedRetention(remoteItems,remoteById);
  const retainedBase:Identified[]=[];
  for(const baseItem of baseItems){
    const id=baseItem.id;const local=localById.get(id);const remote=remoteById.get(id);
    if((local===undefined&&!localRetention)||(local!==undefined&&!equal(local,baseItem))||(remote===undefined&&!remoteRetention)||(remote!==undefined&&!equal(remote,baseItem)))conflicts.push(`auditLogs:${id}`);
    retainedBase.push(clone(baseItem));
  }
  const newIds=[...new Set([...localById.keys(),...remoteById.keys()].filter(id=>!baseById.has(id)))];
  const appended:Identified[]=[];
  for(const id of newIds){
    const local=localById.get(id);const remote=remoteById.get(id);
    if(local&&remote&&!equal(local,remote)){conflicts.push(`auditLogs:${id}`);appended.push(clone(remote));}
    else if(local||remote)appended.push(clone((local||remote)!));
  }
  appended.sort((a:any,b:any)=>String(b.at||'').localeCompare(String(a.at||''))||a.id.localeCompare(b.id));
  if(appended.length>500){
    conflicts.push('auditLogs:retention-overflow');
    return appended.map(item=>clone(item));
  }
  return [...appended,...retainedBase].slice(0,500);
}

function mergeKeyedEntityArray(base: unknown[], local: unknown[], remote: unknown[], path: string, keyName: string, conflicts: string[]): unknown[] {
  const validate = (items: unknown[], snapshot: SnapshotName) => {
    const seen = new Set<string>();
    for (const item of items) {
      const key = plainObject(item) ? item[keyName] : undefined;
      if (typeof key !== 'string' || !key.trim()) {
        conflicts.push(`${path}:${snapshot}:invalid-${keyName}`);
        continue;
      }
      if (seen.has(key)) conflicts.push(`${path}:${snapshot}:duplicate-${keyName}:${key}`);
      seen.add(key);
    }
  };
  validate(base, 'base');
  validate(local, 'local');
  validate(remote, 'remote');
  if (conflicts.some(conflict => conflict.startsWith(`${path}:`) && (conflict.includes(`:invalid-${keyName}`) || conflict.includes(`:duplicate-${keyName}:`)))) return clone(remote);
  const index = (items: unknown[]) => new Map(items.map(item => [(item as Record<string, unknown>)[keyName] as string, item]));
  const baseByKey = index(base);
  const localByKey = index(local);
  const remoteByKey = index(remote);
  const keys = [...new Set([...remoteByKey.keys(), ...localByKey.keys(), ...baseByKey.keys()])];
  const merged: unknown[] = [];
  for (const key of keys) {
    const baseItem = baseByKey.get(key);
    const localItem = localByKey.get(key);
    const remoteItem = remoteByKey.get(key);
    let resolved: unknown;
    if (equal(localItem, baseItem)) resolved = remoteItem;
    else if (equal(remoteItem, baseItem)) resolved = localItem;
    else if (equal(localItem, remoteItem)) resolved = localItem;
    else if (plainObject(baseItem) && plainObject(localItem) && plainObject(remoteItem)) resolved = mergeEntityValue(baseItem, localItem, remoteItem, `${path}:${key}`, conflicts);
    else {
      conflicts.push(`${path}:${key}`);
      resolved = remoteItem;
    }
    if (resolved !== undefined) merged.push(clone(resolved));
  }
  return merged;
}

function mergeEntityValue(base: unknown, local: unknown, remote: unknown, path: string, conflicts: string[]): unknown {
  if (equal(local, base)) return clone(remote);
  if (equal(remote, base)) return clone(local);
  if (equal(local, remote)) return clone(local);
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if (path.endsWith('.statusLogs')) return mergeStatusLogs(base, local, remote, path, conflicts);
    if (path.endsWith('.vesselProgress')) return mergeKeyedEntityArray(base, local, remote, path, 'vesselId', conflicts);
    conflicts.push(path);
    return clone(remote);
  }
  if (plainObject(base) && plainObject(local) && plainObject(remote)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    const metadataKeys = new Set(['updatedAt', 'updatedBy']);
    for (const key of keys) {
      if (metadataKeys.has(key)) continue;
      const value = mergeEntityValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) merged[key] = value;
    }
    const localAt = entityTimestamp(local);
    const remoteAt = entityTimestamp(remote);
    const metadataSource = localAt > remoteAt ? local : remote;
    for (const key of metadataKeys) {
      if (!(key in base) && !(key in local) && !(key in remote)) continue;
      const value = metadataSource[key] ?? local[key] ?? remote[key] ?? base[key];
      if (value !== undefined) merged[key] = clone(value);
    }
    return merged;
  }
  conflicts.push(path);
  return clone(remote);
}

function mergeCollection(key: CollectionKey, baseItems: Identified[], localItems: Identified[], remoteItems: Identified[], conflicts: string[]) {
  if(key==='auditLogs')return mergeImmutableAuditLogs(baseItems,localItems,remoteItems,conflicts);
  const baseById = new Map(baseItems.map(item => [item.id, item]));
  const localById = new Map(localItems.map(item => [item.id, item]));
  const remoteById = new Map(remoteItems.map(item => [item.id, item]));
  const ids = [...new Set([...localItems.map(item => item.id), ...remoteItems.map(item => item.id), ...baseItems.map(item => item.id)])];
  const merged: Identified[] = [];
  for (const id of ids) {
    const base = baseById.get(id);
    const local = localById.get(id);
    const remote = remoteById.get(id);
    if(base&&local&&remote&&FIELD_LEVEL_COLLECTIONS.has(key)){
      detectEntityDomainConflicts(key,id,base,local,remote,conflicts);
      validateNestedStatusHistory(base,local,remote,`${key}:${id}`,conflicts);
    }
    let resolved: Identified | undefined;
    if (equal(local, base)) resolved = remote;
    else if (equal(remote, base)) resolved = local;
    else if (equal(local, remote)) resolved = local;
    else if (base && local && remote && FIELD_LEVEL_COLLECTIONS.has(key)) resolved = mergeEntityValue(base, local, remote, `${key}:${id}`, conflicts) as Identified;
    else {
      conflicts.push(`${key}:${id}`);
      resolved = remote;
    }
    if (resolved) merged.push(clone(resolved));
  }
  if (key === 'notifications') return merged.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return merged;
}

export function rebaseDisjointAppData(base: AppData, local: AppData, remote: AppData, at: string,actorUserId?:string): AppData {
  const conflicts: string[] = [];
  for (const key of COLLECTION_KEYS) {
    validateCollectionIds(key, 'base', base[key] as Identified[], conflicts);
    validateCollectionIds(key, 'local', local[key] as Identified[], conflicts);
    validateCollectionIds(key, 'remote', remote[key] as Identified[], conflicts);
  }
  if (conflicts.length) throw new CloudRebaseConflictError([...new Set(conflicts)]);
  detectDependencyConflicts(base,local,remote,conflicts,actorUserId);
  if (conflicts.length) throw new CloudRebaseConflictError([...new Set(conflicts)]);
  const settings = mergeSettingsValue(base.settings, local.settings, remote.settings, 'settings', conflicts) as AppData['settings'];
  const merged = { ...clone(remote), settings } as AppData;
  for (const key of COLLECTION_KEYS) {
    (merged[key] as Identified[]) = mergeCollection(key, base[key] as Identified[], local[key] as Identified[], remote[key] as Identified[], conflicts) as any;
  }
  if (conflicts.length) throw new CloudRebaseConflictError([...new Set(conflicts)]);
  merged.revision = remote.revision + 1;
  merged.updatedAt = at;
  return merged;
}

export function prepareCloudSyncSnapshot(base: AppData | null, local: AppData, remote: AppData, expectedRevision: number, at: string,actorUserId?:string): AppData {
  if (remote.revision < expectedRevision) throw new CloudRebaseConflictError(['缺少可信的雲端合併基線']);
  if(base&&(remote.revision<base.revision||(remote.revision===base.revision&&!appDataContentEqual(base,remote))))throw new CloudRebaseConflictError(['缺少可信的雲端合併基線']);
  if (base && base.revision <= expectedRevision && base.revision <= remote.revision && local.revision >= base.revision) {
    if (appDataContentEqual(local, base)) return clone(remote);
    return rebaseDisjointAppData(base,local,remote,at,actorUserId);
  }
  if (appDataContentEqual(local, remote)) return clone(remote);
  throw new CloudRebaseConflictError(['缺少可信的雲端合併基線']);
}
