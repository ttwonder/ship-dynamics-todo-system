import type { TaskItem } from './types';
import { creationTaskCommitMatches } from './cloudRecovery';

export const PENDING_TASK_CREATION_STORAGE_PREFIX = 'ship-dynamics.pending-task-creation.v1:';

export type PendingTaskCreationState = 'pending' | 'retrying' | 'attention';

export interface PendingTaskCreationIntent {
  version: 1;
  intentId: string;
  workspaceIdentity: string;
  userId: string;
  taskId: string;
  primaryVesselId: string;
  vesselIds: string[];
  baseRevision: number;
  task: TaskItem;
  state: PendingTaskCreationState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  lastError: string;
}

export interface PendingTaskCreationInput {
  intentId: string;
  workspaceIdentity: string;
  userId: string;
  task: TaskItem;
  primaryVesselId: string;
  vesselIds: string[];
  baseRevision: number;
}

export interface TaskCreationStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingTaskCreationAppStateGuard<T> {
  expectedLive: T;
  expectedConfirmed: T;
  currentLive: T;
  currentConfirmed: T | null;
  mutationApplied: boolean;
  equals(left: T, right: T): boolean;
}

export function pendingTaskCreationAppStateIsCurrent<T>(guard: PendingTaskCreationAppStateGuard<T>): boolean {
  if (!guard.equals(guard.currentLive, guard.expectedLive)) return false;
  if (guard.mutationApplied) return true;
  return guard.currentConfirmed !== null && guard.equals(guard.currentConfirmed, guard.expectedConfirmed);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function validTask(value: unknown): value is TaskItem {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<TaskItem>;
  return nonEmpty(task.id) && nonEmpty(task.vesselId) && nonEmpty(task.createdAt) && nonEmpty(task.createdBy);
}

function normalizedVesselIds(primaryVesselId: string, vesselIds: string[]): string[] {
  return Array.from(new Set([primaryVesselId, ...vesselIds].filter(nonEmpty))).sort();
}

function validIntent(value: unknown): value is PendingTaskCreationIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<PendingTaskCreationIntent>;
  if (intent.version !== 1 || !nonEmpty(intent.intentId) || !nonEmpty(intent.workspaceIdentity) || !nonEmpty(intent.userId)) return false;
  if (!nonEmpty(intent.taskId) || !nonEmpty(intent.primaryVesselId) || !Array.isArray(intent.vesselIds) || !intent.vesselIds.every(nonEmpty)) return false;
  if (!Number.isInteger(intent.baseRevision) || Number(intent.baseRevision) < 0 || !validTask(intent.task) || intent.task.id !== intent.taskId) return false;
  if (!['pending','retrying','attention'].includes(String(intent.state)) || !Number.isInteger(intent.attempts) || Number(intent.attempts) < 0) return false;
  return nonEmpty(intent.createdAt) && nonEmpty(intent.updatedAt) && nonEmpty(intent.nextAttemptAt) && typeof intent.lastError === 'string';
}

export function createPendingTaskCreationIntent(input: PendingTaskCreationInput, nowIso: string): PendingTaskCreationIntent {
  if (!nonEmpty(input.intentId) || !nonEmpty(input.workspaceIdentity) || !nonEmpty(input.userId)) throw new Error('待同步新增要事缺少工作區、使用者或意圖識別');
  if (!validTask(input.task) || input.task.id !== input.task.id.trim()) throw new Error('待同步新增要事草稿無效');
  if (!nonEmpty(input.primaryVesselId) || input.task.vesselId !== input.primaryVesselId) throw new Error('待同步新增要事主船識別不一致');
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) throw new Error('待同步新增要事基準revision無效');
  const vesselIds = normalizedVesselIds(input.primaryVesselId, input.vesselIds);
  return {
    version: 1,
    intentId: input.intentId,
    workspaceIdentity: input.workspaceIdentity,
    userId: input.userId,
    taskId: input.task.id,
    primaryVesselId: input.primaryVesselId,
    vesselIds,
    baseRevision: input.baseRevision,
    task: structuredClone(input.task),
    state: 'pending',
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    nextAttemptAt: nowIso,
    lastError: '',
  };
}

