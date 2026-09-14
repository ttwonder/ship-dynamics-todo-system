import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},logLevel:'silent'});
const cases=[];let failed=false;
const check=async(id,fn)=>{try{await fn();cases.push({id,status:'PASS'});}catch(e){failed=true;cases.push({id,status:'FAIL',code:e.code??e.message});}};
try{
 const a=await server.ssrLoadModule('/src/cloudSourceAuthority.ts'),m=await server.ssrLoadModule('/src/itineraryDailyReports.ts');
 const cfg={supabaseUrl:'http://127.0.0.1:9',supabaseAnonKey:'',workspaceKey:'roundtrip-client',tableName:'ship_dynamics_app_state',storageMode:'legacy'};
 const raw={workspace:cfg.workspaceKey,managed:true,source:'records-v1',epoch:3,pauseState:'resumed',admitted:true};
 for(const source of ['legacy','records-v1'])for(const epoch of [1,2,3,Number.MAX_SAFE_INTEGER])await check(`RTC-PARSE-${source}-${epoch}`,()=>{const b=a.parseBrowserAuthority({...raw,source,epoch},cfg);assert.equal(b.source,source);assert.equal(b.epoch,epoch);assert.equal(a.authorityConfig(cfg,b).storageMode,source);});
 for(const epoch of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'3',null,undefined])await check('RTC-INVALID-EPOCH-'+String(epoch),()=>assert.throws(()=>a.parseBrowserAuthority({...raw,epoch},cfg)));
 await check('RTC-EPOCH-FLOOR-IDENTITY',()=>{const x=a.parseBrowserAuthority(raw,cfg),y=a.parseBrowserAuthority({...raw,epoch:4},cfg);assert.equal(a.sameAuthority(x,y),false);assert.notEqual(a.authorityFloorIdentity('raw',x),a.authorityFloorIdentity('raw',y));assert.equal(cfg.storageMode,'legacy');});
 const op='11111111-1111-4111-8111-111111111111';
 const deletion=m.createPendingItineraryDailyReportDelete({operationId:op,actorUserId:'actor',expectedSetToken:'1'.repeat(32),deleteReportIds:['3']},cfg);
 const manual=m.createPendingManualItineraryReportSave({operationId:op,actorUserId:'actor'},cfg);
 for(const source of ['legacy','records-v1'])for(const kind of ['delete','manual'])await check(`RTC-DISPATCH-${kind}-${source}`,async()=>{
  const pending={...(kind==='delete'?deletion:manual),sourceAuthority:{...raw,source}};let call;
  const client={rpc:async(name,args)=>{call={name,args};return {data:null,error:{code:'QA_CAPTURED_ROUTE',message:'QA_CAPTURED_ROUTE'}};}};
  await assert.rejects(()=>kind==='delete'?m.deleteItineraryDailyReports(pending,cfg,client):m.saveManualItineraryDailyReport(pending,cfg,client),e=>e.code==='QA_CAPTURED_ROUTE');
  assert.equal(call.name,source==='records-v1'?(kind==='delete'?'sd_itinerary_record_report_delete_ids_v1':'sd_itinerary_record_report_save_manual_v1'):(kind==='delete'?'delete_sd_itinerary_daily_report_records':'sd_save_manual_itinerary_report'));
  assert.equal(call.args.p_operation_id,op);
 });
 for(const kind of ['delete','manual'])for(const change of [{epoch:0},{epoch:1.5},{epoch:Number.MAX_SAFE_INTEGER+1},{source:'unknown'},{pauseState:'paused'},{pauseState:'unmanaged'},{admitted:false},{workspace:'other'}])await check(`RTC-ENVELOPE-${kind}-${JSON.stringify(change)}`,async()=>{const pending={...(kind==='delete'?deletion:manual),sourceAuthority:{...raw,...change}};let dispatched=false;await assert.rejects(()=>kind==='delete'?m.deleteItineraryDailyReports(pending,cfg,{rpc:async()=>{dispatched=true;}}):m.saveManualItineraryDailyReport(pending,cfg,{rpc:async()=>{dispatched=true;}}));assert.equal(dispatched,false);});
 console.log(JSON.stringify({status:failed?'FAIL':'PASS',layer:'controlled-client-module',count:cases.length,cases}));
}finally{await server.close();}if(failed)process.exitCode=1;
