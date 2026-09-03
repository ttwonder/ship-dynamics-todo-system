import type { Vessel } from '../types';
import { instantToWallTime } from './itineraryTime';
import { firstItineraryRow, resolveItineraryTimeZone, type ItineraryDocument, type ItineraryRow, type ItineraryTimeField } from './itineraryTypes';

export type ItineraryOperationalFeedStatus = 'loading' | 'ready' | 'missing' | 'stale' | 'error';

export interface ItineraryOperationalValues {
  previousPortName: string;
  portDockName: string;
  etaUtc: string | null;
  etaTimeZone: string;
  etaSchedule?: string;
  etbUtc: string | null;
  etbTimeZone: string;
  etbSchedule?: string;
  etdUtc: string | null;
  etdTimeZone: string;
  etdSchedule?: string;
  cargoQuantityText: string;
}

export interface ItineraryOperationalProjection {
  source: 'itinerary';
  vesselId: string;
  revision: number;
  updatedAt: string | null;
  rowId: string;
  values: ItineraryOperationalValues;
}

export interface ItineraryOperationalFeedRecord {
  status: ItineraryOperationalFeedStatus;
  document: ItineraryDocument | null;
  checkedAt: string | null;
  error?: string;
}

export type ItineraryOperationalSnapshotEntry =
  | Omit<ItineraryOperationalProjection, 'source' | 'vesselId'> & { source: 'itinerary' }
  | { source: 'legacy' };

