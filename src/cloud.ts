import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from './types';
import { isPlaceholder, sanitizeAppDataForStorage } from './utils';
import { normalizeAppData } from './normalize';
import { CloudBlockPatchConflictError, type CloudBlockPatchOperation } from './cloudBlockPatch';
import type { CloudBlockCompactReceipt, CloudBlockReceiptStatus } from './cloudBlockReceipt';
import { consumeCloudDeltaResponse, type CloudDeltaSnapshot } from './cloudDelta';
import { consumeRecordSnapshot, usesRecordStorage } from './cloudRecords';
import { consumeRecordScopes, recordScopePayload, recordScopeVersions, type RecordReadScope, type RecordScopeSnapshot } from './cloudRecordScopes';

export interface SupabaseConfig { supabaseUrl: string; supabaseAnonKey: string; workspaceKey: string; tableName?: string; readMode?: 'snapshot' | 'delta-v1' | 'scoped-v1'; storageMode?: 'legacy' | 'records-v1' }
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

export class CloudBlockPatchV2UnavailableError extends Error{
  constructor(){super('Supabase compact receipt RPC 尚未部署');this.name='CloudBlockPatchV2UnavailableError';}
}

export class CloudBlockPatchRejectedError extends Error{
  readonly code:string;
  constructor(code:string){super(`原子區塊保存被拒絕：${code}`);this.name='CloudBlockPatchRejectedError';this.code=code;}
}

const rawPayloadByNormalized=new WeakMap<AppData,AppData>();
const jsonClone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

export function cloudStoragePayloadFor(data:AppData):AppData{
  return jsonClone(rawPayloadByNormalized.get(data)||data);
}

