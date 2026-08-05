import type { AppData } from './types';
import { appDataContentEqual, rebaseDisjointAppData } from './cloudRebase';

export interface MergeConfirmedCloudSnapshotInput {
  baseline: AppData;
  current: AppData;
  confirmed: AppData;
  actorUserId: string;
  at: string;
}

export function mergeConfirmedCloudSnapshot({
  baseline,
  current,
  confirmed,
  actorUserId,
  at,
}: MergeConfirmedCloudSnapshotInput): AppData {
  if (appDataContentEqual(current, baseline)) return confirmed;
  return rebaseDisjointAppData(baseline, current, confirmed, at, actorUserId);
}
