import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'vite';
import {PGlite} from '@electric-sql/pglite';
const evidenceRoot=process.env.QA_EVIDENCE_ROOT;
assert.ok(evidenceRoot&&path.isAbsolute(evidenceRoot),'External absolute QA_EVIDENCE_ROOT required');
assert.ok(!path.resolve(evidenceRoot).toLowerCase().startsWith(process.cwd().toLowerCase()+path.sep));
fs.mkdirSync(evidenceRoot,{recursive:true});
const output=fs.mkdtempSync(path.join(evidenceRoot,'fleet-risk-worker-'));
const receipt={layer:'Original Edge orchestration + real embedded PostgreSQL; synthetic source collector. NOT hosted cron or multi-backend contention.',cases:[],output};
const db=new PGlite(),server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
const calls=[],jobs=[];
let mode='success',release,sourceCalls=0,signalObserved,failAfterCommit=false,failed;
const scalar=async(sql,args=[])=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return(await tx.query(sql,args)).rows[0].value;});
const direct={
 read_ship_fleet_risk_v1:()=>scalar('select public.read_ship_fleet_risk_v1() as value'),
 claim_ship_fleet_risk_v1:p=>scalar('select public.claim_ship_fleet_risk_v1($1,$2::uuid) as value',[p.p_trigger,p.p_request_id]),
 progress_ship_fleet_risk_v1:p=>scalar('select public.progress_ship_fleet_risk_v1($1::uuid,$2::int,$3::int) as value',[p.p_run_id,p.p_done,p.p_total]),
 finish_ship_fleet_risk_v1:p=>scalar('select public.finish_ship_fleet_risk_v1($1::uuid,$2::jsonb,$3::text) as value',[p.p_run_id,p.p_snapshot===null?null:JSON.stringify(p.p_snapshot),p.p_error]),
};
const rpc=async(name,p)=>{calls.push({name,p:structuredClone(p)});const result=await direct[name](p);if(name==='finish_ship_fleet_risk_v1'&&p.p_snapshot&&failAfterCommit){failAfterCommit=false;throw new Error('synthetic dropped committed ACK');}return result;};
const read=()=>direct.read_ship_fleet_risk_v1();
const collector=async({signal,onProgress})=>{
 sourceCalls++;signalObserved=signal;const thisMode=mode;
 await onProgress(0,2);
 if(thisMode==='blocked')await new Promise(r=>{release=r;});
 if(thisMode==='fail')throw new Error('private source diagnostics must not leak');
 if(signal.aborted)throw signal.reason;
 await onProgress(1,2);await onProgress(2,2);
 const at=new Date().toISOString();
 return {company:{name:'Synthetic FPMC fleet',imo:'0882415',performance:'Medium'},rosterRetrievedAt:at,count:thisMode==='partial'?1:2,
 rows:[['FPMC S AMBER','9913743','SRS'],['FPMC B 105','9487677','HRS']].map(([name,imo,risk])=>({name,imo,risk,status:'ok',priority:'No Priority',companyName:'Synthetic operator',companyImo:'0882415',windowFrom:null,windowTo:null,sourceUpdatedAt:null,sourceUrl:'https://apcis.tmou.org/public/',retrievedAt:at})),coverage:{referenceCount:2,missingReferenceImos:[],addedReferenceImos:[]}};
};
const request=(body={action:'refresh',requestId:randomUUID()},headers={},signal)=>new Request('https://fixture.invalid/functions/v1/fleet-risk',{method:'POST',headers:{origin:'https://ttwonder.github.io','content-type':'application/json',...headers},body:JSON.stringify(body),signal});
const drain=async()=>{while(jobs.length)await jobs.shift();};
const until=async test=>{const end=Date.now()+3000;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,5));}throw new Error('worker condition timeout');};
try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
 await db.exec(fs.readFileSync('supabase/migrations/20261110070000_ship_fleet_risk.sql','utf8'));
 const {createSnapshotHandler,createSnapshotRpc}=await server.ssrLoadModule('/supabase/functions/fleet-risk/handler.ts');
 const options={rpc,collector,waitUntil:p=>jobs.push(p),allowedOrigins:['https://ttwonder.github.io'],schedulerToken:'isolated-fixture-schedule-token'};
 const handler=createSnapshotHandler(options),peer=createSnapshotHandler(options);
 mode='blocked';const firstId=randomUUID(),cancel=new AbortController();
 const response=await handler(request({action:'refresh',requestId:firstId},{},cancel.signal));
 assert.equal(response.status,202,'manual route must accept immediately and run asynchronously');
 const first=await response.json();assert.equal(first.started,true);assert.equal(first.runId,firstId);assert.equal(first.state.snapshot,null);
 cancel.abort();await until(()=>typeof release==='function');assert.equal(signalObserved.aborted,false,'closing one caller must not cancel shared work');
 assert.equal(sourceCalls,1);assert.equal((await read()).snapshot,null);
 for(const id of [firstId,randomUUID()]){const joined=await(await peer(request({action:'refresh',requestId:id}))).json();assert.equal(joined.started,false);assert.equal(joined.runId,firstId);}
 assert.equal(sourceCalls,1);receipt.cases.push('asynchronous manual ACK, independent peer joins, zero partial publication, browser cancellation does not cancel worker');
 release();await drain();const success=await read();assert.equal(success.attempt.status,'success');assert.equal(success.snapshot.count,2);assert.equal(success.snapshot.queryStartedAt,first.state.attempt.startedAt,'preserve database microseconds verbatim');
 assert.equal((await(await handler(request({action:'refresh',requestId:firstId}))).json()).started,false);assert.equal(sourceCalls,1);receipt.cases.push('exact complete native publication and terminal request replay without a second crawl');
 mode='fail';await handler(request());await drain();const fail=await read();assert.equal(fail.attempt.status,'failed');assert.deepEqual(fail.snapshot,success.snapshot);assert.ok(!JSON.stringify(fail).includes('private source'));receipt.cases.push('source error retains last good snapshot and sanitizes diagnostics');
 mode='partial';await handler(request());await drain();const partial=await read();assert.equal(partial.attempt.status,'failed');assert.deepEqual(partial.snapshot,success.snapshot);receipt.cases.push('database rejects partial result; worker marks failure without changing old snapshot');
 mode='blocked';release=undefined;const staleId=randomUUID();await handler(request({action:'refresh',requestId:staleId}));await until(()=>typeof release==='function');const oldRelease=release;
 await db.exec("UPDATE public.ship_fleet_risk_cache_v1 SET lease_expires_at=clock_timestamp()-interval '1 second'");
 mode='success';const replacementId=randomUUID();await handler(request({action:'refresh',requestId:replacementId}));oldRelease();await drain();assert.equal((await read()).snapshot.id,replacementId);receipt.cases.push('expired worker cannot overwrite a newer complete run');
 mode='success';failAfterCommit=true;const ackId=randomUUID();await handler(request({action:'refresh',requestId:ackId}));await drain();const ack=await read();assert.equal(ack.snapshot.id,ackId);assert.equal(ack.attempt.status,'success');assert.equal(calls.filter(c=>c.name==='finish_ship_fleet_risk_v1'&&c.p.p_run_id===ackId&&c.p.p_snapshot).length,1);receipt.cases.push('lost publication ACK cannot overwrite committed success or replay the success writer');
 const before=calls.length;
 for(const [req,status] of [[new Request('https://fixture.invalid',{method:'GET',headers:{origin:'https://ttwonder.github.io'}}),405],[request({action:'refresh',requestId:randomUUID()},{origin:'https://evil.invalid'}),403],[request({action:'refresh',requestId:'not-uuid'}),400],[request({action:'scheduled'}),403],[request({action:'scheduled'},{'x-fleet-scheduler-token':'wrong'}),403],[request({action:'roster'}),400]]){assert.equal((await handler(req)).status,status);}
 assert.equal(calls.length,before);assert.equal((await handler(new Request('https://fixture.invalid',{method:'OPTIONS',headers:{origin:'https://ttwonder.github.io'}}))).status,204);
 const scheduled=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'content-type':'application/json','x-fleet-scheduler-token':options.schedulerToken},body:JSON.stringify({action:'scheduled'})}));assert.ok([200,202].includes(scheduled.status));await drain();assert.equal(calls.filter(c=>c.name==='claim_ship_fleet_risk_v1').at(-1).p.p_trigger,'scheduled');receipt.cases.push('CORS/method/body gates, private scheduled token, scheduled RPC trigger');
 const transport=[];const testRpc=createSnapshotRpc('https://fixture-project.supabase.co','synthetic-server-key',async(url,init)=>{transport.push({url,init});return new Response(JSON.stringify({snapshot:null}),{headers:{'content-type':'application/json'}});});
 assert.deepEqual(await testRpc('read_ship_fleet_risk_v1',{}),{snapshot:null});assert.equal(transport[0].url,'https://fixture-project.supabase.co/rest/v1/rpc/read_ship_fleet_risk_v1');assert.equal(transport[0].init.cache,'no-store');assert.equal(new Headers(transport[0].init.headers).get('apikey'),'synthetic-server-key');receipt.cases.push('server-only PostgREST transport selects exact endpoint with no-store and explicit credential headers');
 receipt.status='PASS';
}catch(error){failed=error;receipt.status='FAIL';receipt.error=error.stack;}
finally{if(release)release();await drain().catch(()=>{});await db.close();await server.close();receipt.sourceCalls=sourceCalls;receipt.sha256=Object.fromEntries(['supabase/functions/fleet-risk/handler.ts','supabase/migrations/20261110070000_ship_fleet_risk.sql'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));}
console.log(JSON.stringify(receipt,null,2));if(failed)throw failed;
