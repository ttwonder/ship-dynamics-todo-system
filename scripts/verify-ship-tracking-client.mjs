import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';import {installTrackingBrowserMigrations} from './tracking-browser-fixture.mjs';
const output=fs.mkdtempSync(path.join(process.env.QA_EVIDENCE_ROOT||os.tmpdir(),'ship-tracking-client-'));const evidence={label:'Actual TypeScript repository＋HTTP＋native PostgreSQL, synthetic data only',cases:[]};let native,qa,error;
const check=async(name,run)=>{await run();evidence.cases.push(name);console.log('PASS',name);};
try{
 native=await createNativeRecordQa(output,evidence,{httpTransactions:true});qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,shipTracking:true,tracking:true,taskMember:true,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);for(const file of ['20260925020000_edit_lock_holder.sql','20260925080000_ship_tracking_public.sql','20260925160000_tracking_field_revision.sql'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const {ShipTrackingRepository}=await qa.loadModule('/src/tracking/shipTracking.ts');const config=JSON.parse((await(await fetch(qa.origin+'/supabase-config.js')).text()).match(/=(\{.*\});/)[1]);
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key)};
 const repo=new ShipTrackingRepository(config,{storage,isCurrent:()=>true});
 const {newTrackingItem}=await qa.loadModule('/src/tracking/TrackingModals.tsx');const item={...newTrackingItem('qa-v1','supply'),referenceNo:'CLIENT-001',description:'Client real SQL',progress:'Client initial'};
 const submission={identity:repo.identity,context:{actorId:repo.actorKey,operationId:'client-create-1',at:new Date().toISOString()},command:{type:'create',items:[item]}};
 await check('client-submit-exact-ACK-and-authoritative-read',async()=>{const result=await repo.submit(submission);assert.equal(result.kind,'committed',result.message);assert.equal(result.snapshot.trackingItems.find(x=>x.id===item.id).description,item.description);assert.equal(await repo.release(),true);});
 await check('reload-reconciles-original-committed-envelope-without-duplicate',async()=>{const rev=(await qa.read()).revision;const recovered=new ShipTrackingRepository(config,{storage,isCurrent:()=>true});const result=await recovered.submit(submission);assert.equal(result.kind,'committed',result.message);assert.equal((await qa.read()).revision,rev);assert.notEqual(recovered.holder,repo.holder);});
 await check('corrupt-ACK-remains-unknown-until-exact-receipt-and-read',async()=>{
  const c=new ShipTrackingRepository(config,{storage,isCurrent:()=>true}),entry={...item,id:'client-corrupt-ack',referenceNo:'CLIENT-ACK'};
  const sub={...submission,command:{type:'create',items:[entry]},context:{...submission.context,operationId:'client-corrupt-ack'}};
  qa.setRecordFault({after:async({name,body,value})=>{if(name==='ship_dynamics_tracking_public_v1'&&['submit','receipt'].includes(body.p_action)&&value.status==='committed')value.vesselId='qa-v2';return false;}});
  assert.equal((await c.submit(sub)).kind,'unknown');const before=await qa.read();assert.equal(before.payload.trackingItems.filter(x=>x.id===entry.id).length,1);assert.equal(await c.release(),false);assert.equal(await c.discardRejected().catch(()=>false),false);
  qa.setRecordFault(null);assert.equal((await c.submit(sub)).kind,'committed');assert.equal((await qa.read()).revision,before.revision);assert.equal(await c.release(),true);
 });
 await check('missing-receipt-expired-original-request-is-proven-rejected-not-recreated',async()=>{
  const c=new ShipTrackingRepository(config,{storage,isCurrent:()=>true}),entry={...item,id:'client-before-sql',referenceNo:'CLIENT-NO-SQL'},sub={...submission,command:{type:'create',items:[entry]},context:{...submission.context,operationId:'client-before-sql'}};
  qa.setRecordFault({before:async({name,body})=>{if(name==='ship_dynamics_tracking_public_v1'&&body.p_action==='submit')throw Object.assign(new Error('Synthetic pre-SQL network loss'),{code:'QA_TRANSPORT'});}});
  const before=await qa.read();assert.equal((await c.submit(sub)).kind,'unknown');assert.deepEqual(await qa.read(),before);assert.equal(await c.discardRejected(),false);
  await qa.db.query("update ship_dynamics_tracking_private.bundles set expires_at=clock_timestamp()-interval '1 second' where workspace=$1 and holder=$2::uuid",[qa.workspace,c.holder]);
  qa.setRecordFault(null);assert.equal((await c.submit(sub)).kind,'rejected');assert.deepEqual(await qa.read(),before);assert.equal(await c.discardRejected(),true);
 });
 await check('config-fence-and-local-storage-failure-do-not-write-business-data',async()=>{
  let current=false;const c=new ShipTrackingRepository(config,{storage,isCurrent:()=>current}),count=qa.metrics.length;
  await assert.rejects(()=>c.load('qa-v1'),/stale-config/);assert.equal(qa.metrics.length,count);
  current=true;const failing={...storage,setItem:(key,value)=>{if(key.includes(':pending:'))throw new Error('synthetic quota');storage.setItem(key,value);}},other=new ShipTrackingRepository(config,{storage:failing,isCurrent:()=>true});
  const before=await qa.read();const sub={...submission,command:{type:'create',items:[{...item,id:'client-quota'}]},context:{...submission.context,operationId:'client-quota'}};assert.equal((await other.submit(sub)).kind,'unknown');assert.deepEqual(await qa.read(),before);assert.equal(await other.release(),true);
 });
 console.log(JSON.stringify({status:'PASS',output,caseCount:evidence.cases.length}));
}catch(e){error=e;evidence.error=e.stack;console.error(e.stack);}finally{await qa?.close();await native?.close();evidence.status=error?'FAIL':'PASS';fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,output}));if(error)process.exitCode=1;}
