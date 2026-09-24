import type { AppData } from '../types';
import type { TrackingContext } from './trackingWorkflow';
import type { TrackingUiCommand } from './trackingUiCommands';
import type { TrackingItem } from './trackingTypes';
export interface TrackingSubmission { command: TrackingUiCommand; context: TrackingContext; identity: string }
export interface TrackingUiCallbacks {
  onPrivateDraftChange?: (token: object, dirty: boolean) => void;
  captureExport?: (vesselId: string) => Promise<{ items: TrackingItem[]; isCurrent: () => boolean } | null>;
  load: (vesselId: string, ids?: string[]) => Promise<AppData | null>;
  submit: (submission: TrackingSubmission) => Promise<boolean>;
  release: () => Promise<boolean>;
  discardRejected?: () => Promise<boolean>;
  openCase: (caseId: string) => void;
  registerNavigationGuard: (guard: null | (() => Promise<boolean>)) => void;
}
export const TRACKING_HELP = {
  create: '只新增追蹤來源，不會自動建立內控或要事。保存後等待雲端確認。',
  edit: '修正來源基本資料；不重新覆寫已同步內控的事項內容、DL 或分類。',
  progress: '逐筆修改最新進度，只保存有變更的列；有效關聯的內控及既有要事在同一交易追加歷程。已結案請先重開。',
  delivery: '全部配件／物料已實際交到船才選已送船；部分交船仍留未送船清單。更正前後值保留歷程，不改變結案、DL 或完工日期。',
  close: '本案不再追蹤；有效關聯的內控與既有要事同步結案。不會把物料標成已送船，也不會填入工程完工日期。',
  reopen: '將本案及有效關聯的內控與既有要事恢復未結案；送船狀態、送船日期、完工日期、DL 及歷程保留。',
  'correct-close-date': '同步更正本案與有效關聯內控／要事的本次結案日期，保留舊值及更正歷程；不改送船或完工日期。',
  sync: '每筆來源建立一件內控，首次預填可核對。預設不同步要事，只有岸端有權人員可明確選擇。已同步者不重複建立。',
} as const;
