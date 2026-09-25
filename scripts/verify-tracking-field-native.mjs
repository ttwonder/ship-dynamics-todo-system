import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const output=fs.mkdtempSync(path.join(root,'tracking-field-native-'));
const evidence={label:'真實 PostgreSQL＋測試資料，非正式 Supabase',cases:[],productionContacted:false};
let native,qa,failure;
const check=async(name,run)=>{await run();evidence.cases.push(name);console.log('PASS',name);};
try {
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);
 await qa.db.exec(fs.readFileSync('supabase/migrations/20260925020000_edit_lock_holder.sql','utf8'));
 await qa.db.exec(fs.readFileSync('supabase/migrations/20260925080000_ship_tracking_public.sql','utf8'));
 const migration='supabase/migrations/20260925160000_tracking_field_revision.sql';
 if(fs.existsSync(migration)&&!process.argv.includes('--before-upgrade')) {
  const pre=async(action,payload)=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');return (await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) result',[qa.workspace,'qa-v1','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',action,JSON.stringify(payload)])).rows[0].result;});
  const legacyItem={id:'pre-field-upgrade',kind:'supply',vesselId:'qa-v1',referenceNo:'PRE-UPGRADE',description:'舊版原提交',applicationDate:'2026-09-25',urgency:'normal',progress:'',expectedDate:'',supplementalNotes:'',deliveryStatus:'not-delivered'};
  const bundleId=crypto.randomUUID(),request={operationId:'pre-field-upgrade',bundleId,command:{type:'create',items:[legacyItem]}};
  assert.equal((await pre('claim',{bundleId,ids:[legacyItem.id],creation:true})).ok,true);assert.equal((await pre('submit',request)).status,'committed');await pre('release',{bundleId});
  const before=await qa.read();const raw=fs.readFileSync(migration,'utf8');const sql=process.argv.includes('--crlf-install')?raw.replace(/\r?\n/g,'\r\n'):raw;
  await qa.db.exec(sql);await qa.db.exec(sql);assert.deepEqual(await qa.read(),before);
  assert.equal((await pre('submit',request)).replayed,true);assert.deepEqual(await qa.read(),before);evidence.cases.push('pre-upgrade-exact-submission-replays-after-idempotent-upgrade-without-data-rewrite');
  evidence.migrationInstalled=true;
 } else evidence.migrationInstalled=false;
 const rpc=async(action,payload={})=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');return (await tx.query('select public.ship_dynamics_tracking_public_v1($1,$2,$3::uuid,$4::uuid,$5,$6::jsonb) result',[qa.workspace,'qa-v1','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',action,JSON.stringify(payload)])).rows[0].result;});
 const base={vesselId:'qa-v1',description:'欄位原生測試',applicationDate:'2026-09-25',urgency:'normal',progress:'初始進度',supplementalNotes:'',expectedDate:'2026-10-01',deliveryStatus:'not-delivered',purchaseNos:'000001'};
 const types=[['repair','engineering'],['drydock','engineering'],['semiannual-materials','supply'],['temporary-materials','supply'],['spares','supply']];
 const items=types.map(([requestType,kind],i)=>({...base,id:'field-native-'+i,referenceNo:'FIELD-NATIVE-'+i,kind,requestType}));
 const submit=async(name,ids,creation,make)=>{
  const bundleId=crypto.randomUUID();const claim=await rpc('claim',{bundleId,ids,creation});assert.equal(claim.ok,true,JSON.stringify(claim));
  const command=make(claim.data.trackingItems);const request={operationId:name,bundleId,command};
  try {return {request,result:await rpc('submit',request)};}finally{await rpc('release',{bundleId});}
 };
 await check('five-type-create-readback-idempotent-legacy-and-kind-guard',async()=>{
  const {request,result}=await submit('five-type-create',items.map(row=>row.id),true,()=>({type:'create',items}));
  assert.equal(result.status,'committed',JSON.stringify(result));
  const saved=await rpc('read');for(const item of items)assert.equal(saved.trackingItems.find(row=>row.id===item.id)?.requestType,item.requestType,'public read retains type');
  const after=await qa.read();assert.equal((await rpc('submit',request)).replayed,true);assert.deepEqual(await qa.read(),after);
  for(const [i,requestType,kind] of [[0,'repair','supply'],[1,'arbitrary','engineering']]) {
   const wrong={...base,id:'field-invalid-'+i,referenceNo:'INVALID',requestType,kind};const before=await qa.read();
   const {result:rejected}=await submit('type-invalid-'+i,[wrong.id],true,()=>({type:'create',items:[wrong]}));assert.equal(rejected.status,'rejected');assert.deepEqual(await qa.read(),before);
  }
  const legacy={...base,id:'legacy-field',referenceNo:'LEGACY',kind:'supply'};
  assert.equal((await submit('legacy-field-create',[legacy.id],true,()=>({type:'create',items:[legacy]}))).result.status,'committed');
  assert.equal((await rpc('read')).trackingItems.find(row=>row.id===legacy.id).requestType,undefined);
 });
 await check('linked-edit-progress-actual-date-type-and-purchase-number-one-transaction',async()=>{
  const id=items[2].id;
  assert.equal((await submit('field-sync',[id],false,rows=>({type:'sync',reporterNameAndRole:'QA 測試／大副',items:[{id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt,item:{id:'field-native-case',reportDate:'2026-09-25',reportSource:'日常',description:'內控原內文',priority:'低',category:'維修',equipmentSubcategory:'',isAware:false,status:'初始進度',departments:['督導'],expectedDate:'2026-10-02'}}]}))).result.status,'committed');
  const before=await qa.read();const caseBefore=before.payload.internalControlCases.find(row=>row.id==='field-native-case');
  const {request,result}=await submit('field-full-edit',[id],false,rows=>({type:'edit',items:[{id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt,changes:{requestType:'temporary-materials',purchaseNos:'000099',description:'來源新內文',actualDeliveryDate:'2026-09-26',progress:'批量更新進度'}}]}));
  assert.equal(result.status,'committed',JSON.stringify(result));const saved=(await rpc('read')),row=saved.trackingItems.find(row=>row.id===id),linked=saved.cases.find(row=>row.id==='field-native-case');
  assert.equal(row.deliveryStatus,'delivered');assert.equal(row.isClosed,false);assert.equal(row.actualDeliveryDate,'2026-09-26');assert.equal(row.purchaseNos,'000099');assert.equal(row.requestType,'temporary-materials');assert.equal(row.statusLogs[0].text,'批量更新進度');assert.equal(row.events.at(-1).action,'delivery');
  assert.equal(linked.status,row.progress);assert.equal(linked.description,caseBefore.description);assert.equal(linked.expectedDate,caseBefore.expectedDate);assert.equal(linked.isClosed,false);
  const after=await qa.read();assert.equal(after.revision,before.revision+1);assert.deepEqual(after.payload.trackingItems.filter(row=>row.id!==id),before.payload.trackingItems.filter(row=>row.id!==id));
  assert.equal((await rpc('submit',request)).replayed,true);assert.deepEqual(await qa.read(),after);
 });
 await check('batch-engineering-completion-stale-negative-and-independent-closure',async()=>{
  const ids=items.filter(row=>row.kind==='engineering').map(row=>row.id);const before=await qa.read();
  const {result:bad}=await submit('field-completion-stale',ids,false,rows=>({type:'edit',items:ids.map((id,i)=>({id,expectedUpdatedAt:i?'stale':rows.find(r=>r.id===id).updatedAt,changes:{completionDate:'2026-09-27'}}))}));assert.equal(bad.status,'rejected');assert.deepEqual(await qa.read(),before);
  const {result}=await submit('field-completion',ids,false,rows=>({type:'edit',items:ids.map(id=>({id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt,changes:{completionDate:'2026-09-27'}}))}));assert.equal(result.status,'committed',JSON.stringify(result));
  for(const id of ids){const row=(await rpc('read')).trackingItems.find(r=>r.id===id);assert.equal(row.completionDate,'2026-09-27');assert.equal(row.isClosed,false);assert.equal(row.events.at(-1).action,'completion');}
  for(const action of ['close','reopen']) {
   assert.equal((await submit('field-engine-'+action,ids,false,rows=>({type:'lifecycle',action,date:'2026-09-28',targets:ids.map(id=>({entry:'tracking',id,expectedUpdatedAt:rows.find(r=>r.id===id).updatedAt}))}))).result.status,'committed');
   for(const id of ids){const row=(await rpc('read')).trackingItems.find(r=>r.id===id);assert.equal(row.completionDate,'2026-09-27');assert.equal(row.isClosed,action==='close');}
  }
 });
 await check('private-field-helper-remains-denied-to-anonymous-caller',async()=>{
  await assert.rejects(()=>qa.db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select ship_dynamics_tracking_private.edit_fields_v1()');}),/permission denied/);
 });
 const readback='supabase/verification/tracking-field-revision-readback.sql';if(fs.existsSync(readback)){const sql=fs.readFileSync(readback,'utf8');const prefix=sql.slice(sql.indexOf('with public_rpc'),sql.indexOf('), checks as ('))+')';evidence.fingerprint=(await qa.db.query(prefix+" select md5(string_agg(identity||E'\\n'||definition,E'\\n' order by identity)) fingerprint from definitions")).rows[0].fingerprint;console.log('Installed field revision fingerprint',evidence.fingerprint);const r=await qa.db.exec(sql);const row=r.flatMap(x=>x.rows||[]).find(x=>x.status);assert.equal(row?.status,'PASS',JSON.stringify(row));evidence.readback=row;}
} catch(error){failure=error;evidence.error=error.stack;console.error(error.stack);}
finally{try{await qa?.close();await native?.close();}catch(error){failure??=error;evidence.cleanupError=error.message;}evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,output,caseCount:evidence.cases.length}));if(failure)process.exitCode=1;}
