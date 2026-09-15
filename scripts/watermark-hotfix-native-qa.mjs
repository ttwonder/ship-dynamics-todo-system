// Scoped upgrade/resource regression on the installed 05 predecessor.
// Called only by verify-production-release-native.mjs --watermark-hotfix.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function verifyWatermarkHotfix({native,check,receipt,workspace}) {
 const {observer:c,a}=native,w=workspace;
 const fn="'ship_dynamics_quiescence_private.watermark_v1(text,uuid)'::regprocedure";
 const q=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.r;
 const body=()=>q(c,`select prosrc r from pg_proc where oid=${fn}`);
 const metadata=()=>q(c,`select to_jsonb(p)-'prosrc' r from pg_proc p where oid=${fn}`);
 await c.query(`insert into public.ship_dynamics_app_revisions(workspace_key,revision,payload,saved_by)
 select $1,900000+g,jsonb_build_object('wide',repeat(md5(g::text),256),'ordered',jsonb_build_array(1,2,3),'inactive',true),'QA RESOURCE'
 from generate_series(1,2048) g`,[w]);
 const ledger=()=>q(c,`select jsonb_agg(jsonb_build_array(revision,saved_at,saved_by,md5(payload::text)) order by revision) r from public.ship_dynamics_app_revisions where workspace_key=$1`,[w]);
 const before=await ledger(),oldBody=await body(),oldMeta=await metadata();
 await a.query("set work_mem='64kB';set temp_file_limit='1MB';set max_parallel_workers_per_gather=0");
 const invokePause=db=>q(db,'select public.pause_ship_dynamics_business_v1($1,$2) r',[w,randomUUID()]);
 await check('WH01-original-installed-pause-resource-RED-proxy',async()=>{
  await assert.rejects(()=>invokePause(a),e=>{assert.equal(e.code,'53400');assert.match(e.where,/watermark_v1/);receipt.watermarkExpectedRed={code:e.code,message:e.message,productionCode:'53100',proxyOnly:true};return true;});
  assert.equal(await q(c,'select count(*)::int r from ship_dynamics_quiescence_private.workspaces'),0);
  assert.deepEqual(await ledger(),before);
 });
 const repair=fs.readFileSync('supabase/release/08a_fix_watermark_resource.sql','utf8');
 const readback=fs.readFileSync('supabase/release/08b_verify_watermark_resource.sql','utf8');
 await check('WH02-other-workspace-control-refuses-upgrade',async()=>{
  await c.query('begin');
  await c.query('insert into ship_dynamics_quiescence_private.workspaces values($1,null,$2)',['qa-other-workspace',randomUUID()]);
  await assert.rejects(()=>c.query(repair),e=>e.message==='watermark-repair-unused-controls-required');
  await c.query('rollback');assert.equal(await body(),oldBody);
 });
 await check('WH03-unknown-predecessor-body-refuses-upgrade',async()=>{
  await c.query('begin');const def=await q(c,`select pg_get_functiondef(${fn}) r`);
  await c.query(def.replace(oldBody,()=>oldBody+'\n-- changed predecessor\n'));
  await assert.rejects(()=>c.query(repair),e=>e.message==='watermark-repair-source-mismatch');
  await c.query('rollback');assert.equal(await body(),oldBody);
 });
 await check('WH04-late-upgrade-fault-is-atomic',async()=>{
  const bad=repair.replace('\nCOMMIT;\n',()=>"\nDO $$ BEGIN RAISE EXCEPTION 'qa-watermark-late-fault'; END $$;\nCOMMIT;\n");assert.notEqual(bad,repair);
  await assert.rejects(()=>c.query(bad),e=>e.message==='qa-watermark-late-fault');await c.query('rollback');
  assert.equal(await body(),oldBody);assert.deepEqual(await metadata(),oldMeta);assert.deepEqual(await ledger(),before);
 });
 await check('WH05-CRLF-upgrade-preserves-OID-ACL-settings-and-data',async()=>{
  const def=await q(c,`select pg_get_functiondef(${fn}) r`);
  await c.query(def.replace(oldBody,()=>oldBody.replace(/\r?\n/g,'\r\n')));
  await c.query(`alter function ship_dynamics_quiescence_private.watermark_v1(text,uuid) set qa.private_canary='omit-me-from-readback'`);
  const meta=await metadata();await c.query(repair);
  assert.deepEqual(await metadata(),meta);assert.deepEqual(await ledger(),before);
  const rs=await a.query(readback),r=rs.flatMap(x=>x.rows??[]).find(x=>x.watermark_readback)?.watermark_readback;
  assert.equal(r?.body_matches,true);assert.equal(r?.security_definer,true);assert.equal(r?.browser_execute,false);assert.equal(r?.service_role_execute,false);assert.equal(r?.controls_empty,true);
  assert.equal(JSON.stringify(r).includes('omit-me-from-readback'),false);receipt.watermarkReadback=r;
  await c.query('alter function ship_dynamics_quiescence_private.watermark_v1(text,uuid) reset qa.private_canary');
 });
 const mark=()=>q(c,'select ship_dynamics_quiescence_private.watermark_v1($1,(select id from sd_workspaces where legacy_key=$1)) r',[w]);
 await check('WH06-full-content-change-detection-retained',async()=>{
  const base=await mark();
  for(const sql of [
   `update ship_dynamics_app_revisions set payload=jsonb_set(payload,'{wide}','"changed"') where revision=900001`,
   `update ship_dynamics_app_revisions set payload=jsonb_set(payload,'{ordered}','[3,2,1]') where revision=900001`,
   `update ship_dynamics_app_revisions set saved_by=null where revision=900001`,
   `delete from ship_dynamics_app_revisions where revision=900001`,
   `update ship_dynamics_app_revisions set workspace_key='qa-other' where revision=900001`,
  ]){await c.query('begin');try{await c.query(sql);assert.notDeepEqual(await mark(),base);}finally{await c.query('rollback');}}
  await c.query('begin');await c.query('update ship_dynamics_app_revisions set saved_by=saved_by where revision=900001');assert.deepEqual(await mark(),base);await c.query('rollback');
 });
 await check('WH07-pause-read-resume-under-same-temp-budget',async()=>{
  const paused=await invokePause(a);assert.equal(paused.state,'paused');
  const r=await q(a,'select public.read_ship_dynamics_business_pause_v1($1,$2) r',[w,paused.transition]);assert.equal(r.unchanged,true);
  const resumed=await q(a,'select public.resume_ship_dynamics_business_v1($1,$2,$3::jsonb) r',[w,paused.transition,JSON.stringify(paused.watermark)]);assert.equal(resumed.state,'resumed');
  assert.deepEqual(await ledger(),before);
 });
 await check('WH08-repair-rerun-refused-without-control-rewrites',async()=>{
  const latest=await body();await assert.rejects(()=>c.query(repair),e=>e.message==='watermark-repair-already-installed-use-readback');await c.query('rollback');assert.equal(await body(),latest);
 });
 await check('WH09-wide-single-rows-470MiB-logical-under-temp-budget',async()=>{
  await a.query('begin');
  try{
   // Fixture INSERT invokes existing row guards, not the watermark under test.
   // Construct wide rows at ordinary memory, then constrain the measured read.
   await a.query("set local work_mem='4MB';set local temp_file_limit='64MB'");
   await a.query(`insert into ship_dynamics_app_revisions(workspace_key,revision,payload,saved_by)
    select 'qa-watermark-wide-rows',g,jsonb_build_object('wide',repeat(md5(g::text),32768)),'QA WIDE'
    from generate_series(1,470) g`);
   await a.query("set local work_mem='64kB';set local temp_file_limit='1MB'");
   const size=await q(a,"select jsonb_build_object('rows',count(*),'logical_bytes',sum(octet_length(to_jsonb(r)::text))) r from ship_dynamics_app_revisions r where workspace_key='qa-watermark-wide-rows'");
   assert.equal(size.rows,470);assert.ok(size.logical_bytes>=470*1024*1024);
   const start=performance.now();const result=await q(a,"select ship_dynamics_quiescence_private.watermark_v1('qa-watermark-wide-rows',null) r");
   assert.equal(result.ship_dynamics_app_revisions.rows,470);assert.match(result.ship_dynamics_app_revisions.digest,/^[a-f0-9]{32}$/);
   const settings=await q(a,"select jsonb_build_object('work_mem',current_setting('work_mem'),'temp_file_limit',current_setting('temp_file_limit')) r");
   assert.equal(settings.work_mem,'64kB');assert.equal(settings.temp_file_limit,'1MB');
   receipt.wideWatermarkProbe={...size,ms:performance.now()-start,...settings,synthetic:true};
  }finally{await a.query('rollback');}
  assert.deepEqual(await ledger(),before);
 });
 // Keep the same bounded session settings for the runner's real forward/member/
 // latest-data reverse/publish/resume cases below. No production data is used.
}
