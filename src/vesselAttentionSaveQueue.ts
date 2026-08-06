import type { WeeklyAttentionKey } from './types';

export type VesselAttentionSavePhase = 'pending' | 'saving' | 'error' | 'saved';

export type VesselAttentionSaveState = {
  phase: VesselAttentionSavePhase;
  desired: WeeklyAttentionKey[];
  message?: string;
};

type Scheduler = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type QueueOptions = {
  persist: (vesselId: string, desired: WeeklyAttentionKey[]) => Promise<void>;
  onState: (vesselId: string, state: VesselAttentionSaveState) => void;
  debounceMs?: number;
  scheduler?: Scheduler;
};

type QueueEntry = {
  desired: WeeklyAttentionKey[];
  timer: unknown | null;
  running: boolean;
};

const defaultScheduler: Scheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const normalize = (value: WeeklyAttentionKey[]) => value.filter((item, index) => value.indexOf(item) === index);
const equal = (left: WeeklyAttentionKey[], right: WeeklyAttentionKey[]) => left.length === right.length && left.every((item, index) => item === right[index]);
const messageFor = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createVesselAttentionSaveQueue(options: QueueOptions) {
  const debounceMs = options.debounceMs ?? 400;
  const scheduler = options.scheduler ?? defaultScheduler;
  const entries = new Map<string, QueueEntry>();

  const emit = (vesselId: string, entry: QueueEntry, phase: VesselAttentionSavePhase, message?: string) => {
    options.onState(vesselId, { phase, desired: [...entry.desired], ...(message ? { message } : {}) });
  };

  const run = async (vesselId: string) => {
    const entry = entries.get(vesselId);
    if (!entry || entry.running) return;
    if (entry.timer !== null) {
      scheduler.clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.running = true;
    const sent = [...entry.desired];
    emit(vesselId, entry, 'saving');
    try {
      await options.persist(vesselId, sent);
      if (entries.get(vesselId) !== entry) return;
      entry.running = false;
      if (!equal(entry.desired, sent)) {
        emit(vesselId, entry, 'pending');
        void run(vesselId);
        return;
      }
      entries.delete(vesselId);
      emit(vesselId, entry, 'saved');
    } catch (error) {
      if (entries.get(vesselId) !== entry) return;
      entry.running = false;
      emit(vesselId, entry, 'error', messageFor(error));
    }
  };

  const schedule = (vesselId: string, entry: QueueEntry, delayMs: number) => {
    if (entry.timer !== null) scheduler.clearTimeout(entry.timer);
    emit(vesselId, entry, 'pending');
    entry.timer = scheduler.setTimeout(() => {
      entry.timer = null;
      void run(vesselId);
    }, delayMs);
  };

  return {
    enqueue(vesselId: string, desired: WeeklyAttentionKey[]) {
      const normalized = normalize(desired);
      const existing = entries.get(vesselId);
      if (existing) {
        existing.desired = normalized;
        if (existing.running) emit(vesselId, existing, 'saving');
        else schedule(vesselId, existing, debounceMs);
        return;
      }
      const entry: QueueEntry = { desired: normalized, timer: null, running: false };
      entries.set(vesselId, entry);
      schedule(vesselId, entry, debounceMs);
    },
    retry(vesselId: string) {
      const entry = entries.get(vesselId);
      if (!entry || entry.running) return false;
      schedule(vesselId, entry, 0);
      return true;
    },
    desired(vesselId: string) {
      const desired = entries.get(vesselId)?.desired;
      return desired ? [...desired] : null;
    },
    hasPending: () => entries.size > 0,
    dispose() {
      for (const entry of entries.values()) if (entry.timer !== null) scheduler.clearTimeout(entry.timer);
      entries.clear();
    },
  };
}
