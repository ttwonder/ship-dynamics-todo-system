import type { AppData } from './types';

export const CLOUD_BLOCK_COLLECTIONS=[
  'users','vessels','tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs',
] as const;

const UNORDERED_COLLECTIONS=new Set<CloudBlockCollection>(['taskDismissals']);
const DERIVED_ORDER_COLLECTIONS=new Set<CloudBlockCollection>(['notifications','auditLogs']);

export type CloudBlockCollection=typeof CLOUD_BLOCK_COLLECTIONS[number];

type JsonObject=Record<string,unknown>;

export type CloudBlockEntityOperation={
  kind:'entity';
  collection:CloudBlockCollection;
  entityId:string;
  expected:JsonObject|null;
  value:JsonObject|null;
};

export type CloudBlockOrderOperation={
  kind:'order';
  collection:CloudBlockCollection;
  expectedIds:string[];
  valueIds:string[];
};

export type CloudBlockSettingsOperation={
  kind:'settings';
  expected:AppData['settings'];
  value:AppData['settings'];
};

export type CloudBlockPatchOperation=CloudBlockEntityOperation|CloudBlockOrderOperation|CloudBlockSettingsOperation;

export class CloudBlockPatchConflictError extends Error{
  constructor(readonly blockKey:string){super(`Cloud block CAS conflict: ${blockKey}`);this.name='CloudBlockPatchConflictError';}
}

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

