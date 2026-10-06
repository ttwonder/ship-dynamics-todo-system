import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {shipInternalControlInput,installShipInternalControlFixture} from './ship-internal-control-local-fixture.mjs';

const migration='supabase/migrations/20261006090000_ship_internal_control_download.sql';
const readback='supabase/verification/ship_internal_control_download_readback.sql';
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit absolute QA_EVIDENCE_ROOT required');
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'ship-internal-download-sql-'));
const receipt={kind:'isolated native PostgreSQL / synthetic data / no production contact',status:'RUNNING',cases:[],productionContacted:false};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const caseRun=async(id,fn)=>{await fn();receipt.cases.push({id,status:'PASS'});save();};
let native,qa,failure;
try {
  native=await createNativeRecordQa(run,receipt);
  qa=await createRecordStorageLocalQa({scopedRead:true,browserAuthority:true,performanceTrace:true,
    preparePerformanceFixture:initial=>{
      shipInternalControlInput(initial);
      initial.internalControlCases=[
        {id:'qa-case-own',vesselId:'qa-v1',reportDate:'2026-10-01',reportSource:'日常',priority:'高',description:'own open case',category:'維修',departments:['管理組'],status:'處理中',isClosed:false},
        {id:'qa-case-other',vesselId:'qa-v2',reportDate:'2026-10-02',reportSource:'日常',priority:'低',description:'other ship secret',category:'維修',equipmentSubcategory:'',departments:[],status:'處理中',isClosed:false},
        {id:'qa-case-closed',vesselId:'qa-v1',reportDate:'2026-10-03',reportSource:'日常',priority:'低',description:'closed secret',category:'維修',equipmentSubcategory:'',departments:[],status:'已結案',isClosed:true,closedDate:'2026-10-04'},
      ];
    },databaseFactory:async()=>native.adapter,hmr:false});
  await installShipInternalControlFixture(native.adapter,qa.workspace);
  const {observer,a,b}=native,w=qa.workspace;
  let testToken,vesselSecret;
  const headers=ip=>JSON.stringify({'x-forwarded-for':ip});
  const tx=async(client,role,ip,fn)=>{
    await client.query('begin');
    try {
      await client.query(`set local role ${role}`);
      if(ip!==null)await client.query("select set_config('request.headers',$1,true)",[headers(ip)]);
      const value=await fn(client);await client.query('commit');return value;
    }catch(e){await client.query('rollback');throw e;}
  };
  const rpc=(client,name,args,ip='192.0.2.30',role='anon')=>tx(client,role,ip,async c=>(await c.query(`select public.${name}(${args.map((_,i)=>`$${i+1}::text`).join(',')}) result`,args)).rows[0].result);
  const issue=(actor,password,ip='192.0.2.30',client=a)=>rpc(client,'issue_ship_dynamics_internal_control_admin_session_v1',[w,actor,password],ip);
  const manage=(token,action,vessel=null,ip='192.0.2.30',client=a)=>rpc(client,'manage_ship_dynamics_internal_control_download_v1',[w,token,action,vessel],ip);
  const download=(vessel,password,ip='192.0.2.31',client=b)=>rpc(client,'download_ship_dynamics_internal_control_v1',[w,vessel,password],ip);
  await caseRun('SQL01-install-and-readback',async()=>{
    const before=await qa.read();
    const publicBefore=await rpc(a,'read_ship_dynamics_internal_control_public_v1',[w,null]);
    assert.ok(fs.existsSync(migration),'migration absent (expected RED before implementation)');
    await observer.query(fs.readFileSync(migration,'utf8'));
    assert.deepEqual(await qa.read(),before,'additive install must not rewrite current business records');
    assert.deepEqual(await rpc(a,'read_ship_dynamics_internal_control_public_v1',[w,null]),publicBefore,'existing anonymous projection retained');
    const result=await observer.query(fs.readFileSync(readback,'utf8'));
    const summary=result.flatMap(r=>r.rows).find(r=>Object.hasOwn(r,'failed_checks'));
    assert.equal(summary?.result,'PASS',JSON.stringify(summary));assert.deepEqual(summary.failed_checks,[]);receipt.readbackChecks=Number(summary.checks);
  });
  await caseRun('SQL02-main-login-password-and-role',async()=>{
    assert.equal((await issue('qa-owner','incorrect')).code,'admin-auth-denied');
    assert.equal((await issue('qa-manager',qa.password)).code,'admin-auth-denied','correct hash with operator role is not admin proof');
    assert.equal((await issue('missing-user',qa.password)).code,'admin-auth-denied');
    const valid=await issue('qa-owner',qa.password);assert.match(valid.token,/^[0-9a-f]{64}$/);assert.ok(valid.expires_at);
    receipt.adminTokenIssued=true; // Never store the token or a password in QA evidence.
    const view=await manage(valid.token,'list');assert.equal(view.vessels.length,2);
    assert.ok(view.vessels.every(v=>v.configured===false));
    const result=await observer.query("select count(*) n from ship_dynamics_internal_control_private.admin_sessions");assert.ok(Number(result.rows[0].n)>0);
    testToken=valid.token;
    const tokens=await observer.query('select token_hash from ship_dynamics_internal_control_private.admin_sessions');
    assert.ok(tokens.rows.every(row=>row.token_hash!==testToken));
  });
  await caseRun('SQL03-reset-export-scope-and-one-time-secret',async()=>{
    const first=await manage(testToken,'reset','qa-v1');assert.match(first.password,/^[0-9a-f]{64}$/);
    assert.equal(first.vessel_id,'qa-v1');
    const view=await manage(testToken,'list');assert.equal(view.vessels.find(v=>v.vessel_id==='qa-v1').configured,true);
    const exported=await download('qa-v1',first.password);assert.equal(exported.case_count,1);
    assert.deepEqual(exported.cases.map(c=>c.id),['qa-case-own']);
    assert.deepEqual(Object.keys(exported.cases[0]).sort(),['id','vesselId','reportDate','reportSource','priority','description','category','equipmentSubcategory','departments','status','closedDate'].sort());
    assert.equal(exported.cases[0].equipmentSubcategory,'');
    assert.deepEqual(Object.keys(exported.vessel).sort(),['id','name','shortName','fullName','shipType'].sort());
    assert.equal(exported.vessel.id,'qa-v1');assert.equal(exported.vessel.shipType,(await qa.read()).payload.vessels.find(v=>v.id==='qa-v1').shipType);
    assert.ok(exported.receipt_id);assert.ok(exported.issued_at);assert.equal(exported.ip_address,'192.0.2.31');
    assert.equal((await download('qa-v2',first.password)).code,'download-denied');
    const rotated=await manage(testToken,'reset','qa-v1');assert.notEqual(rotated.password,first.password);
    assert.equal((await download('qa-v1',first.password)).code,'download-denied');
    assert.equal((await download('qa-v1',rotated.password)).case_count,1);
    vesselSecret=rotated.password;
    const logs=(await manage(testToken,'list')).logs;
    assert.ok(logs.every(log=>typeof log.vessel_id==='string'));
    assert.ok(logs.some(row=>row.vessel_id==='qa-v1'&&row.result==='reset'&&row.actor_id==='qa-owner'));
    assert.ok(logs.some(row=>row.receipt_id===exported.receipt_id&&row.result==='success'&&row.case_count===1));
    assert.ok(logs.some(row=>row.result==='denied'));
    assert.ok(!JSON.stringify(logs).includes(rotated.password));
    assert.ok(!JSON.stringify(logs).includes(first.password));
    const leaked=await observer.query("select count(*) n from ship_dynamics_internal_control_private.vessel_credentials where secret_hash in ($1,$2)",[first.password,rotated.password]);
    assert.equal(Number(leaked.rows[0].n),0);
  });
  await caseRun('SQL04-no-ip-invalid-auth-and-rate-limit',async()=>{
    assert.equal((await issue('qa-owner',qa.password,null)).code,'request-ip-required');
    assert.equal((await manage(testToken,'reset','qa-v2',null)).code,'request-ip-required');
    assert.equal((await download('qa-v1',vesselSecret,null)).code,'request-ip-required');
    assert.equal((await manage('not-a-token','list')).code,'admin-session-denied');
    assert.equal((await manage(testToken,'reset','not-a-vessel')).code,'vessel-unavailable');
    assert.equal((await manage(testToken,'list',null,'192.0.2.99')).code,'admin-session-denied');
    for(let i=0;i<5;i++)assert.equal((await issue('qa-owner','bad-password','192.0.2.90')).code,'admin-auth-denied');
    assert.equal((await issue('qa-owner',qa.password,'192.0.2.90')).code,'rate-limited');
    assert.match((await issue('qa-owner',qa.password,'192.0.2.91')).token,/^[0-9a-f]{64}$/);
    for(let i=0;i<5;i++)assert.equal((await download('qa-v1','incorrect','192.0.2.92')).code,'download-denied');
    assert.equal((await download('qa-v1',vesselSecret,'192.0.2.92')).code,'rate-limited');
    assert.equal((await download('qa-v1',vesselSecret,'192.0.2.93')).case_count,1);
    await observer.query("update ship_dynamics_internal_control_private.admin_sessions set expires_at=clock_timestamp()-interval '1 minute' where token_hash=$1",[createHash('sha256').update(testToken).digest('hex')]);
    assert.equal((await manage(testToken,'reset','qa-v2')).code,'admin-session-denied','expired tokens cannot reset');
  });
  await caseRun('SQL05-live-revocation-and-source-gate',async()=>{
    const hash=createHash('sha256').update('new-admin-password').digest('hex');
    await observer.query("update ship_dynamics_records set value=jsonb_set(value,'{passwordHash}',to_jsonb($1::text),true),revision=revision+1 where workspace_key=$2 and collection='users' and entity_id='qa-owner'",[hash,w]);
    assert.equal((await manage(testToken,'list')).code,'admin-session-denied');
    assert.equal((await issue('qa-owner',qa.password)).code,'admin-auth-denied');
    const active=await issue('qa-owner','new-admin-password');assert.ok(active.token);
    await observer.query("update ship_dynamics_records set value=jsonb_set(value,'{role}','\"operator\"'::jsonb),revision=revision+1 where workspace_key=$1 and collection='users' and entity_id='qa-owner'",[w]);
    assert.equal((await manage(active.token,'list')).code,'admin-session-denied');
    assert.equal((await issue('qa-owner','new-admin-password')).code,'admin-auth-denied');
    await observer.query("update ship_dynamics_records set value=jsonb_set(value,'{role}','\"owner\"'::jsonb),revision=revision+1 where workspace_key=$1 and collection='users' and entity_id='qa-owner'",[w]);
    assert.equal((await manage(active.token,'list')).code,'admin-session-denied','role restore must not resurrect old token');
    const newer=await issue('qa-owner','new-admin-password');assert.ok(newer.token);
    await observer.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','false'::jsonb),revision=revision+1 where workspace_key=$1 and collection='users' and entity_id='qa-owner'",[w]);
    assert.equal((await manage(newer.token,'list')).code,'admin-session-denied');
    await observer.query("update ship_dynamics_records set value=jsonb_set(value,'{isActive}','true'::jsonb),revision=revision+1 where workspace_key=$1 and collection='users' and entity_id='qa-owner'",[w]);
    assert.equal((await manage(newer.token,'list')).code,'admin-session-denied','reactivation must not resurrect old token');
    await observer.query("update ship_dynamics_authority_private.current_v1 set source='legacy' where workspace_key=$1",[w]);
    await assert.rejects(()=>download('qa-v1',vesselSecret),e=>e.message.includes('ship-internal-source-unavailable'));
    await assert.rejects(()=>issue('qa-owner','new-admin-password'),e=>e.message.includes('ship-internal-source-unavailable'));
  });
  await caseRun('SQL06-table-grants-idempotent-install',async()=>{
    await observer.query("update ship_dynamics_authority_private.current_v1 set source='records-v1' where workspace_key=$1",[w]);
    const before=(await observer.query('select count(*) n from ship_dynamics_internal_control_private.access_logs')).rows[0].n;
    await observer.query(fs.readFileSync(migration,'utf8'));
    assert.equal((await observer.query('select count(*) n from ship_dynamics_internal_control_private.access_logs')).rows[0].n,before);
    assert.equal((await download('qa-v1',vesselSecret)).case_count,1);
    const result=await observer.query(fs.readFileSync(readback,'utf8'));
    const summary=result.flatMap(r=>r.rows).find(r=>Object.hasOwn(r,'failed_checks'));
    assert.equal(summary?.result,'PASS',JSON.stringify(summary));
    for(const name of ['vessel_credentials','admin_sessions','access_logs','auth_attempts']){
      const allowed=await tx(a,'anon','192.0.2.30',c=>c.query(`select * from ship_dynamics_internal_control_private.${name} limit 1`)).then(()=>true,()=>false);
      assert.equal(allowed,false,`anonymous relation ${name}`);
    }
  });
  receipt.status='PASS';receipt.migrationSha256=createHash('sha256').update(fs.readFileSync(migration)).digest('hex');
}catch(e){failure=e;receipt.status='FAIL';receipt.error={code:e.code,message:e.message,where:e.where};}
finally {try{if(qa)await qa.close();}catch(e){receipt.cleanupError=e.message;failure??=e;}try{if(native)await native.close();}catch(e){receipt.cleanupError=e.message;failure??=e;}save();}
console.log(JSON.stringify({status:receipt.status,cases:receipt.cases,receipt:path.join(run,'receipt.json'),error:receipt.error,cleanupError:receipt.cleanupError}));if(failure)process.exitCode=1;
