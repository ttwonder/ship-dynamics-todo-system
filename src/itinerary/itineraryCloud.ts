import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from '../cloud';
import { createNormalizedSupabaseClient } from '../normalizedSupabaseClient';
import type { ItineraryLease, ItineraryLeaseClaimResult, ItineraryLeaseRenewResult, ItinerarySaveInput, ItinerarySaveResult } from './itineraryCollaboration';
import { normalizeInstant } from './itineraryTime';
import type { ItineraryDocument } from './itineraryTypes';
import { validateItineraryDocument } from './itineraryValidation';

export const ITINERARY_OFFICE_SESSION_STORAGE_KEY = 'ship-dynamics.itinerary.supabase-session';

let officeClient: SupabaseClient | null = null;
let officeClientKey = '';
type ItineraryRpcClient = Pick<SupabaseClient, 'rpc'>;

export function getItineraryOfficeClient(config: ResolvedSupabaseConfig | null = getSupabaseConfig()): SupabaseClient | null {
  if (!config) return null;
  const key = `${config.supabaseUrl}|${config.supabaseAnonKey}`;
  if (!officeClient || officeClientKey !== key) {
    officeClient = createNormalizedSupabaseClient({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      workspaceId: config.workspaceKey,
      storageKey: ITINERARY_OFFICE_SESSION_STORAGE_KEY,
    });
    officeClientKey = key;
  }
  return officeClient;
}

function message(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error || 'unknown-error');
  const value = error as Record<string, unknown>;
  return [value.message, value.details, value.hint, value.code].filter(Boolean).join(' ');
}

function requiredConfig(): ResolvedSupabaseConfig {
  const config = getSupabaseConfig();
  if (!config) throw new Error('Itinerary Supabase 設定不存在。');
  return config;
}

async function rpc<T>(client: ItineraryRpcClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(message(error));
  return data as T;
}

function parseDocument(value: unknown): ItineraryDocument | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Itinerary 雲端文件格式不正確。');
  const raw = structuredClone(value) as Record<string, unknown>;
  raw.updatedActorKind = raw.updatedActorKind === 'public' ? 'vessel' : raw.updatedActorKind === 'office' ? 'owner' : raw.updatedActorKind;
  raw.updatedAt = raw.updatedAt ? normalizeInstant(String(raw.updatedAt)) : null;
  const validated = validateItineraryDocument(raw);
  if (validated.ok === false) throw new Error(`Itinerary 雲端文件未通過驗證：${validated.errors[0]?.message || 'unknown'}`);
  return validated.value;
}

function leaseFrom(value: Record<string, unknown>, workspaceKey: string, vesselId: string, holderId: string, holderLabel: string): ItineraryLease {
  return {
    workspaceKey, leaseId: String(value.leaseId), leaseToken: String(value.leaseId), fence: Number(value.fencingToken),
    vesselId, holderId, holderLabel, expiresAt: String(value.expiresAt),
  };
}

function saveFailure(error: unknown): ItinerarySaveResult {
  const text = message(error);
  if (/revision-conflict/i.test(text)) return { ok: false, code: 'revision-conflict' };
  if (/lease-expired|lease-mismatch/i.test(text)) return { ok: false, code: 'lease-expired' };
  if (/invalid-itinerary-payload/i.test(text)) return { ok: false, code: 'invalid-document', message: text };
  return { ok: false, code: 'unknown-outcome', message: text };
}

export interface PublicItineraryVessel { id: string; name: string; shortName: string; fullName: string }

export interface ItineraryOwnerRolloutUpdateInput {
  expectedVersion: number;
  mainEnabled: boolean;
  shipPortalEnabled: boolean;
  operationId: string;
}

export interface ItineraryOwnerRolloutUpdateResult {
  ok: true;
  version: number;
  mainEnabled: boolean;
  shipPortalEnabled: boolean;
  replayed: boolean;
}

const officeRolePermissions = () => ({
  admin: { view: true, edit: true, import: true, export: true, calendar: true },
  operator: { view: true, edit: true, import: true, export: true, calendar: true },
  vessel: { view: false, edit: false, import: false, export: false, calendar: false },
});

function parseOwnerRolloutUpdateResult(
  value: Record<string, unknown>,
  input: ItineraryOwnerRolloutUpdateInput,
  recovered = false,
): ItineraryOwnerRolloutUpdateResult {
  const version = Number(value.version);
  if (value.ok !== true || !Number.isSafeInteger(version) || version < 1
      || value.mainEnabled !== input.mainEnabled || value.shipPortalEnabled !== input.shipPortalEnabled) {
    throw new Error('Itinerary rollout 回應格式不正確。');
  }
  return { ok: true, version, mainEnabled: input.mainEnabled, shipPortalEnabled: input.shipPortalEnabled, replayed: recovered || value.replayed === true };
}

