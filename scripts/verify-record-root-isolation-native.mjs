import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep),'External evidence only');
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'root-isolation-'));
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const receipt={kind:'record-root-entity-wait-isolation',status:'RUNNING',started:new Date().toISOString(),layer:'native PostgreSQL + actual original helpers; NOT browser/hosted',productionContacted:false,inputHead:process.env.QA_FIXED_INPUT_HEAD||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[]};
receipt.inputs=Object.fromEntries((process.env.QA_INPUT_MANIFEST?JSON.parse(fs.readFileSync(process.env.QA_INPUT_MANIFEST,'utf8')).files.map(f=>f.path).filter(p=>p.startsWith('src/')||p.startsWith('supabase/')||['scripts/record-storage-local-qa.mjs','scripts/record-storage-native-qa.mjs','scripts/record-itinerary-local-fixture.mjs','scripts/record-internal-control-local-fixture.mjs'].includes(p)):execFileSync('git',['ls-files','src','supabase','scripts/record-storage-local-qa.mjs','scripts/record-storage-native-qa.mjs','scripts/record-itinerary-local-fixture.mjs','scripts/record-internal-control-local-fixture.mjs'],{encoding:'utf8'}).trim().split(/\r?\n/)).map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
receipt.inputs['scripts/verify-record-root-isolation-native.mjs']=hash(fs.readFileSync('scripts/verify-record-root-isolation-native.mjs','utf8'));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const safeError=e=>({name:e.name,code:e.code,message:e.message,stack:e.stack?.split('\n').slice(0,5).join('\n')});
let native,qa,holder,failure,pendingA,pendingB;
try{
  native=await createNativeRecordQa(run,receipt);
  qa=await createRecordStorageLocalQa({internalControl:true,databaseFactory:async()=>native.adapter});
  const {a,b,observer}=native;let w=qa.workspace;
  holder=await native.connect('entity_holder');
  const value=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
  const current=async(c=observer)=>(await value(c,'select read_ship_dynamics_records_v1($1) r',[w])).payload;
  const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
  const {withAudit}=await qa.loadModule('/src/utils.ts');
  const {rebaseDisjointAppData}=await qa.loadModule('/src/cloudRebase.ts');
  const {assertActorAuthorizedForCloudBlockPatch}=await qa.loadModule('/src/cloudAuthorization.ts');
  const {applyVesselOperationalDraft,applyItineraryOperationalWriteMask}=await qa.loadModule('/src/vesselOperationalDraft.ts');
  const at='2026-09-08T09:00:00.000Z';
  if(process.env.QA_ROOT_AUDIT_CAP==='500'){
    const seed=await current();seed.auditLogs=Array.from({length:500},(_,i)=>({id:'root-cap-'+i,at:'2000-01-01T00:00:00.000Z',actorId:'qa-owner',actorName:'QA OWNER',actorRole:'owner',action:'synthetic import',entityType:'vessel',entityId:'qa-v2',detail:'retained raw '+i,rawUnknown:{index:i}}));
    w='root-isolation-full-cap';assert.equal((await value(observer,'select import_ship_dynamics_records_v1($1,$2::jsonb) r',[w,JSON.stringify(seed)])).ok,true);
  }
  receipt.auditCap=process.env.QA_ROOT_AUDIT_CAP==='500'?500:0;
  const base=await current();
  const make=async(vesselId,actor,id,label)=>{
    const owner='root-isolation-lease-'+actor,key='vessel:'+vesselId;
    assert.equal((await value(observer,'select claim_ship_dynamics_edit_lock($1,$2,$3,$4,120) r',[w,key,owner,actor])).ok,true);
    const draft=structuredClone(base),v=draft.vessels.find(v=>v.id===vesselId),candidate=structuredClone(v);
    candidate.note.recentDynamics=label;candidate.note.updatedAt=at;
    applyVesselOperationalDraft(v,applyItineraryOperationalWriteMask(v,candidate),at);
    const next=withAudit(draft,draft.users.find(u=>u.id===actor),'快速更新船舶','vessel',vesselId,'隔離根鎖測試');
    next.auditLogs[0].id='root-isolation-audit-'+vesselId;next.auditLogs[0].at=actor==='qa-owner'?'2026-09-08T09:00:01.000Z':at;
    const operations=buildCloudBlockPatch(base,next);
    assertActorAuthorizedForCloudBlockPatch(base,operations,actor);
    const guard=await value(observer,'select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor]);
    return {id,actor,vesselId,key,owner,next,operations,guard,locks:[{section_key:key,locked_by:owner}]};
  };
  const ra=await make('qa-v2','qa-owner','root-isolation-a','A blocked own vessel');
  const rb=await make('qa-v1','qa-operator','root-isolation-b','B independent vessel');
  const issue=(c,r)=>value(c,'select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',[w,r.id,JSON.stringify(r.operations),base.users.find(u=>u.id===r.actor).name,r.actor,JSON.stringify(r.guard),null,JSON.stringify(r.locks)]);
  const pid=name=>receipt.connections.find(c=>c.name===name).pid;
  const activity=async p=>(await observer.query('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[p])).rows[0];
  await holder.query('begin');
  await holder.query("select 1 from ship_dynamics_records where workspace_key=$1 and collection='vessels' and entity_id='qa-v2' for update",[w]);
  let aSettled=false,bSettled=false;
  pendingA=issue(a,ra).then(value=>{aSettled=true;return {value};},error=>{aSettled=true;return {error};});
  let waitingA;
  const aDeadline=Date.now()+4000;
  do{
    waitingA=await activity(pid('writer_a'));
    if(waitingA?.blockers.includes(pid('entity_holder')))break;
    if(aSettled)break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }while(Date.now()<aDeadline);
  assert.ok(waitingA?.blockers.includes(pid('entity_holder')),'A reaches real locked vessel before publication');
  assert.equal(aSettled,false);
  assert.equal((await current()).revision,base.revision,'No uncommitted A data visible');
  const bStart=performance.now();
  pendingB=issue(b,rb).then(value=>{bSettled=true;return {value};},error=>{bSettled=true;return {error};});
  let waitingB;
  const bDeadline=Date.now()+2500;
  do{
    waitingB=await activity(pid('writer_b'));
    if(bSettled||waitingB?.blockers.includes(pid('writer_a')))break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }while(Date.now()<bDeadline);
  const independentCompleted=bSettled;
  const heldPayload=await current();
  receipt.barrier={waitingA,waitingB,aSettled,bSettled,bObservedMs:performance.now()-bStart,baseRevision:base.revision,heldReadRevision:heldPayload.revision,heldReadHash:hash(heldPayload)};
  receipt.barrier.locks=(await observer.query('select pid,locktype,mode,granted,relation::regclass::text relation,transactionid::text transactionid from pg_locks where pid=any($1::int[]) order by pid,locktype,mode',[[pid('entity_holder'),pid('writer_a'),pid('writer_b')]])).rows;
  save();
  // Always release the private blocker before judging the new contract; RED leaves no queued clients.
  await holder.query('rollback');
  const [resultA,resultB]=await Promise.all([pendingA,pendingB]);pendingA=null;pendingB=null;
  receipt.results={a:resultA.error?safeError(resultA.error):resultA.value,b:resultB.error?safeError(resultB.error):resultB.value};save();
  if(resultA.error)throw resultA.error;if(resultB.error)throw resultB.error;
  assert.equal(independentCompleted,true,'Unrelated vessel B must commit while A waits for its own entity; workspace root must not cover the entity wait');
  assert.equal(resultB.value.ok,true,'B authoritative operation acknowledged');
  assert.equal(heldPayload.vessels.find(v=>v.id==='qa-v1').note.recentDynamics,rb.next.vessels.find(v=>v.id==='qa-v1').note.recentDynamics,'Fresh reader sees committed B during A wait');
  assert.equal(heldPayload.vessels.find(v=>v.id==='qa-v2').note.recentDynamics,base.vessels.find(v=>v.id==='qa-v2').note.recentDynamics,'Fresh reader cannot see pending A');
  assert.equal(resultA.value.ok,true,'A completes after its own entity becomes available');
  const fresh=await native.connect('fresh_readback'),final=await current(fresh);
  for(const r of [ra,rb]){
    assert.equal(final.vessels.find(v=>v.id===r.vesselId).note.recentDynamics,r.next.vessels.find(v=>v.id===r.vesselId).note.recentDynamics);
    assert.equal(final.auditLogs.filter(x=>x.id===r.next.auditLogs[0].id).length,1,'Exactly one actual audit per acknowledged operation');
    assert.equal(await value(observer,'select release_ship_dynamics_edit_lock($1,$2,$3) r',[w,r.key,r.owner]),true);
  }
  const oracle=rebaseDisjointAppData(base,ra.next,heldPayload,'2026-09-08T09:00:02.000Z',ra.actor);
  oracle.revision=final.revision;oracle.updatedAt=final.updatedAt;
  assert.equal(hash(final),hash(JSON.parse(JSON.stringify(oracle))),'Complete graph equals unchanged original rebase helper');
  for(const expected of [base,heldPayload,final]){
    const historical=await value(observer,'select read_ship_dynamics_record_history_v1($1,$2) r',[w,expected.revision]);
    assert.equal(hash(historical.payload),hash(expected),'Every actual commit reconstructs its exact full history');
  }
  const token=await value(observer,'select token r from ship_dynamics_record_read_bases where workspace_key=$1 and revision=$2',[w,base.revision]);
  const delta=await value(observer,'select read_ship_dynamics_record_delta_v1($1,$2,$3) r',[w,base.revision,token]);
  assert.equal(delta.status,'delta');
  const reconstructed=structuredClone(base);Object.assign(reconstructed,delta.root.set);for(const k of delta.root.deleted)delete reconstructed[k];
  for(const c of delta.collections){const map=new Map(reconstructed[c.collection].map(x=>[x.id,x]));for(const id of c.deleted)map.delete(id);for(const x of c.upserts)map.set(x.id,x);reconstructed[c.collection]=(c.order||[...map.keys()]).map(id=>map.get(id));}
  assert.equal(hash(reconstructed),hash(final),'Complete committed delta reconstructs fresh final payload');
  receipt.completeGraph={originalRebaseOracle:true,exactHistoryRevisions:[base.revision,heldPayload.revision,final.revision],deltaHash:hash(delta),reconstructedHash:hash(reconstructed)};
  assert.deepEqual(final.tasks,base.tasks,'Unrelated tasks unchanged');
  assert.deepEqual(final.internalControlCases,base.internalControlCases,'Unrelated cases unchanged');
  assert.equal(hash(await qa.itinerarySnapshot()),hash(qa.itineraryBaseline),'Itinerary and legacy authority unchanged');
  receipt.cases.push({caseId:'L1-entity-wait-does-not-hold-workspace',status:'PASS',finalRevision:final.revision,fullReadHash:hash(final)});
  receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure=safeError(e);save();console.error(JSON.stringify(receipt.failure));}
finally{
  if(holder)try{await holder.query('rollback');}catch{}
  if(pendingA||pendingB)await Promise.allSettled([pendingA,pendingB].filter(Boolean));
  try{if(qa){const port=Number(new URL(qa.origin).port);await qa.close();receipt.fixtureClosed=true;receipt.fixturePortClosed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));s.setTimeout(2000,()=>{s.destroy();resolve(false);});});assert.equal(receipt.fixturePortClosed,true);}}catch(e){failure??=e;receipt.fixtureCleanupError=safeError(e);}
  try{if(native)await native.close();}catch(e){failure??=e;receipt.cleanupError=safeError(e);}
  if(failure)receipt.status='FAIL';receipt.ended=new Date().toISOString();save();
  console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),stopped:receipt.stopped,portClosed:receipt.portClosed,fixtureClosed:receipt.fixtureClosed}));
}
if(failure)process.exitCode=1;
