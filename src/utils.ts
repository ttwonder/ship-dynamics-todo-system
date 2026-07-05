import type { AppData, UserAccount, UserRole } from './types';

export const STORAGE_KEY = 'ship-dynamics-app-data-v1';
export const SESSION_SITE_UNLOCK = 'ship-dynamics-site-unlocked-v1';
export const CURRENT_USER_KEY = 'ship-dynamics-current-user-v1';

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso() { return new Date().toISOString(); }
export function uid(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
export function todayDate() { return new Date().toISOString().slice(0,10); }
export function yesterdayDate() { return new Date(Date.now() - 86400000).toISOString().slice(0,10); }
export function daysDiff(date: string) {
  if (!date) return null;
  const target = new Date(date); const today = new Date();
  target.setHours(0,0,0,0); today.setHours(0,0,0,0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export function roleLabel(role?: UserRole | 'system') {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return '管理員';
  if (role === 'operator') return '操作員';
  return '系統';
}

export function canManage(user?: UserAccount | null) { return user?.role === 'owner' || user?.role === 'admin'; }
export function isOwner(user?: UserAccount | null) { return user?.role === 'owner'; }

export function saveLocal(data: AppData) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
export function loadLocal(): AppData | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as AppData : null; }
  catch { return null; }
}

export function withAudit(data: AppData, actor: UserAccount | null, action: string, entityType: string, entityId: string, detail: string): AppData {
  const at = nowIso();
  return {
    ...data,
    revision: (data.revision || 0) + 1,
    updatedAt: at,
    auditLogs: [{
      id: uid('audit'), at,
      actorId: actor?.id || 'system', actorName: actor?.name || 'system', actorRole: (actor?.role || 'system') as any,
      action, entityType, entityId, detail
    }, ...(data.auditLogs || [])].slice(0, 500)
  };
}

export function isPlaceholder(value?: string) {
  return !value || value.includes('YOUR_') || value.trim() === '';
}

export function normalizeText(value: unknown) { return String(value ?? '').trim().toLowerCase(); }