const canonical=(value:unknown):string=>{
  if(value===null)return'null';
  if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
  if(typeof value==='object'){
    const record=value as Record<string,unknown>;
    return`{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  throw new TypeError(`Cloud block patch contains a non-JSON value (${typeof value})`);
};

const equal=(left:unknown,right:unknown)=>canonical(left)===canonical(right);

const entityArray=(snapshot:AppData,collection:CloudBlockCollection):JsonObject[]=>{
  const value=(snapshot as unknown as Record<string,unknown>)[collection];
  if(value===undefined&&collection==='taskDismissals')return[];
  if(!Array.isArray(value))throw new TypeError(`${collection} must be a JSON array`);
  return value as JsonObject[];
};

const indexEntities=(snapshot:AppData,collection:CloudBlockCollection)=>{
  const map=new Map<string,JsonObject>();
  for(const entity of entityArray(snapshot,collection)){
    const id=entity.id;
    if(typeof id!=='string'||!id)throw new TypeError(`${collection} entity is missing a non-empty string id`);
    if(map.has(id))throw new TypeError(`duplicate ${collection} entity id: ${id}`);
    canonical(entity);
    map.set(id,entity);
  }
  return map;
};

const assertOperationShape=(operation:CloudBlockPatchOperation)=>{
  if(operation.kind==='settings'){
    canonical(operation.expected);canonical(operation.value);return;
  }
  if(!CLOUD_BLOCK_COLLECTIONS.includes(operation.collection))throw new TypeError(`Unsupported cloud block collection: ${String(operation.collection)}`);
  if(operation.kind==='order'){
    if(new Set(operation.expectedIds).size!==operation.expectedIds.length||new Set(operation.valueIds).size!==operation.valueIds.length)throw new TypeError(`duplicate id in ${operation.collection} order operation`);
    return;
  }
  if(!operation.entityId)throw new TypeError('Cloud block entity operation is missing entityId');
  for(const [label,value] of [['expected',operation.expected],['value',operation.value]] as const){
    if(value===null)continue;
    if(value.id!==operation.entityId)throw new TypeError(`${operation.collection}:${operation.entityId} ${label} id mismatch`);
    canonical(value);
  }
};

export function buildCloudBlockPatch(base:AppData,next:AppData,storageBase:AppData=base):CloudBlockPatchOperation[]{
  const jsonBase=clone(base);
  const jsonNext=clone(next);
  const jsonStorageBase=clone(storageBase);
  const operations:CloudBlockPatchOperation[]=[];
  canonical(jsonBase.settings);canonical(jsonNext.settings);
  canonical(jsonStorageBase.settings);
  if(!equal(jsonBase.settings,jsonNext.settings))operations.push({kind:'settings',expected:clone(jsonStorageBase.settings),value:clone(jsonNext.settings)});
  for(const collection of CLOUD_BLOCK_COLLECTIONS){
    const baseMap=indexEntities(jsonBase,collection);
    const nextMap=indexEntities(jsonNext,collection);
    const storageMap=indexEntities(jsonStorageBase,collection);
    const ids=[...new Set([...baseMap.keys(),...nextMap.keys()])].sort((left,right)=>left.localeCompare(right));
    let hasEntityOperation=false;
    for(const entityId of ids){
      const normalizedExpected=baseMap.get(entityId)||null;
      const expected=storageMap.get(entityId)||null;
      const value=nextMap.get(entityId)||null;
      if(!equal(normalizedExpected,value)){
        operations.push({kind:'entity',collection,entityId,expected:expected?clone(expected):null,value:value?clone(value):null});
        hasEntityOperation=true;
      }
    }
    const normalizedExpectedIds=entityArray(jsonBase,collection).map(entity=>entity.id as string);
    const expectedIds=entityArray(jsonStorageBase,collection).map(entity=>entity.id as string);
    const valueIds=entityArray(jsonNext,collection).map(entity=>entity.id as string);
    if(!equal(normalizedExpectedIds,valueIds)
      && !UNORDERED_COLLECTIONS.has(collection)
      && (!DERIVED_ORDER_COLLECTIONS.has(collection)||hasEntityOperation))operations.push({kind:'order',collection,expectedIds:[...expectedIds],valueIds:[...valueIds]});
  }
  operations.forEach(assertOperationShape);
  return operations;
}

export function applyCloudBlockPatch(base:AppData,operations:readonly CloudBlockPatchOperation[]):AppData{
  const jsonBase=clone(base);
  if(operations.length>10_000)throw new TypeError('Cloud block patch operation limit exceeded');
  const seen=new Set<string>();
  const indexes=new Map<CloudBlockCollection,Map<string,JsonObject>>();
  const getIndex=(collection:CloudBlockCollection)=>{
    let index=indexes.get(collection);
    if(!index){index=indexEntities(jsonBase,collection);indexes.set(collection,index);}
    return index;
  };

  for(const operation of operations){
    assertOperationShape(operation);
    const operationKey=operation.kind==='settings'?'settings':operation.kind==='order'?`order:${operation.collection}`:`entity:${operation.collection}:${operation.entityId}`;
    if(seen.has(operationKey))throw new TypeError(`duplicate cloud block operation: ${operationKey}`);
    seen.add(operationKey);
    if(operation.kind==='settings'){
      if(!equal(jsonBase.settings,operation.expected))throw new CloudBlockPatchConflictError('settings');
      continue;
    }
    const index=getIndex(operation.collection);
    if(operation.kind==='order'){
      const ids=entityArray(jsonBase,operation.collection).map(entity=>entity.id as string);
      if(!equal(ids,operation.expectedIds))throw new CloudBlockPatchConflictError(`order:${operation.collection}`);
      continue;
    }
    const current=index.get(operation.entityId)||null;
    if(!equal(current,operation.expected))throw new CloudBlockPatchConflictError(`${operation.collection}:${operation.entityId}`);
  }

  const result=clone(jsonBase);
  for(const operation of operations){
    if(operation.kind==='settings'){
      result.settings=clone(operation.value);
      continue;
    }
    if(operation.kind!=='entity')continue;
    const collection=result[operation.collection] as unknown as JsonObject[];
    const index=collection.findIndex(entity=>entity.id===operation.entityId);
    if(operation.value===null){
      if(index>=0)collection.splice(index,1);
    }else if(index>=0)collection[index]=clone(operation.value);
    else collection.push(clone(operation.value));
  }
  for(const operation of operations){
    if(operation.kind!=='order')continue;
    const collection=result[operation.collection] as unknown as JsonObject[];
    const byId=new Map(collection.map(entity=>[entity.id as string,entity]));
    if(byId.size!==operation.valueIds.length||operation.valueIds.some(id=>!byId.has(id)))throw new TypeError(`Cloud block order result does not match ${operation.collection} entity set`);
    (result[operation.collection] as unknown as JsonObject[])=operation.valueIds.map(id=>byId.get(id)!);
  }
  return result;
}
