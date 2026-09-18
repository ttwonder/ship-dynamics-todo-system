import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createViteServer} from 'vite';
import {PGlite} from '@electric-sql/pglite';
import {installItineraryFixture,seedItineraryFixture,snapshotItineraryAuthority,recordItinerarySql,recordItineraryWriteSql,recordWriteArgs} from './record-itinerary-local-fixture.mjs';

import {morningInput,installMorningOracle,seedMorningOracle,schedulerSql} from './record-daily-morning-local-fixture.mjs';
import {shipExcelRpcArgs} from './ship-itinerary-excel-local-fixture.mjs';
import {shipInternalControlRpcArgs} from './ship-internal-control-local-fixture.mjs';

// Internal QA only: real mounted UI + synthetic data + real embedded PostgreSQL.
// NOT hosted Supabase/PostgREST/Realtime. No remote URL or credential input.
export async function createRecordStorageLocalQa({manualReportAuthority=false,browserAuthority=false,dataManagement=false,dailyMorning=false,internalControl=false,shipExcel=false,shipInternalControl=false,performanceTrace=false,scopedRead=false,taskMember=false,preparePerformanceFixture=null,databaseFactory=null,handoverMigrationFixture=null,legacySnapshot=false}={}) {
 if(preparePerformanceFixture&&!performanceTrace)throw new Error('Performance fixture requires explicit performanceTrace');
 // Opt-in private native QA supplies an already identity-verified connection.
 // The existing browser/PGlite default and migration/seed chain stay unchanged.
 const db=databaseFactory?await databaseFactory():new PGlite(),metrics=[];
 const workspace='isolated-record-ui-qa',password=`qa-${randomUUID()}`;
 let origin='',http,vite,loseItineraryAck=false,loseReportAck=false,losePruneAck=false;
 let recordFault=null,uiMiddleware=null;
 const config=()=>({supabaseUrl:origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:workspace,tableName:'ship_dynamics_app_state',...(shipInternalControl?{}:{storageMode:legacySnapshot?'legacy':'records-v1'}),readMode:legacySnapshot?'snapshot':scopedRead?'scoped-v1':'delta-v1'});
 const requestArgs=['p_workspace_key','p_operation_id','p_operations:jsonb','p_saved_by','p_actor_user_id','p_actor_guard:jsonb','p_authorization_guard:jsonb','p_lock_guards:jsonb'];
 const rpcArgs={
  ...(manualReportAuthority?{
   sd_itinerary_main_load_many:['p_workspace_key','p_vessel_ids:text[]','p_actor_user_id'],
   sd_save_manual_itinerary_report:['p_workspace_key','p_actor_user_id','p_operation_id:uuid'],
   sd_itinerary_daily_report_list_v2:['p_workspace_key','p_actor_user_id','p_page:integer','p_page_size:integer'],
   sd_itinerary_daily_report_locate_v2:['p_workspace_key','p_business_date:date','p_actor_user_id','p_page_size:integer'],
   sd_itinerary_daily_report_load_by_id:['p_workspace_key','p_report_id:bigint','p_actor_user_id'],
  }:{}),
  ...(legacySnapshot?{apply_ship_dynamics_block_patch_v2:requestArgs,get_ship_dynamics_block_patch_receipt:requestArgs}:{}),
  ...(browserAuthority?{read_ship_dynamics_browser_authority_v1:['p_workspace_key'],apply_ship_dynamics_block_patch_v2:requestArgs,get_ship_dynamics_block_patch_receipt:requestArgs}:{}),
  ...(shipExcel?shipExcelRpcArgs:{}),
  ...(shipInternalControl?shipInternalControlRpcArgs:{}),
  ...recordWriteArgs,
  ...(taskMember?Object.fromEntries(['save_ship_dynamics_task_member_v1','get_ship_dynamics_task_member_receipt_v1'].map(name=>[name,['p_workspace_key','p_operation_id','p_task_id','p_vessel_id','p_command:jsonb','p_expected:jsonb','p_actor_user_id','p_actor_guard:jsonb','p_lock_guards:jsonb']])):{}),
  ...(taskMember?{read_ship_dynamics_task_member_v1:['p_workspace_key','p_task_id','p_vessel_id','p_actor_user_id'],renew_ship_dynamics_task_member_lock_v1:['p_workspace_key','p_section_key','p_locked_by','p_lease_version','p_ttl_seconds:integer'],release_ship_dynamics_task_member_lock_v1:['p_workspace_key','p_section_key','p_locked_by','p_lease_version']}:{}),
  get_ship_dynamics_record_storage_stats_v1:['p_workspace_key','p_actor_user_id'],
  prune_ship_dynamics_record_revision_history_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid','p_expected_revisions:jsonb','p_delete_revisions:jsonb'],
  sd_itinerary_record_report_save_manual_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid'],
  sd_itinerary_record_report_list_v1:['p_workspace_key','p_actor_user_id','p_page:integer','p_page_size:integer'],
  sd_itinerary_record_report_locate_v1:['p_workspace_key','p_business_date:date','p_actor_user_id','p_page_size:integer'],
  sd_itinerary_record_report_load_v1:['p_workspace_key','p_report_id:bigint','p_actor_user_id'],
  sd_itinerary_record_report_delete_ids_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid','p_expected_set_token','p_delete_report_ids:jsonb'],
  sd_itinerary_record_report_delete_dates_v1:['p_workspace_key','p_actor_user_id','p_operation_id:uuid','p_expected_set_token','p_delete_dates:jsonb'],
  sd_itinerary_record_load_many_v1:['p_workspace_key','p_vessel_ids:text[]','p_actor_user_id'],
  read_ship_dynamics_record_scopes_v1:['p_workspace_key','p_scope','p_versions:jsonb','p_targets:jsonb'],
  read_ship_dynamics_records_v1:['p_workspace_key'],
  read_ship_dynamics_record_delta_v1:['p_workspace_key','p_base_revision:integer','p_base_token'],
  apply_ship_dynamics_record_patch_v1:requestArgs,
  get_ship_dynamics_record_receipt_v1:requestArgs,
  claim_ship_dynamics_edit_lock:['p_workspace_key','p_section_key','p_locked_by','p_locked_by_name','p_ttl_seconds:integer'],
  renew_ship_dynamics_edit_lock:['p_workspace_key','p_section_key','p_locked_by','p_ttl_seconds:integer'],
  release_ship_dynamics_edit_lock:['p_workspace_key','p_section_key','p_locked_by'],
 };
 const close=async()=>{
  if(http){http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
  if(vite)await vite.close();await db.close();
 };
 try {
  await db.exec('create role anon nologin;create role authenticated nologin;');
  for(const path of ['supabase/schema.sql','supabase/development/20260906_appdata_record_store.sql','supabase/development/20260906_appdata_record_delta.sql'])await db.exec(fs.readFileSync(path,'utf8'));
  if(taskMember)await db.exec(fs.readFileSync('supabase/development/20260909_task_member_protocol.sql','utf8'));
  if(handoverMigrationFixture)await handoverMigrationFixture(db,'before');
  else await db.exec(fs.readFileSync('supabase/development/20260911_vessel_manager_handover.sql','utf8'));
  if(scopedRead)await db.exec(fs.readFileSync('supabase/development/20260908_appdata_record_scoped_read.sql','utf8'));
  vite=await createViteServer({cacheDir:process.env.QA_VITE_CACHE_DIR,server:{middlewareMode:true,...(process.env.QA_HMR_PORT?{hmr:{port:Number(process.env.QA_HMR_PORT)}}:{})},logLevel:'silent',plugins:[{
   name:'isolated-record-qa-label',
   transformIndexHtml(html){return html.replace('<body>','<body><aside id="isolated-qa-label" style="position:fixed;z-index:2147483647;bottom:0;right:0;background:#442200;color:white;padding:4px 10px;font:12px sans-serif;pointer-events:none">真實 UI＋測試資料｜本機 SQL；非正式環境</aside>');},
  }]});
  const {createInitialData}=await vite.ssrLoadModule('/src/data/seed.ts');
  const initial=createInitialData(),at=new Date().toISOString();
  const hash=createHash('sha256').update(password).digest('hex');
  initial.revision=1;initial.updatedAt=at;initial.settings.sitePasswordHash=hash;
  initial.users=[{id:'qa-owner',name:'QA OWNER',username:'qa-owner',department:'督導',role:'owner',passwordHash:hash,isActive:true,managedVesselIds:[],createdAt:at,updatedAt:at}];
  const template=structuredClone(initial.vessels[0]);
  initial.vessels=['qa-v1','qa-v2'].map((id,index)=>({...structuredClone(template),id,name:`QA VESSEL ${index+1}`,nameEn:`QA VESSEL ${index+1}`,isActive:true,assignedUserIds:[],delegateManagers:[]}));
  for(const name of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])initial[name]=[];
  if(dailyMorning)morningInput(initial);
  if(internalControl)await (await import('./record-internal-control-local-fixture.mjs')).internalControlInput(initial,vite);
  if(preparePerformanceFixture)await preparePerformanceFixture(initial,vite);
  if(!legacySnapshot){const imported=(await db.query('select import_ship_dynamics_records_v1($1,$2::jsonb) as result',[workspace,JSON.stringify(initial)])).rows[0].result;if(!imported.ok)throw new Error(`QA import failed: ${imported.code}`);}
  if(legacySnapshot){const {normalizeAppData}=await vite.ssrLoadModule('/src/normalize.ts');const payload=normalizeAppData(initial);if(!payload)throw new Error('invalid legacy fixture');await db.query('insert into public.ship_dynamics_app_state(workspace_key,payload,revision,updated_by) values($1,$2::jsonb,1,$3)',[workspace,JSON.stringify(payload),'QA OWNER']);}
  if(handoverMigrationFixture)await handoverMigrationFixture(db,'after-import');
  await installItineraryFixture(db);
  await seedItineraryFixture(db,vite,workspace,initial.vessels);
  await db.exec(fs.readFileSync(recordItinerarySql,'utf8'));
  await db.exec(fs.readFileSync(recordItineraryWriteSql,'utf8'));
  for(const file of ['supabase/migrations/20260905200000_manual_itinerary_daily_reports.sql','supabase/migrations/20260905210000_manual_itinerary_legacy_compatibility.sql','supabase/development/20260906_itinerary_record_reports.sql'])await db.exec(fs.readFileSync(file,'utf8'));
  await db.exec(fs.readFileSync('supabase/development/20260906_appdata_record_data_management.sql','utf8'));
  if(dataManagement){
   const {buildCloudBlockPatch}=await vite.ssrLoadModule('/src/cloudBlockPatch.ts');
   for(let n=2;n<=7;n++){
    const base=(await db.query('select read_ship_dynamics_records_v1($1) as r',[workspace])).rows[0].r.payload;
    const next=structuredClone(base);next.vessels.reverse();
    const result=(await db.query(`select apply_ship_dynamics_record_patch_v1($1,$2,$3::jsonb,'QA OWNER','qa-owner',ship_dynamics_actor_guard($4::jsonb,'qa-owner'),ship_dynamics_authorization_guard($4::jsonb),'[]') r`,[workspace,'qa-history-'+n,JSON.stringify(buildCloudBlockPatch(base,next)),JSON.stringify(base)])).rows[0].r;
    if(!result.ok)throw new Error('QA history save failed '+JSON.stringify(result));
   }
  }
  if(dailyMorning){await installMorningOracle(db);await seedMorningOracle(db,initial,workspace,{sortedFormal:dailyMorning==='browser'});if(fs.existsSync(schedulerSql))await db.exec(fs.readFileSync(schedulerSql,'utf8'));}
  if(internalControl&&!legacySnapshot)await (await import('./record-internal-control-local-fixture.mjs')).seedInternalControlLegacy(db,workspace,initial);
  const itineraryBaseline=await snapshotItineraryAuthority(db);
  const send=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
  http=createHttpServer(async(req,res)=>{
   try{
    res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; frame-src 'none'; object-src 'none'; form-action 'self'");
    const url=new URL(req.url,origin||'http://127.0.0.1');
    // Prevent a default config asset from ever reaching this local fixture.
    if(url.pathname.endsWith('/supabase-config.js')){res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');res.end(`window.SHIP_DYNAMICS_SUPABASE_CONFIG=${JSON.stringify(config())};`);return;}
    if(url.pathname==='/__qa/blank'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
    if(url.pathname==='/__qa/health'){send(res,200,{ready:true,kind:db.qaKind||'REAL_UI_SYNTHETIC_DATA_LOCAL_PGLITE'});return;}
    if(url.pathname.startsWith('/rest/v1/')){
     const name=url.pathname.slice('/rest/v1/rpc/'.length),args=rpcArgs[name];
     if((legacySnapshot||browserAuthority)&&req.method==='GET'&&url.pathname==='/rest/v1/ship_dynamics_app_state'&&url.searchParams.get('workspace_key')==='eq.'+workspace){const row=(await db.query('select payload,revision,updated_at,updated_by from public.ship_dynamics_app_state where workspace_key=$1',[workspace])).rows[0];metrics.push({rpc:'legacy-snapshot-read',status:'SQL_OK'});send(res,200,row??null);return;}
     if(req.method!=='POST'||!url.pathname.startsWith('/rest/v1/rpc/')||!args){metrics.push({rpc:name,status:'UNSUPPORTED'});send(res,404,{code:'PGRST202',message:`Internal QA does not implement ${name}; no success substituted`});return;}
     const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>12_000_000)throw new Error('QA body limit');chunks.push(chunk);}
     const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
     if(body.p_workspace_key!==workspace){send(res,403,{code:'QA_SCOPE_MISMATCH',message:'Only the isolated fixture workspace is accepted'});return;}
     const start=performance.now();
     // Opt-in measurements only. Never persist request bodies, keys or credentials.
     const trace=performanceTrace?{requestBytes:length,requestStartedMs:performance.timeOrigin+start,baseRevision:body.p_base_revision??null,scope:body.p_scope??null}:null;
     if(internalControl&&recordFault?.before&&(taskMember||(shipInternalControl&&Object.hasOwn(shipInternalControlRpcArgs,name))||['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1','renew_ship_dynamics_edit_lock'].includes(name)))await recordFault.before({name,body,db,metrics});
     try{
      const value=await db.transaction(async tx=>{
       if(trace)trace.sqlStartedMs=performance.timeOrigin+performance.now();
       if(browserAuthority&&name==='read_ship_dynamics_browser_authority_v1'||shipExcel&&Object.hasOwn(shipExcelRpcArgs,name)||shipInternalControl&&Object.hasOwn(shipInternalControlRpcArgs,name))await tx.exec('set local role anon');
       await tx.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-forwarded-for':'192.0.2.30','cf-ipcountry':'TW'})]);
       const params=args.map(arg=>{const[key,type]=arg.split(':');if(body[key]==null)return null;return type==='jsonb'?JSON.stringify(body[key]):body[key];});
       const result=(await tx.query(`select public.${name}(${args.map((arg,index)=>`$${index+1}::${arg.split(':')[1]||'text'}`).join(',')}) as result`,params)).rows[0].result;
       if(trace)trace.sqlEndedMs=performance.timeOrigin+performance.now();
       return result;
      },db.httpTransactions?{rpc:name,operationId:body.p_operation_id,payloadHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')}:undefined);
      if(trace){trace.transactionEndedMs=performance.timeOrigin+performance.now();trace.sqlMs=trace.sqlEndedMs-trace.sqlStartedMs;trace.responseKind=value?.status??null;trace.changedRecords=value?.collections?Object.entries(value.collections).flatMap(([collection,c])=>(c.rows||[]).map(r=>({collection,id:r.id,version:r.version}))):null;trace.responseBytes=Buffer.byteLength(JSON.stringify(value??null));}
      if(value?.code==='authorization-conflict'){
       const debug=(await db.query(`select ship_dynamics_actor_guard((read_ship_dynamics_records_v1($1))->'payload',$2) as guard,ship_dynamics_patch_touches_authorization_domain($3::jsonb) as touches`,[workspace,body.p_actor_user_id,JSON.stringify(body.p_operations)])).rows[0];
       const differs=(a,b,prefix='')=>{if(a===b)return[];if(a&&b&&typeof a==='object'&&typeof b==='object')return[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differs(a[k],b[k],prefix?prefix+'.'+k:k));return[prefix];};
       metrics.push({rpc:name,diagnostic:'GUARD_KEYS_ONLY',actorMismatchKeys:differs(debug.guard,body.p_actor_guard),touchesAuthorization:debug.touches,hasAuthorizationGuard:body.p_authorization_guard!=null,operations:body.p_operations.map(op=>({kind:op.kind,collection:op.collection,entityId:op.entityId}))});
      }
      metrics.push({rpc:name,status:value?.ok===false?value.code:'SQL_OK',conflictKey:value?.conflict_key,operationId:body.p_operation_id,vesselId:body.p_vessel_id,revision:value?.revision,bytes:Buffer.byteLength(JSON.stringify(value??null)),elapsedMs:performance.now()-start,...(trace?{trace}:{})});
      if(loseItineraryAck&&(name==='sd_itinerary_record_save_v1'||(shipExcel&&name==='sd_itinerary_save_public'))){loseItineraryAck=false;metrics.push({rpc:name,status:'ACK_DROPPED_AFTER_SQL',operationId:body.p_operation_id});send(res,503,{code:'QA_LOST_ACK',message:'Synthetic ACK loss after actual SQL commit'});return;}
      if(loseReportAck&&['sd_itinerary_record_report_save_manual_v1','sd_itinerary_record_report_delete_ids_v1'].includes(name)){loseReportAck=false;metrics.push({rpc:name,status:'ACK_DROPPED_AFTER_SQL',operationId:body.p_operation_id});send(res,503,{code:'QA_LOST_ACK',message:'Synthetic report ACK loss after actual SQL commit'});return;}
      if(losePruneAck&&name==='prune_ship_dynamics_record_revision_history_v1'){losePruneAck=false;metrics.push({rpc:name,status:'ACK_DROPPED_AFTER_SQL',operationId:body.p_operation_id});send(res,503,{code:'QA_LOST_ACK',message:'Synthetic prune ACK loss after actual SQL commit'});return;}
      if(internalControl&&recordFault?.after&&(taskMember||(shipInternalControl&&Object.hasOwn(shipInternalControlRpcArgs,name))||['apply_ship_dynamics_record_patch_v1','get_ship_dynamics_record_receipt_v1'].includes(name))){
       const drop=await recordFault.after({name,body,value,db,metrics});
       if(drop){metrics.push({rpc:name,status:'ACK_DROPPED_AFTER_SQL',operationId:body.p_operation_id});send(res,503,{code:'QA_LOST_ACK',message:'Synthetic record ACK loss after actual SQL commit'});return;}
      }
      send(res,200,value);
     }catch(error){metrics.push({rpc:name,status:'SQL_ERROR',code:error.code});send(res,400,{code:error.code||'QA_SQL_ERROR',message:error.message});}
     return;
    }
    (uiMiddleware||vite.middlewares)(req,res,()=>send(res,404,{code:'QA_NOT_FOUND'}));
   }catch(error){send(res,500,{code:'QA_HARNESS_ERROR',message:error.message});}
  });
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${http.address().port}`;
  return {origin,password,metrics,db,close,workspace,setUiMiddleware:middleware=>{uiMiddleware=middleware;},loadModule:path=>vite.ssrLoadModule(path),setRecordFault:fault=>{if(!internalControl)throw new Error("Record fault hooks require internalControl fixture");recordFault=fault;},loseNextPruneAck:()=>{losePruneAck=true;},loseNextReportAck:()=>{loseReportAck=true;},loseNextItineraryAck:()=>{loseItineraryAck=true;},itineraryBaseline,itinerarySnapshot:()=>snapshotItineraryAuthority(db),read:async()=> (await db.query('select read_ship_dynamics_records_v1($1) as result',[workspace])).rows[0].result};
 }catch(error){await close();throw error;}
}
