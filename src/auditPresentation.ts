import type { AppData, AuditLog } from './types';
import { richTextToPlainText } from './richText';
import { vesselDisplayName } from './vesselDisplay';

const ACTION_LABELS: Record<string, string> = {
  update_vessel_manual_attention: '更新船舶手動關注度',
  create_vessel: '新增船舶',
  replace_vessel_assignments: '更新船舶分管／代管人員',
  disable_vessel: '停用船舶',
  batch_update_vessels: '批量更新船舶',
  create_ordinary_task: '新增一般要事',
  create_task: '新增要事',
  update_ordinary_task: '更新一般要事',
  update_task: '更新要事',
  save_ordinary_task: '保存一般要事',
  delete_ordinary_task: '刪除一般要事',
  update_task_vessel_progress: '更新逐船辦理進度',
  create_meeting: '新增臨會／專題',
  update_meeting: '更新臨會／專題',
  delete_meeting: '刪除臨會／專題',
  correct_meeting_status_event: '修正臨會／專題狀態紀錄',
  create_internal_case: '新增內控異常',
  batch_create_internal_cases: '批量新增內控異常',
  update_internal_case: '更新內控異常',
  cancel_internal_case: '取消內控異常',
  reopen_internal_case: '重新開啟內控異常',
  delete_internal_case: '刪除內控異常',
  link_internal_case_task: '連結內控異常與要事',
  unlink_internal_case_task: '解除內控異常與要事連結',
  delete_task_preserving_internal_case: '刪除要事並保留內控異常',
  create_internal_case_from_task: '由要事建立內控異常',
  create_task_from_internal_case: '由內控異常建立要事',
  update_vessel_note: '更新船舶一般資料',
  update_user: '更新使用者',
  update_role_permissions: '更新角色權限',
  update_workspace_settings: '更新系統設定',
  update_site_gate: '更新進站密碼',
  mark_notifications_read: '將通知標示為已讀',
  save_report: '保存報告',
  resolve_migration_quarantine: '處理遷移隔離資料',
  complete_password_activation: '完成個人密碼啟用',
  legacy_import: '匯入舊版資料',
};

const ENTITY_LABELS: Record<string, string> = {
  vessel: '船舶',
  task: '要事',
  'task-progress': '逐船辦理進度',
  meeting: '臨會／專題',
  'meeting-status-event': '會議狀態紀錄',
  'internal-control': '內控異常',
  internal_case: '內控異常',
  user: '使用者',
  settings: '系統設定',
  report: '報告',
  agenda: '報告',
  notification: '通知',
  workspace: '系統工作區',
};

const SETTING_LABELS: Record<string, string> = {
  'role-permissions': '角色權限',
  workspace: '系統設定',
  'site-gate': '進站密碼',
  'site-password': '進站密碼',
  'task-categories': '要事分類',
  'meeting-task-categories': '臨會／專題待辦分類',
  'internal-control-equipment-subcategories': '內控設備故障細項',
  priorities: '優先級',
  departments: '部門清單',
  'equipment-options': '設備選項',
};

const DETAIL_LABELS: Record<string, string> = {
  status: '狀態',
  previousStatus: '原狀態',
  nextStatus: '新狀態',
  manualAttentionLevel: '手動關注度',
  priority: '優先級',
  category: '分類',
  reason: '原因',
  count: '數量',
  itemCount: '項目數',
  vesselCount: '船舶數',
  enabled: '是否啟用',
  role: '角色',
  action: '操作',
  field: '欄位',
  value: '新值',
  before: '原值',
  after: '新值',
};

const TOKEN_LABELS: Record<string, string> = {
  create: '新增', update: '更新', save: '保存', delete: '刪除', disable: '停用',
  replace: '更新', batch: '批量', correct: '修正', complete: '完成', cancel: '取消',
  reopen: '重新開啟', link: '連結', unlink: '解除連結', mark: '標示', read: '已讀',
  resolve: '處理', vessel: '船舶', vessels: '船舶', task: '要事', ordinary: '一般',
  meeting: '臨會／專題', internal: '內控', case: '異常', user: '使用者', role: '角色',
  permissions: '權限', workspace: '系統', settings: '設定', site: '進站', gate: '密碼',
  notifications: '通知', report: '報告', status: '狀態', event: '紀錄', progress: '進度',
  assignments: '分管／代管人員', manual: '手動', attention: '關注度', preserving: '並保留',
  from: '由', migration: '遷移', quarantine: '隔離資料', password: '密碼', activation: '啟用',
};

export interface AuditPresentation {
  actionLabel: string;
  targetLabel: string;
  operationText: string;
  detailText: string;
  ipAddressLabel: string;
  ipLocationLabel: string;
  technicalId: string;
}

