import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {shipInternalControlInput,installShipInternalControlFixture,shipInternalControlMigration} from './ship-internal-control-local-fixture.mjs';

const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ship-internal-sql-'));
const receipt={kind:'真實本機 PostgreSQL＋合成資料；非正式環境',status:'RUNNING',cases:[],productionContacted:false};
let native,qa,failure;
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
try{
  native=await createNativeRecordQa(run,receipt);
  qa=await createRecordStorageLocalQa({scopedRead:true,browserAuthority:true,performanceTrace:true,preparePerformanceFixture:shipInternalControlInput,databaseFactory:async()=>native.adapter});
  await installShipInternalControlFixture(native.adapter,qa.workspace);
  const {observer,a,b}=native,w=qa.workspace,actor=randomUUID();
  const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
  const tx=async(c,fn,role='anon')=>{await c.query('begin;set local role '+role);try{const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}};
  const check=async(caseId,fn)=>{await fn();receipt.cases.push({caseId,status:'PASS'});save();};
  const row=(patch={})=>({reportDate:'2026-09-19',reportSource:'日常',description:'QA 船端單筆訴求',priority:'高',category:'維修',equipmentSubcategory:'',isAware:false,status:'請岸端安排',departments:['管理組'],...patch});
  const args=(items=[row()],operation=randomUUID(),vessel='qa-v1',actorKey=actor)=>[w,vessel,actorKey,operation,JSON.stringify(items)];
  const submit=(c,x)=>q(c,'select submit_ship_dynamics_internal_control_public_v1($1,$2,$3::uuid,$4::uuid,$5::jsonb) r',x);
  const status=(c,x)=>q(c,'select get_ship_dynamics_internal_control_public_receipt_v1($1,$2,$3::uuid,$4::uuid,$5::jsonb) r',x);
  const read=()=>qa.read();
  await check('SQL01-anonymous-single-create-authoritative-readback',async()=>{
    const before=await read(),request=args(),result=await tx(a,c=>submit(c,request));
    assert.equal(result.status,'committed');assert.equal(result.operation_id,request[3]);assert.equal(result.item_count,1);assert.equal(result.revision,before.revision+1);
    const after=await read();assert.equal(after.payload.internalControlCases.length,1);
    const item=after.payload.internalControlCases[0];assert.equal(item.id,result.case_ids[0]);assert.equal(item.description,'QA 船端單筆訴求');assert.equal(item.isClosed,false);assert.equal(item.createdBy,'public-vessel:qa-v1');
    assert.equal(after.payload.tasks.length,0);assert.deepEqual(after.payload.users,before.payload.users);assert.deepEqual(after.payload.vessels,before.payload.vessels);
    assert.deepEqual(await tx(b,c=>status(c,request)),{...result,replayed:true});
  });
  const tables=(await observer.query("select tablename from pg_tables where schemaname='public' and tablename like 'ship_dynamics_record%' order by tablename")).rows.map(r=>r.tablename);
  const ledger=async()=>{const out={};for(const name of tables){assert.match(name,/^[a-z_0-9]+$/);out[name]=await q(observer,`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'null')) r from public.${name} t`);}return out;};
  await check('SQL02-public-catalog-is-minimal-and-current',async()=>{
    const list=await tx(a,c=>q(c,'select read_ship_dynamics_internal_control_public_v1($1,null) r',[w]));
    assert.deepEqual(list.vessels.map(v=>v.id),['qa-v1','qa-v2']);assert.equal(list.catalog,null);
    const detail=await tx(a,c=>q(c,"select read_ship_dynamics_internal_control_public_v1($1,'qa-v1') r",[w]));
    assert.deepEqual(Object.keys(detail.catalog).sort(),['departments','equipmentFailureSubcategories','priorities','taskCategories'].sort());
    assert.doesNotMatch(JSON.stringify(detail),/password|managedVesselIds|delegateManagers|internalControlCases|qa-manager|users/);
    assert.equal(await tx(a,c=>q(c,'select read_ship_dynamics_internal_control_public_revision_v1($1) r',[w])),(await read()).revision);
  });
  let batchRequest,batchReceipt;
  await check('SQL03-batch-fields-order-work-center-and-no-tasks',async()=>{
    const before=await read();
    const items=[row({description:'QA 批次一',isAware:true}),row({description:'QA 批次二',priority:'急',category:'設備故障',equipmentSubcategory:before.payload.settings.equipmentFailureSubcategories[0],reportSource:'外部',departments:[],status:'保留完整設備狀態'})];
    batchRequest=args(items);batchReceipt=await tx(a,c=>submit(c,batchRequest));
    const after=await read();assert.equal(batchReceipt.item_count,2);assert.equal(after.revision,before.revision+1);
    assert.deepEqual(after.payload.tasks,before.payload.tasks);assert.deepEqual(after.payload.internalControlCases.slice(0,2).map(c=>c.description),items.map(r=>r.description));
    for(const [i,actual] of after.payload.internalControlCases.slice(0,2).entries()){
      for(const key of ['reportDate','reportSource','description','priority','category','isAware','status','departments'])assert.deepEqual(actual[key],items[i][key]);
      assert.equal(actual.syncToTask,false);assert.equal(actual.isClosed,false);assert.equal(actual.linkedTaskId,undefined);assert.equal(actual.closedDate,undefined);
      assert.equal(actual.statusLogs[0].text,actual.status);assert.equal(actual.statusLogs[0].byUserId,'public-vessel:qa-v1');
    }
    const {selectUserWorkCenterInternalCases}=await qa.loadModule('/src/workCenterScope.ts');
    for(const id of ['qa-manager','qa-delegate'])assert.equal(selectUserWorkCenterInternalCases(after.payload,after.payload.users.find(u=>u.id===id),after.payload.vessels.filter(v=>v.isActive)).length,3);
    for(const id of ['qa-inactive-delegate','qa-unrelated'])assert.equal(selectUserWorkCenterInternalCases(after.payload,after.payload.users.find(u=>u.id===id),after.payload.vessels.filter(v=>v.isActive)).length,0);
    assert.deepEqual((await q(observer,'select read_ship_dynamics_record_history_v1($1,$2) r',[w,before.revision])).payload,before.payload);
    const normalized=(await qa.loadModule('/src/normalize.ts')).normalizeAppData(after.payload);assert.equal(normalized.internalControlCases.length,after.payload.internalControlCases.length);
  });
  await check('SQL04-invalid-batch-and-capability-fields-roll-back',async()=>{
    const before=await ledger();
    const invalid=[[],Array.from({length:101},()=>row()),[row(),row({reportDate:'2026-02-30'})],[row({description:''})],[row({description:'x'.repeat(10001)})],[row({priority:'未知'})],[row({category:'未配置'})],[row({departments:['未配置']})],[row({category:'設備故障',equipmentSubcategory:'未配置'})],...[{syncToTask:true},{syncToTask:false},{isClosed:true},{createdBy:'qa-owner'},{linkedTaskId:'existing'},{vesselResponsibilities:[]},{id:'existing'},{ownerUserIds:['qa-owner']}].map(x=>[row(x)])];
    for(const items of invalid)await assert.rejects(()=>tx(a,c=>submit(c,args(items))),e=>e.code==='22023');
    for(const id of ['qa-disabled-vessel','missing-vessel'])await assert.rejects(()=>tx(a,c=>submit(c,args([row()],randomUUID(),id))),e=>e.message==='ship-internal-vessel-unavailable');
    assert.deepEqual(await ledger(),before);
  });
  await check('SQL05-exact-replay-and-body-vessel-actor-binding',async()=>{
    const before=await ledger();assert.deepEqual(await tx(b,c=>submit(c,batchRequest)),{...batchReceipt,replayed:true});
    const variants=[structuredClone(batchRequest),structuredClone(batchRequest),structuredClone(batchRequest)];
    variants[0][4]=JSON.stringify(JSON.parse(batchRequest[4]).reverse());variants[1][1]='qa-v2';variants[2][2]=randomUUID();
    for(const request of variants)for(const call of [submit,status])await assert.rejects(()=>tx(a,c=>call(c,request)),e=>e.message==='ship-internal-operation-id-mismatch');
    assert.deepEqual(await ledger(),before);
  });
  await check('SQL06-receipt-failure-rolls-back-whole-batch',async()=>{
    const before=await ledger();await observer.query("create sequence qa_ship_receipt_reached;create function qa_ship_receipt_fault() returns trigger language plpgsql as $$begin if new.operation_id like 'ship-internal:%' then perform nextval('qa_ship_receipt_reached');raise exception 'qa-ship-late-failure';end if;return new;end$$;create trigger qa_ship_receipt_fault after insert on ship_dynamics_record_receipts for each row execute function qa_ship_receipt_fault()");
    try{await assert.rejects(()=>tx(a,c=>submit(c,args([row(),row({description:'第二筆'})]))),e=>e.message==='qa-ship-late-failure');assert.equal(await q(observer,'select is_called r from qa_ship_receipt_reached'),true);}finally{await observer.query('drop trigger qa_ship_receipt_fault on ship_dynamics_record_receipts;drop function qa_ship_receipt_fault();drop sequence qa_ship_receipt_reached');}
    assert.deepEqual(await ledger(),before);
  });
  await check('SQL07-independent-connections-one-operation-one-commit',async()=>{
    const before=await read(),request=args([row({description:'QA 並行相同提交'})]);let peer;
    await a.query('begin;set local role anon');const first=await submit(a,request);
    try{
      peer=tx(b,c=>submit(c,request));const end=Date.now()+4000;let barrier=false;
      while(Date.now()<end){const row=(await observer.query('select pg_blocking_pids($1) pids',[b.processID])).rows[0];if(row.pids.includes(a.processID)){barrier=true;break;}await new Promise(r=>setTimeout(r,20));}
      assert.equal(barrier,true,'actual peer must wait for the first uncommitted writer');await a.query('commit');assert.deepEqual(await peer,{...first,replayed:true});
    }finally{await a.query('rollback');if(peer)await peer.catch(()=>{});}
    const after=await read();assert.equal(after.revision,before.revision+1);assert.equal(after.payload.internalControlCases.filter(c=>c.description==='QA 並行相同提交').length,1);
  });
  await check('SQL08-paused-and-retired-source-recover-old-not-new',async()=>{
    const pauseId=randomUUID(),paused=await tx(a,c=>q(c,'select pause_ship_dynamics_business_v1($1,$2::uuid) r',[w,pauseId]),'service_role');
    const before=await ledger();assert.equal((await tx(b,c=>submit(c,batchRequest))).replayed,true);
    await assert.rejects(()=>tx(b,c=>submit(c,args())),e=>e.message==='business-writes-paused');assert.deepEqual(await ledger(),before);
    await tx(a,c=>q(c,'select resume_ship_dynamics_business_v1($1,$2::uuid,$3::jsonb) r',[w,pauseId,JSON.stringify(paused.watermark)]),'service_role');
    await observer.query("update ship_dynamics_authority_private.current_v1 set source='legacy' where workspace_key=$1",[w]);
    try{const retired=await ledger();assert.equal((await tx(b,c=>status(c,batchRequest))).replayed,true);await assert.rejects(()=>tx(b,c=>submit(c,args())),e=>e.message==='source-authority-retired');assert.deepEqual(await ledger(),retired);}finally{await observer.query("update ship_dynamics_authority_private.current_v1 set source='records-v1' where workspace_key=$1",[w]);}
  });
  await check('SQL09-anon-has-no-table-or-private-materializer-access',async()=>{
    for(const role of ['anon','authenticated']){
      for(const table of ['ship_dynamics_records','ship_dynamics_record_workspaces','ship_dynamics_record_receipts'])for(const right of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await q(observer,'select has_table_privilege($1,$2,$3) r',[role,table,right]),false);
      assert.equal(await q(observer,"select has_function_privilege($1,'public.ship_dynamics_record_commit_validated_v1(text,jsonb,jsonb,jsonb,text,text,jsonb)','EXECUTE') r",[role]),false);
      assert.equal(await q(observer,"select has_schema_privilege($1,'ship_dynamics_internal_control_private','USAGE') r",[role]),false);
    }
  });
  await check('SQL10-max-batch-and-additive-reinstall',async()=>{
    const before=await read(),result=await tx(a,c=>submit(c,args(Array.from({length:100},(_,i)=>row({description:'QA 上限 '+i})))));
    assert.equal(result.item_count,100);assert.equal((await read()).revision,before.revision+1);
    const state=await ledger();await observer.query(fs.readFileSync(shipInternalControlMigration,'utf8'));assert.deepEqual(await ledger(),state);
  });
  const seedPublished=async(operations,patchOrders={})=>{
    await observer.query('begin');
    try{
      await observer.query('select ship_dynamics_record_writer_gate_v1($1,true)',[w]);
      const state=(await observer.query("select root,(select jsonb_object_agg(collection,ids) from ship_dynamics_record_collections where workspace_key=$1) orders from ship_dynamics_record_workspaces where workspace_key=$1",[w])).rows[0];
      const result=await q(observer,'select ship_dynamics_record_commit_validated_v1($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::jsonb) r',[w,JSON.stringify(operations),JSON.stringify(state.root),JSON.stringify({...state.orders,...patchOrders}),'QA fixture only','qa-fixture-'+randomUUID(),JSON.stringify({fixture:true})]);
      assert.equal(result.ok,true);await observer.query('commit');
    }catch(error){await observer.query('rollback');throw error;}
  };
  await check('SQL11-real-500-audit-retention-and-historical-readback',async()=>{
    const old=(await read()).payload.auditLogs;
    const rows=Array.from({length:500-old.length},(_,i)=>({id:'qa-cap-'+i,at:new Date().toISOString(),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'QA cap fixture',entityType:'fixture',entityId:'qa',detail:'Synthetic retention boundary'}));
    await seedPublished(rows.map(value=>({kind:'entity',collection:'auditLogs',entityId:value.id,expected:null,value})),{auditLogs:[...rows.map(r=>r.id),...old.map(r=>r.id)]});
    const before=await read(),expired=before.payload.auditLogs.at(-1).id;assert.equal(before.payload.auditLogs.length,500);
    await tx(a,c=>submit(c,args([row({description:'QA audit cap'})])));const after=await read();
    assert.equal(after.payload.auditLogs.length,500);assert.equal(await q(observer,"select count(*)::integer r from ship_dynamics_records where workspace_key=$1 and collection='auditLogs'",[w]),500);
    assert.equal(after.payload.auditLogs.some(r=>r.id===expired),false);
    assert.deepEqual((await q(observer,'select read_ship_dynamics_record_history_v1($1,$2) r',[w,before.revision])).payload,before.payload);
  });
  await check('SQL12-inactive-vessel-terminal-recovery-and-unmanaged-denial',async()=>{
    const vessel=(await read()).payload.vessels.find(v=>v.id==='qa-v1');
    await seedPublished([{kind:'entity',collection:'vessels',entityId:vessel.id,value:{...vessel,isActive:false}}]);
    const before=await ledger();assert.equal((await tx(a,c=>submit(c,batchRequest))).replayed,true);
    await assert.rejects(()=>tx(a,c=>submit(c,args())),e=>e.message==='ship-internal-vessel-unavailable');assert.deepEqual(await ledger(),before);
    await seedPublished([{kind:'entity',collection:'vessels',entityId:vessel.id,value:vessel}]);
    await observer.query('begin');
    try{
      await observer.query('delete from ship_dynamics_authority_private.current_v1 where workspace_key=$1',[w]);
      await observer.query('savepoint unmanaged');
      await assert.rejects(()=>submit(observer,args()),e=>e.message==='ship-internal-source-unavailable');await observer.query('rollback to savepoint unmanaged');
    }finally{await observer.query('rollback');}
  });
  await check('SQL13-committed-readback-catalog-LF-CRLF-and-negative-fingerprint',async()=>{
    const sql=fs.readFileSync('supabase/verification/ship_internal_control_public_readback.sql','utf8');
    const evaluate=async text=>{const result=await observer.query(text);return result.flatMap(x=>x.rows).find(r=>Object.hasOwn(r,'failed_checks'));};
    const before=await ledger();for(const newline of ['\n','\r\n']){
      await observer.query(fs.readFileSync(shipInternalControlMigration,'utf8').replace(/\r?\n/g,newline));
      const result=await evaluate(sql.replace(/\r?\n/g,newline));assert.equal(result.result,'PASS');assert.deepEqual(result.failed_checks,[]);receipt.readbackChecks=Number(result.checks);
    }
    const bad=await evaluate(sql.replace(/[a-f0-9]{32}/,'00000000000000000000000000000000'));assert.equal(bad.result,'FAIL');assert.ok(bad.failed_checks.length>0);
    await observer.query(fs.readFileSync(shipInternalControlMigration,'utf8'));assert.deepEqual(await ledger(),before);
  });
  receipt.status='PASS';if(fs.existsSync(shipInternalControlMigration))receipt.migrationSha256=createHash('sha256').update(fs.readFileSync(shipInternalControlMigration)).digest('hex');
}catch(e){failure=e;receipt.status='FAIL';receipt.error={code:e.code,message:e.message,where:e.where,position:e.position};}
finally{if(qa)await qa.close();if(native)await native.close();save();}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,receipt:path.join(run,'receipt.json'),error:receipt.error}));if(failure)process.exitCode=1;