export function pendingTaskCreationStorageKey(intentId: string): string {
  return `${PENDING_TASK_CREATION_STORAGE_PREFIX}${intentId}`;
}

export function writePendingTaskCreation(storage: TaskCreationStorage, intent: PendingTaskCreationIntent): void {
  if (!validIntent(intent)) throw new Error('拒絕寫入無效的待同步新增要事');
  storage.setItem(pendingTaskCreationStorageKey(intent.intentId), JSON.stringify(intent));
}

export function readPendingTaskCreations(storage: TaskCreationStorage): PendingTaskCreationIntent[] {
  const restored: PendingTaskCreationIntent[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PENDING_TASK_CREATION_STORAGE_PREFIX)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) || 'null');
      if (validIntent(value) && key === pendingTaskCreationStorageKey(value.intentId)) restored.push(value);
    } catch {
      // Invalid records remain untouched for controlled recovery, but are never executed.
    }
  }
  return restored.sort((left,right)=>left.createdAt.localeCompare(right.createdAt)||left.intentId.localeCompare(right.intentId));
}

export function removePendingTaskCreation(storage: TaskCreationStorage, intentId: string): void {
  storage.removeItem(pendingTaskCreationStorageKey(intentId));
}

export function pendingTaskCreationMatchesContext(intent: PendingTaskCreationIntent, workspaceIdentity: string, userId: string): boolean {
  return intent.workspaceIdentity === workspaceIdentity && intent.userId === userId;
}

export function findPendingTaskCreationForTask(
  intents: PendingTaskCreationIntent[],
  workspaceIdentity: string,
  userId: string,
  taskId: string,
): PendingTaskCreationIntent | undefined {
  return intents.find(intent => pendingTaskCreationMatchesContext(intent, workspaceIdentity, userId) && intent.taskId === taskId);
}

export function pendingTaskCreationMayRetry(intent: PendingTaskCreationIntent, nowMs = Date.now()): boolean {
  return intent.state !== 'attention' && Date.parse(intent.nextAttemptAt) <= nowMs;
}

export function markPendingTaskCreationRetrying(intent: PendingTaskCreationIntent, nowIso: string): PendingTaskCreationIntent {
  return { ...intent, state:'retrying', attempts:intent.attempts+1, updatedAt:nowIso, nextAttemptAt:nowIso, lastError:'' };
}

export function markPendingTaskCreationWaiting(intent: PendingTaskCreationIntent, lastError: string, nowIso: string, delayMs: number): PendingTaskCreationIntent {
  const nextAttemptAt = new Date(Date.parse(nowIso) + Math.max(1000, delayMs)).toISOString();
  return { ...intent, state:'pending', updatedAt:nowIso, nextAttemptAt, lastError };
}

export function markPendingTaskCreationAttention(intent: PendingTaskCreationIntent, lastError: string, nowIso: string): PendingTaskCreationIntent {
  return { ...intent, state:'attention', updatedAt:nowIso, nextAttemptAt:nowIso, lastError };
}

export function replacePendingTaskCreationTask(intent: PendingTaskCreationIntent, task: TaskItem, nowIso: string): PendingTaskCreationIntent {
  if (task.id !== intent.taskId) throw new Error('不得改變待同步新增要事的固定識別碼');
  return { ...intent, task:structuredClone(task), updatedAt:nowIso };
}

export function pendingTaskCreationRetryDelayMs(attempts: number): number {
  return Math.min(30_000, Math.max(3_000, 3_000 * 2 ** Math.min(3, Math.max(0, attempts - 1))));
}

export function taskCreationAlreadyCommitted(intent: PendingTaskCreationIntent, remoteTask: TaskItem | undefined): boolean {
  return creationTaskCommitMatches(intent.task, remoteTask);
}
