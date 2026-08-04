export type DurableCreationHandoffOptions<T> = {
  snapshot: T;
  persist: (snapshot: T) => Promise<T>;
  isCurrent: () => boolean;
  onDurable?: (confirmed: T) => void;
  resolveCommittedValue: (confirmed: T, snapshot: T) => T;
  commit: (confirmed: T) => void;
};

export async function runDurableCreationHandoff<T>({ snapshot, persist, isCurrent, onDurable, resolveCommittedValue, commit }: DurableCreationHandoffOptions<T>): Promise<boolean> {
  if (!isCurrent()) return false;
  const confirmed = await persist(snapshot);
  if (!isCurrent()) { onDurable?.(confirmed); return false; }
  const committedValue=resolveCommittedValue(confirmed,snapshot);
  onDurable?.(confirmed);
  commit(committedValue);
  return true;
}

export type DurableCreationHandoffBarrier = { leaseOwnerId: string; promise: Promise<unknown> };

export async function waitForDurableCreationHandoff(barrier: DurableCreationHandoffBarrier | null | undefined, leaseOwnerId: string): Promise<void> {
  if (!barrier || barrier.leaseOwnerId !== leaseOwnerId) return;
  try { await barrier.promise; } catch { /* persistence failure still settles the release barrier */ }
}
