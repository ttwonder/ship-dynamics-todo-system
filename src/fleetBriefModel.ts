import type { FleetBriefReport } from './fleetBriefTypes';
import type { InternalControlCase, TaskItem, Vessel } from './types';
import { fleetRiskReportSource, type FleetRiskReportCapture } from './fleetRisk/reportRisk';
import { formatRiskTime } from './fleetRisk/model';
import { richTextToPlainText } from './richText';
import { taskVesselIds } from './taskVesselScope';
import { taskIsClosedForVessel } from './taskVesselProgress';
import { appearsInSingleVesselTasks } from './taskAttention';
import { itineraryOperationalScheduleValue, type ItineraryOperationalFeedRecord } from './itinerary/itineraryOperationalProjection';
import { resolveItineraryTimeZone, type ItineraryRow } from './itinerary/itineraryTypes';
import { formatScheduleDisplay } from './scheduleTime';
import { formatTaipeiDateTime } from './taipeiTime';
import { vesselSelectionDisplayName } from './vesselDisplay';
import { matchesBriefRegion, type BriefRegion } from './fleetBriefRegions';

/** Caller supplies already authorized inputs, captured together. The risk capture
 * may cover a wider roster for identity disambiguation; it is never enumerated. */
export interface FleetBriefInput {
  date: string;
  vessels: readonly Vessel[];
  tasks: readonly TaskItem[];
  internalControlCases: readonly InternalControlCase[];
  risk: FleetRiskReportCapture;
  itineraryRecords?: Record<string, ItineraryOperationalFeedRecord>;
  capturedAt: string;
}

type Section = FleetBriefReport['sections'][number];
type Column = Section['columns'][number];
const column = (label: string, kind: Column['kind']): Column => ({label, kind});
function section(title: string, ...columns: Column[]): Section {
  return {title, columns:[column('船舶','vessel'), ...columns], rows:[]};
}
const missing = '未提供';
const priorityOrder = ['急','高','中'];
const published = (createdAt:string) => /^\d{4}-\d\d-\d\d$/.test(createdAt) ? createdAt.replace(/-/g,'/') : formatTaipeiDateTime(createdAt,false,missing);

function openItems(input: FleetBriefInput, vessels: readonly Vessel[]): Section[] {
  const itemSection = (title: string, theme: 'control'|'task') => ({...section(title, column('關注程度','level'), column('發佈時間（台北）','published'), column('事項內容','content')),theme});
  const cases = itemSection('重點關注：未結內控（中／高／急）','control'), tasks = itemSection('重點關注：未結要事（中／高／急）','task');
  const names = new Map(vessels.map(v => [v.id,vesselSelectionDisplayName(v)]));
  const casesById = new Map<string,InternalControlCase>(), casesByTask = new Map<string,InternalControlCase[]>();
  for (const item of input.internalControlCases) {
    if (!names.has(item.vesselId) || casesById.has(item.id)) continue;
    casesById.set(item.id,item);
    if (item.linkedTaskId) casesByTask.set(item.linkedTaskId,[...(casesByTask.get(item.linkedTaskId) || []),item]);
    if (!item.isClosed && priorityOrder.includes(item.priority)) {
      cases.rows.push([names.get(item.vesselId)!, item.priority, published(item.createdAt), richTextToPlainText(item.description) || missing]);
    }
  }
  const seen = new Set<string>();
  for (const task of input.tasks) {
    if (seen.has(task.id) || !priorityOrder.includes(task.priority) || !appearsInSingleVesselTasks(task)) continue;
    seen.add(task.id);
    for (const id of taskVesselIds(task)) {
      const name = names.get(id);
      if (!name || taskIsClosedForVessel(task,id)) continue;
      // The authorized case owns its mirror on THIS vessel, even when closed or low priority.
      if ((task.internalControlCaseId && casesById.get(task.internalControlCaseId)?.vesselId === id)
        || casesByTask.get(task.id)?.some(item => item.vesselId === id)) continue;
      const target = task.isInternalControl ? cases : tasks;
      target.rows.push([name, task.priority, published(task.createdAt), richTextToPlainText(task.description) || missing]);
    }
  }
  for (const group of [cases,tasks]) group.rows.sort((a,b)=>priorityOrder.indexOf(a[1])-priorityOrder.indexOf(b[1]));
  return [cases,tasks];
}

interface Call { port: string; eta: string; etb: string; etd: string; note: string }
function formalCall(row?: ItineraryRow): Call | null {
  if (!row?.portDockName.trim()) return null;
  const time = (field: 'etaUtc' | 'etbUtc' | 'etdUtc') => {
    const zone = resolveItineraryTimeZone(row,field);
    const value = formatScheduleDisplay(itineraryOperationalScheduleValue(row[field],zone));
    return value ? `${value}（${zone}）` : '';
  };
  return {port:row.portDockName.trim(), eta:time('etaUtc'), etb:time('etbUtc'), etd:time('etdUtc'), note:row.notesText?.trim() || ''};
}

