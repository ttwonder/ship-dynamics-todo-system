import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const root=process.cwd();
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
const meetings=fs.readFileSync(path.join(root,'src/TemporaryMeetings.tsx'),'utf8');
const controls=fs.readFileSync(path.join(root,'src/PaginationControls.tsx'),'utf8');
const server=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const { PAGE_SIZE, paginateItems }=await server.ssrLoadModule('/src/pagination.ts');
  const items=Array.from({length:123},(_,index)=>index+1);
  assert.equal(PAGE_SIZE,50,'固定每页 50 项');
  assert.deepEqual(paginateItems(items,1).items,[...items.slice(0,50)],'第一页仅显示前 50 项');
  assert.deepEqual(paginateItems(items,3).items,[...items.slice(100)],'第三页显示剩余项目');
  assert.equal(paginateItems(items,99).page,3,'越界页码必须夹取到最后一页');
  assert.equal(paginateItems([],5).page,1,'空清单页码保持 1');
  assert.match(app,/paginateItems\(tasks,\s*page\)/,'待办总清单与已结案清单必须使用分页结果');
  assert.match(app,/pagedTasks\.items\.map/,'待办清单不得继续渲染全部结果');
  assert.match(meetings,/paginateItems\(filtered,\s*meetingPage\)/,'临会清单必须使用分页结果');
  assert.ok((meetings.match(/pagedMeetings\.items\.map/g)||[]).length>=2,'临会总清单与左侧基本资讯清单都只渲染当前页');
  assert.match(app,/ariaLabel="待辦清單分頁"/,'待办清单需要可访问分页控件');
  assert.match(meetings,/ariaLabel="臨會清單分頁"/,'临会清单需要可访问分页控件');
  assert.match(controls,/aria-label=\{ariaLabel\}/,'分页组件必须输出语义化 aria-label');
  console.log('Pagination runtime and UI contracts passed.');
} finally { await server.close(); }
