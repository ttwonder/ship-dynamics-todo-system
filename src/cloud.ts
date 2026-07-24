import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from './types';
import { isPlaceholder, sanitizeAppDataForStorage } from './utils';
import { normalizeAppData } from './normalize';

export interface SupabaseConfig { supabaseUrl: string; supabaseAnonKey: string; workspaceKey: string; tableName?: string }
export type ResolvedSupabaseConfig = SupabaseConfig & { tableName: string };
export interface CloudEditingLock { ok: boolean; sectionKey: string; lockedBy?: string; lockedByName?: string; expiresAt?: string }
declare global { interface Window { SHIP_DYNAMICS_SUPABASE_CONFIG?: SupabaseConfig } }

export function getSupabaseConfig(): ResolvedSupabaseConfig | null {
  const file = window.SHIP_DYNAMICS_SUPABASE_CONFIG;
  let local: SupabaseConfig | null = null;
  try {
    const raw = localStorage.getItem('ship-dynamics-supabase-config');
    local = raw ? JSON.parse(raw) : null;
  } catch { local = null; }
  const chosen = file && !isPlaceholder(file.supabaseUrl) && !isPlaceholder(file.supabaseAnonKey) ? file : local;
  if (!chosen || isPlaceholder(chosen.supabaseUrl) || isPlaceholder(chosen.supabaseAnonKey)) return null;
  return { ...chosen, supabaseUrl: chosen.supabaseUrl.trim(), supabaseAnonKey: chosen.supabaseAnonKey.trim(), tableName: chosen.tableName || 'ship_dynamics_app_state' };
}

export function saveSupabaseConfig(cfg: SupabaseConfig) {
  localStorage.setItem('ship-dynamics-supabase-config', JSON.stringify(cfg));
}

let client: SupabaseClient | null = null;
let clientKey = '';

export class CloudConflictError extends Error {
  constructor() { super('雲端已有較新的版本，已停止覆寫。請先同步最新資料後再修改。'); }
}

export function getSupabaseClient(config?: ResolvedSupabaseConfig|null) {
  const cfg = config===undefined?getSupabaseConfig():config;
  if (!cfg) return null;
  const key = `${cfg.supabaseUrl}|${cfg.supabaseAnonKey}`;
  if (!client || clientKey !== key) {
    client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { 'x-application-name': 'ship-dynamics-todo-system' } }
    });
    clientKey = key;
  }
  return client;
}

export function isCloudConfigured() { return !!getSupabaseClient(); }

const lockFromRpc = (value: any, fallbackSectionKey: string): CloudEditingLock => ({
  ok: Boolean(value?.ok),
  sectionKey: String(value?.section_key || fallbackSectionKey),
  lockedBy: value?.locked_by ? String(value.locked_by) : undefined,
  lockedByName: value?.locked_by_name ? String(value.locked_by_name) : undefined,
  expiresAt: value?.expires_at ? String(value.expires_at) : undefined,
});

export async function fetchCloudData(config?: ResolvedSupabaseConfig | null): Promise<AppData | null> {
  const cfg = config === undefined ? getSupabaseConfig() : config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) return null;
  const { data, error } = await supabase
    .from(cfg.tableName)
    .select('payload,revision,updated_at,updated_by')
    .eq('workspace_key', cfg.workspaceKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const sourceRevision = Number.isFinite(data.revision) ? data.revision : 0;
  const normalized = normalizeAppData(data.payload);
  if (!normalized) throw new Error('雲端資料格式不完整，已拒絕載入以避免白頁或資料污染。');
  normalized.revision = sourceRevision;
  return normalized;
}

/** Compare-and-swap save. Every caller must provide the revision it last observed. */
export async function saveCloudData(payload: AppData, expectedRevision: number, savedByName = 'unknown', config?: ResolvedSupabaseConfig | null): Promise<number> {
  const cfg = config === undefined ? getSupabaseConfig() : config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) throw new Error('尚未配置 Supabase；資料只保存在此瀏覽器。');
  const cleanPayload = sanitizeAppDataForStorage(payload);
  const row = {
    workspace_key: cfg.workspaceKey,
    revision: cleanPayload.revision,
    payload: cleanPayload,
    updated_at: new Date().toISOString(),
    updated_by: savedByName,
  };

  if (expectedRevision < 0) {
    const { error } = await supabase.from(cfg.tableName).insert(row);
    if (error) {
      if ((error as { code?: string }).code === '23505') throw new CloudConflictError();
      throw error;
    }
    return cleanPayload.revision;
  }

  const { data, error } = await supabase
    .from(cfg.tableName)
    .update(row)
    .eq('workspace_key', cfg.workspaceKey)
    .eq('revision', expectedRevision)
    .select('revision')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CloudConflictError();
  return cleanPayload.revision;
}

export async function claimEditLock(sectionKey: string, lockedBy: string, lockedByName: string, ttlSeconds = 75, config?: ResolvedSupabaseConfig|null): Promise<CloudEditingLock> {
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) return { ok: true, sectionKey };
  const { data, error } = await supabase.rpc('claim_ship_dynamics_edit_lock', {
    p_workspace_key: cfg.workspaceKey,
    p_section_key: sectionKey,
    p_locked_by: lockedBy,
    p_locked_by_name: lockedByName,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw error;
  return lockFromRpc(data, sectionKey);
}

export async function releaseEditLock(sectionKey: string, lockedBy: string, config?: ResolvedSupabaseConfig|null): Promise<void> {
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) return;
  const { error } = await supabase.rpc('release_ship_dynamics_edit_lock', {
    p_workspace_key: cfg.workspaceKey,
    p_section_key: sectionKey,
    p_locked_by: lockedBy,
  });
  if (error) throw error;
}