function routeAt(vessel: Vessel, record: ItineraryOperationalFeedRecord | undefined, capturedAt: string) {
  const pos = vessel.position, current = pos.location.trim();
  const key = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
  const isCurrentPort = (port: string) => ['停泊','拋錨','進港中','出港中'].includes(pos.navigationStatus)
    && !!current && !/^(?:TBA|TBD|UNKNOWN|AT SEA|待定|未提供|未知|[-—])$/i.test(current) && key(current) === key(port);
  const doc = record?.status === 'ready' && record.document?.vesselId === vessel.id ? record.document : null;
  const now = Date.parse(capturedAt);
  if (doc?.rows.length && Number.isFinite(now)) {
    // Same formal order and first-row ETD cutoff as projectItineraryOperationalDocument.
    const rows = [...doc.rows].sort((a,b)=>a.sortOrder-b.sortOrder || a.rowId.localeCompare(b.rowId));
    const departed = (row?: ItineraryRow) => !!row?.etdUtc && Date.parse(row.etdUtc) < now;
    const index = departed(rows[0]) ? 1 : 0;
    const active = !departed(rows[index]) ? formalCall(rows[index]) : null;
    const here = active && isCurrentPort(active.port) ? active : null;
    const next = here ? (!departed(rows[index+1]) ? formalCall(rows[index+1]) : null) : active;
    return {current,here,next};
  }
  // The card's schedule belongs to nextPort, NOT lastPort or an unrelated current position.
  const card = pos.nextPort.trim() ? {port:pos.nextPort.trim(), eta:formatScheduleDisplay(pos.eta),
    etb:formatScheduleDisplay(pos.etb), etd:formatScheduleDisplay(pos.etd), note:''} : null;
  const here = card && isCurrentPort(card.port) ? card : null;
  return {current,here,next:here ? null : card};
}

const regions: BriefRegion[] = ['波斯灣','澳洲','中國'];
function primarySection(title: string, dock = false): Section {
  return {title, rows:[], columns:[column('序','level'),column('船舶','vessel'),column('主要船員','port'),column('港口／位置','port'),
    column(dock ? '進塢 ETB' : 'ETA／ETB','port'),column(dock ? '出塢 ETD' : 'ETD','port'),column('備註','note')]};
}

export function buildFleetBriefReport(input: FleetBriefInput): FleetBriefReport {
  const regionalThemes = {'波斯灣':'gulf','澳洲':'australia','中國':'china'} as const;
  const groups = regions.map(region => ({...primarySection(region==='波斯灣'?'涉及波斯灣及周邊船舶':`涉及${region}船舶`),theme:regionalThemes[region]})), drydock = primarySection('塢修船舶',true);
  drydock.theme = 'dock';
  const hrs = section('重點關注：高風險船舶（HRS）',column('Tokyo MOU 風險','risk'),column('目前位置／ETB','port'),column('下一港／ETA','port'),column('備註','note'));
  hrs.theme = 'hrs';
  const active = new Map<string,Vessel>();
  for (const vessel of input.vessels) {
    if (!vessel.isActive || active.has(vessel.id)) continue;
    active.set(vessel.id,vessel);
    const name = vesselSelectionDisplayName(vessel);
    const risk = input.risk.rowsByVessel[vessel.id];
    const grade = risk ? `${risk.risk}｜取得：${formatRiskTime(risk.retrievedAt)}（台北）` : '未知（未取得）';
    const {current,here,next} = routeAt(vessel,input.itineraryRecords?.[vessel.id],input.capturedAt);
    const n = vessel.note;
    const notes = [...new Set([vessel.position.manualRemark,n.statusSupplement,n.recentDynamics,n.subsequentDynamics,n.maintenanceOverview,
      here?.note && `目前港：${here.note}`, next?.note && `下一港：${next.note}`].map(s=>s?.trim()).filter(Boolean))].join('\n');
    if (risk?.risk === 'HRS') {
      hrs.rows.push([name,grade,`${current || missing}\nETB：${here?.etb || missing}`,`${next?.port || missing}\nETA：${next?.eta || missing}`,notes || missing]);
    }
    const isDock = n.statusList.includes('drydock/repiar');
    const destination = regions.findIndex(r=>matchesBriefRegion(r,next?.port || ''));
    const primary = isDock ? drydock : groups[destination >= 0 ? destination : regions.findIndex(r=>matchesBriefRegion(r,current))];
    if (!primary) continue;
    const heading = !isDock && destination >= 0;
    const call = heading ? next : here;
    const ports = heading ? `正前往：${next!.port}\n目前位置：${current || missing}` : `目前在：${current || missing}\n下一港：${next?.port || missing}`;
    const officers = `船長：${n.captain?.trim() || missing}\n大副：${n.chiefOfficer?.trim() || missing}\n輪機長：${n.chiefEngineer?.trim() || missing}\n大管輪：${n.firstEngineer?.trim() || missing}`;
    primary.rows.push([String(primary.rows.length+1),name,officers,ports,
      isDock ? call?.etb || missing : `ETA：${call?.eta || missing}\nETB：${call?.etb || missing}`,call?.etd || missing,
      [`Tokyo MOU：${grade}`,notes].filter(Boolean).join('\n')]);
  }
  const notice = `${fleetRiskReportSource(input.risk,false)} HRS＝高風險、SRS＝標準風險、LRS＝低風險。區域按正前往、目前在擇一列出；塢修另列。波斯灣及周邊含富加拉、阿曼及紅海港口。最近 PSC 檢查與 CII 僅依已記錄備註，不由風險等級推算。`;
  return {date:input.date,notice,sections:[...groups,drydock,...openItems(input,[...active.values()]),hrs]};
}
