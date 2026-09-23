import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {shipInternalControlInput,installShipInternalControlFixture,shipInternalControlMigration} from './ship-internal-control-local-fixture.mjs';
const migration='supabase/migrations/20260923120000_ship_internal_control_due_date.sql';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ship-dates-sql-'));
const receipt={kind:'真實本機 PostgreSQL＋測試資料；非正式環境',status:'RUNNING',cases:[],productionContacted:false};
let native,qa,failure;const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
try {
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({scopedRead:true,browserAuthority:true,performanceTrace:true,preparePerformanceFixture:shipInternalControlInput,databaseFactory:async()=>native.adapter});
 await installShipInternalControlFixture(native.adapter,qa.workspace);
 const {observer,a}=native,w=qa.workspace;
 // Rehearse an actual installed old version and existing immutable receipt.
 await observer.query(fs.readFileSync(shipInternalControlMigration,'utf8'));
 const row={reportDate:'2026-09-23',reportSource:'日常',description:'QA DL native SQL',priority:'低',category:'維修',equipmentSubcategory:'',isAware:false,status:'待處理',departments:['管理組']};
 const args=(items)=>[w,'qa-v1',randomUUID(),randomUUID(),JSON.stringify(items)];
 const tx=async(fn)=>{await a.query('begin;set local role anon');try{const r=await fn();await a.query('commit');return r;}catch(e){await a.query('rollback');throw e;}};
 const call=(name,p)=>tx(async()=>(await a.query(`select ${name}($1,$2,$3::uuid,$4::uuid,$5::jsonb) r`,p)).rows[0].r);
 const submit=p=>call('submit_ship_dynamics_internal_control_public_v1',p),status=p=>call('get_ship_dynamics_internal_control_public_receipt_v1',p);
 const check=async(caseId,fn)=>{await fn();receipt.cases.push({caseId,status:'PASS'});save();};
 const oldRequest=args([row]),oldReceipt=await submit(oldRequest),before=await qa.read();
 if(fs.existsSync(migration))await observer.query(fs.readFileSync(migration,'utf8'));
 await check('DL-SQL01-additive-upgrade-and-old-exact-receipt',async()=>{
   assert.deepEqual(await qa.read(),before,'DDL never rewrites historical records');
   assert.deepEqual(await status(oldRequest),{...oldReceipt,replayed:true});assert.deepEqual(await submit(oldRequest),{...oldReceipt,replayed:true});
 });
 const request=args([{...row,expectedDate:'2026-10-10'}]);let committed;
 await check('DL-SQL02-anonymous-DL-stored-without-closure',async()=>{
   committed=await submit(request);assert.equal(committed.status,'committed');
   const after=await qa.read(),item=after.payload.internalControlCases.find(c=>c.id===committed.case_ids[0]);
   assert.equal(item.expectedDate,'2026-10-10');assert.equal(item.isClosed,false);assert.equal(item.closedDate,undefined);assert.equal(item.linkedTaskId,undefined);assert.equal(after.payload.tasks.length,0);
   const {normalizeAppData}=await qa.loadModule('/src/normalize.ts');assert.equal(normalizeAppData(after.payload).internalControlCases.find(c=>c.id===item.id).expectedDate,'2026-10-10');
 });
 await check('DL-SQL03-exact-replay-and-date-tamper-binding',async()=>{
   const before=await qa.read();assert.deepEqual(await status(request),{...committed,replayed:true});assert.deepEqual(await submit(request),{...committed,replayed:true});
   const altered=[...request];altered[4]=JSON.stringify([{...row,expectedDate:'2026-10-11'}]);
   await assert.rejects(()=>status(altered),e=>e.message==='ship-internal-operation-id-mismatch');assert.deepEqual(await qa.read(),before);
 });
 await check('DL-SQL04-invalid-dates-and-closure-injection-zero-write',async()=>{
   const before=await qa.read();
   for(const bad of ['2026-02-30','2026-13-01','0000-01-01','2026/10/10',true,null])await assert.rejects(()=>submit(args([row,{...row,expectedDate:bad}])),e=>e.code==='22023');
   for(const bad of [{isClosed:true},{closedDate:'2026-10-10'},{syncToTask:true}])await assert.rejects(()=>submit(args([{...row,expectedDate:'2026-10-10',...bad}])),e=>e.code==='22023');
   assert.deepEqual(await qa.read(),before);
 });
 await check('DL-SQL05-blank-date-and-idempotent-upgrade',async()=>{
   const result=await submit(args([{...row,expectedDate:''}]));assert.equal((await qa.read()).payload.internalControlCases.find(c=>c.id===result.case_ids[0]).expectedDate,'');
   const before=await qa.read();await observer.query(fs.readFileSync(migration,'utf8'));assert.deepEqual(await qa.read(),before);assert.equal((await status(oldRequest)).replayed,true);
   assert.equal((await observer.query("select has_function_privilege('anon','ship_dynamics_internal_control_private.request_v1(text,text,uuid,uuid,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 const readback='supabase/verification/ship_internal_control_due_date_readback.sql';
 if(fs.existsSync(readback))await check('DL-SQL06-readonly-deployment-fingerprint',async()=>{
   const result=await observer.query(fs.readFileSync(readback,'utf8'));const rows=result.flatMap(r=>r.rows);const summary=rows.find(r=>Object.hasOwn(r,'failed_checks'));assert.ok(summary);assert.equal(summary.result,'PASS',JSON.stringify(summary));assert.deepEqual(summary.failed_checks,[]);receipt.readbackChecks=Number(summary.checks);
 });
 receipt.status='PASS';receipt.migrationSha256=createHash('sha256').update(fs.readFileSync(migration)).digest('hex');
} catch(e){failure=e;receipt.status='FAIL';receipt.error={code:e.code,message:e.message,where:e.where};}
finally{if(qa)await qa.close();if(native)await native.close();save();}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,receipt:path.join(run,'receipt.json'),error:receipt.error}));if(failure)process.exitCode=1;
