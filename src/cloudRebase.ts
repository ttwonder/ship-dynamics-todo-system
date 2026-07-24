import type { AppData } from './types';

const COLLECTION_KEYS = ['users', 'vessels', 'tasks', 'internalControlCases', 'meetings', 'agendaReports', 'auditLogs', 'notifications'] as const;
type CollectionKey = typeof COLLECTION_KEYS[number];
type SnapshotName = 'base' | 'local' | 'remote';
type Identified = { id: string };

const clone = <T,>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class CloudRebaseConflictError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super(`雲端資料與本機修改發生重疊衝突：${conflicts.join('、')}`);
    this.name = 'CloudRebaseConflictError';
    this.conflicts = conflicts;
  }
}

function validateCollectionIds(key: CollectionKey, snapshot: SnapshotName, items: unknown[], conflicts: string[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (!plainObject(item) || typeof item.id !== 'string' || !item.id.trim()) {
      conflicts.push(`${key}:${snapshot}:invalid-id`);
      continue;
    }
    if (seen.has(item.id)) conflicts.push(`${key}:${snapshot}:duplicate-id:${item.id}`);
    seen.add(item.id);
  }
}

function mergeSettingsValue(base: unknown, local: unknown, remote: unknown, path: string, conflicts: string[]): unknown {
  if (equal(local, base)) return clone(remote);
  if (equal(remote, base)) return clone(local);
  if (equal(local, remote)) return clone(local);
  if (plainObject(base) && plainObject(local) && plainObject(remote)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = mergeSettingsValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  conflicts.push(path);
  return clone(remote);
}

function mergeCollection(key: CollectionKey, baseItems: Identified[], localItems: Identified[], remoteItems: Identified[], conflicts: string[]) {
  const baseById = new Map(baseItems.map(item => [item.id, item]));
  const localById = new Map(localItems.map(item => [item.id, item]));
  const remoteById = new Map(remoteItems.map(item => [item.id, item]));
  const ids = [...new Set([...localItems.map(item => item.id), ...remoteItems.map(item => item.id), ...baseItems.map(item => item.id)])];
  const merged: Identified[] = [];
  for (const id of ids) {
    const base = baseById.get(id);
    const local = localById.get(id);
    const remote = remoteById.get(id);
    let resolved: Identified | undefined;
    if (equal(local, base)) resolved = remote;
    else if (equal(remote, base)) resolved = local;
    else if (equal(local, remote)) resolved = local;
    else {
      conflicts.push(`${key}:${id}`);
      resolved = remote;
    }
    if (resolved) merged.push(clone(resolved));
  }
  if (key === 'auditLogs') return merged.sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 500);
  if (key === 'notifications') return merged.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return merged;
}

export function rebaseDisjointAppData(base: AppData, local: AppData, remote: AppData, at: string): AppData {
  const conflicts: string[] = [];
  for (const key of COLLECTION_KEYS) {
    validateCollectionIds(key, 'base', base[key] as Identified[], conflicts);
    validateCollectionIds(key, 'local', local[key] as Identified[], conflicts);
    validateCollectionIds(key, 'remote', remote[key] as Identified[], conflicts);
  }
  if (conflicts.length) throw new CloudRebaseConflictError([...new Set(conflicts)]);
  const settings = mergeSettingsValue(base.settings, local.settings, remote.settings, 'settings', conflicts) as AppData['settings'];
  const merged = { ...clone(remote), settings } as AppData;
  for (const key of COLLECTION_KEYS) {
    (merged[key] as Identified[]) = mergeCollection(key, base[key] as Identified[], local[key] as Identified[], remote[key] as Identified[], conflicts) as any;
  }
  if (conflicts.length) throw new CloudRebaseConflictError([...new Set(conflicts)]);
  merged.revision = remote.revision + 1;
  merged.updatedAt = at;
  return merged;
}
