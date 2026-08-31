import { createItineraryId, type ItineraryDocument } from './itineraryTypes';
import { validateItineraryDocument } from './itineraryValidation';

export interface ItineraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ItineraryLeaseActor {
  holderId: string;
  holderLabel: string;
}

export interface ItineraryLease {
  workspaceKey: string;
  vesselId: string;
  leaseId: string;
  leaseToken: string;
  holderId: string;
  holderLabel: string;
  fence: number;
  expiresAt: string;
}

export type ItineraryLeaseClaimResult =
  | { ok: true; lease: ItineraryLease }
  | { ok: false; code: 'locked'; holderLabel: string; expiresAt: string };

export type ItineraryLeaseRenewResult =
  | { ok: true; lease: ItineraryLease }
  | { ok: false; code: 'lease-mismatch' | 'lease-expired' };

export interface ItinerarySaveInput {
  document: ItineraryDocument;
  expectedRevision: number;
  operationId: string;
  lease: ItineraryLease;
  actorLabel: string;
}

export type ItinerarySaveResult =
  | { ok: true; document: ItineraryDocument; replayed: boolean }
  | { ok: false; code: 'operation-mismatch' | 'lease-mismatch' | 'lease-expired' | 'revision-conflict' | 'invalid-document' | 'unknown-outcome'; currentRevision?: number; message?: string };

interface StoredOperationReceipt {
  requestSignature: string;
  document: ItineraryDocument;
}

interface LocalDemoBackendOptions {
  storage: ItineraryStorage;
  workspaceKey: string;
  now?: () => number;
  createId?: (prefix: string) => string;
}

