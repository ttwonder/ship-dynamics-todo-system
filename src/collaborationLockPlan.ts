import type { CloudBlockCollection, CloudBlockPatchOperation } from './cloudBlockPatch';
import { vesselPatchRequiresCollaborationLock } from './cloudAuthorization';
import { internalControlCreationLockKey } from './exclusiveItemEditLock';

type TaskRelationSnapshot={
  tasks:readonly {id:string;sourceMeetingId?:string;internalControlCaseId?:string}[];
  meetings:readonly {id:string}[];
  internalControlCases:readonly {id:string;linkedTaskId?:string}[];
};

type TaskInternalControlCreationCandidate={id:string;isInternalControl?:boolean};

export function taskCreationRelatedLockKeys(
  vesselIds:readonly string[],
  candidate:TaskInternalControlCreationCandidate,
  meetingSource:boolean,
):string[]{
  const keys=new Set(vesselIds.filter(Boolean).map(vesselId=>`vessel:${vesselId}`));
  if(candidate.isInternalControl&&!meetingSource)keys.add(internalControlCreationLockKey(candidate.id));
  return[...keys].sort((left,right)=>left.localeCompare(right));
}

export function lockKeyForExistingEntity(collection:CloudBlockCollection,entityId:string):string|null{
  if(!entityId)return null;
  if(collection==='vessels')return`vessel:${entityId}`;
  if(collection==='tasks')return`task:${entityId}`;
  if(collection==='meetings')return`meeting:${entityId}`;
  if(collection==='internalControlCases')return`internal-control:${entityId}`;
  return null;
}

export function existingEntityLockKeysForPatch(operations:readonly CloudBlockPatchOperation[]):string[]{
  const keys=new Set<string>();
  for(const operation of operations){
    if(operation.kind!=='entity'||operation.expected===null)continue;
    if(operation.collection==='vessels'&&!vesselPatchRequiresCollaborationLock(operation.expected,operation.value))continue;
    const key=lockKeyForExistingEntity(operation.collection,operation.entityId);
    if(key)keys.add(key);
  }
  return[...keys].sort((left,right)=>left.localeCompare(right));
}

export function taskRelationLockKeys(snapshot:TaskRelationSnapshot,taskIds:readonly string[]):string[]{
  const selectedIds=new Set(taskIds);
  const meetingIds=new Set(snapshot.meetings.map(meeting=>meeting.id));
  const caseIds=new Set(snapshot.internalControlCases.map(item=>item.id));
  const keys=new Set([...selectedIds].map(id=>`task:${id}`));
  for(const task of snapshot.tasks){
    if(!selectedIds.has(task.id))continue;
    if(task.sourceMeetingId&&meetingIds.has(task.sourceMeetingId))keys.add(`meeting:${task.sourceMeetingId}`);
    if(task.internalControlCaseId&&caseIds.has(task.internalControlCaseId))keys.add(`internal-control:${task.internalControlCaseId}`);
  }
  for(const item of snapshot.internalControlCases){
    if(item.linkedTaskId&&selectedIds.has(item.linkedTaskId))keys.add(`internal-control:${item.id}`);
  }
  return[...keys].sort((left,right)=>left.localeCompare(right));
}

export function taskInternalControlCreationLockKeys(
  snapshot:Pick<TaskRelationSnapshot,'tasks'|'internalControlCases'>,
  candidate:TaskInternalControlCreationCandidate,
  meetingSource:boolean,
):string[]{
  if(meetingSource||!candidate.isInternalControl)return[];
  const existing=snapshot.tasks.find(task=>task.id===candidate.id);
  if(!existing)return[];
  const linkedCase=snapshot.internalControlCases.some(item=>item.id===existing.internalControlCaseId||item.linkedTaskId===existing.id);
  return linkedCase?[]:[internalControlCreationLockKey(candidate.id)];
}

export function relatedEntityLockKeysForSection(snapshot:TaskRelationSnapshot,sectionKey:string):string[]{
  if(sectionKey.startsWith('task:')){
    const taskId=sectionKey.slice('task:'.length);
    return taskRelationLockKeys(snapshot,[taskId]);
  }
  if(sectionKey.startsWith('meeting:')){
    const meetingId=sectionKey.slice('meeting:'.length);
    const linkedTaskIds=snapshot.tasks.filter(task=>task.sourceMeetingId===meetingId).map(task=>task.id);
    return taskRelationLockKeys(snapshot,linkedTaskIds).concat(sectionKey).filter((key,index,keys)=>keys.indexOf(key)===index).sort((left,right)=>left.localeCompare(right));
  }
  if(sectionKey.startsWith('internal-control:')){
    const caseId=sectionKey.slice('internal-control:'.length);
    const item=snapshot.internalControlCases.find(candidate=>candidate.id===caseId);
    const linkedTaskIds=snapshot.tasks.filter(task=>task.internalControlCaseId===caseId||Boolean(item?.linkedTaskId&&task.id===item.linkedTaskId)).map(task=>task.id);
    return taskRelationLockKeys(snapshot,linkedTaskIds).concat(sectionKey).filter((key,index,keys)=>keys.indexOf(key)===index).sort((left,right)=>left.localeCompare(right));
  }
  return[sectionKey];
}
