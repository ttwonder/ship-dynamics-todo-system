import type {
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

type JsonObject = Record<string, unknown>;

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function jsonDraft(value: unknown): JsonObject {
  return structuredClone(value) as JsonObject;
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
      { leaseKey: caseKey, entityType: 'internal-case', entityId: item.id },
      ...(taskId ? [{
        leaseKey: `task:${taskId}`,
        entityType: 'internal-task',
        entityId: taskId,
      }] : []),
    ]);
    try {
      const map = new Map(leases.map(lease => [lease.leaseKey, lease]));
      const caseLease = map.get(caseKey);
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
        taskPayload,
        taskId: typeof taskPayload?.id === 'string' ? taskPayload.id : '',
      };
    });
    if (!isOnline()) {
      for (const entry of prepared) {
        this.#saveOfflineDraft(
          entry.caseKey,
          {
            kind: 'internal-case',
            mode: 'create',
            candidate: jsonDraft(entry.item),
            linkedTask: entry.taskPayload ? jsonDraft(entry.taskPayload) : null,
          },
          [],
        );
      }
      return 'drafted';
    }

    const leaseRequests = new Map<string, {
      leaseKey: string;
      entityType: string;
      entityId: string;
    }>();
    for (const entry of prepared) {
      leaseRequests.set(entry.caseKey, {
        leaseKey: entry.caseKey,
        entityType: 'internal-case',
        entityId: entry.item.id,
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
        const caseLease = leaseMap.get(entry.caseKey);
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
      }));
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities(prepared.flatMap(entry => [
      entry.caseKey,
      ...(entry.taskId ? [`task:${entry.taskId}`] : []),
    ]));
    for (const entry of prepared) this.#clearDraft(entry.caseKey);
    return 'committed';
  }

  async updateInternalCase(
    item: InternalControlCase,
    taskProjection?: {
      categories: string[];
      equipmentSubcategory?: string;
      expectedDate: string;
      ownerUserIds: string[];
    },
  ): Promise<'committed' | 'drafted'> {
    const caseKey = `internal-case:${item.id}`;
    const initial = this.#projection().data.internalControlCases.find(entry => entry.id === item.id);
    const existingTaskId = initial?.linkedTaskId || '';
    const addingTask = !existingTaskId && item.syncToTask && Boolean(taskProjection);
    const removingTask = Boolean(existingTaskId) && !item.syncToTask;
    const taskId = existingTaskId || (addingTask ? crypto.randomUUID() : '');
    const linkAction = addingTask ? 'materialize' : removingTask ? 'unlink' : 'preserve';
    const taskLeaseKey = addingTask
      ? `task-create:${item.vesselId}`
      : taskId ? `task:${taskId}` : '';
    if (!isOnline()) {
      this.#saveOfflineDraft(
        caseKey,
        { kind: 'internal-case', mode: 'update', candidate: jsonDraft(item) },
        [caseKey, ...(taskId ? [`task:${taskId}`] : [])],
      );
      return 'drafted';
    }
    await this.runtime.refreshEntities([caseKey, ...(taskId ? [`task:${taskId}`] : [])]);
    const projection = this.#projection();
    this.#validateStoredDraft(caseKey, projection);
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
        baseTaskVersion: existingTaskId
          ? projection.versions.get(`task:${existingTaskId}`)
          : null,
        taskLease: taskId ? map.get(taskLeaseKey) : null,
        taskPayload: taskProjection && linkAction !== 'unlink'
          ? linkedInternalTaskCommandPayload(item, {
              id: taskId,
              expectedDate: taskProjection.expectedDate,
              categories: taskProjection.categories,
              ownerUserIds: taskProjection.ownerUserIds,
            })
          : null,
      });
    } finally {
      await this.runtime.commands.releaseLeaseSet(leases);
    }
    await this.runtime.refreshEntities([caseKey, ...(taskId ? [`task:${taskId}`] : [])]);
    this.#clearDraft(caseKey);
    return 'committed';
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

  async saveReport(report: {
    id: string;
    title: string;
    vesselIds: string[];
    taskCount: number;
  }) {
    await this.runtime.commands.saveReport({
      reportId: report.id,
      content: {
        title: report.title,
        vesselIds: report.vesselIds,
        taskCount: report.taskCount,
      },
    });
    await this.runtime.refreshEntities([`report:${report.id}`]);
  }

  async recoverDraft(envelope: DurableDraftEnvelope): Promise<void> {
    if (envelope.pendingOperation) {
      const status = await this.runtime.recoverPendingOperation(envelope.entityKey);
      if (status?.status === 'committed') {
        await this.runtime.refreshEntities([envelope.entityKey]);
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
    if (!envelope.draft || typeof envelope.draft !== 'object' || Array.isArray(envelope.draft)) {
      return;
    }
    const draft = envelope.draft as JsonObject;
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
    if (kind === 'internal-case' && draft.candidate && typeof draft.candidate === 'object') {
      const candidate = draft.candidate as unknown as InternalControlCase;
      if (draft.mode === 'create') {
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
      } else {
        await this.updateInternalCase(candidate);
      }
    }
  }

  async terminatePreparedOperation(entityKey: string): Promise<OperationStatus | null> {
    return this.runtime.terminatePendingOperation(entityKey);
  }

  data(): AppData {
    return this.#projection().data;
  }
}
