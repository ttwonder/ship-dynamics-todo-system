export type CloudWakeupAction='ignore'|'defer'|'refresh';

export interface CloudWakeupState{
  incomingRevision:number;
  confirmedRevision:number;
  hasUnsavedChanges:boolean;
  hasActiveItemLease:boolean;
  hasBatchLease:boolean;
  saveInFlight:boolean;
}

export function cloudWakeupAction(state:CloudWakeupState):CloudWakeupAction{
  if(!Number.isSafeInteger(state.incomingRevision)||state.incomingRevision<=state.confirmedRevision)return'ignore';
  if(state.hasUnsavedChanges||state.hasActiveItemLease||state.hasBatchLease||state.saveInFlight)return'defer';
  return'refresh';
}
