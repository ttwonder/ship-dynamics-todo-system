// Development-only record-store capability. This is independent of readMode:
// selecting a read optimization must never silently switch write authority.
export function usesRecordStorage(config: { storageMode?: 'legacy' | 'records-v1'; readMode?: 'snapshot' | 'delta-v1' | 'scoped-v1'; tableName: string }): boolean {
  if (config.storageMode && config.storageMode !== 'legacy' && config.storageMode !== 'records-v1') throw new Error('不支援的雲端儲存模式；已停止讀寫。');
  if (config.storageMode !== 'records-v1') return false;
  if (config.tableName !== 'ship_dynamics_app_state' || (config.readMode && config.readMode !== 'snapshot' && config.readMode !== 'delta-v1' && config.readMode !== 'scoped-v1')) throw new Error('逐筆儲存測試模式與目前設定不相容；未切換權威來源。');
  return true;
}

export function consumeRecordSnapshot(value: unknown, workspaceKey: string): { payload: Record<string, unknown>; revision: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('逐筆儲存回應無效');
  const row = value as Record<string, unknown>;
  if (row.protocol !== 'ship-dynamics-records-v1' || row.workspace_key !== workspaceKey) throw new Error('逐筆儲存回應協議或工作區不符');
  if (row.status === 'missing') return null;
  if (row.status !== 'snapshot' || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0
    || !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) throw new Error('逐筆儲存快照格式無效');
  const payload = row.payload as Record<string, unknown>;
  if (payload.revision !== row.revision || typeof payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(payload.updatedAt))) throw new Error('逐筆儲存快照版本不一致');
  return { payload, revision: row.revision };
}
