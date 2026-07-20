import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const page=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
assert.match(page,/加入狀態紀錄/,'會議詳情必須提供加入狀態紀錄按鈕');
assert.match(page,/meeting-status-history/,'會議詳情底部必須提供狀態歷程');
assert.match(page,/addMeetingStatusRecord/,'會議詳情必須使用受測的狀態新增流程');

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const workflow=await server.ssrLoadModule('/src/meetingStatusWorkflow.ts');
  const normalizer=await server.ssrLoadModule('/src/normalize.ts');
  const seed=await server.ssrLoadModule('/src/data/seed.ts');

  const previous={latestStatus:'前次進度',statusLogs:[{id:'old',at:'2026-07-18T01:00:00.000Z',by:'甲',text:'前次進度'}]};
  const next=workflow.addMeetingStatusRecord(previous,'  最新進度完成  ','乙','2026-07-19T02:00:00.000Z','new');
  assert.equal(next.latestStatus,'最新進度完成');
  assert.deepEqual(next.statusLogs.map(log=>log.id),['new','old']);
  assert.equal(next.statusLogs[0].by,'乙');
  assert.equal(workflow.addMeetingStatusRecord(previous,'   ','乙','2026-07-19T02:00:00.000Z','blank'),null,'空輸入不得建立記錄');

  const raw=seed.createInitialData();
  raw.meetings=[{id:'m-old',subject:'舊會議',status:'追蹤中',meetingDate:'2026-07-18',vessels:['v001'],reason:'',departments:[],participantUserIds:[],responsibleUserIds:[],resolution:'',taskDescription:'',taskItems:[],expectedDate:'',priority:'中',createdBy:'u1',createdAt:'2026-07-18T00:00:00.000Z'}];
  let normalized=normalizer.normalizeAppData(JSON.parse(JSON.stringify(raw)));
  assert.equal(normalized.meetings[0].latestStatus,'');
  assert.deepEqual(normalized.meetings[0].statusLogs,[]);

  raw.meetings[0].latestStatus='最新進度';
  raw.meetings[0].statusLogs=[{id:'log2',at:'2026-07-19T02:00:00.000Z',by:'乙',text:'最新進度'},{id:'log1',at:'2026-07-18T01:00:00.000Z',by:'甲',text:'前次進度'}];
  normalized=normalizer.normalizeAppData(JSON.parse(JSON.stringify(raw)));
  assert.equal(normalized.meetings[0].latestStatus,'最新進度');
  assert.deepEqual(normalized.meetings[0].statusLogs.map(log=>log.id),['log2','log1']);
  console.log('Meeting quick status and history contracts passed.');
} finally { await server.close(); }
