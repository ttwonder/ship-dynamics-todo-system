export type RiskLevel = 'HRS' | 'SRS' | 'LRS';
export type RefreshTrigger = 'scheduled' | 'manual';
export interface FleetRiskRow {
  name:string; imo:string; retrievedAt:string; status:'ok'; risk:RiskLevel;
  priority:'Priority I'|'Priority II'|'No Priority';
  companyName:string; companyImo:string; windowFrom:string|null; windowTo:string|null;
  sourceUpdatedAt:null; sourceUrl:string;
}
export interface FleetRiskSnapshot {
  id:string; trigger:RefreshTrigger; company:{name:string;imo:string;performance:string};
  queryStartedAt:string; queryCompletedAt:string; rosterRetrievedAt:string; count:number;
  rows:FleetRiskRow[];
  coverage:{referenceCount:number;missingReferenceImos:string[];addedReferenceImos:string[]};
}
export interface FleetRiskAttempt {
  id:string; trigger:RefreshTrigger; status:'running'|'failed'|'success'; startedAt:string;
  completedAt:string|null; done:number; total:number; error:string|null;
}
export interface FleetRiskState {
  snapshot:FleetRiskSnapshot|null; attempt:FleetRiskAttempt|null; serverTime:string; nextScheduledAt:string;
}
const invalid=()=>{throw new Error('船隊風險資料格式或完整性不符，已保留原清單。');};
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:invalid();
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const text=(v:unknown,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const trigger=(v:unknown)=>v==='scheduled'||v==='manual';
export function validVesselImo(value:unknown):value is string {
  return typeof value==='string'&&/^\d{7}$/.test(value)&&[7,6,5,4,3,2].reduce((sum,w,i)=>sum+w*Number(value[i]),0)%10===Number(value[6]);
}
export function parseFleetRiskState(value:unknown):FleetRiskState {
  const v=record(value);
  if(!date(v.serverTime)||!date(v.nextScheduledAt))invalid();
  if(v.snapshot!==null){
    const s=record(v.snapshot),c=record(s.company),coverage=record(s.coverage);
    if(!uuid(s.id)||!trigger(s.trigger)||c.imo!=='0882415'||!text(c.name)||typeof c.performance!=='string'||!date(s.queryStartedAt)||!date(s.queryCompletedAt)||!date(s.rosterRetrievedAt))invalid();
    if(Date.parse(s.queryCompletedAt)<Date.parse(s.queryStartedAt)||!Number.isInteger(s.count)||s.count<1||s.count>100||!Array.isArray(s.rows)||s.count!==s.rows.length)invalid();
    if(!Number.isInteger(coverage.referenceCount)||!Array.isArray(coverage.missingReferenceImos)||coverage.missingReferenceImos.length||!Array.isArray(coverage.addedReferenceImos)||!coverage.addedReferenceImos.every(validVesselImo))invalid();
    const seen=new Set<string>();
    for(const input of s.rows){
      const r=record(input);
      if(!validVesselImo(r.imo)||seen.has(r.imo)||!text(r.name,80)||!r.name.startsWith('FPMC ')||r.status!=='ok'||!['HRS','SRS','LRS'].includes(r.risk)||!['Priority I','Priority II','No Priority'].includes(r.priority))invalid();
      if(!date(r.retrievedAt)||Date.parse(r.retrievedAt)<Date.parse(s.queryStartedAt)||Date.parse(r.retrievedAt)>Date.parse(s.queryCompletedAt)||!text(r.companyName)||!/^\d{7}$/.test(r.companyImo)||r.sourceUpdatedAt!==null||r.sourceUrl!=='https://apcis.tmou.org/public/')invalid();
      if(![r.windowFrom,r.windowTo].every(d=>d===null||text(d,32)))invalid();
      seen.add(r.imo);
    }
  }
  if(v.attempt!==null){
    const a=record(v.attempt);
    if(!uuid(a.id)||!trigger(a.trigger)||!['running','failed','success'].includes(a.status)||!date(a.startedAt)||(a.completedAt!==null&&!date(a.completedAt))||!Number.isInteger(a.done)||!Number.isInteger(a.total)||a.done<0||a.total<a.done||a.total>100||(a.error!==null&&typeof a.error!=='string'))invalid();
  }
  // Detached, validated snapshot: nothing writes to application vessel records.
  return JSON.parse(JSON.stringify(v)) as FleetRiskState;
}
export function riskSummary(snapshot:FleetRiskSnapshot):Record<RiskLevel,number>{
  return snapshot.rows.reduce((count,row)=>{count[row.risk]++;return count;},{HRS:0,SRS:0,LRS:0});
}
export function riskSortedRows(snapshot:FleetRiskSnapshot):FleetRiskRow[]{
  const order={HRS:0,SRS:1,LRS:2};
  return [...snapshot.rows].sort((a,b)=>order[a.risk]-order[b.risk]||a.name.localeCompare(b.name,'en',{numeric:true}));
}
/** Taipei has no DST. 07:00 Taipei is 23:00 UTC of the preceding date. */
export function mostRecentScheduledAt(now:string):string {
  const ms=Date.parse(now),day=86_400_000,anchor=23*3_600_000;
  return new Date(Math.floor((ms-anchor)/day)*day+anchor).toISOString();
}
export function formatRiskTime(value:string):string {
  return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value));
}
export const riskLabels:Record<RiskLevel,string>={HRS:'▲ 高風險 HRS',SRS:'◆ 標準風險 SRS',LRS:'● 低風險 LRS'};
