import type { AppData } from '../types';
import type { CloudBlockPatchOperation } from '../cloudBlockPatch';
import type { RecordReadScope } from '../cloudRecordScopes';
import type { BrowserAuthority } from '../cloudSourceAuthority';
/** Exact request captured by the existing App save queue before its first RPC.
 * Only receipt reconciliation uses this envelope; never reconstruct a command
 * from refreshed versions or replace its leases under a successor identity. */
export interface TrackingRecordAttempt {
  operationId:string; operations:CloudBlockPatchOperation[]; savedBy:string; actorId:string;
  actorGuard:Record<string,unknown>; authorizationGuard:Record<string,unknown>|null;
  guards:{section_key:string;locked_by:string}[]; scope:RecordReadScope; authority?:BrowserAuthority;
  visibleSnapshot:AppData;
}
export const trackingReceiptKey=(identity:string,sourceOperationId:string)=>JSON.stringify(['ship-dynamics-tracking-record-attempt',identity,sourceOperationId]);
