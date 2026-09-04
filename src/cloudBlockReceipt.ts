export const CLOUD_BLOCK_RECEIPT_RECONCILE_AFTER_MS = 8_500;

export type CloudBlockCompactReceipt = {
  ok: true;
  status: 'committed';
  operationId: string;
  revision: number;
  updatedAt: string;
  replayed: boolean;
};

export type CloudBlockReceiptStatus = CloudBlockCompactReceipt | { status: 'missing' };

export class CloudBlockPatchOutcomeUnknownError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super('雲端可能已完成保存，但目前無法讀取 operation receipt；已停止重送並保留本機修改。');
    this.name = 'CloudBlockPatchOutcomeUnknownError';
    this.operationId = operationId;
  }
}

export class CloudBlockPatchConfirmedRefreshError extends Error {
  readonly receipt: CloudBlockCompactReceipt;

  constructor(receipt: CloudBlockCompactReceipt) {
    super(`雲端已確認保存 revision ${receipt.revision}，但尚未安全讀回完整權威資料；已停止後續寫入並保留本機畫面。`);
    this.name = 'CloudBlockPatchConfirmedRefreshError';
    this.receipt = receipt;
  }
}

type CloudBlockReceiptOptions = {
  operationId: string;
  submit: (operationId: string) => Promise<CloudBlockCompactReceipt>;
  lookup: (operationId: string) => Promise<CloudBlockReceiptStatus>;
  shouldReconcile: (error: unknown) => boolean;
  assertCurrent: () => void;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

const validateCommittedReceipt = (value: CloudBlockReceiptStatus, operationId: string): CloudBlockCompactReceipt | null => {
  if (value.status === 'missing') return null;
  if (
    value.ok !== true
    || value.status !== 'committed'
    || value.operationId !== operationId
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || typeof value.updatedAt !== 'string'
    || !value.updatedAt
  ) throw new Error('雲端保存 receipt 格式無效');
  return value;
};

export async function runCloudBlockPatchWithReceipt(options: CloudBlockReceiptOptions): Promise<CloudBlockCompactReceipt> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (delayMs => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.assertCurrent();
    const startedAt = now();
    try {
      const result = await options.submit(options.operationId);
      const receipt = validateCommittedReceipt(result, options.operationId);
      if (!receipt) throw new Error('雲端保存 RPC 未回傳 committed receipt');
      return receipt;
    } catch (error) {
      if (!options.shouldReconcile(error)) throw error;
      const remaining = CLOUD_BLOCK_RECEIPT_RECONCILE_AFTER_MS - (now() - startedAt);
      if (remaining > 0) await sleep(remaining);
      options.assertCurrent();
      let receipt: CloudBlockCompactReceipt | null;
      try {
        receipt = validateCommittedReceipt(await options.lookup(options.operationId), options.operationId);
      } catch {
        throw new CloudBlockPatchOutcomeUnknownError(options.operationId);
      }
      if (receipt) return receipt;
      if (attempt === 1) throw error;
    }
  }
  throw new Error('雲端保存未完成');
}