export async function updateOwnerItineraryRollout(
  input: ItineraryOwnerRolloutUpdateInput,
  config: ResolvedSupabaseConfig = requiredConfig(),
  client: ItineraryRpcClient | null = getItineraryOfficeClient(config),
): Promise<ItineraryOwnerRolloutUpdateResult> {
  if (!client) throw new Error('Itinerary authenticated client is unavailable.');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
      || typeof input.mainEnabled !== 'boolean' || typeof input.shipPortalEnabled !== 'boolean' || !input.operationId.trim()) {
    throw new Error('Itinerary rollout 請求格式不正確。');
  }
  const args = {
    p_workspace_key: config.workspaceKey,
    p_expected_version: input.expectedVersion,
    p_operation_id: input.operationId,
    p_main_enabled: input.mainEnabled,
    p_ship_portal_enabled: input.shipPortalEnabled,
    p_role_permissions: officeRolePermissions(),
  };
  try {
    return parseOwnerRolloutUpdateResult(
      await rpc<Record<string, unknown>>(client, 'sd_itinerary_owner_update_rollout', args),
      input,
    );
  } catch (error) {
    try {
      const status = await rpc<Record<string, unknown>>(client, 'sd_itinerary_operation_status_office', {
        p_workspace_key: config.workspaceKey,
        p_operation_id: input.operationId,
      });
      return parseOwnerRolloutUpdateResult(status, input, true);
    } catch {
      throw error;
    }
  }
}

export class OfficeItineraryCloudRepository {
  readonly config: ResolvedSupabaseConfig;
  readonly client: SupabaseClient;

  constructor(config: ResolvedSupabaseConfig = requiredConfig(), client: SupabaseClient | null = getItineraryOfficeClient(config)) {
    if (!client) throw new Error('Itinerary authenticated client is unavailable.');
    this.config = config;
    this.client = client;
  }

  async loadMany(vesselIds: string[]): Promise<Record<string, ItineraryDocument | null>> {
    const rows = await rpc<Array<Record<string, unknown>>>(this.client, 'sd_itinerary_load_many', {
      p_workspace_key: this.config.workspaceKey, p_vessel_ids: vesselIds,
    });
    return Object.fromEntries(rows.map(row => [String(row.vesselId), parseDocument(row.document)]));
  }
  async loadDocument(vesselId: string) { return (await this.loadMany([vesselId]))[vesselId] || null; }

  async claimLease(vesselId: string, actor: { holderId: string; holderLabel: string }, ttlSeconds = 75): Promise<ItineraryLeaseClaimResult> {
    const value = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_claim_office_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: vesselId, p_holder_session: actor.holderId,
      p_holder_label: actor.holderLabel, p_ttl_seconds: ttlSeconds,
    });
    return value.ok === true
      ? { ok: true, lease: leaseFrom(value, this.config.workspaceKey, vesselId, actor.holderId, actor.holderLabel) }
      : { ok: false, code: 'locked', holderLabel: String(value.holderLabel || '另一個使用者'), expiresAt: String(value.expiresAt || '') };
  }

  async renewLease(lease: ItineraryLease, ttlSeconds = 75): Promise<ItineraryLeaseRenewResult> {
    const value = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_renew_office_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: lease.vesselId, p_lease_id: lease.leaseId,
      p_holder_session: lease.holderId, p_fencing_token: lease.fence, p_ttl_seconds: ttlSeconds,
    });
    return value.ok === true ? { ok: true, lease: leaseFrom(value, this.config.workspaceKey, lease.vesselId, lease.holderId, lease.holderLabel) } : { ok: false, code: 'lease-expired' };
  }

  async releaseLease(lease: ItineraryLease): Promise<boolean> {
    return rpc<boolean>(this.client, 'sd_itinerary_release_office_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: lease.vesselId, p_lease_id: lease.leaseId,
      p_holder_session: lease.holderId, p_fencing_token: lease.fence,
    });
  }

  async save(input: ItinerarySaveInput): Promise<ItinerarySaveResult> {
    const args = {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: input.document.vesselId,
      p_expected_revision: input.expectedRevision, p_operation_id: input.operationId,
      p_rows: input.document.rows, p_lease_id: input.lease.leaseId,
      p_holder_session: input.lease.holderId, p_fencing_token: input.lease.fence,
      p_actor_label: input.actorLabel,
    };
    try {
      const result = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_save_office', args);
      const document = parseDocument(result.document);
      if (!document) throw new Error('保存回應缺少文件。');
      return { ok: true, document, replayed: result.replayed === true };
    } catch (error) {
      try {
        const status = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_operation_status_office', {
          p_workspace_key: this.config.workspaceKey, p_operation_id: input.operationId,
        });
        const recovered = parseDocument(status.document);
        if (recovered) return { ok: true, document: recovered, replayed: true };
      } catch { /* preserve the original failure */ }
      return saveFailure(error);
    }
  }
}

