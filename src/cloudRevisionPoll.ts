type PollClock = {
  every: (callback: () => Promise<void>, milliseconds: number) => unknown;
  clear: (handle: unknown) => void;
  visible: () => boolean;
};

/** Minimal invalidation only: the App's existing safe wakeup owns fetching/adoption. */
export function startRecordRevisionPoll(
  readRevision: (signal: AbortSignal) => Promise<unknown>,
  onRevision: (revision: number) => void,
  clock: PollClock = {
    every: (callback, milliseconds) => window.setInterval(() => { void callback(); }, milliseconds),
    clear: handle => window.clearInterval(handle as number),
    visible: () => document.visibilityState === 'visible',
  },
): () => void {
  let stopped = false;
  let active: AbortController | null = null;
  const tick = async () => {
    if (stopped || active || !clock.visible()) return;
    const controller = new AbortController();
    active = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const revision = await readRevision(controller.signal);
      if (stopped) return;
      if (revision === null) { stop(); return; } // Optional additive RPC not installed.
      if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0) onRevision(revision);
    } catch { /* Preserve existing Realtime/focus/online paths; never adopt data on error. */ }
    finally { clearTimeout(timeout); if (active === controller) active = null; }
  };
  const timer = clock.every(tick, 15000);
  const stop = () => {
    if (stopped) return;
    stopped = true; clock.clear(timer); active?.abort();
  };
  return stop;
}
