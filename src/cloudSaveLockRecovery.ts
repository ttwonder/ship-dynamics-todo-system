import type { CloudBlockPatchOperation } from './cloudBlockPatch';
import { existingEntityLockKeysForPatch, recoveryCreationLockKeysForPatch } from './collaborationLockPlan';
import { acquireEditLockBundle, type EditLockBundleClaimResult, type EditLockBundleRequest } from './editLockBundle';

export type CloudSaveLockGuard={section_key:string;locked_by:string};

export class CloudSaveRecoveryLockConflictError extends Error{
  constructor(readonly sectionKey:string,readonly lockedByName:string,readonly cleanupFailed=false){
    super(`${sectionKey} 正在由 ${lockedByName} 編輯`);
    this.name='CloudSaveRecoveryLockConflictError';
  }
}

type RecoveryLockInput<T>={
  operations:readonly CloudBlockPatchOperation[];
  existingGuards:readonly CloudSaveLockGuard[];
  createLeaseOwnerId:(sectionKey:string)=>string;
  stillCurrent:()=>boolean;
  renew:(request:EditLockBundleRequest)=>Promise<EditLockBundleClaimResult>;
  claim:(request:EditLockBundleRequest)=>Promise<EditLockBundleClaimResult>;
  release:(request:EditLockBundleRequest)=>Promise<void>;
  run:(guards:CloudSaveLockGuard[])=>Promise<T>;
};

export async function runWithCloudSaveRecoveryLocks<T>(input:RecoveryLockInput<T>):Promise<{value:T;cleanupFailed:boolean}>{
  const usableExistingGuards:CloudSaveLockGuard[]=[];
  const staleGuardSections=new Set<string>();
  for(const guard of input.existingGuards){
    if(!input.stillCurrent())throw new Error('雲端保存補鎖已取消');
    const renewed=await input.renew({sectionKey:guard.section_key,label:guard.section_key,leaseOwnerId:guard.locked_by});
    if(!input.stillCurrent())throw new Error('雲端保存補鎖已取消');
    if(renewed.ok)usableExistingGuards.push(guard);
    else staleGuardSections.add(guard.section_key);
  }
  const coveredSections=new Set(usableExistingGuards.map(guard=>guard.section_key));
  const requiredSections=[...new Set([
    ...staleGuardSections,
    ...recoveryCreationLockKeysForPatch(input.operations),
    ...existingEntityLockKeysForPatch(input.operations),
  ])]
    .filter(sectionKey=>!coveredSections.has(sectionKey))
    .sort((left,right)=>left.localeCompare(right));
  const requests=requiredSections
    .map(sectionKey=>({sectionKey,label:sectionKey,leaseOwnerId:input.createLeaseOwnerId(sectionKey)}));
  const bundle=await acquireEditLockBundle(requests,input.claim,input.release,input.stillCurrent);
  if(bundle.status!=='owned'){
    if(bundle.status==='blocked')throw new CloudSaveRecoveryLockConflictError(bundle.sectionKey,bundle.lockedByName,bundle.cleanupFailed);
    if(bundle.status==='unavailable')throw bundle.error;
    throw new Error('雲端保存補鎖已取消');
  }
  if(!input.stillCurrent()){
    await Promise.allSettled([...bundle.leases].reverse().map(input.release));
    throw new Error('雲端保存補鎖已取消');
  }
  const recoveryGuards=bundle.leases.map(lease=>({section_key:lease.sectionKey,locked_by:lease.leaseOwnerId}));
  let value:T;
  try{
    value=await input.run([...usableExistingGuards,...recoveryGuards]);
  }catch(error){
    await Promise.allSettled([...bundle.leases].reverse().map(input.release));
    throw error;
  }
  const released=await Promise.allSettled([...bundle.leases].reverse().map(input.release));
  return{value,cleanupFailed:released.some(result=>result.status==='rejected')};
}
