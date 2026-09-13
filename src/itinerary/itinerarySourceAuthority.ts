import { authorityConfig, readBrowserAuthority, sameAuthority, parseBrowserAuthority, type BrowserAuthority } from '../cloudSourceAuthority';
import { OfficeItineraryCloudRepository } from './itineraryCloud';
import type { ItineraryLease, ItinerarySaveInput, ItinerarySavePreparationResult, ItinerarySaveResult } from './itineraryCollaboration';
import { usesRecordStorage } from '../cloudRecords';
import { pendingOperationForDocument } from './itineraryOperation';
import { validateItineraryDocument } from './itineraryValidation';
import { synchronizeShipAlternativeAnchors } from './shipItineraryModel';
import { normalizeInstant } from './itineraryTime';

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

// Original main-session only. Raw connection/actor identity is never replaced.
// The shared formal store and public/office-login repositories are unchanged.
export class MainSessionItineraryRepository extends OfficeItineraryCloudRepository {
  private readonly bases = new Map<string, { revision: number; authority: BrowserAuthority }>();

  private bound(authority?: BrowserAuthority) {
    if (!authority) return new OfficeItineraryCloudRepository(this.actor, this.config, this.client);
    const checked = parseBrowserAuthority({ ...authority, source: authority.managed ? authority.source : null }, this.config);
    if (!sameAuthority(checked, authority)) throw new Error('browser-authority-invalid-response');
    return new OfficeItineraryCloudRepository(this.actor, authorityConfig(this.config, checked), this.client);
  }

  async loadMany(vesselIds: string[]) {
    const authority = await readBrowserAuthority(this.config);
    const documents = await this.bound(authority).loadMany(vesselIds);
    if (!sameAuthority(authority, await readBrowserAuthority(this.config))) throw new Error('browser-authority-changed');
    for (const id of vesselIds) this.bases.set(id, { revision: documents[id]?.revision || 0, authority });
    return documents;
  }

  async claimLease(vesselId: string, actor: { holderId: string; holderLabel: string }, ttlSeconds = 75) {
    const authority = await readBrowserAuthority(this.config);
    if (!authority.admitted) throw new Error('browser-authority-not-admitted');
    const result = await this.bound(authority).claimLease(vesselId, actor, ttlSeconds);
    if (result.ok) return { ...result, lease: { ...result.lease, sourceAuthority: authority } };
    return result;
  }

  async renewLease(lease: ItineraryLease, ttlSeconds = 75) {
    const result = await this.bound(lease.sourceAuthority).renewLease(lease, ttlSeconds);
    return result.ok ? { ...result, lease: { ...result.lease, sourceAuthority: lease.sourceAuthority } } : result;
  }

  async releaseLease(lease: ItineraryLease) {
    return this.bound(lease.sourceAuthority).releaseLease(lease);
  }

  async prepareFreshSave(input: Pick<ItinerarySaveInput, 'document' | 'expectedRevision' | 'lease'>): Promise<ItinerarySavePreparationResult> {
    try {
      if (input.document.workspaceKey !== this.config.workspaceKey || input.lease.workspaceKey !== this.config.workspaceKey
        || input.lease.vesselId !== input.document.vesselId) return { ok: false, code: 'operation-mismatch' };
      const authority = await readBrowserAuthority(this.config);
      if (!authority.admitted) return { ok: false, code: 'unknown-outcome', notDispatched: true };
      const base = this.bases.get(input.document.vesselId);
      if (!base || base.revision !== input.expectedRevision) return { ok: false, code: 'revision-conflict', currentRevision: base?.revision };
      if (input.lease.sourceAuthority && sameAuthority(input.lease.sourceAuthority, authority) && sameAuthority(base.authority, authority)) {
        return { ok: true, lease: input.lease };
      }
      // Source changes do not create a new formal store. Verify the shared
      // revision and renew the very same physical lease; never claim a new one.
      const target = this.bound(authority);
      const current = await target.loadDocument(input.document.vesselId);
      if (!current || current.revision !== input.expectedRevision) return { ok: false, code: 'revision-conflict', currentRevision: current?.revision };
      const renewal = await target.renewLease(input.lease, 75);
      if (!renewal.ok) return renewal;
      if (renewal.lease.leaseId !== input.lease.leaseId || renewal.lease.holderId !== input.lease.holderId
        || renewal.lease.fence !== input.lease.fence) return { ok: false, code: 'lease-mismatch' };
      const latest = await readBrowserAuthority(this.config);
      if (!latest.admitted || !sameAuthority(authority, latest)) return { ok: false, code: 'unknown-outcome', notDispatched: true };
      this.bases.set(input.document.vesselId, { revision: current.revision, authority });
      return { ok: true, lease: { ...renewal.lease, sourceAuthority: authority } };
    } catch {
      return { ok: false, code: 'unknown-outcome', notDispatched: true };
    }
  }

