import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from './types';
import { isPlaceholder, sanitizeAppDataForStorage } from './utils';
import { normalizeAppData } from './normalize';
import { CloudBlockPatchConflictError, type CloudBlockPatchOperation } from './cloudBlockPatch';

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

export class CloudBlockPatchUnavailableError extends Error{
  constructor(){super('Supabase 原子區塊保存 RPC 尚未部署');this.name='CloudBlockPatchUnavailableError';}
}

const rawPayloadByNormalized=new WeakMap<AppData,AppData>();
const jsonClone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

export function cloudStoragePayloadFor(data:AppData):AppData{
  return jsonClone(rawPayloadByNormalized.get(data)||data);
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

export function subscribeToCloudRevision(
  onRevision:(revision:number)=>void,
  onStatus?:(status:string)=>void,
  config?:ResolvedSupabaseConfig|null,
){
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase=getSupabaseClient(cfg);
  if(!supabase||!cfg)return()=>{};
  const channel=supabase
    .channel(`ship-dynamics-revision-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes',{
      event:'*',
      schema:'public',
      table:cfg.tableName,
      filter:`workspace_key=eq.${cfg.workspaceKey}`,
    },payload=>{
      const revision=Number((payload.new as{revision?:unknown}|null)?.revision);
      if(Number.isSafeInteger(revision)&&revision>=0)onRevision(revision);
    })
    .subscribe(status=>onStatus?.(String(status)));
  return()=>{void supabase.removeChannel(channel);};
}

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
  const rawPayload=jsonClone(data.payload as AppData);
  const normalized = normalizeAppData(data.payload);
  if (!normalized) throw new Error('雲端資料格式不完整，已拒絕載入以避免白頁或資料污染。');
  normalized.revision = sourceRevision;
  rawPayload.revision=sourceRevision;
  rawPayloadByNormalized.set(normalized,rawPayload);
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

export async function applyCloudBlockPatch(
  operations:readonly CloudBlockPatchOperation[],
  savedByName:string,
  actorUserId:string,
  actorGuard:unknown,
  authorizationGuard:unknown|null,
  lockGuards:readonly {section_key:string;locked_by:string}[],
  config?:ResolvedSupabaseConfig|null,
  signal?:AbortSignal,
):Promise<AppData>{
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase=getSupabaseClient(cfg);
  if(!supabase||!cfg)throw new Error('尚未配置 Supabase；無法使用原子區塊保存。');
  if(!actorUserId)throw new Error('缺少保存者身份；已拒絕原子區塊保存。');
  let request=supabase.rpc('apply_ship_dynamics_block_patch',{
    p_workspace_key:cfg.workspaceKey,
    p_operations:operations,
    p_saved_by:savedByName,
    p_actor_user_id:actorUserId,
    p_actor_guard:actorGuard,
    p_authorization_guard:authorizationGuard,
    p_lock_guards:lockGuards,
  });
  if(signal)request=request.abortSignal(signal);
  const{data,error}=await request;
  if(error){
    const code=String((error as{code?:string}).code||'');
    if(code==='PGRST202')throw new CloudBlockPatchUnavailableError();
    throw error;
  }
  if(!data||data.ok!==true){
    const conflictKey=String(data?.conflict_key||data?.code||'unknown');
    if(data?.code==='block-conflict'||data?.code==='authorization-conflict')throw new CloudBlockPatchConflictError(data?.code==='authorization-conflict'?'authorization-domain':conflictKey);
    throw new Error(`原子區塊保存被拒絕：${String(data?.code||'invalid-response')}`);
  }
  const rawPayload=jsonClone(data.payload as AppData);
  const normalized=normalizeAppData(data.payload);
  if(!normalized)throw new Error('原子區塊保存回應缺少完整且有效的雲端資料');
  const revision=Number(data.revision);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('原子區塊保存回應的 revision 無效');
  normalized.revision=revision;
  if(typeof data.updated_at==='string'&&data.updated_at)normalized.updatedAt=data.updated_at;
  rawPayload.revision=revision;
  if(typeof data.updated_at==='string'&&data.updated_at)rawPayload.updatedAt=data.updated_at;
  rawPayloadByNormalized.set(normalized,rawPayload);
  return normalized;
}

export async function claimEditLock(sectionKey: string, lockedBy: string, lockedByName: string, ttlSeconds = 75, config?: ResolvedSupabaseConfig|null, signal?: AbortSignal): Promise<CloudEditingLock> {
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) return { ok: true, sectionKey };
  let request = supabase.rpc('claim_ship_dynamics_edit_lock', {
    p_workspace_key: cfg.workspaceKey,
    p_section_key: sectionKey,
    p_locked_by: lockedBy,
    p_locked_by_name: lockedByName,
    p_ttl_seconds: ttlSeconds,
  });
  if(signal)request=request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return lockFromRpc(data, sectionKey);
}

export async function renewEditLock(sectionKey: string, lockedBy: string, ttlSeconds = 75, config?: ResolvedSupabaseConfig|null, signal?: AbortSignal): Promise<CloudEditingLock> {
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase=getSupabaseClient(cfg);
  if(!supabase||!cfg)return{ok:true,sectionKey};
  let request=supabase.rpc('renew_ship_dynamics_edit_lock',{
    p_workspace_key:cfg.workspaceKey,
    p_section_key:sectionKey,
    p_locked_by:lockedBy,
    p_ttl_seconds:ttlSeconds,
  });
  if(signal)request=request.abortSignal(signal);
  const{data,error}=await request;
  if(error)throw error;
  return lockFromRpc(data,sectionKey);
}

export async function releaseEditLock(sectionKey: string, lockedBy: string, config?: ResolvedSupabaseConfig|null, signal?: AbortSignal): Promise<void> {
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) return;
  let request = supabase.rpc('release_ship_dynamics_edit_lock', {
    p_workspace_key: cfg.workspaceKey,
    p_section_key: sectionKey,
    p_locked_by: lockedBy,
  });
  if(signal)request=request.abortSignal(signal);
  const { error } = await request;
  if (error) throw error;
}
