import type { PermissionKey, RolePermissions, UserAccount, UserRole } from './types';

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; group: '業務內容' | '管理功能'; fixed?: string }> = {
  viewAllVessels: { label: '查看全部船舶', group: '業務內容' },
  editBusinessContent: { label: '修改船舶動態與一般內容', group: '業務內容' },
  createTasks: { label: '新增要事', group: '業務內容' },
  closeTasks: { label: '結案／重新開啟要事', group: '業務內容' },
  deleteTasks: { label: '刪除已建立要事', group: '業務內容', fixed: '僅 Owner／管理員' },
  manageMeetings: { label: '新增及修改臨會/專題', group: '業務內容' },
  exportReports: { label: '預覽及匯出報告', group: '業務內容' },
  enterManagement: { label: '進入管理頁面', group: '管理功能', fixed: 'Owner／管理員固定開啟；操作員／船舶帳戶固定關閉' },
  manageUsers: { label: '管理非 Owner 人員', group: '管理功能' },
  manageVessels: { label: '管理船舶及經管人員', group: '管理功能' },
  viewAuditLogs: { label: '查看操作紀錄', group: '管理功能' },
  manageRolePermissions: { label: '調整角色權限', group: '管理功能', fixed: '僅 Owner' },
  manageSystemSettings: { label: '管理進站密碼與雲端', group: '管理功能', fixed: '僅 Owner' },
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];

const row = (enabled: PermissionKey[]): Record<PermissionKey, boolean> => Object.fromEntries(PERMISSION_KEYS.map(key => [key, enabled.includes(key)])) as Record<PermissionKey, boolean>;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  owner: row(PERMISSION_KEYS),
  admin: row(['viewAllVessels', 'editBusinessContent', 'createTasks', 'closeTasks', 'deleteTasks', 'manageMeetings', 'exportReports', 'enterManagement', 'manageVessels', 'viewAuditLogs']),
  operator: row(['editBusinessContent', 'createTasks', 'closeTasks', 'exportReports']),
  vessel: row(['createTasks']),
};

const booleanValue = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function normalizeRolePermissions(value: unknown): RolePermissions {
  const source = value && typeof value === 'object' ? value as Partial<Record<UserRole, unknown>> : {};
  const result = structuredClone(DEFAULT_ROLE_PERMISSIONS);
  (['admin', 'operator', 'vessel'] as UserRole[]).forEach(role => {
    const roleSource = source[role] && typeof source[role] === 'object' ? source[role] as Partial<Record<PermissionKey, unknown>> : {};
    PERMISSION_KEYS.forEach(key => { result[role][key] = booleanValue(roleSource[key], result[role][key]); });
  });

  // 不可配置的安全邊界：Owner 永遠全開，管理員永遠可進管理，操作員永遠不可進管理。
  PERMISSION_KEYS.forEach(key => { result.owner[key] = true; });
  result.admin.enterManagement = true;
  result.operator.enterManagement = false;
  result.vessel.enterManagement = false;
  result.admin.deleteTasks = true;
  result.operator.deleteTasks = false;
  result.vessel.deleteTasks = false;
  result.admin.manageRolePermissions = false;
  result.operator.manageRolePermissions = false;
  result.admin.manageSystemSettings = false;
  result.operator.manageSystemSettings = false;
  result.operator.manageUsers = false;
  result.operator.manageVessels = false;
  result.operator.viewAuditLogs = false;
  PERMISSION_KEYS.filter(key => key !== 'createTasks').forEach(key => { result.vessel[key] = false; });
  return result;
}

export function hasPermission(matrix: RolePermissions | undefined, user: Pick<UserAccount, 'role'> | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === 'owner') return true;
  const normalized = normalizeRolePermissions(matrix);
  return normalized[user.role][permission];
}
