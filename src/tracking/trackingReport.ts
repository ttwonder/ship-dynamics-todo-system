import { trackingRowSnapshot, type TrackingTab, TRACKING_TABS } from './trackingFilters';
import { trackingColumnsFor, type TrackingColumn } from './trackingColumns';
import type { TrackingItem, TrackingKind } from './trackingTypes';
export interface TrackingReport extends ReturnType<typeof trackingRowSnapshot> {
  vesselId:string; vesselName:string; kind:TrackingKind; title:string; generatedAt:string; summary:string; selection:'all'|'selected';
}
export function makeTrackingReport(items:TrackingItem[],columns:TrackingColumn[],metadata:Omit<TrackingReport,'rows'|'columns'>):TrackingReport {
  const report={...trackingRowSnapshot(items,columns),...metadata};
  const freeze=(value:unknown)=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(report);return report;
}
export const trackingTitle=(tab:TrackingTab)=>TRACKING_TABS.find(t=>t.id===tab)!.label;
export const compactTrackingColumns=(kind:TrackingKind)=>trackingColumnsFor(kind).filter(c=>['referenceNo','requestType','description','expectedDate','progress','supplementalNotes',kind==='supply'?'actualDeliveryDate':'completionDate','isClosed'].includes(c.key));
export function trackingReportFileName(report:Pick<TrackingReport,'vesselName'|'title'|'generatedAt'>,extension:string){return `${report.vesselName}-${report.title}-${report.generatedAt.slice(0,10)}.${extension}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');}
/** Break long text into explicit continuation chunks, preserving every character. */
export function trackingTextChunks(value:string,maxUnits=1100):string[]{
 const chunks:string[]=[];let text='',units=0;
 for(const ch of value){const cost=ch==='\n'?88:/[^\x00-\x7f]/.test(ch)?2:1;if(units+cost>maxUnits&&text){chunks.push(text);text='';units=0;}text+=ch;units+=cost;}
 chunks.push(text);return chunks;
}
