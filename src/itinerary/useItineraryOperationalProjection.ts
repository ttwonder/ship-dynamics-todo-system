import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseConfig } from '../cloud';
import { OfficeItineraryCloudRepository, type ItineraryMainActor } from './itineraryCloud';
import type { ItineraryDocument } from './itineraryTypes';
import {
  markItineraryOperationalRecordError,
  mergeItineraryOperationalRecord,
  type ItineraryOperationalFeedRecord,
} from './itineraryOperationalProjection';

export interface ItineraryOperationalRefreshResult {
  capturedAt: string;
  records: Record<string, ItineraryOperationalFeedRecord>;
}

export interface ItineraryOperationalFeed {
  backend: OfficeItineraryCloudRepository | null;
  records: Record<string, ItineraryOperationalFeedRecord>;
  refresh: (vesselIds?: readonly string[]) => Promise<ItineraryOperationalRefreshResult>;
  publishConfirmed: (document: ItineraryDocument) => void;
}

interface UseItineraryOperationalProjectionInput {
  actor: ItineraryMainActor | null;
  vesselIds: readonly string[];
  enabled: boolean;
}

function uniqueVesselIds(vesselIds: readonly string[]): string[] {
  return [...new Set(vesselIds.map(id => id.trim()).filter(Boolean))].sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Itinerary 雲端讀取失敗。';
}

export function useItineraryOperationalProjection({ actor, vesselIds, enabled }: UseItineraryOperationalProjectionInput): ItineraryOperationalFeed {
  const vesselKey = uniqueVesselIds(vesselIds).join('\u0000');
  const ids = useMemo(() => vesselKey ? vesselKey.split('\u0000') : [], [vesselKey]);
  const config = typeof window === 'undefined' ? null : getSupabaseConfig();
  const configKey = config ? `${config.supabaseUrl}\u0000${config.workspaceKey}\u0000${config.tableName}` : '';
  const identityKey=`${enabled?'enabled':'disabled'}\u0000${actor?.userId||''}\u0000${configKey}\u0000${vesselKey}`;
  const identityVersionRef=useRef({key:identityKey,version:0});
  if(identityVersionRef.current.key!==identityKey){
    identityVersionRef.current={key:identityKey,version:identityVersionRef.current.version+1};
  }
  const identityVersion=identityVersionRef.current.version;
  const backendState = useMemo(() => {
    if (!enabled || !actor || !config) return { backend: null as OfficeItineraryCloudRepository | null, error: '' };
    try { return { backend: new OfficeItineraryCloudRepository(actor, config), error: '' }; }
    catch (error) { return { backend: null as OfficeItineraryCloudRepository | null, error: errorMessage(error) }; }
  }, [enabled, actor?.userId, configKey]);
  const [records, setRecords] = useState<Record<string, ItineraryOperationalFeedRecord>>({});
  const recordsRef = useRef(records);
  const generationRef = useRef(0);
  const activeIdsRef = useRef(new Set(ids));
  recordsRef.current = records;
  activeIdsRef.current = new Set(ids);

  const publish = useCallback((next: Record<string, ItineraryOperationalFeedRecord>) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const refresh = useCallback(async (requestedIds?: readonly string[]): Promise<ItineraryOperationalRefreshResult> => {
    const selectedIds = uniqueVesselIds(requestedIds || ids).filter(id => activeIdsRef.current.has(id));
    const capturedAt = new Date().toISOString();
    if(identityVersionRef.current.version!==identityVersion)throw new Error('Itinerary 身份、工作區或船舶範圍已變更，已丟棄舊讀取要求。');
    if (!selectedIds.length) return { capturedAt, records: {} };
    const backend = backendState.backend;
    if (!backend) {
      const message = backendState.error || 'Itinerary 雲端連線不可用。';
      const next = { ...recordsRef.current };
      selectedIds.forEach(id => { next[id] = markItineraryOperationalRecordError(next[id], message); });
      publish(next);
      throw new Error(message);
    }
    const generation = generationRef.current;
    try {
      const loaded = await backend.loadMany(selectedIds);
      if (generation !== generationRef.current || identityVersionRef.current.version!==identityVersion) throw new Error('Itinerary 身份、工作區或船舶範圍已變更，已丟棄舊讀取結果。');
      const checkedAt = new Date().toISOString();
      const next = { ...recordsRef.current };
      selectedIds.forEach(id => { next[id] = mergeItineraryOperationalRecord(next[id], loaded[id] ?? null, checkedAt); });
      publish(next);
      return { capturedAt: checkedAt, records: Object.fromEntries(selectedIds.map(id => [id, next[id]])) };
    } catch (error) {
      if (generation !== generationRef.current || identityVersionRef.current.version!==identityVersion) throw error;
      const message = errorMessage(error);
      const next = { ...recordsRef.current };
      selectedIds.forEach(id => { next[id] = markItineraryOperationalRecordError(next[id], message); });
      publish(next);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [backendState.backend, backendState.error, identityVersion, ids, publish]);

  const publishConfirmed = useCallback((document: ItineraryDocument) => {
    if(identityVersionRef.current.version!==identityVersion)return;
    if (!activeIdsRef.current.has(document.vesselId)) return;
    const checkedAt = new Date().toISOString();
    const next = { ...recordsRef.current };
    next[document.vesselId] = mergeItineraryOperationalRecord(next[document.vesselId], document, checkedAt);
    publish(next);
  }, [identityVersion,publish]);

  useEffect(() => {
    generationRef.current += 1;
    const initial = Object.fromEntries(ids.map(id => [id, {
      status: 'loading' as const, document: null, checkedAt: null,
    }]));
    publish(initial);
    if (!enabled || !ids.length) return;
    void refresh().catch(() => undefined);
    const poll = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined);
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      generationRef.current += 1;
      window.clearInterval(poll);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled, actor?.userId, configKey, vesselKey, publish, refresh]);

  return { backend: backendState.backend, records, refresh, publishConfirmed };
}
