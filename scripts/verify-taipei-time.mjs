import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try{
  const time=await server.ssrLoadModule('/src/taipeiTime.ts');
  assert.equal(time.taipeiDateKey('2026-08-05T15:59:59.000Z'),'2026-08-05');
  assert.equal(time.taipeiDateKey('2026-08-05T16:00:00.000Z'),'2026-08-06');
  assert.equal(time.formatTaipeiDateTime('2026-08-05T16:05:06.000Z'),'2026/08/06 00:05:06');
  assert.equal(time.taipeiDateTimeLocalValue('2026-08-05T16:05:06.000Z'),'2026-08-06T00:05');
  assert.equal(time.taipeiMonthKey('2026-07-31T16:00:00.000Z'),'2026-08');
  assert.deepEqual(time.taipeiRecentMonthKeys(3,'2026-01-15T00:00:00.000Z'),['2025-11','2025-12','2026-01']);
  assert.equal(time.taipeiYesterdayDate('2026-01-01T00:30:00.000Z'),'2025-12-31');
  assert.equal(time.taipeiDaysDiff('2026-08-07','2026-08-06T15:59:59.000Z'),1);

  const internalData=await server.ssrLoadModule('/src/internalControlData.ts');
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const seed=createInitialData();
  const actor={id:seed.users[0].id,name:seed.users[0].name};
  const draft={users:seed.users,vessels:seed.vessels,tasks:[],internalControlCases:[],settings:seed.settings};
  internalData.createInternalControlCases(draft,[{
    id:'taipei-midnight-case',vesselId:seed.vessels[0].id,reportDate:'2026-08-05',reportSource:'日常',
    description:'台北午夜結案測試',priority:'中',category:'其他',isAware:false,status:'已處理',departments:[],
    syncToTask:false,origin:'internal-control',isClosed:true,statusLogs:[],createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',
  }],actor,'2026-08-05T16:05:00.000Z');
  assert.equal(draft.internalControlCases[0].closedDate,'2026-08-06','單筆內控結案日期必須使用台北業務日期');

  const batchActions=await server.ssrLoadModule('/src/batchInternalControlActions.ts');
  const batchDraft={users:seed.users,vessels:seed.vessels,tasks:[],internalControlCases:[],settings:seed.settings};
  internalData.createInternalControlCases(batchDraft,[{
    id:'taipei-midnight-batch-case',vesselId:seed.vessels[0].id,reportDate:'2026-08-05',reportSource:'日常',
    description:'台北午夜批量結案測試',priority:'中',category:'其他',isAware:false,status:'處理中',departments:[],
    syncToTask:false,origin:'internal-control',isClosed:false,statusLogs:[],createdBy:'',updatedBy:'',createdAt:'',updatedAt:'',
  }],actor,'2026-08-05T15:55:00.000Z');
  batchActions.closeInternalControlCaseBatchFromDraft(
    batchDraft,
    [{id:'taipei-midnight-batch-case',updatedAt:'2026-08-05T15:55:00.000Z'}],
    actor,
    '2026-08-05T16:05:00.000Z',
  );
  assert.equal(batchDraft.internalControlCases[0].closedDate,'2026-08-06','批量內控結案日期必須使用台北業務日期');

  const {normalizeAppData}=await server.ssrLoadModule('/src/normalize.ts');
  const legacy=structuredClone(seed);
  legacy.tasks.push({
    ...structuredClone(seed.tasks[0]),
    id:'taipei-midnight-normalized-task',
    reportDate:'',
    createdAt:'2026-08-05T16:05:00.000Z',
    updatedAt:'2026-08-05T16:05:00.000Z',
  });
  const normalized=normalizeAppData(legacy);
  assert.equal(normalized.tasks.find(item=>item.id==='taipei-midnight-normalized-task').reportDate,'2026-08-06','舊要事缺少報告日時必須依台北建立時間補值');
}finally{await server.close();}
const appSource=fs.readFileSync('src/App.tsx','utf8');
const vesselDetailSource=fs.readFileSync('src/VesselDetailPage.tsx','utf8');
const seedSource=fs.readFileSync('src/data/seed.ts','utf8');
const normalizedMeetingsSource=fs.readFileSync('src/NormalizedMeetings.tsx','utf8');
assert.match(appSource,/const date=taipeiDateKey\(t\.updatedAt\|\|t\.createdAt\);/,'list date filters must classify timestamps by Taipei date');
assert.match(vesselDetailSource,/const dateTime = \(text\?: string\) => formatTaipeiDateTime\(text, false, '未設定'\);/,'vessel detail timestamps must render in Taipei time');
assert.match(seedSource,/reportDate: taipeiYesterdayDate\(now\)/,'seed business dates must not slice a UTC instant');
assert.match(normalizedMeetingsSource,/formatTaipeiDateTime\(meeting\.meetingDate, false\)/,'normalized meeting cards must render meeting instants in Taipei time');
console.log('Taipei time boundary contracts passed.');
