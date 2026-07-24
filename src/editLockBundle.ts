export type EditLockBundleRequest = { sectionKey: string; label: string; leaseOwnerId: string };
export type EditLockBundleClaimResult = { ok: boolean; expiresAt?: string; lockedByName?: string };
export type OwnedEditLockBundleLease = EditLockBundleRequest & { expiresAt?: string };
export type EditLockBundleResult =
  | { status: 'owned'; leases: OwnedEditLockBundleLease[] }
  | { status: 'blocked'; sectionKey: string; label: string; lockedByName: string; cleanupFailed: boolean }
  | { status: 'cancelled'; cleanupFailed: boolean }
  | { status: 'unavailable'; error: unknown; cleanupFailed: boolean };

async function releaseReverse(
  requests: EditLockBundleRequest[],
  release: (request: EditLockBundleRequest) => Promise<void>,
) {
  let cleanupFailed = false;
  for (const request of [...requests].reverse()) {
    try { await release(request); }
    catch { cleanupFailed = true; }
  }
  return cleanupFailed;
}

export async function acquireEditLockBundle(
  requests: EditLockBundleRequest[],
  claim: (request: EditLockBundleRequest) => Promise<EditLockBundleClaimResult>,
  release: (request: EditLockBundleRequest) => Promise<void>,
  stillWanted: () => boolean,
): Promise<EditLockBundleResult> {
  const attempted: EditLockBundleRequest[] = [];
  const owned: OwnedEditLockBundleLease[] = [];
  for (const request of requests) {
    if (!stillWanted()) return { status: 'cancelled', cleanupFailed: await releaseReverse(attempted, release) };
    attempted.push(request);
    try {
      const result = await claim(request);
      if (!stillWanted()) return { status: 'cancelled', cleanupFailed: await releaseReverse(attempted, release) };
      if (!result.ok) {
        return {
          status: 'blocked',
          sectionKey: request.sectionKey,
          label: request.label,
          lockedByName: result.lockedByName || '其他使用者',
          cleanupFailed: await releaseReverse(attempted, release),
        };
      }
      owned.push({ ...request, expiresAt: result.expiresAt });
    } catch (error) {
      return { status: 'unavailable', error, cleanupFailed: await releaseReverse(attempted, release) };
    }
  }
  return { status: 'owned', leases: owned };
}
