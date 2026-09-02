import { getSupabaseClient, getSupabaseConfig, type ResolvedSupabaseConfig } from '../cloud';
import type { ItineraryLease, ItineraryLeaseClaimResult, ItineraryLeaseRenewResult, ItinerarySaveInput, ItinerarySaveResult } from './itineraryCollaboration';
import { normalizeInstant } from './itineraryTime';
import type { ItineraryDocument } from './itineraryTypes';
import { validateItineraryDocument } from './itineraryValidation';

export type ItineraryRpcClient = Pick<NonNullable<ReturnType<typeof getSupabaseClient>>, 'rpc'>;

export interface ItineraryMainActor {
  userId: string;
}

function mainActorArgs(actor: ItineraryMainActor): { p_actor_user_id: string } {
  if (!actor.userId.trim()) {
    throw new Error('Itinerary 主系統登入身份不存在。');
  }
  return { p_actor_user_id: actor.userId };
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

export class OfficeItineraryCloudRepository {
  readonly config: ResolvedSupabaseConfig;
  readonly client: ItineraryRpcClient;
  readonly actor: ItineraryMainActor;

  constructor(actor: ItineraryMainActor, config: ResolvedSupabaseConfig = requiredConfig(), client: ItineraryRpcClient | null = getSupabaseClient(config)) {
    if (!client) throw new Error('Itinerary 雲端 client 不可用。');
    mainActorArgs(actor);
    this.actor = actor;
    this.config = config;
    this.client = client;
  }

  private actorArgs() { return mainActorArgs(this.actor); }

  async loadMany(vesselIds: string[]): Promise<Record<string, ItineraryDocument | null>> {
    const rows = await rpc<Array<Record<string, unknown>>>(this.client, 'sd_itinerary_main_load_many', {
      p_workspace_key: this.config.workspaceKey, p_vessel_ids: vesselIds, ...this.actorArgs(),
    });
    return Object.fromEntries(rows.map(row => [String(row.vesselId), parseDocument(row.document)]));
  }
  async loadDocument(vesselId: string) { return (await this.loadMany([vesselId]))[vesselId] || null; }

  async claimLease(vesselId: string, actor: { holderId: string; holderLabel: string }, ttlSeconds = 75): Promise<ItineraryLeaseClaimResult> {
    const value = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_main_claim_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: vesselId, p_holder_session: actor.holderId,
      p_holder_label: actor.holderLabel, p_ttl_seconds: ttlSeconds, ...this.actorArgs(),
    });
    return value.ok === true
      ? { ok: true, lease: leaseFrom(value, this.config.workspaceKey, vesselId, actor.holderId, actor.holderLabel) }
      : { ok: false, code: 'locked', holderLabel: String(value.holderLabel || '另一個使用者'), expiresAt: String(value.expiresAt || '') };
  }

  async renewLease(lease: ItineraryLease, ttlSeconds = 75): Promise<ItineraryLeaseRenewResult> {
    const value = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_main_renew_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: lease.vesselId, p_lease_id: lease.leaseId,
      p_holder_session: lease.holderId, p_fencing_token: lease.fence, p_ttl_seconds: ttlSeconds, ...this.actorArgs(),
    });
    return value.ok === true ? { ok: true, lease: leaseFrom(value, this.config.workspaceKey, lease.vesselId, lease.holderId, lease.holderLabel) } : { ok: false, code: 'lease-expired' };
  }

  async releaseLease(lease: ItineraryLease): Promise<boolean> {
    return rpc<boolean>(this.client, 'sd_itinerary_main_release_lease', {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: lease.vesselId, p_lease_id: lease.leaseId,
      p_holder_session: lease.holderId, p_fencing_token: lease.fence, ...this.actorArgs(),
    });
  }

  async save(input: ItinerarySaveInput): Promise<ItinerarySaveResult> {
    const args = {
      p_workspace_key: this.config.workspaceKey, p_vessel_id: input.document.vesselId,
      p_expected_revision: input.expectedRevision, p_operation_id: input.operationId,
      p_rows: input.document.rows, p_lease_id: input.lease.leaseId,
      p_holder_session: input.lease.holderId, p_fencing_token: input.lease.fence,
      p_actor_label: input.actorLabel, ...this.actorArgs(),
    };
    try {
      const result = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_main_save', args);
      const document = parseDocument(result.document);
      if (!document) throw new Error('保存回應缺少文件。');
      return { ok: true, document, replayed: result.replayed === true };
    } catch (error) {
      try {
        const status = await rpc<Record<string, unknown>>(this.client, 'sd_itinerary_main_operation_status', {
          p_workspace_key: this.config.workspaceKey, p_operation_id: input.operationId, ...this.actorArgs(),
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
  readonly client: ItineraryRpcClient;
  readonly actorKey: string;

  constructor(config: ResolvedSupabaseConfig = requiredConfig(), client: ItineraryRpcClient | null = getSupabaseClient(config), actorKey = '') {
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
