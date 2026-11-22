export type FleetBriefColumnKind = 'vessel' | 'risk' | 'port' | 'note' | 'level' | 'content';
export interface FleetBriefSection {
  title: string;
  columns: {label: string; kind: FleetBriefColumnKind}[];
  rows: string[][];
}
export interface FleetBriefReport {
  date: string;
  notice: string;
  sections: FleetBriefSection[];
}
export interface FleetBriefCapture {
  report: FleetBriefReport;
  isCurrent: () => boolean;
}
