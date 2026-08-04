import type { CloudEditingLock } from './cloud';

export const CLOUD_SAVE_QUEUE_SECTION_KEY = 'workspace-save';
export const CLOUD_SAVE_QUEUE_TTL_SECONDS = 30;

export class CloudSaveQueueTimeoutError extends Error {
  lockedByName?: string;
  lockAcquired: boolean;

  constructor(lockedByName?: string,lockAcquired=false) {
    super(lockedByName ? `雲端保存仍由 ${lockedByName} 處理中` : '雲端保存隊列等待逾時');
    this.name = 'CloudSaveQueueTimeoutError';
    this.lockedByName = lockedByName;
    this.lockAcquired = lockAcquired;
  }
}

export class CloudSaveQueueCancelledError extends Error {
  constructor() {
    super('雲端設定或保存請求已變更，已取消舊的保存排隊');
    this.name = 'CloudSaveQueueCancelledError';
  }
}

export class CloudSaveQueueRpcTimeoutError extends Error {
  constructor(operationName: string) {
    super(`${operationName}逾時`);
    this.name = 'CloudSaveQueueRpcTimeoutError';
  }
}

type SaveTurnOptions = {
  claim: () => Promise<CloudEditingLock>;
  isCurrent: () => boolean;
  onWaiting?: (lock: CloudEditingLock) => void;
  retryDelayMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

type DrainSaveQueueOptions = {
  hasPending: () => boolean;
  processPendingBatch: () => Promise<void>;
};

export type CloudSaveIntentQueueEntry<T> = {
  value: T;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

export function createCloudSaveIntentQueue<T>() {
  const entries: CloudSaveIntentQueueEntry<T>[] = [];
  return {
    enqueue(value: T) {
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const completion = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      entries.push({ value, resolve, reject });
      return completion;
    },
    peek: () => entries[0],
    shift: () => entries.shift(),
    size: () => entries.length,
    rejectAll(reason: unknown) {
      for (const entry of entries.splice(0)) entry.reject(reason);
    },
  };
}

type VisibleSaveStateOptions<T> = {
  live: T;
  confirmed: T | null;
  lastSaved: T | null;
  lastSavedWasRendered: boolean;
  visibleBaseline: T | null;
  equals: (left: T, right: T) => boolean;
  liveRevision: number;
  confirmedRevision: number;
};

export function hasUnconfirmedVisibleChanges<T>(options: VisibleSaveStateOptions<T>): boolean {
  if(options.lastSaved&&!options.lastSavedWasRendered&&options.visibleBaseline){
    return !options.equals(options.live,options.visibleBaseline);
  }
  return options.confirmed
    ?!options.equals(options.live,options.confirmed)
    :options.liveRevision>options.confirmedRevision;
}

export async function runCloudSaveQueueRpc<T>(operationName: string, operation: (signal: AbortSignal) => Promise<T>, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort();
      reject(new CloudSaveQueueRpcTimeoutError(operationName));
    },timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal),timeout]);
  } catch (error) {
    if (controller.signal.aborted) throw new CloudSaveQueueRpcTimeoutError(operationName);
    throw error;
  } finally {
    if(timer!==undefined)clearTimeout(timer);
  }
}

export async function waitForCloudSaveTurn(options: SaveTurnOptions): Promise<{ lock: CloudEditingLock; waited: boolean }> {
  const retryDelayMs = options.retryDelayMs ?? 500;
  const maxWaitMs = options.maxWaitMs ?? 32_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  const startedAt = now();
  let waited = false;
  let lockedByName: string | undefined;

  while (options.isCurrent()) {
    if (now() - startedAt >= maxWaitMs) throw new CloudSaveQueueTimeoutError(lockedByName);
    const lock = await options.claim();
    if (now() - startedAt >= maxWaitMs) throw new CloudSaveQueueTimeoutError(lock.lockedByName ?? lockedByName,lock.ok);
    if (lock.ok) return { lock, waited };
    lockedByName = lock.lockedByName;
    if (!waited) options.onWaiting?.(lock);
    waited = true;
    const elapsed = now() - startedAt;
    if (elapsed >= maxWaitMs) throw new CloudSaveQueueTimeoutError(lockedByName);
    await sleep(Math.min(retryDelayMs, Math.max(1, maxWaitMs - elapsed)));
  }

  throw new CloudSaveQueueCancelledError();
}

export async function drainCloudSaveQueueUntilStable(options: DrainSaveQueueOptions): Promise<number> {
  let processedBatches = 0;
  while (options.hasPending()) {
    await options.processPendingBatch();
    processedBatches += 1;
  }
  return processedBatches;
}
