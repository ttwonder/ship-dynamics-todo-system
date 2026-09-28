import type { TrackingKind } from './trackingTypes';

export const TRACKING_REQUEST_TYPES = [
  { value: 'repair', label: '維修工程', kind: 'engineering' },
  { value: 'drydock', label: '塢修工程', kind: 'engineering' },
  { value: 'annual-inspection', label: '年檢工程', kind: 'engineering' },
  { value: 'semiannual-materials', label: '半年物料', kind: 'supply' },
  { value: 'temporary-materials', label: '臨時物料', kind: 'supply' },
  { value: 'spares', label: '備件', kind: 'supply' },
  { value: 'drydock-spares', label: '塢修備件', kind: 'supply' },
  { value: 'drydock-materials', label: '塢修物料', kind: 'supply' },
] as const;
export type TrackingRequestType = typeof TRACKING_REQUEST_TYPES[number]['value'];
export const trackingRequestKind = (value: TrackingRequestType): TrackingKind => TRACKING_REQUEST_TYPES.find(option => option.value === value)!.kind;
export const trackingRequestTypeLabel = (value: unknown): string => TRACKING_REQUEST_TYPES.find(option => option.value === value)?.label || '';
export const parseTrackingRequestType = (value: string): TrackingRequestType | undefined => TRACKING_REQUEST_TYPES.find(option => option.value === value || option.label === value)?.value;
