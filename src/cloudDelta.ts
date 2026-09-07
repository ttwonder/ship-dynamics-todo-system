import { CLOUD_BLOCK_COLLECTIONS } from './cloudBlockPatch';

type JsonObject = Record<string, unknown>;
export type CloudDeltaSnapshot = {
  revision: number;
  token: string;
  payload: JsonObject;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fail = (): never => { throw new Error('雲端增量讀回格式或基準不一致；已停止套用以保留目前資料。'); };
const record = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as JsonObject;
};
const ids = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id) || new Set(value).size !== value.length) return fail();
  return value as string[];
};
const entities = (value: unknown): Map<string, JsonObject> => {
  if (!Array.isArray(value)) return fail();
  const result = new Map<string, JsonObject>();
  for (const item of value) {
    const row = record(item);
    if (typeof row.id !== 'string' || !row.id || result.has(row.id)) return fail();
    result.set(row.id, row);
  }
  return result;
};
const put = (target: JsonObject, key: string, value: unknown) => {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
};

/** Reconstitute a complete authoritative snapshot, never a submitted draft. */
export function consumeCloudDeltaResponse(
  response: unknown,
  workspaceKey: string,
  base: CloudDeltaSnapshot | null = null,
  reuseExactUnchangedBase = false,
): CloudDeltaSnapshot | null {
  const input = record(response);
  if (input.protocol !== 'ship-dynamics-delta-v1' || input.workspace_key !== workspaceKey) return fail();
  if (input.status === 'missing') return null;
  if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0) return fail();
  if (typeof input.payload_token !== 'string' || !input.payload_token) return fail();
  if (base && input.revision < base.revision) return fail();
  if (input.status === 'snapshot') {
    return { revision: input.revision, token: input.payload_token, payload: clone(record(input.payload)) };
  }
  if (input.status !== 'delta' || !base || input.base_revision !== base.revision || input.base_token !== base.token) return fail();
  const root = record(input.root);
  const replacements = record(root.set);
  const removedKeys = ids(root.deleted);
  const touched = new Set([...Object.keys(replacements), ...removedKeys]);
  if (touched.size !== Object.keys(replacements).length + removedKeys.length) return fail();
  if (!Array.isArray(input.collections)) return fail();
  // Internal opt-in only: no new revision/token, root field or collection change.
  // The adapter must also prove private raw provenance and caller integrity.
  if (reuseExactUnchangedBase && input.revision === base.revision && input.payload_token === base.token
    && touched.size === 0 && input.collections.length === 0) return base;
  const payload = clone(base.payload);
  for (const key of removedKeys) delete payload[key];
  for (const [key, value] of Object.entries(replacements)) put(payload, key, clone(value));

  for (const change of input.collections) {
    const delta = record(change);
    const collection = delta.collection;
    if (typeof collection !== 'string' || !(CLOUD_BLOCK_COLLECTIONS as readonly string[]).includes(collection) || touched.has(collection)) return fail();
    touched.add(collection);
    const current = entities(payload[collection]);
    const upserts = entities(delta.upserts);
    const deleted = ids(delta.deleted);
    let membershipChanged = false;
    for (const id of deleted) {
      if (upserts.has(id) || !current.has(id)) return fail();
      current.delete(id);
      membershipChanged = true;
    }
    for (const [id, row] of upserts) {
      if (!current.has(id)) membershipChanged = true;
      current.set(id, clone(row));
    }
    if (Object.prototype.hasOwnProperty.call(delta, 'order')) {
      const order = ids(delta.order);
      if (order.length !== current.size || order.some(id => !current.has(id))) return fail();
      payload[collection] = order.map(id => current.get(id)!);
    } else {
      if (membershipChanged) return fail();
      payload[collection] = [...current.values()];
    }
  }
  return { revision: input.revision, token: input.payload_token, payload };
}
