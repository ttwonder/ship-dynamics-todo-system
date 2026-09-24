import type { StatusLog } from '../types';

export type TrackingKind = 'supply' | 'engineering';
export type TrackingDeliveryStatus = 'not-delivered' | 'partially-delivered' | 'delivered';
export interface TrackingEvent {
  id: string;
  operationId: string;
  at: string;
  byUserId: string;
  entry: 'tracking' | 'internal-control' | 'task';
  action: 'close' | 'reopen' | 'correct-close-date' | 'delivery' | 'link' | 'invalidate-link';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}
export interface TrackingSource {
  fileName: string;
  sheetName: string;
  row: number;
  originalValues: Record<string, string | number | boolean | null>;
}
/** A source is one independently actionable row, never a reference-number group. */
export interface TrackingItem {
  id: string;
  kind: TrackingKind;
  vesselId: string;
  referenceNo: string;
  description: string;
  applicationDate: string;
  originalItemNo?: string;
  subitemNo?: string;
  urgency: 'normal' | 'urgent';
  urgentSubtypes?: string[];
  purchaseNos?: string;
  materialCategory?: string;
  preparationDate?: string;
  supplier?: string;
  estimatedSupplyDatePlace?: string;
  countersignDate?: string;
  contractor?: string;
  constructionPort?: string;
  completionDate?: string;
  originalRemarks?: string;
  supplementalNotes: string;
  progress: string;
  expectedDate: string;
  deliveryStatus: TrackingDeliveryStatus;
  actualDeliveryDate?: string;
  isClosed: boolean;
  closedDate?: string;
  closedBy?: string;
  closureOutcome?: 'completed' | 'cancelled';
  linkedCaseId?: string;
  linkState?: 'active' | 'invalid';
  source?: TrackingSource;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  statusLogs: StatusLog[];
  events?: TrackingEvent[];
}

/** Reads preserve every field and historical fact. Commands validate mutations. */
export function readTrackingItems(value: unknown): TrackingItem[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id
      || ids.has(item.id) || !['supply', 'engineering'].includes(item.kind)
      || typeof item.vesselId !== 'string' || !Array.isArray(item.statusLogs)) return null;
    ids.add(item.id);
  }
  return structuredClone(value) as TrackingItem[];
}