export interface ItineraryProjectionSnapshot {
  schemaVersion: 2;
  projectionCapturedAt: string;
  itineraryProjections: Record<string, ItineraryOperationalSnapshotEntry>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function itineraryOperationalScheduleValue(instant: string | null | undefined, timeZone: string | null | undefined): string {
  if (!instant || !timeZone) return '';
  const wall = instantToWallTime(instant, timeZone);
  return wall.ok ? `${wall.date}T${wall.time}` : '';
}

function scheduleValue(row: ItineraryRow, field: ItineraryTimeField): { instant: string | null; timeZone: string; schedule: string } {
  const instant = text(row[field]) || null;
  const timeZone = resolveItineraryTimeZone(row, field).trim();
  return { instant, timeZone, schedule: itineraryOperationalScheduleValue(instant,timeZone) };
}

export function projectItineraryOperationalDocument(document: ItineraryDocument): ItineraryOperationalProjection | null {
  const row = firstItineraryRow(document);
  if (!row) return null;
  const eta = scheduleValue(row, 'etaUtc');
  const etb = scheduleValue(row, 'etbUtc');
  const etd = scheduleValue(row, 'etdUtc');
  return {
    source: 'itinerary',
    vesselId: document.vesselId,
    revision: document.revision,
    updatedAt: document.updatedAt,
    rowId: row.rowId,
    values: {
      previousPortName: text(row.previousPortName),
      portDockName: text(row.portDockName),
      etaUtc: eta.instant,
      etaTimeZone: eta.timeZone,
      etaSchedule: eta.schedule,
      etbUtc: etb.instant,
      etbTimeZone: etb.timeZone,
      etbSchedule: etb.schedule,
      etdUtc: etd.instant,
      etdTimeZone: etd.timeZone,
      etdSchedule: etd.schedule,
      cargoQuantityText: text(row.cargoQuantityText),
    },
  };
}

function documentBytes(document: ItineraryDocument): string {
  return JSON.stringify(document);
}

export function mergeItineraryOperationalRecord(
  current: ItineraryOperationalFeedRecord | undefined,
  incoming: ItineraryDocument | null,
  checkedAt: string,
): ItineraryOperationalFeedRecord {
  if (!incoming) {
    if (current?.document) return { ...current, status: 'stale', checkedAt, error: '雲端回應遺失先前已確認的 Itinerary 文件。' };
    return { status: 'missing', document: null, checkedAt };
  }
  if (!current?.document) return { status: 'ready', document: incoming, checkedAt };
  if (current.document.vesselId !== incoming.vesselId) {
    return { ...current, status: 'stale', checkedAt, error: 'Itinerary 船舶識別不一致。' };
  }
  if (incoming.revision > current.document.revision) return { status: 'ready', document: incoming, checkedAt };
  if (incoming.revision < current.document.revision) {
    return { ...current, status: 'stale', checkedAt, error: '雲端 Itinerary revision 低於目前已確認版本。' };
  }
  if (documentBytes(incoming) !== documentBytes(current.document)) {
    return { ...current, status: 'stale', checkedAt, error: '相同 Itinerary revision 回傳不同內容。' };
  }
  return { status: 'ready', document: current.document, checkedAt };
}

export function markItineraryOperationalRecordError(
  current: ItineraryOperationalFeedRecord | undefined,
  error: string,
): ItineraryOperationalFeedRecord {
  return current?.document
    ? { ...current, status: 'stale', error }
    : { status: 'error', document: null, checkedAt: current?.checkedAt || null, error };
}

export function applyItineraryOperationalProjection(vessel: Vessel, projection: ItineraryOperationalProjection): Vessel {
  const next = structuredClone(vessel);
  const values = projection.values;
  next.position.lastPort = values.previousPortName;
  next.position.nextPort = values.portDockName;
  next.position.eta = values.etaSchedule ?? itineraryOperationalScheduleValue(values.etaUtc,values.etaTimeZone);
  next.position.etb = values.etbSchedule ?? itineraryOperationalScheduleValue(values.etbUtc,values.etbTimeZone);
  next.position.etd = values.etdSchedule ?? itineraryOperationalScheduleValue(values.etdUtc,values.etdTimeZone);
  if (projection.updatedAt) next.position.updatedAt = projection.updatedAt;
  next.cargo.name = values.cargoQuantityText;
  next.cargo.quantity = '';
  next.cargo.items = values.cargoQuantityText
    ? values.cargoQuantityText.split(/\r?\n/).filter(line=>line.trim()).map(line=>({ name: line, quantity: '' }))
    : [];
  if (projection.updatedAt) next.cargo.updatedAt = projection.updatedAt;
  return next;
}

export function resolveVesselWithItineraryProjection(
  vessel: Vessel,
  record: ItineraryOperationalFeedRecord | undefined,
): Vessel {
  if (!record?.document) return vessel;
  const projection = projectItineraryOperationalDocument(record.document);
  return projection ? applyItineraryOperationalProjection(vessel, projection) : vessel;
}

export function buildItineraryProjectionSnapshot(
  vessels: readonly Vessel[],
  records: Record<string, ItineraryOperationalFeedRecord>,
  capturedAt: string,
): ItineraryProjectionSnapshot {
  const itineraryProjections: Record<string, ItineraryOperationalSnapshotEntry> = {};
  for (const vessel of vessels) {
    const record = records[vessel.id];
    if (!record || (record.status !== 'ready' && record.status !== 'missing')) {
      throw new Error(`尚未取得可信的 Itinerary：${vessel.name || vessel.id}`);
    }
    if (record.status === 'missing') {
      itineraryProjections[vessel.id] = { source: 'legacy' };
      continue;
    }
    const projection = record.document ? projectItineraryOperationalDocument(record.document) : null;
    if (!projection) throw new Error(`尚未取得可信的 Itinerary：${vessel.name || vessel.id}`);
    itineraryProjections[vessel.id] = {
      source: 'itinerary',
      revision: projection.revision,
      updatedAt: projection.updatedAt,
      rowId: projection.rowId,
      values: projection.values,
    };
  }
  return { schemaVersion: 2, projectionCapturedAt: capturedAt, itineraryProjections };
}

export function applyItineraryProjectionSnapshot(
  vessels: readonly Vessel[],
  entries: Record<string, ItineraryOperationalSnapshotEntry> | null | undefined,
): Vessel[] {
  if (!entries) return vessels.map(vessel => structuredClone(vessel));
  return vessels.map(vessel => {
    const entry = entries[vessel.id];
    if (!entry || entry.source === 'legacy') return structuredClone(vessel);
    return applyItineraryOperationalProjection(vessel, {
      source: 'itinerary', vesselId: vessel.id, revision: entry.revision,
      updatedAt: entry.updatedAt, rowId: entry.rowId, values: entry.values,
    });
  });
}

export function itineraryOperationalSourceLabel(record: ItineraryOperationalFeedRecord | undefined): string {
  if (!record || record.status === 'loading') return '行程同步中';
  if (record.status === 'missing') return '船卡資料';
  if (record.status === 'stale') return '行程資料過期';
  if (record.status === 'error') return '行程讀取失敗';
  return 'Itinerary';
}
