import type ExcelJS from 'exceljs';
import { STATISTICS_METRICS, statisticsPercent } from './trackingStatistics';
import { STATISTICS_POLICY, type StatisticsReport } from './trackingStatisticsReport';
import { formatTaipeiDateTime } from '../taipeiTime';

export async function buildStatisticsWorkbook(report: StatisticsReport): Promise<ArrayBuffer> {
  const runtime=await import('exceljs'),book=new(runtime.Workbook||runtime.default.Workbook)();book.creator='Ship Dynamics';
  const heading=(sheet:ExcelJS.Worksheet,columns:number)=>{
    sheet.mergeCells(1,1,1,columns);sheet.getCell('A1').value=`${report.vesselName}｜統計資訊`;
    sheet.mergeCells(2,1,2,columns);sheet.getCell('A2').value=`統計範圍：${report.scope.cohort}\n申請數 ${report.stats.summary.total} 項｜僅彙總，不含逐項明細`;
    sheet.mergeCells(3,1,3,columns);sheet.getCell('A3').value=`確認快照 ${formatTaipeiDateTime(report.generatedAt)}（台北）｜逾期判定日 ${report.today}｜${STATISTICS_POLICY}`;
  };
  const format=(sheet:ExcelJS.Worksheet,widths:number[])=>{
    widths.forEach((w,i)=>sheet.getColumn(i+1).width=w);
    sheet.eachRow(row=>{for(let c=1;c<=widths.length;c++){const cell=row.getCell(c);cell.font={name:'Microsoft JhengHei',size:11,bold:row.number<=4};cell.alignment={wrapText:true,vertical:'top'};cell.numFmt='@';cell.border=row.number>=4?{top:{style:'thin',color:{argb:'FF798492'}},bottom:{style:'thin',color:{argb:'FF798492'}},left:{style:'thin',color:{argb:'FF798492'}},right:{style:'thin',color:{argb:'FF798492'}}}:{bottom:{style:'hair',color:{argb:'FF888888'}}};}if(row.number<=4)row.height=row.number===2?48:row.number===3?76:row.number===1?26:32;});
    sheet.views=[{state:'frozen',ySplit:4}];sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4',margins:{left:.3,right:.3,top:.4,bottom:.4,header:.15,footer:.15}};delete sheet.pageSetup.scale;
    sheet.headerFooter={oddFooter:'&R第 &P 頁／共 &N 頁'};
  };
  const summary=book.addWorksheet('統計摘要');heading(summary,4);summary.addRow(['指標','數量／比率','分子','分母']);
  STATISTICS_METRICS.forEach(([key,label])=>summary.addRow([label,report.stats.summary[key]]));
  summary.addRow(['完成率',statisticsPercent(report.stats.summary.completionRate),report.stats.summary.completed,report.stats.summary.effective]);summary.addRow(['延遲率',statisticsPercent(report.stats.summary.delayRate),report.stats.summary.delayed,report.stats.summary.delayEligible]);format(summary,[40,35,35,35]);
  const categories=book.addWorksheet('分類統計');heading(categories,11);categories.addRow(['分類','申請數','有效項目','已完成','未完成','取消','完成率','延遲數','延遲可判定','延遲率','急件總數']);report.stats.categories.forEach(c=>categories.addRow([c.label,c.summary.total,c.summary.effective,c.summary.completed,c.summary.incomplete,c.summary.cancelled,statisticsPercent(c.summary.completionRate),c.summary.delayed,c.summary.delayEligible,statisticsPercent(c.summary.delayRate),c.summary.urgent]));format(categories,[24,13,13,13,13,13,13,13,15,13,13]);
  const buffer=await book.xlsx.writeBuffer();return Uint8Array.from(new Uint8Array(buffer)).buffer;
}
