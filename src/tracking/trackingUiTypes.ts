import type { AppData } from '../types';
import type { TrackingContext } from './trackingWorkflow';
import type { TrackingUiCommand } from './trackingUiCommands';
import type { TrackingItem } from './trackingTypes';
import type { TrackingStatisticsQuery } from './trackingStatistics';
import type { StatisticsCapture, StatisticsVesselScope } from './trackingStatisticsScope';
export interface TrackingSubmission { command: TrackingUiCommand; context: TrackingContext; identity: string; reporterNameAndRole?: string }
export interface TrackingUiCallbacks {
  captureStatistics?: (scope: StatisticsVesselScope, query: TrackingStatisticsQuery) => Promise<StatisticsCapture | null>;
  onPrivateDraftChange?: (token: object, dirty: boolean) => void;
  captureExport?: (vesselId: string) => Promise<{ items: TrackingItem[]; isCurrent: () => boolean } | null>;
  load: (vesselId: string, ids?: string[]) => Promise<AppData | null>;
  claim: (vesselId: string, ids: string[], creation?: boolean) => Promise<AppData | null>;
  isWritable: (ids: readonly string[]) => boolean;
  submit: (submission: TrackingSubmission) => Promise<boolean>;
  release: () => Promise<boolean>;
  discardRejected?: () => Promise<boolean>;
  openCase: (caseId: string) => void;
  registerNavigationGuard: (guard: null | (() => Promise<boolean>)) => void;
}
export const TRACKING_HELP = {
  delete: '只軟刪除所選跟蹤來源；待審核申請同時批准。保留原分類、業務日期及歷程，可由岸端還原。已同步內控與既有要事保持有效且完全不變，不連帶刪除或結案。',
  restore: '將所選來源還原至原分類清單，不重開已結案項目。保留所有業務日期、進度、申請審核結果與歷程；已同步內控及既有要事保持有效且完全不變。',
  'request-delete': '只提交刪除申請，需由岸端審核。待審核期間來源仍在正常清單、統計及匯出；保留原資料與有效內控關聯，不會直接刪除。',
  'reject-delete': '駁回所選待審核申請並記錄理由，來源仍在正常清單。保留原資料；已同步內控及既有要事保持有效且完全不變。',
  create: '只新增追蹤來源，不會自動建立內控或要事。保存後等待雲端確認。',
  edit: '逐筆更新所選來源欄位，類型限原材料／工程大類；最新進度同步有效關聯並追加歷程，改類型會更新來源類型標籤及相關日期說明並保留歷程，不改內控自身分類、DL 或人工內容。填寫實際日期記錄送達／完工，不代替結案。',
  urgency: '將所選項目統一改為普通或緊急，兩者均須填寫本次補充說明，追加至各項原說明而不覆蓋。只修改來源急迫度，不改類型、最新進度、送達／完工／結案狀態或關聯內控急迫度。已結案請先重開。',
  reclassify: '將所選項目修正為同一類型，可跨配件／物料與工程；已結案請先重開。日期不會自動跨類別轉用，原類別資料仍保留。請逐筆核對目標日期及送船狀態；有效關聯更新來源類型標籤及相關日期說明，不改自身分類、DL 或人工內容。',
  progress: '逐筆修改最新進度，只保存有變更的列；有效關聯的內控及既有要事在同一交易追加歷程。已結案請先重開。',
  completion: '按實際完工日期將所選工程移到已完成工程單；不會結案、不改內控狀態或 DL。更正為未完工請在編輯清除日期；已結案請先重開。',
  delivery: '全部配件／物料已實際交到船才選已送船；部分交船仍留未送船清單。更正前後值保留歷程；預設不結案。全部送達時可勾選「同時結案」，結案日期同送達日期，並沿既有規則同步有效關聯；不改 DL 或完工日期。',
  close: '本案不再追蹤；有效關聯的內控與既有要事同步結案。不會把物料標成已送船，也不會填入工程完工日期。',
  reopen: '將本案及有效關聯的內控與既有要事恢復未結案；送船狀態、送船日期、完工日期、DL 及歷程保留。',
  'correct-close-date': '同步更正本案與有效關聯內控／要事的本次結案日期，保留舊值及更正歷程；不改送船或完工日期。',
  sync: '每筆來源建立一件內控，首次預填可核對。預設不同步要事，只有岸端有權人員可明確選擇。已同步者不重複建立。',
} as const;

export type TrackingAudience = 'shore' | 'ship';
// Presentation only. Public write authority belongs to the dedicated server API.
export const SHIP_TRACKING_HELP: Record<keyof typeof TRACKING_HELP, string> = {
  ...TRACKING_HELP,
  delete: '船端不能直接刪除，請提交刪除申請。',
  restore: '船端只能查看已刪除來源與歷程，還原由岸端處理。',
  'reject-delete': '船端只能查看申請結果，審核由岸端處理。',
  create: '只新增跟蹤來源，不會自動建立內控。保存後等待雲端確認。',
  progress: '逐筆修改最新進度，只保存有變更的列；有效關聯的內控在同一交易追加歷程。已結案請先重開。',
  close: '本案不再追蹤；有效關聯的內控同步結案。不會把物料標成已送船，也不會填入工程完工日期。',
  reopen: '將本案及有效關聯的內控恢復未結案；送船狀態、送船日期、完工日期、DL 及歷程保留。',
  'correct-close-date': '同步更正本案與有效關聯內控的本次結案日期，保留舊值及更正歷程；不改送船或完工日期。',
  sync: '每筆來源建立一件內控，首次預填可核對；報告人姓名＋職務會附在內文。已同步者不重複建立。',
};
export const trackingHelp = (audience: TrackingAudience) => audience === 'ship' ? SHIP_TRACKING_HELP : TRACKING_HELP;