export class PublicItineraryCloudRepository {
  readonly config: ResolvedSupabaseConfig;
  readonly client: SupabaseClient;
  readonly actorKey: string;

  constructor(config: ResolvedSupabaseConfig = requiredConfig(), client: SupabaseClient | null = getSupabaseClient(config), actorKey = '') {
    if (!client) throw new Error('Itinerary public client is unavailable.');
    if (!actorKey.trim()) throw new Error('Itinerary public browser identity is unavailable.');
    this.config = config;
    this.client = client;
    this.actorKey = actorKey;
  }

  async listVessels(): Promise<PublicItineraryVessel[]> {
    const values = await rpc<Array<Record<string, unknown>>>(this.client, 'sd_itinerary_public_list_vessels', { p_workspace_key: this.config.workspaceKey });
    return values.map(value => ({ id: String(value.id), name: String(value.name), shortName: String(value.shortName || ''), fullName: String(value.fullName || '') }));
  }
  async loadDocument(vesselId: string) {
    return parseDocument(await rpc(this.client, 'sd_itinerary_public_load', { p_workspace_key: this.config.workspaceKey, p_vessel_id: vesselId }));
  }
  async claimLease(vesselId: string, holderId: string, ttlSeconds = 75): Promise<ItineraryLeaseClaimResult> {
    const value = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_claim_public_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: vesselId, p_actor_key: this.actorKey, p_holder_session: holderId, p_ttl_seconds: ttlSeconds,
    });
    return value.ok === true ? { ok: true, lease: leaseFrom(value, this.config.workspaceKey, vesselId, holderId, '船端使用者') }
      : { ok: false, code: 'locked', holderLabel: String(value.holderLabel || '另一個使用者'), expiresAt: String(value.expiresAt || '') };
  }
  async renewLease(lease: ItineraryLease, ttlSeconds = 75): Promise<ItineraryLeaseRenewResult> {
    const value = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_renew_public_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: lease.vesselId, p_lease_id: lease.leaseId,
      p_actor_key: this.actorKey, p_holder_session: lease.holderId, p_fencing_token: lease.fence, p_ttl_seconds: ttlSeconds,
    });
    return value.ok === true ? { ok: true, lease: leaseFrom(value, this.config.workspaceKey, lease.vesselId, lease.holderId, lease.holderLabel) } : { ok: false, code: 'lease-expired' };
  }
  async releaseLease(lease: ItineraryLease): Promise<boolean> {
    return rpc<boolean>(this.client, 'sd_itinerary_release_public_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: lease.vesselId, p_lease_id: lease.leaseId,
      p_actor_key: this.actorKey, p_holder_session: lease.holderId, p_fencing_token: lease.fence,
    });
  }
  async save(input: ItinerarySaveInput): Promise<ItinerarySaveResult> {
    const args = {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: input.document.vesselId,
      p_expected_revision: input.expectedRevision, p_operation_id: input.operationId,
      p_rows: input.document.rows, p_lease_id: input.lease.leaseId,
      p_actor_key: this.actorKey, p_holder_session: input.lease.holderId, p_fencing_token: input.lease.fence,
    };
    try {
      const result = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_save_public', args);
      const document = parseDocument(result.document);
      if (!document) throw new Error('保存回應缺少文件。');
      return { ok: true, document, replayed: result.replayed === true };
    } catch (error) {
      try {
        const status = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_operation_status_public', {
          p_workspace_key: this.config.workspaceKey, p_operation_id: input.operationId, p_actor_key: this.actorKey,
        });
        const recovered = parseDocument(status.document);
        if (recovered) return { ok: true, document: recovered, replayed: true };
      } catch { /* preserve the original failure */ }
      return saveFailure(error);
    }
  }
}
