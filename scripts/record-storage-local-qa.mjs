import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createViteServer} from 'vite';
import {PGlite} from '@electric-sql/pglite';
import {installItineraryFixture,seedItineraryFixture,snapshotItineraryAuthority,recordItinerarySql,recordItineraryWriteSql,recordWriteArgs} from './record-itinerary-local-fixture.mjs';

// Internal QA only: real mounted UI + synthetic data + real embedded PostgreSQL.
// NOT hosted Supabase/PostgREST/Realtime. No remote URL or credential input.
export async function createRecordStorageLocalQa() {
 const db=new PGlite(),metrics=[];
 const workspace='isolated-record-ui-qa',password=`qa-${randomUUID()}`;
 let origin='',http,vite,loseItineraryAck=false;
 const config=()=>({supabaseUrl:origin,supabaseAnonKey:'isolated-qa-not-a-service-key',workspaceKey:workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'delta-v1'});
 const requestArgs=['p_workspace_key','p_operation_id','p_operations:jsonb','p_saved_by','p_actor_user_id','p_actor_guard:jsonb','p_authorization_guard:jsonb','p_lock_guards:jsonb'];
 const rpcArgs={
  ...recordWriteArgs,
  sd_itinerary_record_load_many_v1:['p_workspace_key','p_vessel_ids:text[]','p_actor_user_id'],
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
  vite=await createViteServer({server:{middlewareMode:true},logLevel:'silent',plugins:[{
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
  const imported=(await db.query('select import_ship_dynamics_records_v1($1,$2::jsonb) as result',[workspace,JSON.stringify(initial)])).rows[0].result;
  if(!imported.ok)throw new Error(`QA import failed: ${imported.code}`);
  await installItineraryFixture(db);
  await seedItineraryFixture(db,vite,workspace,initial.vessels);
  await db.exec(fs.readFileSync(recordItinerarySql,'utf8'));
  await db.exec(fs.readFileSync(recordItineraryWriteSql,'utf8'));
  const itineraryBaseline=await snapshotItineraryAuthority(db);
  const send=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
  http=createHttpServer(async(req,res)=>{
   try{
    res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; frame-src 'none'; object-src 'none'; form-action 'self'");
    const url=new URL(req.url,origin||'http://127.0.0.1');
    // Prevent a default config asset from ever reaching this local fixture.
    if(url.pathname.endsWith('/supabase-config.js')){res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');res.end(`window.SHIP_DYNAMICS_SUPABASE_CONFIG=${JSON.stringify(config())};`);return;}
    if(url.pathname==='/__qa/blank'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
    if(url.pathname==='/__qa/health'){send(res,200,{ready:true,kind:'REAL_UI_SYNTHETIC_DATA_LOCAL_PGLITE'});return;}
    if(url.pathname.startsWith('/rest/v1/')){
     const name=url.pathname.slice('/rest/v1/rpc/'.length),args=rpcArgs[name];
     if(req.method!=='POST'||!url.pathname.startsWith('/rest/v1/rpc/')||!args){metrics.push({rpc:name,status:'UNSUPPORTED'});send(res,404,{code:'PGRST202',message:`Internal QA does not implement ${name}; no success substituted`});return;}
     const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>12_000_000)throw new Error('QA body limit');chunks.push(chunk);}
     const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
     if(body.p_workspace_key!==workspace){send(res,403,{code:'QA_SCOPE_MISMATCH',message:'Only the isolated fixture workspace is accepted'});return;}
     const start=performance.now();
     try{
      const value=await db.transaction(async tx=>{
       await tx.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-forwarded-for':'192.0.2.30','cf-ipcountry':'TW'})]);
       const params=args.map(arg=>{const[key,type]=arg.split(':');if(body[key]==null)return null;return type==='jsonb'?JSON.stringify(body[key]):body[key];});
       return (await tx.query(`select public.${name}(${args.map((arg,index)=>`$${index+1}::${arg.split(':')[1]||'text'}`).join(',')}) as result`,params)).rows[0].result;
      });
      if(value?.code==='authorization-conflict'){
       const debug=(await db.query(`select ship_dynamics_actor_guard((read_ship_dynamics_records_v1($1))->'payload',$2) as guard,ship_dynamics_patch_touches_authorization_domain($3::jsonb) as touches`,[workspace,body.p_actor_user_id,JSON.stringify(body.p_operations)])).rows[0];
       const differs=(a,b,prefix='')=>{if(a===b)return[];if(a&&b&&typeof a==='object'&&typeof b==='object')return[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differs(a[k],b[k],prefix?prefix+'.'+k:k));return[prefix];};
       metrics.push({rpc:name,diagnostic:'GUARD_KEYS_ONLY',actorMismatchKeys:differs(debug.guard,body.p_actor_guard),touchesAuthorization:debug.touches,hasAuthorizationGuard:body.p_authorization_guard!=null,operations:body.p_operations.map(op=>({kind:op.kind,collection:op.collection,entityId:op.entityId}))});
      }
      metrics.push({rpc:name,status:value?.ok===false?value.code:'SQL_OK',operationId:body.p_operation_id,vesselId:body.p_vessel_id,revision:value?.revision,bytes:Buffer.byteLength(JSON.stringify(value??null)),elapsedMs:performance.now()-start});
      if(loseItineraryAck&&name==='sd_itinerary_record_save_v1'){loseItineraryAck=false;metrics.push({rpc:name,status:'ACK_DROPPED_AFTER_SQL',operationId:body.p_operation_id});send(res,503,{code:'QA_LOST_ACK',message:'Synthetic ACK loss after actual SQL commit'});return;}
      send(res,200,value);
     }catch(error){metrics.push({rpc:name,status:'SQL_ERROR',code:error.code});send(res,400,{code:error.code||'QA_SQL_ERROR',message:error.message});}
     return;
    }
    vite.middlewares(req,res,()=>send(res,404,{code:'QA_NOT_FOUND'}));
   }catch(error){send(res,500,{code:'QA_HARNESS_ERROR',message:error.message});}
  });
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${http.address().port}`;
  return {origin,password,metrics,db,close,loseNextItineraryAck:()=>{loseItineraryAck=true;},itineraryBaseline,itinerarySnapshot:()=>snapshotItineraryAuthority(db),read:async()=> (await db.query('select read_ship_dynamics_records_v1($1) as result',[workspace])).rows[0].result};
 }catch(error){await close();throw error;}
}
