import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from './cloud';
import type { InternalControlPrintCase, InternalControlPrintVessel } from './InternalControlPrintList';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hex64 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let authGeneration = 0;
let adminSession: { token: string; userId: string; origin: string; expiresAt: number } | null = null;
let sessionError = '';
const identity = (cfg: ResolvedSupabaseConfig) => `${cfg.supabaseUrl}|${cfg.workspaceKey}|${cfg.supabaseAnonKey}`;

export function clearInternalControlAdminSession() {
  ++authGeneration;
  adminSession = null;
  sessionError = '';
}

function cloud() {
  const config = getSupabaseConfig();
  const client = getSupabaseClient(config);
  if (!config || !client || config.tableName !== 'ship_dynamics_app_state') throw new Error('船端下載需要主站雲端服務，沒有使用本機資料。');
  return { config, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { client } = cloud();
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('船端內控下載 SQL 尚未部署；請通知 Owner。');
    if (error.message.includes('ship-internal-download-denied') || error.message.includes('ship-internal-download-rate-limited')) throw new Error('船舶或密碼無法通過核對，或嘗試過於頻繁；未提供任何清單。');
    if (error.message.includes('ship-internal-admin-denied')) throw new Error('雲端管理授權無效或已過期；請重新以 Owner／管理員登入。');
    throw new Error('雲端未完成驗證或讀取，沒有提供內控清單；請稍後再試。');
  }
  if (object(data) && data.ok === false) {
    if (data.code === 'download-denied' || data.code === 'rate-limited') throw new Error('船舶或密碼無法通過核對，或嘗試過於頻繁；未提供任何清單。');
    if (data.code === 'admin-session-denied' || data.code === 'admin-auth-denied') throw new Error('雲端 Owner／管理員授權無效或已過期；請以現有身分重新登入。');
    if (data.code === 'request-ip-required') throw new Error('雲端無法取得本次請求 IP；為避免產生無水印清單，已停止下載或管理。');
    throw new Error('雲端拒絕本次請求；未提供任何清單或密碼。');
  }
  return data as unknown;
}

// Reuse the EXISTING personnel password entry. Never send a client-side hash as
// a bearer credential; a hash is already visible in the legacy public snapshot.
// Token stays in JS memory only and is invalidated when identity changes.
export async function issueInternalControlAdminSession(userId: string, password: string): Promise<void> {
  const generation = authGeneration;
  try {
    const { config } = cloud();
    const result = await call('issue_ship_dynamics_internal_control_admin_session_v1', {
      p_workspace_key: config.workspaceKey, p_user_id: userId, p_password: password,
    });
    if (!object(result) || typeof result.token !== 'string' || !hex64.test(result.token)
      || typeof result.expires_at !== 'string' || !Number.isFinite(Date.parse(result.expires_at))) throw new Error('雲端未回覆有效管理授權。');
    if (generation !== authGeneration || identity(config) !== identity(cloud().config)) return;
    adminSession = { token: result.token, userId, origin: identity(config), expiresAt: Date.parse(result.expires_at) };
    sessionError = '';
  } catch (error) {
    if (generation === authGeneration) sessionError = error instanceof Error ? error.message : '雲端未簽發管理授權。';
  } finally {
    if (generation === authGeneration) window.dispatchEvent(new Event('ship-internal-download-admin-session'));
  }
}

export function internalControlAdminSessionStatus(userId: string): { authorized: boolean; message: string } {
  const config = getSupabaseConfig();
  return {
    authorized: Boolean(config && adminSession && adminSession.userId === userId
      && adminSession.origin === identity(config) && adminSession.expiresAt > Date.now()),
    message: sessionError || '此分頁須由目前 Owner／管理員在本次頁面以既有人員密碼登入；請切換身分並重新登入。',
  };
}

function adminArgs(userId: string) {
  const { config } = cloud();
  const { authorized } = internalControlAdminSessionStatus(userId);
  if (!authorized || !adminSession) throw new Error('雲端管理授權不存在或已過期；請以既有 Owner／管理員身分重新登入。');
  return { p_workspace_key: config.workspaceKey, p_token: adminSession.token };
}

export type DownloadAudit = {
  receipt_id: string; vessel_id: string; created_at: string; ip_address: string | null;
  case_count: number; result: string; actor_id: string | null;
};
export type DownloadManagerList = { vessels: { vessel_id: string; configured: boolean }[]; logs: DownloadAudit[] };
export async function listInternalControlDownloads(userId: string): Promise<DownloadManagerList> {
  const response = await call('manage_ship_dynamics_internal_control_download_v1', { ...adminArgs(userId), p_action: 'list', p_vessel_id: null });
  if (!object(response) || !Array.isArray(response.vessels) || !Array.isArray(response.logs)
    || !response.vessels.every(item => object(item) && typeof item.vessel_id === 'string' && typeof item.configured === 'boolean')
    || !response.logs.every(item => object(item) && typeof item.receipt_id === 'string'
      && typeof item.vessel_id === 'string' && typeof item.created_at === 'string'
      && (item.ip_address === null || typeof item.ip_address === 'string')
      && typeof item.case_count === 'number' && typeof item.result === 'string')) throw new Error('雲端下載管理紀錄回覆不完整。');
  return response as DownloadManagerList;
}

export async function resetInternalControlDownloadPassword(userId: string, vesselId: string): Promise<string> {
  const response = await call('manage_ship_dynamics_internal_control_download_v1', { ...adminArgs(userId), p_action: 'reset', p_vessel_id: vesselId });
  if (!object(response) || response.vessel_id !== vesselId || typeof response.password !== 'string' || !hex64.test(response.password)) throw new Error('雲端密碼重設結果不完整，未展示新密碼。');
  return response.password;
}

export type ShipInternalControlDownload = {
  receipt_id: string; vessel: InternalControlPrintVessel & { shipType?: string };
  issued_at: string; ip_address: string; case_count: number;
  cases: InternalControlPrintCase[];
};
export async function downloadShipInternalControl(vesselId: string, password: string): Promise<ShipInternalControlDownload> {
  const { config } = cloud();
  const response = await call('download_ship_dynamics_internal_control_v1', {
    p_workspace_key: config.workspaceKey, p_vessel_id: vesselId, p_password: password,
  });
  if (!object(response) || typeof response.receipt_id !== 'string' || !uuid.test(response.receipt_id)
    || !object(response.vessel) || response.vessel.id !== vesselId
    || !['name', 'shortName', 'fullName'].every(key => typeof (response.vessel as Record<string, unknown>)[key] === 'string')
    || typeof response.issued_at !== 'string' || !Number.isFinite(Date.parse(response.issued_at))
    || typeof response.ip_address !== 'string' || !response.ip_address
    || !Array.isArray(response.cases) || response.case_count !== response.cases.length
    || !response.cases.every(item => object(item) && item.vesselId === vesselId
      && item.closedDate == null && typeof item.id === 'string' && typeof item.reportDate === 'string'
      && typeof item.reportSource === 'string' && typeof item.priority === 'string'
      && typeof item.description === 'string' && typeof item.category === 'string'
      && typeof item.equipmentSubcategory === 'string' && Array.isArray(item.departments)
      && item.departments.every((entry: unknown) => typeof entry === 'string')
      && typeof item.status === 'string')) throw new Error('雲端回覆的船舶或案件範圍不正確；已拒絕產生 PDF。');
  return response as ShipInternalControlDownload;
}
