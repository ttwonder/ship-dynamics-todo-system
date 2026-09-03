export const ITINERARY_SCHEMA_VERSION = 1 as const;
export const ITINERARY_MAX_ROWS = 100;
export const ITINERARY_MAX_ALTERNATIVE_PLANS = 5;

export type ItineraryOperation = string;
export type ItineraryOperationChoice = 'load' | 'unload' | 'docking' | 'waiting-order' | 'repair' | 'inspection';
export type ItineraryTimeMode = 'auto' | 'manual';

export const ITINERARY_PURPOSE_OPTIONS: ReadonlyArray<{ choice: ItineraryOperationChoice; label: string }> = [
  { choice: 'load', label: 'To Load' },
  { choice: 'unload', label: 'To Unload' },
  { choice: 'docking', label: 'docking' },
  { choice: 'waiting-order', label: 'waiting order' },
  { choice: 'repair', label: 'repair' },
  { choice: 'inspection', label: 'inspection' },
];

const purposeAliases: Record<string, ItineraryOperationChoice> = {
  'to load': 'load', loading: 'load', load: 'load', l: 'load',
  'to unload': 'unload', unloading: 'unload', unload: 'unload', discharging: 'unload', discharge: 'unload', u: 'unload',
  docking: 'docking', dock: 'docking',
  'waiting order': 'waiting-order', 'waiting orders': 'waiting-order', 'waiting for order': 'waiting-order', 'waiting for orders': 'waiting-order',
  repair: 'repair', repairs: 'repair',
  inspection: 'inspection', inspections: 'inspection',
};

function itineraryOperationChoices(value: unknown): Set<ItineraryOperationChoice> | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return new Set();
  const parts = raw.toLowerCase().split(/\s*(?:\/|,|&|\+|\band\b)\s*/).filter(Boolean);
  if (!parts.length) return null;
  const choices = new Set<ItineraryOperationChoice>();
  for (const part of parts) {
    const choice = purposeAliases[part.trim().replace(/\s+/g, ' ')];
    if (!choice) return null;
    choices.add(choice);
  }
  return choices;
}

export function normalizeItineraryOperation(value: unknown): ItineraryOperation | null {
  const choices = itineraryOperationChoices(value);
  if (!choices) return null;
  return ITINERARY_PURPOSE_OPTIONS.filter(option => choices.has(option.choice)).map(option => option.label).join(' / ');
}

export function itineraryOperationSelected(value: unknown, choice: ItineraryOperationChoice): boolean {
  return itineraryOperationChoices(value)?.has(choice) || false;
}

export function setItineraryOperationSelected(value: unknown, choice: ItineraryOperationChoice, selected: boolean): ItineraryOperation {
  const choices = itineraryOperationChoices(value) || new Set<ItineraryOperationChoice>();
  if (selected) choices.add(choice);
  else choices.delete(choice);
  return ITINERARY_PURPOSE_OPTIONS.filter(option => choices.has(option.choice)).map(option => option.label).join(' / ');
}

export function formatItineraryOperation(value: unknown): string {
  return normalizeItineraryOperation(value) || '';
}
export type ItineraryUpdatedActorKind = 'owner' | 'vessel' | 'demo';

export interface ItineraryRow {
  rowId: string;
  sortOrder: number;
  /** Document-level metadata stored on the first sorted row for cloud compatibility. */
  previousPortName: string;
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
  notesText: string;
  portTimeZone: string;
  etaTimeZone: string;
  etbTimeZone: string;
  etcTimeZone: string;
  etdTimeZone: string;
  calculationStartUtc: string | null;
  calculationStartTimeZone: string;
  oceanDistanceNm: number | null;
  speedKnots: number | null;
  sailingHours: number | null;
  berthWaitHours: number | null;
  channelSailingHours: number | null;
  preCompletionDelayHours: number | null;
  postCompletionDelayHours: number | null;
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

export interface ItineraryAlternativePlan {
  planId: string;
  sortOrder: number;
  rows: ItineraryRow[];
}

export type ItineraryTimeField = 'etaUtc' | 'etbUtc' | 'etcUtc' | 'etdUtc';
export type ItineraryTimeZoneField = 'etaTimeZone' | 'etbTimeZone' | 'etcTimeZone' | 'etdTimeZone';

export const ITINERARY_TIME_ZONE_FIELDS: Record<ItineraryTimeField, ItineraryTimeZoneField> = {
  etaUtc: 'etaTimeZone', etbUtc: 'etbTimeZone', etcUtc: 'etcTimeZone', etdUtc: 'etdTimeZone',
};

export function resolveItineraryTimeZone(row: ItineraryRow, field: ItineraryTimeField): string {
  return row[ITINERARY_TIME_ZONE_FIELDS[field]] || row.portTimeZone;
}

export function firstItineraryRow(document: Pick<ItineraryDocument, 'rows'>): ItineraryRow | null {
  return [...document.rows].sort((left, right) => left.sortOrder - right.sortOrder || left.rowId.localeCompare(right.rowId))[0] || null;
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
  alternativePlans: ItineraryAlternativePlan[];
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
    previousPortName: '',
    voyageNumber: '',
    portDockName: '',
    operation: '',
    cargoQuantityText: '',
    etaUtc: null,
    etbUtc: null,
    ldRateText: '',
    etcUtc: null,
    etdUtc: null,
    arrivalDraftText: 'A:\nF:',
    departureDraftText: 'A:\nF:',
    arrivalRobText: '',
    departureRobText: '',
    notesText: '',
    portTimeZone: '',
    etaTimeZone: '',
    etbTimeZone: '',
    etcTimeZone: '',
    etdTimeZone: '',
    calculationStartUtc: null,
    calculationStartTimeZone: '',
    oceanDistanceNm: null,
    speedKnots: null,
    sailingHours: null,
    berthWaitHours: null,
    channelSailingHours: null,
    preCompletionDelayHours: null,
    postCompletionDelayHours: null,
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
    alternativePlans: [],
  };
}
