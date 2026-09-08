import { buildCloudBlockPatch, type CloudBlockPatchOperation } from './cloudBlockPatch';
import type { AppData } from './types';
import { normalizeAppData } from './normalize';
import { appDataContentEqual } from './cloudRebase';

export type RecordReadScope = 'home' | 'full';
type Row = { version: number; value: Record<string, unknown> };
export type RecordScopeSnapshot = { revision: number; root: Record<string, unknown>; collections: Record<string, { ids: string[]; rows: Record<string, Row> }> };
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function recordScopeVersions(base:RecordScopeSnapshot|null) {
  return Object.fromEntries(Object.entries(base?.collections||{}).map(([name,c])=>[name,Object.fromEntries(Object.entries(c.rows).map(([id,r])=>[id,r.version]))]));
}
export function consumeRecordScopes(value:unknown,workspace:string,scope:RecordReadScope,base:RecordScopeSnapshot|null):RecordScopeSnapshot|null {
  if(!object(value)||value.protocol!=='ship-dynamics-record-scopes-v1'||value.workspace_key!==workspace||value.scope!==scope)throw new Error('record-scope-response-mismatch');
  if(value.status==='missing')return null;
  if(value.status!=='scopes'||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||!object(value.root)||!object(value.collections))throw new Error('invalid-record-scope-response');
  const revision=Number(value.revision);
  if(value.root.revision!==revision)throw new Error('record-scope-revision-mismatch');
  const collections:RecordScopeSnapshot['collections']={};
  for(const [name,c] of Object.entries(value.collections)){
    if(!object(c)||!Array.isArray(c.ids)||!Array.isArray(c.rows)||c.ids.some(id=>typeof id!=='string')||new Set(c.ids).size!==c.ids.length)throw new Error('invalid-record-scope-order');
    const rows:Record<string,Row>={};
    for(const id of c.ids)if(base?.collections[name]?.rows[id])rows[id]=base.collections[name].rows[id];
    const received=new Set<string>();
    for(const r of c.rows){
      if(!object(r)||typeof r.id!=='string'||received.has(r.id)||!c.ids.includes(r.id)||!Number.isSafeInteger(r.version)||Number(r.version)>revision||Number(r.version)<0||!object(r.value)||r.value.id!==r.id)throw new Error('invalid-record-scope-row');
      received.add(r.id);rows[r.id]={version:Number(r.version),value:clone(r.value)};
    }
    if(c.ids.some(id=>!rows[id]))throw new Error('unloaded-record-scope-row');
    collections[name]={ids:[...c.ids],rows};
  }
  return {revision,root:clone(value.root),collections};
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
    delete v.snapshot;
  };
  for(const name of ['tasks','internalControlCases','meetings','agendaReports'] as const)for(const row of projected[name])summary(row as unknown as Record<string,unknown>);
  const normalized=normalizeAppData(projected);
  return !!normalized&&appDataContentEqual(normalized,remote);
}

function preserveRecordFields(before:unknown,after:unknown,raw:unknown):unknown {
  if(JSON.stringify(before)===JSON.stringify(after))return raw===undefined?undefined:clone(raw);
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
  assertRecordScopePatch(scope,operations);
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
export function assertRecordScopePatch(scope:RecordReadScope,operations:readonly CloudBlockPatchOperation[]) {
  if(scope==='full')return;
  if(operations.some(op=>op.kind!=='settings'&&['tasks','internalControlCases','meetings','agendaReports'].includes(op.collection)))throw new Error('record-detail-not-loaded');
}
