import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const morning=await server.ssrLoadModule('/src/morningHistoryPagination.ts');
  assert.equal(typeof morning.paginateMorningHistory,'function','早會歷史未結議題需提供可驗證的純顯示分頁');
  assert.equal(morning.MORNING_HISTORY_PAGE_SIZE,30,'歷史未結議題每頁必須固定30筆');
  const items=Array.from({length:65},(_,index)=>({id:`history-${index+1}`}));
  const openingIds=items.map(item=>item.id);
  const first=morning.paginateMorningHistory(items,1);
  const second=morning.paginateMorningHistory(items,2);
  const third=morning.paginateMorningHistory(items,3);
  assert.deepEqual({page:first.currentPage,pages:first.pageCount,count:first.items.length,first:first.items[0].id,last:first.items.at(-1).id},{page:1,pages:3,count:30,first:'history-1',last:'history-30'});
  assert.deepEqual({page:second.currentPage,count:second.items.length,first:second.items[0].id,last:second.items.at(-1).id,start:second.startIndex},{page:2,count:30,first:'history-31',last:'history-60',start:30});
  assert.deepEqual({page:third.currentPage,count:third.items.length,first:third.items[0].id,last:third.items.at(-1).id,start:third.startIndex},{page:3,count:5,first:'history-61',last:'history-65',start:60});
  assert.equal(morning.paginateMorningHistory(items,0).currentPage,1,'小於第一頁需校正至第一頁');
  assert.equal(morning.paginateMorningHistory(items,99).currentPage,3,'資料縮減後超界頁碼需校正至最後有效頁');
  assert.deepEqual(morning.paginateMorningHistory([],8),{items:[],currentPage:1,pageCount:1,totalItems:0,startIndex:0},'空結果需保留安全頁碼且不產生假資料');
  assert.deepEqual(items.map(item=>item.id),openingIds,'分頁只能切顯示結果，不得重排或改寫原始篩選資料');
}finally{await server.close();}

const source=fs.readFileSync('src/MorningWorkspace.tsx','utf8');
assert.match(source,/historicalDiscussionTasks[\s\S]*paginateMorningHistory/,'分頁必須套用在既有歷史未結篩選與排序結果之後');
assert.match(source,/<HistoryPaginationControls[^>]*position="上方"/,'歷史清單上方必須有分頁控制');
assert.match(source,/<HistoryPaginationControls[^>]*position="下方"/,'歷史清單下方必須有分頁控制');
assert.match(source,/歷史未結上方頁碼/,'上方控制需提供直接跳頁');
assert.match(source,/歷史未結下方頁碼/,'下方控制需提供直接跳頁');
assert.match(source,/>上一頁<[^]*>下一頁</,'控制需同時提供上一頁與下一頁');
assert.match(source,/setHistoryPage\(historicalPage\.currentPage\)/,'資料異動使頁碼超界時，state需校正到有效頁');
assert.match(source,/totalCount=\{historicalPage\.totalItems\}/,'歷史區塊標題需顯示篩選後總件數，不能誤顯示本頁件數');
console.log('Morning history pagination contracts passed.');
