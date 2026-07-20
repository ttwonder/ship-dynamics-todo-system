import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const page=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
assert.match(page,/加入狀態紀錄/,'會議詳情必須提供加入狀態紀錄按鈕');
assert.match(page,/meeting-status-history/,'會議詳情底部必須提供狀態歷程');
assert.match(page,/addMeetingStatusRecord/,'會議詳情必須使用受測的狀態新增流程');
assert.match(page,/canDeleteMeetingStatusLog/,'會議狀態記錄刪除必須有權限判斷');
assert.match(page,/只有 Owner／管理員或該狀態記錄添加人可以刪除/,'非管理員且非添加人刪除狀態記錄時必須拒絕');
assert.match(page,/刪除記錄/,'狀態歷程必須提供授權後的刪除記錄操作');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const workflow=await server.ssrLoadModule('/src/meetingStatusWorkflow.ts');
  const normalizer=await server.ssrLoadModule('/src/normalize.ts');
  const seed=await server.ssrLoadModule('/src/data/seed.ts');

  const previous={latestStatus:'前次進度',statusLogs:[{id:'old',at:'2026-07-18T01:00:00.000Z',by:'甲',text:'前次進度'}]};
  const next=workflow.addMeetingStatusRecord(previous,'  最新進度完成  ','乙','2026-07-19T02:00:00.000Z','new','u-2');
  assert.equal(next.latestStatus,'最新進度完成');
  assert.deepEqual(next.statusLogs.map(log=>log.id),['new','old']);
  assert.equal(next.statusLogs[0].by,'乙');
  assert.equal(next.statusLogs[0].byUserId,'u-2','新增狀態記錄必須保存添加人 ID 供刪除權限判斷');
  assert.equal(workflow.addMeetingStatusRecord(previous,'   ','乙','2026-07-19T02:00:00.000Z','blank'),null,'空輸入不得建立記錄');

  const raw=seed.createInitialData();
  raw.meetings=[{id:'m-old',subject:'舊會議',status:'追蹤中',meetingDate:'2026-07-18',vessels:['v001'],reason:'',departments:[],participantUserIds:[],responsibleUserIds:[],resolution:'',taskDescription:'',taskItems:[],expectedDate:'',priority:'中',createdBy:'u1',createdAt:'2026-07-18T00:00:00.000Z'}];
  let normalized=normalizer.normalizeAppData(JSON.parse(JSON.stringify(raw)));
  assert.equal(normalized.meetings[0].latestStatus,'');
  assert.deepEqual(normalized.meetings[0].statusLogs,[]);

  raw.meetings[0].latestStatus='最新進度';
  raw.meetings[0].statusLogs=[{id:'log2',at:'2026-07-19T02:00:00.000Z',by:'乙',byUserId:'u-2',text:'最新進度'},{id:'log1',at:'2026-07-18T01:00:00.000Z',by:'甲',text:'前次進度'}];
  normalized=normalizer.normalizeAppData(JSON.parse(JSON.stringify(raw)));
  assert.equal(normalized.meetings[0].latestStatus,'最新進度');
  assert.deepEqual(normalized.meetings[0].statusLogs.map(log=>log.id),['log2','log1']);
  assert.equal(normalized.meetings[0].statusLogs[0].byUserId,'u-2','正規化必須保留狀態記錄添加人 ID');
  console.log('Meeting quick status and history contracts passed.');
} finally { await server.close(); }