const PREFIX = 'ship-dynamics-itinerary/demo/';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export class LocalDemoItineraryBackend {
  readonly workspaceKey: string;
  readonly storage: ItineraryStorage;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;

  constructor(options: LocalDemoBackendOptions) {
    this.storage = options.storage;
    this.workspaceKey = options.workspaceKey;
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || createItineraryId;
  }

  private scope(value: string): string {
    return `${PREFIX}${encodeURIComponent(this.workspaceKey)}/${value}`;
  }

  documentKey(vesselId: string): string {
    return this.scope(`document/${encodeURIComponent(vesselId)}`);
  }

  private leaseKey(vesselId: string): string {
    return this.scope(`lease/${encodeURIComponent(vesselId)}`);
  }

  private fenceKey(vesselId: string): string {
    return this.scope(`fence/${encodeURIComponent(vesselId)}`);
  }

  private operationKey(operationId: string): string {
    return this.scope(`operation/${encodeURIComponent(operationId)}`);
  }

  private read<T>(key: string): T | null {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  private write(key: string, value: unknown): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  seedDocument(document: ItineraryDocument): void {
    if (document.workspaceKey !== this.workspaceKey || this.storage.getItem(this.documentKey(document.vesselId))) return;
    const valid = validateItineraryDocument(document);
    if (valid.ok === false) throw new Error(`invalid demo seed: ${valid.errors[0]?.code || 'unknown'}`);
    this.write(this.documentKey(document.vesselId), document);
  }

  loadDocument(vesselId: string): ItineraryDocument | null {
    const document = this.read<ItineraryDocument>(this.documentKey(vesselId));
    if (!document) return null;
    const valid = validateItineraryDocument(document);
    return valid.ok ? clone(valid.value) : null;
  }

  claimLease(vesselId: string, actor: ItineraryLeaseActor, ttlSeconds = 75): ItineraryLeaseClaimResult {
    const now = this.now();
    const current = this.read<ItineraryLease>(this.leaseKey(vesselId));
    const ttl = Math.min(600, Math.max(30, Math.floor(ttlSeconds))) * 1000;
    if (current && Date.parse(current.expiresAt) > now) {
      if (current.holderId !== actor.holderId) return { ok: false, code: 'locked', holderLabel: current.holderLabel, expiresAt: current.expiresAt };
      const renewed = { ...current, holderLabel: actor.holderLabel, expiresAt: new Date(now + ttl).toISOString() };
      this.write(this.leaseKey(vesselId), renewed);
      return { ok: true, lease: clone(renewed) };
    }
    const previousFence = Number(this.storage.getItem(this.fenceKey(vesselId)) || 0);
    const fence = Number.isSafeInteger(previousFence) && previousFence >= 0 ? previousFence + 1 : 1;
    const lease: ItineraryLease = {
      workspaceKey: this.workspaceKey,
      vesselId,
      leaseId: this.createId('lease'),
      leaseToken: this.createId('token'),
      holderId: actor.holderId,
      holderLabel: actor.holderLabel,
      fence,
      expiresAt: new Date(now + ttl).toISOString(),
    };
    this.storage.setItem(this.fenceKey(vesselId), String(fence));
    this.write(this.leaseKey(vesselId), lease);
    return { ok: true, lease: clone(lease) };
  }

  renewLease(lease: ItineraryLease, ttlSeconds = 75): ItineraryLeaseRenewResult {
    const now = this.now();
    const current = this.read<ItineraryLease>(this.leaseKey(lease.vesselId));
    if (!current || !this.sameLease(current, lease)) return { ok: false, code: 'lease-mismatch' };
    if (Date.parse(current.expiresAt) <= now) return { ok: false, code: 'lease-expired' };
    const ttl = Math.min(600, Math.max(30, Math.floor(ttlSeconds))) * 1000;
    const renewed = { ...current, expiresAt: new Date(now + ttl).toISOString() };
    this.write(this.leaseKey(lease.vesselId), renewed);
    return { ok: true, lease: clone(renewed) };
  }

  releaseLease(lease: ItineraryLease): boolean {
    const current = this.read<ItineraryLease>(this.leaseKey(lease.vesselId));
    if (!current || !this.sameLease(current, lease)) return false;
    this.storage.removeItem(this.leaseKey(lease.vesselId));
    return true;
  }

  save(input: ItinerarySaveInput): ItinerarySaveResult {
    const requestSignature = stableStringify({ document: input.document, expectedRevision: input.expectedRevision, vesselId: input.lease.vesselId });
    const operationKey = this.operationKey(input.operationId);
    const existingReceipt = this.read<StoredOperationReceipt>(operationKey);
    if (existingReceipt) {
      if (existingReceipt.requestSignature !== requestSignature) return { ok: false, code: 'operation-mismatch' };
      return { ok: true, document: clone(existingReceipt.document), replayed: true };
    }

    if (input.document.workspaceKey !== this.workspaceKey || input.document.vesselId !== input.lease.vesselId) return { ok: false, code: 'lease-mismatch' };
    const currentLease = this.read<ItineraryLease>(this.leaseKey(input.lease.vesselId));
    if (!currentLease || !this.sameLease(currentLease, input.lease)) return { ok: false, code: 'lease-mismatch' };
    if (Date.parse(currentLease.expiresAt) <= this.now()) return { ok: false, code: 'lease-expired' };

    const current = this.loadDocument(input.document.vesselId);
    if (!current) return { ok: false, code: 'invalid-document', message: '找不到可保存的 Itinerary 文件。' };
    if (current.revision !== input.expectedRevision) return { ok: false, code: 'revision-conflict', currentRevision: current.revision };

    const next: ItineraryDocument = {
      ...clone(input.document),
      revision: current.revision + 1,
      updatedAt: new Date(this.now()).toISOString(),
      updatedActorKind: 'demo',
      updatedActorLabel: input.actorLabel,
    };
    const validation = validateItineraryDocument(next);
    if (validation.ok === false) return { ok: false, code: 'invalid-document', message: validation.errors[0]?.message };
    this.write(this.documentKey(next.vesselId), next);
    this.write(operationKey, { requestSignature, document: next } satisfies StoredOperationReceipt);
    return { ok: true, document: clone(next), replayed: false };
  }

  private sameLease(left: ItineraryLease, right: ItineraryLease): boolean {
    return left.workspaceKey === right.workspaceKey
      && left.vesselId === right.vesselId
      && left.leaseId === right.leaseId
      && left.leaseToken === right.leaseToken
      && left.holderId === right.holderId
      && left.fence === right.fence;
  }
}

export const ITINERARY_DEMO_STORAGE_PREFIX = PREFIX;
