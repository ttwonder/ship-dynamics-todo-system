const LEGACY_TASK_CREATION_LOCK_PREFIX='task-create:';
const TASK_CREATION_LOCK_PREFIX='task-create:v2:';

const encode=(value:string)=>encodeURIComponent(value);
const decode=(value:string)=>{try{return decodeURIComponent(value);}catch{return'';}};

export function taskCreationLockKey(vesselId:string,draftId?:string){
  if(!draftId)return`${LEGACY_TASK_CREATION_LOCK_PREFIX}${vesselId}`;
  return `${TASK_CREATION_LOCK_PREFIX}${encode(vesselId)}:${encode(draftId)}`;
}

export function isTaskCreationLockKey(sectionKey:string){
  return sectionKey.startsWith(TASK_CREATION_LOCK_PREFIX)
    ? sectionKey.slice(TASK_CREATION_LOCK_PREFIX.length).includes(':')
    : sectionKey.startsWith(LEGACY_TASK_CREATION_LOCK_PREFIX)&&sectionKey.length>LEGACY_TASK_CREATION_LOCK_PREFIX.length;
}

export function taskCreationLockMatchesVessel(sectionKey:string,vesselId:string){
  if(sectionKey.startsWith(TASK_CREATION_LOCK_PREFIX)){
    const encoded=sectionKey.slice(TASK_CREATION_LOCK_PREFIX.length).split(':',1)[0];
    return decode(encoded)===vesselId;
  }
  return sectionKey===`${LEGACY_TASK_CREATION_LOCK_PREFIX}${vesselId}`;
}
