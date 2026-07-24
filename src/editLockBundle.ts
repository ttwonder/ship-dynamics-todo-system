export type EditLockBundleRequest = { sectionKey: string; label: string; leaseOwnerId: string };
export type EditLockBundleClaimResult = { ok: boolean; expiresAt?: string; lockedByName?: string };
export type OwnedEditLockBundleLease = EditLockBundleRequest & { expiresAt?: string };
export type EditLockBundleResult =
  | { status: 'owned'; leases: OwnedEditLockBundleLease[] }
  | { status: 'blocked'; sectionKey: string; label: string; lockedByName: string; cleanupFailed: boolean; cleanupUnresolved: EditLockBundleRequest[] }
  | { status: 'cancelled'; cleanupFailed: boolean; cleanupUnresolved: EditLockBundleRequest[] }
  | { status: 'unavailable'; error: unknown; cleanupFailed: boolean; cleanupUnresolved: EditLockBundleRequest[] };

async function releaseReverse(
  requests: EditLockBundleRequest[],
  release: (request: EditLockBundleRequest) => Promise<void>,
) {
  const unresolved: EditLockBundleRequest[] = [];
  for (const request of [...requests].reverse()) {
    try { await release(request); }
    catch { unresolved.push(request); }
  }
  return unresolved;
}

const cleanupResult = (unresolved: EditLockBundleRequest[]) => ({ cleanupFailed: unresolved.length > 0, cleanupUnresolved: unresolved });

export async function acquireEditLockBundle(
  requests: EditLockBundleRequest[],
  claim: (request: EditLockBundleRequest) => Promise<EditLockBundleClaimResult>,
  release: (request: EditLockBundleRequest) => Promise<void>,
  stillWanted: () => boolean,
): Promise<EditLockBundleResult> {
  const attempted: EditLockBundleRequest[] = [];
  const owned: OwnedEditLockBundleLease[] = [];
  for (const request of requests) {
    if (!stillWanted()) return { status: 'cancelled', ...cleanupResult(await releaseReverse(attempted, release)) };
    attempted.push(request);
    try {
      const result = await claim(request);
      if (!stillWanted()) return { status: 'cancelled', ...cleanupResult(await releaseReverse(attempted, release)) };
      if (!result.ok) {
        const cleanupUnresolved = await releaseReverse(attempted, release);
        return {
          status: 'blocked',
          sectionKey: request.sectionKey,
          label: request.label,
          lockedByName: result.lockedByName || '其他使用者',
          ...cleanupResult(cleanupUnresolved),
        };
      }
      owned.push({ ...request, expiresAt: result.expiresAt });
    } catch (error) {
      const cleanupUnresolved = await releaseReverse(attempted, release);
      return { status: 'unavailable', error, ...cleanupResult(cleanupUnresolved) };
    }
  }
  return { status: 'owned', leases: owned };
}