  async recoverPending(input: Pick<ItinerarySaveInput, 'document' | 'expectedRevision' | 'operationId' | 'pendingOperation'>): Promise<ItinerarySaveResult> {
    if (!input.pendingOperation) return { ok: false, code: 'unknown-outcome' };
    try {
      const backend = this.bound(input.pendingOperation.sourceAuthority);
      // A persisted id/signature is not a complete replay command. Reconcile
      // on its captured route before admission/base/lease checks; never write
      // a reconstructed request when the original result remains unknown.
      const pending = input.pendingOperation;
      if (pending.id !== input.operationId || input.document.workspaceKey !== this.config.workspaceKey
        || pendingOperationForDocument(input.document, pending, () => '').id !== pending.id) {
        return { ok: false, code: 'operation-mismatch' };
      }
      const { data, error } = await backend.client.rpc(usesRecordStorage(backend.config) ? 'sd_itinerary_record_operation_status_v1' : 'sd_itinerary_main_operation_status', {
        p_workspace_key: this.config.workspaceKey, p_operation_id: pending.id, p_actor_user_id: this.actor.userId,
      });
      if (error || !data?.document || data.ok !== true) return { ok: false, code: 'unknown-outcome' };
      const raw = { ...data.document, updatedAt: data.document.updatedAt ? normalizeInstant(String(data.document.updatedAt)) : null,
        updatedActorKind: data.document.updatedActorKind === 'office' ? 'owner' : data.document.updatedActorKind === 'public' ? 'vessel' : data.document.updatedActorKind };
      const checked = validateItineraryDocument(raw);
      if (!checked.ok) return { ok: false, code: 'unknown-outcome' };
      const recovered = checked.value, intended = synchronizeShipAlternativeAnchors(input.document);
      if (recovered.workspaceKey !== this.config.workspaceKey || recovered.vesselId !== intended.vesselId
        || recovered.revision !== input.expectedRevision + 1
        || stableValue(recovered.rows) !== stableValue(intended.rows)
        || stableValue(recovered.alternativePlans) !== stableValue(intended.alternativePlans)) {
        return { ok: false, code: 'operation-mismatch' };
      }
      return { ok: true, document: recovered, replayed: true };
    } catch {
      return { ok: false, code: 'unknown-outcome', message: 'browser-authority-unavailable' };
    }
  }

  async save(input: ItinerarySaveInput): Promise<ItinerarySaveResult> {
    if (input.pendingOperation) return this.recoverPending(input);
    // An old pending id/signature has no source envelope. Retain its raw route;
    // never reinterpret it using a freshly acquired lease or today's authority.
    const authority = input.pendingOperation ? input.pendingOperation.sourceAuthority : input.lease.sourceAuthority;
    let dispatched = false;
    try {
      const backend = this.bound(authority);
      if (authority) {
        const latest = await readBrowserAuthority(this.config);
        const base = this.bases.get(input.document.vesselId);
        if (!latest.admitted || !sameAuthority(authority, latest)
          || !input.lease.sourceAuthority || !sameAuthority(authority, input.lease.sourceAuthority)
          || !base || base.revision !== input.expectedRevision || !sameAuthority(authority, base.authority)) {
          return { ok: false, code: 'unknown-outcome', message: 'browser-authority-continuity-unproven', notDispatched: true };
        }
      }
      // This immutable adapter captures both save and its same-operation status.
      dispatched = true;
      return await backend.save(input);
    } catch {
      return { ok: false, code: 'unknown-outcome', message: 'browser-authority-unavailable', ...(!dispatched ? { notDispatched: true as const } : {}) };
    }
  }
}
