export type DurableCreationHandoffOptions<T> = {
  snapshot: T;
  persist: (snapshot: T) => Promise<T>;
  isCurrent: () => boolean;
  onDurable?: (confirmed: T) => void;
  commit: (confirmed: T) => void;
};

export async function runDurableCreationHandoff<T>({ snapshot, persist, isCurrent, onDurable, commit }: DurableCreationHandoffOptions<T>): Promise<boolean> {
  if (!isCurrent()) return false;
  const confirmed = await persist(snapshot);
  onDurable?.(confirmed);
  if (!isCurrent()) return false;
  commit(confirmed);
  return true;
}

export type DurableCreationHandoffBarrier = { leaseOwnerId: string; promise: Promise<unknown> };

export async function waitForDurableCreationHandoff(barrier: DurableCreationHandoffBarrier | null | undefined, leaseOwnerId: string): Promise<void> {
  if (!barrier || barrier.leaseOwnerId !== leaseOwnerId) return;
  try { await barrier.promise; } catch { /* persistence failure still settles the release barrier */ }
}
