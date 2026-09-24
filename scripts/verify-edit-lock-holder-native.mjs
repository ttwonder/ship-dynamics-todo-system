import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'edit-holder-')),baseline=process.argv.includes('--baseline');
const migration='supabase/migrations/20260925020000_edit_lock_holder.sql';
const files=['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql','supabase/development/20260909_task_member_protocol.sql','supabase/release/05_install_record_storage.sql','scripts/verify-edit-lock-holder-native.mjs',...(!baseline?[migration]:[])];
const hash=s=>createHash('sha256').update(s).digest('hex');
const receipt={kind:'NATIVE-POSTGRES-EXACT-RELEASE-CLAIM',baseline,status:'RUNNING',inputs:Object.fromEntries(files.map(p=>[p,hash(fs.readFileSync(p))])),cases:[],productionContacted:false};
let native,failure;
try{
 native=await createNativeRecordQa(run,receipt);const db=native.adapter,w='edit-holder-private';
 await db.exec('create role anon nologin;create role authenticated nologin;');
 for(const p of files.slice(0,3))await db.exec(fs.readFileSync(p,'utf8'));
 const source=fs.readFileSync(files[3],'utf8'),start=source.indexOf('create or replace function public.claim_ship_dynamics_edit_lock('),end=source.indexOf('end $$;',start);
 assert.ok(start>=0&&end>start);await db.exec(source.slice(start,end+7));
 const signature='public.claim_ship_dynamics_edit_lock(text,text,text,text,integer)';
 const acl=async()=>(await db.query('select proacl::text acl,prosecdef,provolatile from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
 const beforeAcl=await acl();
 const payload={revision:1,updatedAt:'2026-09-25T00:00:00Z',settings:{},users:[],vessels:[],tasks:[],internalControlCases:[],meetings:[],agendaReports:[],notifications:[],auditLogs:[],taskDismissals:[]};
 await db.query('select import_ship_dynamics_records_v1($1,$2::jsonb)',[w,JSON.stringify(payload)]);
 const read=async()=>(await db.query('select read_ship_dynamics_records_v1($1) r',[w])).rows[0].r;
 const before=await read();
 if(!baseline){await db.exec(fs.readFileSync(migration,'utf8'));assert.deepEqual(await acl(),beforeAcl,'forward metadata migration preserves effective ACL/security');}
 const claim=async(client,key,owner)=>(await client.query('select claim_ship_dynamics_edit_lock($1,$2,$3,$4,75) r',[w,key,owner,'QA '+owner])).rows[0].r;
 const release=async(client,key,owner)=>client.query('select release_ship_dynamics_edit_lock($1,$2,$3)',[w,key,owner]);
 const check=async(id,fn)=>{await fn();receipt.cases.push({id,status:'PASS'});native.save();};
 await check('H01-same-key-holder-name',async()=>{const a=await claim(native.a,'tracking:one','OWNER');assert.equal(a.ok,true);const b=await claim(native.b,'tracking:one','OPERATOR');assert.equal(b.ok,false);assert.equal(b.locked_by_name,'QA OWNER');assert.equal(b.locked_by,'OWNER');assert.ok(b.expires_at);await release(native.a,'tracking:one','OWNER');});
 const leafKeys=Object.fromEntries(await Promise.all(['v1','v2'].map(async id=>[id,(await db.query('select ship_dynamics_task_member_key_v1($1,$2) k',['shared',id])).rows[0].k])));
 const parent='task:shared',leaf=id=>leafKeys[id];
 await check('H02-parent-denies-leaf-with-name',async()=>{assert.equal((await claim(native.a,parent,'OWNER')).ok,true);const r=await claim(native.b,leaf('v1'),'OPERATOR');assert.equal(r.code,'parent-child-lock-conflict');assert.equal(r.locked_by_name,'QA OWNER');await release(native.a,parent,'OWNER');});
 await check('H03-disjoint-leaves-parallel-parent-denied',async()=>{assert.equal((await claim(native.a,leaf('v1'),'OWNER')).ok,true);assert.equal((await claim(native.b,leaf('v2'),'OPERATOR')).ok,true);const r=await claim(native.observer,parent,'THIRD');assert.equal(r.code,'parent-child-lock-conflict');assert.equal(r.locked_by_name,'QA OWNER');await release(native.a,leaf('v1'),'OWNER');await release(native.b,leaf('v2'),'OPERATOR');});
 await check('H04-expired-lock-can-be-reclaimed',async()=>{assert.equal((await claim(native.a,'tracking:expired','OWNER')).ok,true);await db.query("update ship_dynamics_edit_locks set expires_at=clock_timestamp()-interval '1 second' where workspace_key=$1 and section_key='tracking:expired'",[w]);assert.equal((await claim(native.b,'tracking:expired','OPERATOR')).ok,true);await release(native.b,'tracking:expired','OPERATOR');});
 await check('H05-readback-and-no-business-write',async()=>{assert.deepEqual(await read(),before);if(!baseline){const rb=await db.query(fs.readFileSync('supabase/verification/edit-lock-holder-readback.sql','utf8'));assert.equal(rb.rows[0].status,'PASS');assert.deepEqual(await acl(),beforeAcl);}});
 receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={message:e.message,stack:e.stack};}
finally{if(native)await native.close();fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));}
console.log(JSON.stringify({run,status:receipt.status,cases:receipt.cases,failure:receipt.failure,cleanup:{stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved}},null,2));if(failure)process.exitCode=1;
