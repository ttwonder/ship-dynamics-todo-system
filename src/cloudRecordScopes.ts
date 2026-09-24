import { buildCloudBlockPatch, CLOUD_BLOCK_COLLECTIONS, CLOUD_RECORD_COLLECTIONS_V2, type CloudBlockPatchOperation } from './cloudBlockPatch';
import type { AppData } from './types';
import { normalizeAppData } from './normalize';
import { appDataContentEqual } from './cloudRebase';

export type RecordTarget = { collection: 'tasks' | 'internalControlCases' | 'meetings' | 'agendaReports' | 'trackingItems'; id: string };
export type RecordReadScope = 'home' | 'full' | 'morning' | { targets: RecordTarget[]; morning?: true; trackingVesselIds?:string[] };
export const isMorningRecordScope=(scope:RecordReadScope)=>scope==='morning'||(typeof scope==='object'&&scope.morning===true);
type Row = { version: number; detail?: boolean; value: Record<string, unknown> };
export const recordScopeKey=(scope:RecordReadScope)=>typeof scope==='string'?scope:JSON.stringify(scope);
export function unionRecordScopes(left:RecordReadScope,right:RecordReadScope):RecordReadScope {
  if(left==='full'||right==='full')return 'full';
  const targets=[...(typeof left==='object'?left.targets:[]),...(typeof right==='object'?right.targets:[])];
  const trackingVesselIds=[...new Set([...(typeof left==='object'?left.trackingVesselIds || []:[]),...(typeof right==='object'?right.trackingVesselIds || []:[])])].sort();
  if(trackingVesselIds.length)return {targets:[...new Map(targets.map(t=>[JSON.stringify([t.collection,t.id]),t])).values()],trackingVesselIds,...(isMorningRecordScope(left)||isMorningRecordScope(right)?{morning:true as const}:{})};
  if(isMorningRecordScope(left)||isMorningRecordScope(right))return {morning:true,targets};
  return targets.length?{targets:[...new Map(targets.map(t=>[JSON.stringify([t.collection,t.id]),t])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}:'home';
}
export function recordScopeGraph(scope:RecordReadScope,raw:AppData):Set<string> {
  const key=(collection:string,id:string)=>JSON.stringify([collection,id]);
  const keys=new Set(typeof scope==='object'?scope.targets.map(t=>key(t.collection,t.id)):[]);
  if(isMorningRecordScope(scope))for(const name of ['tasks','internalControlCases','meetings'] as const)for(const row of raw[name])keys.add(key(name,row.id));
  let changed=true;
  while(changed){changed=false;
  for(const source of raw.trackingItems || []){
    if(source.linkState!=='active'||!source.linkedCaseId)continue;
    const links=[key('trackingItems',source.id),key('internalControlCases',source.linkedCaseId)];
    if(links.some(k=>keys.has(k)))for(const k of links)if(!keys.has(k)){keys.add(k);changed=true;}
  }
  for(const task of raw.tasks){
    const links=[key('tasks',task.id)];
    if(task.internalControlCaseId)links.push(key('internalControlCases',task.internalControlCaseId));
    if(task.sourceMeetingId)links.push(key('meetings',task.sourceMeetingId));
    for(const c of raw.internalControlCases)if(c.linkedTaskId===task.id)links.push(key('internalControlCases',c.id));
    if(links.some(k=>keys.has(k)))for(const k of links)if(!keys.has(k)){keys.add(k);changed=true;}
  }}
  return keys;
}
/** Reconstruct only read coverage from surviving AppData, never a request/CAS.
 * Home omits history tails and report snapshots; every retained detail or local
 * changed row needs its original target graph before comparing the trusted base.
 */
export function recordRecoveryReadScope(base:AppData,local:AppData):RecordReadScope {
  const targets:RecordTarget[]=[];
  const hasDetail=(value:unknown):boolean=>{
    if(!value||typeof value!=='object')return false;
    if(Array.isArray(value))return value.some(hasDetail);
    const row=value as Record<string,unknown>;
    return Object.prototype.hasOwnProperty.call(row,'snapshot')||(Array.isArray(row.statusLogs)&&row.statusLogs.length>2)||Object.values(row).some(hasDetail);
  };
  for(const collection of ['tasks','internalControlCases','meetings','agendaReports','trackingItems'] as const){
    const before=new Map<string,unknown>((base[collection] || []).map((row):[string,unknown]=>[row.id,row]));
    const after=new Map<string,unknown>((local[collection] || []).map((row):[string,unknown]=>[row.id,row]));
    for(const id of new Set([...before.keys(),...after.keys()])){
      const b=before.get(id),l=after.get(id);
      if(JSON.stringify(b)!==JSON.stringify(l)||hasDetail(b)||hasDetail(l))targets.push({collection,id});
    }
  }
  const trackingVesselIds=[...new Set([...(base.trackingItems || []),...(local.trackingItems || [])].map(row=>row.vesselId))].sort();
  return unionRecordScopes('home',{targets,trackingVesselIds});
}
export type RecordScopeSnapshot = { scopeKey:string; workspace:string; revision: number; root: Record<string, unknown>; collections: Record<string, { ids: string[]; rows: Record<string, Row> }> };
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function recordScopeVersions(base:RecordScopeSnapshot|null) {
  return Object.fromEntries(Object.entries(base?.collections||{}).map(([name,c])=>[name,Object.fromEntries(Object.entries(c.rows).map(([id,r])=>[id,{version:r.version,detail:!!r.detail}]))]));
}
export function consumeRecordScopes(value:unknown,workspace:string,scope:RecordReadScope,base:RecordScopeSnapshot|null):RecordScopeSnapshot|null {
  if(!object(value)||!['ship-dynamics-record-scopes-v1','ship-dynamics-record-scopes-v2'].includes(String(value.protocol))||value.workspace_key!==workspace||value.scope!==(typeof scope==='string'?scope:'targets')||(typeof scope==='object'&&(!Array.isArray(value.targets)||JSON.stringify(value.targets.map(t=>object(t)?[t.collection,t.id]:null))!==JSON.stringify(scope.targets.map(t=>[t.collection,t.id])))))throw new Error('record-scope-response-mismatch');
  const v2=value.protocol==='ship-dynamics-record-scopes-v2';
  if(v2&&JSON.stringify(value.vessel_ids)!==JSON.stringify(typeof scope==='object'?scope.trackingVesselIds || []:[]))throw new Error('record-scope-vessel-mismatch');
  const collectionNames=v2?CLOUD_RECORD_COLLECTIONS_V2:CLOUD_BLOCK_COLLECTIONS;
  if(base&&(base.scopeKey!==recordScopeKey(scope)||base.workspace!==workspace))throw new Error('record-scope-base-mismatch');
  if(value.status==='missing')return null;
  if(value.status!=='scopes'||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||!object(value.root)||!object(value.collections))throw new Error('invalid-record-scope-response');
  if(Object.keys(value.collections).length!==collectionNames.length||collectionNames.some(name=>!Object.prototype.hasOwnProperty.call(value.collections,name)))throw new Error('invalid-record-scope-collections');
  const revision=Number(value.revision);
  if(base&&revision<base.revision)throw new Error('record-scope-version-rollback');
  if(value.root.revision!==revision)throw new Error('record-scope-revision-mismatch');
  const collections:RecordScopeSnapshot['collections']={};
  for(const [name,c] of Object.entries(value.collections)){
    if(!object(c)||!Array.isArray(c.ids)||!Array.isArray(c.rows)||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new Error('invalid-record-scope-order');
    const rows:Record<string,Row>=Object.create(null);
    for(const id of c.ids)if(base?.collections[name]&&Object.prototype.hasOwnProperty.call(base.collections[name].rows,id))rows[id]=base.collections[name].rows[id];
    const received=new Set<string>();
    for(const r of c.rows){
      if(!object(r)||typeof r.id!=='string'||received.has(r.id)||!c.ids.includes(r.id)||!Number.isSafeInteger(r.version)||Number(r.version)>revision||Number(r.version)<0||typeof r.detail!=='boolean'||!object(r.value)||r.value.id!==r.id)throw new Error('invalid-record-scope-row');
      received.add(r.id);rows[r.id]={version:Number(r.version),detail:r.detail===true,value:clone(r.value)};
    }
    if(c.ids.some(id=>!rows[id]))throw new Error('unloaded-record-scope-row');
    collections[name]={ids:[...c.ids],rows};
  }
  const snapshot={scopeKey:recordScopeKey(scope),workspace,revision,root:clone(value.root),collections};
  const graph=recordScopeGraph(scope,recordScopePayload(snapshot) as unknown as AppData);
  for(const [name,c] of Object.entries(collections))for(const id of c.ids){
    const expected=scope==='full'||!['tasks','internalControlCases','meetings','agendaReports'].includes(name)||graph.has(JSON.stringify([name,id]));
    if(c.rows[id].detail!==expected)throw new Error('record-scope-coverage-mismatch');
  }
  return snapshot;
}
export function recordScopePayload(snapshot:RecordScopeSnapshot) {
  return clone({...snapshot.root,...Object.fromEntries(Object.entries(snapshot.collections).map(([name,c])=>[name,c.ids.map(id=>c.rows[id].value)]))});
}
/** Collapse only a proven clean cache; never project an unsaved local draft. */
export function cleanRecordHomeCacheMatches(local:AppData,confirmed:AppData|null,remote:AppData):boolean {
  if(!confirmed||!appDataContentEqual(local,confirmed))return false;
  const projected=clone(confirmed);
  const summary=(v:Record<string,unknown>)=>{
    if(Array.isArray(v.statusLogs))v.statusLogs=v.statusLogs.slice(0,2);
    if(Array.isArray(v.vesselProgress))for(const p of v.vesselProgress)summary(p);
    const snapshot=v.snapshot;
    if(object(snapshot)&&Array.isArray(snapshot.vessels)&&Array.isArray(snapshot.tasks)&&Array.isArray(snapshot.meetings)){v.__recordSnapshotAvailable=true;v.__recordMorningTimes={windowEndedAt:typeof snapshot.windowEndedAt==='string'?snapshot.windowEndedAt:'',capturedAt:typeof snapshot.capturedAt==='string'?snapshot.capturedAt:''};}
    delete v.snapshot;
  };
  for(const name of ['tasks','internalControlCases','meetings','agendaReports'] as const)for(const row of projected[name])summary(row as unknown as Record<string,unknown>);
  const normalized=normalizeAppData(projected);
  return !!normalized&&appDataContentEqual(normalized,remote);
}

function preserveRecordFields(before:unknown,after:unknown,raw:unknown):unknown {
  if(JSON.stringify(before)===JSON.stringify(after))return raw===undefined?undefined:clone(raw);
  if(Array.isArray(before)&&Array.isArray(after)&&Array.isArray(raw)){
    const field=[...before,...after].every(v=>object(v)&&typeof v.id==='string')?'id':[...before,...after].every(v=>object(v)&&typeof v.vesselId==='string')?'vesselId':null;
    if(field&&new Set(before.map(v=>v[field])).size===before.length&&new Set(after.map(v=>v[field])).size===after.length){
      const old=new Map(before.map(v=>[v[field],v])),source=new Map(raw.filter(object).map(v=>[v[field],v]));
      const result=after.map(v=>preserveRecordFields(old.get(v[field]),v,source.get(v[field])));
      // Normalization may omit malformed raw entries: omission is not deletion.
      const opaque=raw.filter(v=>!object(v)||!old.has(v[field]));
      for(const v of opaque){
        const at=raw.indexOf(v),anchor=raw.slice(at+1).find(x=>object(x)&&old.has(x[field])&&after.some(a=>a[field]===x[field]));
        const index=anchor?result.findIndex(x=>object(x)&&x[field]===anchor[field]):-1;
        if(index<0)result.push(clone(v));else result.splice(index,0,clone(v));
      }
      return result;
    }
  }
  if(object(before)&&object(after)&&object(raw)){
    const result=clone(raw);
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
      if(!Object.prototype.hasOwnProperty.call(after,key)){delete result[key];continue;}
      const value=preserveRecordFields(before[key],after[key],raw[key]);
      if(value===undefined)delete result[key];else result[key]=value;
    }
    return result;
  }
  return after===undefined?undefined:clone(after);
}
export function buildRecordScopePatch(base:AppData,next:AppData,raw:AppData,scope:RecordReadScope):CloudBlockPatchOperation[]{
  const operations=buildCloudBlockPatch(base,next,raw);
  assertRecordScopePatch(scope,operations,raw);
  return operations.map(op=>{
    if(op.kind==='order')return op;
    if(op.kind==='settings')return {...op,value:preserveRecordFields(base.settings,next.settings,raw.settings) as AppData['settings']};
    if(!op.expected||!op.value)return op;
    const before=base[op.collection]?.find(row=>row.id===op.entityId);
    const value=preserveRecordFields(before,op.value,op.expected) as Record<string,unknown>;
    // The original editor's one dynamics field replaces both legacy note lanes.
    if(op.collection==='vessels'&&object(value.note)&&object(op.value.note)&&object((before as unknown as Record<string,unknown>)?.note)&&JSON.stringify((before as unknown as {note:{recentDynamics:string}}).note.recentDynamics)!==JSON.stringify(op.value.note.recentDynamics))value.note.subsequentDynamics='';
    return {...op,value};
  });
}

/** Summaries are not writable bodies. Only complete collections may be patched. */
export function assertRecordScopePatch(scope:RecordReadScope,operations:readonly CloudBlockPatchOperation[],raw?:AppData) {
  if(scope==='full')return;
  const loaded=raw?recordScopeGraph(scope,raw):new Set<string>();
  if(operations.some(op=>op.kind!=='settings'&&['tasks','internalControlCases','meetings','agendaReports'].includes(op.collection)&&
    !(op.kind==='order'||(op.kind==='entity'&&((raw&&typeof op.entityId==='string'&&!op.expected&&!raw[op.collection].some(row=>row.id===op.entityId))||loaded.has(JSON.stringify([op.collection,op.entityId])))))))throw new Error('record-detail-not-loaded');
}
