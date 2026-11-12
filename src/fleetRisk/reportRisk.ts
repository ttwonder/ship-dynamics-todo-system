import type {VesselNameSource} from '../vesselDisplay';
import {fleetRiskCardNotice,fleetRiskRowsByVessel} from './cardRisk';
import {formatRiskTime,type FleetRiskRow} from './model';
import type {FleetRiskReadResult} from './useFleetRisk';

/** Transient print projection only; never merged into vessel or historical records. */
export interface FleetRiskReportCapture {
  snapshotId?:string;
  queryCompletedAt?:string;
  rowsByVessel:Record<string,FleetRiskRow>;
  notice:string;
}
export function captureFleetRiskReport(vessels:VesselNameSource[],result:FleetRiskReadResult|null):FleetRiskReportCapture {
  const state=result?.state||null,snapshot=state?.snapshot||null;
  return structuredClone({snapshotId:snapshot?.id,queryCompletedAt:snapshot?.queryCompletedAt,
    rowsByVessel:Object.fromEntries(fleetRiskRowsByVessel(vessels,snapshot)),
    notice:fleetRiskCardNotice(state,result?.error||'',false)});
}
export function fleetRiskReportSource(capture:FleetRiskReportCapture|null|undefined,historical:boolean):string {
  const source=capture?.queryCompletedAt?`Tokyo MOU 風險：本次開啟時讀取的最新共享清單；清單取得完成時間：${formatRiskTime(capture.queryCompletedAt)}（台北）。`:'Tokyo MOU 風險：未取得可用清單；灰色未知不代表低風險。';
  return source+(historical?'非歷史報告當日風險。':'')+(capture?.notice?`${capture.notice}${capture.snapshotId?'，保留上次成功清單':''}。`:'');
}