function concise(value: string, max = 72) {
  const plain = richTextToPlainText(value).replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function humanizeAction(action: string) {
  const trimmed = action.trim();
  if (!trimmed) return '未標示操作';
  if (ACTION_LABELS[trimmed]) return ACTION_LABELS[trimmed];
  if (/[\u3400-\u9fff]/.test(trimmed)) return trimmed;
  const words = trimmed.toLowerCase().split(/[_\s-]+/).filter(Boolean);
  const translated = words.map(word => TOKEN_LABELS[word]).filter(Boolean).join('');
  return translated || '其他系統操作';
}

function taskLabel(data: AppData, id: string) {
  const task = data.tasks.find(item => item.id === id);
  return task ? concise(task.description) || '未命名要事' : '';
}

function vesselLabel(data: AppData, id: string) {
  const vessel = data.vessels.find(item => item.id === id);
  return vessel ? vesselDisplayName(vessel) : '';
}

function targetLabel(log: AuditLog, data: AppData) {
  const type = log.entityType.trim();
  const entityLabel = ENTITY_LABELS[type] || '資料項目';
  const id = log.entityId.trim();
  let name = '';

  if (type === 'vessel') name = vesselLabel(data, id);
  else if (type === 'task') name = taskLabel(data, id);
  else if (type === 'internal-control' || type === 'internal_case') {
    name = concise(data.internalControlCases.find(item => item.id === id)?.description || '');
  } else if (type === 'meeting') {
    name = concise(data.meetings.find(item => item.id === id)?.subject || '');
  } else if (type === 'user') {
    name = data.users.find(item => item.id === id)?.name || '';
  } else if (type === 'settings') {
    name = SETTING_LABELS[id] || '';
  } else if (type === 'report' || type === 'agenda') {
    name = concise(data.agendaReports.find(item => item.id === id)?.title || '');
  } else if (type === 'task-progress') {
    const [taskId, vesselId] = id.split(':');
    const task = taskLabel(data, taskId);
    const vessel = vesselLabel(data, vesselId);
    name = [task, vessel].filter(Boolean).join('｜');
  }

  return name ? `${entityLabel}：${name}` : entityLabel;
}

function readableValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return concise(value);
  if (Array.isArray(value)) return `${value.length} 項`;
  if (value && typeof value === 'object') return '已更新';
  return '';
}

function readableJsonDetail(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([key, item]) => {
    if (/password|hash|token|secret/i.test(key)) return false;
    if (/^(id|.*Id|version|.*Version|operationId|requestId|createdAt|updatedAt)$/i.test(key)) return false;
    return readableValue(item);
  }).slice(0, 6);
  if (!entries.length) return '操作已由伺服器確認';
  return entries.map(([key, item]) => `${DETAIL_LABELS[key] || '變更項目'}：${readableValue(item)}`).join('；');
}

function detailLabel(log: AuditLog) {
  const detail = log.detail.trim();
  if (!detail) return '已完成上述操作';
  if (detail.startsWith('{') || detail.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(detail);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return readableJsonDetail(parsed as Record<string, unknown>);
      }
      if (Array.isArray(parsed)) return `共 ${parsed.length} 項變更`;
    } catch {
      // Fall back to a safe plain-text summary for legacy malformed detail.
    }
  }
  if (detail === log.entityId || /^[a-z]+[-_:][\w:-]{8,}$/i.test(detail)) return '已完成上述操作';
  return concise(detail, 180) || '已完成上述操作';
}

export function auditCountryName(countryCode?: string) {
  const code = countryCode?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return '未提供（未使用第三方定位）';
  try {
    // Intl.DisplayNames is feature-detected because the project targets ES2020.
    const DisplayNames = (Intl as unknown as { DisplayNames?: new (
      locales: string[], options: { type: 'region' }
    ) => { of: (value: string) => string | undefined } }).DisplayNames;
    const name = DisplayNames ? new DisplayNames(['zh-Hant'], { type: 'region' }).of(code) : undefined;
    return name ? `${name}（${code}）` : code;
  } catch {
    return code;
  }
}

export function presentAuditLog(log: AuditLog, data: AppData): AuditPresentation {
  const actionLabel = humanizeAction(log.action);
  const target = targetLabel(log, data);
  return {
    actionLabel,
    targetLabel: target,
    operationText: `${actionLabel}｜${target}`,
    detailText: detailLabel(log),
    ipAddressLabel: log.ipAddress || '未記錄（舊紀錄或尚未雲端確認）',
    ipLocationLabel: auditCountryName(log.ipCountryCode),
    technicalId: `${log.entityType || 'unknown'}｜${log.entityId || 'unknown'}`,
  };
}
