import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeRecordQa} from './record-storage-native-qa.mjs';
import {createRecordStorageLocalQa} from './record-storage-local-qa.mjs';
import {installTrackingBrowserMigrations,installTrackingFieldRevision} from './tracking-browser-fixture.mjs';
const root=process.env.QA_EVIDENCE_ROOT;assert.ok(root&&path.isAbsolute(root));assert.ok(!path.resolve(root).toLowerCase().startsWith(path.resolve('.').toLowerCase()+path.sep));fs.mkdirSync(root,{recursive:true});
const run=fs.mkdtempSync(path.join(root,'record-scope-preflight-'));
const signature='public.read_ship_dynamics_record_scopes_v2(text,text,jsonb,jsonb,jsonb)';
const evidence={label:'原生 PostgreSQL＋中性測試資料；非正式 Supabase',status:'RUNNING',productionContacted:false,measurements:[],cases:[]};
evidence.inputHashes=Object.fromEntries(['src/morningHistory.ts','scripts/verify-record-scope-preflight-native.mjs','scripts/record-storage-native-qa.mjs','scripts/record-storage-local-qa.mjs','scripts/tracking-browser-fixture.mjs','supabase/migrations/20260924160000_tracking_records.sql','supabase/migrations/20261009060000_record_reader_inline_bodies.sql','supabase/verification/record-reader-inline-readback.sql'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
let native,qa,failure;
const sample=(n,s)=>Array.from({length:Math.ceil(n/64)},(_,i)=>createHash('sha256').update(s+':'+i).digest('hex')).join('').slice(0,n);
const timed=async(name,fn)=>{const start=performance.now();try{const result=await fn();evidence.measurements.push({name,ms:Math.round(performance.now()-start),status:'OK'});return result;}catch(e){evidence.measurements.push({name,ms:Math.round(performance.now()-start),status:'ERROR',code:e.code});throw e;}};
const check=async(caseId,fn)=>{try{await fn();evidence.cases.push({caseId,status:'PASS'});}catch(e){failure??=e;evidence.cases.push({caseId,status:'FAIL',message:e.message,code:e.code});}};
try{
 native=await createNativeRecordQa(run,evidence);
 qa=await createRecordStorageLocalQa({internalControl:true,browserAuthority:true,scopedRead:true,shipInternalControl:true,tracking:true,taskMember:true,hmr:false,databaseFactory:async()=>native.adapter});
 await installTrackingBrowserMigrations(qa.db);await installTrackingFieldRevision(qa.db);
 for(const f of ['20260929120000_tracking_delivery_close.sql','20260929180000_tracking_completion_close.sql','20261008090000_tracking_unrelated_patch_fast_path.sql'])await qa.db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const base=(await qa.read()).payload;
 const {upsertDailyMorningReport}=await qa.loadModule('/src/morningHistory.ts');
 const saved=upsertDailyMorningReport(base,{at:'2026-10-08T01:00:00Z',actorUserId:base.users[0].id,source:'manual'});assert.equal(saved.status,'saved');
 // Neutral size/count fixture approximates only the observed workload dimensions.
 // It never accepts a production payload, URL, credential or database input.
 const templates={users:base.users[0],vessels:base.vessels[0],tasks:base.tasks[0],internalControlCases:base.internalControlCases[0],meetings:base.meetings[0]||{id:'qa-meeting',taskItems:[]},agendaReports:saved.report,notifications:{id:'qa-notice',userId:base.users[0].id},auditLogs:{id:'qa-audit'},taskDismissals:{id:'qa-dismissal'},trackingItems:{id:'qa-tracking',vesselId:'qa-v1',linkState:'none'}};
 const counts={users:108,vessels:40,tasks:144,internalControlCases:182,meetings:8,agendaReports:35,notifications:1000,auditLogs:500,taskDismissals:7,trackingItems:1102};
 const padding={users:180,vessels:900,tasks:600,internalControlCases:600,meetings:1600,agendaReports:120000,notifications:400,auditLogs:400,taskDismissals:100,trackingItems:600};
 const rows=Object.entries(counts).flatMap(([collection,n])=>Array.from({length:n},(_,i)=>{const id=collection+'-qa-'+i,value={...structuredClone(templates[collection]),id,qaPadding:sample(padding[collection],collection+'-'+i)};if(collection==='trackingItems')value.vesselId=i%2?'qa-v1':'qa-v2';return {collection,id,value};}));
 await qa.db.query('delete from public.ship_dynamics_records where workspace_key=$1',[qa.workspace]);
 for(const collection of Object.keys(counts))await qa.db.query("insert into public.ship_dynamics_record_collections(workspace_key,collection,ids) values($1,$2,'[]') on conflict(workspace_key,collection) do nothing",[qa.workspace,collection]);
 await qa.db.query('insert into public.ship_dynamics_records(workspace_key,collection,entity_id,value,revision) select $1,x.collection,x.id,x.value,1 from jsonb_to_recordset($2::jsonb) x(collection text,id text,value jsonb)',[qa.workspace,JSON.stringify(rows)]);
 for(const [collection] of Object.entries(counts))await qa.db.query("insert into public.ship_dynamics_record_collections(workspace_key,collection,ids) select $1,$2,jsonb_agg(entity_id order by entity_id) from public.ship_dynamics_records where workspace_key=$1 and collection=$2 on conflict(workspace_key,collection) do update set ids=excluded.ids",[qa.workspace,collection]);
 evidence.fixture={counts,valueBytes:Buffer.byteLength(JSON.stringify(rows)),synthetic:true};
 const query=async(scope='full',versions={},targets=[],vesselIds=[])=>qa.db.query('select public.read_ship_dynamics_record_scopes_v2($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) r',[qa.workspace,scope,JSON.stringify(versions),JSON.stringify(targets),JSON.stringify(vesselIds)]).then(x=>x.rows[0].r);
 const before=await timed('full-cold',()=>query());
 const versions=Object.fromEntries(Object.entries(before.collections).map(([c,v])=>[c,Object.fromEntries(v.rows.map(r=>[r.id,{version:r.version,detail:r.detail}]))]));
 await timed('full-unchanged',()=>query('full',versions));
 await timed('home-from-full',()=>query('home',versions));
 const catalog=(await qa.db.query('select oid::text,prosrc,proacl::text,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
 evidence.predecessor={sha256:createHash('sha256').update(catalog.prosrc).digest('hex'),oid:catalog.oid};
 const definition=(await qa.db.query('select pg_get_functiondef(oid) d from pg_proc where oid=$1::regprocedure',[signature])).rows[0].d;
 const semantic=x=>({...x,collections:Object.fromEntries(Object.entries(x.collections).map(([c,v])=>[c,{...v,rows:[...v.rows].sort((a,b)=>a.id.localeCompare(b.id))}]))});
 const vectors=[['full',versions,[],[]],['home',versions,[],[]],['targets',{},[{collection:'internalControlCases',id:'internalControlCases-qa-0'}],['qa-v1']],['targets',{},[],[]],['full',{trackingItems:[{version:1,detail:true}],tasks:null},[],[]]];
 const expected=[];for(const v of vectors)expected.push(semantic(await query(...v)));
 const businessBefore=await qa.read(),physicalBefore=(await qa.db.query('select collection,entity_id,revision,xmin::text,ctid::text from ship_dynamics_records where workspace_key=$1 order by collection,entity_id',[qa.workspace])).rows;
 const readback=()=>qa.db.query(fs.readFileSync('supabase/verification/record-reader-inline-readback.sql','utf8')).then(x=>x.rows[0]);
 evidence.readbackBefore=await readback();assert.equal(evidence.readbackBefore.reader_exists,true);assert.equal(evidence.readbackBefore.known_predecessor,true);assert.equal(evidence.readbackBefore.execution_mode_expected,true);
 // The established private bridge executes scoped reads as ship_qa, not a
 // hosted browser role. Do not add grants merely to make catalog status PASS.
 const migration='supabase/migrations/20261009060000_record_reader_inline_bodies.sql',upgrade=fs.readFileSync(migration,'utf8');
 const applyUpgrade=!process.argv.includes('--before-upgrade');
 if(applyUpgrade){await qa.db.exec(upgrade);await qa.db.exec(upgrade.replaceAll('\n','\r\n'));}
 const afterCatalog=(await qa.db.query('select oid::text,prosrc,proacl::text,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];
 for(const k of ['oid','proacl','prosecdef','proconfig'])assert.deepEqual(afterCatalog[k],catalog[k]);
 evidence.readback=await readback();evidence.migrationSha256=createHash('sha256').update(upgrade).digest('hex');
 if(applyUpgrade){assert.equal(evidence.readback.exact_inline_reader,true);assert.equal(evidence.readback.execution_mode_expected,true);}
 const installedDefinition=(await qa.db.query('select pg_get_functiondef(oid) d from pg_proc where oid=$1::regprocedure',[signature])).rows[0].d;
 const sqlFor=def=>{
  let sql=def.slice(def.indexOf(' with bodies as '),def.indexOf(' return result;')).replace(' into result from ',' from ');
  sql=sql.replace(/w\.revision/g,'(select revision from public.ship_dynamics_record_workspaces where workspace_key=$1)').replace(/w\.root/g,'(select root from public.ship_dynamics_record_workspaces where workspace_key=$1)');
  for(const [token,arg] of [['p_workspace_key','$1'],['p_vessel_ids','$5::jsonb'],['p_versions','$3::jsonb'],['p_targets','$4::jsonb'],['p_scope','$2::text'],['targets','$4::jsonb']])sql=sql.replace(new RegExp('\\b'+token+'\\b','g'),()=>arg);
  return sql;
 };
 const plan=async def=>(await qa.db.query('explain (analyze,buffers,format json,timing off) '+sqlFor(def),[qa.workspace,'full','{}','[]','[]'])).rows[0]['QUERY PLAN'][0];
 await qa.db.exec("set work_mem='64kB'");
 const originalPlan=await plan(definition),installedPlan=await plan(installedDefinition);
 evidence.plans={original:originalPlan,installed:installedPlan};
 const nodes=p=>[p,...(p.Plans||[]).flatMap(nodes)];
 evidence.bodyCteScanCount={original:nodes(originalPlan.Plan).filter(n=>n['CTE Name']==='bodies').length,installed:nodes(installedPlan.Plan).filter(n=>n['CTE Name']==='bodies').length};
 evidence.tempBlocks={originalWritten:originalPlan.Plan['Temp Written Blocks']||0,installedWritten:installedPlan.Plan['Temp Written Blocks']||0,originalRead:originalPlan.Plan['Temp Read Blocks']||0,installedRead:installedPlan.Plan['Temp Read Blocks']||0};
 await check('RSP01-full-read-avoids-wide-record-temp-materialization',async()=>assert.equal(evidence.bodyCteScanCount.installed,0,'installed reader must not materialize and re-scan full record bodies'));
 await check('RSP02-full-history-opaque-fields-and-warm-cache-parity',async()=>{
  assert.deepEqual(semantic(await timed('installed-full-cold-low-memory',()=>query())),semantic(before));
  assert.deepEqual(semantic(await timed('installed-full-unchanged-low-memory',()=>query('full',versions))),expected[0]);
 });
 await check('RSP03-home-targets-promotion-and-version-type-parity',async()=>{for(let i=1;i<vectors.length;i++)assert.deepEqual(semantic(await query(...vectors[i])),expected[i]);});
 await check('RSP04-rerun-preserves-OID-ACL-security-business-and-physical-rows',async()=>{
  assert.deepEqual(await qa.read(),businessBefore);assert.deepEqual((await qa.db.query('select collection,entity_id,revision,xmin::text,ctid::text from ship_dynamics_records where workspace_key=$1 order by collection,entity_id',[qa.workspace])).rows,physicalBefore);
 });
 if(applyUpgrade)await check('RSP05-unknown-predecessor-refused-without-overwrite',async()=>{
  const unknown=installedDefinition.replace('begin','begin -- unknown fixture version');await qa.db.exec(unknown);
  await assert.rejects(qa.db.exec(upgrade),/record-reader-inline-predecessor-mismatch/);await qa.db.exec('rollback');assert.equal((await qa.db.query('select pg_get_functiondef(oid) d from pg_proc where oid=$1::regprocedure',[signature])).rows[0].d,unknown);
  await qa.db.exec(installedDefinition);assert.deepEqual(await qa.read(),businessBefore);
 });
}catch(e){failure??=e;evidence.error={message:e.message,code:e.code};}
finally{
 try{await qa?.close();await native?.close();}catch(e){failure??=e;evidence.cleanupError=e.message;}
 evidence.status=failure?'FAIL':'PASS';fs.writeFileSync(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,run,fixture:evidence.fixture,measurements:evidence.measurements,fullMembershipProbeCount:evidence.fullMembershipProbeCount,cases:evidence.cases,error:evidence.error,cleanup:{pgStopped:evidence.stopped,pgPortClosed:evidence.portClosed,ownedDataRemoved:evidence.ownedDataRemoved}}));if(failure)process.exitCode=1;
}
