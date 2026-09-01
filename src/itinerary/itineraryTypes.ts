export const ITINERARY_SCHEMA_VERSION = 1 as const;
export const ITINERARY_MAX_ROWS = 100;

export type ItineraryOperation = '' | 'To Load' | 'To Unload' | 'To Load / To Unload';
export type ItineraryOperationChoice = 'load' | 'unload';
export type ItineraryTimeMode = 'auto' | 'manual';

export function normalizeItineraryOperation(value: unknown): ItineraryOperation | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return '';
  const aliases: Record<string, ItineraryOperationChoice> = {
    'to load': 'load', loading: 'load', load: 'load', l: 'load',
    'to unload': 'unload', unloading: 'unload', unload: 'unload', discharging: 'unload', discharge: 'unload', u: 'unload',
  };
  const parts = raw.toLowerCase().split(/\s*(?:\/|,|&|\+|\band\b)\s*/).filter(Boolean);
  if (!parts.length) return null;
  const choices = new Set<ItineraryOperationChoice>();
  for (const part of parts) {
    const choice = aliases[part.trim().replace(/\s+/g, ' ')];
    if (!choice) return null;
    choices.add(choice);
  }
  if (choices.has('load') && choices.has('unload')) return 'To Load / To Unload';
  if (choices.has('load')) return 'To Load';
  if (choices.has('unload')) return 'To Unload';
  return '';
}

export function itineraryOperationSelected(value: unknown, choice: ItineraryOperationChoice): boolean {
  const normalized = normalizeItineraryOperation(value);
  return choice === 'load'
    ? normalized === 'To Load' || normalized === 'To Load / To Unload'
    : normalized === 'To Unload' || normalized === 'To Load / To Unload';
}

export function setItineraryOperationSelected(value: unknown, choice: ItineraryOperationChoice, selected: boolean): ItineraryOperation {
  let load = itineraryOperationSelected(value, 'load');
  let unload = itineraryOperationSelected(value, 'unload');
  if (choice === 'load') load = selected;
  else unload = selected;
  return load && unload ? 'To Load / To Unload' : load ? 'To Load' : unload ? 'To Unload' : '';
}

export function formatItineraryOperation(value: unknown): string {
  return normalizeItineraryOperation(value) || '';
}
export type ItineraryUpdatedActorKind = 'owner' | 'vessel' | 'demo';

export interface ItineraryRow {
  rowId: string;
  sortOrder: number;
  voyageNumber: string;
  portDockName: string;
  operation: ItineraryOperation;
  cargoQuantityText: string;
  etaUtc: string | null;
  etbUtc: string | null;
  ldRateText: string;
  etcUtc: string | null;
  etdUtc: string | null;
  arrivalDraftText: string;
  departureDraftText: string;
  arrivalRobText: string;
  departureRobText: string;
  portTimeZone: string;
  oceanDistanceNm: number | null;
  speedKnots: number | null;
  sailingHours: number | null;
  berthWaitHours: number | null;
  tanksText: string;
  operationQuantityMt: number | null;
  operationRateMtPerHour: number | null;
  operationHours: number | null;
  departureBufferDays: number | null;
  etaMode: ItineraryTimeMode;
  etbMode: ItineraryTimeMode;
  etcMode: ItineraryTimeMode;
  etdMode: ItineraryTimeMode;
}

export interface ItineraryDocument {
  schemaVersion: typeof ITINERARY_SCHEMA_VERSION;
  workspaceKey: string;
  vesselId: string;
  vesselName: string;
  revision: number;
  updatedAt: string | null;
  updatedActorKind: ItineraryUpdatedActorKind;
  updatedActorLabel: string;
  rows: ItineraryRow[];
}

export interface EmptyItineraryDocumentInput {
  workspaceKey: string;
  vesselId: string;
  vesselName: string;
  rowId?: string;
}

export function createItineraryId(prefix = 'itin'): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createItineraryOperationId(): string {
  const native = globalThis.crypto?.randomUUID?.();
  if (native) return native;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function createBlankItineraryRow(rowId = createItineraryId('row'), sortOrder = 0): ItineraryRow {
  return {
    rowId,
    sortOrder,
    voyageNumber: '',
    portDockName: '',
    operation: '',
    cargoQuantityText: '',
    etaUtc: null,
    etbUtc: null,
    ldRateText: '',
    etcUtc: null,
    etdUtc: null,
    arrivalDraftText: '',
    departureDraftText: '',
    arrivalRobText: '',
    departureRobText: '',
    portTimeZone: '',
    oceanDistanceNm: null,
    speedKnots: null,
    sailingHours: null,
    berthWaitHours: null,
    tanksText: '',
    operationQuantityMt: null,
    operationRateMtPerHour: null,
    operationHours: null,
    departureBufferDays: null,
    etaMode: 'auto',
    etbMode: 'auto',
    etcMode: 'auto',
    etdMode: 'auto',
  };
}

export function createEmptyItineraryDocument(input: EmptyItineraryDocumentInput): ItineraryDocument {
  return {
    schemaVersion: ITINERARY_SCHEMA_VERSION,
    workspaceKey: input.workspaceKey,
    vesselId: input.vesselId,
    vesselName: input.vesselName,
    revision: 0,
    updatedAt: null,
    updatedActorKind: 'demo',
    updatedActorLabel: '',
    rows: [createBlankItineraryRow(input.rowId, 0)],
  };
}
