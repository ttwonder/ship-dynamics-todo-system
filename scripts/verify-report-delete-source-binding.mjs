import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},logLevel:'silent'});
try {
 const m=await server.ssrLoadModule('/src/itineraryDailyReports.ts');
 const config={supabaseUrl:'http://127.0.0.1:9',supabaseAnonKey:'',workspaceKey:'w',tableName:'ship_dynamics_app_state',storageMode:'records-v1'};
 const old=m.createPendingItineraryDailyReportDelete({operationId:'11111111-1111-4111-8111-111111111111',actorUserId:'a',expectedSetToken:'1'.repeat(32),deleteReportIds:['3']},config);
 const binding={workspace:'w',managed:true,source:'legacy',epoch:1,pauseState:'resumed',admitted:true};
 const bound={...old,sourceAuthority:binding};let calls=[];
 const client={rpc:async(name,params)=>{calls.push({name,params});return {error:null,data:{ok:true,operationId:old.operationId,deletedCount:1,deletedBytes:50,deletedReportIds:['3'],remainingReportCount:2,remainingSetToken:'2'.repeat(32)}};}};
 await m.deleteItineraryDailyReports(bound,config,client);
 assert.equal(calls[0].name,'delete_sd_itinerary_daily_report_records','new captured legacy intent must not dispatch the retired raw record route');
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 m.writePendingItineraryDailyReportDelete(bound,config,storage);
 assert.deepEqual(m.readPendingItineraryDailyReportDelete(config,'a',storage),bound,'reload must preserve captured source rather than silently return an unbound command');
 const key=[...memory.keys()][0]; memory.set(key,'{unknown historical envelope');
 assert.throws(()=>m.writePendingItineraryDailyReportDelete(bound,config,storage),undefined,'fresh deletion must not overwrite protected unknown pending');
 memory.set(key,JSON.stringify({...bound,operationId:'22222222-2222-4222-8222-222222222222'}));
 m.clearPendingItineraryDailyReportDelete(config,'a',storage,bound);assert.ok(memory.has(key),'an old completion must not clear successor pending');
 const cases=['RDEL-SOURCE-ROUTE','RDEL-RELOAD','RDEL-PROTECTED-UNKNOWN','RDEL-SUCCESSOR'];
 for(const [cfg,authority,expected] of [[config,undefined,'sd_itinerary_record_report_delete_ids_v1'],[config,{workspace:'w',managed:false,source:'records-v1',epoch:0,pauseState:'unmanaged',admitted:true},'sd_itinerary_record_report_delete_ids_v1'],[{...config,storageMode:'legacy'},undefined,'delete_sd_itinerary_daily_report_records']]){
  const pending={...m.createPendingItineraryDailyReportDelete(old,cfg),...(authority?{sourceAuthority:authority}:{})};await m.deleteItineraryDailyReports(pending,cfg,client);assert.equal(calls.at(-1).name,expected);assert.deepEqual(calls.at(-1).params.p_delete_report_ids,['3']);cases.push('RDEL-RAW-ROUTE-'+cases.length);
 }
 for(const sourceAuthority of [null,{}, {...binding,workspace:'other'},{...binding,source:'unknown'},{...binding,epoch:2},{...binding,admitted:false},{...binding,pauseState:'paused'}]){
  const malformed={...old,sourceAuthority};memory.set(key,JSON.stringify(malformed));const recovered=m.readPendingItineraryDailyReportDelete(config,'a',storage);assert.deepEqual(recovered.sourceAuthority,sourceAuthority);const n=calls.length;await assert.rejects(()=>m.deleteItineraryDailyReports(recovered,config,client),e=>e.code==='INVALID_DELETE_ENVELOPE'&&!e.definitive);assert.equal(calls.length,n);assert.throws(()=>m.writePendingItineraryDailyReportDelete(bound,config,storage));cases.push('RDEL-INVALID-SOURCE-'+cases.length);
 }
 const legacy={version:2,operationId:old.operationId,actorUserId:'a',configIdentity:old.configIdentity,workspaceKey:'w',createdAt:old.createdAt,deleteDates:['2026-09-06'],expectedSetToken:old.expectedSetToken};
 const legacyKey=key.replace(':v3:',':v2:');memory.clear();memory.set(legacyKey,JSON.stringify(legacy));assert.deepEqual(m.readPendingLegacyItineraryDailyReportDelete(config,'a',storage),legacy);
 await m.reconcileLegacyItineraryDailyReportDelete(legacy,config,{rpc:async(name,params)=>{assert.equal(name,'sd_itinerary_record_report_delete_dates_v1');assert.deepEqual(params,{p_workspace_key:'w',p_actor_user_id:'a',p_operation_id:old.operationId,p_expected_set_token:old.expectedSetToken,p_delete_dates:['2026-09-06']});return {error:null,data:{ok:true,operationId:old.operationId,deletedCount:1,deletedBytes:50,deletedDates:['2026-09-06'],remainingReportCount:2,remainingSetToken:'2'.repeat(32)}};}});assert.throws(()=>m.writePendingItineraryDailyReportDelete(bound,config,storage));cases.push('RDEL-V2-RAW-EXACT');
 for(const error of [{code:'PGRST202'},{code:'42883'}]){let n=0;await assert.rejects(()=>m.deleteItineraryDailyReports(bound,config,{rpc:async name=>{n++;assert.equal(name,'delete_sd_itinerary_daily_report_records');return {data:null,error};}}));assert.equal(n,1);cases.push('RDEL-NO-FALLBACK-'+error.code);}
 for(const receipt of [{operationId:'22222222-2222-4222-8222-222222222222'},{deletedReportIds:['2']},{deletedCount:0}]){await assert.rejects(()=>m.deleteItineraryDailyReports(bound,config,{rpc:async()=>({error:null,data:{ok:true,operationId:old.operationId,deletedCount:1,deletedBytes:50,deletedReportIds:['3'],remainingReportCount:2,remainingSetToken:'2'.repeat(32),...receipt}})}),e=>e.code==='INVALID_RESPONSE'&&!e.definitive);cases.push('RDEL-RECEIPT-'+cases.length);}
 memory.clear();memory.set(key,JSON.stringify(bound));const replay=m.readPendingItineraryDailyReportDelete(config,'a',storage);await m.deleteItineraryDailyReports(replay,config,client);assert.equal(calls.at(-1).name,'delete_sd_itinerary_daily_report_records');assert.equal(m.clearPendingItineraryDailyReportDelete(config,'a',storage,replay),true);assert.equal(memory.size,0);cases.push('RDEL-EXACT-REPLAY-CLEAR');
 console.log(JSON.stringify({status:'PASS',layer:'controlled-client-module',cases,count:cases.length}));
} finally {await server.close();}
