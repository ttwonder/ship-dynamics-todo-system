import type {
  AgendaReport,
  AppData,
  InternalControlCase,
  TaskItem,
  TemporaryMeeting,
  UserAccount,
  Vessel,
  WeeklyAttentionKey,
} from './types';
import type { NormalizedApplicationRuntime } from './normalizedRuntime';
import type { LeaseProof } from './normalizedCommands';
import type { NormalizedApplicationProjection } from './normalizedProjection';
import {
  NormalizedCommandError,
  type DurableDraftEnvelope,
  type OperationStatus,
} from './normalizedRepository';
import {
  changedVesselSections,
  internalCaseCommandPayload,
  linkedInternalTaskCommandPayload,
  meetingCommandPayload,
  taskCommandContent,
  userCommandPayload,
  vesselAssignmentCommandValue,
  vesselCargoCommandValue,
  vesselNoteCommandValue,
  vesselPositionCommandValue,
  vesselProfileCommandValue,
} from './normalizedAdapters';
import { taskProgressForVessel } from './taskVesselProgress';
import { internalControlTaskSyncWithdrawalEligibility } from './internalControlTaskSyncWithdrawal';

type JsonObject = Record<string, unknown>;

type InternalCaseRecoveryIntent = {
  operationId: string;
  linkAction: 'preserve' | 'materialize' | 'unlink';
  taskId: string;
  taskPayload: JsonObject | null;
  oldVesselId: string;
};

type PreparedInternalCase = {
  item: InternalControlCase;
  caseKey: string;
  caseCreateLeaseKey: string;
  taskPayload: JsonObject | null;
  taskId: string;
};