export function getSupabaseClient(config?: ResolvedSupabaseConfig|null) {
  const cfg = config===undefined?getSupabaseConfig():config;
  if (!cfg) return null;
  usesRecordStorage(cfg); // Reject unknown/mixed authority modes before any request.
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

export function cloudChangeFeedTable(config:ResolvedSupabaseConfig):string {
  return usesRecordStorage(config)?'ship_dynamics_record_workspaces':config.tableName;
}

export function subscribeToCloudRevision(
  onRevision:(revision:number)=>void,
  onStatus?:(status:string)=>void,
  config?:ResolvedSupabaseConfig|null,
){
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase=getSupabaseClient(cfg);
  if(!supabase||!cfg)return()=>{};
  // Subscribe to the selected authority; hosted publication is a separate gate.
  const channel=supabase
    .channel(`ship-dynamics-revision-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes',{
      event:'*',
      schema:'public',
      table:cloudChangeFeedTable(cfg),
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

type CloudDeltaReadCache = {
  key: string;
  snapshot: CloudDeltaSnapshot | null;
  sequence: number;
  publishedSequence: number;
};
let deltaReadCache: CloudDeltaReadCache | null = null;
// A WeakMap hit alone is NOT integrity: callers can edit normalized AppData.
// Bind the full normalized JSON to the private raw snapshot and cache generation.
const freshnessBases = new WeakMap<AppData, { cache: CloudDeltaReadCache; snapshot: CloudDeltaSnapshot; json: string }>();

const normalizedCloudRead = (payload: Record<string, unknown>, revision: number): AppData => {
  // Normalize a detached copy; neither the UI nor compatibility normalization may
  // mutate the exact server snapshot/token used by the next delta request.
  const rawPayload = jsonClone(payload) as unknown as AppData;
  const normalized = normalizeAppData(jsonClone(payload));
  if (!normalized) throw new Error('雲端資料格式不完整，已拒絕載入以避免白頁或資料污染。');
  normalized.revision = revision;
  rawPayload.revision = revision;
  rawPayloadByNormalized.set(normalized, rawPayload);
  return normalized;
};

async function fetchCloudDeltaData(cfg: ResolvedSupabaseConfig, supabase: SupabaseClient, signal?: AbortSignal, confirmedForFreshness?: AppData): Promise<AppData | null> {
  if (cfg.tableName !== 'ship_dynamics_app_state') throw new Error('增量讀回尚未支援此資料表；已停止讀取，未切換工作區。');
  signal?.throwIfAborted();
  const recordStorage = usesRecordStorage(cfg);
  const key = JSON.stringify([cfg.supabaseUrl, cfg.supabaseAnonKey, cfg.tableName, cfg.workspaceKey, recordStorage ? 'records-v1' : 'legacy']);
  if (!deltaReadCache || deltaReadCache.key !== key) deltaReadCache = { key, snapshot: null, sequence: 0, publishedSequence: 0 };
  const cache = deltaReadCache;
  const base = cache.snapshot;
  const sequence = ++cache.sequence;
  let request = supabase.rpc(recordStorage ? 'read_ship_dynamics_record_delta_v1' : 'read_ship_dynamics_delta_v1', {
    p_workspace_key: cfg.workspaceKey,
    p_base_revision: base?.revision ?? null,
    p_base_token: base?.token ?? null,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  signal?.throwIfAborted();
  if (error) throw error; // Opt-in capability errors are not hidden by a legacy fallback.
  const proof = confirmedForFreshness && freshnessBases.get(confirmedForFreshness);
  const reusable = !!(proof && deltaReadCache === cache && proof.cache === cache
    && base && cache.snapshot === base && sequence >= cache.publishedSequence
    && proof.snapshot.revision === base.revision && proof.snapshot.token === base.token
    && JSON.stringify(confirmedForFreshness) === proof.json
    // An intervening complete read may have detached the same raw base again.
    // Prove full raw equality, never infer it from revision/token or object ID.
    && (proof.snapshot === base || JSON.stringify(proof.snapshot.payload) === JSON.stringify(base.payload)));
  const next = consumeCloudDeltaResponse(data, cfg.workspaceKey, base, reusable);
  if (!next) {
    if (deltaReadCache === cache && sequence < cache.publishedSequence && cache.snapshot) {
      return normalizedCloudRead(cache.snapshot.payload, cache.snapshot.revision);
    }
    if (deltaReadCache === cache && sequence >= cache.publishedSequence) {
      cache.snapshot = null;
      cache.publishedSequence = sequence;
    }
    return null;
  }
  // A delayed response must never replace a newer confirmed cache. Requests from
  // a previous project/workspace can return to their owner but cannot seed this one.
  if (deltaReadCache === cache && !cache.snapshot && cache.publishedSequence > sequence) return null;
  const current = deltaReadCache === cache ? cache.snapshot : null;
  const useCurrent = current && (current.revision > next.revision || (current.revision === next.revision && cache.publishedSequence > sequence));
  const chosen = useCurrent ? current : next;
  // All response ordering rules above still run before reusing a complete model.
  const unchanged = reusable && next === base && !useCurrent;
  const normalized = unchanged ? confirmedForFreshness! : normalizedCloudRead(chosen.payload, chosen.revision);
  if (!unchanged) freshnessBases.set(normalized, { cache, snapshot: chosen, json: JSON.stringify(normalized) });
  signal?.throwIfAborted();
  if (deltaReadCache === cache && !useCurrent && sequence >= cache.publishedSequence) {
    cache.snapshot = next;
    cache.publishedSequence = sequence;
  }
  return normalized;
}

/** The third argument is reserved for the single-vessel editor freshness check.
 * Default callers still receive newly materialized complete authoritative AppData. */
export async function fetchCloudData(config?: ResolvedSupabaseConfig | null, signal?: AbortSignal, confirmedForFreshness?: AppData, scope:RecordReadScope='full'): Promise<AppData | null> {
  const cfg = config === undefined ? getSupabaseConfig() : config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) { deltaReadCache = null; return null; }
  if (usesRecordStorage(cfg)) {
    if (cfg.readMode === 'scoped-v1') return fetchCloudRecordScope(cfg,supabase,scope,signal);
    if (cfg.readMode === 'delta-v1') return fetchCloudDeltaData(cfg, supabase, signal, confirmedForFreshness);
    deltaReadCache = null;
    signal?.throwIfAborted();
    let request = supabase.rpc('read_ship_dynamics_records_v1', { p_workspace_key: cfg.workspaceKey });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    signal?.throwIfAborted();
    if (error) throw error;
    const snapshot = consumeRecordSnapshot(data, cfg.workspaceKey);
    return snapshot ? normalizedCloudRead(snapshot.payload, snapshot.revision) : null;
  }
  if (cfg.readMode === 'delta-v1') return fetchCloudDeltaData(cfg, supabase, signal, confirmedForFreshness);
  if (cfg.readMode && cfg.readMode !== 'snapshot') throw new Error('不支援的雲端讀取模式；已停止讀取。');
  deltaReadCache = null;
  let request = supabase
    .from(cfg.tableName)
    .select('payload,revision,updated_at,updated_by')
    .eq('workspace_key', cfg.workspaceKey);
  if(signal)request=request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();
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

type ScopeCache={key:string;sequence:number;published:number;snapshot:RecordScopeSnapshot|null};
const scopeCaches=new Map<RecordReadScope,ScopeCache>();
async function fetchCloudRecordScope(cfg:ResolvedSupabaseConfig,supabase:SupabaseClient,scope:RecordReadScope,signal?:AbortSignal):Promise<AppData|null>{
  signal?.throwIfAborted();
  const key=JSON.stringify([cfg.supabaseUrl,cfg.supabaseAnonKey,cfg.workspaceKey,cfg.tableName,cfg.storageMode,cfg.readMode]);
  let cache=scopeCaches.get(scope);
  if(!cache||cache.key!==key){cache={key,sequence:0,published:0,snapshot:null};scopeCaches.set(scope,cache);}
  const owner=cache,base=owner.snapshot,sequence=++owner.sequence;
  let request=supabase.rpc('read_ship_dynamics_record_scopes_v1',{p_workspace_key:cfg.workspaceKey,p_scope:scope,p_versions:recordScopeVersions(base)});
  if(signal)request=request.abortSignal(signal);
  const {data,error}=await request;signal?.throwIfAborted();if(error)throw error;
  const next=consumeRecordScopes(data,cfg.workspaceKey,scope,base);
  if(scopeCaches.get(scope)!==owner)throw new Error('stale-record-scope-config');
  if(sequence<owner.published)return owner.snapshot?normalizedCloudRead(recordScopePayload(owner.snapshot),owner.snapshot.revision):null;
  if(owner.snapshot&&next&&next.revision<owner.snapshot.revision)throw new Error('record-scope-revision-rollback');
  const normalized=next?normalizedCloudRead(recordScopePayload(next),next.revision):null;
  owner.published=sequence;owner.snapshot=next;
  return normalized;
}

/** Compare-and-swap save. Every caller must provide the revision it last observed. */
export async function saveCloudData(payload: AppData, expectedRevision: number, savedByName = 'unknown', config?: ResolvedSupabaseConfig | null): Promise<number> {
  const cfg = config === undefined ? getSupabaseConfig() : config;
  const supabase = getSupabaseClient(cfg);
  if (!supabase || !cfg) throw new Error('尚未配置 Supabase；資料只保存在此瀏覽器。');
  if (usesRecordStorage(cfg)) throw new CloudBlockPatchRejectedError('record-full-save-disabled');
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
  if(usesRecordStorage(cfg))throw new CloudBlockPatchRejectedError('record-v1-fallback-disabled');
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

const cloudBlockCompactReceiptFromRpc=(value:any,expectedOperationId:string):CloudBlockCompactReceipt=>{
  const revision=Number(value?.revision);
  const operationId=String(value?.operation_id||'');
  const updatedAt=String(value?.updated_at||'');
  if(value?.ok!==true||value?.status!=='committed'||operationId!==expectedOperationId||!Number.isSafeInteger(revision)||revision<0||!updatedAt){
    throw new Error('雲端保存 receipt 格式無效');
  }
  return{ok:true,status:'committed',operationId,revision,updatedAt,replayed:Boolean(value.replayed)};
};

const throwCloudBlockRpcRejection=(value:any):never=>{
  const code=String(value?.code||'invalid-response');
  const conflictKey=String(value?.conflict_key||code||'unknown');
  if(code==='block-conflict'||code==='authorization-conflict')throw new CloudBlockPatchConflictError(code==='authorization-conflict'?'authorization-domain':conflictKey);
  throw new CloudBlockPatchRejectedError(code);
};

export async function applyCloudBlockPatchV2(
  operationId:string,
  operations:readonly CloudBlockPatchOperation[],
  savedByName:string,
  actorUserId:string,
  actorGuard:unknown,
  authorizationGuard:unknown|null,
  lockGuards:readonly {section_key:string;locked_by:string}[],
  config?:ResolvedSupabaseConfig|null,
  signal?:AbortSignal,
):Promise<CloudBlockCompactReceipt>{
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase=getSupabaseClient(cfg);
  if(!supabase||!cfg)throw new Error('尚未配置 Supabase；無法使用 compact 原子區塊保存。');
  if(!actorUserId)throw new CloudBlockPatchRejectedError('missing-actor');
  let request=supabase.rpc(usesRecordStorage(cfg)?'apply_ship_dynamics_record_patch_v1':'apply_ship_dynamics_block_patch_v2',{
    p_workspace_key:cfg.workspaceKey,
    p_operation_id:operationId,
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
    if(String((error as{code?:string}).code||'')==='PGRST202')throw new CloudBlockPatchV2UnavailableError();
    throw error;
  }
  if(data?.ok===false)throwCloudBlockRpcRejection(data);
  return cloudBlockCompactReceiptFromRpc(data,operationId);
}

export async function getCloudBlockPatchReceipt(
  operationId:string,
  operations:readonly CloudBlockPatchOperation[],
  savedByName:string,
  actorUserId:string,
  actorGuard:unknown,
  authorizationGuard:unknown|null,
  lockGuards:readonly {section_key:string;locked_by:string}[],
  config?:ResolvedSupabaseConfig|null,
  signal?:AbortSignal,
):Promise<CloudBlockReceiptStatus>{
  const cfg=config===undefined?getSupabaseConfig():config;
  const supabase=getSupabaseClient(cfg);
  if(!supabase||!cfg)throw new Error('尚未配置 Supabase；無法查詢保存 receipt。');
  let request=supabase.rpc(usesRecordStorage(cfg)?'get_ship_dynamics_record_receipt_v1':'get_ship_dynamics_block_patch_receipt',{
    p_workspace_key:cfg.workspaceKey,
    p_operation_id:operationId,
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
    if(String((error as{code?:string}).code||'')==='PGRST202')throw new CloudBlockPatchV2UnavailableError();
    throw error;
  }
  if(data?.status==='missing')return{status:'missing'};
  if(data?.status==='mismatch')throwCloudBlockRpcRejection(data);
  return cloudBlockCompactReceiptFromRpc(data,operationId);
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
