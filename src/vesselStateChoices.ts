import type { LoadStatus, NavigationStatus, ShipStatus } from './types';

export const NAVIGATION_STATUSES: readonly NavigationStatus[] = ['航行', '拋錨', '進港中', '出港中', '停泊', '漂航'];
export const LOAD_STATUSES: readonly LoadStatus[] = ['空載', '非空載', '滿載'];
export const VESSEL_STATUSES: ShipStatus[] = ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar'];
export const shipStatusLabel = (status: ShipStatus): string => status === 'drydock/repiar' ? 'drydock/repair' : status;
