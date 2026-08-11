import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const helperPath='src/meetingRegister.ts';
assert.ok(fs.existsSync(helperPath),'需建立臨會／專題未完成／已完成清單與排序的純函式模組');

const helperSource=fs.readFileSync(helperPath,'utf8');
const compiled=ts.transpileModule(helperSource,{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
  fileName:helperPath,
}).outputText;
const helper=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const {
  meetingBelongsToRegisterList,
  nextMeetingRegisterSort,
  meetingRegisterAriaSort,
  sortMeetingRegisterEntries,
}=helper;

assert.equal(meetingBelongsToRegisterList('待召開','unfinished'),true,'待召開會議需列入未完成清單');
assert.equal(meetingBelongsToRegisterList('追蹤中','unfinished'),true,'追蹤中會議需列入未完成清單');
assert.equal(meetingBelongsToRegisterList('已完成','unfinished'),false,'已完成會議不得列入未完成清單');
assert.equal(meetingBelongsToRegisterList('已完成','completed'),true,'已完成會議需列入已完成清單');
assert.equal(meetingBelongsToRegisterList('追蹤中','completed'),false,'未完成會議不得列入已完成清單');

assert.deepEqual(nextMeetingRegisterSort(null,'meetingDate'),{key:'meetingDate',direction:'desc'},'首次點召開日期需先顯示最新日期');
assert.deepEqual(nextMeetingRegisterSort({key:'meetingDate',direction:'desc'},'meetingDate'),{key:'meetingDate',direction:'asc'},'再次點相同欄位需反轉排序方向');
assert.deepEqual(nextMeetingRegisterSort({key:'meetingDate',direction:'asc'},'status'),{key:'status',direction:'asc'},'切換到狀態欄需使用自然順序');
assert.deepEqual(nextMeetingRegisterSort({key:'status',direction:'asc'},'expectedDate'),{key:'expectedDate',direction:'asc'},'期限首次排序需優先顯示最近期限');
assert.equal(meetingRegisterAriaSort({key:'status',direction:'desc'},'status'),'descending');
assert.equal(meetingRegisterAriaSort({key:'status',direction:'desc'},'scope'),'none');

const rows=[
  {id:'old-tracking',meetingDate:'2026-07-17',status:'追蹤中',scope:'全部船舶',vesselCount:39,vesselLabel:'FPMC S AMBER',expectedDate:'2026-12-31'},
  {id:'completed',meetingDate:'2026-07-22',status:'已完成',scope:'逐船選擇',vesselCount:1,vesselLabel:'FPMC B MAJESTY',expectedDate:''},
  {id:'new-upcoming',meetingDate:'2026-08-10',status:'待召開',scope:'按船舶類型',vesselCount:2,vesselLabel:'FPMC S EMERALD',expectedDate:'2026-08-10'},
];
const ids=(sort)=>sortMeetingRegisterEntries(rows,sort,row=>row).map(row=>row.id);
assert.deepEqual(ids({key:'meetingDate',direction:'desc'}),['new-upcoming','completed','old-tracking'],'召開日期需可由新到舊排序');
assert.deepEqual(ids({key:'meetingDate',direction:'asc'}),['old-tracking','completed','new-upcoming'],'召開日期需可由舊到新排序');
assert.deepEqual(ids({key:'status',direction:'asc'}),['new-upcoming','old-tracking','completed'],'狀態自然順序需為待召開、追蹤中、已完成');
assert.deepEqual(ids({key:'vessels',direction:'asc'}),['completed','new-upcoming','old-tracking'],'船舶欄需優先依船舶數量排序');
assert.deepEqual(ids({key:'expectedDate',direction:'asc'}),['new-upcoming','old-tracking','completed'],'空白期限需固定排在有期限的會議後方');
assert.deepEqual(ids({key:'expectedDate',direction:'desc'}),['old-tracking','new-upcoming','completed'],'期限降冪時空白期限仍需固定排在最後');

const meetings=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
for(const label of ['未完成清單','已完成清單','匯出未完成清單 PDF','匯出已完成清單 PDF']){
  assert.ok(meetings.includes(label),`臨會／專題頁缺少「${label}」`);
}
assert.ok(meetings.includes('registerListMode')&&meetings.includes('meetingBelongsToRegisterList(statusOf(meeting),registerListMode)'),'畫面清單需依未完成／已完成模式嚴格分流');
assert.ok(meetings.includes('printRegisterListMode')&&meetings.includes('registerPrintMeetings'),'清單PDF需鎖定使用者點擊匯出時的未完成／已完成模式');
for(const key of ['meetingDate','status','scope','vessels','expectedDate']){
  assert.ok(meetings.includes(`meetingRegisterAriaSort(registerSort,'${key}')`),`「${key}」欄需回報目前排序方向`);
}
assert.ok((meetings.match(/meeting-register-sort-button/g)||[]).length>=5,'紅框五個欄位需各自提供可點擊排序按鈕');
assert.ok(meetings.includes('sortMeetingRegisterEntries')&&meetings.includes('nextMeetingRegisterSort'),'總清單需使用可重複點擊反轉方向的實際排序函式');
assert.ok(meetings.includes('registerPrintMeetings.map'),'清單PDF內容需只迭代目前未完成或已完成清單');

console.log('Meeting split-register and sorting contracts passed.');
