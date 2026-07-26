import {
  NormalizedCommandError,
  type LeaseGrant,
  type NormalizedRepository,
} from './normalizedRepository';

type JsonObject = Record<string, unknown>;

export interface LeaseProof {
  leaseKey: string;
  ownerSession: string;
  fencingToken: number;
}

export interface MeetingCommandPayload {
  scopeMode: 'all' | 'types' | 'vessels';
  subject: string;
  status: string;
  meetingDate: string;
  vesselIds: string[];
  vesselTypeScopes: string[];
  departments: string[];
  participantUserIds: string[];
  trackingUserIds: string[];
  responsibleUserIds: string[];
  reason: string;
  resolution: string;
  expectedDate: string | null;
  completedDate: string | null;
  priority: string;
  isAbnormal: boolean;
  isInternalControl: boolean;
  includeInMorning: boolean;
  items: unknown[];
}

function uuid(): string {
  const operationId = globalThis.crypto?.randomUUID?.();
  if (!operationId) throw new Error('Secure UUID generation is unavailable.');
  return operationId;
}

function leaseRequest(lease: LeaseProof): JsonObject {
  return {
    leaseKey: lease.leaseKey,
    ownerSession: lease.ownerSession,
    fencingToken: lease.fencingToken,
  };
}

function compareJsonbKeys(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return leftBytes.length - rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return 0;
}

export function postgresJsonbText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSONB command values must be finite.');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(', ')}]`;
  if (!value || typeof value !== 'object') throw new Error('Command values must be JSON-compatible.');
  const object = value as JsonObject;
  const keys = Object.keys(object)
    .filter(key => object[key] !== undefined)
    .sort(compareJsonbKeys);
  return `{${keys.map(key => `${JSON.stringify(key)}: ${postgresJsonbText(object[key])}`).join(', ')}}`;
}

export function md5Hex(input: string): string {
  const source = new TextEncoder().encode(input);
  const paddedLength = (((source.length + 8) >>> 6) + 1) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const bitLength = BigInt(source.length) * 8n;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Number(bitLength & 0xffffffffn), true);
  view.setUint32(paddedLength - 4, Number(bitLength >> 32n), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from({ length: 64 }, (_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  ));
  const rotateLeft = (value: number, shift: number) => (
    ((value << shift) | (value >>> (32 - shift))) >>> 0
  );

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => (
      view.getUint32(offset + index * 4, true)
    ));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let wordIndex: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      const sum = (a + f + constants[index] + words[wordIndex]) >>> 0;
      b = (b + rotateLeft(sum, shifts[index])) >>> 0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map(value => Array.from({ length: 4 }, (_, index) => (
      ((value >>> (index * 8)) & 0xff).toString(16).padStart(2, '0')
    )).join(''))
    .join('');
}

export function batchTargetKey(
  kind: 'vessel' | 'task' | 'internal-case',
  items: unknown[],
): string {
  return `${kind}-batch:${md5Hex(postgresJsonbText(items))}`;
}

function meetingArgs(meetingId: string, lease: LeaseProof, payload: MeetingCommandPayload) {
  return {
    p_meeting_id: meetingId,
    p_fencing_token: lease.fencingToken,
    p_lease_key: lease.leaseKey,
    p_owner_session: lease.ownerSession,
    p_scope_mode: payload.scopeMode,
    p_subject: payload.subject,
    p_status: payload.status,
    p_meeting_date: payload.meetingDate,
    p_vessel_ids: payload.vesselIds,
    p_vessel_type_scopes: payload.vesselTypeScopes,
    p_departments: payload.departments,
    p_participant_user_ids: payload.participantUserIds,
    p_tracking_user_ids: payload.trackingUserIds,
    p_responsible_user_ids: payload.responsibleUserIds,
    p_reason: payload.reason,
    p_resolution: payload.resolution,
    p_expected_date: payload.expectedDate,
    p_completed_date: payload.completedDate,
    p_priority: payload.priority,
    p_is_abnormal: payload.isAbnormal,
    p_is_internal_control: payload.isInternalControl,
    p_include_in_morning: payload.includeInMorning,
    p_items: payload.items,
  };
}

