import type { Vessel } from '../types';
import { recalculateItineraryRows } from './itineraryDomain';
import { addHoursToInstant, normalizeInstant } from './itineraryTime';
import { createBlankItineraryRow, createEmptyItineraryDocument, type ItineraryDocument } from './itineraryTypes';
import { itineraryVesselDisplayName } from './itineraryVesselDisplay';

export function createDemoItineraryDocument(vessel: Vessel, index: number, nowMs = Date.now()): ItineraryDocument {
  const document = createEmptyItineraryDocument({ workspaceKey: 'local-itinerary-demo', vesselId: vessel.id, vesselName: itineraryVesselDisplayName(vessel), rowId: `demo-${vessel.id}-1` });
  const first = document.rows[0];
  const calculationStartUtc = normalizeInstant(new Date(nowMs + index * 45 * 60 * 1000).toISOString()) || '2026-09-01T00:00:00Z';
  Object.assign(first, {
    voyageNumber: `V${String(index + 1).padStart(2, '0')}`,
    portDockName: vessel.position.lastPort || vessel.position.location || 'CURRENT PORT',
    operation: vessel.cargo.loadStatus === '非空載' || vessel.cargo.loadStatus === '滿載' ? 'To Unload' : 'To Load',
    cargoQuantityText: vessel.cargo.items.map(item => [item.name, item.quantity].filter(Boolean).join(' ')).join('\n') || 'TBA',
    calculationStartUtc,
    calculationStartTimeZone: 'UTC+8',
    etaMode: 'auto',
    berthWaitHours: 2,
    channelSailingHours: 1,
    preCompletionDelayHours: 1,
    postCompletionDelayHours: 6,
    operationQuantityMt: 5000 + index * 250,
    operationRateMtPerHour: 400,
    ldRateText: '400',
    departureBufferDays: null,
    arrivalDraftText: 'TBA',
    departureDraftText: 'TBA',
    arrivalRobText: 'TBA',
    departureRobText: 'TBA',
    portTimeZone: 'UTC+8',
    oceanDistanceNm: 180 + index * 8,
    speedKnots: 12,
  });

  const second = createBlankItineraryRow(`demo-${vessel.id}-2`, 1);
  Object.assign(second, {
    voyageNumber: `V${String(index + 2).padStart(2, '0')}`,
    portDockName: vessel.position.nextPort || 'NEXT PORT',
    operation: 'waiting order / repair',
    cargoQuantityText: first.cargoQuantityText,
    portTimeZone: index % 2 === 0 ? 'UTC+9' : 'UTC+5:30',
    berthWaitHours: 3,
    channelSailingHours: 0.75,
    preCompletionDelayHours: 0.5,
    postCompletionDelayHours: 4,
    etbTimeZone: 'UTC+8:45',
    operationQuantityMt: 4500 + index * 200,
    operationRateMtPerHour: 380,
    ldRateText: '380',
    departureBufferDays: null,
    oceanDistanceNm: 420 + index * 11,
    speedKnots: 12.5,
  });

  const third = createBlankItineraryRow(`demo-${vessel.id}-3`, 2);
  Object.assign(third, {
    voyageNumber: `V${String(index + 3).padStart(2, '0')}`,
    portDockName: 'TBA',
    operation: 'To Load / To Unload / docking / inspection',
    portTimeZone: 'UTC-6',
    berthWaitHours: 2,
    channelSailingHours: 1.5,
    preCompletionDelayHours: 2,
    postCompletionDelayHours: 6,
    operationQuantityMt: 6000,
    operationRateMtPerHour: 420,
    ldRateText: '420',
    departureBufferDays: null,
  });

  const result = recalculateItineraryRows([first, second, third]);
  document.rows = result.rows;
  document.revision = index + 1;
  document.updatedAt = addHoursToInstant(new Date(nowMs).toISOString(), -(index + 1) * 0.3);
  document.updatedActorKind = 'demo';
  document.updatedActorLabel = '本機測試資料';
  return document;
}

export function createDemoItineraryDocuments(vessels: readonly Vessel[], nowMs = Date.now()): Record<string, ItineraryDocument> {
  return Object.fromEntries(vessels.map((vessel, index) => [vessel.id, createDemoItineraryDocument(vessel, index, nowMs)]));
}
