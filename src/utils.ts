import type { AppData, UserAccount, UserRole } from './types';

export const STORAGE_KEY = 'ship-dynamics-app-data-v1';
export const SESSION_SITE_UNLOCK = 'ship-dynamics-site-unlocked-v1';
export const CURRENT_USER_KEY = 'ship-dynamics-current-user-v1';
export const CLOUD_CACHE_IDENTITY_KEY = 'ship-dynamics-cloud-cache-identity-v1';

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso() { return new Date().toISOString(); }
export function uid(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
export function todayDate() { return localDate(); }
export function yesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDate(date);
}
export function daysDiff(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  if (target.getFullYear() !== year || target.getMonth() !== month - 1 || target.getDate() !== day) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function roleLabel(role?: UserRole | 'system') {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return '管理員';
  if (role === 'operator') return '操作員';
  if (role === 'vessel') return '船舶帳戶';
  return '系統';
}

export function canManage(user?: UserAccount | null) { return user?.role === 'owner' || user?.role === 'admin'; }
export function isOwner(user?: UserAccount | null) { return user?.role === 'owner'; }

export function saveLocal(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function loadLocal(): AppData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    return isAppDataLike(value) ? value : null;
  } catch {
    return null;
  }
}

export function isAppDataLike(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppData>;
  return !!data.settings
    && Array.isArray(data.users)
    && Array.isArray(data.vessels)
    && Array.isArray(data.tasks)
    && (data.meetings === undefined || Array.isArray(data.meetings))
    && (data.agendaReports === undefined || Array.isArray(data.agendaReports))
    && (data.auditLogs === undefined || Array.isArray(data.auditLogs));
}

export function withAudit(data: AppData, actor: UserAccount | null, action: string, entityType: string, entityId: string, detail: string): AppData {
  const at = nowIso();
  const actorRole: UserRole | 'system' = actor?.role || 'system';
  return {
    ...data,
    revision: (data.revision || 0) + 1,
    updatedAt: at,
    auditLogs: [{
      id: uid('audit'), at,
      actorId: actor?.id || 'system', actorName: actor?.name || 'system', actorRole,
      action, entityType, entityId, detail
    }, ...(data.auditLogs || [])].slice(0, 500)
  };
}

export function isPlaceholder(value?: string) {
  const normalized = value?.trim() || '';
  return !normalized || normalized.includes('YOUR_') || normalized === 'eyJhbG...Ykcc';
}

export function normalizeText(value: unknown) { return String(value ?? '').trim().toLowerCase(); }
