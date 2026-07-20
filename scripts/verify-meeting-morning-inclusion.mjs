import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const { morningDiscussionTasks }=await server.ssrLoadModule('/src/morningTaskScope.ts');
  const ordinary={id:'ordinary',sourceType:'morning'};
  const included={id:'included',sourceType:'temporary',sourceMeetingId:'m-in'};
  const excluded={id:'excluded',sourceType:'temporary',sourceMeetingId:'m-out'};
  const orphan={id:'orphan',sourceType:'temporary',sourceMeetingId:'missing'};
  const meetings=[{id:'m-in',includeInMorning:true},{id:'m-out',includeInMorning:false}];
  assert.deepEqual(morningDiscussionTasks([ordinary,included,excluded,orphan],meetings).map(task=>task.id),['ordinary','included']);
  const normalize=await server.ssrLoadModule('/src/normalize.ts');
  const seed=(await server.ssrLoadModule('/src/data/seed.ts')).createInitialData();
  const raw=structuredClone(seed);
  raw.meetings=[{id:'legacy',subject:'legacy',meetingDate:'2026-07-19',vessels:[seed.vessels[0].id],reason:'',departments:[],participantUserIds:[],responsibleUserIds:[],resolution:'',taskDescription:'',taskItems:[],expectedDate:'',priority:'中',createdBy:'u',createdAt:'2026-07-19T00:00:00Z'}];
  assert.equal(normalize.normalizeAppData(raw).meetings[0].includeInMorning,false,'旧会议必须默认不纳入早会');
} finally {await server.close();}

const page=fs.readFileSync('src/TemporaryMeetings.tsx','utf8');
assert.match(page,/納入早會/,'会议详情缺少纳入早会勾选');
const morning=fs.readFileSync('src/MorningWorkspace.tsx','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
assert.ok(morning.includes('morningDiscussionTasks'),'早会工作台必须使用统一过滤器');
assert.ok(app.includes('morningDiscussionTasks'),'报告与预览必须使用统一过滤器');
console.log('Meeting morning inclusion contracts passed.');
