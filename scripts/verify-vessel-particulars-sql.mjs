import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { createNativeRecordQa } from './record-storage-native-qa.mjs';

// Private native PostgreSQL only. No production URL or credential is accepted.
const root = process.env.QA_EVIDENCE_ROOT;
assert.ok(root && path.isAbsolute(root));
const run = fs.mkdtempSync(path.join(root, 'particulars-sql-'));
const receipt = { kind: 'native-PG-synthetic-vessel-particulars', status: 'RUNNING', cases: [], commands: [] };
let native, vite;
const migration = 'supabase/migrations/20260918090000_vessel_assignment_particulars.sql';
try {
  native = await createNativeRecordQa(run, receipt);
  const db = native.adapter;
  await db.exec('create role anon nologin; create role authenticated nologin;');
  for (const file of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql','supabase/development/20260906_appdata_record_delta.sql']) await db.exec(fs.readFileSync(file,'utf8'));
  vite = await createServer({ server:{middlewareMode:true}, appType:'custom', logLevel:'silent' });
  const {createInitialData} = await vite.ssrLoadModule('/src/data/seed.ts');
  const {normalizeAppData} = await vite.ssrLoadModule('/src/normalize.ts');
  const {buildCloudBlockPatch} = await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
  const data = normalizeAppData(createInitialData());
  const stamp = new Date().toISOString();
  data.revision=1; data.updatedAt=stamp;
  data.users=[{id:'qa-owner',name:'QA OWNER',username:'qa-owner',role:'owner',department:'督導',isActive:true,passwordHash:'',managedVesselIds:[],createdAt:stamp,updatedAt:stamp}];
  data.vessels=[{...data.vessels[0],id:'qa-vessel',assignedUserIds:[],delegateManagers:[]}];
  for (const field of ['yearLabel','tonnageLabel']) delete data.vessels[0][field];
  for (const collection of ['tasks','meetings','internalControlCases','agendaReports','auditLogs','taskDismissals','notifications']) data[collection]=[];
  const oldVessel=data.vessels[0], newVessel={...oldVessel,yearLabel:'2021.06',tonnageLabel:'2.0萬'};
  const covers = async (before, after) => (await db.query("select ship_dynamics_patch_lock_covers_entity('vessels','qa-vessel',$1::jsonb,$2::jsonb,'[]','[]') ok",[JSON.stringify(before),JSON.stringify(after)])).rows[0].ok;
  assert.equal(await covers(oldVessel,newVessel),true,'saved particulars must use the existing Management/no-operational-lease route');
  assert.equal(await covers(newVessel,{...newVessel,note:{...newVessel.note,recentDynamics:'operational'}}),false,'operational fields still require a vessel lease');
  receipt.cases.push('native-management-versus-operational-lock');
  const workspace='qa-particulars-only';
  assert.equal((await db.query('select import_ship_dynamics_records_v1($1,$2::jsonb) r',[workspace,JSON.stringify(data)])).rows[0].r.ok,true);
  const read = async () => (await native.observer.query('select read_ship_dynamics_records_v1($1) r',[workspace])).rows[0].r;
  const invoke = async (base, next, operationId) => (await db.query("select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,'QA OWNER','qa-owner',ship_dynamics_actor_guard($4::jsonb,'qa-owner'),null,'[]') r",[workspace,operationId,JSON.stringify(buildCloudBlockPatch(base.payload,next)),JSON.stringify(base.payload)])).rows[0].r;
  let base=await read();
  const submitted=[];
  for (const [yearLabel,tonnageLabel] of [['2024.03','2.1萬'],['','']]) {
    const next=structuredClone(base.payload);
    Object.assign(next.vessels[0],{yearLabel,tonnageLabel,updatedAt:new Date().toISOString()});
    const operationId='particulars-'+submitted.length;
    next.auditLogs.unshift({id:operationId,at:new Date().toISOString(),actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'更新船舶',entityType:'vessel',entityId:'qa-vessel',detail:'QA particulars'});
    const saved=await invoke(base,next,operationId);
    assert.equal(saved.ok,true,JSON.stringify(saved));
    submitted.push({base,next,operationId});
    const after=await read();
    assert.equal(after.revision,base.revision+1);
    assert.equal(after.payload.vessels[0].yearLabel,yearLabel);
    assert.equal(after.payload.vessels[0].tonnageLabel,tonnageLabel);
    assert.deepEqual(normalizeAppData(after.payload).vessels[0],next.vessels[0]);
    base=after;
  }
  receipt.cases.push('real-record-save-readback','explicit-clears-survive-normalization');
  const stale=submitted[0];
  assert.equal((await invoke(stale.base,stale.next,'particulars-stale')).code,'block-conflict');
  assert.deepEqual(await read(),base,'stale write must not alter current business data');
  receipt.cases.push('stale-vessel-CAS-rejection');
  const functionRow=async()=> (await db.query("select pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where p.oid='public.ship_dynamics_patch_lock_covers_entity(text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure")).rows[0];
  const installed=await functionRow();
  const oldDefinition=installed.definition.replace("'shipType','yearLabel','tonnageLabel','isActive'","'shipType','isActive'");
  assert.notEqual(oldDefinition,installed.definition);
  await db.exec(oldDefinition);
  assert.equal(await covers(oldVessel,newVessel),false,'pre-upgrade guard rejects the two newly added fields');
  for(let repeat=0;repeat<2;repeat++) {
    await db.exec(fs.readFileSync(migration,'utf8'));
    assert.deepEqual(await functionRow(),installed,'forward upgrade/idempotent rerun preserve the full function and ACL');
    assert.equal(await covers(oldVessel,newVessel),true);
    assert.deepEqual(await read(),base,'migration never backfills business records');
  }
  const result=await db.query(fs.readFileSync('supabase/verification/vessel_assignment_particulars_readback.sql','utf8'));
  assert.ok(result.rows.length>0 && result.rows.every(row=>row.pass===true));
  receipt.cases.push('pre-upgrade-RED-forward-upgrade-GREEN','idempotent-upgrade-no-data-or-ACL-change','read-only-readback');
  receipt.status='PASS';
} catch(error) { receipt.status='FAIL'; receipt.error=error.stack; process.exitCode=1; }
finally {
  if(vite) await vite.close();
  if(native) await native.close();
  fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({status:receipt.status,run,cases:receipt.cases,error:receipt.error,stopped:receipt.stopped}));
}
