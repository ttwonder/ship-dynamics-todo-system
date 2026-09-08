import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';

const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root),'Explicit repo-external QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep),'Evidence must be outside repository');
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'native-'));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
const equal=(a,b,label)=>assert.equal(hash(a),hash(b),label);
const receipt={kind:'records-v1-native-concurrency',started:new Date().toISOString(),status:'RUNNING',cases:[],productionContacted:false,layer:'native PostgreSQL + original pure helpers; NOT browser/client retry/hosted'};
receipt.inputHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
receipt.inputs=Object.fromEntries(execFileSync('git',['ls-files','src','supabase','scripts/record-storage-local-qa.mjs','scripts/record-itinerary-local-fixture.mjs','scripts/record-internal-control-local-fixture.mjs'],{encoding:'utf8'}).trim().split(/\r?\n/).map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
for(const p of ['scripts/record-storage-native-qa.mjs','scripts/verify-record-concurrency-native.mjs'])receipt.inputs[p]=hash(fs.readFileSync(p,'utf8'));
let native,qa,failure,caseId='setup';
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const check=async(id,fn)=>{caseId=id;const result=await fn();receipt.cases.push({caseId:id,status:'PASS',...result});save();console.log(JSON.stringify(receipt.cases.at(-1)));};
const safeError=e=>({name:e.name,code:e.code,message:e.message,where:e.where,stack:e.stack?.split('\n').slice(0,5).join('\n')});
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({internalControl:true,databaseFactory:async()=>native.adapter});
 receipt.fixture={name:'createRecordStorageLocalQa',internalControl:true,origin:qa.origin,workspace:qa.workspace};save();
 const {a,b,observer}=native,w=qa.workspace;
 const value=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const current=async(c=observer)=>(await value(c,'select read_ship_dynamics_records_v1($1) r',[w])).payload;
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {withAudit}=await qa.loadModule('/src/utils.ts');
 const {assertActorAuthorizedForCloudBlockPatch}=await qa.loadModule('/src/cloudAuthorization.ts');
 const {rebaseDisjointAppData}=await qa.loadModule('/src/cloudRebase.ts');
 const {applyVesselOperationalDraft,applyItineraryOperationalWriteMask}=await qa.loadModule('/src/vesselOperationalDraft.ts');
 const ic=await qa.loadModule('/src/internalControlData.ts');
 const {buildTaskScopeChangeNotifications}=await qa.loadModule('/src/taskWorkflow.ts');
 const at='2026-09-08T01:00:00.000Z',actorA='qa-owner',actorB='qa-operator';
 const owner=actor=>'native-lease-'+actor;
 const claim=async(c,key,actor)=>value(c,'select claim_ship_dynamics_edit_lock($1,$2,$3,$4,120) r',[w,key,owner(actor),actor]);
 const release=async(c,key,actor)=>value(c,'select release_ship_dynamics_edit_lock($1,$2,$3) r',[w,key,owner(actor)]);
 const acquire=async(c,keys,actor)=>{for(const key of keys)assert.equal((await claim(c,key,actor)).ok,true,'Legal lease claim '+key);};
 const stamp=(draft,actor,action,type,id)=>{const next=withAudit(draft,draft.users.find(u=>u.id===actor),action,type,id,'隔離真多連線 QA');next.auditLogs[0].id='audit-'+id+'-'+action;next.auditLogs[0].at=at;return next;};
 const make=async(base,next,actor,keys,id)=>{
  const operations=buildCloudBlockPatch(base,next);assertActorAuthorizedForCloudBlockPatch(base,operations,actor);
  const guard=await value(observer,'select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor]);
  const authorization=await value(observer,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(base)]);
  return {id,base,next,actor,operations,guard,authorization,keys,locks:keys.map(section_key=>({section_key,locked_by:owner(actor)}))};
 };
 const issue=(c,r,fn='apply_ship_dynamics_record_patch_v1')=>value(c,`select ${fn}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r`,[w,r.id,JSON.stringify(r.operations),r.base.users.find(u=>u.id===r.actor).name,r.actor,JSON.stringify(r.guard),JSON.stringify(r.authorization),JSON.stringify(r.locks)]);
 const envelope=r=>({id:r.id,actor:r.actor,baseRevision:r.base.revision,operations:r.operations.map(o=>({kind:o.kind,collection:o.collection,entityId:o.entityId,expectedIds:o.expectedIds,valueIds:o.valueIds})),signatureSha256:hash([r.operations,r.actor,r.guard,r.authorization,r.locks])});
 const ledger=async(connection=observer)=>{
  const tables=(await connection.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const all={};for(const {tablename} of tables)all[tablename]=(await connection.query(`select to_jsonb(t) v from public."${tablename}" t order by to_jsonb(t)::text`)).rows;
  return {sha256:hash(all),counts:Object.fromEntries(Object.entries(all).map(([k,v])=>[k,v.length]))};
 };
 const verifyPayload=(actual,expected)=>{
  const normalized=structuredClone(expected);normalized.revision=actual.revision;normalized.updatedAt=actual.updatedAt;
  for(const audit of normalized.auditLogs){const saved=actual.auditLogs.find(a=>a.id===audit.id);for(const field of ['ipAddress','ipCountryCode'])if(saved&&Object.hasOwn(saved,field))audit[field]=saved[field];}
  equal(actual,JSON.parse(JSON.stringify(normalized)),'Complete authoritative payload matches submitted + peer content');
 };
 const vesselDraft=(base,id,actor,label)=>{
  const draft=structuredClone(base),v=draft.vessels.find(v=>v.id===id),candidate=structuredClone(v);
  candidate.note.recentDynamics=label;candidate.note.updatedAt=at;
  applyVesselOperationalDraft(v,applyItineraryOperationalWriteMask(v,candidate),at);
  return stamp(draft,actor,'快速更新船舶','vessel',id+'-'+label);
 };
 // Audit entity identity must remain the actual vessel ID, not the receipt ID.
 const vesselRequest=async(base,id,actor,label)=>{
  const next=vesselDraft(base,id,actor,label);next.auditLogs[0].entityId=id;
  return make(base,next,actor,['vessel:'+id],label);
 };
 const observeWait=async(blocked,blocker)=>{
  const deadline=Date.now()+4000;let activity;
  do{
   activity=(await observer.query('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[blocked])).rows[0];
   if(activity?.blockers.includes(blocker))break;
   await new Promise(r=>setTimeout(r,10));
  }while(Date.now()<deadline);
  assert.ok(activity?.blockers.includes(blocker),'Real peer backend must block pending SQL');assert.equal(activity.wait_event_type,'Lock');
  const locks=(await observer.query("select pid,locktype,mode,granted,relation::regclass::text relation,page,tuple,transactionid::text transactionid from pg_locks where pid=any($1::int[]) order by pid,locktype,mode",[[blocked,blocker]])).rows;
  assert.ok(locks.some(l=>l.pid===blocked&&!l.granted),'pg_locks contains an ungranted peer lock');
  assert.ok(locks.some(l=>l.pid===blocked&&l.relation==='ship_dynamics_record_workspaces'),'Waiting writer touches real workspace root');
  return {activity,locks,rootSql:'supabase/development/20260906_appdata_record_store.sql:447',rootStatement:'select * into workspace from public.ship_dynamics_record_workspaces where workspace_key=p_workspace_key for update'};
 };
 const overlap=async(ra,rb)=>{
  const before=await ledger();await a.query('begin');
  const ackA=await issue(a,ra);assert.equal(ackA.ok,true,'A valid SQL operation commits');
  const aOnlyLedger=await ledger(a);
  // A has executed all record writes but still owns its uncommitted transaction.
  assert.equal((await current()).revision,ra.base.revision,'Observer cannot see A before COMMIT');
  let settled=false;const pending=issue(b,rb).then(result=>{settled=true;return {result};},error=>{settled=true;return {error};});
  const pidA=nativePid('writer_a'),pidB=nativePid('writer_b');
  const wait=await observeWait(pidB,pidA);assert.equal(settled,false);
  receipt.pendingBarrier={caseId,a:envelope(ra),b:envelope(rb),wait};save();
  await a.query('commit');const ended=await pending;if(ended.error)throw ended.error;
  const ackB=ended.result;let retry=null,expected=rb.next;
  if(!ackB.ok){
   assert.equal(ackB.code,'block-conflict','Only genuine CAS rejection is accepted');
   const remote=await current();verifyPayload(remote,ra.next);
   const afterReject=await ledger();equal(afterReject,aOnlyLedger,'Rejected B leaves exactly A-only committed ledger');
   // Invoke the existing pure rebase + patch builders manually, not App retry.
   expected=rebaseDisjointAppData(rb.base,rb.next,remote,at,rb.actor);
   const rebased=await make(remote,expected,rb.actor,rb.keys,rb.id+'-rebase');
   retry=await issue(b,rebased);assert.equal(retry.ok,true,'Legal manual helper rebase must save peer intent');
   retry={...retry,layer:'SQL harness invokes original pure rebase; NOT App automatic retry',afterReject,envelope:envelope(rebased)};
  }else expected=rebaseDisjointAppData(rb.base,rb.next,ra.next,at,rb.actor);
  const actual=await current();verifyPayload(actual,expected);
  delete receipt.pendingBarrier;
  return {before,aOnlyLedger,after:await ledger(),sameBaseRevision:ra.base.revision,a:envelope(ra),b:envelope(rb),ackA,ackB,retry,wait,fullReadbackSha256:hash(actual)};
 };
 const nativePid=name=>receipt.connections.find(c=>c.name===name).pid;
 await check('N1-entity-leases',async()=>{
  await a.query('begin');assert.equal((await claim(a,'vessel:qa-v2',actorA)).ok,true);
  assert.equal((await claim(b,'vessel:qa-v1',actorB)).ok,true);
  assert.equal((await observer.query('select pg_blocking_pids($1) p',[nativePid('writer_b')])).rows[0].p.length,0);
  await a.query('commit');const denied=await claim(b,'vessel:qa-v2',actorB);assert.equal(denied.ok,false);assert.equal(denied.locked_by,owner(actorA));
  return {differentVesselsCoexist:true,sameVesselDenied:true,actors:[actorA,actorB],backendPids:[nativePid('writer_a'),nativePid('writer_b')]};
 });
 await check('N2-different-vessels-same-base',async()=>{
  const base=await current();const ra=await vesselRequest(base,'qa-v2',actorA,'甲船保存'),rb=await vesselRequest(base,'qa-v1',actorB,'乙船保存');
  const result=await overlap(ra,rb);assert.equal((await current()).vessels.find(v=>v.id==='qa-v2').note.recentDynamics,'甲船保存');assert.equal((await current()).vessels.find(v=>v.id==='qa-v1').note.recentDynamics,'乙船保存');return result;
 });
 await check('N3-task-and-case-create',async()=>{
  const base=await current();let da=structuredClone(base),db=structuredClone(base);
  const task={id:'native-ordinary-task',vesselId:'qa-v2',vesselIds:['qa-v2'],description:'並行普通要事',priority:'低',isAware:false,isAbnormal:false,isInternalControl:false,category:'其他',categories:['其他'],status:'處理中',statusLogs:[],expectedDate:'',reportDate:'2026-09-08',departments:['督導'],ownerUserIds:[],isClosed:false,sourceType:'morning',createdBy:actorA,updatedBy:actorA,createdAt:at,updatedAt:at};
  da.tasks.push(task);da=stamp(da,actorA,'新增事項','task',task.id);
  const item={id:'native-created-case',vesselId:'qa-v1',reportDate:'2026-09-08',reportSource:'訪船',description:'並行內控',priority:'低',category:'維修',isAware:false,status:'安排處理',departments:['督導'],syncToTask:true,isClosed:false,createdBy:actorB,updatedBy:actorB,createdAt:at,updatedAt:at,statusLogs:[]};
  ic.createInternalControlCases(db,[item],db.users.find(u=>u.id===actorB),at,{[item.id]:{categories:['維修'],expectedDate:'',ownerUserIds:[actorB],isAbnormal:false}});
  db=stamp(db,actorB,'批量新增內控異常','internal-control',item.id);
  const ka=['task-create:v2:qa-v2:'+task.id],kb=['internal-control-create:native-case'];await acquire(a,ka,actorA);await acquire(b,kb,actorB);
  const result=await overlap(await make(base,da,actorA,ka,'native-task-create'),await make(base,db,actorB,kb,'native-case-create'));
  const saved=await current(),c=saved.internalControlCases.find(c=>c.id===item.id);assert.equal(saved.tasks.filter(t=>t.internalControlCaseId===c.id).length,1);assert.equal(saved.tasks.find(t=>t.id===c.linkedTaskId).internalControlCaseId,c.id);assert.equal(saved.tasks.filter(t=>t.id===task.id).length,1);return result;
 });
 await check('N4-stale-same-entity-CAS',async()=>{
  const base=await current(),stale=await vesselRequest(base,'qa-v1',actorA,'stale-do-not-save');
  const newest=await vesselRequest(base,'qa-v1',actorB,'已保存新版');assert.equal((await issue(b,newest)).ok,true);
  await release(b,'vessel:qa-v1',actorB);await acquire(a,['vessel:qa-v1'],actorA);
  const before=await ledger(),result=await issue(a,stale);assert.equal(result.code,'block-conflict');assert.equal(result.conflict_key,'vessels:qa-v1');equal(await ledger(),before,'Stale rejection is zero-write');
  const rejectedAfter=await ledger();
  assert.equal((await current()).vessels.find(v=>v.id==='qa-v1').note.recentDynamics,'已保存新版');await release(a,'vessel:qa-v1',actorA);await acquire(b,['vessel:qa-v1'],actorB);
  return {result,leaseSequence:'B valid save -> B release -> A claim -> stale expected rejected',before,rejectedAfter,afterLeaseHandoff:await ledger()};
 });
 await check('N5-linked-close-late-rollback',async()=>{
  const base=await current();let draft=structuredClone(base);const item=draft.internalControlCases.find(c=>c.id==='qa-withdraw'),oldTask=structuredClone(draft.tasks.find(t=>t.id===item.linkedTaskId));
  ic.updateInternalControlCase(draft,{...item,isClosed:true,closedDate:'2026-09-08'},item.updatedAt,draft.users.find(u=>u.id===actorA),at);
  const task=draft.tasks.find(t=>t.id===item.linkedTaskId);
  const side=t=>({task:t,vessels:draft.vessels.filter(v=>(t.vesselIds?.length?t.vesselIds:[t.vesselId]).includes(v.id))});
  const notices=buildTaskScopeChangeNotifications(draft.users,side(oldTask),side(task),actorA,'task_updated','QA OWNER',draft.settings.rolePermissions);
  assert.ok(notices.length>0,'Linked close exercises notification writes');draft.notifications=[...notices,...draft.notifications].slice(0,1000);draft=stamp(draft,actorA,'結案內控異常','internal-control',item.id);
  const keys=['internal-control:'+item.id,'task:'+item.linkedTaskId];await acquire(a,keys,actorA);const request=await make(base,draft,actorA,keys,'native-close-rollback');
  for(const name of ['tasks','internalControlCases','notifications','auditLogs'])assert.ok(request.operations.some(o=>o.kind==='entity'&&o.collection===name),'Linked graph includes '+name);
  await observer.query("create sequence qa_receipt_reached;create function qa_native_late_failure() returns trigger language plpgsql as $$begin perform nextval('qa_receipt_reached');raise exception 'QA_NATIVE_LATE_RECEIPT_FAILURE';end$$;create trigger qa_native_late_failure before insert on ship_dynamics_record_receipts for each row execute function qa_native_late_failure()");
  const before=await ledger();
  try{await assert.rejects(issue(a,request),/QA_NATIVE_LATE_RECEIPT_FAILURE/);equal(await ledger(),before,'All public business tables rollback, including history/revisions/receipts');assert.equal((await observer.query('select is_called from qa_receipt_reached')).rows[0].is_called,true);}
  finally{await observer.query('drop trigger qa_native_late_failure on ship_dynamics_record_receipts;drop function qa_native_late_failure();drop sequence qa_receipt_reached');}
  const rejectedAfter=await ledger(),positive=await issue(a,request);assert.equal(positive.ok,true,'Identical linked graph succeeds without private fault');verifyPayload(await current(),draft);
  const saved=await current();assert.equal(saved.internalControlCases.find(c=>c.id===item.id).isClosed,true);assert.equal(saved.tasks.find(t=>t.id===item.linkedTaskId).isClosed,true);
  return {errorClass:'EXPECTED_QA_INJECTED_FAILURE',before,rejectedAfter,receiptTriggerReached:true,sequenceExcluded:'private nontransactional entry counter only',positive,envelope:envelope(request),after:await ledger()};
 });
 await check('N6-lost-reply-replay-with-peer',async()=>{
  const base=await current(),lost=await vesselRequest(base,'qa-v2',actorA,'lost-ack');const original=await issue(a,lost);assert.equal(original.ok,true);
  // The harness discards delivery only after actual commit, no network fiction.
  const remote=await current(),peer=await vesselRequest(remote,'qa-v1',actorB,'peer-after-lost');await a.query('begin');const peerResult=await issue(a,peer);assert.equal(peerResult.ok,true);
  const beforeReplay=await ledger(),replayed=await issue(b,lost),status=await issue(b,lost,'get_ship_dynamics_record_receipt_v1');assert.equal(replayed.replayed,true);assert.equal(replayed.revision,original.revision);assert.equal(status.status,'committed');equal(await ledger(),beforeReplay,'Replay changes nothing while peer transaction is held');
  await a.query('commit');const saved=await current();verifyPayload(saved,peer.next);assert.equal(saved.auditLogs.filter(x=>x.id===lost.next.auditLogs[0].id).length,1);
  const finalBefore=await ledger();assert.equal((await issue(b,lost)).revision,original.revision);equal(await ledger(),finalBefore,'Replay after newer revision is zero-write');
  return {delivery:'SQL result intentionally discarded; no browser/HTTP assertion',original,replayed,operationStatus:status,peerResult,peerHeldDuringReplay:true,after:await ledger()};
 });
 const fresh=await native.connect('fresh_readback'),freshPayload=await current(fresh);equal(freshPayload,await current(),'Independent fresh connection complete readback');
 equal(await qa.itinerarySnapshot(),qa.itineraryBaseline,'Formal Itinerary and contradictory legacy authority unchanged');
 receipt.final={revision:freshPayload.revision,fullReadbackSha256:hash(freshPayload),ledger:await ledger(),formalAndLegacyUnchanged:true};
 assert.equal(new Set(receipt.cases.map(c=>c.caseId)).size,6);assert.ok(receipt.cases.every(c=>c.status==='PASS'));receipt.uniqueCases=6;receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={caseId,...safeError(e)};save();console.error(JSON.stringify(receipt.failure));}
finally{
 try{if(qa){const port=new URL(qa.origin).port;await qa.close();receipt.fixtureClosed=true;receipt.fixturePortClosed=await new Promise(r=>{const s=net.connect({host:'127.0.0.1',port:Number(port)});s.once('connect',()=>{s.destroy();r(false);});s.once('error',()=>r(true));s.setTimeout(2000,()=>{s.destroy();r(false);});});assert.equal(receipt.fixturePortClosed,true);}}catch(e){failure??=e;receipt.fixtureCleanupError=safeError(e);}
 try{if(native)await native.close();}catch(e){failure??=e;receipt.cleanupError=safeError(e);}
 if(failure)receipt.status='FAIL';receipt.ended=new Date().toISOString();save();console.log(JSON.stringify({status:receipt.status,uniqueCases:new Set(receipt.cases.map(c=>c.caseId)).size,receipt:path.join(run,'receipt.json'),stopped:receipt.stopped,portClosed:receipt.portClosed,fixtureClosed:receipt.fixtureClosed}));
}
if(failure)process.exitCode=1;
