// Owned native PostgreSQL only. Validate the failed-install readback, not production.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';import {createNativeRecordQa} from './record-storage-native-qa.mjs';
const predecessor=process.env.QA_PREDECESSOR_MODULE;assert.ok(predecessor&&path.isAbsolute(predecessor));
const root=path.dirname(predecessor),run=fs.mkdtempSync(path.join(root,'failure-readback-'));
const input='supabase/release/05a_failed_install_readback.sql',sql=fs.readFileSync(input,'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const receipt={kind:'failed-install-readback-native',status:'RUNNING',productionContacted:false,cases:[],inputs:Object.fromEntries([input,'scripts/verify-release-failure-readback-native.mjs','scripts/record-storage-native-qa.mjs'].map(f=>[f,hash(fs.readFileSync(f))]))};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const check=async(id,fn)=>{try{await fn();receipt.cases.push({id,status:'PASS'});save();}catch(e){receipt.cases.push({id,status:'FAIL',code:e.code??'ASSERT',message:e.message});throw e;}};
let native;
try{
 native=await createNativeRecordQa(run,receipt);const {observer,a}=native;
 receipt.predecessor=await(await import(pathToFileURL(predecessor))).installPredecessor(native.adapter);assert.equal(receipt.predecessor.status,'PASS');
 await observer.query("insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values('ship-dynamics-main','{\"vessels\":[],\"tasks\":[],\"internalControlCases\":[],\"meetings\":[],\"private_canary\":\"never-export-this-value\"}',31,'QA')");
 await observer.query("insert into public.ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,expires_at) values('ship-dynamics-main','qa-lock','qa-private-session','qa-private-name',now()+interval '1 hour')");
 const read=async()=>{const rs=await a.query(sql);const out=rs.flatMap(x=>x.rows??[]).find(x=>x.failed_install_readback)?.failed_install_readback;assert.ok(out);return out;};
 await check('FR01-absent-addons-and-nonsecret-current-state',async()=>{const out=await read();assert.equal(out.classification,'ADDON_MARKERS_ABSENT');assert.equal(out.public_app_table_count,58);assert.equal(out.reader_bypasses_rls,true);assert.equal(out.transaction_read_only,'on');assert.equal(out.legacy_current.revision,31);assert.deepEqual(out.edit_locks,{total:1,active:1});assert.equal(Object.values(out.objects).some(Boolean),false);for(const marker of ['never-export-this-value','qa-private-session','qa-private-name'])assert.equal(JSON.stringify(out).includes(marker),false);receipt.absent=out;});
 await check('FR02-partial-addon-is-not-retry-approval',async()=>{await observer.query('create sequence public.ship_dynamics_member_fence_seq');const out=await read();assert.equal(out.classification,'ADDON_PRESENT_OR_PARTIAL_STOP');assert.equal(out.objects.member_fence_sequence,true);assert.equal(out.next,'READBACK_ONLY_NOT_RETRY_APPROVAL');await observer.query('drop sequence public.ship_dynamics_member_fence_seq');});
 await check('FR03-readonly-rejects-injected-mutation',async()=>{const injected=sql.replace('\nROLLBACK;',"\nUPDATE public.ship_dynamics_app_state SET revision=32;\nROLLBACK;");assert.notEqual(injected,sql);await assert.rejects(()=>a.query(injected),e=>e.code==='25006');await a.query('rollback');assert.equal((await read()).legacy_current.revision,31);});
 receipt.inputsUnchanged=Object.entries(receipt.inputs).every(([f,h])=>hash(fs.readFileSync(f))===h);assert.equal(receipt.inputsUnchanged,true);receipt.status='PASS';
}catch(e){receipt.status='FAIL';receipt.error={code:e.code??'ASSERT',message:e.message};process.exitCode=1;}
finally{if(native)await native.close();save();console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases,error:receipt.error}));}
