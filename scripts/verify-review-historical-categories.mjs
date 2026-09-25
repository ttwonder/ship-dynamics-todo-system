import assert from 'node:assert/strict';
import {createServer} from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const report={id:'R3-F4',layer:'production helpers; synthetic data; no UI or SQL',inputs:{}};
for(const file of ['src/normalize.ts','src/taskCategories.ts'])report.inputs[file]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
 const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
 const {normalizeAppData}=await server.ssrLoadModule('/src/normalize.ts');
 const categories=await server.ssrLoadModule('/src/taskCategories.ts');
 for(const closed of [false,true]){
  const raw=createInitialData();raw.tasks=[];raw.meetings=[];raw.internalControlCases=[];raw.trackingItems=[];
  raw.settings.meetingTaskCategorySchemaVersion=2;raw.settings.meetingTaskCategories=['船員管理','岸基培訓'];
  raw.tasks=[{id:'hist-t',vesselId:raw.vessels[0].id,description:'historical linked task',categories:['岸基培訓'],sourceType:'temporary',sourceMeetingId:'hist-m',isClosed:closed,closedDate:closed?'2026-09-24':undefined,statusLogs:[]}];
  raw.meetings=[{id:'hist-m',subject:'historical meeting',taskItems:[{id:'hist-i',description:'historical decision',categories:['岸基培訓'],isClosed:closed,closedDate:closed?'2026-09-24':undefined}],vessels:[raw.vessels[0].id],statusLogs:[]}];
  const before=normalizeAppData(raw);assert.equal(before.tasks[0].categories[0],'岸基培訓');
  raw.settings.meetingTaskCategories=['船員管理'];const input=structuredClone(raw),after=normalizeAppData(raw);
  assert.deepEqual(after.tasks[0].categories,['岸基培訓'],'R3-F4 saved task category survives removal from choices');
  assert.deepEqual(after.meetings[0].taskItems[0].categories,['岸基培訓']);assert.deepEqual(raw,input,'normalization does not mutate raw history');
  assert.deepEqual(categories.categoryChoicesForTask(after.tasks[0],after.settings),['船員管理'],'new choices exclude removed category');
  assert.deepEqual(categories.normalizeMeetingTaskCategoryList([],after.settings.meetingTaskCategories),['船員管理'],'new blank item still uses valid default');
 }
 report.status='PASS';console.log('PASS R3-F4 historical categories and new-choice control');
} catch(error){report.status='FAIL';report.error=error.stack;throw error;}
finally{await server.close();if(process.env.QA_EVIDENCE_ROOT)fs.writeFileSync(path.join(process.env.QA_EVIDENCE_ROOT,'R3-F4-'+report.status+'-'+Date.now()+'.json'),JSON.stringify(report,null,2));}
