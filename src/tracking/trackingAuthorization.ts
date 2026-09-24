import type { AppData } from '../types';
import type { CloudBlockPatchOperation } from '../cloudBlockPatch';
import { resolveTrackingGroup } from './trackingLifecycle';
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
