export type EditLockCoordinator = {
  beginGeneration: () => number;
  invalidate: () => number;
  isCurrent: (generation: number) => boolean;
  run: <T>(operation: () => Promise<T>) => Promise<T>;
};

export type MutationLeaseCandidate = {
  sectionKey: string;
  status: 'owned' | 'blocked' | 'error';
  ownerUserId: string;
  authorizationEpoch: string;
  generation: number;
  validatedUntilMs: number;
};

export function editLockAllowsMutation(
  lock: MutationLeaseCandidate|null|undefined,
  sectionKey: string,
  userId: string|undefined,
  liveEpoch: string,
  generationIsCurrent: boolean,
  hasLeaseRecord: boolean,
  nowMs=Date.now(),
) {
  return Boolean(lock&&lock.status==='owned'&&lock.sectionKey===sectionKey&&lock.ownerUserId===userId
    &&lock.authorizationEpoch===liveEpoch&&generationIsCurrent&&hasLeaseRecord&&lock.validatedUntilMs>nowMs);
}

export function conservativeLeaseDeadline(expiresAt: string|undefined, nowMs=Date.now()) {
  const serverDeadline=expiresAt?Date.parse(expiresAt):Number.NaN;
  return Number.isFinite(serverDeadline)?Math.min(nowMs+60_000,serverDeadline-5_000):nowMs;
}

export function classifyVesselLeaseRenewalFailure(validatedUntilMs:number,nowMs=Date.now()):'retrying'|'frozen' {
  return validatedUntilMs>nowMs?'retrying':'frozen';
}

export function classifyMutationLeaseFailure(sectionKey:string):'freeze-vessel-draft'|'close-editor' {
  return sectionKey.startsWith('vessel:')?'freeze-vessel-draft':'close-editor';
}

export function classifyExpiredLeaseRelease(sectionKey:string,vesselSaveInFlight:boolean):'defer-for-durability'|'release' {
  return sectionKey.startsWith('vessel:')&&vesselSaveInFlight?'defer-for-durability':'release';
}

export function classifyVesselLeaseIncidentClose(mode:'editable'|'retrying'|'frozen'):'confirm-discard'|'normal-close' {
  return mode==='editable'?'normal-close':'confirm-discard';
}

export function classifyLeaseRenewalAfterAwait(input:{
  sectionKey:string;
  renewalTargetIsCurrent:boolean;
  cloudConfigStillCurrent:boolean;
  durableCreationHandoff:boolean;
}):'continue'|'stale-result'|'freeze-vessel-draft'|'close-editor' {
  if(!input.renewalTargetIsCurrent)return'stale-result';
  if(input.cloudConfigStillCurrent||input.durableCreationHandoff)return'continue';
  return input.sectionKey.startsWith('vessel:')?'freeze-vessel-draft':'close-editor';
}

type VesselEditorCloudGateIncident={
  sectionKey:string;
  ownerUserId:string;
  authorizationEpoch:string;
  mode:'retrying'|'frozen';
};

export function shouldRenderProductionCloudSafetyGate(input:{
  productionCloudUnavailable:boolean;
  editingVesselId:string;
  currentUserId:string;
  authorizationEpoch:string;
  activeVesselIds:readonly string[];
  incident:VesselEditorCloudGateIncident|null|undefined;
}) {
  if(!input.productionCloudUnavailable)return false;
  const incident=input.incident;
  const preserveMountedDraft=Boolean(
    input.editingVesselId&&input.currentUserId&&incident
    &&incident.sectionKey===`vessel:${input.editingVesselId}`
    &&incident.ownerUserId===input.currentUserId
    &&incident.authorizationEpoch===input.authorizationEpoch
    &&input.activeVesselIds.includes(input.editingVesselId),
  );
  return!preserveMountedDraft;
}

export function createEditLockCoordinator(): EditLockCoordinator {
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    beginGeneration: () => ++generation,
    invalidate: () => ++generation,
    isCurrent: candidate => candidate === generation,
    run: operation => {
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
