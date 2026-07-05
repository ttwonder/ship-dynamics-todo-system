import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from './types';
import { isPlaceholder } from './utils';

declare global { interface Window { SHIP_DYNAMICS_SUPABASE_CONFIG?: SupabaseConfig } }
export interface SupabaseConfig { supabaseUrl: string; supabaseAnonKey: string; workspaceKey: string; tableName?: string }

export function getSupabaseConfig(): SupabaseConfig | null {
  const file = window.SHIP_DYNAMICS_SUPABASE_CONFIG;
  const localRaw = localStorage.getItem('ship-dynamics-supabase-config');
  let local: SupabaseConfig | null = null;
  try { local = localRaw ? JSON.parse(localRaw) : null; } catch { local = null; }
  const chosen = file && !isPlaceholder(file.supabaseUrl) && !isPlaceholder(file.supabaseAnonKey) ? file : local;
  if (!chosen || isPlaceholder(chosen.supabaseUrl) || isPlaceholder(chosen.supabaseAnonKey)) return null;
  return { ...chosen, tableName: chosen.tableName || 'ship_dynamics_app_state' };
}

let cached: { key: string; client: SupabaseClient } | null = null;
export function getSupabaseClient() {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  const key = `${cfg.supabaseUrl}|${cfg.supabaseAnonKey}`;
  if (cached?.key === key) return { client: cached.client, cfg };
  const client = createClient(cfg.supabaseUrl.trim(), cfg.supabaseAnonKey.trim());
  cached = { key, client };
  return { client, cfg };
}

export async function fetchCloudData(): Promise<AppData | null> {
  const pack = getSupabaseClient();
  if (!pack) return null;
  const { client, cfg } = pack;
  const { data, error } = await client.from(cfg.tableName!).select('payload,revision,updated_at').eq('workspace_key', cfg.workspaceKey).maybeSingle();
  if (error) throw error;
  if (!data?.payload) return null;
  return data.payload as AppData;
}

export async function saveCloudData(payload: AppData): Promise<void> {
  const pack = getSupabaseClient();
  if (!pack) return;
  const { client, cfg } = pack;
  const row = { workspace_key: cfg.workspaceKey, payload, revision: payload.revision || 1, updated_at: new Date().toISOString() };
  const { error } = await client.from(cfg.tableName!).upsert(row, { onConflict: 'workspace_key' });
  if (error) throw error;
}

export function saveSupabaseConfig(cfg: SupabaseConfig) {
  localStorage.setItem('ship-dynamics-supabase-config', JSON.stringify(cfg));
}