function meetingRequest(meetingId: string, lease: LeaseProof, payload: MeetingCommandPayload) {
  return {
    meetingId,
    ...leaseRequest(lease),
    ...payload,
  };
}

export class NormalizedCommandClient {
  #repository: NormalizedRepository;

  constructor(repository: NormalizedRepository) {
    this.#repository = repository;
  }

  createOperationId() {
    return uuid();
  }

  claimLease(input: {
    leaseKey: string;
    entityType: string;
    entityId: string;
    ownerSession?: string;
    ttlSeconds?: number;
  }) {
    return this.#repository.claimLease({
      ...input,
      ownerSession: input.ownerSession || uuid(),
    });
  }

  renewLease(lease: LeaseProof, ttlSeconds?: number) {
    return this.#repository.renewLease({ ...lease, ttlSeconds });
  }

  releaseLease(lease: LeaseProof) {
    return this.#repository.releaseLease(lease);
  }

  async claimLeaseSet(
    entities: Array<{ leaseKey: string; entityType: string; entityId: string }>,
  ): Promise<LeaseProof[]> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new NormalizedCommandError(
        'recovery',
        'offline-draft-only',
        '離線時不能取得編輯租約；內容只會保存為草稿。',
      );
    }
    const ownerSession = uuid();
    const claimed: LeaseProof[] = [];
    try {
      for (const entity of [...entities].sort((left, right) => (
        left.leaseKey.localeCompare(right.leaseKey)
      ))) {
        const grant = await this.claimLease({ ...entity, ownerSession });
        if (!grant.ok || grant.fencingToken === undefined || !grant.ownerSession) {
          throw new NormalizedCommandError(
            'busy',
            'lease-busy',
            '至少一個項目正在由其他使用者編輯。',
          );
        }
        claimed.push({
          leaseKey: grant.leaseKey,
          ownerSession: grant.ownerSession,
          fencingToken: grant.fencingToken,
        });
      }
      return claimed;
    } catch (error) {
      await Promise.allSettled(claimed.map(lease => this.releaseLease(lease)));
      throw error;
    }
  }

  async releaseLeaseSet(leases: LeaseProof[]) {
    const results = await Promise.allSettled(
      [...leases].reverse().map(lease => this.releaseLease(lease)),
    );
    return results.every(result => result.status === 'fulfilled' && result.value);
  }

  updateVesselField(input: {
    vesselId: string;
    baseVersion: number;
    lease: LeaseProof;
    field: 'profile' | 'position' | 'cargo' | 'note' | 'weekly_attention';
    value: unknown;
    operationId?: string;
  }) {
    const command = `update_vessel_${input.field}`;
    const valueArgument = input.field === 'profile'
      ? 'p_profile'
      : input.field === 'weekly_attention' ? 'p_weekly_attention' : `p_${input.field}`;
    const request = {
      vesselId: input.vesselId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      value: input.value,
    };
    return this.#repository.executeCommand({
      rpc: `command_ship_dynamics_${command}`,
      command,
      operationId: input.operationId || uuid(),
      entityKey: `vessel:${input.vesselId}`,
      request,
      args: {
        p_vessel_id: input.vesselId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        [valueArgument]: input.value,
      },
    });
  }

  updateVesselManualAttention(input: {
    vesselId: string;
    baseVersion: number;
    lease: LeaseProof;
    manualAttentionLevel: string | null;
    operationId?: string;
  }) {
    const request = {
      vesselId: input.vesselId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      manualAttentionLevel: input.manualAttentionLevel,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_vessel_manual_attention',
      command: 'update_vessel_manual_attention',
      operationId: input.operationId || uuid(),
      entityKey: `vessel:${input.vesselId}`,
      request,
      args: {
        p_vessel_id: input.vesselId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_manual_attention_level: input.manualAttentionLevel,
      },
    });
  }

  createVessel(input: {
    vesselId: string;
    lease: LeaseProof;
    profile: JsonObject;
    operationId?: string;
  }) {
    const request = {
      vesselId: input.vesselId,
      ...leaseRequest(input.lease),
      profile: input.profile,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_create_vessel',
      command: 'create_vessel',
      operationId: input.operationId || uuid(),
      entityKey: `vessel:${input.vesselId}`,
      request,
      args: {
        p_vessel_id: input.vesselId,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_profile: input.profile,
      },
    });
  }

  replaceVesselAssignments(input: {
    vesselId: string;
    baseVersion: number;
    lease: LeaseProof;
    assignments: unknown[];
    operationId?: string;
  }) {
    const request = {
      vesselId: input.vesselId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      assignments: input.assignments,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_replace_vessel_assignments',
      command: 'replace_vessel_assignments',
      operationId: input.operationId || uuid(),
      entityKey: `vessel:${input.vesselId}`,
      request,
      args: {
        p_vessel_id: input.vesselId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_assignments: input.assignments,
      },
    });
  }

  disableVessel(input: {
    vesselId: string;
    baseVersion: number;
    lease: LeaseProof;
    operationId?: string;
  }) {
    const request = {
      vesselId: input.vesselId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_disable_vessel',
      command: 'disable_vessel',
      operationId: input.operationId || uuid(),
      entityKey: `vessel:${input.vesselId}`,
      request,
      args: {
        p_vessel_id: input.vesselId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
      },
    });
  }

  batchUpdateVessels(items: unknown[], operationId = uuid()) {
    const request = { items };
    const targetKey = batchTargetKey('vessel', items);
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_batch_update_vessels',
      command: 'batch_update_vessels',
      operationId,
      entityKey: targetKey,
      targetKey,
      request,
      args: { p_items: items },
    });
  }

  createOrdinaryTask(input: {
    taskId: string;
    lease: LeaseProof;
    content: JsonObject;
    operationId?: string;
  }) {
    const request = {
      taskId: input.taskId,
      ...leaseRequest(input.lease),
      content: input.content,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_create_ordinary_task',
      command: 'create_ordinary_task',
      operationId: input.operationId || uuid(),
      entityKey: `task:${input.taskId}`,
      request,
      args: {
        p_task_id: input.taskId,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_content: input.content,
      },
    });
  }

  updateOrdinaryTask(input: {
    taskId: string;
    baseVersion: number;
    lease: LeaseProof;
    content: JsonObject;
    operationId?: string;
  }) {
    const request = {
      taskId: input.taskId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      content: input.content,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_ordinary_task',
      command: 'update_ordinary_task',
      operationId: input.operationId || uuid(),
      entityKey: `task:${input.taskId}`,
      request,
      args: {
        p_task_id: input.taskId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_content: input.content,
      },
    });
  }

  saveOrdinaryTask(input: {
    taskId: string;
    baseVersion: number;
    lease: LeaseProof;
    content: JsonObject;
    transition?: 'close' | 'reopen' | null;
    operationId?: string;
  }) {
    const request = {
      taskId: input.taskId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      content: input.content,
      transition: input.transition || null,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_save_ordinary_task',
      command: 'save_ordinary_task',
      operationId: input.operationId || uuid(),
      entityKey: `task:${input.taskId}`,
      request,
      args: {
        p_task_id: input.taskId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_content: input.content,
        p_transition: input.transition || null,
      },
    });
  }

  transitionOrdinaryTask(input: {
    taskId: string;
    baseVersion: number;
    lease: LeaseProof;
    action: 'close' | 'reopen' | 'delete';
    operationId?: string;
  }) {
    const command = `${input.action}_ordinary_task`;
    const request = {
      taskId: input.taskId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
    };
    return this.#repository.executeCommand({
      rpc: `command_ship_dynamics_${command}`,
      command,
      operationId: input.operationId || uuid(),
      entityKey: `task:${input.taskId}`,
      request,
      args: {
        p_task_id: input.taskId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
      },
    });
  }

  updateTaskVesselProgress(input: {
    taskId: string;
    vesselId: string;
    taskBaseVersion: number;
    progressBaseVersion: number;
    lease: LeaseProof;
    status: string;
    isClosed: boolean;
    operationId?: string;
  }) {
    const request = {
      taskId: input.taskId,
      vesselId: input.vesselId,
      taskBaseVersion: input.taskBaseVersion,
      progressBaseVersion: input.progressBaseVersion,
      ...leaseRequest(input.lease),
      status: input.status,
      isClosed: input.isClosed,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_task_vessel_progress',
      command: 'update_task_vessel_progress',
      operationId: input.operationId || uuid(),
      entityKey: `task-progress:${input.taskId}:${input.vesselId}`,
      request,
      args: {
        p_task_id: input.taskId,
        p_vessel_id: input.vesselId,
        p_task_base_version: input.taskBaseVersion,
        p_progress_base_version: input.progressBaseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_status: input.status,
        p_is_closed: input.isClosed,
      },
    });
  }

  batchTaskTransition(
    action: 'close' | 'reopen' | 'delete',
    items: unknown[],
    operationId = uuid(),
  ) {
    const command = `batch_${action}_ordinary_tasks`;
    const request = { items };
    const targetKey = batchTargetKey('task', items);
    return this.#repository.executeCommand({
      rpc: `command_ship_dynamics_${command}`,
      command,
      operationId,
      entityKey: targetKey,
      targetKey,
      request,
      args: { p_items: items },
    });
  }

  createMeeting(input: {
    meetingId: string;
    lease: LeaseProof;
    payload: MeetingCommandPayload;
    operationId?: string;
  }) {
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_create_meeting',
      command: 'create_meeting',
      operationId: input.operationId || uuid(),
      entityKey: `meeting:${input.meetingId}`,
      request: meetingRequest(input.meetingId, input.lease, input.payload),
      args: meetingArgs(input.meetingId, input.lease, input.payload),
    });
  }

  updateMeeting(input: {
    meetingId: string;
    baseVersion: number;
    lease: LeaseProof;
    payload: MeetingCommandPayload;
    taskGuards: unknown[];
    operationId?: string;
  }) {
    const request = {
      meetingId: input.meetingId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      ...input.payload,
      taskGuards: input.taskGuards,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_meeting',
      command: 'update_meeting',
      operationId: input.operationId || uuid(),
      entityKey: `meeting:${input.meetingId}`,
      request,
      args: {
        ...meetingArgs(input.meetingId, input.lease, input.payload),
        p_base_version: input.baseVersion,
        p_task_guards: input.taskGuards,
      },
    });
  }

  deleteMeeting(input: {
    meetingId: string;
    baseVersion: number;
    lease: LeaseProof;
    taskGuards: unknown[];
    operationId?: string;
  }) {
    const request = {
      meetingId: input.meetingId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      taskGuards: input.taskGuards,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_delete_meeting',
      command: 'delete_meeting',
      operationId: input.operationId || uuid(),
      entityKey: `meeting:${input.meetingId}`,
      request,
      args: {
        p_meeting_id: input.meetingId,
        p_base_version: input.baseVersion,
        p_fencing_token: input.lease.fencingToken,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_task_guards: input.taskGuards,
      },
    });
  }

  correctMeetingStatus(input: {
    meetingId: string;
    eventId: string;
    baseVersion: number;
    lease: LeaseProof;
    correctionKind: 'void' | 'correct';
    correctedStatus: string | null;
    reason: string;
    operationId?: string;
  }) {
    const request = {
      meetingId: input.meetingId,
      eventId: input.eventId,
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      correctionKind: input.correctionKind,
      correctedStatus: input.correctedStatus,
      reason: input.reason,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_correct_meeting_status_event',
      command: 'correct_meeting_status_event',
      operationId: input.operationId || uuid(),
      entityKey: `meeting:${input.meetingId}`,
      request,
      args: {
        p_meeting_id: input.meetingId,
        p_event_id: input.eventId,
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_correction_kind: input.correctionKind,
        p_corrected_status: input.correctedStatus,
        p_reason: input.reason,
      },
    });
  }

  createInternalCase(input: {
    caseId: string;
    caseLease: LeaseProof;
    casePayload: JsonObject;
    taskPayload?: JsonObject | null;
    taskLease?: LeaseProof | null;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      case: input.casePayload,
      task: input.taskPayload || null,
      taskLeaseKey: input.taskLease?.leaseKey || null,
      taskOwnerSession: input.taskLease?.ownerSession || null,
      taskFencingToken: input.taskLease?.fencingToken || null,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_create_internal_case',
      command: 'create_internal_case',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_case: input.casePayload,
        p_task: input.taskPayload || null,
        p_task_lease_key: input.taskLease?.leaseKey || null,
        p_task_owner_session: input.taskLease?.ownerSession || null,
        p_task_fencing_token: input.taskLease?.fencingToken || null,
      },
    });
  }

  batchCreateInternalCases(items: Array<{
    caseId: string;
    caseLeaseKey: string;
    caseOwnerSession: string;
    caseFencingToken: number;
    case: JsonObject;
    task: JsonObject | null;
    taskLeaseKey: string | null;
    taskOwnerSession: string | null;
    taskFencingToken: number | null;
  }>, operationId = uuid()) {
    const request = { items };
    const targetKey = batchTargetKey('internal-case', items);
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_batch_create_internal_cases',
      command: 'batch_create_internal_cases',
      operationId,
      entityKey: targetKey,
      targetKey,
      request,
      args: { p_items: items },
    });
  }

  updateInternalCase(input: {
    caseId: string;
    baseCaseVersion: number;
    caseLease: LeaseProof;
    casePayload: JsonObject;
    linkAction: 'preserve' | 'materialize' | 'unlink';
    baseTaskVersion?: number | null;
    taskLease?: LeaseProof | null;
    taskPayload?: JsonObject | null;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      baseCaseVersion: input.baseCaseVersion,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      case: input.casePayload,
      baseTaskVersion: input.baseTaskVersion ?? null,
      taskLeaseKey: input.taskLease?.leaseKey || null,
      taskOwnerSession: input.taskLease?.ownerSession || null,
      taskFencingToken: input.taskLease?.fencingToken || null,
      task: input.taskPayload || null,
      linkAction: input.linkAction,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_internal_case',
      command: 'update_internal_case',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_base_case_version: input.baseCaseVersion,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_case: input.casePayload,
        p_base_task_version: input.baseTaskVersion ?? null,
        p_task_lease_key: input.taskLease?.leaseKey || null,
        p_task_owner_session: input.taskLease?.ownerSession || null,
        p_task_fencing_token: input.taskLease?.fencingToken || null,
        p_task: input.taskPayload || null,
        p_link_action: input.linkAction,
      },
    });
  }

  deleteInternalCase(input: {
    caseId: string;
    baseCaseVersion: number;
    caseLease: LeaseProof;
    baseTaskVersion?: number | null;
    taskLease?: LeaseProof | null;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      baseCaseVersion: input.baseCaseVersion,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      baseTaskVersion: input.baseTaskVersion ?? null,
      taskLeaseKey: input.taskLease?.leaseKey || null,
      taskOwnerSession: input.taskLease?.ownerSession || null,
      taskFencingToken: input.taskLease?.fencingToken || null,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_delete_internal_case',
      command: 'delete_internal_case',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_base_case_version: input.baseCaseVersion,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_base_task_version: input.baseTaskVersion ?? null,
        p_task_lease_key: input.taskLease?.leaseKey || null,
        p_task_owner_session: input.taskLease?.ownerSession || null,
        p_task_fencing_token: input.taskLease?.fencingToken || null,
      },
    });
  }

  linkInternalCaseTask(input: {
    caseId: string;
    baseCaseVersion: number;
    caseLease: LeaseProof;
    taskId: string;
    baseTaskVersion: number;
    taskLease: LeaseProof;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      baseCaseVersion: input.baseCaseVersion,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      taskId: input.taskId,
      baseTaskVersion: input.baseTaskVersion,
      taskLeaseKey: input.taskLease.leaseKey,
      taskOwnerSession: input.taskLease.ownerSession,
      taskFencingToken: input.taskLease.fencingToken,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_link_internal_case_task',
      command: 'link_internal_case_task',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_base_case_version: input.baseCaseVersion,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_task_id: input.taskId,
        p_base_task_version: input.baseTaskVersion,
        p_task_lease_key: input.taskLease.leaseKey,
        p_task_owner_session: input.taskLease.ownerSession,
        p_task_fencing_token: input.taskLease.fencingToken,
      },
    });
  }

  unlinkInternalCaseTask(input: {
    caseId: string;
    baseCaseVersion: number;
    caseLease: LeaseProof;
    baseTaskVersion: number;
    taskLease: LeaseProof;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      baseCaseVersion: input.baseCaseVersion,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      baseTaskVersion: input.baseTaskVersion,
      taskLeaseKey: input.taskLease.leaseKey,
      taskOwnerSession: input.taskLease.ownerSession,
      taskFencingToken: input.taskLease.fencingToken,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_unlink_internal_case_task',
      command: 'unlink_internal_case_task',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_base_case_version: input.baseCaseVersion,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_base_task_version: input.baseTaskVersion,
        p_task_lease_key: input.taskLease.leaseKey,
        p_task_owner_session: input.taskLease.ownerSession,
        p_task_fencing_token: input.taskLease.fencingToken,
      },
    });
  }

  transitionInternalCase(input: {
    caseId: string;
    baseCaseVersion: number;
    caseLease: LeaseProof;
    action: 'cancel' | 'reopen';
    status?: string;
    baseTaskVersion?: number | null;
    taskLease?: LeaseProof | null;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      baseCaseVersion: input.baseCaseVersion,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      ...(input.action === 'reopen' ? { status: input.status || '' } : {}),
      baseTaskVersion: input.baseTaskVersion ?? null,
      taskLeaseKey: input.taskLease?.leaseKey || null,
      taskOwnerSession: input.taskLease?.ownerSession || null,
      taskFencingToken: input.taskLease?.fencingToken || null,
    };
    const command = `${input.action}_internal_case`;
    return this.#repository.executeCommand({
      rpc: `command_ship_dynamics_${command}`,
      command,
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_base_case_version: input.baseCaseVersion,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        ...(input.action === 'reopen' ? { p_status: input.status || '' } : {}),
        p_base_task_version: input.baseTaskVersion ?? null,
        p_task_lease_key: input.taskLease?.leaseKey || null,
        p_task_owner_session: input.taskLease?.ownerSession || null,
        p_task_fencing_token: input.taskLease?.fencingToken || null,
      },
    });
  }

  deleteTaskPreservingInternalCase(input: {
    taskId: string;
    baseTaskVersion: number;
    taskLease: LeaseProof;
    caseId?: string | null;
    baseCaseVersion?: number | null;
    caseLease?: LeaseProof | null;
    operationId?: string;
  }) {
    const request = {
      taskId: input.taskId,
      baseTaskVersion: input.baseTaskVersion,
      taskLeaseKey: input.taskLease.leaseKey,
      taskOwnerSession: input.taskLease.ownerSession,
      taskFencingToken: input.taskLease.fencingToken,
      caseId: input.caseId || null,
      baseCaseVersion: input.baseCaseVersion ?? null,
      caseLeaseKey: input.caseLease?.leaseKey || null,
      caseOwnerSession: input.caseLease?.ownerSession || null,
      caseFencingToken: input.caseLease?.fencingToken || null,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_delete_task_preserving_internal_case',
      command: 'delete_task_preserving_internal_case',
      operationId: input.operationId || uuid(),
      entityKey: `task:${input.taskId}`,
      request,
      args: {
        p_task_id: input.taskId,
        p_base_task_version: input.baseTaskVersion,
        p_task_lease_key: input.taskLease.leaseKey,
        p_task_owner_session: input.taskLease.ownerSession,
        p_task_fencing_token: input.taskLease.fencingToken,
        p_case_id: input.caseId || null,
        p_base_case_version: input.baseCaseVersion ?? null,
        p_case_lease_key: input.caseLease?.leaseKey || null,
        p_case_owner_session: input.caseLease?.ownerSession || null,
        p_case_fencing_token: input.caseLease?.fencingToken || null,
      },
    });
  }

  convertTaskToInternalCase(input: {
    caseId: string;
    taskId: string;
    baseTaskVersion: number;
    caseLease: LeaseProof;
    taskLease: LeaseProof;
    casePayload: JsonObject;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      taskId: input.taskId,
      baseTaskVersion: input.baseTaskVersion,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      taskLeaseKey: input.taskLease.leaseKey,
      taskOwnerSession: input.taskLease.ownerSession,
      taskFencingToken: input.taskLease.fencingToken,
      case: input.casePayload,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_create_internal_case_from_task',
      command: 'create_internal_case_from_task',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_task_id: input.taskId,
        p_base_task_version: input.baseTaskVersion,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_task_lease_key: input.taskLease.leaseKey,
        p_task_owner_session: input.taskLease.ownerSession,
        p_task_fencing_token: input.taskLease.fencingToken,
        p_case: input.casePayload,
      },
    });
  }

  convertInternalCaseToTask(input: {
    caseId: string;
    baseCaseVersion: number;
    taskId: string;
    caseLease: LeaseProof;
    taskLease: LeaseProof;
    taskPayload: JsonObject;
    operationId?: string;
  }) {
    const request = {
      caseId: input.caseId,
      baseCaseVersion: input.baseCaseVersion,
      taskId: input.taskId,
      caseLeaseKey: input.caseLease.leaseKey,
      caseOwnerSession: input.caseLease.ownerSession,
      caseFencingToken: input.caseLease.fencingToken,
      taskLeaseKey: input.taskLease.leaseKey,
      taskOwnerSession: input.taskLease.ownerSession,
      taskFencingToken: input.taskLease.fencingToken,
      task: input.taskPayload,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_create_task_from_internal_case',
      command: 'create_task_from_internal_case',
      operationId: input.operationId || uuid(),
      entityKey: `internal-case:${input.caseId}`,
      request,
      args: {
        p_case_id: input.caseId,
        p_base_case_version: input.baseCaseVersion,
        p_task_id: input.taskId,
        p_case_lease_key: input.caseLease.leaseKey,
        p_case_owner_session: input.caseLease.ownerSession,
        p_case_fencing_token: input.caseLease.fencingToken,
        p_task_lease_key: input.taskLease.leaseKey,
        p_task_owner_session: input.taskLease.ownerSession,
        p_task_fencing_token: input.taskLease.fencingToken,
        p_task: input.taskPayload,
      },
    });
  }

  updateUser(input: {
    userId: string;
    baseMembershipVersion: number;
    lease: LeaseProof;
    user: JsonObject;
    operationId?: string;
  }) {
    const request = {
      userId: input.userId,
      baseMembershipVersion: input.baseMembershipVersion,
      ...leaseRequest(input.lease),
      user: input.user,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_user',
      command: 'update_user',
      operationId: input.operationId || uuid(),
      entityKey: `user:${input.userId}`,
      request,
      args: {
        p_user_id: input.userId,
        p_base_membership_version: input.baseMembershipVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_user: input.user,
      },
    });
  }

  updateSettingsValues(input: {
    section: 'departments' | 'task-categories' | 'meeting-task-categories'
      | 'priorities' | 'equipment-options';
    baseVersion: number;
    lease: LeaseProof;
    values: string[];
    operationId?: string;
  }) {
    const commandBySection = {
      departments: 'update_departments',
      'task-categories': 'update_task_categories',
      'meeting-task-categories': 'update_meeting_task_categories',
      priorities: 'update_priorities',
      'equipment-options': 'update_equipment_options',
    } as const;
    const command = commandBySection[input.section];
    const request = {
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      values: input.values,
    };
    return this.#repository.executeCommand({
      rpc: `command_ship_dynamics_${command}`,
      command,
      operationId: input.operationId || uuid(),
      entityKey: `settings:${input.section}`,
      request,
      args: {
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_values: input.values,
      },
    });
  }

  updateRolePermissions(input: {
    baseVersion: number;
    lease: LeaseProof;
    matrix: JsonObject;
    operationId?: string;
  }) {
    const request = {
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      matrix: input.matrix,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_role_permissions',
      command: 'update_role_permissions',
      operationId: input.operationId || uuid(),
      entityKey: 'settings:role-permissions',
      request,
      args: {
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_matrix: input.matrix,
      },
    });
  }

  updateWorkspaceSettings(input: {
    baseVersion: number;
    lease: LeaseProof;
    value: JsonObject;
    operationId?: string;
  }) {
    const request = {
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
      value: input.value,
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_workspace_settings',
      command: 'update_workspace_settings',
      operationId: input.operationId || uuid(),
      entityKey: 'settings:workspace',
      request,
      args: {
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_value: input.value,
      },
    });
  }

  updateSiteGate(input: {
    baseVersion: number;
    lease: LeaseProof;
    password: string;
    operationId?: string;
  }) {
    // The password is sent only to the security-definer RPC. Reservation identity
    // deliberately contains lease/version metadata but never credential material.
    const request = {
      baseVersion: input.baseVersion,
      ...leaseRequest(input.lease),
    };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_update_site_gate',
      command: 'update_site_gate',
      operationId: input.operationId || uuid(),
      entityKey: 'settings:site-gate',
      request,
      args: {
        p_base_version: input.baseVersion,
        p_lease_key: input.lease.leaseKey,
        p_owner_session: input.lease.ownerSession,
        p_fencing_token: input.lease.fencingToken,
        p_password: input.password,
      },
    });
  }

  markNotificationsRead(actorId: string, items: unknown[], operationId = uuid()) {
    const request = { items };
    const targetKey = `notifications:${actorId}:${md5Hex(postgresJsonbText(items))}`;
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_mark_notifications_read',
      command: 'mark_notifications_read',
      operationId,
      entityKey: 'notifications',
      targetKey,
      request,
      args: { p_items: items },
    });
  }

  saveReport(input: {
    reportId: string;
    content: JsonObject;
    operationId?: string;
  }) {
    const request = { reportId: input.reportId, content: input.content };
    return this.#repository.executeCommand({
      rpc: 'command_ship_dynamics_save_report',
      command: 'save_report',
      operationId: input.operationId || uuid(),
      entityKey: `report:${input.reportId}`,
      request,
      args: { p_report_id: input.reportId, p_content: input.content },
    });
  }
}

export function leaseProof(grant: LeaseGrant): LeaseProof {
  if (!grant.ok || !grant.ownerSession || grant.fencingToken === undefined) {
    throw new NormalizedCommandError(
      'busy',
      'lease-busy',
      '此項目目前無法取得編輯租約。',
    );
  }
  return {
    leaseKey: grant.leaseKey,
    ownerSession: grant.ownerSession,
    fencingToken: grant.fencingToken,
  };
}
