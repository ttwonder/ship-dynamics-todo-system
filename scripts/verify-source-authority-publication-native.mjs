import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {seedQuiescenceLinkedGraph} from './business-quiescence-remainder-qa.mjs';
const root=process.env.QA_EVIDENCE_ROOT;
assert.ok(root&&path.isAbsolute(root)&&!path.resolve(root).startsWith(path.resolve('.')+path.sep));
fs.mkdirSync(root,{recursive:true});const run=fs.mkdtempSync(path.join(root,'publication-native-'));
const addon='supabase/development/20260911_source_authority_publication.sql';
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=[...new Set([...execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean),addon,'scripts/verify-source-authority-publication-native.mjs','docs/source-authority-publication-local.md'].filter(f=>fs.existsSync(f)))];
const receipt={kind:'source-authority-publication-native',status:'RUNNING',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs:Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(f))])),encoding:'SHA256 raw file bytes',cases:[],productionContacted:false};
for(const f of files){const dest=path.join(root,'input-blobs',receipt.inputs[f]);if(!fs.existsSync(dest)){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(f,dest);}}
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));

// Derived regression runners keep the original assertions byte-for-byte. Only
// fixture composition/install hooks and absolute imports change. All producer
// recipes, resulting runners and raw input identities live outside the repo.
if(process.argv.includes('--regressions')){
 const {pathToFileURL}=await import('node:url');
 const extra=['supabase/development/20260911_paused_record_legacy_transfer.sql',addon];
 const after=(client,paths)=>paths.map(f=>`await ${client}.query(fs.readFileSync(${JSON.stringify(f)},'utf8'));`).join('');
 const replaceExact=(s,old,next,all=false)=>{const n=s.split(old).length-1;assert.ok(all?n>0:n===1,'regression producer anchor count '+n);return all?s.split(old).join(next):s.replace(old,next);};
 receipt.kind='source-authority-addon-regressions';receipt.regressionCommands=[];
 for(const kind of ['pause','stage','provenance']){
  const original={pause:'scripts/verify-business-quiescence-native.mjs',stage:'scripts/verify-paused-record-legacy-transfer-native.mjs',provenance:'scripts/verify-legacy-restore-provenance-native.mjs'}[kind];
  let text=fs.readFileSync(original,'utf8');const recipe=[];
  if(kind==='pause'){
   const needle="await observer.query(fs.readFileSync(sqlFile,'utf8'));";
   text=replaceExact(text,needle,needle+after('observer',extra),true);recipe.push('after EVERY pause installation, install stage and authority addons');
  }else if(kind==='stage'){
   const needle="await observer.query(fs.readFileSync(addon,'utf8'));";
   text=replaceExact(text,needle,needle+after('observer',[addon]),true);recipe.push('after EVERY stage installation, install authority addon');
  }else{
   text=replaceExact(text,"import {createNativeRecordQa}","import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';\nimport {createNativeRecordQa}");
   text=replaceExact(text,'let native,failed=false;','let native,qa,failed=false;');
   const begin=" await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');\n await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));";
   text=replaceExact(text,begin," qa=await createRecordStorageLocalQa({dailyMorning:'browser',taskMember:true,databaseFactory:async()=>native.adapter});");
   const needle="const maintenance=fs.readFileSync('supabase/normalized-legacy-cutover.sql','utf8');await db.exec(maintenance);";
   const prerequisites=['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql',...extra];
   text=replaceExact(text,needle,needle+after('observer',prerequisites));
   // Restore schema + maintenance deliberately resets some legacy triggers;
   // reinstall full addons at every such boundary, retaining all old oracles.
   const reapply="await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));await db.exec(maintenance);";
   text=replaceExact(text,reapply,reapply+after('observer',prerequisites));
   const lf="await db.exec(maintenance.replace(/\\r\\n/g,'\\n'));";
   text=replaceExact(text,lf,lf+after('observer',prerequisites));
   text=replaceExact(text,'finally{if(native)','finally{if(qa)await qa.close();if(native)');
   recipe.push('replace minimal schema bootstrap with existing real original-App local fixture; retain provenance synthetic workspaces','install complete prerequisites then addon; repeat after base reapply; close fixture');
  }
  text=text.replace(/from '(\.\/[^']+)'/g,(_,rel)=>`from '${pathToFileURL(path.resolve('scripts',rel)).href}'`);
  const target=path.join(run,kind+'-with-authority.mjs');fs.writeFileSync(target,text);
  const producer={kind,original,originalSha256:sha(fs.readFileSync(original)),generated:target,generatedSha256:sha(fs.readFileSync(target)),recipe,imports:'relative scripts imports -> absolute file URLs; no assertion substitutions'};
  fs.writeFileSync(path.join(run,kind+'-producer.json'),JSON.stringify(producer,null,2));
  const fd=fs.openSync(path.join(run,kind+'-command.log'),'w');let exit=0;
  const childRoot=path.join(run,kind);fs.mkdirSync(childRoot,{recursive:true});
  try{execFileSync(process.execPath,[target],{env:{...process.env,QA_EVIDENCE_ROOT:childRoot},stdio:['ignore',fd,fd],timeout:240000,windowsHide:true});}catch(e){exit=e.status??1;}finally{fs.closeSync(fd);}
  const children=fs.readdirSync(childRoot).map(f=>path.join(childRoot,f,'receipt.json')).filter(f=>fs.existsSync(f));assert.equal(children.length,1);
  const child=JSON.parse(fs.readFileSync(children[0],'utf8'));
  receipt.regressionCommands.push({kind,exit,receipt:children[0],status:child.status,producer});
  receipt.cases.push(...child.cases.map(c=>({...c,layer:'native-addon-'+kind})));
  save();
 }
 receipt.inputsUnchanged=files.every(f=>sha(fs.readFileSync(f))===receipt.inputs[f]);
 receipt.status=receipt.inputsUnchanged&&receipt.regressionCommands.every(x=>x.exit===0&&x.status==='PASS')?'PASS':'FAIL';save();
 console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),commands:receipt.regressionCommands.map(({kind,exit,status,receipt})=>({kind,exit,status,receipt})),cases:receipt.cases.length}));process.exit(receipt.status==='PASS'?0:1);
}
let native,qa,failure;
try{
 native=await createNativeRecordQa(run,receipt);
 qa=await createRecordStorageLocalQa({dailyMorning:'browser',taskMember:true,scopedRead:true,performanceTrace:true,preparePerformanceFixture:async initial=>seedQuiescenceLinkedGraph(initial),databaseFactory:async()=>native.adapter});
 receipt.fixtureHttpPort=Number(new URL(qa.origin).port);
 const {observer,a,b}=native,w=qa.workspace;
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const tx=async(c,fn,role='service_role')=>{await c.query('begin;set local role '+role);try{const r=await fn(c);await c.query('commit');return r;}catch(e){await c.query('rollback');throw e;}};
 const check=async(caseId,fn)=>{try{const detail=await fn();receipt.cases.push({caseId,status:'PASS',layer:'native-publication',...detail});save();}catch(e){receipt.cases.push({caseId,status:'FAIL',layer:'native-publication',code:e.code??'ASSERTION',message:e.message});save();throw e;}};
 for(const f of ['supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql','supabase/migrations/20260817143000_data_management_storage.sql','supabase/migrations/20260818154500_data_management_prune_batch_limit.sql','supabase/normalized-legacy-cutover.sql','supabase/development/20260911_legacy_report_workspace_binding.sql','supabase/development/20260911_business_quiescence.sql','supabase/development/20260911_paused_record_legacy_transfer.sql'])await observer.query(fs.readFileSync(f,'utf8'));
 const installedPublic=()=>observer.query("select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args,p.prosecdef,p.proacl::text acl,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid").then(r=>r.rows);
 const publicBefore=await installedPublic();
 if(fs.existsSync(addon))await observer.query(fs.readFileSync(addon,'utf8'));
 if(fs.existsSync(addon)){const after=await installedPublic();assert.deepEqual(after.filter(x=>publicBefore.some(y=>y.oid===x.oid)),publicBefore,'all original public OIDs/args/ACL/security modes preserved');receipt.publicCatalogPreserved=publicBefore.length;}
 const report=(c,id,records=true)=>q(c,`select ${records?'sd_itinerary_record_report_save_manual_v1':'sd_save_manual_itinerary_report'}($1,$2,$3::uuid) r`,[w,'qa-owner',id]);
 const legacy=()=>q(observer,'select to_jsonb(t) r from ship_dynamics_app_state t where workspace_key=$1',[w]);
 const records=()=>q(observer,'select read_ship_dynamics_records_v1($1) r',[w]);
 const control=()=>q(observer,'select to_jsonb(t) r from sd_legacy_write_controls t where workspace_key=$1',[w]);
 const digest=p=>q(observer,'select sd_legacy_jsonb_sha256($1::jsonb) r',[JSON.stringify(p)]);

 const {buildCloudBlockPatch}=await qa.loadModule('/src/cloudBlockPatch.ts');
 const makePatch=async(record)=>{const base=record?(await records()).payload:(await legacy()).payload,next=structuredClone(base);next.vessels.reverse();return [w,randomUUID(),JSON.stringify(buildCloudBlockPatch(base,next)),'QA OWNER','qa-owner',JSON.stringify(await q(observer,"select ship_dynamics_actor_guard($1::jsonb,'qa-owner') r",[JSON.stringify(base)])),JSON.stringify(await q(observer,'select ship_dynamics_authorization_guard($1::jsonb) r',[JSON.stringify(base)])),'[]'];};
 const patchCall=(c,args,record=true)=>q(c,`select ${record?'apply_ship_dynamics_record_patch_v1':'apply_ship_dynamics_block_patch_v2'}($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r`,args);
 const beforeNormal=await makePatch(true);let normalPatch;
 await check('AP06-unmanaged-record-patch-positive',async()=>{normalPatch=await patchCall(b,beforeNormal);assert.equal(normalPatch.ok,true);assert.equal((await patchCall(b,await makePatch(false),false)).ok,true);});
 const memberArgs=async()=>{const c=await q(observer,"select read_ship_dynamics_task_member_v1($1,'pause-linked-task','qa-v1','qa-owner') r",[w]);assert.equal(c.ok,true);const l=await q(observer,"select claim_ship_dynamics_edit_lock($1,$2,'authority-member','QA',300) r",[w,c.section_key]);assert.equal(l.ok,true);return [w,randomUUID(),'pause-linked-task','qa-v1',JSON.stringify({status:'authority member positive',isClosed:false,mode:'leaf'}),JSON.stringify(c.expected),'qa-owner',JSON.stringify(c.actor_guard),JSON.stringify([{section_key:l.section_key,locked_by:l.locked_by,lease_version:l.lease_version}])];};
 const memberCall=(args,fn='save_ship_dynamics_task_member_v1')=>q(b,`select ${fn}($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9::jsonb) r`,args);
 let memberOld,memberResult,memberPending;
 await check('AP07-unmanaged-member-positive',async()=>{memberOld=await memberArgs();memberResult=await memberCall(memberOld);assert.equal(memberResult.ok,true);memberPending=await memberArgs();});
 const pruneArgs=async(record)=>{const rows=(await observer.query(`select revision from ${record?'ship_dynamics_record_versions':'ship_dynamics_app_revisions'} where workspace_key=$1 order by revision`,[w])).rows.map(x=>x.revision);assert.ok(rows.length>1);return [w,'qa-owner',randomUUID(),JSON.stringify(rows),JSON.stringify([rows[0]])];};
 const pruneCall=(args,record=true)=>q(b,`select ${record?'prune_ship_dynamics_record_revision_history_v1':'prune_ship_dynamics_revision_history'}($1,$2,$3::uuid,$4::jsonb,$5::jsonb) r`,args);
 const oldPrunes={};
 await check('AP08-unmanaged-prunes-scheduler-positive',async()=>{for(const mode of [true,false]){const args=await pruneArgs(mode);const result=await pruneCall(args,mode);assert.equal(result.ok,true);oldPrunes[mode]={args,result};}assert.equal((await q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'authority-old-job','2026-09-10T01:00Z') r",[w])).ok,true);assert.equal(await q(b,'select ship_dynamics_run_daily_morning_snapshots() r'),1);});

 // Separate shared writers: source comes from the RPC, never actor UUID/office.
 const wid0=await q(observer,'select id r from sd_workspaces where legacy_key=$1',[w]);
 const authActor=await q(observer,"select user_id r from sd_memberships where workspace_id=$1 and role='owner' and is_active",[wid0]);
 await observer.query('insert into sd_login_options(workspace_id,user_id,is_active,must_change_password) values($1,$2,true,false)',[wid0,authActor]);
 await observer.query('insert into sd_itinerary_rollout(workspace_id,main_enabled,ship_portal_enabled) values($1,true,true)',[wid0]);
 for(const c of [observer,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[authActor]);
 await observer.query('delete from sd_itinerary_leases where workspace_id=$1',[wid0]);
 const formalRoutes=[
  {id:'record',fn:'sd_itinerary_record_save_v1',claim:"sd_itinerary_record_claim_lease_v1($1,'qa-v1','authority-tab','QA',300,'qa-owner')",status:"sd_itinerary_record_operation_status_v1($1,$2::uuid,'qa-owner')"},
  {id:'main',fn:'sd_itinerary_main_save',claim:"sd_itinerary_main_claim_lease($1,'qa-v1','authority-tab','QA',300,'qa-owner')",status:"sd_itinerary_main_operation_status($1,$2::uuid,'qa-owner')"},
  {id:'public',fn:'sd_itinerary_save_public',claim:"sd_itinerary_claim_public_lease($1,'qa-v1','authority-public','authority-tab',300)",status:"sd_itinerary_operation_status_public($1,$2::uuid,'authority-public')"},
  {id:'office-neutral',fn:'sd_itinerary_save_office',claim:"sd_itinerary_claim_office_lease($1,'qa-v1','authority-tab','QA',300)",status:'sd_itinerary_operation_status_office($1,$2::uuid)'}];
 const formalArgs=async route=>{const l=await q(observer,`select ${route.claim} r`,[w]);assert.equal(l.ok,true);const d=(await observer.query("select * from sd_itinerary_documents where workspace_id=$1 and vessel_id='qa-v1'",[wid0])).rows[0];const a=[w,'qa-v1',d.revision,randomUUID(),JSON.stringify(d.rows_payload),l.leaseId];return route.id==='public'?[...a,'authority-public','authority-tab',l.fencingToken,JSON.stringify(d.alternative_plans_payload)]:route.id==='office-neutral'?[...a,'authority-tab',l.fencingToken,'QA']:[...a,'authority-tab',l.fencingToken,'QA','qa-owner',JSON.stringify(d.alternative_plans_payload)];};
 const formalCall=(route,args)=>q(b,`select ${route.fn}(${args.map((_,i)=>`$${i+1}${i===2?'::bigint':i===3||i===5?'::uuid':i===4||i===10||(route.id==='public'&&i===9)?'::jsonb':''}`).join(',')}) r`,args);
 for(const route of formalRoutes)await check('AP15-unmanaged-formal-'+route.id,async()=>{route.old=await formalArgs(route);route.result=await formalCall(route,route.old);assert.equal(route.result.ok,true);});
 const deleteRoutes=[{id:'record-ids',fn:'sd_itinerary_record_report_delete_ids_v1',record:true,ids:true},{id:'record-dates',fn:'sd_itinerary_record_report_delete_dates_v1',record:true},{id:'legacy-ids',fn:'delete_sd_itinerary_daily_report_records',ids:true},{id:'legacy-dates',fn:'delete_sd_itinerary_daily_reports'}];
 const delCall=(route,args)=>q(b,`select ${route.fn}($1,$2,$3::uuid,$4,$5::jsonb) r`,args);
 let dateCounter=1;
 const delArgs=async route=>{const date='2026-07-'+String(dateCounter++).padStart(2,'0');await q(observer,'select sd_generate_daily_itinerary_report($1,$2::date,($2::date)::timestamptz) r',[wid0,date]);const row=(await observer.query('select report_id::text,business_date::text from sd_itinerary_daily_reports where workspace_id=$1 and business_date=$2',[wid0,date])).rows[0];return [w,'qa-owner',randomUUID(),await q(observer,'select sd_itinerary_daily_report_set_token($1) r',[wid0]),JSON.stringify([route.ids?row.report_id:row.business_date])];};
 for(const route of deleteRoutes)await check('AP16-unmanaged-delete-'+route.id,async()=>{route.old=await delArgs(route);route.result=await delCall(route,route.old);assert.equal(route.result.ok,true);assert.ok(route.result.deletedCount>0);});
 const pendingPatch=await makePatch(true);
 const oldId=randomUUID();let old;
 await check('AP01-legitimate-record-report-terminal',async()=>{old=await report(observer,oldId);assert.equal(old.ok,true);assert.equal(old.created,true);assert.ok(old.report.rowCount>0);});
 const l0=await legacy(),lh=await digest(l0.payload),r0=await records(),rh=await digest(r0.payload);
 await tx(a,c=>q(c,'select freeze_ship_dynamics_legacy_writes($1,$2,$3,$4) r',[w,l0.revision,lh,`freeze:${w}:${l0.revision}:${lh}`]));
 const wid=await q(observer,'select id r from sd_workspaces where legacy_key=$1',[w]),transition=randomUUID();
 const pause=await tx(a,c=>q(c,'select pause_ship_dynamics_business_v1($1,$2) r',[w,transition]));
 const stageId=randomUUID(),frozen=await control();
 const stage=await tx(a,c=>q(c,'select stage_ship_dynamics_paused_records_to_legacy_v1($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) r',[w,wid,transition,JSON.stringify(pause.watermark),r0.revision,rh,l0.revision,lh,frozen.frozen_at,stageId]));
 const pubId=randomUUID(),pubRequest=[w,wid,transition,stageId,JSON.stringify(stage),pubId];
 const publish=c=>q(c,'select publish_ship_dynamics_source_authority_v1($1,$2,$3,$4,$5::jsonb,$6) r',pubRequest);

 const mark=()=>q(observer,'select ship_dynamics_quiescence_private.watermark_v1($1,$2) r',[w,wid]);
 const authorityRows=()=>q(observer,"select jsonb_build_object('current',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from ship_dynamics_authority_private.current_v1 c),'receipts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from ship_dynamics_authority_private.receipts_v1 c)) r");
 const wrongs=async(fn,args)=>{for(const [i,x] of [[0,'wrong-workspace'],[1,randomUUID()],[2,randomUUID()],[3,randomUUID()],[4,'{}'],[5,null]]){const a=[...args];a[i]=x;await assert.rejects(()=>tx(b,c=>q(c,fn,a)),e=>['22023','55000'].includes(e.code));}for(const field of ['sourceSha256','targetSha256']){const a=[...args];a[4]=JSON.stringify({...JSON.parse(args[4]),[field]:'0'.repeat(64)});await assert.rejects(()=>tx(b,c=>q(c,fn,a)),e=>e.code==='55000');}};
 const lateFault=async(action,fn)=>{const before={mark:await mark(),control:await control(),authority:await authorityRows()};await observer.query(`create sequence qa_authority_fault_entered;create function public.qa_authority_fault() returns trigger language plpgsql as $$begin if new.action='${action}' then perform nextval('qa_authority_fault_entered');raise exception 'qa-authority-late-fault';end if;return new;end$$;create trigger qa_authority_fault after insert on ship_dynamics_authority_private.receipts_v1 for each row execute function public.qa_authority_fault()`);try{await assert.rejects(()=>tx(b,fn),e=>e.message==='qa-authority-late-fault');assert.equal(await q(observer,'select is_called r from qa_authority_fault_entered'),true);assert.deepEqual(await mark(),before.mark);assert.deepEqual(await control(),before.control);assert.deepEqual(await authorityRows(),before.authority);}finally{await observer.query('drop trigger qa_authority_fault on ship_dynamics_authority_private.receipts_v1;drop function public.qa_authority_fault();drop sequence qa_authority_fault_entered');}};
 const pubSql='select publish_ship_dynamics_source_authority_v1($1,$2,$3,$4,$5::jsonb,$6) r';


 await check('AP26-control-fresh-transaction-rejects-prior-locks',async()=>{const before=await authorityRows();for(const sql of ["select pg_advisory_xact_lock(72619,1)","select 1 from ship_dynamics_app_state for update"]){await a.query('begin');await a.query(sql);await a.query('set local role service_role');await assert.rejects(()=>publish(a),e=>e.code==='25001');await a.query('rollback');}for(const sql of ["update sd_legacy_write_controls set payload_sha256=repeat('0',64) where workspace_key=$1","update sd_legacy_write_controls set frozen_at='2000-01-01' where workspace_key=$1","update ship_dynamics_quiescence_private.stages_v1 set staged_watermark='{}' where workspace_key=$1"]){await observer.query('begin');await observer.query(sql,[w]);await observer.query('set local role service_role');await assert.rejects(()=>publish(observer),e=>e.code==='25001');await observer.query('rollback');}assert.deepEqual(await authorityRows(),before);});
 await check('AP19-publication-ungated-control-holder-try-lock',async()=>{const before=await authorityRows();await b.query('begin');await b.query('select 1 from sd_legacy_write_controls where workspace_key=$1 for update',[w]);try{await assert.rejects(()=>tx(a,publish),e=>e.code==='40001');assert.deepEqual(await authorityRows(),before);}finally{await b.query('rollback');}});
 await check('AP09-publication-input-role-isolation-and-late-fault',async()=>{const before=await mark();await wrongs(pubSql,pubRequest);for(const role of ['anon','authenticated'])await assert.rejects(()=>tx(b,async c=>{await c.query("select set_config('request.jwt.claim.role','service_role',true)");return publish(c);},role),e=>e.code==='42501');await assert.rejects(()=>publish(observer),e=>e.code==='42501');for(const level of ['repeatable read','serializable']){await b.query('begin isolation level '+level+';set local role service_role');await assert.rejects(()=>publish(b),e=>e.code==='25001');await b.query('rollback');}assert.deepEqual(await mark(),before);await lateFault('publish',publish);});

 const waitFor=async(waiter,blocker)=>{let row;const end=Date.now()+4000;while(Date.now()<end){row=(await observer.query('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[waiter.processID])).rows[0];if(row.wait_event_type==='Lock'&&row.blockers.includes(blocker.processID))return row;await new Promise(r=>setTimeout(r,10));}assert.fail('missing actual backend lock barrier');};
 await check('AP20-real-terminal-writer-held-across-publication',async()=>{await b.query('begin');assert.deepEqual(await report(b,oldId),{...old,created:false});const task=tx(a,publish);const barrier=await waitFor(a,b);await b.query('commit');const result=await task;assert.equal(result.state,'published-paused');return {barrier};});
 let published;
 await check('AP02-publish-while-paused',async()=>{published=await tx(a,publish);assert.equal(published.state,'published-paused');assert.equal(published.source,'legacy');assert.equal((await control()).writes_frozen,true);assert.deepEqual((await tx(a,c=>q(c,'select read_ship_dynamics_business_pause_v1($1,$2) r',[w,transition]))).watermark,pause.watermark);});
 const paused=fn=>assert.rejects(fn,e=>e.code==='55000'&&e.message==='business-writes-paused');
 await check('AP03-paused-both-routes-and-exact-terminal',async()=>{await paused(()=>report(b,randomUUID()));await paused(()=>report(b,randomUUID(),false));assert.deepEqual(await report(b,oldId),{...old,created:false});});
 const resumeId=randomUUID(),resumeArgs=[w,wid,transition,pubId,JSON.stringify(published),resumeId];
 const resume=c=>q(c,'select resume_ship_dynamics_legacy_authority_v1($1,$2,$3,$4,$5::jsonb,$6) r',resumeArgs);

 await check('AP10-resume-input-binding-and-late-fault',async()=>{await wrongs('select resume_ship_dynamics_legacy_authority_v1($1,$2,$3,$4,$5::jsonb,$6) r',resumeArgs);await lateFault('resume',resume);});


 await check('AP29-resume-final-current-state-tamper-atomicity',async()=>{const before={mark:await mark(),control:await control(),authority:await authorityRows()};await observer.query("create sequence qa_authority_tamper_entered;create function public.qa_authority_tamper() returns trigger language plpgsql as $$begin if new.action='resume' then perform nextval('qa_authority_tamper_entered');update ship_dynamics_authority_private.current_v1 set epoch=epoch+1 where publication_id=(new.request->>'publicationId')::uuid;end if;return new;end$$;create trigger qa_authority_tamper after insert on ship_dynamics_authority_private.receipts_v1 for each row execute function public.qa_authority_tamper()");try{await assert.rejects(()=>tx(b,resume),e=>e.message==='source-authority-final-readback-mismatch');assert.equal(await q(observer,'select is_called r from qa_authority_tamper_entered'),true);assert.deepEqual(await mark(),before.mark);assert.deepEqual(await control(),before.control);assert.deepEqual(await authorityRows(),before.authority);}finally{await observer.query('drop trigger qa_authority_tamper on ship_dynamics_authority_private.receipts_v1;drop function public.qa_authority_tamper();drop sequence qa_authority_tamper_entered');}});

 await check('AP30-resume-live-business-final-proof',async()=>{const before={mark:await mark(),control:await control(),authority:await authorityRows()};await observer.query("create sequence qa_authority_proof_entered;create function public.qa_authority_proof() returns trigger language plpgsql as $$begin if new.action='resume' then perform nextval('qa_authority_proof_entered');update ship_dynamics_app_state set updated_by='late invalid target' where workspace_key=new.request->>'workspace';end if;return new;end$$;create trigger qa_authority_proof after insert on ship_dynamics_authority_private.receipts_v1 for each row execute function public.qa_authority_proof()");try{await assert.rejects(()=>tx(b,resume),e=>e.message==='source-authority-final-readback-mismatch');assert.equal(await q(observer,'select is_called r from qa_authority_proof_entered'),true);assert.deepEqual(await mark(),before.mark);assert.deepEqual(await control(),before.control);assert.deepEqual(await authorityRows(),before.authority);}finally{await observer.query('drop trigger qa_authority_proof on ship_dynamics_authority_private.receipts_v1;drop function public.qa_authority_proof();drop sequence qa_authority_proof_entered');}});
 await check('AP21-resume-ungated-target-locks-nowait',async()=>{for(const sql of ['select 1 from ship_dynamics_app_state where workspace_key=$1 for update','select 1 from sd_legacy_write_controls where workspace_key=$1 for update','select pg_advisory_xact_lock(hashtextextended($1,731921))']){await b.query('begin');await b.query(sql,[w]);try{await assert.rejects(()=>tx(a,resume),e=>e.code==='40001');}finally{await b.query('rollback');}}});
 await check('AP22-held-resume-record-waiter-fresh-retired-state',async()=>{await a.query('begin;set local role service_role');const result=await resume(a);assert.equal(result.state,'resumed');const task=patchCall(b,pendingPatch).then(value=>({value}),e=>({code:e.code,message:e.message}));const barrier=await waitFor(b,a);await a.query('commit');assert.equal((await task).message,'source-authority-retired');return {barrier};});
 await check('AP04-atomic-target-resume',async()=>{const result=await tx(a,resume);assert.equal(result.state,'resumed');await a.end();assert.equal((await control()).writes_frozen,false);});
 await check('AP05-target-report-and-retired-before-ledger',async()=>{const target=await report(b,randomUUID(),false);assert.equal(target.ok,true);const id=randomUUID();await assert.rejects(()=>report(b,id),e=>e.code==='55000'&&e.message==='source-authority-retired');assert.equal(await q(observer,'select count(*)::integer r from sd_itinerary_daily_report_operations where operation_id=$1',[id]),0);assert.deepEqual(await report(b,oldId),{...old,created:false});});

 const operator=await native.connect('authority_replay');
 const retired=fn=>assert.rejects(fn,e=>e.code==='55000'&&e.message==='source-authority-retired');
 await check('AP11-target-ordinary-old-client-and-retired-record-member',async()=>{assert.equal((await patchCall(b,await makePatch(false),false)).ok,true);await retired(()=>patchCall(b,pendingPatch));await retired(()=>memberCall(memberPending));assert.deepEqual(await memberCall(memberOld,'get_ship_dynamics_task_member_receipt_v1'),{...memberResult,replayed:true});const g=JSON.parse(memberPending[8])[0];assert.equal((await q(b,'select renew_ship_dynamics_task_member_lock_v1($1,$2,$3,$4,300) r',[w,g.section_key,g.locked_by,g.lease_version])).ok,true);assert.equal(await q(b,'select release_ship_dynamics_task_member_lock_v1($1,$2,$3,$4) r',[w,g.section_key,g.locked_by,g.lease_version]),true);});
 await check('AP12-target-prune-schedulers-and-retired-new-work',async()=>{for(const mode of [true,false])assert.deepEqual(await pruneCall(oldPrunes[mode].args,mode),oldPrunes[mode].result);await retired(()=>pruneCall([w,'qa-owner',randomUUID(),'[1]','[1]']));assert.equal((await pruneCall(await pruneArgs(false),false)).ok,true);await retired(()=>q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'authority-new-job','2026-09-10T01:00Z') r",[w]));assert.equal((await q(b,"select run_ship_dynamics_record_daily_morning_v1($1,'authority-old-job','2026-09-10T01:00Z') r",[w])).replayed,true);assert.equal(await q(b,'select ship_dynamics_run_daily_morning_snapshots() r'),1);assert.ok(await q(b,"select sd_generate_daily_itinerary_report($1,'2026-08-22','2026-08-22T01:00Z') r",[wid]));});

 for(const route of formalRoutes)await check('AP17-managed-formal-'+route.id,async()=>{assert.deepEqual(await formalCall(route,route.old),{...route.result,replayed:true});assert.deepEqual(await q(b,`select ${route.status} r`,[w,route.old[3]]),route.result);const wrong=[...route.old];wrong[2]=Number(wrong[2])+1;await assert.rejects(()=>formalCall(route,wrong),e=>e.message==='operation-mismatch');const args=await formalArgs(route);if(route.id==='record'){const before=await mark();await retired(()=>formalCall(route,args));assert.deepEqual(await mark(),before);await q(observer,"select sd_itinerary_record_release_lease_v1($1,'qa-v1',$2::uuid,'authority-tab',$3::bigint,'qa-owner') r",[w,args[5],args[7]]);}else assert.equal((await formalCall(route,args)).ok,true);});
 for(const route of deleteRoutes)await check('AP18-managed-delete-'+route.id,async()=>{assert.deepEqual(await delCall(route,route.old),route.result);const wrong=[...route.old];wrong[3]='0'.repeat(32);assert.equal((await delCall(route,wrong)).error,'IDEMPOTENCY_MISMATCH');const args=await delArgs(route);if(route.record){const before=await mark();await retired(()=>delCall(route,args));assert.deepEqual(await mark(),before);assert.equal(await q(observer,'select count(*)::integer r from sd_itinerary_daily_report_operations where operation_id=$1',[args[2]]),0);}else{const result=await delCall(route,args);assert.equal(result.ok,true);assert.ok(result.deletedCount>0);}});

 await check('AP27-legacy-anon-RPC-compatibility-and-top-formal-job',async()=>{const r=await tx(operator,c=>report(c,randomUUID(),false),'anon');assert.equal(r.ok,true);const route=formalRoutes.find(x=>x.id==='main'),args=await formalArgs(route);const sql=`select ${route.fn}($1,$2,$3::bigint,$4::uuid,$5::jsonb,$6::uuid,$7,$8::bigint,$9,$10,$11::jsonb) r`;assert.equal((await tx(operator,c=>q(c,sql,args),'anon')).ok,true);const job=await q(b,'select ship_dynamics_run_daily_itinerary_reports() r');assert.equal(job.ok,true);assert.equal(job.createdCount,1);assert.equal(job.failedCount,0);const again=await q(b,'select ship_dynamics_run_daily_itinerary_reports() r');assert.equal(again.createdCount,0);assert.equal(again.existingCount,1);});
 await check('AP28-manual-original-mismatch-and-ordinary-recovery',async()=>{const before=await mark();assert.equal((await report(b,deleteRoutes[0].old[2])).error,'OPERATION_ID_REUSED');assert.equal((await q(b,'select sd_save_manual_itinerary_report($1,$2,$3::uuid) r',[w,'wrong-actor',oldId])).error,'OPERATION_ID_REUSED');const args=[...beforeNormal];const get=c=>q(c,'select get_ship_dynamics_record_receipt_v1($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) r',args);assert.deepEqual(await get(b),{...normalPatch,replayed:true});args[1]=randomUUID();assert.equal((await get(b)).status,'missing');assert.deepEqual(await mark(),before);});
 await check('AP13-control-replay-after-target-progress-readonly',async()=>{const before={mark:await mark(),control:await control(),authority:await authorityRows()};assert.deepEqual(await tx(operator,publish),published);assert.equal((await tx(operator,resume)).resumeId,resumeId);assert.deepEqual(await mark(),before.mark);assert.deepEqual(await control(),before.control);assert.deepEqual(await authorityRows(),before.authority);await observer.query('create role qa_authority_other nologin;grant service_role to qa_authority_other');await operator.query('set session authorization qa_authority_other');try{await assert.rejects(()=>tx(operator,publish),e=>e.message==='source-authority-replay-mismatch');await assert.rejects(()=>tx(operator,resume),e=>e.message==='source-authority-replay-mismatch');}finally{await operator.query('reset session authorization');}});
 await check('AP14-reapply-lease-source-separation',async()=>{await observer.query(fs.readFileSync(addon,'utf8'));await observer.query(fs.readFileSync('supabase/development/20260911_business_quiescence.sql','utf8'));await observer.query(fs.readFileSync('supabase/development/20260911_paused_record_legacy_transfer.sql','utf8'));await observer.query(fs.readFileSync(addon,'utf8'));const args=await memberArgs();const g=JSON.parse(args[8])[0];assert.equal((await q(b,'select renew_ship_dynamics_task_member_lock_v1($1,$2,$3,$4,300) r',[w,g.section_key,g.locked_by,g.lease_version])).ok,true);await retired(()=>memberCall(args));});


 await check('AP25-retired-record-physical-backstop',async()=>{const before=await mark();await retired(()=>b.query("update ship_dynamics_records set value=value where workspace_key=$1 and collection='users' and entity_id='qa-owner'",[w]));assert.deepEqual(await mark(),before);});
 await check('AP23-direct-legacy-compatibility-and-private-source-denial',async()=>{await b.query("update ship_dynamics_app_state set updated_by='authority legacy fallback' where workspace_key=$1",[w]);assert.equal((await legacy()).updated_by,'authority legacy fallback');const before=await mark();await b.query('begin');await b.query("select set_config('app.source','legacy',true),set_config('request.jwt.claim.source','legacy',true)");await retired(()=>report(b,randomUUID()));await b.query('rollback');assert.deepEqual(await mark(),before);for(const role of ['anon','authenticated','service_role'])await assert.rejects(()=>tx(operator,c=>c.query("select ship_dynamics_authority_private.assert_source_v1($1,'neutral-formal')",[w]),role),e=>e.code==='42501');});
 await check('AP24-later-pause-stale-source-stage-and-control-replay',async()=>{const l=await legacy(),h=await digest(l.payload);await tx(operator,c=>q(c,'select freeze_ship_dynamics_legacy_writes($1,$2,$3,$4) r',[w,l.revision,h,`freeze:${w}:${l.revision}:${h}`]));const next=randomUUID(),pa=await tx(operator,c=>q(c,'select pause_ship_dynamics_business_v1($1,$2) r',[w,next]));const before=await mark(),f=await control(),rr=await records(),rhash=await digest(rr.payload);await retired(()=>tx(operator,c=>q(c,'select stage_ship_dynamics_paused_records_to_legacy_v1($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) r',[w,wid,next,JSON.stringify(pa.watermark),rr.revision,rhash,l.revision,h,f.frozen_at,randomUUID()])));assert.deepEqual(await tx(operator,publish),published);assert.equal((await tx(operator,resume)).resumeId,resumeId);assert.deepEqual(await mark(),before);assert.deepEqual(await control(),f);assert.equal((await tx(operator,c=>q(c,'select read_ship_dynamics_source_authority_v1($1) r',[w]))).admitted,false);await paused(()=>report(b,randomUUID(),false));assert.deepEqual(await report(b,oldId),{...old,created:false});});
 receipt.signatures=(await observer.query("select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,p.prosecdef security_definer,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ship_dynamics_authority_private' or p.proname in ('publish_ship_dynamics_source_authority_v1','resume_ship_dynamics_legacy_authority_v1','read_ship_dynamics_source_authority_v1') order by 1,2,3")).rows;
 receipt.status='PASS';
}catch(e){failure=true;receipt.status='FAIL';receipt.error={code:e.code??'ASSERTION',message:e.message,classification:e.code==='42883'?'MISSING_CAPABILITY_ONLY':'EXECUTION_FAILURE_REQUIRES_TRIAGE',frames:String(e.stack).split('\n').filter(x=>/^\s+at /.test(x))};}
finally{try{if(qa){await qa.close();receipt.fixtureClosed=true;}if(native)await native.close();}catch(e){failure=true;receipt.status='CLEANUP_FAIL';receipt.cleanupCode=e.code??'ASSERTION';}receipt.inputsUnchanged=files.every(f=>sha(fs.readFileSync(f))===receipt.inputs[f]);if(!receipt.inputsUnchanged){failure=true;receipt.status='SOURCE_DRIFT';}save();}
console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases,error:receipt.error,inputsUnchanged:receipt.inputsUnchanged,cleanup:{stopped:receipt.stopped,portClosed:receipt.portClosed,ownedDataRemoved:receipt.ownedDataRemoved}}));if(failure)process.exitCode=1;
