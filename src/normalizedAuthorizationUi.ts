import type { TaskItem, UserRole } from './types';
import { taskVesselIds } from './taskVesselScope';

export interface NormalizedAuthorizationEpochInput {
  authorizationGeneration: number;
  actorId: string;
  role: UserRole;
  permissionBits: string;
  vesselIds: string[];
}

export interface NormalizedDraftOwner {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly entityKey: string;
}

export interface NormalizedTaskEditorSession {
  readonly sessionId: string;
  readonly authorizationEpoch: string;
  readonly draftOwner: NormalizedDraftOwner;
  readonly task: TaskItem;
  readonly creating: boolean;
  readonly progressVesselId: string;
}

export function createNormalizedAuthorizationEpoch(
  input: NormalizedAuthorizationEpochInput,
): string {
  return JSON.stringify([
    input.authorizationGeneration,
    input.actorId,
    input.role,
    input.permissionBits,
    [...new Set(input.vesselIds)].sort(),
  ]);
}

export function openNormalizedTaskEditor(
  task: TaskItem,
  input: {
    authorizationEpoch: string;
    creating: boolean;
    progressVesselId: string;
    draftOwner: NormalizedDraftOwner;
  },
): NormalizedTaskEditorSession {
  return Object.freeze({
    sessionId: crypto.randomUUID(),
    authorizationEpoch: input.authorizationEpoch,
    draftOwner: Object.freeze({ ...input.draftOwner }),
    task: structuredClone(task),
    creating: input.creating,
    progressVesselId: input.progressVesselId,
  });
}

export function cleanupNormalizedTaskEditorDraft(
  editor: NormalizedTaskEditorSession | null,
  removeOwnedDraft: (owner: NormalizedDraftOwner) => void,
): void {
  if (!editor) return;
  try {
    removeOwnedDraft(editor.draftOwner);
  } catch {
    // Durable cleanup must never interrupt synchronous authorization-state purge.
  }
}

export function resolveAuthorizedTaskEditor(
  editor: NormalizedTaskEditorSession | null,
  current: {
    authorizationEpoch: string;
    visibleTasks: TaskItem[];
    visibleVesselIds: ReadonlySet<string>;
    canCreate: boolean;
  },
): TaskItem | null {
  if (!editor || editor.authorizationEpoch !== current.authorizationEpoch) return null;
  if (editor.creating) {
    const vesselIds = taskVesselIds(editor.task);
    return current.canCreate
      && vesselIds.length > 0
      && vesselIds.every(vesselId => current.visibleVesselIds.has(vesselId))
      ? editor.task
      : null;
  }
  return current.visibleTasks.some(task => task.id === editor.task.id)
    ? editor.task
    : null;
}
