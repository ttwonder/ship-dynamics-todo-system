import type { CloudSyncFailureKind } from './cloudSyncError';

export function shouldOfferStaleBrowserRecovery(kind:CloudSyncFailureKind):boolean{
  return kind==='authorization';
}
