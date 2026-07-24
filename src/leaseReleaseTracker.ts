export type TrackedLeaseToken = { sectionKey: string; leaseOwnerId: string };

type LeaseRecord<C> = { sectionKey: string; config: C };

export type LeaseReleaseState<C> = {
  records: Map<string, LeaseRecord<C>>;
  pending: Map<string, TrackedLeaseToken>;
  released: Set<string>;
};

export function createLeaseReleaseState<C>(): LeaseReleaseState<C> {
  return { records: new Map(), pending: new Map(), released: new Set() };
}

export function registerTrackedLease<C>(state: LeaseReleaseState<C>, lease: TrackedLeaseToken, config: C) {
  state.released.delete(lease.leaseOwnerId);
  state.records.set(lease.leaseOwnerId, { sectionKey: lease.sectionKey, config });
}

export function pendingTrackedLeases<C>(state: LeaseReleaseState<C>) {
  return [...state.pending.values()];
}

export async function releaseTrackedLeases<C>(
  state: LeaseReleaseState<C>,
  leases: TrackedLeaseToken[],
  release: (lease: TrackedLeaseToken, config: C) => Promise<void>,
) {
  let failed = false;
  for (const lease of [...leases].reverse()) {
    if (state.released.has(lease.leaseOwnerId)) {
      state.pending.delete(lease.leaseOwnerId);
      continue;
    }
    const record = state.records.get(lease.leaseOwnerId);
    if (!record || record.sectionKey !== lease.sectionKey) {
      failed = true;
      state.pending.set(lease.leaseOwnerId, lease);
      continue;
    }
    try {
      await release(lease, record.config);
      state.records.delete(lease.leaseOwnerId);
      state.pending.delete(lease.leaseOwnerId);
      state.released.add(lease.leaseOwnerId);
      if (state.released.size > 2048) state.released.delete(state.released.values().next().value as string);
    } catch {
      failed = true;
      state.pending.set(lease.leaseOwnerId, lease);
    }
  }
  return !failed;
}
