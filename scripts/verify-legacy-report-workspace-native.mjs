import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root)&&!path.resolve(root).startsWith(path.resolve('.')+path.sep));
fs.mkdirSync(root,{recursive:true});const run=fs.mkdtempSync(path.join(root,'legacy-report-bind-'));
const fix='supabase/development/20260911_legacy_report_workspace_binding.sql';
const sha=x=>createHash('sha256').update(x).digest('hex');
const files=execFileSync('git',['ls-files','supabase','scripts','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>/\.(sql|mjs|ts|tsx)$/.test(f));
files.push('scripts/verify-legacy-report-workspace-native.mjs');if(fs.existsSync(fix))files.push(fix);
const r={kind:'legacy-original-App-report-workspace-binding',status:'RUNNING',layer:'owned loopback native PostgreSQL; no hosted/browser proof',productionContacted:false,inputs:Object.fromEntries([...new Set(files)].map(f=>[f,sha(fs.readFileSync(f))])),hashEncoding:'raw-file-bytes SHA256',cases:[]};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(r,null,2));let native,qa,failure;
try {
 native=await createNativeRecordQa(run,r);qa=await createRecordStorageLocalQa({dailyMorning:'browser',databaseFactory:async()=>native.adapter});
 const db=native.observer,w=qa.workspace,q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.r;
 const names=['sd_save_manual_itinerary_report(text,text,uuid)','delete_sd_itinerary_daily_report_records(text,text,uuid,text,jsonb)','delete_sd_itinerary_daily_reports(text,text,uuid,text,jsonb)'];
 const defs=async()=>Promise.all(names.map(async signature=>({signature,...(await db.query('select oid::text,proacl::text,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid=$1::regprocedure',[signature])).rows[0]})));
 const before=await defs();
 const columns=(await db.query("select attname from pg_attribute where attrelid='sd_workspaces'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(x=>x.attname);
 assert.ok(columns.includes('legacy_key'));assert.ok(!columns.includes('workspace_key'));r.actualWorkspaceColumns=columns;
 if(fs.existsSync(fix))await db.query(fs.readFileSync(fix,'utf8'));
 const check=async(id,fn)=>{try{await fn();r.cases.push({caseId:id,status:'PASS'});}catch(e){r.cases.push({caseId:id,status:'FAIL',code:e.code,message:String(e.message).split('\n')[0]});failure??=e;}save();};
 const wid=await q('select id r from sd_workspaces where legacy_key=$1',[w]);
 const manual=(key,id,actor='qa-owner')=>q('select sd_save_manual_itinerary_report($1,$2,$3::uuid) r',[key,actor,id]);
 let saved,op;
 await check('LR01-manual-save-exact-replay-and-formal-snapshot',async()=>{
  op=randomUUID();saved=await manual(w,op);assert.equal(saved.ok,true);assert.equal(saved.created,true);
  const snapshot=await q('select snapshot r from sd_itinerary_daily_reports where workspace_id=$1 and operation_id=$2',[wid,op]);
  assert.ok(JSON.stringify(snapshot).includes('QA FORMAL KAOHSIUNG'));assert.ok(!JSON.stringify(snapshot).includes('QA ALTERNATIVE MUST NOT PROJECT'));
  assert.deepEqual(await manual(w,op),{...saved,created:false});
  assert.equal((await manual(w,op,'different-actor')).error,'OPERATION_ID_REUSED');
  assert.equal((await manual('missing-workspace',randomUUID())).ok,false);
 });
 for(const [suffix,fn,date] of [['ids','delete_sd_itinerary_daily_report_records','2026-08-25'],['dates','delete_sd_itinerary_daily_reports','2026-08-26']])await check('LR02-delete-'+suffix+'-exact-replay',async()=>{
  await q('select sd_generate_daily_itinerary_report($1,$2::date,$3::timestamptz) r',[wid,date,date+'T01:00:00Z']);
  const reportId=await q('select report_id::text r from sd_itinerary_daily_reports where workspace_id=$1 and business_date=$2::date limit 1',[wid,date]);
  const token=await q('select sd_itinerary_daily_report_set_token($1) r',[wid]);const args=[w,'qa-owner',randomUUID(),token,JSON.stringify([suffix==='ids'?reportId:date])];
  const call=a=>q(`select ${fn}($1,$2,$3::uuid,$4,$5::jsonb) r`,a);const result=await call(args);assert.equal(result.ok,true);assert.ok(result.deletedCount>0);assert.deepEqual(await call(args),result);
  const wrong=[...args];wrong[3]='0'.repeat(32);assert.equal((await call(wrong)).error,'IDEMPOTENCY_MISMATCH');
 });
 if(fs.existsSync(fix))await check('LR03-only-exact-binding-changed-and-idempotent',async()=>{
  const after=await defs();for(let i=0;i<before.length;i++){
   assert.equal(after[i].definition,before[i].definition.replace('workspace.workspace_key','workspace.legacy_key'));
   for(const key of ['oid','proacl','prosecdef','proconfig'])assert.deepEqual(after[i][key],before[i][key]);
  }
  await db.query(fs.readFileSync(fix,'utf8'));assert.deepEqual(await defs(),after);
 });
 r.status=failure?'FAIL':'PASS';
} catch(e){failure??=e;r.status='FAIL';r.failure={code:e.code,message:String(e.message).split('\n')[0]};}
finally {
 if(qa){await qa.close();r.fixtureClosed=true;}
 if(native)try{await native.close();}catch(e){failure??=e;r.status='FAIL';r.cleanupError={code:e.code,message:String(e.message).split('\n')[0]};}
 r.inputsUnchanged=Object.entries(r.inputs).every(([f,h])=>sha(fs.readFileSync(f))===h);if(!r.inputsUnchanged){failure??=Error('input drift');r.status='FAIL';}save();
}
console.log(JSON.stringify({status:r.status,receipt:path.join(run,'receipt.json'),cases:r.cases,cleanup:{stopped:r.stopped,portClosed:r.portClosed,ownedDataRemoved:r.ownedDataRemoved}}));if(failure)process.exitCode=1;
