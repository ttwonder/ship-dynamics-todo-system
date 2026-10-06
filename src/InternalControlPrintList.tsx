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

export default function InternalControlPrintList({ cases, vessels, shipPdf = false }: {
  cases: readonly InternalControlPrintCase[];
  vessels: readonly InternalControlPrintVessel[];
  shipPdf?: boolean;
}) {
  // Ship-only width ratios: 2/3, 1/3, 1, 1/2, 1/2, 1, 1/3 of an original column.
  const shipColumnWeights = [4, 2, 6, 3, 3, 6, 2];
  return <table className={shipPdf ? 'ship-internal-pdf-table' : undefined}>
    {shipPdf && <colgroup>{shipColumnWeights.map((weight, index) => <col key={index} style={{ width: `${weight / 26 * 100}%` }}/>)}</colgroup>}
    <thead><tr>{!shipPdf && <th>船舶</th>}<th>報告日期／來源</th><th>關注</th><th>事項</th><th>分類／細項</th><th>部門</th><th>狀態</th><th>結案</th></tr></thead>
    <tbody>{cases.map(item => {
      const vessel = !shipPdf && vessels.find(entry => entry.id === item.vesselId);
      return <tr key={item.id}>
        {!shipPdf && <td>{vessel ? pdfVesselDisplayName(vessel) : item.vesselId}</td>}
        <td>{item.reportDate}｜{item.reportSource}</td><td>{item.priority}</td>
        <td>{richTextToPlainText(item.description)}</td>
        <td>{item.category}{item.equipmentSubcategory ? `｜${item.equipmentSubcategory}` : ''}</td>
        <td>{item.departments.join('、')}</td><td>{richTextToPlainText(item.status)}</td>
        <td>{item.closedDate || '未結'}</td>
      </tr>;
    })}</tbody>
  </table>;
}
