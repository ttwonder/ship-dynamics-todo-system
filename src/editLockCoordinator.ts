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
