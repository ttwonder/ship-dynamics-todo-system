import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

// Private native regression for the reviewed multi-workspace transaction cycle.
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root)&&!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'cross-workspace-'));
const receipt={kind:'record-cross-workspace-native',status:'RUNNING',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),productionContacted:false,cases:[],inputs:Object.fromEntries(['scripts/verify-record-cross-workspace-native.mjs','supabase/development/20260906_appdata_record_store.sql'].map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let native,qa,a,b,error;
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({databaseFactory:async()=>native.adapter});
 a=await native.connect('cross_A');b=await native.connect('cross_B');
 await a.query("set deadlock_timeout='100ms';set statement_timeout='4s'");
 await b.query("set deadlock_timeout='100ms';set statement_timeout='4s'");
 const x=qa.workspace,y='isolated-record-cross-peer';
 const read=async w=>(await native.observer.query('select read_ship_dynamics_records_v1($1) r',[w])).rows[0].r;
 const seed=(await read(x)).payload;
 assert.equal((await native.observer.query('select import_ship_dynamics_records_v1($1,$2::jsonb) r',[y,JSON.stringify(seed)])).rows[0].r.ok,true);
 const bases={[x]:await read(x),[y]:await read(y)};
 const receipts=async()=>(await native.observer.query('select workspace_key,operation_id,result from ship_dynamics_record_receipts where workspace_key=any($1::text[]) order by workspace_key,operation_id',[[x,y]])).rows;
 const baselineReceipts=await receipts();
 const apply=async(c,w,id)=>(await c.query("select apply_ship_dynamics_record_patch_v1($1,$2,'[]'::jsonb,'QA OWNER','qa-owner',ship_dynamics_actor_guard($3::jsonb,'qa-owner'),ship_dynamics_authorization_guard($3::jsonb),'[]'::jsonb) r",[w,id,JSON.stringify(bases[w].payload)])).rows[0].r;
 const apid=Number((await a.query('select pg_backend_pid() pid')).rows[0].pid),bpid=Number((await b.query('select pg_backend_pid() pid')).rows[0].pid);
 assert.notEqual(apid,bpid);await a.query('begin');await b.query('begin');
 assert.equal((await apply(a,x,'cross-A-first-X')).ok,true);
 assert.equal((await apply(b,y,'cross-B-first-Y')).ok,true);
 let aDone=false,aOutcome;
 const ax=apply(a,y,'cross-A-second-Y').then(result=>aOutcome={kind:'result',result},e=>aOutcome={kind:'error',code:e.code,message:e.message}).finally(()=>{aDone=true;});
 let waiting;
 const end=Date.now()+1800;
 while(!aDone&&Date.now()<end){
  waiting=(await native.observer.query('select pid,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[apid])).rows.find(r=>r.blockers.includes(bpid));
  if(waiting)break;await pause(10);
 }
 assert.ok(aDone||waiting,'A either fails fast or is proven blocked by B before B switches');
 const by=apply(b,x,'cross-B-second-X').then(result=>({kind:'result',result}),e=>({kind:'error',code:e.code,message:e.message}));
 const [,bOutcome]=await Promise.all([ax,by]);
 receipt.cross={workspaces:[x,y],backendPids:[apid,bpid],aInitiallyBlockedByB:Boolean(waiting),a:aOutcome,b:bOutcome};save();
 await a.query('rollback');await b.query('rollback');
 assert.deepEqual(await receipts(),baselineReceipts,'failed explicit transactions leave no first-operation receipts');
 assert.deepEqual(await read(x),bases[x]);assert.deepEqual(await read(y),bases[y]);
 receipt.cross.completeRollback=true;
 const errors=[aOutcome,bOutcome].filter(o=>o.kind==='error');
 assert.ok(errors.some(o=>o.code==='40001'),'cross-workspace contention must fail as 40001, not a PostgreSQL deadlock or timeout');
 assert.ok(errors.every(o=>o.code==='40001'),'no 40P01 or 57014 is acceptable');
 receipt.cases.push({id:'X1-contended-cross-workspace-switch',status:'PASS',completeRollback:true});save();
 // Same gate primitive at both normal/coarse cross-workspace boundaries.
 const importReplay=async(c,w)=>(await c.query('select import_ship_dynamics_records_v1($1,$2::jsonb) r',[w,JSON.stringify(seed)])).rows[0].r;
 const boundaryCodes=[];
 for(const targetCoarse of [true,false]){
  await a.query('begin');await b.query('begin');
  assert.equal((await apply(a,x,'cross-boundary-first-X')).ok,true);
  assert.equal((targetCoarse?await importReplay(b,y):await apply(b,y,'cross-boundary-first-Y')).ok,true);
  await assert.rejects(targetCoarse?apply(a,y,'cross-boundary-normal-Y'):importReplay(a,y),e=>{boundaryCodes.push(e.code);return e.code==='40001';});
  await a.query('rollback');await b.query('rollback');
  assert.deepEqual(await receipts(),baselineReceipts);
  assert.deepEqual(await read(x),bases[x]);assert.deepEqual(await read(y),bases[y]);
 }
 await a.query('begin');
 assert.equal((await apply(a,x,'cross-boundary-uncontended-X')).ok,true);
 assert.equal((await importReplay(a,y)).ok,true);
 assert.equal((await apply(a,y,'cross-boundary-uncontended-Y')).ok,true);
 await a.query('rollback');
 assert.deepEqual(await receipts(),baselineReceipts);
 for(const role of ['anon','authenticated']){
  await a.query('begin');await a.query('set local role '+role);
  await assert.rejects(a.query('select ship_dynamics_record_other_writer_held_v1($1)',[x]),e=>e.code==='42501');
  await a.query('rollback');
 }
 receipt.cases.push({id:'X3-normal-coarse-cross-workspace-boundaries',status:'PASS',boundaryCodes,uncontendedSuccess:true,completeRollback:true,helperRolesDenied:['anon','authenticated']});save();
 await a.query('begin');
 const p1=await apply(a,x,'cross-positive-X'),p2=await apply(a,y,'cross-positive-Y');
 assert.equal(p1.ok,true);assert.equal(p2.ok,true);await a.query('commit');
 const positive=await receipts();assert.equal(positive.length,baselineReceipts.length+2);
 assert.equal(positive.filter(r=>r.operation_id==='cross-positive-X'&&r.workspace_key===x).length,1);
 assert.equal(positive.filter(r=>r.operation_id==='cross-positive-Y'&&r.workspace_key===y).length,1);
 assert.deepEqual(await read(x),bases[x]);assert.deepEqual(await read(y),bases[y]);
 receipt.cases.push({id:'X2-uncontended-cross-workspace-positive',status:'PASS',exactReceipts:true});
 receipt.status='PASS';
}catch(e){error=e;receipt.status='FAIL';receipt.failure={message:e.message,code:e.code,stack:e.stack?.split('\n').slice(0,6)};}
finally{
 for(const c of [a,b])if(c)try{await c.query('rollback');}catch{}
 for(const c of [a,b])if(c)try{await c.end();}catch{}
 if(qa)try{await qa.close();receipt.fixtureClosed=true;}catch(e){error??=e;receipt.status='FAIL';receipt.fixtureCleanupError=e.message;}
 if(native)try{await native.close();}catch(e){error??=e;receipt.status='FAIL';receipt.cleanupError=e.message;}
 save();
}
console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases,crossCodes:receipt.cross?[receipt.cross.a.code||receipt.cross.a.result?.status,receipt.cross.b.code||receipt.cross.b.result?.status]:null,stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved,failure:receipt.failure}));
if(error)process.exitCode=1;
