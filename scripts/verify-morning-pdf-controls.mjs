import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('src/App.tsx','utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function init(name){let result;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)result=n.initializer.getText(ast);ts.forEachChild(n,visit);};visit(ast);assert.ok(result,name);return result;}
// Compile only our checked-in production callback, never network/user-provided code.
const mount=(name,c)=>new Function(...Object.keys(c),ts.transpileModule('return '+init(name),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(c));
const tick=()=>new Promise(r=>setImmediate(r));
const cases=[];
async function check(id,fn){try{await fn();cases.push({id,status:'PASS'});}catch(e){cases.push({id,status:'FAIL',error:e.message});}}
function fixture(){
 const user={id:'qa',name:'QA',role:'owner',isActive:true},vessel={id:'v1',isActive:true};
 const data={revision:17,users:[user],vessels:[vessel],tasks:[{id:'task',status:'fresh status'}],internalControlCases:[],meetings:[],agendaReports:[],settings:{rolePermissions:{}}};
 const state={open:false,capture:null,selected:null,itinerary:null,preparing:false,reads:[],prints:[],alerts:[]};let current=true;
 const c={canExportReports:true,captureReportAction:()=>()=>current,reportPreparationRef:{current:null},setReportPreparing:v=>state.preparing=v,
  activeVessels:[{id:'stale-render-vessel'}],agendaSelection:['v1'],liveData:{current:data},liveCurrentUserId:{current:'qa'},
  freshPageData:()=>structuredClone(c.liveData.current),hasPermission:()=>true,vesselMatchesUser:()=>true,
  loadRecordActionScope:async(scope,owner,fresh)=>{state.reads.push({scope,fresh});return owner();},
  requireFreshItineraryProjection:async vessels=>{state.itineraryVessels=structuredClone(vessels);return {projectionCapturedAt:'2026-09-29T01:00:00Z',itineraryProjections:{v1:{marker:'formal'}}};},
  setReportPreviewLiveCapture:v=>state.capture=v,setReportPreviewLiveItinerarySnapshot:v=>state.itinerary=v,setReportPreviewHistoryId:()=>{},setReportPreviewOpen:v=>state.open=v,
  flushSync:fn=>fn(),nowIso:()=> '2026-09-29T01:00:00Z',formatTaipeiDate:()=> '2026-09-29',structuredClone,console,
  printMorningReportPdf:(date,guard)=>state.prints.push({date,guard,openedAtDispatch:state.open}),document:{querySelector:()=>({})},
  morningReportReadError:e=>'準備 PDF：'+e.message,alert:v=>state.alerts.push(v),
 };
 return {c,state,run:mode=>mount('openReportPreview',c)(mode),cancel:()=>current=false};
}
await check('PDF-fresh-morning-read-not-full',async()=>{const f=fixture();await f.run();assert.deepEqual(f.state.reads,[{scope:'morning',fresh:true}]);assert.equal(f.state.open,true);assert.equal(f.state.preparing,false);});
await check('PDF-current-accepted-data-not-render-closure-and-immutable',async()=>{const f=fixture();f.c.loadRecordActionScope=async()=>{f.c.liveData.current={...f.c.liveData.current,revision:18,tasks:[{id:'task',status:'new confirmed progress'}]};return true;};await f.run();assert.deepEqual(f.state.itineraryVessels.map(v=>v.id),['v1']);assert.equal(f.state.capture.data.revision,18);assert.equal(f.state.capture.data.tasks[0].status,'new confirmed progress');f.c.liveData.current.tasks[0].status='later update';f.c.agendaSelection.length=0;assert.equal(f.state.capture.data.tasks[0].status,'new confirmed progress');assert.deepEqual(f.state.capture.selection,['v1']);});
await check('PDF-home-prints-after-publishing-same-preview-center-does-not',async()=>{const f=fixture();await f.run('print');assert.equal(f.state.prints.length,1);assert.equal(f.state.prints[0].openedAtDispatch,true);assert.equal(f.state.prints[0].guard(),true);f.cancel();assert.equal(f.state.prints[0].guard(),false);const center=fixture();await center.run();assert.equal(center.state.prints.length,0);assert.equal(center.state.open,true);});
for(const seam of ['read','itinerary'])await check('PDF-cancel-'+seam+'-no-late-open-or-print',async()=>{const f=fixture();let release;const gate=new Promise(r=>release=r);if(seam==='read')f.c.loadRecordActionScope=async()=>{await gate;return true;};else f.c.requireFreshItineraryProjection=async()=>{await gate;return {};};const work=f.run('print');await tick();assert.equal(f.state.preparing,true);f.cancel();release();await work;assert.equal(f.state.open,false);assert.equal(f.state.prints.length,0);assert.equal(f.state.preparing,false);});
await check('PDF-double-click-one-flight',async()=>{const f=fixture(),releases=[];f.c.loadRecordActionScope=async()=>{await new Promise(r=>releases.push(r));return true;};const first=f.run('print');await tick();const second=f.run('print');await tick();const calls=releases.length;releases.forEach(r=>r());await Promise.all([first,second]);assert.equal(calls,1);assert.equal(f.state.prints.length,1);});
await check('PDF-empty-authorized-selection-never-prints-blank-report',async()=>{const f=fixture();f.c.agendaSelection=['no-longer-authorized'];await f.run('print');assert.equal(f.state.prints.length,0);assert.equal(f.state.open,true);});
await check('PDF-read-failure-no-old-print',async()=>{const f=fixture();f.c.loadRecordActionScope=async()=>false;await f.run('print');assert.equal(f.state.open,false);assert.equal(f.state.prints.length,0);assert.equal(f.state.preparing,false);});
await check('PDF-role-denied-zero-read',async()=>{const f=fixture();f.c.canExportReports=false;await f.run('print');assert.equal(f.state.reads.length,0);assert.equal(f.state.open,false);});
console.log(JSON.stringify({layer:'actual-App-callback-controlled-IO',status:cases.every(c=>c.status==='PASS')?'PASS':'FAIL',cases},null,2));
if(cases.some(c=>c.status!=='PASS'))process.exitCode=1;
