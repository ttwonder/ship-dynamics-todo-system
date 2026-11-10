// Local test harness only: actual worker + HTTP RPC + embedded PostgreSQL.
// No hosted database/configuration is ever loaded. Default source is saved-HTML replay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export async function createNativeRiskBridge({loadModule,fixtureRoot,origin,live=false}) {
 const db=new PGlite(),jobs=[],metrics=[];
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
 await db.exec(fs.readFileSync('supabase/migrations/20261110070000_ship_fleet_risk.sql','utf8'));
 const {createSnapshotHandler,createSnapshotRpc}=await loadModule('/supabase/functions/fleet-risk/handler.ts');
 const {collectFleetRisk}=await loadModule('/supabase/functions/fleet-risk/service.ts');
 const fixture=filename=>fs.readFileSync(path.join(fixtureRoot,filename),'utf8');
 const roster=JSON.parse(fixture('autonomous-live-roster.json')).rows;
 const bodies={entry:fixture('autonomous-entry.html'),login:fixture('autonomous-entry-result.html'),getcompanies:fixture('autonomous-company-search.html'),page0:fixture('autonomous-ships-page0.html'),page1:fixture('autonomous-ships-page1.html')};
 for(const row of roster)bodies[row.huid]=fixture(`live-ship-${row.imo}.html`);
 let mode='replay',release,sourceCalls=0,liveCalls=0,forceRequests=0,sourceRequests=0,liveMetrics=null;
 const syntheticServerKey='isolated-native-server-key',syntheticAnonKey='isolated-native-anon-key',scheduleToken='isolated-native-scheduler-token';
 const rpcMap={read_ship_fleet_risk_v1:p=>['select public.read_ship_fleet_risk_v1() as value',[]],claim_ship_fleet_risk_v1:p=>['select public.claim_ship_fleet_risk_v1($1,$2::uuid) as value',[p.p_trigger,p.p_request_id]],progress_ship_fleet_risk_v1:p=>['select public.progress_ship_fleet_risk_v1($1::uuid,$2::int,$3::int) as value',[p.p_run_id,p.p_done,p.p_total]],finish_ship_fleet_risk_v1:p=>['select public.finish_ship_fleet_risk_v1($1::uuid,$2::jsonb,$3::text) as value',[p.p_run_id,p.p_snapshot===null?null:JSON.stringify(p.p_snapshot),p.p_error]]};
 const read=async()=> (await db.query('select public.read_ship_fleet_risk_v1() as value')).rows[0].value;
 const replayFetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://apcis.tmou.org');sourceRequests++;
  const action=url.searchParams.get('action')||'entry',params=new URLSearchParams(String(init?.body||''));
  const key=action==='getships'?'page'+params.get('Page'):action==='getship'?params.get('HUID'):action;
  assert.ok(bodies[key],'fixture '+key);
  return new Response(bodies[key],{headers:{'content-type':'text/html','set-cookie':'qa_session=local; Path=/public/'}});
 };
 const handler=createSnapshotHandler({rpc:createSnapshotRpc(origin,syntheticServerKey),allowedOrigins:[origin],schedulerToken:scheduleToken,waitUntil:p=>jobs.push(p),collector:async options=>{
  sourceCalls++;const selectedMode=mode;
  if(selectedMode==='hold')await new Promise(r=>{release=r;});
  if(selectedMode==='fail')throw new Error('controlled source outage');
  if(selectedMode==='live'){
   assert.equal(live,true,'explicit --live required');assert.equal(++liveCalls,1,'only one full official fetch');
   const child=spawn(process.env.QA_DENO||'deno',['run','--no-config','--allow-net=apcis.tmou.org','scripts/collect-fleet-risk-stdio.ts','--live'],{stdio:['ignore','pipe','pipe']});
   let spawnError;
   const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));}).catch(error=>{spawnError=error;return -1;});
   const abort=()=>child.kill();options.signal.addEventListener('abort',abort,{once:true});
   let result,failure;child.stderr.resume();
   try{
    if(options.signal.aborted)abort();
    for await(const line of createInterface({input:child.stdout})){
     const message=JSON.parse(line);
     if(message.kind==='progress')await options.onProgress?.(message.done,message.total);
     if(message.metrics){liveMetrics=message.metrics;sourceRequests+=message.metrics.requests;}
     if(message.kind==='result')result=message.collected;
     if(message.kind==='failure')failure=message.code;
    }
    const code=await exit;
    assert.equal(code,0,'original Deno source failed: '+(spawnError?.message||failure));assert.ok(result,'complete source result required');return result;
   }finally{options.signal.removeEventListener('abort',abort);if(child.exitCode===null)child.kill();await exit.catch(()=>{});}
  }
  return collectFleetRisk({...options,fetchImpl:replayFetch});
 }});
 const middleware=async(req,res,next)=>{
  const rpcName=req.url?.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1];
  if(!rpcName&&req.url!=='/functions/v1/fleet-risk')return next();
  try{
   if(req.method!=='POST'){res.statusCode=405;res.end();return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('fixture body limit');}
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   if(rpcName){
    if(!rpcMap[rpcName]){res.statusCode=404;res.end('{}');return;}
    const role=req.headers.apikey===syntheticServerKey?'service_role':'anon';
    const [sql,args]=rpcMap[rpcName](JSON.parse(body||'{}'));
    const value=await db.transaction(async tx=>{await tx.exec(`SET LOCAL ROLE ${role}`);return(await tx.query(sql,args)).rows[0].value;});
    metrics.push({kind:'rpc',name:rpcName,role,status:'SQL_OK'});res.end(JSON.stringify(value));return;
   }
   forceRequests++;
   const headers=new Headers();for(const [name,value]of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
   const response=await handler(new Request(origin+req.url,{method:'POST',headers,body}));
   res.statusCode=response.status;response.headers.forEach((value,name)=>res.setHeader(name,value));res.end(await response.text());
  }catch(error){metrics.push({kind:'error',code:error.code||error.name});res.statusCode=500;res.end(JSON.stringify({error:'ISOLATED_TEST_FAILURE'}));}
 };
 return {middleware,read,metrics,roster,get liveMetrics(){return liveMetrics;},get sourceCalls(){return sourceCalls;},get forceRequests(){return forceRequests;},get sourceRequests(){return sourceRequests;},syntheticAnonKey,
  setMode(value){mode=value;},isHeld:()=>typeof release==='function',release(){release?.();release=undefined;},
  async drain(){while(jobs.length)await jobs.shift();},
  async seed(){const r=await fetch(origin+'/functions/v1/fleet-risk',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'refresh',requestId:randomUUID()})});assert.equal(r.status,202);await this.drain();const state=await read();assert.equal(state.attempt.status,'success');return state;},
  async close(){this.release();await this.drain();await db.close();},
 };
}
