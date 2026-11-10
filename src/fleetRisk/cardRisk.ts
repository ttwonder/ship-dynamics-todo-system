import type {VesselNameSource} from '../vesselDisplay';
import {formatRiskTime,mostRecentScheduledAt,riskLabels,type FleetRiskRow,type FleetRiskSnapshot,type FleetRiskState} from './model';

/** The vessel catalog has no IMO field. Require a unique exact English full name
 * on both sides, then retain the validated official row/IMO. Never fuzzy-match
 * Chinese names, short aliases or partial text; ambiguity is unknown, not low risk.
 */
export function fleetRiskRowsByVessel(vessels:VesselNameSource[],snapshot:FleetRiskSnapshot|null):Map<string,FleetRiskRow> {
  const result=new Map<string,FleetRiskRow>();
  if(!snapshot)return result;
  const key=(name:string|undefined)=>name?.trim().toUpperCase()||'';
  const names=new Map<string,number>(),ids=new Map<string,number>(),rows=new Map<string,FleetRiskRow[]>();
  for(const vessel of vessels){const name=key(vessel.fullName);names.set(name,(names.get(name)||0)+1);if(vessel.id)ids.set(vessel.id,(ids.get(vessel.id)||0)+1);}
  for(const row of snapshot.rows){const name=key(row.name);rows.set(name,[...(rows.get(name)||[]),row]);}
  for(const vessel of vessels){
    const name=key(vessel.fullName),matches=rows.get(name);
    if(vessel.id&&ids.get(vessel.id)===1&&name&&names.get(name)===1&&matches?.length===1)result.set(vessel.id,matches[0]);
  }
  return result;
}

export function fleetRiskCardNotice(state:FleetRiskState|null,error:string,loading:boolean):string {
  if(error)return '讀取失敗';
  if(state?.attempt?.status==='running')return '更新中';
  if(state?.attempt?.status==='failed')return '更新失敗';
  if(state?.snapshot&&Date.parse(state.snapshot.queryStartedAt)<Date.parse(mostRecentScheduledAt(state.serverTime)))return '待更新';
  return !state&&loading?'讀取中':'';
}
export function fleetRiskCardDescription(row:FleetRiskRow|undefined,notice:string):string {
  const value=row?`Tokyo MOU：${riskLabels[row.risk]}｜IMO ${row.imo}｜取得：${formatRiskTime(row.retrievedAt)}（台北）`:'Tokyo MOU：未取得或無法唯一確認船舶對應；不代表低風險';
  return `${value}${notice?`｜${notice}${row?'，保留上次成功資料':''}`:''}。點擊查看船隊風險清單。`;
}
