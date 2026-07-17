import type { LoadStatus, NavigationStatus, Vessel, VesselCargoItem } from './types';

/**
 * 智慧船舶系統回傳的單船快照。
 *
 * TODO(SMART_SHIP_API): 待供應商提供 endpoint、鑑權方式、船舶識別碼與欄位單位後，
 * 在 SmartShipApiClient.fetchVesselSnapshot 的實作中接入。前端只使用此統一契約，避免
 * 將供應商欄位散落在看板、彈窗和報告中。實際 API key 不得寫入 GitHub Pages 前端。
 */
export interface SmartShipVesselSnapshot {
  externalVesselId: string;
  fetchedAt: string;
  location?: string;
  lastPort?: string;
  nextPort?: string;
  speedKnots?: number;
  navigationStatus?: NavigationStatus;
  loadStatus?: LoadStatus;
  eta?: string;
  etb?: string;
  etd?: string;
  cargoItems?: VesselCargoItem[];
}

export interface SmartShipApiClient {
  fetchVesselSnapshot(externalVesselId: string): Promise<SmartShipVesselSnapshot | null>;
}

/**
 * 將接口快照合併進既有船舶資料。沒有回傳的欄位保留手動值，因此接口同步與手動修改可並存。
 * 呼叫端應透過 App 的 commit 保存回傳值，繼續沿用既有稽核、revision CAS 與雲端保存流程。
 */
export function mergeSmartShipSnapshot(vessel: Vessel, snapshot: SmartShipVesselSnapshot): Vessel {
  const next: Vessel = JSON.parse(JSON.stringify(vessel));
  const position = next.position;
  if (snapshot.location !== undefined) position.location = snapshot.location;
  if (snapshot.lastPort !== undefined) position.lastPort = snapshot.lastPort;
  if (snapshot.nextPort !== undefined) position.nextPort = snapshot.nextPort;
  if (snapshot.speedKnots !== undefined) position.speedKnots = snapshot.speedKnots;
  if (snapshot.navigationStatus !== undefined) position.navigationStatus = snapshot.navigationStatus;
  if (snapshot.eta !== undefined) position.eta = snapshot.eta;
  if (snapshot.etb !== undefined) position.etb = snapshot.etb;
  if (snapshot.etd !== undefined) position.etd = snapshot.etd;
  position.source = 'smart-ship-api';
  position.updatedAt = snapshot.fetchedAt;

  if (snapshot.loadStatus !== undefined) next.cargo.loadStatus = snapshot.loadStatus;
  if (snapshot.cargoItems !== undefined) {
    next.cargo.items = snapshot.cargoItems.map(item => ({ ...item }));
    next.cargo.name = snapshot.cargoItems[0]?.name || '';
    next.cargo.quantity = snapshot.cargoItems[0]?.quantity || '';
  }
  if (snapshot.loadStatus !== undefined || snapshot.cargoItems !== undefined) {
    next.cargo.source = 'smart-ship-api';
    next.cargo.updatedAt = snapshot.fetchedAt;
  }
  next.updatedAt = snapshot.fetchedAt;
  return next;
}