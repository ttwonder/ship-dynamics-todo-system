import type ExcelJS from 'exceljs';
import { STATISTICS_METRICS, statisticsPercent } from './trackingStatistics';
import { STATISTICS_DETAIL_COLUMNS, STATISTICS_POLICY, type StatisticsReport } from './trackingStatisticsReport';
import { trackingTextChunks } from './trackingReport';
import { formatTaipeiDateTime } from '../taipeiTime';

export async function buildStatisticsWorkbook(report: StatisticsReport): Promise<ArrayBuffer> {
  const runtime=await import('exceljs'),book=new(runtime.Workbook||runtime.default.Workbook)();book.creator='Ship Dynamics';
  const heading=(sheet:ExcelJS.Worksheet,columns:number)=>{
    sheet.mergeCells(1,1,1,columns);sheet.getCell('A1').value=`${report.vesselName}｜統計資訊`;
    sheet.mergeCells(2,1,2,columns);sheet.getCell('A2').value=`摘要範圍：${report.scope.cohort}\n明細焦點：${report.scope.detail}｜${report.rows.length} 項（完整條件 ${report.stats.summary.total} 項）`;
    sheet.mergeCells(3,1,3,columns);sheet.getCell('A3').value=`確認快照 ${formatTaipeiDateTime(report.generatedAt)}（台北）｜逾期判定日 ${report.today}｜${STATISTICS_POLICY}`;
  };
  const format=(sheet:ExcelJS.Worksheet,widths:number[])=>{
    widths.forEach((w,i)=>sheet.getColumn(i+1).width=w);
    sheet.eachRow(row=>{row.eachCell(cell=>{cell.font={name:'Microsoft JhengHei',size:11,bold:row.number<=4};cell.alignment={wrapText:true,vertical:'top'};cell.numFmt='@';cell.border={bottom:{style:'hair',color:{argb:'FF888888'}}};});if(row.number<=4)row.height=row.number===2?48:row.number===3?76:row.number===1?26:32;});
    sheet.views=[{state:'frozen',ySplit:4}];sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4',margins:{left:.3,right:.3,top:.4,bottom:.4,header:.15,footer:.15}};delete sheet.pageSetup.scale;
    sheet.headerFooter={oddFooter:'&R第 &P 頁／共 &N 頁'};
  };
  const summary=book.addWorksheet('統計摘要');heading(summary,4);summary.addRow(['指標','數量／比率','分子','分母']);
  STATISTICS_METRICS.forEach(([key,label])=>summary.addRow([label,report.stats.summary[key]]));
  summary.addRow(['完成率',statisticsPercent(report.stats.summary.completionRate),report.stats.summary.completed,report.stats.summary.effective]);summary.addRow(['延遲率',statisticsPercent(report.stats.summary.delayRate),report.stats.summary.delayed,report.stats.summary.delayEligible]);format(summary,[40,35,35,35]);
  const categories=book.addWorksheet('分類統計');heading(categories,11);categories.addRow(['分類','申請數','有效項目','已完成','未完成','取消','完成率','延遲數','延遲可判定','延遲率','急件總數']);report.stats.categories.forEach(c=>categories.addRow([c.label,c.summary.total,c.summary.effective,c.summary.completed,c.summary.incomplete,c.summary.cancelled,statisticsPercent(c.summary.completionRate),c.summary.delayed,c.summary.delayEligible,statisticsPercent(c.summary.delayRate),c.summary.urgent]));format(categories,[24,13,13,13,13,13,13,13,15,13,13]);
  const detail=book.addWorksheet('期間申請明細');heading(detail,STATISTICS_DETAIL_COLUMNS.length);detail.addRow(STATISTICS_DETAIL_COLUMNS.map(c=>c.label));
  for(const row of report.rows)detail.addRow(STATISTICS_DETAIL_COLUMNS.map(c=>{const text=row.values[c.key]||'';if(text.length>32767)throw new Error(`項目 ${row.id} 的「${c.label}」超過 Excel 單格上限，未輸出截斷檔；請使用 PDF。`);return text;}));
  format(detail,STATISTICS_DETAIL_COLUMNS.map(c=>c.width));detail.autoFilter={from:'A4',to:{row:Math.max(5,detail.rowCount),column:STATISTICS_DETAIL_COLUMNS.length}};
  const print=book.addWorksheet('列印明細');heading(print,4);print.addRow(['序號','申請單號／ID','欄位','完整內容']);
  report.rows.forEach((row,i)=>STATISTICS_DETAIL_COLUMNS.forEach(c=>trackingTextChunks(row.values[c.key]||'',550).forEach((text,part)=>{const r=print.addRow([String(i+1),`${row.values.referenceNo}\n${row.id}`,c.label+(part?`（續 ${part+1}）`:''),text]);r.height=Math.min(400,Math.max(40,Math.ceil(text.length/65)*16+text.split('\n').length*16));})));format(print,[7,30,25,88]);
  // Keep calculated continuation heights; Excel row limits never truncate source cells.
  const buffer=await book.xlsx.writeBuffer();return Uint8Array.from(new Uint8Array(buffer)).buffer;
}
