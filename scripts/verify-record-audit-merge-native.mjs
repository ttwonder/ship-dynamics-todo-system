import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));assert.ok(!path.resolve(root).startsWith(path.resolve('.')+path.sep));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'audit-native-'));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const receipt={kind:'bounded-audit-merge-native',inputHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],inputs:Object.fromEntries(['supabase/development/20260906_appdata_record_store.sql','scripts/verify-record-audit-merge-native.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','src/cloudBlockPatch.ts','src/cloudRebase.ts','src/utils.ts'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]))};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
let native,qa,failure;
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({internalControl:true,databaseFactory:async()=>native.adapter});
 const {a,b,observer}=native;
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {withAudit}=await qa.loadModule('/src/utils.ts');
 const {assertActorAuthorizedForCloudBlockPatch}=await qa.loadModule('/src/cloudAuthorization.ts');
 const {rebaseDisjointAppData}=await qa.loadModule('/src/cloudRebase.ts');
 const template=(await qa.read()).payload;
 let serial=0;
 const read=w=>q(observer,'select read_ship_dynamics_records_v1($1) r',[w]);
 const ledger=async w=>{const out={};for(const table of ['workspaces','collections','records','receipts','read_bases','versions','history','task_progress','task_progress_history'])out[table]=(await observer.query(`select to_jsonb(t) v from ship_dynamics_record_${table==='records'?'DO_NOT_USE':table} t where workspace_key=$1 order by to_jsonb(t)::text`.replace('ship_dynamics_record_DO_NOT_USE','ship_dynamics_records'),[w])).rows;return out;};
 const claim=async(w,id,actor)=>assert.equal((await q(observer,'select claim_ship_dynamics_edit_lock($1,$2,$3,$4,120) r',[w,'vessel:'+id,'merge-'+actor,actor])).ok,true);
 const fixture=async cap=>{const w='audit-merge-'+cap+'-'+(++serial),data=structuredClone(template);data.auditLogs=Array.from({length:cap},(_,i)=>({id:'legacy-'+i,at:i%2?'not-sorted-history':'2000-01-01T00:00:00.000Z',actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'import fixture',entityType:'vessel',entityId:'qa-v2',detail:'legacy '+i,ipAddress:'192.0.2.99',ipCountryCode:'JP'}));assert.equal((await q(observer,'select import_ship_dynamics_records_v1($1,$2::jsonb) r',[w,JSON.stringify(data)])).ok,true);await claim(w,'qa-v2','qa-owner');await claim(w,'qa-v1','qa-operator');return {w,base:await read(w)};};
 const make=async(w,base,id,actor)=>{let next=structuredClone(base.payload);next.vessels.find(v=>v.id===id).note.recentDynamics='native-'+(++serial);next=withAudit(next,next.users.find(u=>u.id===actor),'快速更新船舶','vessel',id,'QA narrow merge');next.auditLogs[0].at=new Date(Date.UTC(2026,8,8,0,0,serial)).toISOString();const ops=buildCloudBlockPatch(base.payload,next);assertActorAuthorizedForCloudBlockPatch(base.payload,ops,actor);return {w,id:'merge-op-'+serial,actor,base,next,ops,guard:await q(observer,'select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base.payload),actor]),auth:await q(observer,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(base.payload)]),locks:[{section_key:'vessel:'+id,locked_by:'merge-'+actor}]};};
 const issue=(c,r,fn='apply_ship_dynamics_record_patch_v1')=>q(c,`select ${fn}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r`,[r.w,r.id,JSON.stringify(r.ops),r.base.payload.users.find(u=>u.id===r.actor).name,r.actor,JSON.stringify(r.guard),JSON.stringify(r.auth),JSON.stringify(r.locks)]);
 const stamped=async(c,r)=>{await c.query('begin');try{await c.query(`select set_config('request.headers','{"x-forwarded-for":"192.0.2.30","cf-ipcountry":"TW"}',true)`);const v=await issue(c,r);await c.query('commit');return v;}catch(e){await c.query('rollback');throw e;}};
 const samePayload=(actual,expected)=>{expected=structuredClone(expected);expected.revision=actual.revision;expected.updatedAt=actual.updatedAt;for(const audit of expected.auditLogs){const found=actual.auditLogs.find(x=>x.id===audit.id);if(!audit.id.startsWith('legacy-')){assert.equal(found?.ipAddress,'192.0.2.30');assert.equal(found?.ipCountryCode,'TW');audit.ipAddress='192.0.2.30';audit.ipCountryCode='TW';}}assert.deepEqual(actual,JSON.parse(JSON.stringify(expected)));};
 for(const cap of [500,499,7]){
  const {w,base}=await fixture(cap),ra=await make(w,base,'qa-v2','qa-owner'),rb=await make(w,base,'qa-v1','qa-operator');
  const ackA=await stamped(a,ra);assert.equal(ackA.ok,true);const afterA=await read(w);
  const oracle=rebaseDisjointAppData(base.payload,rb.next,afterA.payload,new Date().toISOString(),rb.actor);
  const ackB=await stamped(b,rb);receipt.probe={cap,ackA,ackB,originalRequestHash:hash(rb.ops)};save();assert.equal(ackB.ok,true,'same-base cap '+cap+' B must ACK first request without shared audit retry: '+JSON.stringify(ackB));
  const final=await read(w);samePayload(final.payload,oracle);assert.equal(final.payload.auditLogs.length,Math.min(cap+2,500));
  const delta=await q(observer,'select read_ship_dynamics_record_delta_v1($1,$2,$3) r',[w,base.revision,await q(observer,'select token r from ship_dynamics_record_read_bases where workspace_key=$1 and revision=$2',[w,base.revision])]);
  assert.equal(delta.status,'delta');const reconstructed=structuredClone(base.payload);Object.assign(reconstructed,delta.root.set);for(const k of delta.root.deleted)delete reconstructed[k];for(const c of delta.collections){const map=new Map(reconstructed[c.collection].map(x=>[x.id,x]));for(const id of c.deleted)map.delete(id);for(const x of c.upserts)map.set(x.id,x);reconstructed[c.collection]=(c.order||[...map.keys()]).map(id=>map.get(id));}assert.deepEqual(reconstructed,final.payload,'complete delta reconstruction');
  for(const [revision,expected] of [[base.revision,base.payload],[ackA.revision,afterA.payload],[ackB.revision,final.payload]]){const history=await q(observer,'select read_ship_dynamics_record_history_v1($1,$2) r',[w,revision]);assert.deepEqual(history.payload,expected,'exact history '+revision);}
  const beforeReplay=await ledger(w);const replay=await issue(b,rb);assert.equal(replay.replayed,true);assert.equal(replay.revision,ackB.revision);assert.deepEqual(await ledger(w),beforeReplay);
  const mismatch=structuredClone(rb);mismatch.ops[0].value.note.recentDynamics='signature mismatch';assert.equal((await issue(b,mismatch)).code,'operation-id-mismatch');assert.deepEqual(await ledger(w),beforeReplay);
  receipt.cases.push({caseId:'M-cap-'+cap,status:'PASS',layer:'native-SQL-original-builder-readonly-rebase-oracle',ackA,ackB,auditCount:final.payload.auditLogs.length,exactFullHistory:true,delta,originalSignatureReplay:true,signatureMismatch:true,hash:hash(final)});save();
 }

 // An order can recur after a legal delete/recreate; identical IDs are not an identical base.
 {
  const f=await fixture(7),stale=await make(f.w,f.base,'qa-v1','qa-operator');
  const original=f.base.payload.auditLogs[0],ids=f.base.payload.auditLogs.map(x=>x.id);
  const remove=structuredClone(stale);remove.id='aba-delete-'+(++serial);remove.ops=[{kind:'entity',collection:'auditLogs',entityId:original.id,expected:original,value:null}];
  assert.equal((await stamped(b,remove)).ok,true,'original RPC allows this fixture deletion');
  const afterDelete=await read(f.w),restore=await make(f.w,afterDelete,'qa-v2','qa-owner');
  restore.ops=[restore.ops.find(o=>o.collection==='vessels'),{kind:'entity',collection:'auditLogs',entityId:original.id,expected:null,value:{...original,detail:'ABA rebuilt business body'}},{kind:'order',collection:'auditLogs',expectedIds:afterDelete.payload.auditLogs.map(x=>x.id),valueIds:ids}];
  assert.equal((await stamped(a,restore)).ok,true,'original RPC restores E with a changed audit body');
  const restored=await read(f.w);assert.deepEqual(restored.payload.auditLogs.map(x=>x.id),ids);
  assert.notEqual(restored.payload.auditLogs[0].detail,original.detail);
  const matching=(await observer.query("select revision from ship_dynamics_record_versions where workspace_key=$1 and orders->'auditLogs'=$2::jsonb order by revision",[f.w,JSON.stringify(ids)])).rows.map(x=>x.revision);assert.ok(matching.length>=2);
  const peer=await make(f.w,restored,'qa-v2','qa-owner');assert.equal((await stamped(a,peer)).ok,true);
  const remote=await read(f.w);let rebaseError;
  try{rebaseDisjointAppData(f.base.payload,stale.next,remote.payload,new Date().toISOString(),stale.actor);}catch(e){rebaseError=e;}
  assert.equal(rebaseError?.name,'CloudRebaseConflictError');assert.ok(rebaseError.conflicts.some(x=>x.startsWith('auditLogs:')));
  const before=await ledger(f.w),result=await stamped(b,stale),after=await ledger(f.w);
  receipt.abaProbe={originalBaseline:f.base.revision,matchingOrderRevisions:matching,originalRebaseConflicts:rebaseError.conflicts,result,beforeLedgerHash:hash(before),afterLedgerHash:hash(after)};save();
  assert.equal(result.ok,false,'ABA reappearing E must not ACK a stale request rejected by the original rebase');
  assert.equal(result.code,'block-conflict');assert.deepEqual(after,before,'ABA rejection writes nothing');
  receipt.cases.push({caseId:'G-reappearing-order-ABA',status:'PASS',layer:'native-negative-original-RPC',matchingOrderRevisions:matching,originalRebaseConflicts:rebaseError.conflicts,result});save();
 }

 const {w,base}=await fixture(500),ra=await make(w,base,'qa-v2','qa-owner'),rb=await make(w,base,'qa-v1','qa-operator');assert.equal((await stamped(a,ra)).ok,true);
 const add=r=>r.ops.find(o=>o.kind==='entity'&&o.collection==='auditLogs'&&o.expected===null);
 const order=r=>r.ops.find(o=>o.kind==='order');const del=r=>r.ops.find(o=>o.kind==='entity'&&o.collection==='auditLogs'&&o.value===null);
 const controls=[
  ['stale-vessel',r=>{r.ops.find(o=>o.collection==='vessels').expected.note.recentDynamics='stale';},'block-conflict'],
  ['actor-guard',r=>{r.guard={};},'authorization-conflict'],
  ['audit-actor',r=>{add(r).value.actorId='qa-owner';},'unaccompanied-audit'],
  ['wrong-valid-lease',r=>{r.locks=[{section_key:'vessel:qa-v2',locked_by:'merge-qa-owner'}];},'lock-conflict'],
  ['wrong-audit-entity',r=>{add(r).value.entityId='qa-v2';},'block-conflict'],
  ['duplicate-ids',r=>{order(r).valueIds[1]=order(r).valueIds[0];},'block-conflict'],
  ['arbitrary-order',r=>{order(r).valueIds.reverse();},'block-conflict'],
  ['forged-base',r=>{order(r).expectedIds[0]='invented';},'block-conflict'],
  ['forged-append',r=>{order(r).valueIds.push('invented');},'block-conflict'],
  ['non-tail-delete',r=>{del(r).entityId=base.payload.auditLogs[0].id;del(r).expected=base.payload.auditLogs[0];},'block-conflict'],
  ['forged-tail-body',r=>{del(r).expected.detail='forged';},'block-conflict'],
  ['immutable-audit',r=>{r.ops.push({kind:'entity',collection:'auditLogs',entityId:base.payload.auditLogs[0].id,expected:base.payload.auditLogs[0],value:{...base.payload.auditLogs[0],detail:'rewrite'}});},'block-conflict'],
  ['noncanonical-time',r=>{add(r).value.at='yesterday';},'block-conflict'],
  ['equal-time',r=>{add(r).value.at=ra.next.auditLogs[0].at;},'block-conflict'],
 ];
 for(const [id,mutate,code] of controls){const r=structuredClone(rb);r.id='negative-'+id;mutate(r);const before=await ledger(w);const result=await stamped(b,r);assert.equal(result.ok,false,id);assert.equal(result.code,code,id+JSON.stringify(result));assert.deepEqual(await ledger(w),before,id+' zero writes');receipt.cases.push({caseId:'G-'+id,status:'PASS',layer:'native-negative',result});save();}
 await observer.query("update ship_dynamics_edit_locks set expires_at=now()-interval '1 second' where workspace_key=$1 and section_key='vessel:qa-v1'",[w]);
 const expiredBefore=await ledger(w);assert.equal((await stamped(b,rb)).code,'lock-conflict');assert.deepEqual(await ledger(w),expiredBefore);await claim(w,'qa-v1','qa-operator');receipt.cases.push({caseId:'G-expired-lease',status:'PASS',layer:'native-negative'});
 // Exercise the unchanged strict immutable check independently of stale order.
 const current=await read(w),rewrite=await make(w,current,'qa-v1','qa-operator');rewrite.ops=[{kind:'entity',collection:'auditLogs',entityId:current.payload.auditLogs[0].id,expected:current.payload.auditLogs[0],value:{...current.payload.auditLogs[0],detail:'rewrite'}}];
 const immutableBefore=await ledger(w);assert.equal((await stamped(b,rewrite)).code,'immutable-audit');assert.deepEqual(await ledger(w),immutableBefore);receipt.cases.push({caseId:'G-current-immutable',status:'PASS',layer:'native-negative'});
 // Real original RPC deletion then recreation of the same body: not a new peer.
 const tamper=structuredClone(rewrite);tamper.id='delete-recreate-1';tamper.ops=[{kind:'entity',collection:'auditLogs',entityId:'legacy-0',expected:base.payload.auditLogs[0],value:null}];assert.equal((await stamped(b,tamper)).ok,true);
 const recreate=structuredClone(ra),deleted=await read(w);recreate.id='delete-recreate-2';const restoredVessel=structuredClone(deleted.payload.vessels.find(v=>v.id==='qa-v2'));recreate.ops=[{kind:'entity',collection:'vessels',entityId:'qa-v2',expected:restoredVessel,value:{...restoredVessel,note:{...restoredVessel.note,recentDynamics:'recreate-peer'}}},{kind:'entity',collection:'auditLogs',entityId:'legacy-0',expected:null,value:base.payload.auditLogs[0]},{kind:'order',collection:'auditLogs',expectedIds:deleted.payload.auditLogs.map(a=>a.id),valueIds:[ra.next.auditLogs[0].id,...base.payload.auditLogs.slice(0,499).map(a=>a.id)]}];const recreated=await stamped(a,recreate);assert.equal(recreated.ok,true,JSON.stringify(recreated));
 const recreatedBefore=await ledger(w);assert.equal((await stamped(b,rb)).ok,false);assert.deepEqual(await ledger(w),recreatedBefore);receipt.cases.push({caseId:'G-delete-recreate',status:'PASS',layer:'native-negative-original-RPC'});
 // A late receipt failure must undo effective retention, vessel, history and all metadata.
 const late=await fixture(500),la=await make(late.w,late.base,'qa-v2','qa-owner'),lb=await make(late.w,late.base,'qa-v1','qa-operator');assert.equal((await stamped(a,la)).ok,true);
 await observer.query("create sequence qa_merge_reached;create function qa_merge_late() returns trigger language plpgsql as $$begin perform nextval('qa_merge_reached');raise exception 'QA_MERGE_LATE';end$$;create trigger qa_merge_late before insert on ship_dynamics_record_receipts for each row execute function qa_merge_late()");
 const lateBefore=await ledger(late.w);try{await assert.rejects(stamped(b,lb),/QA_MERGE_LATE/);assert.deepEqual(await ledger(late.w),lateBefore);assert.equal((await observer.query('select is_called from qa_merge_reached')).rows[0].is_called,true);}finally{await observer.query('drop trigger qa_merge_late on ship_dynamics_record_receipts;drop function qa_merge_late();drop sequence qa_merge_reached');}
 assert.equal((await stamped(b,lb)).ok,true);receipt.cases.push({caseId:'G-late-rollback-positive',status:'PASS',layer:'native-SQL',allBusinessTablesEqual:true});
 for(const role of ['anon','authenticated'])assert.equal((await observer.query("select has_function_privilege($1,'ship_dynamics_record_merge_audit_v1(text,jsonb,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
 receipt.cases.push({caseId:'G-private-ACL',status:'PASS',layer:'native-catalog'});

 receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={message:e.message,stack:e.stack};console.error(e);}
finally{try{if(qa){const url=qa.origin;await qa.close();await assert.rejects(()=>fetch(url+'/__qa/health'));receipt.httpStopped=true;}if(native)await native.close();}catch(e){failure??=e;receipt.status='FAIL';receipt.cleanupError=e.message;}save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,run,stopped:receipt.stopped,portClosed:receipt.portClosed}));}
if(failure)process.exitCode=1;
