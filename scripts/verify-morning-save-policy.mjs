import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',cacheDir:process.env.QA_VITE_CACHE_DIR});
const cases=[];
const check=async(caseId,fn)=>{try{await fn();cases.push({caseId,status:'PASS'});}catch(error){cases.push({caseId,status:'FAIL',message:error.message});}};
const fixture=()=>({
  agendaReports:[],
  vessels:[{id:'policy-v1',name:'POLICY VESSEL',isActive:true,position:{location:'BEFORE'},cargo:{},note:{}}],
  tasks:[{id:'policy-task',vesselId:'policy-v1',vesselIds:['policy-v1'],vesselScopeMode:'vessels',description:'CURRENT CONTENT',isInternalControl:false,isClosed:false,sourceType:'morning',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',statusLogs:[{id:'deep-history',text:'KEEP COMPLETE HISTORY',at:'2026-10-01T00:00:00.000Z'}],vesselProgress:[]}],
  internalControlCases:[],meetings:[],
});
try{
  const {upsertDailyMorningReport,dailyMorningSaveReadReports,dailyMorningReports}=await server.ssrLoadModule('/src/morningHistory.ts');
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const {buildCloudBlockPatch}=await server.ssrLoadModule('/src/cloudBlockPatch.ts');
  const {assertActorAuthorizedForCloudBlockPatch}=await server.ssrLoadModule('/src/cloudAuthorization.ts');
  await check('MSP02-weekend-manual-authorization-retains-role-and-shape-guards',async()=>{
    const base={...createInitialData(),...fixture(),users:['owner','admin','operator'].map(role=>({id:'policy-'+role,role,isActive:true,name:role,managedVesselIds:[]}))};
    const saved=upsertDailyMorningReport(base,{at:'2026-10-10T04:00:00Z',actorUserId:'policy-owner',source:'manual'});
    const ops=buildCloudBlockPatch(base,saved.data);
    for(const role of ['owner','admin'])assert.doesNotThrow(()=>assertActorAuthorizedForCloudBlockPatch(base,ops,'policy-'+role));
    assert.throws(()=>assertActorAuthorizedForCloudBlockPatch(base,ops,'policy-operator'),/daily-morning-owner-admin-only/);
    const reportOp=ops.find(o=>o.kind==='entity'&&o.collection==='agendaReports');
    for(const mutation of [v=>({...v,source:'scheduled'}),v=>({...v,id:'unrelated-id'}),v=>({...v,businessDate:'2026-10-11'}),v=>({...v,taskCount:999})]){
      const changed=ops.map(o=>o===reportOp?{...o,value:mutation(o.value)}:o);
      assert.throws(()=>assertActorAuthorizedForCloudBlockPatch(base,changed,'policy-owner'),/invalid-daily-morning-report/);
    }
  });
  await check('MSP03-manual-capture-reads-latest-eligible-baseline-not-first-same-day',async()=>{
    const manual=(id,at)=>({id,kind:'daily-morning',businessDate:'2026-10-10',source:'manual',createdAt:at,snapshot:{windowEndedAt:at,capturedAt:at}});
    const latest=manual('latest','2026-10-10T04:00:00Z'),old=manual('daily-morning-2026-10-10','2026-10-10T01:00:00Z');
    const reports=[old,{...old,id:'auto',source:'scheduled'},latest,manual('future','2026-10-10T06:00:00Z')];
    assert.deepEqual(dailyMorningSaveReadReports(reports,'2026-10-10T05:00:00Z'),[latest]);
    assert.deepEqual(dailyMorningSaveReadReports(reports,'2026-10-10T00:00:00Z'),[]);
  });
  await check('MSP04-weekend-auto-once-never-overwrites-manual-or-old-auto',async()=>{
    const base=fixture(),at='2026-10-10T02:00:00Z';
    const manual=upsertDailyMorningReport(base,{at:'2026-10-10T01:00:00Z',actorUserId:'policy-owner',source:'manual'});
    const first=upsertDailyMorningReport(manual.data,{at,actorUserId:'policy-owner',source:'scheduled'});
    assert.equal(first.status,'saved','scheduled save is daily, including weekends');
    assert.equal(first.report.id,'daily-morning-2026-10-10-scheduled');assert.equal(first.report.source,'scheduled');assert.equal(first.data.agendaReports.length,2);
    assert.deepEqual(first.data.agendaReports.find(r=>r.id===manual.report.id),manual.report);
    const changed=structuredClone(first.data);changed.tasks[0].description='LATER CONTENT';
    const rerun=upsertDailyMorningReport(changed,{at:'2026-10-10T03:00:00Z',actorUserId:'different-owner',source:'scheduled'});
    assert.deepEqual(rerun.report,first.report);assert.deepEqual(rerun.data,changed);
    const oldAuto={...structuredClone(first.report),id:'daily-morning-2026-10-10'};
    assert.deepEqual(upsertDailyMorningReport({...base,agendaReports:[oldAuto]},{at,actorUserId:'policy-owner',source:'scheduled'}).report,oldAuto);
    const oldManual={...structuredClone(manual.report),id:'daily-morning-2026-10-10'};
    const next=upsertDailyMorningReport({...base,agendaReports:[oldManual]},{at,actorUserId:'policy-owner',source:'scheduled'});
    assert.equal(next.data.agendaReports.length,2);assert.deepEqual(next.data.agendaReports.find(r=>r.id===oldManual.id),oldManual);
  });
  await check('MSP05-history-same-day-source-labels-and-snapshot-count',async()=>{
    const React=(await import('react')).default,{renderToStaticMarkup}=await import('react-dom/server');
    const {MorningDailyHistoryPanel}=await server.ssrLoadModule('/src/ReportDailyHistories.tsx');
    const first=upsertDailyMorningReport(fixture(),{at:'2026-10-09T02:00:00Z',actorUserId:'policy-owner',source:'scheduled'});
    const second=upsertDailyMorningReport(first.data,{at:'2026-10-09T03:00:00Z',actorUserId:'policy-owner',source:'manual'});
    const html=renderToStaticMarkup(React.createElement(MorningDailyHistoryPanel,{reports:second.data.agendaReports,onOpen:()=>{}}));
    assert.match(html,/自動保存/);assert.match(html,/手動保存/);assert.match(html,/10:00/);assert.match(html,/共 2 份/);assert.doesNotMatch(html,/09:00自動/);
  });
  await check('MSP01-weekend-manual-appends-independent-current-frozen-snapshots',async()=>{
    const base=fixture(),before=structuredClone(base),at='2026-10-10T04:00:00.000Z';
    const first=upsertDailyMorningReport(base,{at,actorUserId:'policy-owner',source:'manual'});
    assert.equal(first.status,'saved','manual save must not be restricted to Taipei weekdays');
    assert.equal(first.report.businessDate,'2026-10-10');assert.equal(first.report.source,'manual');
    assert.deepEqual(first.report.snapshot.tasks,before.tasks);assert.equal(first.data.agendaReports.length,1);
    assert.deepEqual(base,before,'capturing must not mutate the source data');
    const fresh=structuredClone(first.data);fresh.tasks[0].description='AFTER FIRST SAVE';
    const second=upsertDailyMorningReport(fresh,{at,actorUserId:'policy-admin',source:'manual'});
    assert.equal(second.status,'saved');assert.notEqual(second.report.id,first.report.id,'two distinct clicks at the same instant require distinct identities');
    assert.equal(second.data.agendaReports.length,2);
    assert.equal(second.report.snapshot.tasks[0].description,'AFTER FIRST SAVE','each manual snapshot must freeze current content, not refresh the first snapshot');
    assert.deepEqual(second.data.agendaReports.find(r=>r.id===first.report.id),first.report,'an earlier frozen report must remain exactly unchanged');
    fresh.tasks[0].statusLogs[0].text='UNSAVED CHANGE';
    assert.equal(second.report.snapshot.tasks[0].statusLogs[0].text,'KEEP COMPLETE HISTORY');
  });
}finally{await server.close();}
const paths=['src/morningHistory.ts','src/cloudAuthorization.ts','scripts/verify-morning-save-policy.mjs'];
const receipt={status:cases.every(c=>c.status==='PASS')?'PASS':'FAIL',layer:'production-helpers-vite-SSR-not-hosted',cases,inputHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
if(process.env.QA_EVIDENCE_ROOT){const root=path.resolve(process.env.QA_EVIDENCE_ROOT);assert.ok(!root.toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'policy-receipt.json'),JSON.stringify(receipt,null,2));}
console.log(JSON.stringify(receipt));if(receipt.status!=='PASS')process.exitCode=1;
