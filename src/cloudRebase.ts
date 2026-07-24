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

const changedIds = (baseItems: Identified[], sideItems: Identified[]) => {
  const baseById = new Map(baseItems.map(item => [item.id, item]));
  const sideById = new Map(sideItems.map(item => [item.id, item]));
  return new Set([...new Set([...baseById.keys(), ...sideById.keys()])].filter(id => !equal(baseById.get(id), sideById.get(id))));
};

const settingsKeyChanged = (base: AppData, side: AppData, key: keyof AppData['settings']) => !equal(base.settings[key], side.settings[key]);
const SENSITIVE_SETTINGS: (keyof AppData['settings'])[] = ['sitePasswordHash', 'rolePermissions', 'nonOwnerPasswordResetVersion'];
const vesselAuthorizationShape = (data: AppData) => data.vessels.map(vessel=>({
  id:vessel.id,
  isActive:vessel.isActive,
  assignedUserIds:[...(vessel.assignedUserIds||[])].sort(),
  delegateManagers:[...(vessel.delegateManagers||[])].map(item=>({userId:item.userId,isActive:item.isActive})).sort((left,right)=>left.userId.localeCompare(right.userId)),
})).sort((left,right)=>left.id.localeCompare(right.id));
const vesselAuthorizationChanged = (base: AppData, side: AppData) => !equal(vesselAuthorizationShape(base),vesselAuthorizationShape(side));

function meaningfulChange(base: AppData, side: AppData) {
  if (!equal(base.settings, side.settings)) return true;
  return COLLECTION_KEYS.some(key => key !== 'auditLogs' && !equal(base[key], side[key]));
}

function relationshipValues(baseItems: any[], sideItems: any[], ids: Set<string>, read: (item: any) => string[]) {
  const values = new Set<string>();
  for (const item of [...baseItems, ...sideItems]) if (ids.has(item.id)) read(item).filter(Boolean).forEach(value => values.add(value));
  return values;
}

const intersects = (left: Set<string>, right: Set<string>) => [...left].some(value => right.has(value));

function detectDependencyConflicts(base: AppData, local: AppData, remote: AppData, conflicts: string[]) {
  const localSensitive = !equal(base.users, local.users) || vesselAuthorizationChanged(base,local) || SENSITIVE_SETTINGS.some(key => settingsKeyChanged(base, local, key));
  const remoteSensitive = !equal(base.users, remote.users) || vesselAuthorizationChanged(base,remote) || SENSITIVE_SETTINGS.some(key => settingsKeyChanged(base, remote, key));
  if ((localSensitive && meaningfulChange(base, remote)) || (remoteSensitive && meaningfulChange(base, local))) conflicts.push('authorization-domain');
  const changed = (side: AppData, key: CollectionKey) => changedIds(base[key] as Identified[], side[key] as Identified[]);
  const localTaskIds = changed(local, 'tasks');
  const remoteTaskIds = changed(remote, 'tasks');
  const localCaseIds = changed(local, 'internalControlCases');
  const remoteCaseIds = changed(remote, 'internalControlCases');
  const localMeetingIds = changed(local, 'meetings');
  const remoteMeetingIds = changed(remote, 'meetings');
  const localVesselIds = changed(local, 'vessels');
  const remoteVesselIds = changed(remote, 'vessels');
  const taskCases = (side: AppData, ids: Set<string>) => relationshipValues(base.tasks, side.tasks, ids, item => [item.internalControlCaseId || '']);
  const taskMeetings = (side: AppData, ids: Set<string>) => relationshipValues(base.tasks, side.tasks, ids, item => [item.sourceMeetingId || '']);
  const taskVessels = (side: AppData, ids: Set<string>) => relationshipValues(base.tasks, side.tasks, ids, item => [item.vesselId || '', ...(item.vesselIds || [])]);
  const caseTasks = (side: AppData, ids: Set<string>) => relationshipValues(base.internalControlCases, side.internalControlCases, ids, item => [item.linkedTaskId || '']);
  const caseVessels = (side: AppData, ids: Set<string>) => relationshipValues(base.internalControlCases, side.internalControlCases, ids, item => [item.vesselId || '']);
  if (intersects(taskCases(local, localTaskIds), remoteCaseIds) || intersects(taskCases(remote, remoteTaskIds), localCaseIds)) conflicts.push('dependency:internal-control');
  if (intersects(caseTasks(local, localCaseIds), remoteTaskIds) || intersects(caseTasks(remote, remoteCaseIds), localTaskIds)) conflicts.push('dependency:internal-control-task');
  if (intersects(taskMeetings(local, localTaskIds), remoteMeetingIds) || intersects(taskMeetings(remote, remoteTaskIds), localMeetingIds)) conflicts.push('dependency:meeting-task');
  if (intersects(taskVessels(local, localTaskIds), remoteVesselIds) || intersects(taskVessels(remote, remoteTaskIds), localVesselIds) || intersects(caseVessels(local, localCaseIds), remoteVesselIds) || intersects(caseVessels(remote, remoteCaseIds), localVesselIds)) conflicts.push('dependency:vessel-scope');
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
  detectDependencyConflicts(base, local, remote, conflicts);
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