type ParsedInternalCaseDraft = {
  kind: 'batch';
  operationId: string;
  prepared: PreparedInternalCase[];
} | {
  kind: 'update';
  candidate: InternalControlCase;
  intent: InternalCaseRecoveryIntent;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const ENVELOPE_KEYS = [
  'version', 'workspaceId', 'actorId', 'entityKey', 'draft', 'baseVersions',
  'pendingOperation', 'updatedAt',
] as const;
const PENDING_OPERATION_KEYS = [
  'operationId', 'command', 'targetKey', 'dispatchedAt', 'replay',
] as const;
const REPLAY_KEYS = ['version', 'rpc', 'request', 'args', 'leases'] as const;
const REPLAY_LEASE_KEYS = [
  'leaseKey', 'entityType', 'entityId', 'ownerSession', 'fencingToken',
] as const;
const INTERNAL_CASE_KEYS = [
  'id', 'vesselId', 'reportDate', 'reportSource', 'description', 'priority',
  'category', 'equipmentSubcategory', 'isAware', 'status', 'departments',
  'syncToTask', 'linkedTaskId', 'origin', 'isClosed', 'closedDate', 'closedBy',
  'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'statusLogs',
] as const;
const INTERNAL_TASK_KEYS = ['id', 'expectedDate', 'categories', 'ownerUserIds'] as const;
const STATUS_LOG_KEYS = ['id', 'at', 'by', 'byUserId', 'text'] as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExactKeys(
  value: JsonObject,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every(key => allowedSet.has(key))
    && required.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function optionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function validStatusLog(value: unknown): boolean {
  if (!isRecord(value)
      || !hasExactKeys(value, STATUS_LOG_KEYS, ['id', 'at', 'by', 'text'])) return false;
  return nonEmptyText(value.id)
    && nonEmptyText(value.at)
    && typeof value.by === 'string'
    && optionalText(value.byUserId)
    && typeof value.text === 'string';
}

function validInternalCaseDraft(value: unknown): value is InternalControlCase {
  if (!isRecord(value) || !hasExactKeys(value, INTERNAL_CASE_KEYS, [
    'id', 'vesselId', 'reportDate', 'reportSource', 'description', 'priority',
    'category', 'isAware', 'status', 'departments', 'syncToTask', 'origin',
    'isClosed', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'statusLogs',
  ])) return false;
  return validEntityId(value.id)
    && validEntityId(value.vesselId)
    && [
      value.reportDate,
      value.reportSource,
      value.description,
      value.priority,
      value.category,
      value.status,
      value.origin,
      value.createdBy,
      value.updatedBy,
      value.createdAt,
      value.updatedAt,
    ].every(nonEmptyText)
    && typeof value.isAware === 'boolean'
    && typeof value.isClosed === 'boolean'
    && typeof value.syncToTask === 'boolean'
    && stringList(value.departments)
    && Array.isArray(value.statusLogs)
    && value.statusLogs.every(validStatusLog)
    && optionalText(value.equipmentSubcategory)
    && optionalText(value.closedDate)
    && optionalText(value.closedBy)
    && (value.linkedTaskId === undefined
      || value.linkedTaskId === null
      || validEntityId(value.linkedTaskId));
}

function validInternalTaskDraft(value: unknown): value is JsonObject {
  if (!isRecord(value) || !hasExactKeys(value, INTERNAL_TASK_KEYS)) return false;
  return validEntityId(value.id)
    && nonEmptyText(value.expectedDate)
    && stringList(value.categories)
    && stringList(value.ownerUserIds);
}

function validReplayEnvelope(value: unknown, command: string): boolean {
  if (!isRecord(value) || !hasExactKeys(value, REPLAY_KEYS)) return false;
  return value.version === 1
    && value.rpc === `command_ship_dynamics_${command}`
    && isRecord(value.request)
    && isRecord(value.args)
    && Array.isArray(value.leases)
    && value.leases.every(lease => isRecord(lease)
      && hasExactKeys(lease, REPLAY_LEASE_KEYS)
      && nonEmptyText(lease.leaseKey)
      && nonEmptyText(lease.entityType)
      && nonEmptyText(lease.entityId)
      && UUID_PATTERN.test(String(lease.ownerSession || ''))
      && Number.isSafeInteger(lease.fencingToken));
}

function validBaseVersions(value: unknown, expectedKeys: string[]): boolean {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const requiredKeys = [...expectedKeys].sort();
  return actualKeys.length === requiredKeys.length
    && actualKeys.every((key, index) => key === requiredKeys[index])
    && actualKeys.every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0);
}

function validRecoveryEnvelope(
  envelope: DurableDraftEnvelope,
  operationId: string,
  command: string,
  expectedTargetKey?: string,
): boolean {
  if (!isRecord(envelope)
      || !hasExactKeys(envelope, ENVELOPE_KEYS, [
        'version', 'workspaceId', 'actorId', 'entityKey', 'draft', 'baseVersions', 'updatedAt',
      ])
      || envelope.version !== 1
      || !nonEmptyText(envelope.workspaceId)
      || !nonEmptyText(envelope.actorId)
      || !nonEmptyText(envelope.entityKey)
      || !isRecord(envelope.draft)
      || !isRecord(envelope.baseVersions)
      || !nonEmptyText(envelope.updatedAt)) return false;
  const pending = envelope.pendingOperation;
  if (pending === undefined) return true;
  if (!isRecord(pending)
      || !hasExactKeys(pending, PENDING_OPERATION_KEYS, [
        'operationId', 'command', 'targetKey', 'dispatchedAt',
      ])
      || !UUID_PATTERN.test(String(pending.operationId || ''))
      || pending.operationId !== operationId
      || pending.command !== command
      || !nonEmptyText(pending.targetKey)
      || (expectedTargetKey !== undefined && pending.targetKey !== expectedTargetKey)
      || !nonEmptyText(pending.dispatchedAt)) return false;
  return pending.replay === undefined || validReplayEnvelope(pending.replay, command);
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function jsonDraft(value: unknown): JsonObject {
  return structuredClone(value) as JsonObject;
}

export async function reconcileNormalizedDraftEnvelopes(
  envelopes: DurableDraftEnvelope[],
  recover: (envelope: DurableDraftEnvelope) => Promise<void>,
): Promise<{ failureCount: number }> {
  let failureCount = 0;
  for (const envelope of envelopes) {
    try {
      await recover(envelope);
    } catch {
      failureCount += 1;
    }
  }
  return { failureCount };
}

export class NormalizedUiController {
  readonly runtime: NormalizedApplicationRuntime;

  constructor(runtime: NormalizedApplicationRuntime) {
    this.runtime = runtime;
  }

  #projection(): NormalizedApplicationProjection {
    const projection = this.runtime.projection;
    if (!projection) throw new Error('尚未載入伺服器資料。');
    return projection;
  }

  async #withLease<T>(
    entityKey: string,
    entityType: string,
    entityId: string,
    submit: (lease: LeaseProof) => Promise<T>,
  ): Promise<T> {
    const grant = await this.runtime.commands.claimLease({
      leaseKey: entityKey,
      entityType,
      entityId,
    });
    if (!grant.ok || !grant.ownerSession || grant.fencingToken === undefined) {
      throw new Error(grant.blockedByName
        ? `此項目正由 ${grant.blockedByName} 編輯。`
        : '此項目目前無法取得編輯租約。');
    }
    const lease = {
      leaseKey: grant.leaseKey,
      ownerSession: grant.ownerSession,
      fencingToken: grant.fencingToken,
    };
    try {
      return await submit(lease);
    } finally {
      await this.runtime.commands.releaseLease(lease).catch(() => false);
    }
  }

  #saveOfflineDraft(entityKey: string, draft: JsonObject, versionKeys: string[]) {
    const projection = this.#projection();
    const baseVersions = Object.fromEntries(versionKeys
      .filter(key => projection.versions.has(key))
      .map(key => [key, projection.versions.get(key)]));
    this.runtime.saveDraft(entityKey, draft, baseVersions);
  }

  #validateStoredDraft(entityKey: string, projection: NormalizedApplicationProjection) {
    const envelope = this.runtime.loadDraft(entityKey);
    if (!envelope?.draft) return;
    for (const [key, expected] of Object.entries(envelope.baseVersions || {})) {
      if (!projection.versions.has(key) || projection.versions.get(key) !== expected) {
        throw new NormalizedCommandError(
          'version',
          'offline-draft-version-conflict',
          '離線草稿的基礎版本已過期；伺服器內容未被覆寫，請重新檢視後再合併。',
        );
      }
    }
  }

  #clearDraft(entityKey: string) {
    this.runtime.removeDraft(entityKey);
  }

  async saveTask(task: TaskItem, creating: boolean): Promise<'committed' | 'drafted'> {
    if (!creating && task.isInternalControl && task.internalControlCaseId) {
      const linkedCase = this.#projection().data.internalControlCases.find(
        item => item.id === task.internalControlCaseId,
      );
      if (!linkedCase) throw new Error('找不到待辦所屬的內控案件。');
      return this.updateInternalCase({
        ...linkedCase,
        description: task.description,
        status: task.status,
        priority: task.priority,
        category: task.category,
        equipmentSubcategory: task.equipmentSubcategory,
        isAware: task.isAware,
        isClosed: task.isClosed,
        closedDate: task.closedDate,
        departments: task.departments,
        syncToTask: true,
      }, {
        categories: task.categories,
        equipmentSubcategory: task.equipmentSubcategory,
        expectedDate: task.expectedDate,
        ownerUserIds: task.ownerUserIds,
      });
    }
    const taskKey = `task:${task.id}`;
    const leaseKey = creating ? `task-create:${task.vesselId}` : taskKey;
    if (!isOnline()) {
      this.#saveOfflineDraft(leaseKey, { kind: 'task', candidate: jsonDraft(task) }, [taskKey]);
      return 'drafted';
    }
    await this.runtime.refreshEntities(creating ? [`vessel:${task.vesselId}`] : [taskKey]);
    const projection = this.#projection();
    this.#validateStoredDraft(leaseKey, projection);
    const previousTask = projection.data.tasks.find(item => item.id === task.id);
    await this.#withLease(
      leaseKey,
      creating ? 'task-create' : 'task',
      creating ? task.vesselId : task.id,
      async lease => {
        if (creating) {
          await this.runtime.commands.createOrdinaryTask({
            taskId: task.id,
            lease,
            content: taskCommandContent(task),
          });
        } else {
          await this.runtime.commands.saveOrdinaryTask({
            taskId: task.id,
            baseVersion: projection.versions.get(taskKey),
            lease,
            content: taskCommandContent(task),
            transition: previousTask && previousTask.isClosed !== task.isClosed
              ? (task.isClosed ? 'close' : 'reopen')
              : null,
          });
        }
      },
    );
    await this.runtime.refreshEntities([taskKey, 'notifications']);
    this.#clearDraft(leaseKey);
    return 'committed';
  }

  async transitionTask(
    taskId: string,
    action: 'close' | 'reopen' | 'delete',
  ): Promise<void> {
    const key = `task:${taskId}`;
    if (!isOnline()) throw new Error('離線時只能保存草稿，不能變更待辦狀態。');
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'task', taskId, lease => (
      this.runtime.commands.transitionOrdinaryTask({
        taskId,
        baseVersion: projection.versions.get(key),
        lease,
        action,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async deleteTask(taskId: string): Promise<void> {
    const currentTask = this.#projection().data.tasks.find(item => item.id === taskId);
    if (!currentTask?.internalControlCaseId) {
      await this.transitionTask(taskId, 'delete');
      return;
    }
    if (!isOnline()) throw new Error('離線時不能刪除待辦。');
    const caseId = currentTask.internalControlCaseId;
    const taskKey = `task:${taskId}`;
    const caseKey = `internal-case:${caseId}`;
    await this.runtime.refreshEntities([taskKey, caseKey]);
    const projection = this.#projection();
    const leases = await this.runtime.commands.claimLeaseSet([
      { leaseKey: taskKey, entityType: 'internal-task', entityId: taskId },
      { leaseKey: caseKey, entityType: 'internal-case', entityId: caseId },
    ]);
    try {
      const map = new Map(leases.map(item => [item.leaseKey, item]));
      const taskLease = map.get(taskKey);
      const caseLease = map.get(caseKey);
      if (!taskLease || !caseLease) throw new Error('內控待辦租約不完整。');
      await this.runtime.commands.deleteTaskPreservingInternalCase({
        taskId,
        baseTaskVersion: projection.versions.get(taskKey),
        taskLease,
        caseId,
        baseCaseVersion: projection.versions.get(caseKey),
        caseLease,
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([taskKey, caseKey]);
  }

  async saveTaskProgress(task: TaskItem, vesselId: string): Promise<'committed' | 'drafted'> {
    const key = `task-progress:${task.id}:${vesselId}`;
    const progress = taskProgressForVessel(task, vesselId);
    if (!isOnline()) {
      this.#saveOfflineDraft(
        key,
        { kind: 'task-progress', taskId: task.id, vesselId, progress: jsonDraft(progress) },
        [`task:${task.id}`, key],
      );
      return 'drafted';
    }
    await this.runtime.refreshEntities([`task:${task.id}`, key]);
    const projection = this.#projection();
    this.#validateStoredDraft(key, projection);
    await this.#withLease(key, 'task-progress', `${task.id}:${vesselId}`, lease => (
      this.runtime.commands.updateTaskVesselProgress({
        taskId: task.id,
        vesselId,
        taskBaseVersion: projection.versions.get(`task:${task.id}`),
        progressBaseVersion: projection.versions.get(key),
        lease,
        status: progress.status,
        isClosed: progress.isClosed,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([`task:${task.id}`, key]);
    this.#clearDraft(key);
    return 'committed';
  }

  async batchTransitionTasks(
    taskIds: string[],
    action: 'close' | 'reopen' | 'delete',
  ): Promise<void> {
    if (!isOnline()) throw new Error('離線時不能執行批次狀態變更。');
    const keys = taskIds.map(id => `task:${id}`);
    await this.runtime.refreshEntities(keys);
    const projection = this.#projection();
    const leases = await this.runtime.commands.claimLeaseSet(taskIds.map(taskId => ({
      leaseKey: `task:${taskId}`,
      entityType: 'task',
      entityId: taskId,
    })));
    try {
      const leaseMap = new Map(leases.map(lease => [lease.leaseKey, lease]));
      await this.runtime.commands.batchTaskTransition(action, taskIds.map(taskId => {
        const lease = leaseMap.get(`task:${taskId}`);
        if (!lease) throw new Error('批次租約不完整。');
        return {
          taskId,
          baseVersion: projection.versions.get(`task:${taskId}`),
          leaseKey: lease.leaseKey,
          ownerSession: lease.ownerSession,
          fencingToken: lease.fencingToken,
        };
      }));
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities(keys);
  }

  async saveVessel(before: Vessel, after: Vessel): Promise<'committed' | 'drafted'> {
    const key = `vessel:${after.id}`;
    if (!isOnline()) {
      this.#saveOfflineDraft(key, { kind: 'vessel', candidate: jsonDraft(after) }, [key]);
      return 'drafted';
    }
    await this.runtime.refreshEntities([key]);
    this.#validateStoredDraft(key, this.#projection());
    const changes = changedVesselSections(before, after);
    await this.#withLease(key, 'vessel', after.id, async lease => {
      const runField = async (
        field: 'profile' | 'position' | 'cargo' | 'note' | 'weekly_attention',
        value: unknown,
      ) => {
        const projection = await this.runtime.refreshEntities([key]);
        if (!projection) throw new Error('無法重新讀取船舶版本。');
        await this.runtime.commands.updateVesselField({
          vesselId: after.id,
          baseVersion: projection.versions.get(key),
          lease,
          field,
          value,
        });
      };
      if (changes.profile) await runField('profile', vesselProfileCommandValue(after));
      if (changes.position) await runField('position', vesselPositionCommandValue(after));
      if (changes.cargo) await runField('cargo', vesselCargoCommandValue(after));
      if (changes.note) await runField('note', vesselNoteCommandValue(after));
      if (changes.weeklyAttention) await runField('weekly_attention', after.weeklyAttention);
      if (changes.manualAttention) {
        const projection = await this.runtime.refreshEntities([key]);
        if (!projection) throw new Error('無法重新讀取船舶版本。');
        await this.runtime.commands.updateVesselManualAttention({
          vesselId: after.id,
          baseVersion: projection.versions.get(key),
          lease,
          manualAttentionLevel: after.manualAttentionLevel || null,
        });
      }
      if (changes.assignments) {
        const projection = await this.runtime.refreshEntities([key]);
        if (!projection) throw new Error('無法重新讀取船舶版本。');
        await this.runtime.commands.replaceVesselAssignments({
          vesselId: after.id,
          baseVersion: projection.versions.get(key),
          lease,
          assignments: vesselAssignmentCommandValue(after),
        });
      }
    });
    await this.runtime.refreshEntities([key]);
    this.#clearDraft(key);
    return 'committed';
  }

  async createVessel(vessel: Vessel): Promise<'committed' | 'drafted'> {
    const key = `vessel:${vessel.id}`;
    if (!isOnline()) {
      this.#saveOfflineDraft(key, { kind: 'vessel-create', candidate: jsonDraft(vessel) }, []);
      return 'drafted';
    }
    await this.#withLease(key, 'vessel', vessel.id, async lease => {
      await this.runtime.commands.createVessel({
        vesselId: vessel.id,
        lease,
        profile: vesselProfileCommandValue(vessel),
      });
      if (vessel.assignedUserIds.length || vessel.delegateManagers.length) {
        const projection = await this.runtime.refreshEntities([key]);
        if (!projection) throw new Error('無法載入新船舶版本。');
        await this.runtime.commands.replaceVesselAssignments({
          vesselId: vessel.id,
          baseVersion: projection.versions.get(key),
          lease,
          assignments: vesselAssignmentCommandValue(vessel),
        });
      }
    });
    await this.runtime.refreshEntities([key]);
    this.#clearDraft(key);
    return 'committed';
  }

  async disableVessel(vesselId: string) {
    const key = `vessel:${vesselId}`;
    if (!isOnline()) throw new Error('離線時不能停用船舶。');
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'vessel', vesselId, lease => (
      this.runtime.commands.disableVessel({
        vesselId,
        baseVersion: projection.versions.get(key),
        lease,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async batchUpdateVessels(
    updates: Array<{ vesselId: string; patch: JsonObject }>,
  ) {
    if (!isOnline()) throw new Error('離線時不能執行船舶批次更新。');
    const keys = updates.map(item => `vessel:${item.vesselId}`);
    await this.runtime.refreshEntities(keys);
    const projection = this.#projection();
    const leases = await this.runtime.commands.claimLeaseSet(updates.map(item => ({
      leaseKey: `vessel:${item.vesselId}`,
      entityType: 'vessel',
      entityId: item.vesselId,
    })));
    try {
      const map = new Map(leases.map(lease => [lease.leaseKey, lease]));
      await this.runtime.commands.batchUpdateVessels(updates.map(item => {
        const lease = map.get(`vessel:${item.vesselId}`);
        if (!lease) throw new Error('批次船舶租約不完整。');
        return {
          vesselId: item.vesselId,
          baseVersion: projection.versions.get(`vessel:${item.vesselId}`),
          leaseKey: lease.leaseKey,
          ownerSession: lease.ownerSession,
          fencingToken: lease.fencingToken,
          patch: item.patch,
        };
      }));
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities(keys);
  }

  async toggleWeeklyAttention(vessel: Vessel, attention: WeeklyAttentionKey) {
    const next = structuredClone(vessel);
    next.weeklyAttention = next.weeklyAttention.includes(attention)
      ? next.weeklyAttention.filter(item => item !== attention)
      : [...next.weeklyAttention, attention];
    return this.saveVessel(vessel, next);
  }

  async setManualAttention(vessel: Vessel, value: string | null) {
    const next = structuredClone(vessel);
    next.manualAttentionLevel = (value || '') as Vessel['manualAttentionLevel'];
    return this.saveVessel(vessel, next);
  }

  async saveMeeting(
    meeting: TemporaryMeeting,
    creating: boolean,
  ): Promise<'committed' | 'drafted'> {
    const meetingKey = `meeting:${meeting.id}`;
    if (!isOnline()) {
      this.#saveOfflineDraft(
        meetingKey,
        { kind: 'meeting', candidate: jsonDraft(meeting) },
        [meetingKey],
      );
      return 'drafted';
    }
    await this.runtime.refreshEntities(creating ? [] : [meetingKey]);
    const current = this.#projection();
    this.#validateStoredDraft(meetingKey, current);
    const linkedTasks = current.data.tasks.filter(task => task.sourceMeetingId === meeting.id);
    const leaseEntities = [
      { leaseKey: meetingKey, entityType: 'meeting', entityId: meeting.id },
      ...linkedTasks.map(task => ({
        leaseKey: `task:${task.id}`,
        entityType: 'task',
        entityId: task.id,
      })),
    ];
    const leases = await this.runtime.commands.claimLeaseSet(leaseEntities);
    try {
      const leaseMap = new Map(leases.map(lease => [lease.leaseKey, lease]));
      const meetingLease = leaseMap.get(meetingKey);
      if (!meetingLease) throw new Error('會議租約不完整。');
      const taskGuards = linkedTasks.map(task => {
        const lease = leaseMap.get(`task:${task.id}`);
        if (!lease) throw new Error('會議待辦租約不完整。');
        return {
          taskId: task.id,
          baseVersion: current.versions.get(`task:${task.id}`),
          leaseKey: lease.leaseKey,
          ownerSession: lease.ownerSession,
          fencingToken: lease.fencingToken,
        };
      });
      if (creating) {
        await this.runtime.commands.createMeeting({
          meetingId: meeting.id,
          lease: meetingLease,
          payload: meetingCommandPayload(meeting),
        });
      } else {
        await this.runtime.commands.updateMeeting({
          meetingId: meeting.id,
          baseVersion: current.versions.get(meetingKey),
          lease: meetingLease,
          payload: meetingCommandPayload(meeting),
          taskGuards,
        });
      }
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([meetingKey]);
    this.#clearDraft(meetingKey);
    return 'committed';
  }

  async deleteMeeting(meetingId: string) {
    if (!isOnline()) throw new Error('離線時不能刪除會議。');
    const key = `meeting:${meetingId}`;
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    const tasks = projection.data.tasks.filter(task => task.sourceMeetingId === meetingId);
    const leases = await this.runtime.commands.claimLeaseSet([
      { leaseKey: key, entityType: 'meeting', entityId: meetingId },
      ...tasks.map(task => ({
        leaseKey: `task:${task.id}`,
        entityType: 'task',
        entityId: task.id,
      })),
    ]);
    try {
      const map = new Map(leases.map(lease => [lease.leaseKey, lease]));
      const meetingLease = map.get(key);
      if (!meetingLease) throw new Error('會議租約不完整。');
      await this.runtime.commands.deleteMeeting({
        meetingId,
        baseVersion: projection.versions.get(key),
        lease: meetingLease,
        taskGuards: tasks.map(task => {
          const lease = map.get(`task:${task.id}`);
          if (!lease) throw new Error('會議待辦租約不完整。');
          return {
            taskId: task.id,
            baseVersion: projection.versions.get(`task:${task.id}`),
            leaseKey: lease.leaseKey,
            ownerSession: lease.ownerSession,
            fencingToken: lease.fencingToken,
          };
        }),
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([key]);
  }

  async correctMeetingStatus(input: {
    meetingId: string;
    eventId: string;
    correctionKind: 'void' | 'correct';
    correctedStatus?: string | null;
    reason: string;
  }) {
    const key = `meeting:${input.meetingId}`;
    if (!isOnline()) throw new Error('離線時不能更正會議狀態歷程。');
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'meeting', input.meetingId, lease => (
      this.runtime.commands.correctMeetingStatus({
        ...input,
        correctedStatus: input.correctedStatus || null,
        baseVersion: projection.versions.get(key),
        lease,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async createInternalCase(
    item: InternalControlCase,
    taskProjection?: {
      categories: string[];
      equipmentSubcategory?: string;
      expectedDate: string;
      ownerUserIds: string[];
    },
  ): Promise<'committed' | 'drafted'> {
    const caseKey = `internal-case:${item.id}`;
    const caseCreateLeaseKey = `internal-case-create:${item.vesselId}`;
    const linkedTask = taskProjection
      ? {
          id: item.linkedTaskId || crypto.randomUUID(),
          expectedDate: taskProjection.expectedDate,
          categories: taskProjection.categories,
          ownerUserIds: taskProjection.ownerUserIds,
        }
      : undefined;
    if (!isOnline()) {
      this.#saveOfflineDraft(
        caseKey,
        {
          kind: 'internal-case',
          mode: 'create',
          candidate: jsonDraft(item),
          linkedTask: linkedTask ? jsonDraft(linkedTask) : null,
        },
        [],
      );
      return 'drafted';
    }
    const taskPayload = linkedInternalTaskCommandPayload(item, linkedTask);
    const taskId = typeof taskPayload?.id === 'string' ? taskPayload.id : '';
    const leases = await this.runtime.commands.claimLeaseSet([
      {
        leaseKey: caseCreateLeaseKey,
        entityType: 'internal-case-create',
        entityId: item.vesselId,
      },
      ...(taskId ? [{
        leaseKey: `task:${taskId}`,
        entityType: 'internal-task',
        entityId: taskId,
      }] : []),
    ]);
    try {
      const map = new Map(leases.map(lease => [lease.leaseKey, lease]));
      const caseLease = map.get(caseCreateLeaseKey);
      if (!caseLease) throw new Error('內控案件租約不完整。');
      await this.runtime.commands.createInternalCase({
        caseId: item.id,
        caseLease,
        casePayload: internalCaseCommandPayload(item),
        taskPayload,
        taskLease: taskId ? map.get(`task:${taskId}`) : null,
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([caseKey, ...(taskId ? [`task:${taskId}`] : [])]);
    this.#clearDraft(caseKey);
    return 'committed';
  }

  #parseInternalCaseDraft(
    envelope: DurableDraftEnvelope,
    draft: JsonObject,
  ): ParsedInternalCaseDraft | null {
    const kind = typeof draft.kind === 'string' ? draft.kind : '';
    if (kind === 'internal-case-batch') {
      const operationId = typeof draft.operationId === 'string' ? draft.operationId : '';
      if (
        !hasExactKeys(draft, ['kind', 'operationId', 'entries'])
        || !UUID_PATTERN.test(operationId)
        || envelope.entityKey !== `internal-case-batch:${operationId}`
        || !Array.isArray(draft.entries)
        || !draft.entries.length
        || !validBaseVersions(envelope.baseVersions, [])
        || !validRecoveryEnvelope(envelope, operationId, 'batch_create_internal_cases')
      ) {
        throw new NormalizedCommandError(
          'invalid',
          'offline-internal-case-batch-invalid',
          '離線內控批次資料無效；未送出任何案件。',
        );
      }
      const caseIds = new Set<string>();
      const taskIds = new Set<string>();
      const prepared = draft.entries.map(value => {
        if (!isRecord(value)
            || !hasExactKeys(value, ['candidate', 'linkedTask'])
            || !validInternalCaseDraft(value.candidate)) {
          throw new NormalizedCommandError(
            'invalid',
            'offline-internal-case-batch-invalid',
            '離線內控批次資料無效；未送出任何案件。',
          );
        }
        const item = value.candidate;
        const linkedTaskShapeValid = value.linkedTask === null
          || validInternalTaskDraft(value.linkedTask);
        const linkedTask = validInternalTaskDraft(value.linkedTask)
          ? value.linkedTask
          : null;
        const taskId = typeof linkedTask?.id === 'string' ? linkedTask.id : '';
        const candidateTaskId = typeof item.linkedTaskId === 'string' ? item.linkedTaskId : '';
        if (
          !linkedTaskShapeValid
          || caseIds.has(item.id)
          || item.syncToTask !== Boolean(linkedTask)
          || (linkedTask && candidateTaskId !== taskId)
          || (!linkedTask && candidateTaskId)
          || (taskId && taskIds.has(taskId))
        ) {
          throw new NormalizedCommandError(
            'invalid',
            'offline-internal-case-batch-invalid',
            '離線內控批次資料無效；未送出任何案件。',
          );
        }
        caseIds.add(item.id);
        if (taskId) taskIds.add(taskId);
        return {
          item,
          caseKey: `internal-case:${item.id}`,
          caseCreateLeaseKey: `internal-case-create:${item.vesselId}`,
          taskPayload: linkedTask,
          taskId,
        };
      });
      return { kind: 'batch', operationId, prepared };
    }
    if (kind !== 'internal-case' || draft.mode !== 'update') return null;
    const operationId = typeof draft.operationId === 'string' ? draft.operationId : '';
    const linkAction = draft.linkAction;
    const taskId = typeof draft.taskId === 'string' ? draft.taskId : '';
    const oldVesselId = typeof draft.oldVesselId === 'string' ? draft.oldVesselId : '';
    const taskPayload = draft.taskPayload === null
      ? null
      : validInternalTaskDraft(draft.taskPayload)
        ? draft.taskPayload
        : undefined;
    const taskPayloadId = taskPayload && typeof taskPayload.id === 'string'
      ? taskPayload.id
      : '';
    const candidate = draft.candidate;
    const candidateTaskId = validInternalCaseDraft(candidate)
      && typeof candidate.linkedTaskId === 'string'
      ? candidate.linkedTaskId
      : '';
    const actionValid = linkAction === 'preserve'
      || linkAction === 'materialize'
      || linkAction === 'unlink';
    const taskIntentValid = linkAction === 'materialize'
      ? Boolean(taskId && taskPayload && taskPayloadId === taskId
        && validInternalCaseDraft(candidate) && candidate.syncToTask
        && (!candidateTaskId || candidateTaskId === taskId))
      : linkAction === 'unlink'
        ? Boolean(taskId && taskPayload === null
          && validInternalCaseDraft(candidate) && !candidate.syncToTask && !candidateTaskId)
        : taskId
          ? Boolean(taskPayload && taskPayloadId === taskId
            && validInternalCaseDraft(candidate) && candidate.syncToTask
            && candidateTaskId === taskId)
          : taskPayload === null
            && validInternalCaseDraft(candidate) && !candidate.syncToTask && !candidateTaskId;
    const caseKey = validInternalCaseDraft(candidate)
      ? `internal-case:${candidate.id}`
      : '';
    const expectedVersionKeys = caseKey
      ? [caseKey, ...(linkAction !== 'materialize' && taskId ? [`task:${taskId}`] : [])]
      : [];
    if (
      !hasExactKeys(draft, [
        'kind', 'mode', 'operationId', 'linkAction', 'taskId', 'taskPayload',
        'oldVesselId', 'candidate',
      ])
      || !UUID_PATTERN.test(operationId)
      || !actionValid
      || !validEntityId(taskId) && Boolean(taskId)
      || !validEntityId(oldVesselId)
      || taskPayload === undefined
      || !taskIntentValid
      || !validInternalCaseDraft(candidate)
      || envelope.entityKey !== caseKey
      || !validBaseVersions(envelope.baseVersions, expectedVersionKeys)
      || !validRecoveryEnvelope(envelope, operationId, 'update_internal_case', caseKey)
    ) {
      throw new NormalizedCommandError(
        'invalid',
        'offline-internal-case-update-invalid',
        '離線內控更新資料不完整；未送出案件或待辦變更。',
      );
    }
    return {
      kind: 'update',
      candidate,
      intent: { operationId, linkAction, taskId, taskPayload, oldVesselId },
    };
  }

  #internalUpdateRefreshKeys(
    item: InternalControlCase,
    intent: Pick<InternalCaseRecoveryIntent, 'oldVesselId' | 'taskId'>,
  ) {
    return [...new Set([
      `internal-case:${item.id}`,
      `vessel:${intent.oldVesselId}`,
      `vessel:${item.vesselId}`,
      ...(intent.taskId ? [`task:${intent.taskId}`] : []),
    ])];
  }

  async #preflightInternalCaseUpdate(
    item: InternalControlCase,
    intent: Pick<InternalCaseRecoveryIntent, 'oldVesselId' | 'linkAction' | 'taskId'>,
  ): Promise<NormalizedApplicationProjection> {
    const caseKey = `internal-case:${item.id}`;
    await this.runtime.refreshEntities([caseKey]);
    let projection = this.#projection();
    const currentCase = projection.data.internalControlCases.find(entry => entry.id === item.id);
    if (!currentCase || currentCase.vesselId !== intent.oldVesselId) {
      throw new NormalizedCommandError(
        'version',
        'offline-internal-case-old-vessel-mismatch',
        '離線草稿所屬內控案件已隱藏、移動或變更；未送出任何更新。',
      );
    }
    const vesselKeys = [...new Set([
      `vessel:${intent.oldVesselId}`,
      `vessel:${item.vesselId}`,
    ])];
    await this.runtime.refreshEntities(vesselKeys);
    projection = this.#projection();
    if (vesselKeys.some(key => !projection.allowedEntityKeys.has(key))) {
      throw new NormalizedCommandError(
        'permission',
        'offline-internal-case-vessel-scope-revoked',
        '目前授權未涵蓋內控案件的原船舶與新船舶；未送出任何更新。',
      );
    }
    if (intent.linkAction !== 'materialize' && intent.taskId) {
      await this.runtime.refreshEntities([`task:${intent.taskId}`]);
      projection = this.#projection();
    }
    this.#validateStoredDraft(caseKey, projection);
    return projection;
  }

  async createInternalCaseBatch(
    items: InternalControlCase[],
    projections: Record<string, {
      categories: string[];
      equipmentSubcategory?: string;
      expectedDate: string;
      ownerUserIds: string[];
    }> = {},
  ): Promise<'committed' | 'drafted'> {
    if (!items.length) throw new Error('The internal-case batch is empty.');
    const operationId = this.runtime.commands.createOperationId();
    const batchKey = `internal-case-batch:${operationId}`;
    const prepared = items.map(item => {
      const projection = projections[item.id];
      const linkedTask = item.syncToTask
        ? {
            id: item.linkedTaskId || crypto.randomUUID(),
            expectedDate: projection?.expectedDate || item.reportDate,
            categories: projection?.categories?.length ? projection.categories : [item.category],
            ownerUserIds: projection?.ownerUserIds || [],
          }
        : undefined;
      const taskPayload = linkedInternalTaskCommandPayload(item, linkedTask);
      return {
        item,
        caseKey: `internal-case:${item.id}`,
        caseCreateLeaseKey: `internal-case-create:${item.vesselId}`,
        taskPayload,
        taskId: typeof taskPayload?.id === 'string' ? taskPayload.id : '',
      };
    });
    if (!isOnline()) {
      this.#saveOfflineDraft(
        batchKey,
        {
          kind: 'internal-case-batch',
          operationId,
          entries: prepared.map(entry => ({
            candidate: jsonDraft(entry.taskId
              ? { ...entry.item, linkedTaskId: entry.taskId }
              : entry.item),
            linkedTask: entry.taskPayload ? jsonDraft(entry.taskPayload) : null,
          })),
        },
        [],
      );
      return 'drafted';
    }
    await this.#submitInternalCaseBatch(prepared, operationId, batchKey);
    return 'committed';
  }

  async #submitInternalCaseBatch(
    prepared: Array<{
      item: InternalControlCase;
      caseKey: string;
      caseCreateLeaseKey: string;
      taskPayload: JsonObject | null;
      taskId: string;
    }>,
    operationId: string,
    batchKey: string,
  ): Promise<void> {
    const leaseRequests = new Map<string, {
      leaseKey: string;
      entityType: string;
      entityId: string;
    }>();
    for (const entry of prepared) {
      leaseRequests.set(entry.caseCreateLeaseKey, {
        leaseKey: entry.caseCreateLeaseKey,
        entityType: 'internal-case-create',
        entityId: entry.item.vesselId,
      });
      if (entry.taskId) {
        const taskLeaseKey = `task-create:${entry.item.vesselId}`;
        leaseRequests.set(taskLeaseKey, {
          leaseKey: taskLeaseKey,
          entityType: 'task-create',
          entityId: entry.item.vesselId,
        });
      }
    }
    const leases = await this.runtime.commands.claimLeaseSet([...leaseRequests.values()]);
    try {
      const leaseMap = new Map(leases.map(lease => [lease.leaseKey, lease]));
      await this.runtime.commands.batchCreateInternalCases(prepared.map(entry => {
        const caseLease = leaseMap.get(entry.caseCreateLeaseKey);
        if (!caseLease) throw new Error('The internal-case batch lease set is incomplete.');
        const taskLease = entry.taskId
          ? leaseMap.get(`task-create:${entry.item.vesselId}`)
          : null;
        if (entry.taskId && !taskLease) {
          throw new Error('The internal task-create lease set is incomplete.');
        }
        return {
          caseId: entry.item.id,
          caseLeaseKey: caseLease.leaseKey,
          caseOwnerSession: caseLease.ownerSession,
          caseFencingToken: caseLease.fencingToken,
          case: internalCaseCommandPayload(entry.item),
          task: entry.taskPayload,
          taskLeaseKey: taskLease?.leaseKey || null,
          taskOwnerSession: taskLease?.ownerSession || null,
          taskFencingToken: taskLease?.fencingToken || null,
        };
      }), operationId, batchKey);
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities(prepared.flatMap(entry => [
      entry.caseKey,
      ...(entry.taskId ? [`task:${entry.taskId}`] : []),
    ]));
    this.#clearDraft(batchKey);
  }

  async updateInternalCase(
    item: InternalControlCase,
    taskProjection?: {
      categories: string[];
      equipmentSubcategory?: string;
      expectedDate: string;
      ownerUserIds: string[];
    },
    recoveryIntent?: InternalCaseRecoveryIntent,
  ): Promise<'committed' | 'drafted'> {
    const caseKey = `internal-case:${item.id}`;
    const online = isOnline();
    if (online) await this.runtime.refreshEntities([caseKey]);
    const initial = this.#projection().data.internalControlCases.find(entry => entry.id === item.id);
    if (!initial) throw new Error('離線草稿所屬內控案件已不存在。');
    const existingTaskId = initial.linkedTaskId || '';
    const derivedAddingTask = !existingTaskId && item.syncToTask && Boolean(taskProjection);
    const derivedRemovingTask = Boolean(existingTaskId) && !item.syncToTask;
    const linkAction = recoveryIntent?.linkAction
      || (derivedAddingTask ? 'materialize' : derivedRemovingTask ? 'unlink' : 'preserve');
    const taskId = recoveryIntent?.taskId
      ?? (existingTaskId || (derivedAddingTask ? crypto.randomUUID() : ''));
    const taskPayload = recoveryIntent
      ? recoveryIntent.taskPayload
      : taskProjection && linkAction !== 'unlink'
        ? linkedInternalTaskCommandPayload(item, {
            id: taskId,
            expectedDate: taskProjection.expectedDate,
            categories: taskProjection.categories,
            ownerUserIds: taskProjection.ownerUserIds,
          })
        : null;
    const oldVesselId = recoveryIntent?.oldVesselId || initial.vesselId;
    const addingTask = linkAction === 'materialize';
    const taskLeaseKey = addingTask
      ? `task-create:${item.vesselId}`
      : taskId ? `task:${taskId}` : '';
    const operationId = recoveryIntent?.operationId
      || (!online ? this.runtime.commands.createOperationId() : undefined);
    if (!online) {
      if (!operationId) throw new Error('無法建立離線內控操作編號。');
      this.#saveOfflineDraft(
        caseKey,
        {
          kind: 'internal-case',
          mode: 'update',
          operationId,
          linkAction,
          taskId,
          taskPayload: taskPayload ? jsonDraft(taskPayload) : null,
          oldVesselId,
          candidate: jsonDraft(item),
        },
        [caseKey, ...(linkAction !== 'materialize' && taskId ? [`task:${taskId}`] : [])],
      );
      return 'drafted';
    }
    const projection = await this.#preflightInternalCaseUpdate(item, {
      oldVesselId,
      linkAction,
      taskId,
    });
    const committedRefreshKeys = this.#internalUpdateRefreshKeys(item, {
      oldVesselId,
      taskId,
    });

    const leases = await this.runtime.commands.claimLeaseSet([
      { leaseKey: caseKey, entityType: 'internal-case', entityId: item.id },
      ...(taskId ? [{
        leaseKey: taskLeaseKey,
        entityType: addingTask ? 'task-create' : 'task',
        entityId: addingTask ? item.vesselId : taskId,
      }] : []),
    ]);
    try {
      const map = new Map(leases.map(lease => [lease.leaseKey, lease]));
      const caseLease = map.get(caseKey);
      if (!caseLease) throw new Error('內控案件租約不完整。');
      await this.runtime.commands.updateInternalCase({
        caseId: item.id,
        baseCaseVersion: projection.versions.get(caseKey),
        caseLease,
        casePayload: internalCaseCommandPayload(item),
        linkAction,
        baseTaskVersion: linkAction !== 'materialize' && taskId
          ? projection.versions.get(`task:${taskId}`)
          : null,
        taskLease: taskId ? map.get(taskLeaseKey) : null,
        taskPayload,
        ...(operationId ? { operationId } : {}),
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities(committedRefreshKeys);
    this.#clearDraft(caseKey);
    return 'committed';
  }

  async withdrawInternalCaseTaskSync(
    candidate: InternalControlCase,
    expectedTaskUpdatedAt: string,
  ): Promise<void> {
    if (!isOnline()) throw new Error('離線時不能撤回同步要事。');
    const caseKey = `internal-case:${candidate.id}`;
    await this.runtime.refreshEntities([caseKey]);
    let projection = this.#projection();
    let currentCase = projection.data.internalControlCases.find(item => item.id === candidate.id);
    if (!currentCase
        || currentCase.updatedAt !== candidate.updatedAt
        || currentCase.linkedTaskId !== candidate.linkedTaskId) {
      throw new NormalizedCommandError(
        'version',
        'internal-task-sync-withdrawal-case-stale',
        '內控案件或同步關聯已更新；請關閉後重新開啟再撤回。',
      );
    }
    const taskId = currentCase.linkedTaskId;
    if (!taskId) throw new Error('此內控案件沒有可撤回的同步要事。');
    const taskKey = `task:${taskId}`;
    await this.runtime.refreshEntities([caseKey, taskKey]);
    projection = this.#projection();
    currentCase = projection.data.internalControlCases.find(item => item.id === candidate.id);
    const eligibility = internalControlTaskSyncWithdrawalEligibility(projection.data, candidate.id);
    const task = eligibility.eligible
      ? projection.data.tasks.find(item => item.id === eligibility.taskId)
      : undefined;
    if (!currentCase
        || currentCase.updatedAt !== candidate.updatedAt
        || currentCase.linkedTaskId !== taskId
        || !eligibility.eligible
        || eligibility.taskId !== taskId
        || !task
        || task.updatedAt !== expectedTaskUpdatedAt) {
      const reason = !eligibility.eligible && 'reason' in eligibility
        ? eligibility.reason
        : '內控案件或關聯要事已有較新版本';
      throw new NormalizedCommandError(
        'version',
        'internal-task-sync-withdrawal-stale',
        `${reason}；請關閉後重新開啟再撤回。`,
      );
    }
    const leases = await this.runtime.commands.claimLeaseSet([
      { leaseKey: caseKey, entityType: 'internal-case', entityId: candidate.id },
      { leaseKey: taskKey, entityType: 'internal-task', entityId: taskId },
    ]);
    try {
      const leaseMap = new Map(leases.map(item => [item.leaseKey, item]));
      const caseLease = leaseMap.get(caseKey);
      const taskLease = leaseMap.get(taskKey);
      if (!caseLease || !taskLease) throw new Error('撤回同步要事的雙實體租約不完整。');
      await this.runtime.commands.withdrawInternalCaseTaskSync({
        caseId: candidate.id,
        baseCaseVersion: projection.versions.get(caseKey),
        caseLease,
        baseTaskVersion: projection.versions.get(taskKey),
        taskLease,
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([caseKey, taskKey]);
  }

  async deleteInternalCase(item: InternalControlCase) {
    const caseKey = `internal-case:${item.id}`;
    const taskId = item.linkedTaskId || '';
    if (!isOnline()) throw new Error('離線時不能刪除內控案件。');
    await this.runtime.refreshEntities([caseKey, ...(taskId ? [`task:${taskId}`] : [])]);
    const projection = this.#projection();
    const leases = await this.runtime.commands.claimLeaseSet([
      { leaseKey: caseKey, entityType: 'internal-case', entityId: item.id },
      ...(taskId ? [{ leaseKey: `task:${taskId}`, entityType: 'task', entityId: taskId }] : []),
    ]);
    try {
      const map = new Map(leases.map(lease => [lease.leaseKey, lease]));
      const caseLease = map.get(caseKey);
      if (!caseLease) throw new Error('內控案件租約不完整。');
      await this.runtime.commands.deleteInternalCase({
        caseId: item.id,
        baseCaseVersion: projection.versions.get(caseKey),
        caseLease,
        baseTaskVersion: taskId ? projection.versions.get(`task:${taskId}`) : null,
        taskLease: taskId ? map.get(`task:${taskId}`) : null,
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([caseKey, ...(taskId ? [`task:${taskId}`] : [])]);
  }

  async updateUser(user: UserAccount) {
    const key = `user:${user.id}`;
    if (!isOnline()) throw new Error('離線時不能變更使用者權限。');
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'user', user.id, lease => (
      this.runtime.commands.updateUser({
        userId: user.id,
        baseMembershipVersion: projection.versions.get(key),
        lease,
        user: userCommandPayload(user),
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async updateSettingValues(
    section: 'departments' | 'task-categories' | 'meeting-task-categories'
      | 'priorities' | 'equipment-options',
    values: string[],
  ) {
    const key = `settings:${section}`;
    if (!isOnline()) throw new Error('離線時不能變更系統設定。');
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'settings', section, lease => (
      this.runtime.commands.updateSettingsValues({
        section,
        values,
        baseVersion: projection.versions.get(key),
        lease,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async updateRolePermissions(matrix: JsonObject) {
    const key = 'settings:role-permissions';
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'settings', 'role-permissions', lease => (
      this.runtime.commands.updateRolePermissions({
        matrix,
        baseVersion: projection.versions.get(key),
        lease,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async updateWorkspaceSettings(value: JsonObject) {
    const key = 'settings:workspace';
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'settings', 'workspace', lease => (
      this.runtime.commands.updateWorkspaceSettings({
        value,
        baseVersion: projection.versions.get(key),
        lease,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async updateSiteGate(password: string) {
    const key = 'settings:site-gate';
    await this.runtime.refreshEntities([key]);
    const projection = this.#projection();
    await this.#withLease(key, 'settings', 'site-gate', lease => (
      this.runtime.commands.updateSiteGate({
        password,
        baseVersion: projection.versions.get(key),
        lease,
      }).then(() => undefined)
    ));
    await this.runtime.refreshEntities([key]);
  }

  async markAllNotificationsRead(actor: UserAccount) {
    const notifications = this.#projection().data.notifications
      .filter(item => item.userId === actor.id && !item.readAt);
    if (!notifications.length) return;
    await this.runtime.commands.markNotificationsRead(
      actor.id,
      notifications.map(item => ({
        notificationId: item.id,
        baseVersion: this.#projection().versions.get(`notification:${item.id}`),
      })),
    );
    await this.runtime.refreshEntities(notifications.map(item => `notification:${item.id}`));
  }

  async dismissWorkCenterItems(
    actor:UserAccount,
    taskIds:string[],
    internalControlCaseIds:string[],
  ){
    const items=[
      ...Array.from(new Set(taskIds)).map(itemId=>({itemKind:'task' as const,itemId})),
      ...Array.from(new Set(internalControlCaseIds)).map(itemId=>({itemKind:'internal-control' as const,itemId})),
    ];
    if(!items.length)throw new Error('請先選擇要從我的待辦移除的項目。');
    await this.runtime.commands.dismissWorkCenterItems(actor.id,items);
    await this.runtime.refreshEntities([`task-dismissals:${actor.id}`,'audit']);
  }

  async saveReport(report: AgendaReport) {
    await this.runtime.commands.saveReport({
      reportId: report.id,
      content: {
        title: report.title,
        vesselIds: report.vesselIds,
        taskCount: report.taskCount,
        kind: report.kind || 'ad-hoc',
        businessDate: report.businessDate || null,
        source: report.source || 'manual',
        snapshot: report.snapshot || null,
      },
    });
    await this.runtime.refreshEntities([`report:${report.id}`]);
  }

  async recoverDraft(envelope: DurableDraftEnvelope): Promise<void> {
    const draft = isRecord(envelope.draft) ? envelope.draft : null;
    const internalPendingCommand = envelope.pendingOperation?.command;
    const parsedInternalCase = draft
      ? this.#parseInternalCaseDraft(envelope, draft)
      : null;
    if ((internalPendingCommand === 'update_internal_case'
        || internalPendingCommand === 'batch_create_internal_cases')
        && !parsedInternalCase) {
      throw new NormalizedCommandError(
        'invalid',
        internalPendingCommand === 'update_internal_case'
          ? 'offline-internal-case-update-invalid'
          : 'offline-internal-case-batch-invalid',
        '離線內控復原資料不完整；未查詢或重播伺服器操作。',
      );
    }
    if (parsedInternalCase) {
      if (envelope.pendingOperation) {
        const status = await this.runtime.recoverPendingOperation(
          envelope.entityKey,
          parsedInternalCase.kind === 'update'
            ? {
                beforeReplay: async () => {
                  await this.#preflightInternalCaseUpdate(
                    parsedInternalCase.candidate,
                    parsedInternalCase.intent,
                  );
                },
              }
            : undefined,
        );
        if (status?.status === 'committed') {
          if (parsedInternalCase.kind === 'batch') {
            await this.runtime.refreshAll();
          } else {
            await this.runtime.refreshEntities(this.#internalUpdateRefreshKeys(
              parsedInternalCase.candidate,
              parsedInternalCase.intent,
            ));
          }
          this.#clearDraft(envelope.entityKey);
          return;
        }
        if (status?.status === 'prepared' || status?.status === 'recovery_required') {
          throw new NormalizedCommandError(
            'recovery',
            status.errorCode || 'operation-recovery-required',
            '先前操作仍待伺服器確認；已保留 operationId 與草稿，暫不重複寫入。',
            envelope.pendingOperation.operationId,
          );
        }
        if (status?.status === 'rejected') {
          throw new NormalizedCommandError(
            'rejected',
            status.errorCode || 'operation-rejected',
            '先前內控操作已被伺服器拒絕；草稿仍保留供重新檢視。',
            envelope.pendingOperation.operationId,
          );
        }
      }
      if (parsedInternalCase.kind === 'batch') {
        await this.#submitInternalCaseBatch(
          parsedInternalCase.prepared,
          parsedInternalCase.operationId,
          envelope.entityKey,
        );
      } else {
        await this.updateInternalCase(
          parsedInternalCase.candidate,
          undefined,
          parsedInternalCase.intent,
        );
      }
      return;
    }
    if (envelope.pendingOperation) {
      const status = await this.runtime.recoverPendingOperation(envelope.entityKey);
      if (status?.status === 'committed') {
        if (envelope.entityKey.startsWith('internal-case-batch:')) {
          await this.runtime.refreshAll();
        } else {
          await this.runtime.refreshEntities([envelope.entityKey]);
        }
        this.#clearDraft(envelope.entityKey);
        return;
      }
      if (status?.status === 'prepared' || status?.status === 'recovery_required') {
        throw new NormalizedCommandError(
          'recovery',
          status.errorCode || 'operation-recovery-required',
          '先前操作仍待伺服器確認；已保留 operationId 與草稿，暫不重複寫入。',
          envelope.pendingOperation.operationId,
        );
      }
    }
    if (!draft) {
      return;
    }
    const kind = typeof draft.kind === 'string' ? draft.kind : '';
    if (kind === 'task' && draft.candidate && typeof draft.candidate === 'object') {
      await this.saveTask(
        draft.candidate as unknown as TaskItem,
        envelope.entityKey.startsWith('task-create:'),
      );
      return;
    }
    if (kind === 'task-progress' && typeof draft.taskId === 'string'
      && typeof draft.vesselId === 'string' && draft.progress && typeof draft.progress === 'object') {
      await this.runtime.refreshEntities([
        `task:${draft.taskId}`,
        `task-progress:${draft.taskId}:${draft.vesselId}`,
      ]);
      const task = this.#projection().data.tasks.find(item => item.id === draft.taskId);
      if (!task) throw new Error('離線進度所屬待辦已不存在。');
      const candidate = structuredClone(task);
      candidate.vesselProgress = [
        draft.progress as TaskItem['vesselProgress'] extends Array<infer T> ? T : never,
        ...(candidate.vesselProgress || []).filter(item => item.vesselId !== draft.vesselId),
      ];
      await this.saveTaskProgress(candidate, draft.vesselId);
      return;
    }
    if ((kind === 'vessel' || kind === 'vessel-create')
      && draft.candidate && typeof draft.candidate === 'object') {
      const candidate = draft.candidate as unknown as Vessel;
      if (kind === 'vessel-create') {
        await this.createVessel(candidate);
        return;
      }
      await this.runtime.refreshEntities([`vessel:${candidate.id}`]);
      const before = this.#projection().data.vessels.find(item => item.id === candidate.id);
      if (!before) throw new Error('離線草稿所屬船舶已不存在。');
      await this.saveVessel(before, candidate);
      return;
    }
    if (kind === 'meeting' && draft.candidate && typeof draft.candidate === 'object') {
      const candidate = draft.candidate as unknown as TemporaryMeeting;
      await this.saveMeeting(
        candidate,
        !this.#projection().versions.has(`meeting:${candidate.id}`),
      );
      return;
    }
    if (kind === 'internal-case' && draft.mode === 'create'
        && draft.candidate && typeof draft.candidate === 'object') {
      const candidate = draft.candidate as unknown as InternalControlCase;
      const linked = draft.linkedTask && typeof draft.linkedTask === 'object'
        ? draft.linkedTask as JsonObject
        : null;
      await this.createInternalCase(candidate, linked ? {
        categories: Array.isArray(linked.categories)
          ? linked.categories.filter((value): value is string => typeof value === 'string')
          : [],
        expectedDate: typeof linked.expectedDate === 'string' ? linked.expectedDate : '',
        ownerUserIds: Array.isArray(linked.ownerUserIds)
          ? linked.ownerUserIds.filter((value): value is string => typeof value === 'string')
          : [],
      } : undefined);
    }
  }

  async terminatePreparedOperation(entityKey: string): Promise<OperationStatus | null> {
    return this.runtime.terminatePendingOperation(entityKey);
  }

  data(): AppData {
    return this.#projection().data;
  }
}
