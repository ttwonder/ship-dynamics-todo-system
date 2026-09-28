import { todayDate } from '../runtimeUtils';
import { isValidInternalControlDate } from '../internalControlWorkflow';
import { isTrackingDeleted } from './trackingDeletion';
import { selectTrackingRows, type TrackingQuery } from './trackingFilters';
import type { TrackingItem } from './trackingTypes';

export interface TrackingExportMonths { startMonth:string; endMonth:string }
export interface TrackingExportMonthRange extends TrackingExportMonths { from:string; to:string; basis:'applicationDate' }

/** Date-only Taipei calendar defaults, never the UTC ISO month. */
export function defaultTrackingExportMonths():TrackingExportMonths {
  const month=todayDate().slice(0,7);
  return {startMonth:month,endMonth:month};
}
export function trackingExportMonthRange({startMonth,endMonth}:TrackingExportMonths):TrackingExportMonthRange {
  if(!startMonth||!endMonth)throw new Error('請選擇開始月份及結束月份。');
  const valid=(month:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&isValidInternalControlDate(`${month}-01`);
  if(!valid(startMonth)||!valid(endMonth))throw new Error('月份必須為有效的 YYYY-MM。');
  if(startMonth>endMonth)throw new Error('開始月份不可晚於結束月份。');
  // Calendar validation handles leap years without timezone/Date rollover.
  let last=31;
  while(!isValidInternalControlDate(`${endMonth}-${last}`))last--;
  return {startMonth,endMonth,from:`${startMonth}-01`,to:`${endMonth}-${last}`,basis:'applicationDate'};
}
/** AND the whole months with the existing view/ordering and optional exact IDs. */
export function selectTrackingExportRows(items:readonly TrackingItem[],query:TrackingQuery,months:TrackingExportMonths,selectedIds?:readonly string[]):TrackingItem[] {
  if(query.view==='deleted'||String(query.tab)==='deleted')throw new Error('已刪除清單不可匯出。');
  if(query.view==='requests'||String(query.tab)==='requests')throw new Error('刪除申請／結果清單不可匯出；待審核項目請從原業務分頁匯出。');
  const range=trackingExportMonthRange(months),selected=selectedIds===undefined?null:new Set(selectedIds);
  const rows=selectTrackingRows(items,query).filter(row=>!isTrackingDeleted(row)
    &&isValidInternalControlDate(row.applicationDate)&&row.applicationDate>=range.from&&row.applicationDate<=range.to
    &&(!selected||selected.has(row.id)));
  if(!rows.length)throw new Error('本次月份及目前條件內沒有符合資料（0 項），不會改匯出其他列。');
  return rows;
}
