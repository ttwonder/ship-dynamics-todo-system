// Local native PostgreSQL + synthetic business data. No hosted connection input.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {pathToFileURL} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {seedItineraryFixture} from './record-itinerary-local-fixture.mjs';
import {seedQuiescenceLinkedGraph} from './business-quiescence-remainder-qa.mjs';
const predecessor=process.env.QA_PREDECESSOR_MODULE;
const watermarkHotfix=process.argv.includes('--watermark-hotfix');
assert.ok(predecessor&&path.isAbsolute(predecessor),'Explicit private predecessor module required');
const root=path.dirname(predecessor),run=fs.mkdtempSync(path.join(root,'release-native-'));
const receipt={kind:'production-additive-first-install-native',status:'RUNNING',run,productionContacted:false,cases:[]};
const controlManifest=JSON.parse(fs.readFileSync('supabase/release/control-release-manifest.json','utf8'));
const files=['scripts/build-production-release.py','scripts/build-production-control.py','scripts/verify-production-release-native.mjs','scripts/record-storage-native-qa.mjs','scripts/record-itinerary-local-fixture.mjs','scripts/business-quiescence-remainder-qa.mjs','supabase/release/05_install_record_storage.sql','supabase/release/06_verify_record_storage.sql','supabase/release/record-release-api.json','supabase/release/record-release-manifest.json','supabase/release/control-release-manifest.json',...Object.keys(controlManifest.outputs).map(f=>'supabase/release/'+f)];
const hash=b=>createHash('sha256').update(b).digest('hex');
receipt.inputs=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(f))]));
if(watermarkHotfix){receipt.mode='installed-watermark-hotfix';for(const f of ['scripts/build-watermark-resource-repair.py','scripts/watermark-hotfix-native-qa.mjs','supabase/release/08a_fix_watermark_resource.sql','supabase/release/08b_verify_watermark_resource.sql','supabase/release/watermark-repair-manifest.json'])if(fs.existsSync(f)){files.push(f);receipt.inputs[f]=hash(fs.readFileSync(f));}}
receipt.predecessorInputs=Object.fromEntries(['predecessor.mjs','private-schema-input.json','trusted-provenance.json'].map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
const check=async(id,fn)=>{try{await fn();receipt.cases.push({id,status:'PASS'});save();}catch(e){receipt.cases.push({id,status:'FAIL',code:e.code??'ASSERT',message:e.message});save();throw e;}};
let native,vite;
try{
 native=await createNativeRecordQa(run,receipt);const {observer,a,b}=native;
 const q=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.r;
 const tx=async(c,fn,role='service_role')=>{await c.query('begin;set local role '+role);try{const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}};
 const w='ship-dynamics-main';
 const step=async(file,field='control_receipt')=>{const raw=await a.query(fs.readFileSync('supabase/release/'+file,'utf8'));const result=raw.flatMap(r=>r.rows??[]).find(r=>r[field])?.[field];assert.ok(result,'manual step must return actual SQL result: '+file);return result;};
 await check('NI01-production-predecessor-records-absent',async()=>{receipt.predecessor=await(await import(pathToFileURL(predecessor))).installPredecessor(native.adapter);assert.equal(receipt.predecessor.status,'PASS');assert.equal(await q(observer,"select to_regclass('public.ship_dynamics_record_workspaces') r"),null);});
 vite=await createServer({cacheDir:path.join(run,'vite-cache'),server:{middlewareMode:true,hmr:false,watch:null},logLevel:'silent'});
 const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
 const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');
 const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
 let initial=createInitialData();const at='2026-09-01T03:00:00.000Z',secret=hash(randomUUID());
 initial.revision=31;initial.updatedAt=at;initial.settings.sitePasswordHash=secret;
 initial.users=[{id:'qa-owner',name:'QA OWNER',username:'qa-owner',department:'督導',role:'owner',passwordHash:secret,isActive:true,managedVesselIds:[],createdAt:at,updatedAt:at}];
 const template=structuredClone(initial.vessels[0]);
 initial.vessels=['qa-v1','qa-v2'].map((id,i)=>({...structuredClone(template),id,name:'QA VESSEL '+i,isActive:true,assignedUserIds:[],delegateManagers:[]}));
 for(const key of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])initial[key]=[];
 seedQuiescenceLinkedGraph(initial);initial=normalizeAppData(initial);assert.ok(initial);
 await observer.query('insert into ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values($1,$2::jsonb,31,$3)',[w,JSON.stringify(initial),'QA OWNER']);
 await seedItineraryFixture(native.adapter,vite,w,initial.vessels);
 // A real predecessor can retain both active and expired locks during an upgrade.
 // Empty-lock fixtures cannot exercise the volatile-default table rewrite.
 await observer.query(`insert into ship_dynamics_edit_locks(workspace_key,section_key,locked_by,locked_by_name,locked_at,expires_at)
 select $1,'qa-release-preserve-'||i,'qa-session-'||i,'QA LOCK '||i,now()-interval '5 minutes',
 case when i=3 then now()-interval '1 minute' else now()+interval '1 hour' end from generate_series(1,3) i`,[w]);
 const wid=await q(observer,'select id r from sd_workspaces where legacy_key=$1',[w]);
 const tables=(await observer.query("select tablename from pg_tables where schemaname='public' and tablename ~ '^(ship_dynamics_|sd_)' order by 1")).rows.map(t=>t.tablename);
 const ledger=async(names=tables)=>{const out={};for(const name of names){assert.match(name,/^[a-z0-9_]+$/);const body=name==='ship_dynamics_edit_locks'?"(to_jsonb(t)-'lease_version')":'to_jsonb(t)';out[name]=await q(observer,`select coalesce(jsonb_agg(${body} order by ${body}::text),'[]') r from ${name} t`);}return out;};
 const before=await ledger();const install=fs.readFileSync('supabase/release/05_install_record_storage.sql','utf8');
 await check('NI02A-late-install-error-rolls-back-all-addons',async()=>{const injected=install.replace('\nCOMMIT;\n',()=>"\nDO $$ BEGIN RAISE EXCEPTION 'qa-release-late-fault'; END $$;\nCOMMIT;\n");assert.notEqual(injected,install);await assert.rejects(()=>observer.query(injected),e=>e.message==='qa-release-late-fault');await observer.query('rollback');assert.equal(await q(observer,"select to_regclass('public.ship_dynamics_record_workspaces') r"),null);assert.equal(await q(observer,"select to_regnamespace('ship_dynamics_authority_private')::text r"),null);assert.deepEqual(await ledger(),before);});
 await check('NI02B-actual-old-lock-field-change-is-rejected',async()=>{const injected=install.replace('DO $release_unchanged$',()=>"UPDATE public.ship_dynamics_edit_locks SET locked_by='qa-tampered' WHERE section_key='qa-release-preserve-1';\nDO $release_unchanged$");assert.notEqual(injected,install);await assert.rejects(()=>observer.query(injected),e=>e.message==='release-existing-business-rows-changed: ship_dynamics_edit_locks');await observer.query('rollback');assert.deepEqual(await ledger(),before);});
 await check('NI02C-invalid-new-lock-fence-is-rejected',async()=>{const injected=install.replace('DO $release_unchanged$',()=>"UPDATE public.ship_dynamics_edit_locks SET lease_version=0 WHERE section_key='qa-release-preserve-1';\nDO $release_unchanged$");assert.notEqual(injected,install);await assert.rejects(()=>observer.query(injected),e=>e.message==='release-invalid-added-lock-fences');await observer.query('rollback');assert.deepEqual(await ledger(),before);});
 await check('NI02-atomic-installer-preserves-all-58-legacy-tables',async()=>{await observer.query(install);assert.deepEqual(await ledger(),before);assert.equal(await q(observer,'select count(*)::int r from ship_dynamics_record_workspaces'),0);const fences=await q(observer,'select jsonb_build_object(\'n\',count(*),\'unique\',count(distinct lease_version),\'positive\',bool_and(lease_version>0)) r from ship_dynamics_edit_locks');assert.deepEqual(fences,{n:3,unique:3,positive:true});});
 await check('NI03-independent-readback-and-rerun-refusal',async()=>{await observer.query("alter function public.read_ship_dynamics_records_v1(text) set qa.private_canary='qa-readback-canary-omit'");const rs=await a.query(fs.readFileSync('supabase/release/06_verify_record_storage.sql','utf8'));const out=rs.flatMap(r=>r.rows??[]).find(r=>r.install_readback)?.install_readback;assert.ok(out);assert.equal(JSON.stringify(out).includes('qa-readback-canary-omit'),false,'readback excludes arbitrary function settings');await observer.query('alter function public.read_ship_dynamics_records_v1(text) reset qa.private_canary');assert.equal(out.api_count,52);assert.deepEqual(out.api_missing_or_invalid,[]);assert.equal(out.record_tables_private,true);receipt.installReadback=out;await assert.rejects(()=>observer.query(install),e=>e.message==='release-records-already-present-use-readback');await observer.query('rollback');assert.deepEqual(await ledger(),before);});
 if(watermarkHotfix)await(await import('./watermark-hotfix-native-qa.mjs')).verifyWatermarkHotfix({native,check,receipt,workspace:w});
 const legacy=()=>q(observer,'select to_jsonb(t) r from ship_dynamics_app_state t where workspace_key=$1',[w]);
 const records=()=>q(observer,'select read_ship_dynamics_records_v1($1) r',[w]);
 const digest=p=>q(observer,'select sd_legacy_jsonb_sha256($1::jsonb) r',[JSON.stringify(p)]);
 const content=p=>{const x=structuredClone(p);delete x.revision;delete x.updatedAt;return x;};
 const freeze=async()=>{const f=await q(observer,'select to_jsonb(t) r from sd_legacy_write_controls t where workspace_key=$1',[w]);if(!f?.writes_frozen)await step('07_freeze_latest_legacy.sql');return q(observer,'select to_jsonb(t) r from sd_legacy_write_controls t where workspace_key=$1',[w]);};
 const pause=async()=>{const result=await step('08_pause_business.sql');const id=await q(observer,'select transition_id r from ship_dynamics_quiescence_private.workspaces where workspace_key=$1',[w]);return {id,result};};
 const forwardSql='select stage_ship_dynamics_paused_legacy_to_records_v1($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) r';
 const publishResume=async(p,stage,target)=>{const pub=await step(target==='records-v1'?'10_publish_records_paused.sql':'14_publish_legacy_paused.sql');const state=await step('12_control_readback.sql','control_readback');assert.equal(state.authority.phase,'published-paused');assert.equal(state.browser.admitted,false);const resumed=await step('11_resume_published_source.sql');assert.equal(resumed.state,'resumed');return pub;};
 let frozen,paused,staged;
 await check('NI04-first-ever-forward-from-latest-not-initial-snapshot',async()=>{
  const base=(await legacy()).payload,next=structuredClone(base);next.vessels.reverse();
  const result=await tx(b,c=>q(c,"select apply_ship_dynamics_block_patch_v2($1,$2,$3::jsonb,'QA OWNER','qa-owner',ship_dynamics_actor_guard($4::jsonb,'qa-owner'),ship_dynamics_authorization_guard($4::jsonb),'[]') r",[w,randomUUID(),JSON.stringify(buildCloudBlockPatch(base,next)),JSON.stringify(base)]),'anon');assert.equal(result.ok,true);
  const l=await legacy();assert.ok(l.revision>31);frozen=await freeze();paused=await pause();
  const args=[w,wid,paused.id,JSON.stringify(paused.result.watermark),l.revision,await digest(l.payload),null,null,frozen.frozen_at,randomUUID()];
  staged={args,result:await step('09_stage_first_records.sql')};args[9]=await q(observer,'select request_id r from ship_dynamics_authority_private.forward_stages_v1 where workspace_key=$1 and transition_id=$2',[w,paused.id]);assert.equal(staged.result.state,'staged-paused');assert.deepEqual(content((await records()).payload),content(l.payload));assert.notDeepEqual(content(l.payload),content(initial));
  assert.deepEqual(await tx(a,c=>q(c,forwardSql,args)),staged.result);receipt.firstStage={sourceRevision:l.revision,targetWasAbsent:true,targetRevision:(await records()).revision};
 });
 await check('NI05-publish-resume-and-anon-read',async()=>{const pub=await publishResume(paused,staged,'records-v1');assert.equal(pub.epoch,1);for(const role of ['anon','authenticated'])await tx(b,async c=>{const r=await q(c,'select read_ship_dynamics_records_v1($1) r',[w]);assert.equal(r.status,'snapshot');const auth=await q(c,'select read_ship_dynamics_browser_authority_v1($1) r',[w]);assert.equal(auth.source,'records-v1');assert.equal(auth.admitted,true);},role);});
 await check('NI06-no-browser-control-or-direct-table-privilege',async()=>{for(const role of ['anon','authenticated']){
  await assert.rejects(()=>tx(b,c=>q(c,'select count(*) r from ship_dynamics_records'),role),e=>e.code==='42501');
  await assert.rejects(()=>tx(b,async c=>{await c.query("select set_config('request.jwt.claim.role','service_role',true)");return q(c,forwardSql,staged.args);},role),e=>e.code==='42501');
 }});
 let afterSave;
 await check('NI07-real-anon-member-save-and-receipt',async()=>{
  const c=await tx(b,c=>q(c,"select read_ship_dynamics_task_member_v1($1,'pause-linked-task','qa-v1','qa-owner') r",[w]),'anon');assert.equal(c.ok,true);
  const lease=await tx(b,cx=>q(cx,"select claim_ship_dynamics_edit_lock($1,$2,'release-member','QA',300) r",[w,c.section_key]),'anon');assert.equal(lease.ok,true);
  const args=[w,randomUUID(),'pause-linked-task','qa-v1',JSON.stringify({status:'saved after first cutover',isClosed:false,mode:'leaf'}),JSON.stringify(c.expected),'qa-owner',JSON.stringify(c.actor_guard),JSON.stringify([{section_key:lease.section_key,locked_by:lease.locked_by,lease_version:lease.lease_version}])];
  const sql='($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9::jsonb) r';const result=await tx(b,cx=>q(cx,'select save_ship_dynamics_task_member_v1'+sql,args),'anon');assert.equal(result.ok,true);
  assert.equal((await tx(b,cx=>q(cx,'select get_ship_dynamics_task_member_receipt_v1'+sql,args),'anon')).replayed,true);
  afterSave=(await records()).payload;assert.equal(afterSave.tasks[0].vesselProgress.find(p=>p.vesselId==='qa-v1').status,'saved after first cutover');
 });
 await check('NI08-operational-rollback-keeps-post-cutover-data',async()=>{const p=await pause();const s={result:await step('13_stage_latest_records_back.sql')};await publishResume(p,s,'legacy');assert.deepEqual(content((await legacy()).payload),content(afterSave));const state=await step('12_control_readback.sql','control_readback');assert.equal(state.authority.source,'legacy');assert.equal(state.browser.admitted,true);});
 await check('NI09-formal-history-and-alternatives-retained',async()=>{const stable=tables.filter(t=>/^sd_itinerary_(documents|history|daily_reports|daily_report_operations)$/.test(t));const current=await ledger(stable);for(const t of stable)assert.deepEqual(current[t],before[t]);});
 receipt.inputsUnchanged=files.every(f=>hash(fs.readFileSync(f))===receipt.inputs[f]);assert.equal(receipt.inputsUnchanged,true);receipt.status='PASS';
}catch(e){receipt.status='FAIL';receipt.error={code:e.code??'ASSERT',message:e.message,where:e.where};process.exitCode=1;}
finally{if(vite)await vite.close();if(native)await native.close();save();console.log(JSON.stringify({status:receipt.status,receipt:path.join(run,'receipt.json'),cases:receipt.cases,error:receipt.error}));}
