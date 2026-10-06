import type { InternalControlCase, Vessel } from './types';
import { richTextToPlainText } from './richText';
import { pdfVesselDisplayName } from './vesselDisplay';

// The existing shore print table is shared by the ship download: never render
// the shore AppData on the public ship page.
export type InternalControlPrintCase = Pick<InternalControlCase,
  'id' | 'vesselId' | 'reportDate' | 'reportSource' | 'priority' |
  'description' | 'category' | 'equipmentSubcategory' | 'departments' |
  'status' | 'closedDate'>;
export type InternalControlPrintVessel = Pick<Vessel, 'id' | 'name' | 'shortName' | 'fullName'>;

export default function InternalControlPrintList({ cases, vessels }: {
  cases: readonly InternalControlPrintCase[];
  vessels: readonly InternalControlPrintVessel[];
}) {
  return <table><thead><tr><th>船舶</th><th>報告日期／來源</th><th>關注</th><th>事項</th><th>分類／細項</th><th>部門</th><th>狀態</th><th>結案</th></tr></thead><tbody>{cases.map(item => {
    const vessel = vessels.find(entry => entry.id === item.vesselId);
    return <tr key={item.id}><td>{vessel ? pdfVesselDisplayName(vessel) : item.vesselId}</td><td>{item.reportDate}｜{item.reportSource}</td><td>{item.priority}</td><td>{richTextToPlainText(item.description)}</td><td>{item.category}{item.equipmentSubcategory ? `｜${item.equipmentSubcategory}` : ''}</td><td>{item.departments.join('、')}</td><td>{richTextToPlainText(item.status)}</td><td>{item.closedDate || '未結'}</td></tr>;
  })}</tbody></table>;
}
