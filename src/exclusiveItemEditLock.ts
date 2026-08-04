const MEETING_PREFIX='meeting:';
const INTERNAL_CONTROL_PREFIX='internal-control:';
const MEETING_CREATION_PREFIX='meeting-create:';
const INTERNAL_CONTROL_CREATION_PREFIX='internal-control-create:';

const key=(prefix:string,id:string)=>`${prefix}${id}`;

export const meetingEditLockKey=(meetingId:string)=>key(MEETING_PREFIX,meetingId);
export const internalControlEditLockKey=(caseId:string)=>key(INTERNAL_CONTROL_PREFIX,caseId);
export const meetingCreationLockKey=(draftId:string)=>key(MEETING_CREATION_PREFIX,draftId);
export const internalControlCreationLockKey=(batchId:string)=>key(INTERNAL_CONTROL_CREATION_PREFIX,batchId);

export const isMeetingCreationLockKey=(sectionKey:string)=>sectionKey.startsWith(MEETING_CREATION_PREFIX)&&sectionKey.length>MEETING_CREATION_PREFIX.length;
export const isInternalControlCreationLockKey=(sectionKey:string)=>sectionKey.startsWith(INTERNAL_CONTROL_CREATION_PREFIX)&&sectionKey.length>INTERNAL_CONTROL_CREATION_PREFIX.length;

export function isExclusiveItemEditLockKey(sectionKey:string){
  return (sectionKey.startsWith(MEETING_PREFIX)&&sectionKey.length>MEETING_PREFIX.length)
    ||(sectionKey.startsWith(INTERNAL_CONTROL_PREFIX)&&sectionKey.length>INTERNAL_CONTROL_PREFIX.length)
    ||isMeetingCreationLockKey(sectionKey)
    ||isInternalControlCreationLockKey(sectionKey);
}
