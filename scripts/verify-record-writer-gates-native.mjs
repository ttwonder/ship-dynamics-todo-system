import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));
fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'writer-gates-'));
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=x=>createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');
const receipt={kind:'record-writer-gates-native',inputHead:process.env.QA_FIXED_INPUT_HEAD||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'RUNNING',cases:[],productionContacted:false,layer:'owned loopback native PostgreSQL, not browser/hosted'};
receipt.inputs=Object.fromEntries(['supabase/development/20260906_appdata_record_store.sql','supabase/development/20260906_appdata_record_data_management.sql','supabase/development/20260906_record_daily_morning_scheduler.sql','scripts/verify-record-writer-gates-native.mjs'].map(p=>[p,hash(fs.readFileSync(p,'utf8'))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
let native,qa,failure,holder;
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({internalControl:true,dataManagement:true,databaseFactory:async()=>native.adapter});
 const {a,b,observer}=native;
 await observer.query(fs.readFileSync('supabase/development/20260906_record_daily_morning_scheduler.sql','utf8'));
 holder=await native.connect('entity_holder');
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const read=async(w,c=observer)=>(await q(c,'select read_ship_dynamics_records_v1($1) r',[w])).payload;
 const template=await read(qa.workspace);
 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const {withAudit}=await qa.loadModule('/src/utils.ts');
 const {assertActorAuthorizedForCloudBlockPatch}=await qa.loadModule('/src/cloudAuthorization.ts');
 const {rebaseDisjointAppData}=await qa.loadModule('/src/cloudRebase.ts');
 let n=0;
 const fixture=async()=>{const w='writer-gates-'+(++n);assert.equal((await q(observer,'select import_ship_dynamics_records_v1($1,$2::jsonb) r',[w,JSON.stringify(template)])).ok,true);return w;};
 const claim=async(w,key,owner='gate-owner')=>assert.equal(await q(observer,'select (claim_ship_dynamics_edit_lock($1,$2,$3,$4,120)->>\'ok\')::boolean r',[w,key,owner,'QA OWNER']),true);
 const request=async(w,mutate,{actor='qa-owner',keys=[],snapshot=null}={})=>{
  const base=snapshot||await read(w),draft=structuredClone(base);mutate(draft);
  const operations=buildCloudBlockPatch(base,draft);assertActorAuthorizedForCloudBlockPatch(base,operations,actor);
  return {w,id:'gate-op-'+(++n),actor,base,next:draft,operations,guard:await q(observer,'select ship_dynamics_actor_guard($1::jsonb,$2) r',[JSON.stringify(base),actor]),auth:await q(observer,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(base)]),locks:keys.map(section_key=>({section_key,locked_by:'gate-owner'}))};
 };
 const vessel=async(w,id,label,snapshot=null)=>{await claim(w,'vessel:'+id);return request(w,d=>{
  d.vessels.find(v=>v.id===id).note.recentDynamics=label;
  const next=withAudit(d,d.users.find(u=>u.id==='qa-owner'),'快速更新船舶','vessel',id,'Native lock test');
  next.auditLogs[0].id='gate-audit-'+(++n);next.auditLogs[0].at=new Date(Date.UTC(2026,8,8,10,0,n)).toISOString();Object.assign(d,next);
 },{keys:['vessel:'+id],snapshot});};
 const issue=(c,r,fn='apply_ship_dynamics_record_patch_v1')=>q(c,`select ${fn}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r`,[r.w,r.id,JSON.stringify(r.operations),r.base.users.find(u=>u.id===r.actor).name,r.actor,JSON.stringify(r.guard),JSON.stringify(r.auth),JSON.stringify(r.locks)]);
 const ledger=async(w,c=observer)=>{const out={};for(const {tablename:t} of (await c.query("select tablename from pg_tables where schemaname='public' and tablename like 'ship_dynamics_record%' order by tablename")).rows)out[t]=(await c.query(`select to_jsonb(t) r from ${t} t where workspace_key=$1 order by to_jsonb(t)::text`,[w])).rows;return hash(out);};
 const wait=async(c,blocker)=>{let row;const deadline=Date.now()+4000;do{row=(await observer.query('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[c.processID])).rows[0];if(row.blockers.includes(blocker.processID)&&row.wait_event_type==='Lock'&&row.wait_event)return row;await new Promise(r=>setTimeout(r,10));}while(Date.now()<deadline);assert.fail('Expected native lock barrier '+JSON.stringify(row));};
 const pending=(c,r)=>issue(c,r).then(value=>({value}),error=>({error:{code:error.code,message:error.message}}));
 const check=async(caseId,fn)=>{const result=await fn();receipt.cases.push({caseId,status:'PASS',...result});save();console.log(caseId);};
 const lockVessel=async(w,id='qa-v2')=>{await holder.query('begin');await holder.query("select 1 from ship_dynamics_records where workspace_key=$1 and collection='vessels' and entity_id=$2 for update",[w,id]);};
 await check('G1-actor-recheck-after-entity-wait',async()=>{
  const w=await fixture(),r=await vessel(w,'qa-v2','must reject');await lockVessel(w);const p=pending(a,r);const barrier=await wait(a,holder);
  const admin=await request(w,d=>{d.users.find(u=>u.id==='qa-owner').isActive=false;});assert.equal((await issue(b,admin)).ok,true);
  const before=await ledger(w);await holder.query('rollback');const result=(await p).value;assert.equal(result.code,'authorization-conflict');assert.equal(await ledger(w),before);
  return {barrier,result,zeroWrites:true};
 });
 await check('G2-exact-lease-recheck-after-entity-wait',async()=>{
  const w=await fixture(),r=await vessel(w,'qa-v2','must reject');await lockVessel(w);const p=pending(a,r);const barrier=await wait(a,holder);
  assert.equal(await q(observer,'select release_ship_dynamics_edit_lock($1,$2,$3) r',[w,'vessel:qa-v2','gate-owner']),true);await claim(w,'vessel:qa-v2','successor-owner');
  const before=await ledger(w);await holder.query('rollback');const result=(await p).value;assert.equal(result.code,'lock-conflict');assert.equal(await ledger(w),before);return {barrier,result,zeroWrites:true};
 });
 await check('G3-current-row-hydrated-after-lock-wait',async()=>{
  const w=await fixture(),r=await vessel(w,'qa-v2','stale must reject');await holder.query('begin');const latest=structuredClone(r);latest.id+='-new';latest.operations.find(x=>x.collection==='vessels').value.note.recentDynamics='new committed body';assert.equal((await issue(holder,latest)).ok,true);
  const p=pending(a,r),barrier=await wait(a,holder);await holder.query('commit');const before=await ledger(w);const result=(await p).value;assert.equal(result.code,'block-conflict');assert.equal(result.conflict_key,'vessels:qa-v2');assert.equal(await ledger(w),before);return {barrier,result,zeroWrites:true};
 });
 await check('G4-missing-row-same-id-insert-CAS',async()=>{
  const w=await fixture(),base=await read(w),make=()=>request(w,d=>{d.taskDismissals.push({id:'same-new-id',itemKind:'task',itemId:d.tasks[0].id,userId:'qa-owner',dismissedBy:'qa-owner'});},{snapshot:base});
  const ra=await make(),rb=await make();await a.query('begin');assert.equal((await issue(a,ra)).ok,true);const p=pending(b,rb),barrier=await wait(b,a);await a.query('commit');const before=await ledger(w),result=(await p).value;assert.equal(result.code,'block-conflict');assert.equal(await ledger(w),before);assert.equal((await read(w)).taskDismissals.filter(x=>x.id==='same-new-id').length,1);return {barrier,result};
 });
 await check('G5-opposite-multi-entity-input-order-no-deadlock',async()=>{
  const w=await fixture(),base=await read(w);const make=()=>request(w,d=>{for(const id of ['multi-one','multi-two'])d.taskDismissals.push({id,itemKind:'task',itemId:d.tasks[0].id,userId:'qa-owner',dismissedBy:'qa-owner'});},{snapshot:base});
  const ra=await make(),rb=await make();rb.operations.reverse();
  await holder.query('begin');
  const keys=await observer.query("select hashtext(jsonb_build_array('taskDismissals',id)::text) k from unnest($1::text[]) id order by 1",[['multi-one','multi-two']]);
  await holder.query("select pg_advisory_xact_lock(hashtext('record-entity-v1:'||$1),$2)",[w,keys.rows[0].k]);
  const pa=pending(a,ra),pb=pending(b,rb);const barriers=[await wait(a,holder),await wait(b,holder)];await holder.query('rollback');const results=await Promise.all([pa,pb]);assert.equal(results.filter(x=>x.value?.ok).length,1);assert.equal(results.filter(x=>x.value?.code==='block-conflict').length,1);assert.ok(results.every(x=>!x.error));return {barriers,results};
 });
 await check('G6-same-operation-overlap-exact-replay',async()=>{
  const w=await fixture(),r=await vessel(w,'qa-v2','one receipt');await a.query('begin');const ack=await issue(a,r);assert.equal(ack.ok,true);const p=pending(b,r),barrier=await wait(b,a);await a.query('commit');const before=await ledger(w),replay=(await p).value;assert.equal(replay.replayed,true);assert.equal(replay.revision,ack.revision);assert.equal(await ledger(w),before);return {barrier,ack,replay};
 });
 for(const coarse of ['scheduler','prune','import'])await check('G7-'+coarse+'-exclusive-before-root',async()=>{
  const w=coarse==='scheduler'?qa.workspace:await fixture(),r=await vessel(w,'qa-v2','before '+coarse);await lockVessel(w);const pa=pending(a,r),entityBarrier=await wait(a,holder);
  let promise;
  if(coarse==='scheduler')promise=q(b,'select run_ship_dynamics_record_daily_morning_v1($1,$2,$3::timestamptz) r',[w,'gate-scheduler','2026-09-08T01:00:00.000Z']);
  if(coarse==='prune')promise=q(b,'select prune_ship_dynamics_record_revision_history_v1($1,$2,$3::uuid,$4::jsonb,$5::jsonb) r',[w,'qa-owner',randomUUID(),'[1]','[1]']);
  if(coarse==='import')promise=q(b,'select import_ship_dynamics_records_v1($1,$2::jsonb) r',[w,JSON.stringify(template)]);
  const pb=promise.then(value=>({value}),error=>({error:{code:error.code,message:error.message}}));const gateBarrier=await wait(b,a);assert.equal(gateBarrier.wait_event,'advisory');
  // Coarse writer has not taken the root while waiting for prepared entities.
  await observer.query('begin');await observer.query('select 1 from ship_dynamics_record_workspaces where workspace_key=$1 for no key update nowait',[w]);await observer.query('rollback');
  await holder.query('rollback');const [ra,rb]=await Promise.all([pa,pb]);assert.equal(ra.value?.ok,true);assert.ok(!rb.error,JSON.stringify(rb));if(coarse==='prune')assert.equal(rb.value.error,'REVISION_SET_CHANGED');else assert.equal(rb.value.ok,true);
  return {entityBarrier,gateBarrier,rootAvailableWhileCoarseWaits:true,ra,rb};
 });
 await check('G8-private-materializers-fail-closed',async()=>{
  const w=await fixture(),before=await ledger(w);await assert.rejects(q(observer,"select ship_dynamics_record_commit_validated_v1($1,'[]','{}','{}','QA','unguarded','[]') r",[w]),e=>e.code==='55000'&&/prepare-required/.test(e.message));
  await assert.rejects(q(observer,"select ship_dynamics_record_progress_write_v1($1,'task','{}',2) r",[w]),e=>e.code==='55000');assert.equal(await ledger(w),before);
  for(const role of ['anon','authenticated']){await observer.query('begin');await observer.query('set local role '+role);await assert.rejects(q(observer,'select ship_dynamics_record_writer_gate_v1($1,false) r',[w]),e=>e.code==='42501');await observer.query('rollback');}
  return {zeroWrites:true,rolesDenied:['anon','authenticated']};
 });
 await check('G9-root-FK-key-share-compatible-during-publish',async()=>{
  const w=await fixture(),r=await vessel(w,'qa-v2','root FK control');await holder.query('begin');await holder.query('select 1 from ship_dynamics_record_workspaces where workspace_key=$1 for key share',[w]);const result=await issue(a,r);assert.equal(result.ok,true);await holder.query('rollback');return {result};
 });
 await check('G10-maintenance-gate-before-DDL',async()=>{
  const w=await fixture(),r=await vessel(w,'qa-v2','before upgrade');await lockVessel(w);const pa=pending(a,r);const entityBarrier=await wait(a,holder);
  const pb=b.query(fs.readFileSync('supabase/development/20260906_appdata_record_store.sql','utf8')).then(()=>({ok:true}),e=>({error:e.message,code:e.code}));const maintenanceBarrier=await wait(b,a);assert.equal(maintenanceBarrier.wait_event,'advisory');await holder.query('rollback');assert.equal((await pa).value?.ok,true);const result=await pb;assert.equal(result.ok,true);assert.equal((await read(w)).vessels.find(v=>v.id==='qa-v2').note.recentDynamics,'before upgrade');return {entityBarrier,maintenanceBarrier,result};
 });
 await check('G11-contended-shared-to-coarse-upgrade-aborts-not-deadlocks',async()=>{
  const w=await fixture();for(const c of [a,b]){await c.query('begin');await q(c,'select ship_dynamics_record_writer_gate_v1($1,false) r',[w]);}
  await assert.rejects(q(a,'select ship_dynamics_record_writer_gate_v1($1,true) r',[w]),e=>e.code==='40001');await a.query('rollback');await q(b,'select ship_dynamics_record_writer_gate_v1($1,true) r',[w]);await b.query('rollback');return {contendedCode:'40001',uncontendedUpgrade:true};
 });
 await check('G12-second-command-after-publish-cannot-invert-entity-order',async()=>{
  const w=await fixture(),ra=await vessel(w,'qa-v1','transaction A'),rb=await vessel(w,'qa-v2','transaction B');
  await a.query('begin');assert.equal((await issue(a,ra)).ok,true);
  const pb=pending(b,rb),barrier=await wait(b,a);
  const ra2=await vessel(w,'qa-v2','second A command',await read(w,a));
  const second=await pending(a,ra2);await a.query('rollback');const peer=await pb;
  receipt.multiCommandProbe={barrier,second,peer};save();
  assert.equal(second.error?.code,'40001','A prior publisher must not wait for a new entity held by a publisher waiting on A');
  assert.equal(peer.value?.ok,true,'B completes after safe A transaction rollback');
  assert.equal((await read(w)).vessels.find(v=>v.id==='qa-v1').note.recentDynamics,ra.base.vessels.find(v=>v.id==='qa-v1').note.recentDynamics,'All of failed A transaction rolls back');
  return {barrier,second,peer};
 });
 receipt.status='PASS';
}catch(e){failure=e;receipt.status='FAIL';receipt.failure={code:e.code,message:e.message,stack:e.stack};console.error(e);}
finally{
 if(holder)try{await holder.query('rollback');}catch{}
 if(native)for(const c of [native.a,native.b,native.observer])try{await c.query('rollback');}catch{}
 if(qa){const port=Number(new URL(qa.origin).port);await qa.close();receipt.fixtureClosed=true;receipt.fixturePortClosed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));});}
 if(native)try{await native.close();}catch(e){failure??=e;receipt.status='FAIL';receipt.cleanupError={code:e.code,message:e.message};}save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,receipt:path.join(run,'receipt.json'),stopped:receipt.stopped,portClosed:receipt.portClosed}));
}
if(failure)process.exitCode=1;
