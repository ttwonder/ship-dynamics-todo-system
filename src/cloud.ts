import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from './types';
import { isPlaceholder } from './utils';
import { normalizeAppData } from './normalize';

export interface SupabaseConfig { supabaseUrl: string; supabaseAnonKey: string; workspaceKey: string; tableName?: string }
declare global { interface Window { SHIP_DYNAMICS_SUPABASE_CONFIG?: SupabaseConfig } }

export function getSupabaseConfig(): (SupabaseConfig & { tableName: string }) | null {
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

const sameCloudIdentity = (left: SupabaseConfig | null, right: SupabaseConfig) => Boolean(left
  && left.supabaseUrl === right.supabaseUrl
  && left.supabaseAnonKey === right.supabaseAnonKey
  && left.workspaceKey === right.workspaceKey
  && (left.tableName || 'ship_dynamics_app_state') === (right.tableName || 'ship_dynamics_app_state'));

export async function persistPasswordMigrationCas(
  supabase: SupabaseClient,
  sourceConfig: SupabaseConfig & { tableName: string },
  latestConfig: SupabaseConfig | null,
  normalized: AppData,
  sourceRevision: number,
  migratedAt = new Date().toISOString(),
): Promise<AppData> {
  if (!sameCloudIdentity(latestConfig, sourceConfig)) throw new Error('密碼遷移期間雲端工作區 identity 已變更，已停止保存；請重試同步。');
  normalized.revision = sourceRevision + 1;
  normalized.updatedAt = migratedAt;
  normalized.settings.lastCloudSyncAt = migratedAt;
  const row = {
    workspace_key: sourceConfig.workspaceKey,
    revision: normalized.revision,
    payload: normalized,
    updated_at: migratedAt,
  };
  const { data: saved, error: saveError } = await supabase
    .from(sourceConfig.tableName)
    .update(row)
    .eq('workspace_key', sourceConfig.workspaceKey)
    .eq('revision', sourceRevision)
    .select('revision')
    .maybeSingle();
  if (saveError) throw saveError;
  if (!saved) throw new CloudConflictError();
  return normalized;
}

export function getSupabaseClient() {
  const cfg = getSupabaseConfig();
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

export async function fetchCloudData(): Promise<AppData | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  const { data, error } = await supabase
    .from(cfg.tableName)
    .select('payload,revision')
    .eq('workspace_key', cfg.workspaceKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const sourceRevision = Number.isFinite(data.revision) ? data.revision : 0;
  const needsPasswordResetPersistence = Number(data.payload?.settings?.nonOwnerPasswordResetVersion || 0) < 1;
  const normalized = normalizeAppData(data.payload);
  if (!normalized) throw new Error('雲端資料格式不完整，已拒絕載入以避免白頁或資料污染。');
  normalized.revision = sourceRevision;
  if (needsPasswordResetPersistence) {
    await persistPasswordMigrationCas(supabase, cfg, getSupabaseConfig(), normalized, sourceRevision);
  }
  return normalized;
}

/** Compare-and-swap save. Every caller must provide the revision it last observed. */
export async function saveCloudData(payload: AppData, expectedRevision: number): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('尚未配置 Supabase；資料只保存在此瀏覽器。');
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('尚未配置 Supabase；資料只保存在此瀏覽器。');
  const row = {
    workspace_key: cfg.workspaceKey,
    revision: payload.revision,
    payload,
    updated_at: new Date().toISOString()
  };

  if (expectedRevision < 0) {
    const { error } = await supabase.from(cfg.tableName).insert(row);
    if (error) {
      if ((error as { code?: string }).code === '23505') throw new CloudConflictError();
      throw error;
    }
    return payload.revision;
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
  return payload.revision;
}
